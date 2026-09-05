# 11 — Move, copy, trash, and explicitly restore node trees

**What to build:** Let users organize and recover files without corrupting ancestry, access, or byte accounting.

**Blocked by:** [10 — Upload and replace files under Drive authority and quota](10-upload-and-quota.md)

**Status:** ready-for-agent

**Owner:** Suite Drive node workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §7.6, §8.6–8.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Create folders and links; enforce kind invariants, leaf rules, title rules, and depth limits.
- [ ] Move uses root-relative prefixes, checks cycles and destination rights, and rewrites Active and Trashed descendants atomically.
- [ ] Cross-root moves transfer head and version charges once. Reservations stay with their original root.
- [ ] Copy checks source READ and destination UPLOAD. Skip unreadable descendants; copy no grants, versions, or comments.
- [ ] Trash preserves earlier independent trash stamps. Restore restores only the matching trash root and timestamp.
- [ ] When the original chain is unavailable, require a user-selected Active destination in the same root before any mutation.
- [ ] Cancel or missing destination leaves Trash unchanged. Validate access and deduplicate at the selected destination.
- [ ] Implement ordered purge through registered content callbacks, with reference cleanup and quota release. Refuse ordinary root purge.
- [ ] Register the daily 30-day trash purge through the scheduler adapter, processing each trash root once.

## Verification

Run lifecycle tests for nested trash, selected restore, rollback, title collisions, depth boundaries, root destinations, cross-root accounting, and purge ordering.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
