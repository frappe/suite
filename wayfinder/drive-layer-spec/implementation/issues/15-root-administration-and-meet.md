# 15 — Archive roots and charge Meet reservations to roots

**What to build:** Keep offboarded sharing intact and account for Meet recordings through the public Drive interface.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** ready-for-agent

**Owner:** Suite Drive and Meet

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.2, §3.12–3.14, §7.4–7.9, §11.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Archive metadata only. Keep root node, grants, content, and byte charges unchanged.
- [ ] Wire install, boot, and offboarding through Suite composition. Keep product lifecycle orchestration outside product-neutral suite_core.
- [ ] Create fresh Personal Root identity for recreated users. Preserve specified access to archived descendants.
- [ ] Provide Suite Admin quota changes and explicit archived-root purge. Reject Active-root purge.
- [ ] Purge the pair atomically after descendant references, root grants/activity, and remaining root-linked records.
- [ ] Implement reservation create, grow, reduce, and release on root metadata through package-root workflows.
- [ ] Migrate all Meet reservation callers and backfill behavior to the Room Owner’s Personal Root. Remove redundant owner-lock calls.
- [ ] Recompute Active and Archived root usage daily, including all nodes, versions, and reservations. Log drift.

## Verification

Run root/Meet tests for concurrent admission, reservation consumption, offboarding, recreated identity, purge rollback, and recompute reconciliation.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
