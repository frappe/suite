"""Cleanup: the destructive half of the Drive migration (spec §14.10).

`suite/patches.txt` names this package right after `suite.drive.patches.build`,
both under `[post_model_sync]`. Frappe's model sync never drops a column, and
orphan doctypes are removed only after the patches run, so when one `bench
migrate` reaches these two patches the legacy tables and columns are all
still there: Build reads them, Cleanup drops them, and the site comes out
the other side with only the new model.

`run_cleanup` refuses in three layers, all before phase 1 mutates anything,
each checked once per call:

- `state.CleanupState.refuse_if_corrupt` — an unreadable existing state
  record is quarantined and refused, never treated as a fresh site.
- `gate.check_gate_reachable_nodes` — every reachable Drive `File` has a
  `Drive Node`, recomputed live against the current site, never against
  Build's own persisted state.
- `gate.check_gate_gc_discovery` — `frappe.storage.gc.blob_reference_columns()`
  is callable and names all four of Drive's blob columns (§3.17).

On top of these, `gate.require_backup` refuses until an operator has named
the backup they took before this migrate, in site config:

    bench --site <site> set-config drive_cleanup_backup "<backup>"

`<backup>` is free text naming the backup (a path, an S3 URL, an id). Past
phase 1, §14.11's only rollback is restoring it — there is no partial-undo
function anywhere in this package, on purpose. The value is recorded in the
state file next to the phase results.

Cleanup deletes no bucket object. Build copied every legacy S3 object to its
canonical key and left the original in place, so the database + files
backup stays a complete rollback through the whole migrate. Deleting the
legacy objects is a separate, manual step an operator runs later, once the
site has been checked:

    bench --site <site> execute suite.drive.patches.cleanup.delete_legacy_objects.run
    bench --site <site> execute suite.drive.patches.cleanup.delete_legacy_objects.run \\
        --kwargs "{'confirm': True}"

The first form is a dry run that reports, per legacy key layout, what it
would delete and what it must keep; the second deletes. It reads Build's
copy ledger, never a bucket listing, re-verifies every canonical copy by
size before each batch, and refuses while Cleanup is incomplete, the ledger
is missing, storage is not the ledger's S3 bucket, or no `File Blob` row
with `driver = "s3"` exists (a database restored from backup). After it
runs, the legacy objects are gone and only the canonical copies remain, so
the backup restore is no longer a complete rollback.

`removal.py` holds the ordered contract itself: Drive-owned `File` rows,
the two root rows, and every Removed row, deepest-first, plus the name
census and disk-settings snapshot every later phase needs (step 1); the
`File` rows of Presentation pictures Build turned into nodes, unless a slide
body still names one (also step 1); the
seven `File` custom fields and three property setters (step 2); every
legacy Drive doctype and the old notification columns, after which
`Drive Notification.activity` becomes required (step 3); the verification
that no governed `DocShare` row survived Build, the Writer/Sheet history
doctypes, and the comment stores Build migrated (step 4); the
title/trashed/settings columns, all ten of §3.13's `Drive Disk Settings`
fields among them (step 5); and the local `.thumbnail` sidecars, from the
persisted census and settings snapshot (step 7). §14.10's step 6, the
legacy API forwarders, needs no phase: they left with the legacy source.
"""

from suite.drive.patches.cleanup.environment import BACKUP_CONFIG_KEY, CleanupEnvironment
from suite.drive.patches.cleanup.gate import (
    CleanupAuthorizationError,
    GCDiscoveryGateError,
    ReachableNodesGateError,
    check_gate_gc_discovery,
    check_gate_reachable_nodes,
    check_gates,
    require_backup,
)
from suite.drive.patches.cleanup.patch import PHASES, execute, run_cleanup
from suite.drive.patches.cleanup.removal import CleanupPatchError
from suite.drive.patches.cleanup.state import CleanupState, PhaseResult

__all__ = [
    "BACKUP_CONFIG_KEY",
    "PHASES",
    "CleanupAuthorizationError",
    "CleanupEnvironment",
    "CleanupPatchError",
    "CleanupState",
    "GCDiscoveryGateError",
    "PhaseResult",
    "ReachableNodesGateError",
    "check_gate_gc_discovery",
    "check_gate_reachable_nodes",
    "check_gates",
    "execute",
    "require_backup",
    "run_cleanup",
]
