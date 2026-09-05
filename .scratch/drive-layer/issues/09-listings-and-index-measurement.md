# 09 — Browse permission-filtered trees and measure indexes

**What to build:** Return readable folder pages and discovery views with measured database behavior.

**Blocked by:** [08 — Manage grants and share links with explicit denial](08-grant-and-link-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive engine

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §2.3, §3.1, §5.3–5.7, §11.4.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Use the three-query folder page on folders and root nodes. Prevent per-child permission queries.
- [ ] Implement shared grant roots, archived-root discovery, trash roots, templates, and ancestor-union search.
- [ ] Exclude root nodes from general views and document children from ordinary listings. Deduplicate view results where grants overlap.
- [ ] Advance cursors by SQL window size, including fully hidden windows. Apply the 60 default and 200 maximum.
- [ ] Create Data(500) and the full root/path index on target MariaDB. Validate maximum migrated ids and depth 40.
- [ ] Benchmark real projections and representative root, subtree, and trash distributions using existing indexes first.
- [ ] Record plans, rows examined, latency, index size, and write costs. Retain an extra root-page index only with evidence.

## Verification

Run view/query-count tests and reproducible MariaDB measurements. Record include/omit rationale; report unmet budgets without inventing benchmark results.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
