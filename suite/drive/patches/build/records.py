"""§14.2 step 9: favourites, recents, activity, routes, and the DAV rows.

§14.6 calls this a retarget, and every table here is retargeted rather than
copied, with one exception. `Drive Favourite`, `Drive Recent`,
`Drive Legacy Route`, `Drive DAV Lock`, and `Drive DAV Property` all name a
node by the id their legacy row already held, because §14.3 keeps the `File`
id on the node. The exception is `Drive Entity Activity Log`, which is a
different table with a different verb set, so its rows are mapped into
`Drive Activity` under their own ids.

**Build deletes nothing here.** A row whose entity never became a node is
counted and left exactly as it is. Deleting it would make the migration
lossy in the one direction §14.11 promises is reversible ("truncate the new
tables and ship the old code"), and none of the five tables is read through
a foreign key, so a stale row decides nothing for anyone: the views filter
by what the reader can see, and a node that does not exist is not visible.

`Drive Notification` is the one table with no target at all. §14.6 drops it
because a legacy row carries no activity link, and the new inbox reads
through that link, so the inbox starts empty. This step counts what was left
behind rather than pretending the table was empty to begin with.
"""

import json

import frappe

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import (
    ACTIVE,
    LEGACY_DELETE_VERB,
    REMOVED,
    TRASHED,
)
from suite.drive.patches.build.state import RecordConversion, SkippedRow

# §14.6: "verbs map one for one, except `delete`". These are the eight legacy
# `action_type` values that survive unchanged; `delete` is derived below.
DIRECT_VERBS = frozenset(
    {"create", "comment", "share_add", "share_remove", "share_edit", "rename", "edit", "move"}
)

# §14.6's table for the old single `delete` verb, read off the `File.status`
# of the entity the row names, at map time.
DERIVED_BY_STATUS = {TRASHED: "trash", REMOVED: "delete", ACTIVE: "restore"}

# "any other case | trash". A status Drive never wrote, and a row whose File
# is gone, are not the same case: the second one is spelled out as `delete`.
DERIVED_DEFAULT = "trash"


class BuildRecordError(frappe.ValidationError):
    """Step 9 cannot run, or found target state it must not write through."""


def convert_records(env, *, batch_size: int = BUILD_BATCH_SIZE) -> RecordConversion:
    """Retarget the record tables and map the activity log (§14.2 step 9).

    Runs after the trees exist, because every decision here is "does this id
    name a node". It does not need step 8 or step 10: a favourite or an
    activity row on a content document names the same node id whether or not
    the content link has been written yet.
    """
    if not env.state.tree().completed:
        raise BuildRecordError("ticket 27 tree conversion must complete before step 9")
    records, target = _ports(env)
    result = env.state.records()
    result.begin_run()
    env.state.put_records(result)

    _retarget_favourites(env, records, target, result, batch_size)
    _census_recents(env, records, target, result, batch_size)
    _convert_activity(env, records, target, result, batch_size)
    _census_notifications(records, result)
    _retarget_entity_tables(env, records, target, result, batch_size)

    result.completed = True
    env.state.put_records(result)
    return result


def _retarget_favourites(env, records, target, result, batch_size) -> None:
    """Fill `Drive Favourite.node` from the legacy `entity` column.

    `fav_user_node` is unique and the legacy table has no matching index, so
    a person who starred one entity twice arrives as two rows. The first in
    id order takes the pair and the rest keep a blank `node`, which is stable
    across reruns and is what the unique index would have enforced anyway.
    """
    after = ""
    written = 0
    while True:
        rows = records.favourites(after, batch_size)
        if not rows:
            break
        pending = [row for row in rows if not row.node and row.entity]
        present = target.nodes_present(tuple({row.entity for row in pending}))
        held = target.favourite_nodes(
            tuple({(row.user, row.entity) for row in pending if row.entity in present})
        )
        claimed = set(held)
        for row in rows:
            result.favourites_seen += 1
            if row.node:
                result.favourites_already_linked += 1
                continue
            if not row.entity or not row.user:
                result.record_skip(SkippedRow(row.name, "a favourite names no user or no entity"))
                continue
            if row.entity not in present:
                result.favourites_unmigrated += 1
                result.record_skip(SkippedRow(row.name, f"favourite entity {row.entity} has no node"))
                continue
            pair = (row.user, row.entity)
            if pair in claimed:
                result.favourites_collapsed += 1
                result.record_skip(SkippedRow(row.name, "a second favourite for one user and node"))
                continue
            target.set_favourite_node(row.name, row.entity)
            claimed.add(pair)
            result.favourites_retargeted += 1
            written += 1
            if written >= batch_size:
                target.commit()
                env.state.put_records(result)
                written = 0
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    target.commit()
    env.state.put_records(result)


def _census_recents(env, records, target, result, batch_size) -> None:
    """Count the renamed `Drive Recent` rows that name no node.

    The pre-model-sync rename already moved every value across, so there is
    nothing to write here. What the report needs is how many of those rows
    point at a `File` the walk did not migrate.
    """
    after = ""
    while True:
        rows = records.recents(after, batch_size)
        if not rows:
            break
        present = target.nodes_present(tuple({row.node for row in rows if row.node}))
        for row in rows:
            result.recents_seen += 1
            if not row.node or row.node not in present:
                result.recents_unmigrated += 1
                result.record_skip(SkippedRow(row.name, f"recent node {row.node} does not exist"))
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    env.state.put_records(result)


def _convert_activity(env, records, target, result, batch_size) -> None:
    """Map `Drive Entity Activity Log` into `Drive Activity` (§14.6)."""
    after = ""
    pending: list[dict] = []
    while True:
        rows = records.activity_log(after, batch_size)
        if not rows:
            break
        entities = tuple({row.entity for row in rows if row.entity})
        present = target.nodes_present(entities)
        # §14.6 reads `File.status` "at map time". `chain` answers for the
        # rows that still exist; an absent id is the "File row is gone" case.
        statuses = env.tree.chain(entities)
        already = target.activity_present(tuple(row.name for row in rows))
        for row in rows:
            result.activity_rows_seen += 1
            if row.name in already:
                result.activity_rows_already_present += 1
                continue
            mapped = _activity_row(env, row, present, statuses, result)
            if mapped is None:
                continue
            pending.append(mapped)
            if len(pending) >= batch_size:
                target.insert_activity(pending)
                result.activity_rows_written += len(pending)
                pending = []
                target.commit()
                env.state.put_records(result)
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    if pending:
        target.insert_activity(pending)
        result.activity_rows_written += len(pending)
    target.commit()
    env.state.put_records(result)


def _activity_row(env, row, present, statuses, result) -> dict | None:
    """One legacy row as a `Drive Activity` row, or None when §14.6 drops it."""
    if not row.entity or row.entity not in present:
        result.activity_rows_dropped += 1
        result.record_skip(SkippedRow(row.name, f"activity entity {row.entity} has no node"))
        return None
    action = _action_for(row, statuses, result)
    if action is None:
        result.activity_rows_dropped += 1
        result.record_skip(SkippedRow(row.name, f"unknown legacy verb {row.action_type!r}"))
        return None
    actor = (row.owner or "").strip()
    if not actor:
        result.activity_rows_dropped += 1
        result.record_skip(SkippedRow(row.name, "an activity row names no actor"))
        return None
    if env.tree.user_enabled(actor) is None:
        # Kept, not dropped. §14.6 drops a row that names no migrated node
        # and says nothing about a dead actor, and throwing the history away
        # would lose the record of who did what to a node that still exists.
        result.activity_actors_missing += 1
    return {
        "name": row.name,
        "node": row.entity,
        "action": action,
        "actor": actor,
        "at": row.creation,
        "via_link": None,
        "client": None,
        "detail": json.dumps(_detail(row), sort_keys=True),
        "owner": actor,
        "creation": row.creation,
        "modified": row.modified or row.creation,
        "modified_by": row.modified_by or actor,
        "docstatus": 0,
        "idx": 0,
    }


def _action_for(row, statuses, result) -> str | None:
    """§14.6's verb map: eight straight through, `delete` derived."""
    action_type = (row.action_type or "").strip()
    if action_type in DIRECT_VERBS:
        return action_type
    if action_type != LEGACY_DELETE_VERB:
        return None
    chain = statuses.get(row.entity)
    # "Removed, or the File row is gone" is one answer; an unknown status is
    # the separate "any other case" row of the table.
    derived = DERIVED_BY_STATUS.get(chain.status, DERIVED_DEFAULT) if chain else "delete"
    result.derive(derived)
    return derived


def _detail(row) -> dict:
    """§14.6: the four payload columns fold into `detail`, with `migrated`.

    An empty column is left out rather than stored as null: `detail` is read
    by a UI that renders the keys it finds, and a key whose value is nothing
    is a line that renders as nothing.
    """
    detail = {"migrated": True}
    for column in ("message", "document_field", "old_value", "new_value", "meta_value"):
        value = getattr(row, column, None)
        if value not in (None, ""):
            detail[column] = value
    return detail


def _census_notifications(records, result) -> None:
    """§14.6: the inbox starts empty. Say how large the one left behind is."""
    total, pointerless = records.notifications()
    result.notification_rows = total
    result.notification_rows_dropped = pointerless


def _retarget_entity_tables(env, records, target, result, batch_size) -> None:
    """Confirm the three id-preserving side tables resolve to nodes (§3.15).

    `Drive Legacy Route`, `Drive DAV Lock`, and `Drive DAV Property` all
    store the id §14.3 keeps, so the retarget is the Link column's own
    doctype change and there is no value to rewrite. What is left is proving
    that each stored id really did become a node, and counting the ones that
    did not.
    """
    for reader, seen_field, missing_field, label in (
        (records.legacy_routes, "legacy_routes_seen", "legacy_routes_unmigrated", "legacy route"),
        (records.dav_locks, "dav_locks_seen", "dav_locks_unmigrated", "DAV lock"),
        (records.dav_properties, "dav_properties_seen", "dav_properties_unmigrated", "DAV property"),
    ):
        after = ""
        while True:
            rows = reader(after, batch_size)
            if not rows:
                break
            present = target.nodes_present(tuple({row.entity for row in rows if row.entity}))
            for row in rows:
                setattr(result, seen_field, getattr(result, seen_field) + 1)
                if not row.entity or row.entity not in present:
                    setattr(result, missing_field, getattr(result, missing_field) + 1)
                    result.record_skip(SkippedRow(row.name, f"{label} entity {row.entity} has no node"))
            after = rows[-1].name
            if len(rows) < batch_size:
                break
        env.state.put_records(result)


def _ports(env):
    if env.records is None or env.records_target is None:
        raise BuildRecordError("Build record ports are not configured")
    return env.records, env.records_target
