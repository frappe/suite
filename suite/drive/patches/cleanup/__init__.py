"""Cleanup: the destructive half of the Drive migration (spec §14.10).

**Cleanup is not live.** Nothing in `suite/patches.txt` or `suite/hooks.py`
names this package, and nothing here defines `execute`: `bench migrate`
never runs it. It exists behind `run_cleanup(env)` so a later, separately
authorized release (Ticket 36) can wire it in, one release after Build
(§14.10). Until then it ships unregistered, tested only against isolated
fixtures (Ticket 35).

`run_cleanup` refuses in four layers, all before phase 1 mutates anything,
each checked once per call:

- `readiness.run_preflight` — can every port a pending phase would call
  actually do its job. Several real ports honestly raise
  `NotImplementedError` (forwarder-body and wildcard-prefix removal,
  `Writer Document.versions`/permission-hook source edits, the S3-backed
  bucket operations): these are source changes or bucket clients Ticket 36
  supplies, not runtime operations Ticket 35 can perform. Preflight fails
  here, before any destructive phase, instead of partway through one.
- `gate.check_gate_reachable_nodes` — every reachable Drive `File` has a
  `Drive Node`, recomputed live against the current site, never against
  Build's own persisted state.
- `gate.check_gate_gc_discovery` — `frappe.storage.gc.blob_reference_columns()`
  is callable and names all four of Drive's blob columns (§3.17).
- `gate.check_gate_legacy_callers_removed` — real source/bundle evidence
  (`ports.ClientCallerEvidence`) shows no caller left for any name
  `suite.drive.http.shims.CLASSIFICATION` still spells "forwarder." That
  evidence, not the classification label itself, is what clears the gate;
  phase 6 still removes whatever the label says once this gate passes.

On top of these, `run_cleanup` also refuses without explicit
`CleanupEnvironment.authorized` and a recorded `backup_ref`: past this
point §14.11's only rollback is a database restore, and nothing smaller —
there is no partial-undo function anywhere in this package, on purpose.

`removal.py` holds the ordered contract itself: Drive-owned `File` rows,
the two root rows, and every Removed row, deepest-first, plus the
name census and disk-settings snapshot every later phase needs (step 1);
the seven `File` custom fields and three property setters (step 2);
`Drive Permission`, `Drive Entity Activity Log`, `Drive Token`, the old
notification columns, and preparing their now-dead permission hooks for
removal, in that order because it is what lets `Drive Notification.activity`
become required (step 3); Sheet `DocShare`, `Writer Document.versions`
ahead of the `Writer Doc Version` doctype it points at, the rest of the
Writer/Sheet history doctypes, and the cell-comment schema inside
`Sheet.sheets_data` (step 4); the title/trashed/settings columns, all ten
of §3.13's `Drive Disk Settings` fields among them (step 5); the legacy API
forwarders and the wildcard prefix (step 6); the `.thumbnail` sidecars,
from the persisted census and settings snapshot (step 7); and the S3
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
from suite.drive.patches.cleanup.readiness import PortNotReadyError, run_preflight
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
    "PortNotReadyError",
    "ReachableNodesGateError",
    "check_gate_gc_discovery",
    "check_gate_legacy_callers_removed",
    "check_gate_reachable_nodes",
    "check_gates",
    "require_authorization",
    "run_cleanup",
    "run_preflight",
]
