# 29 — Complete Build records, accounting, and reporting

**What to build:** Finish the additive migration with usable personal state and reconciled root accounting.

**Blocked by:** [28 — Migrate content history, comments, templates, and media](28-build-content-and-media.md)

**Status:** in-progress

**Owner:** Suite migration. Claimed 2026-09-08 by the Ticket 29 implementation agent on
`implement/drive-29-build-records`, forked from `forge/drive-layer` at `9cba9ee91`.

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

## Claimed files

New: `suite/drive/patches/rename_entity_log_to_recent.py`,
`suite/drive/patches/build/records.py`, `.../settings.py`, `.../usage.py`,
`.../report.py`, `.../patch.py`, and their tests under
`suite/drive/patches/build/tests/`.

Edited: `suite/drive/patches/build/__init__.py`, `ports.py`, `state.py`,
`environment.py`, `tests/fakes.py`, `tests/test_dormancy.py`,
`suite/patches.txt`, `suite/hooks.py`, and the Drive record doctype JSON that
step 9 retargets.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
