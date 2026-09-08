# 35 — Implement Cleanup with refusal gates and fixture tests

**What to build:** Prepare the later destructive Cleanup so unmet gates cause a complete refusal.

**Blocked by:** [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** in-progress

**Owner:** Suite migration (starting revision `6e6906176`, worktree
`integrate/drive-35-cleanup`, claimed files: `suite/drive/patches/cleanup/**`,
`suite/drive/patches/build/tests/test_dormancy.py`)

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.16, §14.10.
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

### 2026-09-09 — noted from Ticket 30's final review pass

`Drive Notification.activity` is `reqd: 1` per §3.11, but is left optional on
the live doctype for the Build release: `suite/drive/api/notifications.py`
and `drive_user_invitation.py` still insert legacy rows with no `activity`.
This gate's "drop the old notification columns" step (§14.10) is what makes
those writers go away; enforcing `reqd: 1` on `activity` belongs in the same
Cleanup change that removes them, not before. Not implemented here; recorded
so Cleanup's ordered-removal work picks it up explicitly instead of
rediscovering it. This does not close this ticket.
