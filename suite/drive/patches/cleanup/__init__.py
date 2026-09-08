"""Cleanup: the destructive half of the Drive migration (spec §14.10).

**Cleanup is not live.** Nothing in `suite/patches.txt` or `suite/hooks.py`
names this package, and nothing here defines `execute`: `bench migrate`
never runs it. It exists behind `run_cleanup(env)` so a later, separately
authorized release (Ticket 36) can wire it in, one release after Build
(§14.10). Until then it ships unregistered, tested only against isolated
fixtures (Ticket 35).

Three gates must hold before Cleanup mutates anything, all reads:

- `gate.check_gate_reachable_nodes` — every reachable Drive `File` has a
  `Drive Node`, recomputed live against the current site, never against
  Build's own persisted state.
- `gate.check_gate_gc_discovery` — `frappe.storage.gc.blob_reference_columns()`
  is callable and names all four of Drive's blob columns (§3.17).
- `gate.check_gate_legacy_callers_removed` — no legacy SPA forwarder is
  still classified as callable (`suite.drive.http.shims.CLASSIFICATION`).

On top of the gates, `run_cleanup` also refuses without explicit
`CleanupEnvironment.authorized` and a recorded `backup_ref`: past this
point §14.11's only rollback is a database restore.

`removal.py` holds the ordered contract itself: Drive-owned `File` rows,
the two root rows, and every Removed row, deepest-first (§14.10 step 1);
the seven `File` custom fields and three property setters (step 2);
`Drive Permission`, `Drive Entity Activity Log`, `Drive Token`, and the
old notification columns, in that order because it is what lets
`Drive Notification.activity` become required (step 3); Sheet `DocShare`,
Writer/Sheet history doctypes, and their comment fields (step 4); the
title/trashed/settings columns (step 5); the legacy API forwarders and the
wildcard prefix (step 6); the `.thumbnail` sidecars (step 7); and the S3
legacy-prefix deletion job, planned by enumerate-then-subtract-then-recheck,
never a blind prefix delete (step 8).
"""

from suite.drive.patches.cleanup.environment import CleanupEnvironment
from suite.drive.patches.cleanup.gate import (
    CleanupAuthorizationError,
    GCDiscoveryGateError,
    LegacyCallerGateError,
    ReachableNodesGateError,
    check_gate_gc_discovery,
    check_gate_legacy_callers_removed,
    check_gate_reachable_nodes,
    check_gates,
    require_authorization,
)
from suite.drive.patches.cleanup.patch import PHASES, run_cleanup
from suite.drive.patches.cleanup.removal import CleanupPatchError
from suite.drive.patches.cleanup.state import CleanupState, PhaseResult

__all__ = [
    "PHASES",
    "CleanupAuthorizationError",
    "CleanupEnvironment",
    "CleanupPatchError",
    "CleanupState",
    "GCDiscoveryGateError",
    "LegacyCallerGateError",
    "PhaseResult",
    "ReachableNodesGateError",
    "check_gate_gc_discovery",
    "check_gate_legacy_callers_removed",
    "check_gate_reachable_nodes",
    "check_gates",
    "require_authorization",
    "run_cleanup",
]
