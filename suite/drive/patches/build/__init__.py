"""The additive Build patch (spec §14).

Build converts legacy Drive `File` rows into `Drive Node` trees without
deleting anything. Cleanup removes the old data one release later (§14.10).

**This package is dormant.** `suite/patches.txt` does not name it, and it
exports no `execute`, so an ordinary `bench migrate` cannot run a partial
Build. Ticket 29 composes the entry point and ticket 30 registers it.

Implemented so far, §14.2 steps 1 to 3:

- `gate.check_gate` — the two refusals Build makes before it mutates.
- `legacy_bytes.prepare_legacy_bytes` — the framework local backfill and
  the legacy S3 copy, resumable, with the durable result the report reads.

Steps 4 to 13 (roots, nodes, grants, side tables, report) arrive with
tickets 27 to 29 as further modules in this package.
"""

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.gate import BuildGateError, check_gate
from suite.drive.patches.build.legacy_bytes import prepare_legacy_bytes
from suite.drive.patches.build.state import BuildState

__all__ = [
    "BuildEnvironment",
    "BuildGateError",
    "BuildState",
    "LegacyS3Config",
    "check_gate",
    "prepare_legacy_bytes",
]
