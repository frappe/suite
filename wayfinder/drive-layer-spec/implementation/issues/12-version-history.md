# 12 — Keep and restore versions with bounded automatic history

**What to build:** Retain file and document versions, restore safely, and reclaim only eligible automatic history.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** ready-for-agent

**Owner:** Suite Drive versions

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.4, §9.1.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement take, list, label/pin, delete, and restore through the Drive workflows.
- [ ] Preserve bytes and sequence uniqueness under concurrent writers. Only label and pinned fields remain mutable as specified.
- [ ] Restore first captures current content. Keep the zero-byte old-head exception and exact quota deltas.
- [ ] Use content callbacks for document bytes. File history uses blob references.
- [ ] Apply the full age ladder. Named, milestone, and pinned versions survive automatic thinning.
- [ ] Register daily thinning through the scheduler adapter, and release each removed version’s charge.

## Verification

Run file and fake-content contract tests with controlled time, concurrent seq allocation, quota rollback, and each ladder boundary.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
