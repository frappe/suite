---
id: 001
title: Route grammar
label: wayfinder:grilling
status: closed
assignee: codex (agent, 2026-09-11)
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

## Resolution

Resolved with the user on 2026-09-11. The route grammar is:

- The canonical area routes are `/home`, `/files`, `/mail`, and `/calendar`.
  Meet calls remain full-screen at `/meet/<code>`. Historical prefixes such
  as `/suite` and `/drive/...` survive only as redirects to their canonical
  equivalents. `/` replacement-redirects to canonical `/home`.
- An open document uses the node-first route
  `/d/<node-id>/<slugified-title>`. The node id is authoritative and the slug
  is decorative: a missing or stale slug still resolves, then the router
  replaces the URL with the current slug without adding browser history. This
  is the single content route for Writer, Sheets and Slides documents and for
  previewable uploaded files; the node response selects the renderer. Slugs are
  Unicode-aware: normalize and lowercase, keep letters and numbers from every
  script, collapse punctuation and whitespace to hyphens, and omit the slug
  when no readable characters remain. Cap the decorative segment at 80 Unicode
  characters and truncate only at a character boundary.
- Active Drive Roots use memorable semantic routes rather than exposing their
  opaque node ids: `/files` is **My files** (the Personal Root) and
  `/files/organization` is **Organization files** (the business site's single
  Shared Root). `/files/shared-with-me` is **Shared with me**, a computed view
  of direct grants and never a third root. Personal sites omit the organization
  destination. Ordinary folder routes remain node-id-based so moves and renames
  do not break them: `/files/f/<node-id>/<decorative-slug>` identifies only
  the open folder, while the API supplies its breadcrumb chain. Research:
  [`../references/file-navigation-naming-benchmark.md`](../references/file-navigation-naming-benchmark.md).
- Saved destinations use dedicated paths: `/files/recent`, `/files/starred`,
  `/files/shared-with-me`, and `/files/trash`. Query parameters describe
  presentation or filtering state such as layout, sort, and grouping; they do
  not select the saved destination.
- Share links use `/l/<token>` as a temporary credential-entry route. It
  resolves the grant, remembers the token with its target node, and replacement-
  navigates to the canonical folder or document route, so the capability does
  not remain in browser history or subsequent URLs. The client sends the token
  only for its target or descendants, never for unrelated requests. Copying a
  canonical node URL does not share access; a fresh browser needs the original
  link.
- Every route declares one typed shell contract in metadata: `area` selects
  the rail and contextual-panel context; `frame` is `area`, `document`, or
  `none`; `scroll` is `shell` or `content`; `allowGuest` controls the auth
  gate; and `title` and `favicon` provide page metadata. A guest on an allowed
  route gets the **Guest surface**, the shell-less presentation for a visitor
  without a Suite session whether access comes from a link or `$PUBLIC`. A
  signed-in visitor gets the Suite shell. The shell does not infer presentation
  from URL prefixes, and new routes do not add independent layout booleans.
