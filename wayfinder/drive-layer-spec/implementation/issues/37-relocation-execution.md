# 37 — Consolidate storage after a successful Build

**What to build:** Move remaining blobs into the configured storage location after migration is verified.

**Blocked by:** [06 — Implement resumable blob relocation](06-relocation-implementation.md); [31 — Rehearse Build on an approved export and verify rollback](31-migration-rehearsal.md)

**Status:** blocked

**Owner:** Frappe storage operations

**Execution gate:** Requires the configured target driver and authorization for actual storage relocation and source deletion.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.6, §14.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Record the approved target driver and dataset. Check backup/recovery and available target capacity.
- [ ] Run bounded relocation batches and retain progress/error reports.
- [ ] Verify bytes, canonical keys, and blob references after each batch. Resume an interrupted run safely.
- [ ] Confirm source deletion occurs only after committed target references.
- [ ] Reconcile total blob identity and byte counts, and rerun to show no remaining eligible work.
- [ ] Keep relocation independent of Build and Cleanup completion. It is not a prerequisite for either patch.

## Verification

Run actual relocation only after authorization. Record moved/skipped/errors and verify stored bytes; substitute-driver tests alone do not complete this ticket.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
