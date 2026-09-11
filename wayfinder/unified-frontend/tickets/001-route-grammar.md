---
id: 001
title: Route grammar
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

Decide the URL grammar of the unified frontend. The rebuild starts here
(decided 2026-09-09). The prototype uses `/:area/:sub*`: `/home`,
`/files`, `/files/shared`, `/files/folder/<id>/<id>`, `/doc/<app>/<id>`,
`/mail`, `/calendar`, and `/meet/<code>` outside the shell. Today's prefixes
are `/drive`, `/writer/d/<id>`, `/sheets`, `/slides`, `/meet`, `/mail`,
`/calendar`, plus `/suite` for the launcher and `/drive/l/<token>` for
share links.

Settle:

- The area prefixes, and whether the old prefixes survive as redirects or as
  the new prefixes themselves (rollout is grow beside, then switch).
- The node route. Every document is a Drive Node (node id = File name). Is
  the document route `/doc/<app>/<id>` (app-first), `/d/<node>` (node-first,
  viewer chosen by node kind), or both with one canonical form?
- Folder routes: id chain versus single folder id, and how a Drive Root
  (Shared or Personal) appears in the URL. The workspace switcher is gone,
  so the root must be addressable from Files.
- Saved views (`shared`, `starred`, `trash`, recents) as paths versus query.
- Guest and link entry: where `/drive/l/<token>` lands and what a
  shell-less public view is called.
- What the shell needs from a route record: `meta.area`, `meta.allowGuest`,
  title and favicon, scroll ownership (page versus pane).

Inputs: `frontend/src/router/index.ts` (lazy route groups, auth gate,
onboarding gate, Mail PWA scoping), `frontend/src/apps/*/routes.ts`, the
prototype's `useShellNav.ts`, Drive spec §11.2 (route table) and §6.2
(link seeding).
