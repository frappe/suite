"""§14.10's ordered removal contract, one function per phase.

Every phase takes `env` and reads or writes only through its ports, so the
whole contract runs against `tests.fakes` with no site — the same shape
`suite.drive.patches.build` uses. `patch.run_cleanup` is the only caller.
"""

from __future__ import annotations

import frappe

from suite.drive.patches.build.slides import _aliases, _path_variants
from suite.drive.patches.cleanup.environment import CLEANUP_BATCH_SIZE
from suite.drive.patches.cleanup.gate import climb
from suite.drive.patches.cleanup.ports import DISK_SETTINGS_FIELDS, REMOVED
from suite.drive.patches.cleanup.state import PhaseResult

# §14.10's deletion list. `env.schema.drop_custom_fields` only removes each
# field's `Custom Field` metadata row, never the physical column it created
# on `tabFile` — see that port's docstring (`ports.SiteSchemaGateway.
# drop_custom_fields`) for why an orphaned column is intentionally outside
# §14.10's scope, not a gap this phase should add DDL to close.
RETAINED_FILE_CUSTOM_FIELDS = (
    "section_break_nfot8",
    "mime_type",
    "status",
    "file_modified",
    "column_break_tapww",
    "content_doctype",
    "content_docname",
)

# The five of the seven that have a column on `tabFile`. Deleting a `Custom
# Field` row leaves its column behind (Frappe never drops one), and a
# `status` or `content_docname` column nobody declares is legacy data a
# restore could not explain, so the phase drops them as well.
FILE_CUSTOM_COLUMNS = ("mime_type", "status", "file_modified", "content_doctype", "content_docname")

RETAINED_PROPERTY_SETTERS = (
    ("File", "file_url", "depends_on"),
    ("File", "folder", "hidden"),
    ("File", "folder", "depends_on"),
)

# Every legacy Drive doctype whose source is gone. The first three are
# §14.10 step 3's; the rest belonged to the legacy backend removed in the
# same release (invitations, tokens, the old activity/entity logs, the
# legacy-call log). A site that never had one of them is skipped, not refused.
# `Drive Team` and `Drive Team Member` are absent because Build's upgrade
# floor (`build.gate.UPGRADE_FLOOR_PATCH`) guarantees `drop_team_doctypes`
# already ran, so no site reaching Cleanup has either table. `Drive Legacy
# Route` is absent because the redirect table still reads it.
RETAINED_DOCTYPES_STEP_3 = (
    "Drive Permission",
    "Drive Entity Activity Log",
    "Drive Token",
    "Drive User Invitation",
    "Account Request",
    "Drive Legacy Call",
    "Drive Entity Log",
)

# The six "Legacy ..." columns on `Drive Notification` (§3.11, §14.10).
# Dropping these is what lets `activity` become required: the writers that
# inserted rows with no `activity` went with the legacy backend.
NOTIFICATION_LEGACY_COLUMNS = (
    "from_user",
    "type",
    "message",
    "notif_doctype",
    "notif_doctype_name",
    "entity_type",
)

RETAINED_DOCTYPES_STEP_4 = (
    "Writer Version",
    "Writer Doc Version",
    "Writer Template",
    "Sheet Snapshot",
)

# §14.10: "Drop the title and trashed columns on content doctypes." Sheet
# carries all three trash columns (`trashed`, `trashed_on`, `trashed_by`,
# per `suite/sheets/doctype/sheet/sheet.json`); Presentation carries none of
# them, only `title`. `Sheet.head_snapshot` pointed at `Sheet Snapshot`,
# dropped in step 4; Build read it with raw SQL (`build/history.py`), so
# it stays in the table until here.
CONTENT_DROPPED_COLUMNS = (
    ("Presentation", ("title",)),
    ("Sheet", ("title", "trashed", "trashed_on", "trashed_by", "head_snapshot")),
)

# Columns dropped from Drive doctypes that stay: `Drive Settings`' and
# `Drive Storage Reservation`'s legacy fields, `Drive Favourite.entity` (the
# legacy `File` pointer Build retargets to `node`), and `Drive Root`'s
# reserved `acl_generation`, which nothing ever read. `Drive Disk Settings`
# is a Single (§3.13) and has no table of its own for `drop_columns`' DDL to
# touch; its ten fields drop through `SINGLE_DROPPED_VALUES` and
# `SchemaGateway.drop_single_values` instead.
DRIVE_DROPPED_COLUMNS = (
    ("Drive Settings", ("user_folder", "quota")),
    ("Drive Storage Reservation", ("storage_owner",)),
    ("Drive Favourite", ("entity",)),
    ("Drive Root", ("acl_generation",)),
)

# §3.13's complete ten-field list for `Drive Disk Settings`
# (`ports.DISK_SETTINGS_FIELDS`), removed from `tabSingles`, never by DDL.
SINGLE_DROPPED_VALUES = (("Drive Disk Settings", DISK_SETTINGS_FIELDS),)


class CleanupPatchError(frappe.ValidationError):
    """Cleanup cannot finish, and the site must not be left calling it done."""


def _verify_gone(remaining: frozenset, what: str) -> None:
    """§14.10's removal targets must all be gone once a phase reports itself
    complete — checked by re-reading each named target's own presence, never
    inferred from how many a `drop_*` call reported removing just now.

    A single call's own count is the wrong signal for this: MariaDB commits
    a DDL statement (`alter table ... drop column`, and the delete behind a
    Single's `tabSingles` row) as soon as that statement runs, independent
    of this package's own `env.transaction.commit()` at the end of the
    phase. A crash between two such calls in the same phase — say, after
    `Drive Permission` is dropped but before `Drive Token` is — is a
    legitimate partially-applied phase, not a corrupted one: on resume,
    `drop_doctypes` sees one doctype already gone and reports removing only
    the other, a count that would fail an all-or-nothing check even though
    every named target really is gone by the end of this call. Re-checking
    presence directly, target by target, verifies the fact removal.py
    actually needs and stays correct whether this call did all the work,
    none of it (a clean rerun of an already-completed phase), or the rest of
    what an earlier, interrupted call left unfinished.

    Still fails closed: if a target really is still present after the drop
    call meant to remove it, or the presence check itself errors, that
    propagates as a real refusal, not a silently accepted mismatch."""
    if remaining:
        raise CleanupPatchError(
            f"{sorted(remaining)} of {what} still present after the drop call; refusing to "
            "report this phase complete"
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

    Also takes and persists everything step 7 and the manual legacy-object
    delete need before their own sources disappear: the ordered name census
    (`collect_drive_owned_names` would otherwise have to rescan a table this
    very phase is about to empty), and the `Drive Disk Settings` fields step
    5 drops. Both are read exactly once across this phase's entire life,
    including a resumed call, and never queried live again once persisted.

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


def phase_slides_media_rows(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 1, Slides: the `File` rows of deck pictures Build made nodes.

    Build turns each picture attached to a Presentation into a `file` node
    under the deck's node and points the slide bodies at that node (§14.7).
    The `File` row it read stays behind: it sits under frappe's `Home`, so
    `phase_file_rows` never reaches it. Only the row goes, through the same
    hook-free delete, and the bytes stay with the blob the node now holds.

    A row is deleted only when a node of its own deck holds its exact blob
    (`ContentRows.converted_slides_media`), and only when no slide body on
    the site still names its URL. Build leaves a URL in place when it cannot
    adopt the picture, such as another deck's media (§11), and that
    reference still needs the row to load. A kept row is counted.

    Matching uses Build's own URL spellings (`_aliases`, `_path_variants`),
    so a URL Build would have resolved is a URL this phase sees as named. A rerun
    finds the deleted rows gone and deletes nothing more.
    """
    result = PhaseResult()
    host = env.content.site_host()
    bodies = env.content.slide_body_values(batch_size=batch_size)
    named = set()
    for value in bodies.strings:
        named |= _path_variants(value, host)
    after = ""
    while True:
        rows = env.content.converted_slides_media(after, batch_size)
        unnamed = []
        for row in rows:
            # Build names a picture's node after its `File`, so a body value
            # equal to the row's name is that node's id, not the row.
            aliases = _aliases(row, host) - {row.name}
            if aliases & named or any(alias in body for body in bodies.unreadable for alias in aliases):
                result.media_rows_kept += 1
            else:
                unnamed.append(row.name)
        result.rows_deleted += env.files.delete(tuple(unnamed))
        if len(rows) < batch_size:
            break
        after = rows[-1].name
    result.completed = True
    return result


def phase_custom_fields(env) -> PhaseResult:
    """§14.10 step 2: the seven `File` custom fields, their five columns, and
    three property setters."""
    result = PhaseResult()
    result.fields_dropped = env.schema.drop_custom_fields(RETAINED_FILE_CUSTOM_FIELDS)
    result.columns_dropped = env.schema.drop_columns("File", FILE_CUSTOM_COLUMNS)
    result.property_setters_dropped = env.schema.drop_property_setters(RETAINED_PROPERTY_SETTERS)
    _verify_gone(env.schema.custom_fields_present(RETAINED_FILE_CUSTOM_FIELDS), "the File custom fields")
    _verify_gone(env.schema.columns_present("File", FILE_CUSTOM_COLUMNS), "the File custom columns")
    _verify_gone(env.schema.property_setters_present(RETAINED_PROPERTY_SETTERS), "the File property setters")
    result.completed = True
    return result


def phase_legacy_doctypes(env) -> PhaseResult:
    """§14.10 step 3: the legacy Drive doctypes, the old notification
    columns, then `Drive Notification.activity` becomes required."""
    result = PhaseResult()
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_3)
    _verify_gone(env.schema.doctypes_present(RETAINED_DOCTYPES_STEP_3), "the step-3 doctypes")
    result.columns_dropped = env.schema.drop_columns("Drive Notification", NOTIFICATION_LEGACY_COLUMNS)
    _verify_gone(
        env.schema.columns_present("Drive Notification", NOTIFICATION_LEGACY_COLUMNS),
        "Drive Notification's legacy columns",
    )
    env.schema.require_field("Drive Notification", "activity")
    result.completed = True
    return result


def phase_content_history(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 4: governed `DocShare`, Writer/Sheet history doctypes, comments.

    §14.10 lists the Sheet `DocShare` rows here, but Build no longer leaves
    any: it rewrites each one as a grant and deletes it in the same commit,
    because §5.13's read guards fail closed on a surviving row and
    `validate_content_registry` refuses the migration while one is left. So
    this phase verifies the rows are gone and refuses if they are not,
    rather than doing a release late what Build must already have done.

    `Writer Document.versions`, the `Table` field that pointed at `Writer
    Doc Version`, is gone from the shipped JSON already (a child-table field
    has no column of its own), so model sync has removed it before this
    phase drops the child doctype it named.
    """
    result = PhaseResult()
    _verify_gone(env.content.governed_docshares_remaining(), "the governed DocShare rows")
    result.doctypes_dropped = env.schema.drop_doctypes(RETAINED_DOCTYPES_STEP_4)
    _verify_gone(env.schema.doctypes_present(RETAINED_DOCTYPES_STEP_4), "the step-4 doctypes")
    result.ycomments_cleared = env.content.clear_writer_ycomments()
    result.sheet_comments_stripped = env.content.strip_sheet_comments(batch_size=batch_size)
    result.completed = True
    return result


def phase_content_fields(env) -> PhaseResult:
    """§14.10 step 5: title/trashed on content doctypes; the Drive doctypes'
    legacy columns; `Drive Disk Settings`' ten Single values."""
    result = PhaseResult()
    for doctype, columns in CONTENT_DROPPED_COLUMNS + DRIVE_DROPPED_COLUMNS:
        result.columns_dropped += env.schema.drop_columns(doctype, columns)
        _verify_gone(env.schema.columns_present(doctype, columns), f"{doctype}'s dropped columns")
    for doctype, fields in SINGLE_DROPPED_VALUES:
        result.single_values_dropped += env.schema.drop_single_values(doctype, fields)
        _verify_gone(env.schema.single_values_present(doctype, fields), f"{doctype}'s dropped single values")
    result.completed = True
    return result


def phase_thumbnails(env, *, batch_size: int = CLEANUP_BATCH_SIZE) -> PhaseResult:
    """§14.10 step 7: the local `.thumbnail` sidecars. Every legacy byte stays.

    Local legacy files stay because backfilled blobs point at them in place.
    Legacy bucket objects stay because Cleanup deletes no bucket object at
    all (§14.11): the backup restore must remain a complete rollback, so
    only the manual `delete_legacy_objects` command removes them, later. On
    an S3 site the store therefore deletes nothing and this phase records 0.

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
