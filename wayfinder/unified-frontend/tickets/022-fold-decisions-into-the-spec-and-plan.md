---
id: 022
title: Fold decisions into the spec and plan
label: wayfinder:task
status: closed
assignee: faris (fable, 2026-09-29)
blocked-by: [017, 018, 019, 020, 021]
---

## Question

The destination ticket after
[Draft the spec and plan](015-draft-the-spec-and-plan.md). Fold the
resolutions of tickets 017 to 021 into `unified-frontend-spec.md` and
`unified-frontend-plan.md`, clear the matching Open items, and re-audit the
changed sections against their tickets. Done when the Open items in both
documents hold only implementation-time work, environment approvals and
post-launch fog.

## Resolution

Resolved on 2026-09-29. Fable agents folded the resolutions of tickets 017
to 021 into both documents, filed Drive issues 41 to 46 for asks D10 to
D28, and synced the Drive plan, the Drive README, issue 36 and the legacy
caller inventory. An Opus agent audited the result against Faris's answers
and found 13 issues; another Opus agent fixed all 13. The orchestrator
settled two points the audit raised:

- **Release order.** Build and the code of stages 0 to 6 reach `develop`
  in one release with both keys off; stages 8 to 12 follow in later
  releases. This reads Faris's one-branch answer (ticket 019).
- **Build prerequisites.** The Frappe Cloud `storage_driver` allowlist and
  frappe `forge/storage-v2` reaching bench `bench-40775` belong to the
  Drive program. Issue 36 lists them, and they block stage 7's deploy.

What is checked: the stage 6 grep gate was run and matches only area
routes; `git diff --check` is clean. No tests, builds or journeys ran; the
work changes documents only.

Open items left in the documents need no decision before stage 0:

- Environment approvals for Faris: the `vue-tsc` type gate (before stage
  4), a Mail account for the browser journeys (before stage 5), the
  streaming sha256 hasher package (before stage 10).
- Drive program: the two Build prerequisites above (before stage 7).
- Design calls owned by a stage: `DocumentSession` signatures, the
  in-shell `frame` literal, server-state tuning, the share dialog
  container on phone.
- Post-launch fog: listed on the map under Not yet specified.
