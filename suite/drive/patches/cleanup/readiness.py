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
    _probe_s3_backed_phases(env)


def _probe_forwarders(env) -> None:
    _probe("forwarders.remove", lambda: env.forwarders.remove(()))
    _probe("forwarders.remove_wildcard_prefix", lambda: env.forwarders.remove_wildcard_prefix(""))


def _probe_schema_source_edits(env) -> None:
    _probe("schema.drop_child_table_field", lambda: env.schema.drop_child_table_field("", ""))
    _probe("schema.remove_permission_hooks", lambda: env.schema.remove_permission_hooks(()))


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


def _probe(name: str, call) -> None:
    try:
        call()
    except NotImplementedError as e:
        raise PortNotReadyError(
            f"{name} is not ready: {e}. Activating Cleanup now would destroy data in earlier "
            "phases before failing here; refusing to start any phase."
        ) from e
