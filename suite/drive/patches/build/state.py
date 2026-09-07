"""Build's durable record, saved under the site's private directory.

Build is resumable, so the numbers the final report prints (§14.9) cannot
live in memory. Every step writes its result here, and the report step
reads it back. The file is rewritten atomically, so a run killed mid-write
leaves the previous version readable.

Two kinds of number live in `StoragePreparation`:

- **cumulative** — `CUMULATIVE_FIELDS`. Each object is copied once ever, so
  a resumed run adds to the total instead of restarting it. These totals
  exist nowhere else, which is why an unreadable record is quarantined
  rather than overwritten.
- **per run** — everything else. A rerun recomputes them, so bytes that
  came back between two runs stop being reported as missing.
"""

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

STATE_FILENAME = "drive-build-state.json"
STATE_VERSION = 1

CUMULATIVE_FIELDS = frozenset(
    {
        "backfill_linked",
        "backfill_blobs_created",
        "s3_objects_copied",
        "s3_bytes_copied",
        "s3_objects_reused",
        # A minted link is minted once ever (§14.5): the second run finds the
        # `$LINK:` grant on the node and leaves it alone. `links_minted` is
        # the number owners must be told about, so it may not reset to zero
        # on the rerun that finishes an interrupted migration.
        "links_minted",
    }
)

# `missing_bytes` is held whole in memory and rewritten after every batch, so
# a site with a broken bucket must not turn the record into a multi-GB file.
# Past this many entries only the count keeps rising.
MISSING_BYTES_KEPT = 10000

# The same ceiling, for every other evidence list Build keeps. A record that
# cannot be written is worse than one that lists only the first ten thousand
# renames, and every counter beside these lists stays exact.
SAMPLE_KEPT = 10000


@dataclass
class MissingBytes:
    """A `File` row that has no blob because its bytes could not be read."""

    file: str
    file_url: str
    reason: str


@dataclass
class StoragePreparation:
    """The result of §14.2 steps 1 to 3."""

    completed: bool = False
    backfill_linked: int = 0
    backfill_blobs_created: int = 0
    s3_rows_seen: int = 0
    s3_objects_copied: int = 0
    s3_bytes_copied: int = 0
    s3_objects_reused: int = 0
    s3_objects_missing: int = 0
    missing_bytes: list[MissingBytes] = field(default_factory=list)
    missing_bytes_total: int = 0

    def record_missing(self, entry: MissingBytes) -> None:
        """Count every row with no reachable bytes; keep a bounded sample.

        The count is the number the report must not understate. The list is
        the operator's evidence, and past `MISSING_BYTES_KEPT` it stops
        growing so one broken bucket cannot make the record unwritable."""
        self.missing_bytes_total += 1
        if len(self.missing_bytes) < MISSING_BYTES_KEPT:
            self.missing_bytes.append(entry)

    def begin_run(self) -> None:
        """Clear the per-run numbers; keep the cumulative ones."""
        blank = StoragePreparation()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> StoragePreparation:
        known = {f for f in cls.__dataclass_fields__ if f != "missing_bytes"}
        prep = cls(**{k: v for k, v in data.items() if k in known})
        prep.missing_bytes = [
            MissingBytes(**{k: v for k, v in row.items() if k in MissingBytes.__dataclass_fields__})
            for row in data.get("missing_bytes") or []
            if isinstance(row, dict)
        ]
        return prep


@dataclass
class SkippedRow:
    """A legacy `File` row Build read and did not turn into a node."""

    file: str
    reason: str


@dataclass
class TitleRename:
    """A node whose title moved so an Active sibling group stayed unique."""

    node: str
    was: str
    now: str


def _rebuild(cls, rows) -> list:
    """Rebuild a list of sample dataclasses, ignoring anything unrecognised."""
    known = cls.__dataclass_fields__
    return [
        cls(**{k: v for k, v in row.items() if k in known}) for row in rows or [] if isinstance(row, dict)
    ]


@dataclass
class TreeConversion:
    """The result of §14.2 steps 4 and 5: root pairs and the node trees.

    Every number here is recomputed by a rerun, because each is decided from
    the *source* rows rather than from what the run happened to write. A
    second run over a finished site skips every insert and still reports the
    same `blobless_nodes` and `title_renames`, which is what §14.9 needs: it
    prints the state of the migration, not the diary of one attempt.
    """

    completed: bool = False
    roots_seen: int = 0
    roots_created: int = 0
    roots_repaired: int = 0
    roots_already_complete: int = 0
    roots_archived: int = 0
    roots_skipped: int = 0
    nodes_written: int = 0
    nodes_already_present: int = 0
    # §14.9, decided per source row so a rerun answers the same.
    blobless_nodes: int = 0
    title_renames: int = 0
    removed_rows_skipped: int = 0
    broken_chains_skipped: int = 0
    # Not in §14.9. The spec fixes a depth cap of 40 and a `varchar(500)`
    # path and asks for both to be validated against real migrated ids
    # (§3.1); it names no behaviour for a tree that exceeds them. Build
    # skips the subtree and says so rather than writing a row the engine
    # would refuse on its next save.
    over_capacity_skipped: int = 0
    invalid_parent_skipped: int = 0
    # A row whose target shape the engine would refuse on its next save: a
    # link node with no URL, or one whose URL passes `varchar(500)`.
    unsaveable_skipped: int = 0
    # Reachable, not Removed, and still without a node after the walk. Zero
    # on a healthy site. It also carries the descendants of every subtree
    # the three counters above refused, so read it with them: what is left
    # over after those is a defect in the walk, and the report must not be
    # silent about it.
    unmigrated_reachable: int = 0
    # The §3.1 measurement: what the target database actually has to hold.
    # Measured from the source rows, so a site that needed depth 44 reports
    # 44 rather than the cap Build stopped at.
    max_depth: int = 0
    max_path_length: int = 0
    max_id_length: int = 0
    renames: list[TitleRename] = field(default_factory=list)
    renames_total: int = 0
    skipped: list[SkippedRow] = field(default_factory=list)
    skipped_total: int = 0

    def record_rename(self, entry: TitleRename) -> None:
        self.title_renames += 1
        self.renames_total += 1
        if len(self.renames) < SAMPLE_KEPT:
            self.renames.append(entry)

    def record_skip(self, entry: SkippedRow) -> None:
        """Keep a bounded sample; the counters above stay exact."""
        self.skipped_total += 1
        if len(self.skipped) < SAMPLE_KEPT:
            self.skipped.append(entry)

    def begin_run(self) -> None:
        blank = TreeConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> TreeConversion:
        samples = {"renames", "skipped"}
        known = {f for f in cls.__dataclass_fields__ if f not in samples}
        tree = cls(**{k: v for k, v in data.items() if k in known})
        tree.renames = _rebuild(TitleRename, data.get("renames"))
        tree.skipped = _rebuild(SkippedRow, data.get("skipped"))
        return tree


# §14.9's `grant_rows_dropped`, spelled exactly as the report prints it.
DROP_REASONS = ("dead_principal", "unmigrated_entity", "no_flags", "root_guardrail")


def _blank_drops() -> dict:
    return dict.fromkeys(DROP_REASONS, 0)


@dataclass
class GrantConversion:
    """The result of §14.2 step 6: `Drive Permission` and Sheet `DocShare`.

    `links_minted` is the one cumulative number. Everything else is decided
    from the source rows and recomputed by a rerun.
    """

    completed: bool = False
    permission_rows_seen: int = 0
    permission_pairs: int = 0
    grants_written: int = 0
    grants_already_present: int = 0
    links_minted: int = 0
    # A `user = ""` row above EDIT would mint a link the engine refuses
    # (§5.9 refusal 9). Build clamps it and counts, so the report can say
    # how many links sit one level below the row they came from.
    links_clamped: int = 0
    public_grants_written: int = 0
    composite_rows_dropped: int = 0
    docshare_rows_seen: int = 0
    docshare_rows_dropped: int = 0
    docshare_dropped_by_reason: dict = field(default_factory=_blank_drops)
    grant_rows_dropped: dict = field(default_factory=_blank_drops)
    # The §3.2 floor: a Shared root node whose legacy row mapped to nothing
    # still has to carry a `$GENERAL` grant.
    shared_anchors_written: int = 0
    # Node ids only. The tokens live in `Drive Grant.principal`, and a
    # migration record on disk is not the place for a second copy of a
    # secret that authorises access.
    link_nodes: list[str] = field(default_factory=list)

    def drop(self, reason: str) -> None:
        self.grant_rows_dropped[reason] = self.grant_rows_dropped.get(reason, 0) + 1

    def drop_docshare(self, reason: str) -> None:
        self.docshare_rows_dropped += 1
        self.docshare_dropped_by_reason[reason] = self.docshare_dropped_by_reason.get(reason, 0) + 1

    def record_link(self, node: str) -> None:
        self.links_minted += 1
        if len(self.link_nodes) < SAMPLE_KEPT:
            self.link_nodes.append(node)

    def begin_run(self) -> None:
        blank = GrantConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> GrantConversion:
        known = {f for f in cls.__dataclass_fields__ if f != "link_nodes"}
        grants = cls(**{k: v for k, v in data.items() if k in known})
        grants.link_nodes = [row for row in data.get("link_nodes") or [] if isinstance(row, str)]
        grants.grant_rows_dropped = {**_blank_drops(), **(grants.grant_rows_dropped or {})}
        grants.docshare_dropped_by_reason = {**_blank_drops(), **(grants.docshare_dropped_by_reason or {})}
        return grants


class BuildState:
    """The JSON document at `<site>/private/drive-build-state.json`."""

    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def for_site(cls) -> BuildState:
        import frappe

        return cls(Path(frappe.get_site_path("private", STATE_FILENAME)))

    def load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return {"version": STATE_VERSION}
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Unreadable content. A read error (EIO, EACCES) is not: losing
            # the cumulative totals to a transient fault would make the
            # report understate a migration that really did run, so it
            # propagates and the run stops instead.
            data = None
        if not isinstance(data, dict):
            self._quarantine()
            return {"version": STATE_VERSION}
        return data

    def save(self, data: dict) -> None:
        data = {**data, "version": STATE_VERSION}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self._temp_path()
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)
        self._sync_directory()

    def _temp_path(self) -> Path:
        """Per process: a second run writing the same `.tmp` could interleave
        and have `os.replace` promote a half-written file."""
        return self.path.with_suffix(f"{self.path.suffix}.{os.getpid()}.tmp")

    def storage(self) -> StoragePreparation:
        stored = self.load().get("storage")
        return StoragePreparation.from_dict(stored if isinstance(stored, dict) else {})

    def put_storage(self, prep: StoragePreparation) -> None:
        self.save({**self.load(), "storage": prep.as_dict()})

    def tree(self) -> TreeConversion:
        stored = self.load().get("tree")
        return TreeConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_tree(self, tree: TreeConversion) -> None:
        self.save({**self.load(), "tree": tree.as_dict()})

    def grants(self) -> GrantConversion:
        stored = self.load().get("grants")
        return GrantConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_grants(self, grants: GrantConversion) -> None:
        self.save({**self.load(), "grants": grants.as_dict()})

    def _quarantine(self) -> None:
        """Move an unreadable record aside instead of overwriting it.

        The cumulative copy totals live only here, so a silent reset would
        make the report understate a migration that really did run."""
        if not self.path.exists():
            return
        stamp = time.strftime("%Y%m%d-%H%M%S")
        spoiled = self.path.with_name(f"{self.path.name}.corrupt-{stamp}-{os.getpid()}")
        try:
            os.replace(self.path, spoiled)
            self._sync_directory()
        except OSError:
            pass

    def _sync_directory(self) -> None:
        """fsync the directory, so the rename itself survives a power loss."""
        try:
            fd = os.open(self.path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
