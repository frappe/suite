"""The additive Build patch (spec §14).

Build converts legacy Drive `File` rows into `Drive Node` trees without
deleting anything. Cleanup removes the old data one release later (§14.10).

**This package is dormant.** `suite/patches.txt` does not name it, and it
exports no `execute`, so an ordinary `bench migrate` cannot run a partial
Build. Ticket 29 composes the entry point and ticket 30 registers it.

Implemented so far, §14.2 steps 1 to 6:

- `gate.check_gate` — the two refusals Build makes before it mutates.
- `legacy_bytes.prepare_legacy_bytes` — the framework local backfill and
  the legacy S3 copy, resumable, with the durable result the report reads.
- `root_pairs.convert_root_pairs` — step 4: the root node and metadata
  pairs, written as one unit, repaired or refused on a mismatch.
- `tree.convert_trees` — step 5: the reachable trees, walked by depth,
  with the trash rule, the title dedupe, and the census of what was left.
- `grants.convert_grants` — step 6: `Drive Permission` and Sheet
  `DocShare` as `Drive Grant` rows, with the §5.9 guardrails applied by
  hand because bulk SQL fires no refusal.

Steps 7 to 13 (side tables, content apps, usage, report) arrive with
tickets 28 and 29 as further modules in this package.
"""

from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.gate import BuildGateError, check_gate
from suite.drive.patches.build.grants import convert_grants
from suite.drive.patches.build.legacy_bytes import prepare_legacy_bytes
from suite.drive.patches.build.root_pairs import BuildPairError, convert_root_pairs
from suite.drive.patches.build.state import BuildState
from suite.drive.patches.build.tree import convert_trees

__all__ = [
    "BuildEnvironment",
    "BuildGateError",
    "BuildPairError",
    "BuildState",
    "LegacyS3Config",
    "check_gate",
    "convert_grants",
    "convert_root_pairs",
    "convert_trees",
    "prepare_legacy_bytes",
]
