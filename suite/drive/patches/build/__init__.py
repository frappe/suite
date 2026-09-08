"""The additive Build patch (spec §14).

Build converts legacy Drive `File` rows into `Drive Node` trees without
deleting anything. Cleanup removes the old data one release later (§14.10).

**Build is live; Cleanup is not.** `suite/patches.txt` names this package,
so `bench migrate` runs the whole additive migration. `cleanup` stays
unregistered and unwritten: it is the destructive half, and §14.10 puts it
one release later.

The phases cover §14.2 steps 1 to 13:

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
- `history.convert_history_and_comments` — step 7: Writer and Sheet
  history as `Drive Node Version` rows, and both comment stores as
  `Drive Comment Thread` and `Drive Comment` rows.
- `slides.convert_slides_and_templates` — step 8: templates, deck media
  children, deck previews, and the journaled Slide body rewrite.
- `records.convert_records` — step 9: favourites, recents, activity,
  legacy routes, and the DAV tables, retargeted at nodes.
- `content.link_content_documents` — step 10: the reciprocal `node`
  links, orphan adoption, and content `DocShare` rows as grants.
- `settings.convert_settings` — step 11: quotas from MB to bytes, and
  storage reservations moved from an owner to a root.
- `usage.recompute_usage` — step 12: `used_bytes` recomputed from nodes,
  versions, and reservations, then reconciled a second way.
- `report.produce_report` — step 13: §14.9's keys, printed to the
  migration log and saved under the site's private directory.
- `patch.execute` — the order, and the two `completed` flags the phases
  read but do not set.

The three content phases run in that order, 7 then 8 then 10, and no
phase runs another. Step 10 adopts orphans and then reruns step 7 for the
history they carry, so it needs the template nodes step 8 creates. Both
template kinds reach step 10 with no `File` row, and step 10 validates the
link step 8 left instead of adopting them. A deck adopted at step 10 has no
media in the same pass: step 8 defers it and the next pass converts it.

"""

from suite.drive.patches.build.content import link_content_documents
from suite.drive.patches.build.environment import BuildEnvironment, LegacyS3Config
from suite.drive.patches.build.gate import BuildGateError, check_gate
from suite.drive.patches.build.grants import convert_grants
from suite.drive.patches.build.history import convert_history_and_comments
from suite.drive.patches.build.legacy_bytes import prepare_legacy_bytes
from suite.drive.patches.build.patch import BuildPatchError, execute, run_build
from suite.drive.patches.build.records import convert_records
from suite.drive.patches.build.report import produce_report
from suite.drive.patches.build.root_pairs import BuildPairError, convert_root_pairs
from suite.drive.patches.build.settings import convert_settings
from suite.drive.patches.build.slides import convert_slides_and_templates
from suite.drive.patches.build.state import BuildState
from suite.drive.patches.build.tree import convert_trees
from suite.drive.patches.build.usage import recompute_usage

__all__ = [
    "BuildEnvironment",
    "BuildGateError",
    "BuildPairError",
    "BuildPatchError",
    "BuildState",
    "LegacyS3Config",
    "check_gate",
    "convert_grants",
    "convert_history_and_comments",
    "convert_records",
    "convert_root_pairs",
    "convert_settings",
    "convert_slides_and_templates",
    "convert_trees",
    "execute",
    "link_content_documents",
    "prepare_legacy_bytes",
    "produce_report",
    "recompute_usage",
    "run_build",
]
