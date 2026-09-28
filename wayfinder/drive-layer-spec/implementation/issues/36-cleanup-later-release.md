# 36 — Activate Cleanup after the Build release and client migration

**What to build:** Remove the legacy Drive model after Build and client adoption have been verified.

**Blocked by:** [31 — Rehearse Build on an approved export and verify rollback](31-migration-rehearsal.md); [35 — Implement Cleanup with refusal gates and fixture tests](35-cleanup-implementation.md); [40 — Make Cleanup delete every legacy Drive name and the allowlist prefix](40-cleanup-deletes-every-legacy-name.md); [45 — Count every legacy `suite.drive.api.*` call by name and user agent](45-legacy-call-counter.md); the [unified suite frontend effort](../../../unified-frontend/MAP.md) has migrated every Drive client off the legacy methods

**Status:** blocked

**Owner:** Suite release operations

**Execution gate:** Requires the later release, every Drive client migrated by the [unified suite frontend effort](../../../unified-frontend/MAP.md), verified runtime gates, and authorization for destructive deployment.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.10–14.11; later-release gate.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Before the Build release deploys, Frappe Cloud allowlists `storage_driver` and `storage_driver_config` (Drive spec §14.1). Owner: Drive program. Blocks unified plan stage 7's deploy.
- [ ] Before the Build release deploys, frappe `forge/storage-v2` reaches the production bench `bench-40775`. Owner: Drive program. Blocks unified plan stage 7's deploy.
- [ ] Record the completed Build release and a distinct later release for Cleanup.
- [ ] Validate runtime gates against the deployment dataset and actual clients. Do not substitute ticket status for evidence.
- [ ] Confirm a current restorable backup and authorized deployment target before destructive execution.
- [ ] Register Cleanup and remove obsolete schema, code and shims. No `suite.drive.api.*` name survives; only `/dav` stays (issue 40, unified-frontend ticket 017).
- [ ] Run Cleanup in the specified order and verify GC liveness before deleting legacy S3 objects.
- [ ] Run full Suite, storage, adapter, DAV, and migrated frontend smoke checks. Reconcile usage and bytes afterward.
- [ ] Record recovery steps and deployment evidence. A failed gate leaves Cleanup inactive.

## Verification

Verify the later-release migration and full regression checks on the authorized target. Recovery after Cleanup uses the validated backup.

## Notes

- `develop` deploys to the public bench `bench-40775`. Build runs on every suite site in that bench, not only `frappemail.frappe.cloud` (unified frontend ticket [019](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md)).
- The shell flip and the files flip follow the Build release on `develop`. Build ships with unified plan stage 7's deploy, with both flip keys off (unified frontend ticket 019).

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
