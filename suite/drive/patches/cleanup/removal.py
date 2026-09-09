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
from suite.drive.patches.cleanup.ports import DISK_SETTINGS_FIELDS, REMOVED
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

# §14.10: "Drop the title and trashed columns on content doctypes." Sheet
# carries all three trash columns (`trashed`, `trashed_on`, `trashed_by`,
# per `suite/sheets/doctype/sheet/sheet.json`); Presentation carries none of
# them, only `title`.
CONTENT_DROPPED_COLUMNS = (
    ("Presentation", ("title",)),
    ("Sheet", ("title", "trashed", "trashed_on", "trashed_by")),
)

# `Drive Settings`' and `Drive Storage Reservation`'s own dropped fields.
# `Drive Disk Settings` is a Single (§3.13) and has no table of its own for
# `drop_columns`' DDL to touch; its ten fields drop through
# `SINGLE_DROPPED_VALUES` and `SchemaGateway.drop_single_values` instead.
SETTINGS_DROPPED_COLUMNS = (
    ("Drive Settings", ("user_folder", "quota")),
    ("Drive Storage Reservation", ("storage_owner",)),
)

# §3.13's complete ten-field list for `Drive Disk Settings`
# (`ports.DISK_SETTINGS_FIELDS`), removed from `tabSingles`, never by DDL.
SINGLE_DROPPED_VALUES = (("Drive Disk Settings", DISK_SETTINGS_FIELDS),)

LEGACY_METHOD_PREFIX = "/api/method/suite.drive.api."

# S3 keys must never be enumerated under these. An empty prefix is the
# bucket root; a bare "private" or "public" is the framework's own storage
# root, not Drive's legacy key space under it.
DANGEROUS_PREFIXES = ("private", "public")


class CleanupPatchError(frappe.ValidationError):
    """Cleanup cannot finish, and the site must not be left calling it done."""


def _require_exact_or_already_done(actual: int, expected: int, what: str) -> None:
    """§14.10's removal counts are all-or-nothing. A gate already proved
    every reachable row was migrated and every referenced item was still
    there when Cleanup started, so a fresh phase must remove exactly
    `expected`; a resumed phase whose commit landed before an earlier crash
    (§14's transaction discipline) finds nothing left and removes zero. A
    count strictly between the two means some of `what` went missing for a
    reason nothing here can explain, and reporting that phase "completed"
    would silently accept schema drift instead of refusing to guess at it."""
    if actual not in (0, expected):
        raise CleanupPatchError(
            f"expected to drop {expected} of {what}, actually dropped {actual}; refusing to "
            "report success on a partial removal"
        )


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

    Called exactly once per `run_cleanup` invocation, by `phase_file_rows`,
    which persists the result: nothing past phase 1 calls this again.
    Recomputing it later would either find the very rows phase 1 just
    deleted (an empty answer, wrong) or force a second full-table scan this
    package can otherwise avoid entirely.
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


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def phase_file_rows(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 1: Drive-owned File rows, the two root rows, every Removed row.

    Also takes and persists everything steps 7 and 8 need before their own
    targets disappear: the ordered name census (`collect_drive_owned_names`
    would otherwise have to rescan a table this very phase is about to
    empty), and the ten `Drive Disk Settings` fields step 5 drops. Both are
    read exactly once across this phase's entire life, including a resumed
    call, and never queried live again once persisted.

    That "once" is load-bearing, not just an optimization: if this phase's
    own `DELETE`s commit but the crash lands before `patch.run_cleanup`
    writes this phase's checkpoint, resume calls this function again with
    the census already on record. A second live rescan at that point would
    see the very rows this phase just deleted and find nothing — an empty
    answer that is wrong, not a legitimate re-derivation of the same
    census — and unconditionally overwriting the durable copy with it would
    silently orphan step 7's sidecar deletion for every name phase 1 already
    removed. Reading `env.state.get_census()`/`get_settings_snapshot()`
    first and only computing+persisting when one is genuinely absent (`None`,
    never "no run has reached here yet" confused with "an empty census")
    is what keeps a resumed run's preparation record identical to a fresh
    run's.
    """
    result = PhaseResult()
    names = env.state.get_census()
    if names is None:
        names = collect_drive_owned_names(env, batch_size=batch_size)
        env.state.put_census(names)
    settings = env.state.get_settings_snapshot()
    if settings is None:
        settings = env.disk_settings.read()
        env.state.put_settings_snapshot(settings)
    for batch in _chunks(names, batch_size):
        result.rows_deleted += env.files.delete(tuple(batch))
    result.completed = True
    return result


def phase_custom_fields(env) -> PhaseResult:
    """§14.10 step 2: the seven `File` custom fields and three property setters."""
    result = PhaseResult()
    result.fields_dropped = env.schema.drop_custom_fields(RETAINED_FILE_CUSTOM_FIELDS)
    result.property_setters_dropped = env.schema.drop_property_setters(RETAINED_PROPERTY_SETTERS)
    _require_exact_or_already_done(
        result.fields_dropped, len(RETAINED_FILE_CUSTOM_FIELDS), "the File custom fields"
    )
    _require_exact_or_already_done(
        result.property_setters_dropped, len(RETAINED_PROPERTY_SETTERS), "the File property setters"
    )
    result.completed = True
    return result


def phase_legacy_doctypes(env) -> PhaseResult:
    """§14.10 step 3: `Drive Permission`/`Drive Entity Activity Log`/`Drive Token`,
    the old notification columns, then `Drive Notification.activity` becomes
    required.

    Also prepares (but does not perform) removing these three doctypes'
    now-dead `permission_query_conditions`/`has_permission` entries out of
    `suite/hooks.py`: a source change Ticket 36 makes once the doctypes
    themselves are gone, not something this phase can do at runtime.
    """
    result = PhaseResult()
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_3)
    _require_exact_or_already_done(
        result.doctypes_dropped, len(RETAINED_DOCTYPES_STEP_3), "the step-3 doctypes"
    )
    env.schema.remove_permission_hooks(RETAINED_DOCTYPES_STEP_3)
    result.columns_dropped = env.schema.drop_columns("Drive Notification", NOTIFICATION_LEGACY_COLUMNS)
    _require_exact_or_already_done(
        result.columns_dropped, len(NOTIFICATION_LEGACY_COLUMNS), "Drive Notification's legacy columns"
    )
    env.schema.require_field("Drive Notification", "activity")
    result.completed = True
    return result


def phase_content_history(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 4: Sheet `DocShare`, Writer/Sheet history doctypes, comments.

    Drops `Writer Document.versions` before `Writer Doc Version`, the child
    doctype that field's `Table` type points at: dropping the doctype first
    would leave the field's own JSON naming a table that no longer exists.
    `versions` has no `Custom Field` row and no column of its own to drop by
    DDL, so removing it is a source change to `writer_document.json`, the
    same kind of change forwarder removal already is — `drop_child_table_field`
    stays `NotImplementedError` until Ticket 36 makes it.
    """
    result = PhaseResult()
    result.docshares_deleted = env.content.delete_sheet_docshares()
    env.schema.drop_child_table_field("Writer Document", "versions")
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_4)
    _require_exact_or_already_done(
        result.doctypes_dropped, len(RETAINED_DOCTYPES_STEP_4), "the step-4 doctypes"
    )
    result.ycomments_cleared = env.content.clear_writer_ycomments()
    result.sheet_comments_stripped = env.content.strip_sheet_comments(batch_size=batch_size)
    result.completed = True
    return result


def phase_content_fields(env) -> PhaseResult:
    """§14.10 step 5: title/trashed on content doctypes; settings/reservation
    columns; `Drive Disk Settings`' ten Single values."""
    result = PhaseResult()
    for doctype, columns in CONTENT_DROPPED_COLUMNS + SETTINGS_DROPPED_COLUMNS:
        dropped = env.schema.drop_columns(doctype, columns)
        _require_exact_or_already_done(dropped, len(columns), f"{doctype}'s dropped columns")
        result.columns_dropped += dropped
    for doctype, fields in SINGLE_DROPPED_VALUES:
        dropped = env.schema.drop_single_values(doctype, fields)
        _require_exact_or_already_done(dropped, len(fields), f"{doctype}'s dropped single values")
        result.single_values_dropped += dropped
    result.completed = True
    return result


def phase_legacy_api(env) -> PhaseResult:
    """§14.10 step 6: the FORWARDER callers, and the wildcard prefix.

    PERMANENT and RETAINED names are never in the set this deletes: they are
    excluded by classification, not by a second list this phase would have
    to keep in sync by hand. This runs off `classification()` alone, on
    purpose: gate 3 (`suite.drive.patches.cleanup.gate.
    check_gate_legacy_callers_removed`) requires real caller evidence before
    Cleanup starts at all, so by the time this phase runs, every
    FORWARDER-classified name here is already proven caller-free — whether
    or not anyone has bothered to relabel it in `shims.py`.
    """
    result = PhaseResult()
    classification = env.forwarders.classification()
    forwarders = tuple(sorted(name for name, category in classification.items() if category == "forwarder"))
    result.forwarders_removed = env.forwarders.remove(forwarders)
    result.wildcard_prefix_removed = env.forwarders.remove_wildcard_prefix(LEGACY_METHOD_PREFIX)
    result.completed = True
    return result


def phase_thumbnails(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 7: the `.thumbnail` sidecars. Local legacy bytes stay in place.

    Reads the census and disk-settings snapshot `phase_file_rows` persisted:
    by step 7, step 1 has already deleted the File rows a live rescan would
    need, and step 5 has already dropped the settings columns a live
    settings read would need. Neither exists to query live any more.
    """
    result = PhaseResult()
    names = env.state.get_census()
    if names is None:
        raise CleanupPatchError(
            "no drive-owned name census on record; phase_file_rows must run and persist one "
            "before phase_thumbnails can know what to touch"
        )
    settings = env.state.get_settings_snapshot()
    if settings is None:
        raise CleanupPatchError(
            "no disk-settings snapshot on record; phase_file_rows must persist one before "
            "phase_thumbnails can know the thumbnail path"
        )
    for batch in _chunks(names, batch_size):
        result.sidecars_deleted += env.thumbnails.delete_sidecars(tuple(batch), settings=settings)
    result.completed = True
    return result


def phase_s3_prefix(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 8: enqueue the legacy-key deletion job.

    Reads `enabled`/`root_folder` off the disk-settings snapshot
    `phase_file_rows` persisted, not off a live `Drive Disk Settings` read:
    step 5 has already dropped both columns by the time step 8 runs.

    Never a blind prefix delete: the prefix is refused if it is empty, the
    bucket root, or a private/public parent; every candidate key is listed,
    then subtracted against `File Blob` references re-read at this moment,
    immediately before anything is queued for deletion. That re-check closes
    the race between listing and enqueueing; the job this enqueues still has
    to close the separate race between enqueueing and actually running
    (`SiteS3LegacyPrefix.enqueue_delete`'s docstring is that job's contract).
    """
    result = PhaseResult()
    settings = env.state.get_settings_snapshot()
    if settings is None:
        raise CleanupPatchError(
            "no disk-settings snapshot on record; phase_file_rows must persist one before "
            "phase_s3_prefix can know whether S3 is even enabled"
        )
    if not settings.get("enabled"):
        result.completed = True
        return result

    prefix = settings.get("root_folder") or ""
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
