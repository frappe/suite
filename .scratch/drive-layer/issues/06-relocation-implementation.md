# 06 — Implement resumable blob relocation

**What to build:** Provide a framework operation that moves storage locations without changing blob identity.

**Blocked by:** [02 — Keep every referenced blob alive during garbage collection](02-blob-reference-gc.md)

**Status:** ready-for-agent

**Owner:** Frappe storage

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §13.6, §14.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Copy bytes to the configured driver and canonical key. Handle local in-place keys on the same driver too.
- [ ] Lock the blob against GC before changing its driver and key. Delete source bytes only after commit.
- [ ] Commit in bounded batches and resume after interruption. Skip blobs already at the canonical target.
- [ ] Handle an existing target object without duplicate identity. Log per-blob errors and continue.
- [ ] Return moved, bytes, skipped, and errors. Keep Drive-specific knowledge out of the operation.
- [ ] Implement and test the operation only. Actual dataset relocation belongs to the separate execution ticket.

## Verification

Run relocation tests with temporary driver fixtures, interrupted batches, deduplication, failures, and concurrent GC.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
