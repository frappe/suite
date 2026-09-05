# 29 — Complete Build records, accounting, and reporting

**What to build:** Finish the additive migration with usable personal state and reconciled root accounting.

**Blocked by:** [28 — Migrate content history, comments, templates, and media](28-build-content-and-media.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.2 steps 9–13, §14.6, §14.8–14.9.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Perform the pre-model-sync Recent rename without losing source values. Retarget favourites, legacy routes, DAV locks, and properties.
- [ ] Migrate activity payloads and derived verbs with detail.migrated. Start the notification inbox empty as specified.
- [ ] Migrate quota settings from MB to bytes and reservation owners to roots. Create missing reservation roots as pairs.
- [ ] Recompute usage last from nodes, versions, and reservations. Reconcile totals independently.
- [ ] Produce every specified report key and preserve evidence across reruns. Save reports privately; do not log link secrets.
- [ ] Compose the complete Build patch and registration order. Retain legacy source columns until Cleanup.
- [ ] Coordinate content registry activation and compatibility routing only after required links exist.
- [ ] Prove restart behavior at each batch boundary. Keep destructive Cleanup unregistered.

## Verification

Run the full Build fixture suite twice with interrupted progress. Validate reports, source preservation, root-pair integrity, and independent usage sums.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
