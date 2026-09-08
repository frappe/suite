"""Rename `Drive Entity Log` to `Drive Recent`, before model sync (§14.6).

§3.9 says `Drive Recent` is "today's `Drive Entity Log` under its real
name". A rename keeps every row and every value; adding the new table
beside the old one would leave model sync to create empty columns and
would lose what people had already opened.

It has to happen in `pre_model_sync` because model sync is what applies
`drive_recent.json` and then calls `on_doctype_update`, which adds
`UNIQUE recent_user_node (user, node)`. Two things have to be true by
then: the columns must already carry the new names, or sync adds empty
ones beside the full ones, and no `(user, node)` pair may repeat, or the
unique index cannot be created and the migration stops.

The one delete this patch makes is that dedupe. The legacy table has no
such index, so one person can hold several rows for one file. Only the
newest survives, which is exactly what one Recent means, and the count is
printed. Nothing else is removed: `Drive Entity Log` becomes
`Drive Recent`, so its rows are not copies of anything.

Build's gate runs first. A site that cannot complete Build must be refused
before its schema is changed, not after.

**The rename is not one transaction.** `DocType.after_rename` runs
`RENAME TABLE` and commits it (`frappe/core/doctype/doctype/doctype.py:712`),
and every `ALTER` below commits itself, so a kill part-way through leaves the
table renamed with some of its old column names. The legacy table is gone by
then, so a plan read from that fact alone would skip, model sync would add
`node` and `opened_at` empty beside the full `entity_name` and
`last_interaction`, and every person's recents would be lost while the
migration reported success. The plan therefore reads the columns as well, and
finishes a rename it finds half done.
"""

import frappe

LEGACY = "Drive Entity Log"
TARGET = "Drive Recent"
TARGET_TABLE = f"tab{TARGET}"

# What `plan` answers.
SKIP = "skip"
RENAME = "rename"
CLEAR_TARGET = "clear-target"
RESUME = "resume"

# §14.6: the two columns the rename renames. Finding either one on the target
# table is what says a previous run was killed part-way through.
RENAMED_COLUMNS = (
    ("entity_name", "node", "varchar(140)"),
    ("last_interaction", "opened_at", "datetime(6)"),
)
LEGACY_COLUMNS = tuple(old for old, _new, _type in RENAMED_COLUMNS)

# Verified against MariaDB before this patch was written. The two `name`
# statements are one change in two steps: MariaDB will not retype a column
# that is still `AUTO_INCREMENT`, and dropping that attribute is what the
# first statement does. On a table that never had it the statement is a
# no-op, which is the case on a site whose legacy table frappe created
# without one. All three are safe to repeat on a resumed run: the values are
# still the integers the legacy autoincrement gave them, because nothing
# inserts a hash-named row until model sync applies `drive_recent.json`.
NAME_STATEMENTS = (
    f"ALTER TABLE `{TARGET_TABLE}` ENGINE=InnoDB",
    f"ALTER TABLE `{TARGET_TABLE}` MODIFY COLUMN `name` bigint(20) NOT NULL",
    f"ALTER TABLE `{TARGET_TABLE}` MODIFY COLUMN `name` varchar(140) NOT NULL",
)


def alter_statements(columns) -> tuple[str, ...]:
    """The `ALTER`s a table with these columns still needs.

    A `CHANGE COLUMN` for a column that is already renamed is an error, not a
    no-op, so a resumed run has to leave out the ones the killed run landed.
    """
    held = set(columns)
    return (
        *NAME_STATEMENTS,
        *(
            f"ALTER TABLE `{TARGET_TABLE}` CHANGE COLUMN `{old}` `{new}` {column_type}"
            for old, new, column_type in RENAMED_COLUMNS
            if old in held
        ),
    )


# The full first-run sequence, for a site whose table still holds both legacy
# column names.
ALTER_STATEMENTS = alter_statements(LEGACY_COLUMNS)

# Keep the newest open per `(user, entity_name)`; break a tie by id so the
# result does not depend on row order.
COLLAPSE_DUPLICATES = f"""
    DELETE stale FROM `tab{LEGACY}` stale
    JOIN `tab{LEGACY}` newer
      ON newer.`user` = stale.`user`
     AND newer.`entity_name` = stale.`entity_name`
     AND (
        newer.`last_interaction` > stale.`last_interaction`
        OR (newer.`last_interaction` = stale.`last_interaction` AND newer.`name` > stale.`name`)
     )
"""

COUNT_DUPLICATES = f"""
    SELECT COUNT(*) - COUNT(DISTINCT `user`, `entity_name`) FROM `tab{LEGACY}`
"""


class DriveRecentRenameError(frappe.ValidationError):
    """The rename cannot run without guessing which table holds the truth."""


def plan(legacy_table: bool, target_table: bool, target_rows: int, columns=()) -> str:
    """Decide what to do from the four facts that describe the site.

    `columns` are the columns of whichever of the two tables exists, so the
    caller reads them off the legacy table before the rename and off the
    target table after it.

    - No legacy table and no legacy column left: a fresh site, or a site this
      patch already finished. Skip.
    - No legacy table but a legacy column still on the target: a killed run
      renamed the table and did not finish renaming its columns. Resume.
    - No target table: the upgrade path. Rename.
    - An empty target table: a site that synced `drive_recent.json` before
      this patch shipped. The empty table is dropped and the legacy one
      takes its place, so no row is lost.
    - A target table with rows in it: two sources of truth, and no rule
      here says which one wins. Refuse.
    """
    if not legacy_table:
        if target_table and set(columns) & set(LEGACY_COLUMNS):
            return RESUME
        return SKIP
    if not target_table:
        return RENAME
    if target_rows:
        raise DriveRecentRenameError(
            f"`{TARGET}` already holds {target_rows} rows and `{LEGACY}` still exists. "
            "One of them has to be the truth, and this patch must not choose. "
            "Reconcile the two tables by hand and migrate again."
        )
    return CLEAR_TARGET


def execute() -> None:
    legacy_table = frappe.db.table_exists(LEGACY)
    target_table = frappe.db.table_exists(TARGET)
    columns = _columns(LEGACY if legacy_table else TARGET) if legacy_table or target_table else ()
    action = plan(legacy_table, target_table, frappe.db.count(TARGET) if target_table else 0, columns)
    if action == SKIP:
        return

    _refuse_a_site_that_cannot_build()

    duplicates = 0
    if action != RESUME:
        # The dedupe is committed by the `RENAME TABLE` below, so a resumed
        # run has already had it. Repeating it would read a column the killed
        # run may have renamed out from under it.
        duplicates = frappe.db.sql(COUNT_DUPLICATES)[0][0] or 0
        if duplicates:
            frappe.db.sql(COLLAPSE_DUPLICATES)

        if action == CLEAR_TARGET:
            # Empty, and about to be replaced by the table that has the rows.
            frappe.delete_doc("DocType", TARGET, force=True, ignore_permissions=True)

        frappe.rename_doc("DocType", LEGACY, TARGET, force=True)

    for statement in alter_statements(columns):
        frappe.db.sql_ddl(statement)
    _rename_docfields()
    frappe.db.commit()
    frappe.clear_cache(doctype=TARGET)
    if action == RESUME:
        print(f"Drive: finished a half-done rename of {LEGACY} to {TARGET}")
        return
    print(f"Drive: renamed {LEGACY} to {TARGET}, collapsing {duplicates} duplicate rows")


def _columns(doctype: str) -> tuple[str, ...]:
    return tuple(frappe.db.get_table_columns(doctype))


def _rename_docfields() -> None:
    """Point the stored meta at the new columns.

    Model sync rewrites these rows from `drive_recent.json` moments later.
    They are corrected here so that anything reading meta between the two
    steps, including this patch's own commit, sees a doctype that matches
    the table underneath it.
    """
    for old, new, label in (
        ("entity_name", "node", "Node"),
        ("last_interaction", "opened_at", "Opened At"),
    ):
        frappe.db.set_value(
            "DocField",
            {"parent": TARGET, "fieldname": old},
            {"fieldname": new, "label": label},
            update_modified=False,
        )
    frappe.db.set_value(
        "DocField",
        {"parent": TARGET, "fieldname": "node"},
        "options",
        "Drive Node",
        update_modified=False,
    )


def _refuse_a_site_that_cannot_build() -> None:
    """§14.1's gate, before the schema changes rather than after.

    The environment is built by hand rather than through
    `BuildEnvironment.for_site()`: this runs before model sync, so the
    doctypes the later phases read may not exist yet, and the gate needs
    only the storage settings and the legacy bucket.
    """
    from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
    from suite.drive.patches.build.gate import check_gate
    from suite.drive.patches.build.ports import BotoBucket, SiteFiles, SiteStorage
    from suite.drive.patches.build.state import BuildState
    from suite.drive.utils.files import S3_URL_PREFIX

    check_gate(
        BuildEnvironment(
            storage=SiteStorage(),
            files=SiteFiles(S3_URL_PREFIX),
            state=BuildState.for_site(),
            legacy_s3=LegacyS3Config.for_site(),
            open_bucket=BotoBucket.from_site,
        )
    )
