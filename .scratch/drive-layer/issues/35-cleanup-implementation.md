# 35 — Implement Cleanup with refusal gates and fixture tests

**What to build:** Prepare the later destructive Cleanup so unmet gates cause a complete refusal.

**Blocked by:** [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §3.16, §14.10.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement the three gates: every reachable Drive File migrated, GC discovery available, and legacy SPA callers removed.
- [ ] Keep Cleanup unregistered and inactive during the Build release. Do not delete live schema or compatibility code now.
- [ ] Implement the ordered removal contract for Drive-owned File rows, custom fields, property setters, obsolete doctypes, and content source fields.
- [ ] Preserve framework attachments, in-place local bytes, permanent compatibility entries, and /dav.
- [ ] Prepare legacy API removal and S3-prefix deletion for the later activation ticket. Never delete a currently referenced object.
- [ ] Test refusal before each destructive phase, rerun behavior, and the required backup-based recovery procedure.
- [ ] Account for intentional unmigrated/Removed sources explicitly. Missing reachable nodes must block activation.

## Verification

Run Cleanup against isolated fixtures only. Prove every missing gate leaves data unchanged and valid fixtures retain all referenced bytes.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
