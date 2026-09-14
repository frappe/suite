---
label: wayfinder:map
tracker: local-markdown
---

# Map: Unified frontend

## Destination

An implementation-ready spec pair for the unified suite frontend:
`unified-frontend-spec.md` (shell, platform interface, route grammar, REST
endpoint structure, Drive pages, content page contract, adoption contract for
Mail, Meet and Calendar, rollout and redirect plan) plus
`unified-frontend-plan.md` (stages, file ownership, gates). The base prototype
is the layout authority and the spec links it. Done when an implementation
effort can execute from the documents and the prototype alone.

Scope, decided 2026-09-11:

- "Unified" means one shell, one design language (frappe-ui), one route
  model, and one platform layer.
- Drive is rebuilt from scratch. Writer, Sheets and Slides get new document
  pages on the node route and keep their editors. Mail, Meet and Calendar
  mount in the shell as they are.
- The new frontend calls REST endpoints under one structure. Drive's
  `/api/suite/drive/` table exists. Other apps get endpoints copied or moved
  into that structure only where the new frontend needs them now. The rest
  follow when each app migrates.
- Rollout: grow beside the old pages, then switch. Old pages are deleted as
  the last stage of this effort.

## Notes

- Base prototype:
  [suite-shell-prototype](https://sketch.netchamp.dev/u/netchampfaris/suite-shell-prototype)
  (sketch slug `suite-shell-prototype`). Decided from it: an icon rail with
  Home, Files, Mail, Calendar, plus Search, Notifications, Settings and the
  account; documents open in the content pane with the panel hidden; a Meet
  call is a full-screen page outside the shell; mobile is a bottom nav plus a
  bottom sheet. Ticket 009 supersedes the prototype's ownership inference for
  open documents: each product owns its complete document surface, including
  its title bar, while the shell owns placement. Not decided from the
  prototype: the URL scheme. Removed from it: the Organization/Personal
  workspace switcher. Choosing a Drive Root belongs to the Files area only.
- Source precedence: the Drive spec
  ([`../drive-layer-spec/drive-layer-spec.md`](../drive-layer-spec/drive-layer-spec.md))
  wins for Drive behavior. [`ARCHITECTURE.md`](../../ARCHITECTURE.md) rule 8
  wins for frontend module boundaries. This map's tickets win for shell and
  route decisions. A new Drive backend need is an ask on the Drive program,
  not a decision here.
- Inputs from the Drive program: superseded tickets
  [32](../drive-layer-spec/implementation/issues/32-frontend-drive-adoption.md),
  [33](../drive-layer-spec/implementation/issues/33-frontend-sharing-and-links.md)
  and
  [34](../drive-layer-spec/implementation/issues/34-frontend-content-adoption.md).
  Cleanup activation
  ([36](../drive-layer-spec/implementation/issues/36-cleanup-later-release.md))
  waits on this effort.
- Facts checked 2026-09-11: the frontend is one Vite app with one router and
  a per-app registry (`frontend/src/apps/registry.ts`); the shell is an empty
  `<main>`; each app has its own layout. Sizes: Meet 58k lines, Mail 42k,
  Sheets 33k, Slides 26k, Drive 11k, Writer 10k, Calendar 5k. The SPA calls
  60 distinct legacy `suite.drive.api.*` methods and no `/api/suite/drive/`
  route. `suite/drive/http/routes.py` holds 50 handlers. Suite's pinned
  frappe-ui (`a89a95f`, 15 commits after `v1.0.0-beta.55`) exports every
  shell component the prototype uses (verified 2026-09-11; an earlier note
  here said four were missing, which was a grep error). The prototype pins
  frappe-ui 1.0.0-beta.55.
- Skills each session consults: grilling and domain-modeling for decision
  tickets; frappe-ui before any styling; prototype tickets edit the base
  prototype on the sketch server, never a fresh one; codebase-design for
  interface tickets.
- Grilling style: explain first, then ask. Plain words, one example, pros
  and cons per option, a one-line question.
- Delegation: use the codex CLI for research and inventories. Use Claude
  subagents only when the session's tooling is needed. Subagents must not
  post, push, or write outside this repo without confirmation.
- Branches: `forge/wayfinder-unified-frontend` holds the map, based on
  `forge/drive-layer` because the frontend consumes that branch's API.
  Research branches: `forge/research-<name>`.
- Vocabulary: [`frontend/CONTEXT.md`](../../frontend/CONTEXT.md).
- Server-state client: [`references/server-state-client.md`](references/server-state-client.md)
  is the guideline for the frontend data layer (decided 2026-09-12 and
  2026-09-13 under ticket 002). Frontend work starts on it. Ticket 002
  tightens it as pages land.

### Local tracker conventions

- Tickets live in `tickets/`, one file each, frontmatter: `id`, `title`,
  `label` (`wayfinder:<type>`), `status` (open/closed), `assignee`
  (empty = unclaimed), `blocked-by` (list of ids).
- Frontier query: open tickets, empty assignee, all `blocked-by` ids closed.
- Resolution: append `## Resolution` to the ticket, set `status: closed`,
  add one line under Decisions so far here.

## Decisions so far

- [Frontend module layout and import boundaries](tickets/013-frontend-module-layout-and-boundaries.md) —
  Drive owns separate `files` and deletable `legacy` subtrees; eight decided
  platform modules move on day one behind compatibility shims. Package-root
  product seams and the full acyclic import graph are enforced with shrinking
  debt baselines, including unstable/private frappe-ui imports. Areas and
  heavy surfaces load on demand under a 200 KiB-gzip initial-JS budget. New
  colocated and unified browser tests are zero-red; exact legacy failures stay
  visible. Suite architecture paths belong to `@netchampfaris`, and Drive is
  co-owned by `@BreadGenie` and `@netchampfaris`.

- [Home, palette and notifications at launch](tickets/012-home-palette-and-notifications-at-launch.md) —
  Home Recent is 12 Drive recents in one uncursored window; Upcoming is
  Calendar events only from now to end of tomorrow, across every account,
  with a typed conferencing field driving Join. New carries three document
  kinds, all through generic Drive creation into the Personal Root. The Meet
  control is built from the reserved room and scheduled-meeting routes. The
  bell is a Drive-only popover with mark-on-click plus Mark all read;
  composition owns the Mail rail badge so AreaDefinition stays frozen.
  Sections never hide and fail inline. The command palette is out of scope.

- [Files area: listing, navigation and roots](tickets/006-files-area-listing-and-navigation.md) —
  My files and Organization files are direct panel locations; Shared with me,
  Recent, Starred and root-tabbed Trash are saved views. Listings use opaque
  infinite cursors, server-owned folders-first sorting/grouping, exact
  access/preview expansions and explicit loaded-row selection; every node kind
  has one canonical open target. Drive owns the workflow-shaped
  `@/apps/drive` interface. Root discovery, grouped/folder-only children,
  view access, search breadcrumbs, folder archives and payload-free realtime
  invalidation are recorded backend asks.

- [Content page contract](tickets/009-content-page-contract.md) — one generic
  host opens a live Drive `DocumentSession` and mounts a fresh product adapter
  per node; each product owns its complete document surface, body,
  collaboration, panels, geometry and leave guard. The session owns node
  metadata and actions, scoped credentials, access refresh and stable media
  handles; one composition registry drives opening and generic Drive creation,
  and legacy pages remain separate until ticket 014 flips their redirects.

- [REST endpoint structure beyond Drive](tickets/003-rest-endpoint-structure.md) —
  Drive is the reference for resource-shaped `/api/suite/<owner>/...` routes;
  one composition dispatcher selects product-owned typed route tables, while
  Suite owns account, site, user and invitation resources. New shell
  capabilities migrate as two adapters over one product workflow, Home
  composes product queries in the client, and every adapter must pass a shared
  executable conformance kit before legacy removal follows a zero-caller
  proof.

- [Shell and platform interface](tickets/002-shell-and-platform-interface.md) —
  products export small area definitions through their public seams;
  composition owns ordering and capability filtering; typed route metadata
  selects shell frame and scroll ownership; the platform owns session,
  server state, transport, one Frappe realtime connection, theme,
  translation, page metadata and common feedback mechanics; product domain
  meaning stays product-private. Unavailable deep links get an explanatory
  shell surface, and frappe-ui's existing page-header target is the flexible
  page-to-shell seam.

- [Route grammar](tickets/001-route-grammar.md) — canonical areas are
  `/home`, `/files`, `/mail`, and `/calendar`; `/` redirects to `/home`;
  roots use memorable `/files` and `/files/organization` routes, folders use
  `/files/f/<node-id>/<decorative-slug>`, and content uses
  `/d/<node-id>/<decorative-slug>`; saved views are paths; `/l/<token>` is a
  temporary credential-entry route; typed route metadata controls the shell
  and unauthenticated visitors use the Guest surface.

- [frappe-ui shell component gap](tickets/004-frappe-ui-shell-component-gap.md) —
  no gap: all 28 prototype components exist at suite's pin; no bump needed;
  `v1.0.0-beta.56` would cost one toast migration; use `frappe-ui/list`,
  add no `frappe-ui/experimental` imports; Rail and Sidebar need suite
  wrappers for geometry, scroll and badges; node_modules is stale against
  the lock.

- [Legacy Drive client inventory](tickets/005-legacy-drive-client-inventory.md) —
  60 legacy names, all in Drive UI (Writer repeats six); 29 have an exact
  REST route, 31 do not (17 product methods stay on `/api/method/` by
  design); four backend asks surfaced: root discovery, unread count, folder
  archive, storage breakdown; REST handlers emit no socket events; Drive UI
  creates Writer and Sheets documents through product endpoints.

## Not yet specified

- Icon source. The prototype uses frappe-ui's lucide sprite; CLAUDE.md
  prefers the Figma set. Decide at the first styling ticket.
- Settings and account surfaces behind the rail: today's
  `SuiteSettingsDialog`, per-app settings bodies, the Desk switcher for
  system users.
- Notifications: the shape of a cross-product feed. Ticket 012 ships a
  Drive-only bell and names the joined feed as the planned upgrade.
- The mounting spike must prove the shared full-pane box with Writer, the
  Sheets canvas, and the Slides stage on desktop and mobile; ticket 009 assigns
  all internal geometry, panels and presence presentation to each product.
- Mobile behaviour per area beyond the shell chrome.
- PWA scoping (Mail is installable today) and Sentry ownership.
- Keyboard shortcuts across areas (Cmd+number, Escape). Cmd+K is not among
  them: ticket 012 ruled the palette out of scope.
- Named Meet rooms: persistent rooms with a handle and a cadence, as the base
  prototype's Rooms dropdown imagined them. No doctype, no list route and no
  such concept in Meet today. A Meet-program idea this effort surfaced.

## Out of scope

- Command palette and global search across products. Ruled out under
  [Home, palette and notifications at launch](tickets/012-home-palette-and-notifications-at-launch.md):
  the unified frontend ships with no Cmd+K and no rail Search button. A
  palette is only worth building over a search that spans products, and that
  search is a separate effort.
- Rebuilding Mail, Meet or Calendar pages. They adopt the shell. Their
  internals are later efforts.
- REST migration of Mail, Meet, Calendar, Writer, Sheets and Slides
  endpoints beyond what the new frontend calls now. Each app migrates in its
  own effort.
- Drive backend behavior changes. The Drive spec owns them. A new need is
  recorded as an ask.
- Site-wide API hardening. Already listed on the Drive map.
