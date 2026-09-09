"""Preflight probes: can Cleanup's real ports actually finish what phase 1
would start, checked before phase 1 runs at all.

The three §14.10 gates (`gate.py`) answer "may Cleanup start" — every
reachable row migrated, the GC ready, the SPA caller-free. None of them asks
"can the ports past phase 1 actually do their job:" a site can pass every
gate and still be wired to a `CleanupEnvironment` whose forwarder-removal,
permission-hook-removal, child-table-field-removal, or S3 ports are the
honest `NotImplementedError` stubs `ports.py` ships until Ticket 36 replaces
them with real source edits. Without this check, `run_cleanup` would delete
File rows, custom fields, and doctypes in phases 1 through 5 before crashing
on the first `NotImplementedError` in phase 6 — irreversible destruction
followed by a refusal, which is exactly backwards. `run_preflight` proves
every port a pending phase would call is ready before any of them runs, by
calling each one with a no-op payload: the real ports raise `NotImplementedError`
unconditionally, on any input, so a no-op call is a complete probe with no
side effect worth guarding against; a fixture's fake ports accept the same
no-op call and do nothing, exactly as they would for a real, empty batch.
"""

from __future__ import annotations

import frappe


class PortNotReadyError(frappe.ValidationError):
    """A port a pending phase needs cannot do its job right now."""


def run_preflight(env) -> None:
    _probe_forwarders(env)
    _probe_schema_source_edits(env)
    _probe_source_schema_readiness(env)
    _probe_notification_writer_readiness(env)
    _probe_s3_backed_phases(env)


def _probe_forwarders(env) -> None:
    _probe("forwarders.remove", lambda: env.forwarders.remove(()))
    _probe("forwarders.remove_wildcard_prefix", lambda: env.forwarders.remove_wildcard_prefix(""))


def _probe_schema_source_edits(env) -> None:
    _probe("schema.drop_child_table_field", lambda: env.schema.drop_child_table_field("", ""))
    _probe("schema.remove_permission_hooks", lambda: env.schema.remove_permission_hooks(()))


def _probe_source_schema_readiness(env) -> None:
    """Step 3's and step 5's column/Single-value drops are real, implemented
    runtime operations, not `NotImplementedError` stubs, so `_probe`'s
    catch-a-stub-error shape does not apply to them. What can still make one
    unsafe to run is the doctype JSON (or, for step 3, `suite/hooks.py`)
    still declaring what a phase is about to drop: the next `bench migrate`
    recreates a dropped column from JSON still naming it, and any later save
    of a Single doctype rewrites all of its declared fields back into
    `tabSingles`. This must fail before phase 1, not after phases 1-4 have
    already deleted rows and doctypes on a site where Ticket 36's source
    edits have not actually landed yet.
    """
    from suite.drive.patches.cleanup.ports import _doctype_name_from_path
    from suite.drive.patches.cleanup.removal import (
        CONTENT_DROPPED_COLUMNS,
        NOTIFICATION_LEGACY_COLUMNS,
        RETAINED_DOCTYPES_STEP_3,
        SETTINGS_DROPPED_COLUMNS,
        SINGLE_DROPPED_VALUES,
    )

    targets = (
        ("Drive Notification", NOTIFICATION_LEGACY_COLUMNS),
        *CONTENT_DROPPED_COLUMNS,
        *SETTINGS_DROPPED_COLUMNS,
        *SINGLE_DROPPED_VALUES,
    )
    for doctype, fields in targets:
        declared = env.source_schema.fields_declared(doctype, fields)
        if declared:
            raise PortNotReadyError(
                f"{doctype}'s shipped doctype JSON still declares {sorted(declared)}; dropping "
                "them now would be recreated (or, for a Single, rewritten) by the next source "
                "sync. Ticket 36 must remove them from source before Cleanup can run."
            )
    step_3_doctype_names = tuple(_doctype_name_from_path(path) for path in RETAINED_DOCTYPES_STEP_3)
    hooked = env.source_schema.permission_hooks_present(step_3_doctype_names)
    if hooked:
        raise PortNotReadyError(
            f"suite/hooks.py still names {sorted(hooked)} in permission_query_conditions/"
            "has_permission; Ticket 36 must remove those entries before Cleanup can run."
        )


def _probe_notification_writer_readiness(env) -> None:
    """§14.10 step 3 drops `NOTIFICATION_LEGACY_COLUMNS` and makes
    `Drive Notification.activity` required in the same phase. Ticket 30's
    addendum named two writers (`suite.drive.api.notifications.
    create_notification`, `DriveUserInvitation.after_insert`) that still
    build a row naming those columns and setting no `activity` at all;
    letting phase 3 run while either is still unmigrated would make the very
    next call either resurrect a dropped column as an undeclared attribute
    or fail outright on the new mandatory-field check. Ticket 35 leaves both
    writers unchanged, so this probe honestly refuses today, on every site,
    until Ticket 36 migrates them.
    """
    unready = env.notification_writers.still_unready()
    if unready:
        raise PortNotReadyError(
            f"{sorted(unready)} still build a Drive Notification row naming a step-3 dropped "
            "column, or with no `activity` set; Ticket 36 must migrate these writers before "
            "phase 3 can drop the legacy columns and require `activity`."
        )


def _probe_s3_backed_phases(env) -> None:
    """Only when S3 is actually configured: on a local site, step 7's
    sidecar deletion and step 8's whole phase are no-ops (`ports.
    SiteThumbnailStore.delete_sidecars`/`phase_s3_prefix` both branch on
    `enabled`), so there is nothing unready to probe. Reads the persisted
    settings snapshot if one already exists (a resumed run past phase 1
    must not query `Drive Disk Settings` columns step 5 may already have
    dropped); falls back to a live read only when no run has reached phase
    1 yet, while every column is still there to read.
    """
    settings = env.state.get_settings_snapshot()
    if settings is None:
        settings = env.disk_settings.read()
    if not settings.get("enabled"):
        return
    _probe("thumbnails.delete_sidecars", lambda: env.thumbnails.delete_sidecars((), settings=settings))
    _probe("s3.list_prefix", lambda: env.s3.list_prefix("", "", 0))
    # Probed independently of `list_prefix`: a site could have a working
    # bucket lister and a still-`NotImplementedError` deletion job (or vice
    # versa). Without this, phase 8 could enumerate and subtract references
    # correctly and then crash on `enqueue_delete` after phases 1-7 already
    # ran to completion.
    _probe("s3.enqueue_delete", lambda: env.s3.enqueue_delete(()))


def _probe(name: str, call) -> None:
    try:
        call()
    except NotImplementedError as e:
        raise PortNotReadyError(
            f"{name} is not ready: {e}. Activating Cleanup now would destroy data in earlier "
            "phases before failing here; refusing to start any phase."
        ) from e
