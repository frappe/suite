"""GO or NO-GO for the Drive migration, decided without writing anything.

    bench --site <site> execute suite.drive.patches.build.preflight.check

Build's own gate (`gate.check_gate`) refuses a misconfigured site, but it
runs inside `bench migrate`, after model sync and with the site offline. An
operator wants the same answer the day before, in plain words, plus the one
thing the gate cannot afford to do on every migrate: head a sample of the
legacy S3 objects Build is about to copy. The production bucket holds its
keys in several layouts (`legacy.KEY_SHAPES`), and a key layout the bucket
no longer serves would surface as thousands of nodes with no blob, after
the framework backfill had already committed.

So this module answers three questions, in this order:

1. Does the site agree with itself? Storage v2 on, the S3 driver on when
   Drive Disk Settings has S3 on, one bucket at one endpoint on both sides,
   and the bucket answering a HEAD. This is `gate.check_gate`, reused.
2. Are the legacy objects there? Every blobless `File` row Build's copy step
   would read is grouped by key shape, and a deterministic sample of each
   shape is headed through the bucket port. One missing object is NO-GO,
   with the key printed, because Build would carry on past it.
3. Which blobless rows will Build never reach? The same classification
   `legacy_bytes.record_unreachable_rows` makes, so the operator sees the
   rows the §14.9 report would list as missing bytes before the run.

Nothing here writes to the database, the bucket, or the disk. `check()`
prints and returns None, so `bench execute` prints nothing of its own.
"""

from dataclasses import dataclass, field

import frappe

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE, BuildEnvironment
from suite.drive.patches.build.gate import BuildGateError, check_gate
from suite.drive.patches.build.legacy import KEY_SHAPES, S3_URL_PREFIX, key_shape, storage_key
from suite.drive.patches.build.legacy_bytes import LOCAL_PREFIXES, handled_prefixes, names_no_bytes

# Objects headed per key shape. Enough to catch a layout the bucket no longer
# serves; few enough that a check against a 150 GB bucket finishes in seconds.
SAMPLE_PER_SHAPE = 25

# How many unreachable rows and empty-path rows are printed. The counts
# above them stay exact.
ROWS_LISTED = 20

GO = "GO"
NO_GO = "NO-GO"


@dataclass(frozen=True)
class DiskSettings:
    """The `Drive Disk Settings` columns the gate does not read.

    `root_folder` decides `legacy.key_shape`; `flat` and `thumbnail_prefix`
    are printed so the operator can compare them with the bucket console.
    `LegacyS3Config` carries the three the gate compares.
    """

    root_folder: str = ""
    flat: bool = False
    thumbnail_prefix: str = ""

    @classmethod
    def for_site(cls) -> DiskSettings:
        from frappe.utils import cint

        from suite.drive.patches.build.ports import legacy_single_value

        # Plain `tabSingles` reads, as `LegacyS3Config.for_site` does: the
        # meta no longer declares these fields.
        return cls(
            root_folder=legacy_single_value("Drive Disk Settings", "root_folder") or "",
            flat=bool(cint(legacy_single_value("Drive Disk Settings", "flat"))),
            thumbnail_prefix=legacy_single_value("Drive Disk Settings", "thumbnail_prefix") or "",
        )


@dataclass
class Check:
    """One precondition and whether this site meets it."""

    name: str
    ok: bool
    detail: str = ""


@dataclass
class ShapeSample:
    """The legacy objects of one key shape, and what a HEAD of a sample found."""

    shape: str
    rows: int = 0
    sampled: int = 0
    found: int = 0
    missing_keys: list[str] = field(default_factory=list)

    @property
    def missing(self) -> int:
        return len(self.missing_keys)


@dataclass
class BloblessRows:
    """Every blobless `File` row, sorted the way `legacy_bytes` will sort it.

    `local` rows are linked in place by the framework backfill; `s3` rows
    are copied by Build; `no_bytes` rows never had bytes of their own
    (`legacy_bytes.names_no_bytes`); `unreachable` rows name bytes Build
    cannot follow and become nodes with no blob (§14.1).
    """

    local: int = 0
    s3: int = 0
    no_bytes: int = 0
    unreachable: int = 0
    unreachable_rows: list[tuple[str, str]] = field(default_factory=list)
    # S3 rows whose fetch URL decodes to an empty key. Build records each as
    # missing bytes (`s3_copy._copy_one`), so they count as missing here.
    empty_path_rows: list[str] = field(default_factory=list)
    empty_path: int = 0


@dataclass
class PreflightReport:
    """Everything `check` prints, as data, so the dry run can embed it."""

    facts: dict[str, object]
    checks: list[Check]
    shapes: list[ShapeSample]
    blobless: BloblessRows
    sample_size: int

    @property
    def go(self) -> bool:
        return (
            all(check.ok for check in self.checks)
            and not any(shape.missing for shape in self.shapes)
            and not self.blobless.empty_path
        )

    @property
    def verdict(self) -> str:
        return GO if self.go else NO_GO

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "facts": dict(self.facts),
            "checks": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in self.checks],
            "s3_objects_by_shape": [
                {
                    "shape": s.shape,
                    "rows": s.rows,
                    "sampled": s.sampled,
                    "found": s.found,
                    "missing": s.missing,
                    "missing_keys": list(s.missing_keys),
                }
                for s in self.shapes
            ],
            "sample_per_shape": self.sample_size,
            "blobless_rows": {
                "local_linked_by_backfill": self.blobless.local,
                "legacy_s3_copied_by_build": self.blobless.s3,
                "naming_no_bytes": self.blobless.no_bytes,
                "unreachable": self.blobless.unreachable,
                "unreachable_rows": [
                    {"file": name, "file_url": url} for name, url in self.blobless.unreachable_rows
                ],
                "empty_object_path": self.blobless.empty_path,
                "empty_object_path_rows": list(self.blobless.empty_path_rows),
            },
        }

    def render(self) -> str:
        lines = [f"Drive Build preflight: {self.verdict}", ""]
        lines.append("Site")
        width = max(len(name) for name in self.facts)
        for name, value in self.facts.items():
            lines.append(f"  {name.ljust(width)}  {value}")
        lines.append("")
        lines.append("Checks")
        for check in self.checks:
            lines.append(f"  [{'ok' if check.ok else 'FAILED'}] {check.name}")
            if check.detail:
                lines.append(f"         {check.detail}")
        lines.append("")
        lines.append(f"Legacy S3 objects by key shape (HEAD on up to {self.sample_size} per shape)")
        if self.shapes:
            lines.extend(
                table(
                    ("shape", "rows", "sampled", "found", "missing"),
                    [(s.shape, s.rows, s.sampled, s.found, s.missing) for s in self.shapes],
                )
            )
            for shape in self.shapes:
                for key in shape.missing_keys:
                    lines.append(f"  missing: {key!r} ({shape.shape})")
        else:
            lines.append("  none: Drive Disk Settings has S3 off, or no File row carries a fetch URL")
        if self.blobless.empty_path:
            lines.append(
                f"  {self.blobless.empty_path} fetch URL(s) carry no object path; Build records each"
            )
            lines.append("  as missing bytes. First rows: " + ", ".join(self.blobless.empty_path_rows))
        lines.append("")
        lines.append("Blobless File rows (the whole table, not only Drive's)")
        rows = self.blobless
        lines.extend(
            table(
                ("what Build does", "rows"),
                [
                    ("linked in place by the framework backfill", rows.local),
                    ("copied from the legacy S3 layout", rows.s3),
                    ("nothing to carry: links, external URLs, assets", rows.no_bytes),
                    ("bytes Build cannot reach (node with no blob)", rows.unreachable),
                ],
            )
        )
        if rows.unreachable:
            lines.append("  Build carries on past these and lists them as missing bytes (§14.9).")
            for name, url in rows.unreachable_rows:
                lines.append(f"    {name}  {url}")
            if rows.unreachable > len(rows.unreachable_rows):
                lines.append(f"    ... and {rows.unreachable - len(rows.unreachable_rows)} more")
        lines.append("")
        lines.append(_summary(self))
        return "\n".join(lines)


def preflight(
    env,
    *,
    disk: DiskSettings | None = None,
    sample_size: int = SAMPLE_PER_SHAPE,
    batch_size: int = BUILD_BATCH_SIZE,
) -> PreflightReport:
    """Run every check against `env` and answer the report. Reads only."""
    disk = disk or DiskSettings()
    checks = [_gate_check(env)]
    blobless, keys_by_shape = _classify_blobless_rows(env, disk.root_folder, batch_size)
    shapes = _sample_shapes(env, keys_by_shape, sample_size, checks, headable=checks[0].ok)
    return PreflightReport(
        facts=_facts(env, disk),
        checks=checks,
        shapes=shapes,
        blobless=blobless,
        sample_size=sample_size,
    )


def check() -> None:
    """The `bench execute` entry point: print the verdict, write nothing."""
    try:
        env = BuildEnvironment.for_site()
    except BuildGateError as refusal:
        # `for_site` refuses a site below the upgrade floor before it wires
        # a port, so there is no environment to check further.
        print(f"Drive Build preflight: {NO_GO}\n\n  [FAILED] upgrade floor\n         {refusal}")
        return
    if not legacy_schema_present():
        print(f"Drive Build preflight: {NO_GO}\n\n{MIGRATED_ALREADY}")
        return
    print(preflight(env, disk=DiskSettings.for_site()).render())


# Printed by both read-only commands when the rows they read no longer exist.
MIGRATED_ALREADY = (
    "  [FAILED] legacy schema\n"
    "         `tabFile` has no `mime_type` column or `tabDrive Permission` is gone: this site has\n"
    "         already migrated (Cleanup dropped them) or never carried Drive. Nothing to rehearse."
)


def legacy_schema_present() -> bool:
    """Whether the legacy rows the census and preflight read still exist here."""
    return frappe.db.table_exists("Drive Permission") and frappe.db.has_column("File", "mime_type")


def _facts(env, disk: DiskSettings) -> dict[str, object]:
    config = env.storage.driver_config() or {}
    return {
        "storage_v2": "on" if env.storage.enabled() else "off",
        "storage_driver": env.storage.driver_name() or "(unset)",
        "storage_driver_config.bucket": config.get("bucket") or "(unset)",
        "storage_driver_config.endpoint_url": config.get("endpoint_url") or "(AWS default)",
        "Drive Disk Settings.enabled": "on" if env.legacy_s3.enabled else "off",
        "Drive Disk Settings.bucket": env.legacy_s3.bucket or "(unset)",
        "Drive Disk Settings.endpoint_url": env.legacy_s3.endpoint_url or "(AWS default)",
        "Drive Disk Settings.root_folder": disk.root_folder or "(unset)",
        "Drive Disk Settings.flat": "on" if disk.flat else "off",
        "Drive Disk Settings.thumbnail_prefix": disk.thumbnail_prefix or "(unset)",
    }


def _gate_check(env) -> Check:
    """§14.1's gate as one check: it already reads in the order that matters."""
    name = "storage v2 on; S3 driver, bucket and endpoint agree with Drive Disk Settings; bucket answers"
    try:
        check_gate(env)
    except BuildGateError as refusal:
        return Check(name, False, str(refusal))
    except Exception as error:  # a diagnostic tool reports, it does not crash
        return Check(name, False, f"{type(error).__name__}: {error}")
    return Check(name, True)


def _classify_blobless_rows(env, root_folder: str, batch_size: int) -> tuple[BloblessRows, dict]:
    """One pass over every blobless `File` row, sorted the way Build sorts it.

    Mirrors `legacy_bytes`: a row under a handled prefix is the backfill's
    (local) or the copy step's (S3); anything else is `names_no_bytes` or
    unreachable (`legacy_bytes.record_unreachable_rows`). The S3 rows are the
    exact population `s3_copy.copy_legacy_s3_objects` reads, and their keys
    are kept per shape for the sample.
    """
    prefixes = handled_prefixes(env)
    rows = BloblessRows()
    keys_by_shape: dict[str, list[str]] = {shape: [] for shape in KEY_SHAPES}
    after = ""
    previous_page = None
    while True:
        # An empty prefix tuple matches every blobless non-folder row.
        page = env.files.rows_outside((), after, batch_size)
        if not page:
            break
        if page[0].name == previous_page:
            raise RuntimeError(f"the File cursor stalled at {page[0].name!r}; refusing to loop")
        previous_page = page[0].name
        for row in page:
            url = row.file_url or ""
            if S3_URL_PREFIX in prefixes and url.startswith(S3_URL_PREFIX):
                rows.s3 += 1
                key = storage_key(url)
                if not key:
                    rows.empty_path += 1
                    if len(rows.empty_path_rows) < ROWS_LISTED:
                        rows.empty_path_rows.append(row.name)
                    continue
                keys_by_shape[key_shape(key, root_folder)].append(key)
            elif url.startswith(LOCAL_PREFIXES):
                rows.local += 1
            elif names_no_bytes(row):
                rows.no_bytes += 1
            else:
                rows.unreachable += 1
                if len(rows.unreachable_rows) < ROWS_LISTED:
                    rows.unreachable_rows.append((row.name, url))
        after = page[-1].name
        if len(page) < batch_size:
            break
    return rows, keys_by_shape


def _sample_shapes(env, keys_by_shape: dict, sample_size: int, checks: list[Check], *, headable: bool):
    """HEAD an evenly spaced sample of every shape; append a check on a raise."""
    shapes = [ShapeSample(shape, rows=len(keys)) for shape, keys in keys_by_shape.items() if keys]
    if not shapes or not env.legacy_s3.enabled:
        return shapes
    if not headable:
        checks.append(Check("legacy objects sampled", False, "skipped: the bucket check above failed"))
        return shapes
    try:
        bucket = env.bucket()
        for shape in shapes:
            for key in _evenly_spaced(keys_by_shape[shape.shape], sample_size):
                shape.sampled += 1
                if bucket.size(key) is None:
                    shape.missing_keys.append(key)
                else:
                    shape.found += 1
    except Exception as error:  # a diagnostic tool reports, it does not crash
        checks.append(Check("legacy objects sampled", False, f"HEAD raised {type(error).__name__}: {error}"))
    return shapes


def _evenly_spaced(keys: list[str], count: int) -> list[str]:
    """Up to `count` keys spread over the list, the same ones on every run.

    The list is in `File.name` order, which is roughly creation order, so an
    evenly spaced pick covers old and new uploads rather than the oldest 25.
    """
    if len(keys) <= count:
        return list(keys)
    step = (len(keys) - 1) / (count - 1)
    return [keys[round(index * step)] for index in range(count)]


def _summary(report: PreflightReport) -> str:
    if report.go:
        return "GO: every check passed and every sampled legacy object answered."
    reasons = [f"{check.name}: {check.detail}" for check in report.checks if not check.ok]
    for shape in report.shapes:
        if shape.missing:
            reasons.append(f"{shape.missing} of {shape.sampled} sampled objects missing for {shape.shape!r}")
    if report.blobless.empty_path:
        reasons.append(f"{report.blobless.empty_path} fetch URL(s) name no object")
    return "NO-GO:\n" + "\n".join(f"  - {reason}" for reason in reasons)


def table(header: tuple, rows: list[tuple]) -> list[str]:
    """Fixed-width columns: a column of numbers is right-aligned, text left."""
    cells = [tuple(str(cell) for cell in row) for row in (header, *rows)]
    widths = [max(len(row[column]) for row in cells) for column in range(len(header))]
    numeric = [all(isinstance(row[column], int) for row in rows) for column in range(len(header))]
    lines = []
    for row in cells:
        parts = [
            cell.rjust(widths[column]) if numeric[column] else cell.ljust(widths[column])
            for column, cell in enumerate(row)
        ]
        lines.append("  " + "  ".join(parts).rstrip())
    return lines
