# 27 — Migrate root pairs, node trees, and grants

**What to build:** Convert legacy Drive trees and permissions while preserving ids and accepted access semantics.

**Blocked by:** [26 — Prepare legacy bytes for an additive Build](26-build-storage-preparation.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §14.2 steps 4–6, §14.3–14.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Create each root node and metadata pair atomically with the original File id. Validate incomplete pairs before descendants.
- [ ] Walk reachable trees by depth. Keep top-level parent=root-node and root-relative paths within validated capacity.
- [ ] Preserve identities and timestamps; deduplicate Active titles deterministically. Report broken chains and skipped Removed subtrees.
- [ ] Propagate trash from the nearest independently trashed ancestor and preserve earlier trash stamps.
- [ ] Map Drive Permission and Sheet DocShare exactly, including denies, stale principals, migrated anchors, and duplicate rows.
- [ ] Mint required links, drop root-public/link violations and forced-public composite rows, and collect every specified count.
- [ ] Commit resumable batches of 1000 without splitting a root pair. Preserve migration source tables.

## Verification

Run mapping fixtures and interruption/rerun tests for complete, missing, and mismatched root pairs, grants, trash, and duplicate titles.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
