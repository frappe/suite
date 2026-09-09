"""Build's durable record, saved under the site's private directory.

Build is resumable, so the numbers the final report prints (§14.9) cannot
live in memory. Every step writes its result here, and the report step
reads it back. The file is rewritten atomically, so a run killed mid-write
leaves the previous version readable.

Two kinds of field live in the conversion records:

- **cumulative** — `CUMULATIVE_FIELDS`. Each object is copied, deleted, or
  purged once ever, so a resumed run adds to the total instead of restarting
  it. These totals exist nowhere else, which is why an unreadable record is
  quarantined rather than overwritten.
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
        # Governed DocShare rows and content documents whose every File is
        # Removed are deleted once. A later pass cannot derive these totals
        # from source rows that no longer exist.
        "docshare_rows_deleted",
        "removed_file_documents",
        "removed_file_docs",
        "removed_file_documents_purged",
        # Write-ahead intents for a grant batch. They survive begin_run so a
        # kill on either side of the database commit can be reconciled from
        # the target table without counting a link twice or losing it.
        "pending_link_nodes",
        # §14.9 counts the Personal Roots Build had to create for a
        # reservation owner. A root is created once ever, and no later run
        # can tell a root Build minted from one the site already had, so the
        # total may not reset on the rerun that finishes an interrupted
        # migration. `pending_reservation_roots` is its write-ahead ledger,
        # for the same reason `pending_link_nodes` is one.
        "personal_roots_created_for_reservations",
        "pending_reservation_roots",
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

    `links_minted` and `docshare_rows_deleted` are cumulative.
    `pending_link_nodes` is the link counter's write-ahead ledger across an
    interrupted database commit. Everything else is decided from source rows
    Build preserves and recomputed by a rerun.
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
    # Not in §14.9. A Sheet `DocShare` row is deleted once its grant exists,
    # because §5.13's read guards fail closed on a surviving one and
    # `validate_content_registry` refuses the migration while any governed
    # doctype still carries a share. Cumulative because a rerun cannot recount
    # a source row Build already deleted.
    docshare_rows_deleted: int = 0
    grant_rows_dropped: dict = field(default_factory=_blank_drops)
    # The §3.2 floor: a Shared root node whose legacy row mapped to nothing
    # still has to carry a `$GENERAL` grant.
    shared_anchors_written: int = 0
    # Node ids only. The tokens live in `Drive Grant.principal`, and a
    # migration record on disk is not the place for a second copy of a
    # secret that authorises access.
    link_nodes: list[str] = field(default_factory=list)
    # A short write-ahead ledger, at most one grant batch. It is persisted
    # before that batch is inserted, then cleared only after the database
    # commit and the cumulative counter advance are durably recorded.
    pending_link_nodes: list[str] = field(default_factory=list)

    def drop(self, reason: str) -> None:
        self.grant_rows_dropped[reason] = self.grant_rows_dropped.get(reason, 0) + 1

    def drop_docshare(self, reason: str) -> None:
        self.docshare_rows_dropped += 1
        self.docshare_dropped_by_reason[reason] = self.docshare_dropped_by_reason.get(reason, 0) + 1

    def record_link(self, node: str) -> None:
        self.links_minted += 1
        if len(self.link_nodes) < SAMPLE_KEPT:
            self.link_nodes.append(node)

    def prepare_links(self, nodes) -> None:
        """Describe links the next database commit intends to publish."""
        known = set(self.pending_link_nodes)
        for node in nodes:
            if node not in known:
                self.pending_link_nodes.append(node)
                known.add(node)

    def finish_links(self, nodes) -> None:
        """Count committed intents exactly once, then remove their ledger rows."""
        finishing = set(nodes)
        pending = set(self.pending_link_nodes)
        for node in sorted(finishing & pending):
            self.record_link(node)
        self.pending_link_nodes = [node for node in self.pending_link_nodes if node not in finishing]

    def begin_run(self) -> None:
        blank = GrantConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> GrantConversion:
        lists = {"link_nodes", "pending_link_nodes"}
        known = {f for f in cls.__dataclass_fields__ if f not in lists}
        grants = cls(**{k: v for k, v in data.items() if k in known})
        grants.link_nodes = [row for row in data.get("link_nodes") or [] if isinstance(row, str)]
        grants.pending_link_nodes = [
            row for row in data.get("pending_link_nodes") or [] if isinstance(row, str)
        ]
        grants.grant_rows_dropped = {**_blank_drops(), **(grants.grant_rows_dropped or {})}
        grants.docshare_dropped_by_reason = {**_blank_drops(), **(grants.docshare_dropped_by_reason or {})}
        return grants


@dataclass
class ContentIssue:
    """One bounded refusal or disagreement from ticket 28."""

    source: str
    reason: str
    phase: str = ""
    cumulative: bool = False


@dataclass
class RemovedFileDocument:
    """A content document Build left without a node, its `File` being Removed."""

    doctype: str
    name: str
    file: str


@dataclass
class LegacyComment:
    """A legacy `Drive Comment` child row Build could not give a node."""

    name: str
    file: str


@dataclass
class RelocatedMediaNode:
    """A deck's media node the legacy tree had filed somewhere else."""

    deck: str
    node: str
    was_under: str


@dataclass
class ContentConversion:
    """The durable outcome of §14.2 steps 7, 8, and 10."""

    completed: bool = False
    history_existing_complete: bool = False
    history_completed: bool = False
    history_deferred: int = 0
    slides_completed: bool = False
    slides_deferred: int = 0
    links_completed: bool = False
    documents_seen: int = 0
    versions_seen: int = 0
    comments_seen: int = 0
    # Not in §14.9, and owned by the history phase like `comments_seen` above.
    # §14.6 makes the Yjs comment id the thread `anchor`; §3.6 keeps that
    # anchor opaque and leaves `name` to `autoname: hash`. A Writer Document
    # copied with its source's `ycomments` therefore brings ids another node
    # already stored, and `name` is a primary key. Those rows take a name
    # derived from `(node, id)` and keep the source id in the anchor. These
    # count them, per pass: a rerun derives the same names and counts the
    # same rows without writing any.
    comment_threads_renamed: int = 0
    comments_renamed: int = 0
    trash_disagreements: int = 0
    orphan_content_docs_adopted: int = 0
    versions_to_thin: int = 0
    media_nodes_created: int = 0
    media_duplicates_collapsed: int = 0
    # Not in §14.9, and owned by the slides phase like the counters above it.
    # §14.7's `media_duplicates_collapsed` counts a deck's own `File` rows
    # that share one node. This counts the extra `File Blob` rows a borrowed
    # reference named on a template deck, which are nobody's own rows, so the
    # two numbers stay apart.
    borrowed_duplicates_collapsed: int = 0
    # Not in §14.9, and owned by the slides phase. A legacy media reference
    # can outlive the File row that used to explain it. The body stays
    # unchanged, while this counter and its issue keep the unresolved value
    # visible in the evidence report.
    media_references_missing_file_rows: int = 0
    slide_elements_rewritten: int = 0
    # Not in §14.9 either, and owned by the slides phase. §14.7's
    # `slide_elements_rewritten` counts the bodies whose media references
    # became node ids. This counts the legacy bodies stored as a JSON string
    # holding the JSON array, which Build decodes twice and stores back as a
    # plain array. A rerun reads a list and counts none.
    slide_elements_repaired: int = 0
    deck_previews_created: int = 0
    template_nodes_created: int = 0
    # Not in §14.9, and owned by the templates phase like the counter above
    # it. §14.7's `template_nodes_created` counts the nodes step 8 mints under
    # `Templates`. This counts the template decks that already had a §14.4
    # node from a legacy `File` row and were flagged where they stand instead.
    # A rerun meets the flag, the grant, and the link already written, so it
    # counts none.
    template_nodes_adopted: int = 0
    writer_templates_converted: int = 0
    blobless_nodes: int = 0
    title_renames: int = 0
    template_title_renames: int = 0
    link_title_renames: int = 0
    docshare_rows_dropped: int = 0
    # Not in §14.9. The step-6 counter's twin, for the rows step 10 owns:
    # `Writer Document` and `Presentation` shares, and the history-table
    # shares it drops and counts. Cumulative because a rerun cannot recount a
    # source row Build already deleted.
    docshare_rows_deleted: int = 0
    # Not in §14.9. §14.4 skips a `File` row whose status is `Removed`, so a
    # content document whose only `File` row is Removed has no node and no
    # step can mint one. The spec names no behaviour for the document left
    # behind, so Build skips it too and says which ones: its history and its
    # comments are not ported. Step 10 owns the census, because it is the
    # only phase that walks all three content doctypes. The census is
    # cumulative because the same pass purges those documents.
    removed_file_documents: int = 0
    removed_file_docs: list[RemovedFileDocument] = field(default_factory=list)
    # Not in §14.9 either. §5.13 has no "document without a node" state, so a
    # document whose every `File` row is Removed cannot stay: `Drive` would
    # refuse to govern the doctype and no request could read the row. It is
    # purged through the app's own `on_purge`, which takes the satellites
    # with it. A rerun finds no such document, so the count is cumulative.
    removed_file_documents_purged: int = 0
    # Not in §14.9 either, and owned by no phase: `begin_phase` must not
    # reset them. Every other counter is recomputed from sources Build never
    # writes, so a rerun reproduces it. The first two count rows Build
    # rewrote in the reused `Drive Comment` table, which no later pass sees
    # as legacy, so they are cumulative. `port_legacy_comments` recounts the
    # third itself: those rows stay legacy, and every sweep meets them.
    legacy_comments_superseded: int = 0
    legacy_comments_ported: int = 0
    legacy_comments_unported: int = 0
    legacy_comment_rows: list[LegacyComment] = field(default_factory=list)
    # Not in §14.9, and owned by no phase either. §14.4 gave a media `File`
    # reachable from a Drive root a node under its own `folder`, and §14.7
    # makes the same row a child of the deck node. Step 8 moves the node it
    # finds, so the next pass meets it already placed and moves nothing. The
    # counter is cumulative for that reason, like the two comment rewrites
    # above, and `begin_phase` must not reset it.
    media_nodes_relocated: int = 0
    relocated_media_nodes: list[RelocatedMediaNode] = field(default_factory=list)
    report_at: str | None = None
    issues: list[ContentIssue] = field(default_factory=list)
    issues_total: int = 0
    issues_by_phase: dict[str, int] = field(default_factory=dict)
    cumulative_issues_by_phase: dict[str, int] = field(default_factory=dict)

    def record_removed_file(self, entry: RemovedFileDocument) -> None:
        """Keep a bounded list; the counter above stays exact."""
        self.removed_file_documents += 1
        if len(self.removed_file_docs) < SAMPLE_KEPT:
            self.removed_file_docs.append(entry)

    def record_legacy_comment(self, entry: LegacyComment) -> None:
        """Keep a bounded list; the counter above stays exact."""
        self.legacy_comments_unported += 1
        if len(self.legacy_comment_rows) < SAMPLE_KEPT:
            self.legacy_comment_rows.append(entry)

    def record_relocated_media(self, entry: RelocatedMediaNode) -> None:
        """Keep a bounded list; the counter above stays exact."""
        self.media_nodes_relocated += 1
        if len(self.relocated_media_nodes) < SAMPLE_KEPT:
            self.relocated_media_nodes.append(entry)

    def record_issue(self, source: str, reason: str, *, phase: str = "", cumulative: bool = False) -> None:
        self.issues_total += 1
        self.issues_by_phase[phase] = self.issues_by_phase.get(phase, 0) + 1
        if cumulative:
            self.cumulative_issues_by_phase[phase] = self.cumulative_issues_by_phase.get(phase, 0) + 1
        if len(self.issues) < SAMPLE_KEPT:
            self.issues.append(ContentIssue(source, reason, phase, cumulative))

    def begin_phase(self, phase: str, fields: tuple[str, ...]) -> None:
        """Reset one phase's recomputable counters and issues.

        The three phases share one record, so a phase may only clear its own
        rows. Fields in `CUMULATIVE_FIELDS` and issues marked cumulative
        describe source rows Build deleted, so they survive later passes that
        cannot derive them again. The issue count maps keep the subtraction
        exact even after the sample list hits `SAMPLE_KEPT` and stops growing.
        """
        blank = ContentConversion()
        for name in fields:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))
        self.issues = [issue for issue in self.issues if issue.phase != phase or issue.cumulative]
        phase_total = self.issues_by_phase.pop(phase, 0)
        cumulative_total = self.cumulative_issues_by_phase.get(phase, 0)
        self.issues_total -= phase_total - cumulative_total
        if cumulative_total:
            self.issues_by_phase[phase] = cumulative_total

    def begin_run(self) -> None:
        report_at = self.report_at if self.completed else None
        blank = ContentConversion(report_at=report_at)
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> ContentConversion:
        samples = {"issues", "removed_file_docs", "legacy_comment_rows", "relocated_media_nodes"}
        known = {f for f in cls.__dataclass_fields__ if f not in samples}
        content = cls(**{k: v for k, v in data.items() if k in known})
        content.issues = _rebuild(ContentIssue, data.get("issues"))
        content.removed_file_docs = _rebuild(RemovedFileDocument, data.get("removed_file_docs"))
        content.legacy_comment_rows = _rebuild(LegacyComment, data.get("legacy_comment_rows"))
        content.relocated_media_nodes = _rebuild(RelocatedMediaNode, data.get("relocated_media_nodes"))
        content.issues_by_phase = {
            str(key): int(value)
            for key, value in (data.get("issues_by_phase") or {}).items()
            if isinstance(value, int) and not isinstance(value, bool)
        }
        content.cumulative_issues_by_phase = {
            str(key): int(value)
            for key, value in (data.get("cumulative_issues_by_phase") or {}).items()
            if isinstance(value, int) and not isinstance(value, bool)
        }
        return content


@dataclass
class RecordConversion:
    """The result of §14.2 step 9: the personal and side-table records.

    Every number is decided from the source rows, so a rerun over a finished
    site reports the same census. Build writes no delete here: a favourite,
    recent, route, lock, or property whose entity did not migrate keeps its
    legacy value and is counted, which is what leaves §14.11's "ship the old
    code" rollback intact.
    """

    completed: bool = False
    favourites_seen: int = 0
    favourites_retargeted: int = 0
    favourites_already_linked: int = 0
    favourites_unmigrated: int = 0
    favourites_collapsed: int = 0
    recents_seen: int = 0
    recents_unmigrated: int = 0
    activity_rows_seen: int = 0
    activity_rows_written: int = 0
    activity_rows_already_present: int = 0
    # §14.9's two activity keys.
    activity_rows_dropped: int = 0
    activity_verbs_derived: int = 0
    # Evidence, not a §14.9 key: how the derived verb actually landed.
    derived_verbs: dict[str, int] = field(default_factory=dict)
    # A mapped row whose `owner` names no live `User`. §14.6 drops a row that
    # names no migrated node and says nothing about a dead actor, so the row
    # is kept and counted rather than thrown away with its history.
    activity_actors_missing: int = 0
    notification_rows: int = 0
    notification_rows_dropped: int = 0
    legacy_routes_seen: int = 0
    legacy_routes_unmigrated: int = 0
    dav_locks_seen: int = 0
    dav_locks_unmigrated: int = 0
    dav_properties_seen: int = 0
    dav_properties_unmigrated: int = 0
    skipped: list[SkippedRow] = field(default_factory=list)
    skipped_total: int = 0

    def record_skip(self, entry: SkippedRow) -> None:
        """Keep a bounded sample; the counters above stay exact."""
        self.skipped_total += 1
        if len(self.skipped) < SAMPLE_KEPT:
            self.skipped.append(entry)

    def derive(self, action: str) -> None:
        self.activity_verbs_derived += 1
        self.derived_verbs[action] = self.derived_verbs.get(action, 0) + 1

    def begin_run(self) -> None:
        blank = RecordConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> RecordConversion:
        known = {f for f in cls.__dataclass_fields__ if f != "skipped"}
        record = cls(**{k: v for k, v in data.items() if k in known})
        record.skipped = _rebuild(SkippedRow, data.get("skipped"))
        record.derived_verbs = {
            str(key): int(value)
            for key, value in (data.get("derived_verbs") or {}).items()
            if isinstance(value, int) and not isinstance(value, bool)
        }
        return record


@dataclass
class SettingsConversion:
    """The result of §14.2 step 11: quotas in bytes, reservations on roots."""

    completed: bool = False
    # What the mapping read and what it wrote, so the report can show the
    # MB-to-bytes conversion rather than assert it.
    disk_quota_mb: int = 0
    default_personal_quota: int = 0
    shared_quota: int = 0
    user_quota_rows_seen: int = 0
    user_quotas_applied: int = 0
    user_quotas_already_set: int = 0
    user_quotas_without_root: int = 0
    reservations_seen: int = 0
    reservations_bound: int = 0
    reservations_already_bound: int = 0
    reservations_unowned: int = 0
    # §14.9.
    personal_roots_created_for_reservations: int = 0
    pending_reservation_roots: list[str] = field(default_factory=list)
    skipped: list[SkippedRow] = field(default_factory=list)
    skipped_total: int = 0

    def record_skip(self, entry: SkippedRow) -> None:
        self.skipped_total += 1
        if len(self.skipped) < SAMPLE_KEPT:
            self.skipped.append(entry)

    def prepare_root(self, node: str) -> None:
        """Describe a Personal Root the next database commit intends to add."""
        if node not in self.pending_reservation_roots:
            self.pending_reservation_roots.append(node)

    def finish_roots(self, nodes) -> None:
        """Count committed intents exactly once, then drop their ledger rows."""
        finishing = set(nodes)
        pending = set(self.pending_reservation_roots)
        self.personal_roots_created_for_reservations += len(finishing & pending)
        self.pending_reservation_roots = [
            node for node in self.pending_reservation_roots if node not in finishing
        ]

    def begin_run(self) -> None:
        blank = SettingsConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> SettingsConversion:
        lists = {"skipped", "pending_reservation_roots"}
        known = {f for f in cls.__dataclass_fields__ if f not in lists}
        settings = cls(**{k: v for k, v in data.items() if k in known})
        settings.skipped = _rebuild(SkippedRow, data.get("skipped"))
        settings.pending_reservation_roots = [
            row for row in data.get("pending_reservation_roots") or [] if isinstance(row, str)
        ]
        return settings


@dataclass
class UsageMismatch:
    """One root whose two independent totals disagree."""

    root: str
    recomputed: int
    reconciled: int


@dataclass
class UsageConversion:
    """The result of §14.2 step 12: the recompute, and its second opinion.

    §7.7 gives the recompute one statement per root. §14.9 asks for the
    totals to be reconciled, and a second call to that statement would only
    prove the database is deterministic. The reconciliation therefore sums
    the same three tables again through three grouped passes over the whole
    site, and compares the answers root by root.
    """

    completed: bool = False
    roots_seen: int = 0
    roots_recomputed: int = 0
    roots_corrected: int = 0
    roots_skipped: int = 0
    node_bytes: int = 0
    version_bytes: int = 0
    reserved_bytes: int = 0
    used_bytes: int = 0
    reconciled_roots: int = 0
    reconciliation_mismatches: int = 0
    # Bytes the grouped pass found under a `root` value that no `Drive Root`
    # row explains. Zero on a healthy site; anything else is charged to
    # nobody and would never be recomputed away.
    unattributed_roots: int = 0
    unattributed_bytes: int = 0
    mismatches: list[UsageMismatch] = field(default_factory=list)
    mismatches_total: int = 0

    def record_mismatch(self, entry: UsageMismatch) -> None:
        self.reconciliation_mismatches += 1
        self.mismatches_total += 1
        if len(self.mismatches) < SAMPLE_KEPT:
            self.mismatches.append(entry)

    def begin_run(self) -> None:
        blank = UsageConversion()
        for name in self.__dataclass_fields__:
            if name not in CUMULATIVE_FIELDS:
                setattr(self, name, getattr(blank, name))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> UsageConversion:
        known = {f for f in cls.__dataclass_fields__ if f != "mismatches"}
        usage = cls(**{k: v for k, v in data.items() if k in known})
        usage.mismatches = _rebuild(UsageMismatch, data.get("mismatches"))
        return usage


@dataclass
class ReportRun:
    """One saved report: when it was written, and the file that holds it."""

    at: str
    path: str


@dataclass
class ReportRecord:
    """§14.9's evidence trail. Every run appends; no run overwrites.

    §14.2 lets a rerun skip complete records, so two runs of one migration
    produce two reports whose numbers differ. Keeping only the last one would
    throw away the evidence of the run that did the work.
    """

    runs: list[ReportRun] = field(default_factory=list)
    runs_total: int = 0

    def record(self, at: str, path: str) -> None:
        self.runs_total += 1
        if len(self.runs) < SAMPLE_KEPT:
            self.runs.append(ReportRun(at, path))

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> ReportRecord:
        record = cls(runs_total=int(data.get("runs_total") or 0))
        record.runs = _rebuild(ReportRun, data.get("runs"))
        return record


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

    def content(self) -> ContentConversion:
        stored = self.load().get("content")
        return ContentConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_content(self, content: ContentConversion) -> None:
        self.save({**self.load(), "content": content.as_dict()})

    def records(self) -> RecordConversion:
        stored = self.load().get("records")
        return RecordConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_records(self, records: RecordConversion) -> None:
        self.save({**self.load(), "records": records.as_dict()})

    def settings(self) -> SettingsConversion:
        stored = self.load().get("settings")
        return SettingsConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_settings(self, settings: SettingsConversion) -> None:
        self.save({**self.load(), "settings": settings.as_dict()})

    def usage(self) -> UsageConversion:
        stored = self.load().get("usage")
        return UsageConversion.from_dict(stored if isinstance(stored, dict) else {})

    def put_usage(self, usage: UsageConversion) -> None:
        self.save({**self.load(), "usage": usage.as_dict()})

    def report(self) -> ReportRecord:
        stored = self.load().get("report")
        return ReportRecord.from_dict(stored if isinstance(stored, dict) else {})

    def put_report(self, report: ReportRecord) -> None:
        self.save({**self.load(), "report": report.as_dict()})

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
