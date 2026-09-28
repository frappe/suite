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

### Critical decisions review, 2026-09-29

An agent reviewed the spec and plan and put nine decisions to Faris. Faris
answered all nine. Agents applied the answers to the spec, the plan,
`MAP.md` and the Drive issues. Each answer is cited `[Faris, 2026-09-29]`.

1. **Release order: one release, fix forward.** One `develop` release
   carries Drive Build and stages 0 to 12, with both keys off. Nothing
   reaches production earlier. Faris then sets flip 1, then flip 2. Both
   flips are rehearsed on the dev site before the release. The keys turn
   areas on in order; they are not the rollback plan. Bugs are fixed
   forward, and error tracking blocks the release. This replaces the
   orchestrator's reading above ("Build and the code of stages 0 to 6 ...
   stages 8 to 12 follow in later releases").
2. **Keys-off changes: accepted.** With both keys off the release is not
   exactly today: Mail and Calendar Settings open the Suite dialog,
   Cmd+Shift+L goes, the Desk row leaves the standalone Apps menu, the PWA
   manifest `id` changes, and `/home` and `/d/<id>` open for a signed-in
   user who types the URL. The stage 5 report lists every difference for
   the release note.
3. **Legacy-call hold: 14 days stay.** The orchestrator added three
   reversible rules: every suite site that Cleanup runs on must read zero;
   Drive issue 45 stores the counter in a doctype that a System Manager
   reads in Desk, and keeps the bench command; issue 45 is a release gate.
4. **Old `/drive/f/` route: kind check added.** In stage 6 a folder id on
   the old route replace-redirects to `/drive/d/<id>`. Faris also said:
   "think forward: bugs may happen, but we fix them fast; ship with error
   tracking". The error tracking tool is open; Faris chooses it.
5. **Redirects: 302 forever.** No row answers 301, before or after the
   deletion commit.
6. **PWA manifest `id`: it changes.** Suite has few users. The release note
   asks users to reinstall the PWA.
7. **Per-type redirects.** `/writer`, `/sheets` and `/slides` go to
   `/drive/recent?type=writer|sheets|slides`. By the same rule
   (orchestrator reading, reversible because redirects are 302),
   `/drive/documents` goes to `?type=writer` and `/drive/presentations` to
   `?type=slides`. `/drive/attachments` still goes to `/drive`; the
   Attachments view loss is accepted. The Recent `type` filter is plan
   stage 11. The server filter is Drive issue 47 (ask D31).
8. **Apps between the flips: avatar submenu.** The old Drive, Slides,
   Writer and Sheets pages are listed in an Apps submenu of the avatar
   menu, not in the rail. It still goes at flip 2.
9. **Public API shape: kept.** `/api/suite/<owner-or-resource>/...`,
   unversioned. The dispatcher reserves the Suite resource names
   (`account`, `site`, `users`, `invitations`, `people`) in plan stage 9.

Inconsistencies fixed: the release-order citation (item 1), the missing
counter gate (item 3), "keys off shows today's Mail" (item 2), the legacy
Vitest manifest count in spec §13.5, and the `/files` route gist in
`MAP.md`. The soft 404 under `/drive` is an open item owned by stage 12.

What is checked: `git diff --check`. No tests, builds or journeys ran; the
work changes documents only.
