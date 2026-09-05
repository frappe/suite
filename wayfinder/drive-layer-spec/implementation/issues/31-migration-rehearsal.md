# 31 — Rehearse Build on an approved export and verify rollback

**What to build:** Validate the migration against representative existing data before a release.

**Blocked by:** [30 — Verify the complete backend before migration rehearsal](30-backend-integration-review.md)

**Status:** blocked

**Owner:** Suite migration operations

**Execution gate:** Requires an approved export and explicit authority to overwrite the selected test target. No dataset has been supplied.

**Source:** [Drive spec](../../drive-layer-spec.md), §14; plan Build rehearsal.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Record the supplied dataset, target, restore authority, and a recoverable target backup before restoring anything.
- [ ] Restore only to the approved target. Use slides.localhost unless separate site authorization exists.
- [ ] Run Build, read the private report, and compare source/target counts, access, bytes, ids, document bodies, and root pairs.
- [ ] Report links minted, dropped-grant categories, title renames, and trash disagreements to the user.
- [ ] Exercise representative legacy and new clients, then verify a safe rerun.
- [ ] Rehearse rollback with the preserved database and bytes. Account for renamed tables, body rewrites, and writes after Build.
- [ ] Record the exact release candidate and evidence needed for later Cleanup. Do not activate Cleanup or relocate bytes.

## Verification

Run a real restore/migrate/reconciliation/recovery exercise and attach measured evidence. Remain blocked if no approved dataset or restore target exists.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
