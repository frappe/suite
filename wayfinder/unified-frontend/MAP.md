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
  account; documents open in the content pane with the panel hidden and the
  shell owning the title bar; a Meet call is a full-screen page outside the
  shell; mobile is a bottom nav plus a bottom sheet. Not decided from it: the
  URL scheme. Removed from it: the Organization/Personal workspace switcher.
  Choosing a Drive Root belongs to the Files area only.
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
  frappe-ui (`a89a95f`) exports DesktopShell, MobileShell, Rail, Sidebar,
  BottomSheet, MobileNav and PageHeader, but not RailItem, SidebarItem,
  SidebarLabel or PageHeaderMobile. The prototype pins frappe-ui
  1.0.0-beta.55.
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

### Local tracker conventions

- Tickets live in `tickets/`, one file each, frontmatter: `id`, `title`,
  `label` (`wayfinder:<type>`), `status` (open/closed), `assignee`
  (empty = unclaimed), `blocked-by` (list of ids).
- Frontier query: open tickets, empty assignee, all `blocked-by` ids closed.
- Resolution: append `## Resolution` to the ticket, set `status: closed`,
  add one line under Decisions so far here.

## Decisions so far

## Not yet specified

- Icon source. The prototype uses frappe-ui's lucide sprite; CLAUDE.md
  prefers the Figma set. Decide at the first styling ticket.
- Settings and account surfaces behind the rail: today's
  `SuiteSettingsDialog`, per-app settings bodies, the Desk switcher for
  system users.
- Notifications: the rail badge source once Drive Notification and Mail
  unread counts exist under REST; the shape of a cross-product feed.
- Global search across products for the palette. Waits on the REST
  structure ticket.
- Editor fit: Sheets canvas and Slides stage sizing inside the content
  pane; comments, version and presence panels beside an open document.
- Previews and thumbnails in the grid view (signed `/f/` URLs and refresh).
- Testing gates: the vitest baseline is red (57 failures); e2e lives under
  `e2e/drive-backed-apps`; what the switch gate runs.
- Mobile behaviour per area beyond the shell chrome.
- PWA scoping (Mail is installable today), Sentry, translation and theme
  handoff into `platform/`.
- Keyboard shortcuts across areas (Cmd+number, Cmd+K, Escape).
- Meet entry points on Home (rooms, join, schedule) against REST.

## Out of scope

- Rebuilding Mail, Meet or Calendar pages. They adopt the shell. Their
  internals are later efforts.
- REST migration of Mail, Meet, Calendar, Writer, Sheets and Slides
  endpoints beyond what the new frontend calls now. Each app migrates in its
  own effort.
- Drive backend behavior changes. The Drive spec owns them. A new need is
  recorded as an ask.
- Site-wide API hardening. Already listed on the Drive map.
