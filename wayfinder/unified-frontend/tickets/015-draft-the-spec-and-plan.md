---
id: 015
title: Draft the spec and plan
label: wayfinder:task
status: closed
assignee: faris (opus, 2026-09-29)
blocked-by: [001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 016]
---

## Question

The destination ticket. Write `unified-frontend-spec.md` and
`unified-frontend-plan.md` in `wayfinder/unified-frontend/`.

The spec holds: route grammar, shell and platform interfaces, REST endpoint
structure beyond Drive, the Files area, upload and restore and batch flows,
sharing and link credentials, the content page contract, the Mail, Meet and
Calendar adoption contract, guest and link routes, Home and palette and
notifications at launch, module layout and boundaries, and the rollout and
redirect plan. It links the base prototype for layout and never restates
it. Drive behavior cites the Drive spec by section.

The plan holds: stages in order, file ownership per stage, the gates from
ticket 014, the branch rules, and the handoff to the Drive program's
Cleanup activation.

Inputs: every closed ticket on this map, the two research references, the
base prototype, ARCHITECTURE.md, and the Drive spec. Agents may draft;
the orchestrator audits against each ticket's resolution.

Handed from [Guest and link routes](011-guest-and-link-routes.md)
(2026-09-28): the plan starts from placeholders. `/l/:token` renders
`UnavailableSurface` (`composition/routes.ts:107`), `GuestSurface.vue` is a
static card, nothing reads `#link=`, and the default transport sends no
`X-Drive-Links`.

## Resolution

Resolved on 2026-09-29. Opus agents drafted, audited and fixed both
documents. The orchestrator wrote the rulings and placed the loose ends. A
second session (suite-9f) worked the same ticket in parallel; it stopped,
and its spec fix commit `0b583c6ef` was kept and reconciled.

- [`unified-frontend-spec.md`](../unified-frontend-spec.md): 16 sections,
  every rule cites its ticket (`[T006]`) or the Drive spec by section.
  Section 15 holds every backend ask (D1 to D29, S1 to S4, M1, C1 to C3,
  L1, L2) with status. Section 16 holds 24 open items.
- [`unified-frontend-plan.md`](../unified-frontend-plan.md): starting state
  verified at HEAD, 16 stages (0 to 15) in lanes with file ownership and a
  shared-files order, ticket 014's gates, asks by stage, branch rules, and
  the handoff to Drive Cleanup (issue 36).

How it was checked: four audit agents compared the drafts with every
closed resolution, ARCHITECTURE.md and the Drive spec, and spot-checked
the plan's starting-state claims against the code. The only command run
was the import-boundary check (exit 0, 315 owned violations and 83
unstable frappe-ui imports baselined). No tests, builds or journeys ran.

Findings the drafts got wrong and the audits fixed, among others: the
`/drive/signup` lifetime (ticket 014 replaces ticket 011's rule), the
Replace gate (EDIT on the file, not "hidden for guests"), the direction of
the 17 Calendar imports, an invented `'Refused'` session state, the
translate-table redirect rows (Drive keeps `Drive Legacy Route` through
Cleanup), and plan ask ids that did not match the spec.

Orchestrator rulings, small and reversible, recorded in
[`references/015-orchestrator-rulings.md`](../references/015-orchestrator-rulings.md)
for Faris to veto: Writer's New label is "Document"; client navigation to
`/l/<token>` is a full page load; the bottom nav opens `<AreaSidebar>`
through the existing `suite:open-active-area-panel` event; Drive owns the
file surface on `/d/`; Files gets the document registry through
`DOCUMENT_TYPES_KEY`; products export a lazy settings loader from the
package root; `/files/f/<root>` redirects to the root route; no interim
behavior before an ask ships (the feature stays disabled); `node_url` sits
on the Drive interface.

The destination is not reached. Five decisions surfaced that only Faris
can make. They are new tickets, and a final task folds them in:

- [Product methods and the zero-call gate](017-product-methods-and-the-zero-call-gate.md)
- [Flip 1 rollback with deleted app chrome](018-flip-1-rollback-with-deleted-app-chrome.md)
- [Branches, backend asks and the release path](019-branches-backend-asks-and-release-path.md)
- [Unmapped legacy routes and the /files path](020-unmapped-legacy-routes-and-the-files-path.md)
- [Account menu, Files entry points and icons](021-account-menu-files-entry-points-and-icons.md)
- [Fold decisions into the spec and plan](022-fold-decisions-into-the-spec-and-plan.md), blocked by the five.
