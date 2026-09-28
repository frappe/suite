---
id: 015
title: Draft the spec and plan
label: wayfinder:task
status: open
assignee:
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
