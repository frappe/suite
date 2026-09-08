"""§14.10's ordered removal contract, one function per phase.

Every phase takes `env` and reads or writes only through its ports, so the
whole contract runs against `tests.fakes` with no site — the same shape
`suite.drive.patches.build` uses. Nothing here is called from production:
`patch.run_cleanup` is the only caller, and nothing registers it.
"""

from __future__ import annotations

import frappe

from suite.drive.patches.cleanup.environment import CLEANUP_BATCH_SIZE
from suite.drive.patches.cleanup.gate import climb
from suite.drive.patches.cleanup.ports import REMOVED
from suite.drive.patches.cleanup.state import PhaseResult

# §14.10's frozen deletion list, this package's own copy: `suite.drive.patches.
# build.tests.test_dormancy` holds the mirror-image list that proves none of
# this has happened yet.
RETAINED_FILE_CUSTOM_FIELDS = (
    "section_break_nfot8",
    "mime_type",
    "status",
    "file_modified",
    "column_break_tapww",
    "content_doctype",
    "content_docname",
)

RETAINED_PROPERTY_SETTERS = (
    ("File", "file_url", "depends_on"),
    ("File", "folder", "hidden"),
    ("File", "folder", "depends_on"),
)

RETAINED_DOCTYPES_STEP_3 = (
    "drive/doctype/drive_permission",
    "drive/doctype/drive_entity_activity_log",
    "drive/doctype/drive_token",
)

# The six "Legacy ..." columns on `Drive Notification` (§3.11, §14.10). Ticket
# 30's addendum: dropping these is what lets `activity` become `reqd: 1`,
# because the two writers that insert rows with no `activity`
# (`suite/drive/api/notifications.py`, `drive_user_invitation.py`) only exist
# to populate these columns.
NOTIFICATION_LEGACY_COLUMNS = (
    "from_user",
    "type",
    "message",
    "notif_doctype",
    "notif_doctype_name",
    "entity_type",
)

RETAINED_DOCTYPES_STEP_4 = (
    "writer/doctype/writer_version",
    "writer/doctype/writer_doc_version",
    "writer/doctype/writer_template",
    "sheets/doctype/sheet_snapshot",
)

CONTENT_DROPPED_COLUMNS = (
    ("Presentation", ("title",)),
    ("Sheet", ("title", "trashed")),
)

SETTINGS_DROPPED_COLUMNS = (
    ("Drive Settings", ("user_folder", "quota")),
    ("Drive Disk Settings", ("quota", "aws_key", "aws_secret", "bucket", "endpoint_url")),
    ("Drive Storage Reservation", ("storage_owner",)),
)

LEGACY_METHOD_PREFIX = "/api/method/suite.drive.api."

# S3 keys must never be enumerated under these. An empty prefix is the
# bucket root; a bare "private" or "public" is the framework's own storage
# root, not Drive's legacy key space under it.
DANGEROUS_PREFIXES = ("private", "public")


class CleanupPatchError(frappe.ValidationError):
    """Cleanup cannot finish, and the site must not be left calling it done."""


def collect_drive_owned_names(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> list[str]:
    """Every legacy `File` id Cleanup may touch, ordered safe-to-delete first.

    Never a Home attachment: the chain climb classifies those "outside" and
    they are not returned. This reuses gate 1's own climb, so a row this
    enumerates is a row gate 1 already accounted for as safe to remove.

    One read-only pass over the whole table before anything is deleted, then
    `_deepest_removed_first` orders the result. Only a Removed row can
    depend on an ancestor's raw `File` row still being there: Build never
    gives a Removed row a node (`suite.drive.patches.build.tree`, "Removed
    rows and everything below them are not migrated"), so its climb has no
    `Drive Node` fast path and reads `folder` chains directly. Every other
    candidate — every reachable row gate 1 just proved has a node, and the
    two roots — resolves through its own node regardless of deletion order.
    Ordering Removed subtrees deepest-first is therefore enough: an
    interrupted run only ever removes a Removed row after its Removed
    descendants are already gone, so a fresh scan on resume always finds
    intact chains for whatever is left.
    """
    memo: dict[str, tuple[str, bool]] = {}
    after = ""
    previous = None
    owned: dict[str, object] = {}
    while True:
        rows = env.tree.all_files(after, batch_size)
        if not rows:
            break
        if rows[0].name == previous:
            raise RuntimeError(f"the drive-owned scan stalled at {rows[0].name!r}; refusing to loop")
        previous = rows[0].name
        classified = climb(rows, env.tree.chain, env.drive.nodes, memo)
        for row in rows:
            kind, _removed = classified[row.name]
            if kind == "drive":
                owned[row.name] = row
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    return _deepest_removed_first(owned)


def _deepest_removed_first(owned: dict) -> list[str]:
    """Sort `owned` so a Removed row's Removed descendants precede it.

    Depth is counted only through Removed rows already in `owned`: a
    non-Removed row, or a `folder` that leaves the Removed subtree, is the
    base case, depth 0. Ties (most of `owned`, which resolves through a
    node regardless of order) may land in any relative order.
    """
    resolved: dict[str, int] = {}

    def depth_of(name: str) -> int:
        if name in resolved:
            return resolved[name]
        row = owned.get(name)
        if row is None or row.status != REMOVED:
            return 0
        resolved[name] = 0  # cycle guard: a self-referential row counts as its own base case
        parent = row.folder
        resolved[name] = 0 if not parent else depth_of(parent) + 1
        return resolved[name]

    for name in owned:
        depth_of(name)
    return sorted(owned, key=lambda name: resolved.get(name, 0), reverse=True)


def iter_drive_owned_names(env, *, batch_size: int = CLEANUP_BATCH_SIZE):
    """`collect_drive_owned_names`, chunked into deletion-sized batches."""
    names = collect_drive_owned_names(env, batch_size=batch_size)
    for start in range(0, len(names), batch_size):
        yield names[start : start + batch_size]


def phase_file_rows(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 1: Drive-owned File rows, the two root rows, every Removed row."""
    result = PhaseResult()
    for batch in iter_drive_owned_names(env, batch_size=batch_size):
        result.rows_deleted += env.files.delete(tuple(batch))
    result.completed = True
    return result


def phase_custom_fields(env) -> PhaseResult:
    """§14.10 step 2: the seven `File` custom fields and three property setters."""
    result = PhaseResult()
    result.fields_dropped = env.schema.drop_custom_fields(RETAINED_FILE_CUSTOM_FIELDS)
    result.property_setters_dropped = env.schema.drop_property_setters(RETAINED_PROPERTY_SETTERS)
    result.completed = True
    return result


def phase_legacy_doctypes(env) -> PhaseResult:
    """§14.10 step 3: `Drive Permission`/`Drive Entity Activity Log`/`Drive Token`,
    the old notification columns, then `Drive Notification.activity` becomes required."""
    result = PhaseResult()
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_3)
    result.columns_dropped = env.schema.drop_columns("Drive Notification", NOTIFICATION_LEGACY_COLUMNS)
    env.schema.require_field("Drive Notification", "activity")
    result.completed = True
    return result


def phase_content_history(env) -> PhaseResult:
    """§14.10 step 4: Sheet `DocShare`, Writer/Sheet history doctypes, comments."""
    result = PhaseResult()
    result.docshares_deleted = env.content.delete_sheet_docshares()
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_4)
    result.ycomments_cleared = env.content.clear_writer_ycomments()
    result.sheet_comments_stripped = env.content.strip_sheet_comments()
    result.completed = True
    return result


def phase_content_fields(env) -> PhaseResult:
    """§14.10 step 5: title/trashed on content doctypes; settings/disk/reservation fields."""
    result = PhaseResult()
    for doctype, columns in CONTENT_DROPPED_COLUMNS + SETTINGS_DROPPED_COLUMNS:
        result.columns_dropped += env.schema.drop_columns(doctype, columns)
    result.completed = True
    return result


def phase_legacy_api(env) -> PhaseResult:
    """§14.10 step 6: the FORWARDER callers, and the wildcard prefix.

    PERMANENT and RETAINED names are never in the set this deletes: they are
    excluded by classification, not by a second list this phase would have
    to keep in sync by hand.
    """
    result = PhaseResult()
    classification = env.forwarders.classification()
    forwarders = tuple(sorted(name for name, category in classification.items() if category == "forwarder"))
    result.forwarders_removed = env.forwarders.remove(forwarders)
    result.wildcard_prefix_removed = env.forwarders.remove_wildcard_prefix(LEGACY_METHOD_PREFIX)
    result.completed = True
    return result


def phase_thumbnails(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 7: the `.thumbnail` sidecars. Local legacy bytes stay in place."""
    result = PhaseResult()
    for batch in iter_drive_owned_names(env, batch_size=batch_size):
        result.sidecars_deleted += env.thumbnails.delete_sidecars(tuple(batch))
    result.completed = True
    return result


def phase_s3_prefix(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 8: enqueue the legacy-key deletion job.

    Never a blind prefix delete: the prefix is refused if it is empty, the
    bucket root, or a private/public parent; every candidate key is listed,
    then subtracted against `File Blob` references re-read at this moment,
    immediately before anything is queued for deletion.
    """
    result = PhaseResult()
    if not env.s3.enabled():
        result.completed = True
        return result

    prefix = env.s3.legacy_prefix()
    refuse_dangerous_prefix(prefix)

    keys: list[str] = []
    after = ""
    previous = None
    while True:
        page = env.s3.list_prefix(prefix, after, batch_size)
        if not page:
            break
        if page[0] == previous:
            raise RuntimeError(f"the S3 prefix scan stalled at {page[0]!r}; refusing to loop")
        previous = page[0]
        keys.extend(page)
        after = page[-1]
        if len(page) < batch_size:
            break

    referenced = env.s3.blob_references(tuple(keys)) if keys else set()
    candidates = tuple(key for key in keys if key not in referenced)
    result.candidates_found = len(keys)
    result.referenced_excluded = len(referenced)
    if candidates:
        result.job_id = env.s3.enqueue_delete(candidates)
    result.completed = True
    return result


def refuse_dangerous_prefix(prefix: str) -> None:
    stripped = (prefix or "").strip("/")
    if not stripped:
        raise CleanupPatchError(
            "the S3 legacy prefix is empty or names the bucket root; refusing to enumerate it"
        )
    if stripped in DANGEROUS_PREFIXES:
        raise CleanupPatchError(f"{prefix!r} is a private/public parent prefix, not Drive's legacy key space")
