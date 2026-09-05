# 02 — Keep every referenced blob alive during garbage collection

**What to build:** Allow Drive and other apps to retain blobs through ordinary File Blob Link fields.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** ready-for-agent

**Owner:** Frappe storage

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.17, §13.1.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Discover standard, child-table, Custom Field, Property Setter, and Single references. Skip virtual doctypes.
- [ ] Use the same discovered predicate for candidate selection and the recheck under the blob lock.
- [ ] Include unindexed references and warn once per column per run.
- [ ] If discovery or a referenced table fails, delete no blobs. Continue upload-session expiry.
- [ ] Preserve the 24-hour orphan age and bounded candidate batches. Add no registration hook.

## Verification

Run storage GC/backfill tests. Prove non-File and Single references survive, and discovery failure yields zero deletions.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
