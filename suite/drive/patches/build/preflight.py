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
2. Are the legacy objects there, and whole? Every blobless `File` row
   Build's copy step would read is grouped by key shape, and a
   deterministic sample of each shape is headed through the bucket port.
   An object is defective when it is missing, when its size differs from
   `File.file_size` (a truncated upload), or when the fetch URL names no
   object at all. Build carries on past every one of them, so the preflight
   is where they stop the migration.
3. Which blobless rows will Build never reach? The same classification
   `legacy_bytes.record_unreachable_rows` makes, so the operator sees the
   rows the §14.9 report would list as missing bytes before the run.

## Which defects block

A source bucket can have lost objects long before the migration, and no
run can bring them back. So a defect blocks only when nobody has looked at
it yet:

- A defect on a **Removed** row never blocks. §14.4 does not migrate the
  row, so its bytes are not needed. It is listed as not migrated.
- A defect on any other row (Active, or Trashed, which §14.4 migrates as a
  Trashed node) blocks, **unless** it is on the operator's list of accepted
  known defects. The report lists accepted defects apart from blocking
  ones, so the reader sees what was accepted and what is new.

The list is site data, kept beside the site and never in this repository:
it names real files. Site config `drive_preflight_accepted_defects` holds
its path, absolute or relative to the site directory (keep it under
`private/`). It is one JSON object:

    {"defects": [{"file": "<File name>", "key": "<object key>",
                  "defect": "missing" | "size_differs" | "no_object_path",
                  "note": "<why it is accepted, and who checked>"}]}

An entry accepts one defect on one row at one key, so the same row with a
different defect, or at a different key, blocks again. Every listed row is
headed on every run, sampled or not, so the report shows whether each entry
still describes the bucket; an entry that no longer matches a defect is
listed as stale, for the operator to remove. A list that cannot be read is
NO-GO, because Build would otherwise run on a policy nobody can see.

The sample catches a layout the bucket no longer serves. It does not prove
every object is there: `check(every_object=True)` heads them all.

Nothing here writes to the database, the bucket, or the disk. `check()`
prints and returns None, so `bench execute` prints nothing of its own.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

import frappe

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE, BuildEnvironment
from suite.drive.patches.build.gate import BuildGateError, check_gate
from suite.drive.patches.build.legacy import KEY_SHAPES, S3_URL_PREFIX, key_shape, storage_key
from suite.drive.patches.build.legacy_bytes import LOCAL_PREFIXES, handled_prefixes, names_no_bytes
from suite.drive.patches.build.ports import REMOVED

# Objects headed per key shape. Enough to catch a layout the bucket no longer
# serves; few enough that a check against a 150 GB bucket finishes in seconds.
SAMPLE_PER_SHAPE = 25

# How many unreachable rows and empty-path rows are printed. The counts
# above them stay exact.
ROWS_LISTED = 20

GO = "GO"
NO_GO = "NO-GO"

# Site config key naming the operator's list of accepted known defects.
ACCEPTED_DEFECTS_CONFIG_KEY = "drive_preflight_accepted_defects"

# What can be wrong with one legacy object.
MISSING = "missing"
SIZE_DIFFERS = "size_differs"
NO_OBJECT_PATH = "no_object_path"
DEFECT_KINDS = (MISSING, SIZE_DIFFERS, NO_OBJECT_PATH)

# What a defect means for the verdict.
BLOCKING = "blocking"
ACCEPTED = "accepted"
NOT_MIGRATED = "not_migrated"


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
    healthy: int = 0
    defective: int = 0


@dataclass(frozen=True)
class Defect:
    """One legacy object Build would not copy whole, and what it means."""

    file: str
    key: str
    kind: str
    status: str
    standing: str
    shape: str = ""
    file_size: int | None = None
    object_size: int | None = None
    note: str = ""

    def describe(self) -> str:
        what = {
            MISSING: "missing",
            SIZE_DIFFERS: f"size {self.object_size}, File.file_size {self.file_size}",
            NO_OBJECT_PATH: "fetch URL names no object",
        }[self.kind]
        where = f" ({self.shape})" if self.shape else ""
        return f"{self.file}  {self.status}  {self.key!r}{where}  {what}"


@dataclass(frozen=True)
class AcceptedDefect:
    """One entry of the operator's list: this defect on this row is known."""

    file: str
    key: str
    defect: str
    note: str = ""

    @property
    def identity(self) -> tuple[str, str, str]:
        return (self.file, self.key, self.defect)


class AcceptedDefectsError(ValueError):
    """The operator's list of accepted defects cannot be read."""


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
    # missing bytes (`s3_copy._copy_one`); each is also a `no_object_path`
    # defect.
    empty_path: int = 0


@dataclass
class PreflightReport:
    """Everything `check` prints, as data, so the dry run can embed it."""

    facts: dict[str, object]
    checks: list[Check]
    shapes: list[ShapeSample]
    blobless: BloblessRows
    sample_size: int | None
    defects: list[Defect] = field(default_factory=list)
    # Entries of the accepted list that no examined object matches.
    stale: list[AcceptedDefect] = field(default_factory=list)
    accepted_list: str = ""

    def with_standing(self, standing: str) -> list[Defect]:
        return [defect for defect in self.defects if defect.standing == standing]

    @property
    def go(self) -> bool:
        return all(check.ok for check in self.checks) and not self.with_standing(BLOCKING)

    @property
    def verdict(self) -> str:
        return GO if self.go else NO_GO

    def as_dict(self) -> dict:
        def defects(standing: str) -> list[dict]:
            return [
                {
                    "file": d.file,
                    "key": d.key,
                    "defect": d.kind,
                    "status": d.status,
                    "shape": d.shape,
                    "file_size": d.file_size,
                    "object_size": d.object_size,
                    **({"note": d.note} if standing == ACCEPTED else {}),
                }
                for d in self.with_standing(standing)
            ]

        return {
            "verdict": self.verdict,
            "facts": dict(self.facts),
            "checks": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in self.checks],
            "s3_objects_by_shape": [
                {
                    "shape": s.shape,
                    "rows": s.rows,
                    "sampled": s.sampled,
                    "healthy": s.healthy,
                    "defective": s.defective,
                }
                for s in self.shapes
            ],
            "sample_per_shape": self.sample_size,
            "accepted_defects_list": self.accepted_list or None,
            "object_defects": {
                BLOCKING: defects(BLOCKING),
                ACCEPTED: defects(ACCEPTED),
                NOT_MIGRATED: defects(NOT_MIGRATED),
                "stale_accepted_entries": [
                    {"file": e.file, "key": e.key, "defect": e.defect, "note": e.note} for e in self.stale
                ],
            },
            "blobless_rows": {
                "local_linked_by_backfill": self.blobless.local,
                "legacy_s3_copied_by_build": self.blobless.s3,
                "naming_no_bytes": self.blobless.no_bytes,
                "unreachable": self.blobless.unreachable,
                "unreachable_rows": [
                    {"file": name, "file_url": url} for name, url in self.blobless.unreachable_rows
                ],
                "empty_object_path": self.blobless.empty_path,
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
        sampled = "every object" if self.sample_size is None else f"up to {self.sample_size} per shape"
        lines.append(f"Legacy S3 objects by key shape (HEAD on {sampled}, and on every accepted defect)")
        if self.shapes:
            lines.extend(
                table(
                    ("shape", "rows", "sampled", "healthy", "defective"),
                    [(s.shape, s.rows, s.sampled, s.healthy, s.defective) for s in self.shapes],
                )
            )
        else:
            lines.append("  none: Drive Disk Settings has S3 off, or no File row carries a fetch URL")
        lines.extend(self._defect_lines())
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

    def _defect_lines(self) -> list[str]:
        sections = (
            (BLOCKING, "Blocking defects: not on the accepted list"),
            (ACCEPTED, f"Accepted known defects, from {self.accepted_list or '(no list)'}"),
            (NOT_MIGRATED, "Defects on Removed rows: not migrated, so they do not block"),
        )
        lines = []
        for standing, heading in sections:
            found = self.with_standing(standing)
            if not found:
                continue
            lines.extend(["", f"{heading} ({len(found)})"])
            for defect in found[:ROWS_LISTED]:
                lines.append(f"  {defect.describe()}")
                if defect.note:
                    lines.append(f"      note: {defect.note}")
            if len(found) > ROWS_LISTED:
                lines.append(f"  ... and {len(found) - ROWS_LISTED} more")
        if self.stale:
            lines.extend(
                [
                    "",
                    f"Accepted-list entries no object matches: remove them from the list ({len(self.stale)})",
                ]
            )
            for entry in self.stale[:ROWS_LISTED]:
                lines.append(f"  {entry.file}  {entry.key!r}  {entry.defect}")
            if len(self.stale) > ROWS_LISTED:
                lines.append(f"  ... and {len(self.stale) - ROWS_LISTED} more")
        return lines


def preflight(
    env,
    *,
    disk: DiskSettings | None = None,
    sample_size: int | None = SAMPLE_PER_SHAPE,
    batch_size: int = BUILD_BATCH_SIZE,
    accepted_defects: Path | None = None,
) -> PreflightReport:
    """Run every check against `env` and answer the report. Reads only.

    `sample_size=None` heads every legacy object instead of a sample.
    `accepted_defects` is the operator's list (see the module docstring).
    """
    disk = disk or DiskSettings()
    checks = [_gate_check(env)]
    accepted = _accepted_entries(accepted_defects, checks)
    blobless, by_shape, empty_paths = _classify_blobless_rows(env, disk.root_folder, batch_size)
    listed = {entry.file for entry in accepted.values()}
    shapes, examined = _sample_shapes(env, by_shape, sample_size, listed, checks, headable=checks[0].ok)
    defects = [_defect(row, size, accepted) for row, size in examined + empty_paths]
    found = [defect for defect in defects if defect is not None]
    # Only a pass that headed every listed row can say an entry is stale.
    headed = all(check.ok for check in checks if check.name == SAMPLE_CHECK)
    seen = {(defect.file, defect.key, defect.kind) for defect in found}
    stale = [entry for identity, entry in accepted.items() if identity not in seen] if headed else []
    return PreflightReport(
        facts=_facts(env, disk),
        checks=checks,
        shapes=shapes,
        blobless=blobless,
        sample_size=sample_size,
        defects=sorted(found, key=lambda defect: (defect.file, defect.key)),
        stale=stale,
        accepted_list=str(accepted_defects or ""),
    )


def check(every_object: bool = False) -> None:
    """The `bench execute` entry point: print the verdict, write nothing.

        bench --site <site> execute suite.drive.patches.build.preflight.check \\
            --kwargs "{'every_object': True}"

    heads every legacy object instead of a sample.
    """
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
    report = preflight(
        env,
        disk=DiskSettings.for_site(),
        sample_size=None if every_object else SAMPLE_PER_SHAPE,
        accepted_defects=accepted_defects_path(),
    )
    print(report.render())


def accepted_defects_path() -> Path | None:
    """The site's list of accepted known defects, from site config, if one is set."""
    value = frappe.conf.get(ACCEPTED_DEFECTS_CONFIG_KEY)
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else Path(frappe.get_site_path()).resolve() / path


def load_accepted_defects(path: Path) -> list[AcceptedDefect]:
    """Read and validate one list. Refuses anything it would have to guess at."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise AcceptedDefectsError(f"cannot read {path}: {error.strerror or error}") from error
    except ValueError as error:
        raise AcceptedDefectsError(f"{path} is not valid JSON: {error}") from error
    if (
        not isinstance(document, dict)
        or set(document) != {"defects"}
        or not isinstance(document["defects"], list)
    ):
        raise AcceptedDefectsError(f'{path} must be one object with a "defects" list and nothing else')
    entries = []
    seen = set()
    for index, item in enumerate(document["defects"]):
        where = f"{path}, entry {index + 1}"
        if not isinstance(item, dict) or not {"file", "key", "defect"} <= set(item) <= {
            "file",
            "key",
            "defect",
            "note",
        }:
            raise AcceptedDefectsError(f'{where}: needs "file", "key" and "defect", and may add "note"')
        if not all(isinstance(item.get(name, ""), str) for name in ("file", "key", "defect", "note")):
            raise AcceptedDefectsError(f"{where}: every value must be a string")
        if not item["file"]:
            raise AcceptedDefectsError(f'{where}: "file" is empty')
        if item["defect"] not in DEFECT_KINDS:
            raise AcceptedDefectsError(f'{where}: "defect" must be one of {", ".join(DEFECT_KINDS)}')
        entry = AcceptedDefect(item["file"], item["key"], item["defect"], item.get("note", ""))
        if entry.identity in seen:
            raise AcceptedDefectsError(f"{where}: repeats an earlier entry")
        seen.add(entry.identity)
        entries.append(entry)
    return entries


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


@dataclass(frozen=True)
class _Candidate:
    """One blobless legacy S3 row, reduced to what a defect is judged by."""

    name: str
    key: str
    shape: str
    status: str
    file_size: int | None


SAMPLE_CHECK = "legacy objects sampled"


def _accepted_entries(path: Path | None, checks: list[Check]) -> dict[tuple[str, str, str], AcceptedDefect]:
    """The list as a lookup; a list that cannot be read is a failed check."""
    if path is None:
        return {}
    name = "accepted known defects list can be read"
    try:
        entries = load_accepted_defects(path)
    except AcceptedDefectsError as refusal:
        checks.append(Check(name, False, str(refusal)))
        return {}
    checks.append(Check(name, True, f"{len(entries)} entries in {path}"))
    return {entry.identity: entry for entry in entries}


def _classify_blobless_rows(env, root_folder: str, batch_size: int):
    """One pass over every blobless `File` row, sorted the way Build sorts it.

    Mirrors `legacy_bytes`: a row under a handled prefix is the backfill's
    (local) or the copy step's (S3); anything else is `names_no_bytes` or
    unreachable (`legacy_bytes.record_unreachable_rows`). The S3 rows are the
    exact population `s3_copy.copy_legacy_s3_objects` reads, and they are
    kept per shape for the sample. A row whose fetch URL names no object
    needs no HEAD to be a defect, so every one of them is returned.
    """
    prefixes = handled_prefixes(env)
    rows = BloblessRows()
    by_shape: dict[str, list[_Candidate]] = {shape: [] for shape in KEY_SHAPES}
    empty_paths: list[tuple[_Candidate, int | None]] = []
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
                shape = key_shape(key, root_folder) if key else ""
                candidate = _Candidate(row.name, key, shape, row.status or "Active", row.file_size)
                if not key:
                    rows.empty_path += 1
                    empty_paths.append((candidate, None))
                    continue
                by_shape[shape].append(candidate)
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
    return rows, by_shape, empty_paths


def _sample_shapes(env, by_shape: dict, sample_size: int | None, listed: set[str], checks, *, headable: bool):
    """HEAD an evenly spaced sample of every shape, and every listed row.

    Answers the shape table and every `(row, object size)` pair headed. A
    listed row is headed whether or not the sample picked it, so the report
    can confirm or retire every accepted entry. A raise is a failed check.
    """
    shapes = [ShapeSample(shape, rows=len(rows)) for shape, rows in by_shape.items() if rows]
    examined: list[tuple[_Candidate, int | None]] = []
    if not shapes or not env.legacy_s3.enabled:
        return shapes, examined
    if not headable:
        checks.append(Check(SAMPLE_CHECK, False, "skipped: the bucket check above failed"))
        return shapes, examined
    sizes: dict[str, int | None] = {}
    try:
        bucket = env.bucket()

        def head(candidate: _Candidate) -> int | None:
            if candidate.key not in sizes:
                sizes[candidate.key] = bucket.size(candidate.key)
            return sizes[candidate.key]

        for shape in shapes:
            rows = by_shape[shape.shape]
            sample = rows if sample_size is None else _evenly_spaced(rows, sample_size)
            picked = {candidate.name for candidate in sample}
            for candidate in sample:
                size = head(candidate)
                shape.sampled += 1
                if _defect_kind(candidate, size) is None:
                    shape.healthy += 1
                else:
                    shape.defective += 1
                examined.append((candidate, size))
            for candidate in rows:
                if candidate.name in listed and candidate.name not in picked:
                    examined.append((candidate, head(candidate)))
    except Exception as error:  # a diagnostic tool reports, it does not crash
        checks.append(Check(SAMPLE_CHECK, False, f"HEAD raised {type(error).__name__}: {error}"))
    return shapes, examined


def _defect_kind(candidate: _Candidate, size: int | None) -> str | None:
    if not candidate.key:
        return NO_OBJECT_PATH
    if size is None:
        return MISSING
    # A row with no recorded size has nothing to be measured against.
    if candidate.file_size is not None and int(candidate.file_size) != size:
        return SIZE_DIFFERS
    return None


def _defect(candidate: _Candidate, size: int | None, accepted: dict) -> Defect | None:
    """Judge one headed object: no defect, or one with its standing."""
    kind = _defect_kind(candidate, size)
    if kind is None:
        return None
    entry = accepted.get((candidate.name, candidate.key, kind))
    if candidate.status == REMOVED:
        standing = NOT_MIGRATED
    elif entry is not None:
        standing = ACCEPTED
    else:
        standing = BLOCKING
    return Defect(
        file=candidate.name,
        key=candidate.key,
        kind=kind,
        status=candidate.status,
        standing=standing,
        shape=candidate.shape,
        file_size=candidate.file_size,
        object_size=size,
        note=entry.note if entry is not None else "",
    )


def _evenly_spaced(items: list, count: int) -> list:
    """Up to `count` items spread over the list, the same ones on every run.

    The list is in `File.name` order, which is roughly creation order, so an
    evenly spaced pick covers old and new uploads rather than the oldest 25.
    """
    if len(items) <= count:
        return list(items)
    step = (len(items) - 1) / (count - 1)
    return [items[round(index * step)] for index in range(count)]


def _summary(report: PreflightReport) -> str:
    accepted = len(report.with_standing(ACCEPTED))
    if report.go:
        tail = f", {accepted} of them accepted known defects" if accepted else ""
        return f"GO: every check passed, and no headed legacy object has a defect that blocks{tail}."
    reasons = [f"{check.name}: {check.detail}" for check in report.checks if not check.ok]
    blocking = report.with_standing(BLOCKING)
    if blocking:
        kinds = {kind: sum(1 for defect in blocking if defect.kind == kind) for kind in DEFECT_KINDS}
        listed = ", ".join(f"{count} {kind}" for kind, count in kinds.items() if count)
        reasons.append(f"{len(blocking)} legacy object defect(s) not on the accepted list ({listed})")
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
