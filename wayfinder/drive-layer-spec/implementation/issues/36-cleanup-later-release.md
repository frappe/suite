# 36 — Activate Cleanup after the Build release and client migration

**What to build:** Remove the legacy Drive model after Build and client adoption have been verified.

**Blocked by:** [31 — Rehearse Build on an approved export and verify rollback](31-migration-rehearsal.md); [35 — Implement Cleanup with refusal gates and fixture tests](35-cleanup-implementation.md); the unified suite frontend effort (separate wayfinder map, not yet charted) has migrated every Drive client off the legacy methods

**Status:** blocked

**Owner:** Suite release operations

**Execution gate:** Requires the later release, every Drive client migrated by the unified suite frontend effort (separate wayfinder map), verified runtime gates, and authorization for destructive deployment.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.10–14.11; later-release gate.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Record the completed Build release and a distinct later release for Cleanup.
- [ ] Validate runtime gates against the deployment dataset and actual clients. Do not substitute ticket status for evidence.
- [ ] Confirm a current restorable backup and authorized deployment target before destructive execution.
- [ ] Register Cleanup, remove obsolete schema/code and shims, and retain every permanent compatibility path.
- [ ] Run Cleanup in the specified order and verify GC liveness before deleting legacy S3 objects.
- [ ] Run full Suite, storage, adapter, DAV, and migrated frontend smoke checks. Reconcile usage and bytes afterward.
- [ ] Record recovery steps and deployment evidence. A failed gate leaves Cleanup inactive.

## Verification

Verify the later-release migration and full regression checks on the authorized target. Recovery after Cleanup uses the validated backup.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
