# Unified frontend spec

| | |
|---|---|
| Status | Decisions folded 2026-09-29 (tickets 017 to 021) |
| Date | 2026-09-29 |
| Source map | [`MAP.md`](MAP.md) and [`tickets/`](tickets/) |
| Companion plan | [`unified-frontend-plan.md`](unified-frontend-plan.md) (stages, file ownership, gates) |
| Architecture | [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) (rule 8 owns frontend module boundaries) |
| Base prototype | [suite-shell-prototype](https://sketch.netchamp.dev/u/netchampfaris/suite-shell-prototype) (sketch slug `suite-shell-prototype`) |
| Drive spec | [`../drive-layer-spec/drive-layer-spec.md`](../drive-layer-spec/drive-layer-spec.md) (owns Drive behavior) |

This spec defines the unified Suite frontend: one shell, one route model,
one platform layer and one design language (frappe-ui). An implementation
effort executes from this spec, the companion plan and the base prototype.

Source precedence:

- The base prototype is the layout authority. This spec never restates its
  layout, spacing or visuals. Ticket 009 supersedes its ownership inference
  for open documents [MAP].
- The Drive spec wins for Drive behavior. This spec cites it as
  `[Drive §5.3]` and does not restate it.
- ARCHITECTURE.md rule 8 wins for frontend module boundaries [ARCH 8].
- The tickets win for shell and route decisions. When a later ticket amends
  an earlier one, this spec states only the final rule and cites both.
- A new Drive backend need is an ask on the Drive program, not a decision
  here. Section 15 lists every ask.

Citations: `[T006]` is ticket 006 in [`tickets/`](tickets/). `[SSC]` is
[`references/server-state-client.md`](references/server-state-client.md).
`[IMPL]` is [`IMPLEMENTATION.md`](IMPLEMENTATION.md), which records shared
contracts already fixed in code. `[MAP]` is the map. `[ARCH 8.3]` is
ARCHITECTURE.md rule 8.3. Terms follow
[`frontend/CONTEXT.md`](../../frontend/CONTEXT.md) exactly.

## 1. Goal, scope and non-goals

### 1.1 Goal

"Unified" means one shell, one design language (frappe-ui), one route
model and one platform layer [MAP].

- Drive is rebuilt from scratch: the Drive area and the `DocumentSession`
  behind every open document. Composition owns the document host
  (section 8.1) [MAP, T009].
- Writer, Sheets and Slides get new document pages on the node route. They
  keep their editors.
- Mail, Meet and Calendar mount in the shell as they are.
- The new frontend calls REST endpoints under one structure. Drive's
  `/api/suite/drive/` table exists. Other products get endpoints under that
  structure only where the new frontend needs them now.
- Rollout grows the new pages beside the old pages, then switches. The old
  pages are deleted as the last stage of this effort.

### 1.2 Out of scope

- A command palette and global search across products. The unified
  frontend ships with no Cmd+K and no rail Search button [T012].
- Rebuilding Mail, Meet or Calendar pages. They adopt the shell. Their
  internals are later efforts [MAP].
- REST migration of Mail, Meet, Calendar, Writer, Sheets and Slides
  endpoints beyond what the new frontend calls now. Each product migrates in
  its own effort [MAP, T003].
- Drive backend behavior changes. The Drive spec owns them. A new need is an
  ask (section 15) [MAP].
- Site-wide API hardening. The Drive map lists it [MAP].
- One storage pool for Mail and Meet bytes: Meet recordings as Drive Nodes,
  Mail usage from Stalwart in the quota, and the Mail composer's orphaned
  `File` rows. The Drive, Mail and Meet programs own them [MAP, T007].
- One Suite sign-in page. Frappe's `/login` stays [T010, T011].

## 2. Route grammar

[T001, amended by T010, T011, T014]

### 2.1 Canonical routes

| Route | Meaning | Shell | Scroll | Guest |
|---|---|---|---|---|
| `/` | Replacement redirect. `/home` after flip 2; the last-app fallback (`/mail`) before it [T001, T014] | n/a | n/a | no |
| `/home` | Home area [T001] | in shell | shell | no |
| `/drive` | **My files**, the caller's Personal Root [T001, T006] | in shell | shell | no |
| `/drive/organization` | **Organization files**, the site's active Shared Root. Personal sites omit it [T001, T006] | in shell | shell | no |
| `/drive/f/<node-id>/<slug>` | One open folder [T001] | in shell or Guest surface | shell | yes [T011] |
| `/drive/shared-with-me` | Saved view **Shared with me** [T001, T006] | in shell | shell | no |
| `/drive/recent` | Saved view **Recent** [T001, T006] | in shell | shell | no |
| `/drive/starred` | Saved view **Starred** [T001, T006] | in shell | shell | no |
| `/drive/trash` | Saved view **Trash**, My files tab. `?root=organization` selects the Organization files tab [T006] | in shell | shell | no |
| `/d/<node-id>/<slug>` | One open document or previewable file [T001, T009] | in shell or Guest surface | content | yes [T011] |
| `/mail/...` | Mail area, Mail's own child routes [T010] | in shell | content | no |
| Mail sign-in, signup, forgot-password, reset-password, `mime-message` pages | Unchanged Mail pages [T010] | outside | n/a | as today |
| `/calendar/...` | Calendar area, including `/calendar/account/:accountId/month/...` and its shortcut routes [T010] | in shell | content | no |
| `/meet` | Meet area [T001, T010] | in shell | content | no |
| `/meet/audio-test` | Meet audio test [T010] | in shell | content | no |
| `/meet/:meetingId` | A Meet call: fixed, dark, full screen [T001, T010] | outside | n/a | yes |
| `/l/<token>` | Share-link entry. A Frappe website route, not an SPA route (section 10.1) [T011] | n/a | n/a | yes |
| `/login` | Frappe's login page [T011] | n/a | n/a | yes |

Home and Drive scroll the content pane as a page. Mail, Calendar, Meet and
an open document own their scrolling [CONTEXT].

### 2.2 Rules

- Areas and rail order are Home, Drive, Mail, Calendar, Meet. The rail label
  of the Drive area is "Drive" [T001, T010, T020].
- The shell never infers presentation from a URL prefix. Every route
  declares its shell contract in typed metadata (section 3.3). A new route
  adds no independent layout boolean [T001].
- An app's own layout flags below its layout component stay, for example
  Mail's `noLayout` and `isLogin`. They do not enter shell metadata
  [T001, T010].
- Folder routes carry only the open folder's node id. The API supplies the
  breadcrumb chain. A move or a rename does not break a folder URL [T001].
- A root never appears as `/drive/f/<root-id>`. Roots use `/drive` and
  `/drive/organization` only [T001, T006]. The router replace-redirects
  `/drive/f/<root-id>` to `/drive` or `/drive/organization` [T001, T015].
- Until flip 2 the old Drive pages own `/drive`. `suite_flip_files` selects
  which route table mounts under `/drive`: the old pages while it is off,
  the Drive area while it is on. This is the one route flag that selects
  between two implementations (section 13.1) [T013, T020].
- `/drive/f/<id>` resolves by node kind. The old Drive pages used
  `/drive/f/<id>` for a file. A non-folder id replace-redirects to
  `/d/<id>` [T020].
- Frappe's public upload path `/files/` stays Frappe's. The Drive area
  shares no prefix with it, so no upload name is reserved and dev needs no
  proxy bypass for the area [T020].
- Saved views are paths. Query parameters carry only presentation and
  filter state: `view`, `sort`, `dir`, `group`, `q` and `root` (section 5)
  [T001, T006].
- `/d/<node-id>/<slug>` is the single content route for Writer, Sheets and
  Slides documents and for uploaded files. The node response selects the
  renderer [T001, T009].
- `/suite`, `/writer`, `/sheets`, `/slides` and the old `/drive/...` pages
  survive only as redirects (section 14.3) [T001, T014, T020].

### 2.3 Decorative slug

The node id is authoritative. The slug is decorative [T001].

- A missing or stale slug still resolves. The router then replaces the URL
  with the current slug. It adds no browser history entry.
- To build a slug: normalize and lowercase; keep letters and numbers from
  every script; collapse punctuation and whitespace to one hyphen.
- Omit the slug when no readable characters remain.
- Cap the slug at 80 Unicode characters. Truncate only at a character
  boundary.
- The server sends no slug in a link redirect. The router adds it [T011].

### 2.4 Link credentials in URLs

- A share link is `/l/<token>` everywhere [T008].
- The server resolves `/l/<token>` and answers 302 to
  `/drive/f/<node>#link=<token>` or `/d/<node>#link=<token>` (section 10.1)
  [T011].
- The token lives only in the URL fragment. The SPA removes the fragment
  before the first node request [T011].
- A canonical node URL carries no capability. Copying it does not share
  access. A fresh browser needs the original link [T001].

## 3. Shell and platform interface

[T002, T004, T010]

### 3.1 Area definition

Each product exports its area definition through its public
`apps/<product>/index.ts` seam [T002].

```ts
type PlatformCapability = 'jmap' | 'systemManager'

interface AreaDefinition {
  id: string
  label: () => string                 // translated at render time
  icon: Component
  to: string                          // canonical entry route, for example '/drive'
  loadRoutes: () => Promise<{ routes: RouteRecordRaw[] }>
  requires?: PlatformCapability[]
}
```

[T002, amended by T010; IMPL]

- `AreaDefinition` has no `loadPanel`. The shell owns no area sidebar
  [T010].
- `AreaDefinition` is frozen at this shape. Badges, notifications and
  settings do not enter it [T012, T016].
- Products do not self-register at runtime [T002].

### 3.2 Composition registry

`composition/appRegistry.ts` builds the one registry the shell renders
[T002, T012].

- It imports only from product package roots `@/apps/<product>`: area
  definitions, badge sources, document type definitions and settings
  entries. It does not import product routes, pages or other internals
  [T002, T007, T009, T012, T016].
- Array order sets rail position [T002].
- It evaluates each area's `requires` once against `@/platform/session`. It
  omits an unavailable area from the rail and every launch surface [T002].
- It owns one badge source per area. Mail's badge comes from
  `useInboxSummary()` in `apps/mail/index.ts` [T012]. Drive's badge comes
  from `driveUploadProgress()` in `apps/drive/index.ts` (section 6.3)
  [T007]. The product never learns that a rail exists [T012].
- Meet has no capability gate [T010].
- Composition also owns the ordered document registry (section 8.2) and the
  settings list (section 12.1) [T009, T016].

### 3.3 Route metadata

```ts
declare module 'vue-router' {
  interface RouteMeta {
    area?: string                      // rail context
    frame: ShellFrame                  // in the shell, or 'none' for outside
    scroll: 'shell' | 'content'
    allowGuest?: boolean               // skips the auth gate
    title?: string                     // stable fallback title
    favicon?: string                   // area favicon
  }
}
```

[T001, amended by T010; IMPL]

- `frame` says whether the route renders in the shell or outside it.
  `'none'` is outside. Outside routes are the Meet call and Mail's sign-in
  pages [T002, T010], and, while `suite_flip_shell` is off, Mail, Calendar
  and Meet (section 14.2). The in-shell literal is an open item (section
  16).
- `scroll: 'shell'` lets the shell viewport scroll the whole page.
  `scroll: 'content'` gives the page a fixed box that owns its scrolling
  [T001, CONTEXT].
- `allowGuest` controls the auth gate. On an allowed route a visitor
  without a session gets the Guest surface (section 10.3) [T001, T011].
- Route metadata owns title and favicon (section 3.13) [T002].

### 3.4 Shell frames and geometry

The layout comes from the base prototype. This section fixes ownership
only.

- **In the shell.** Every in-shell route gets the rail and one full-height
  box. The shell owns persistent geometry: rail, content pane, and on phone
  the bottom nav [T002, T010].
- **Area sidebar.** A page draws its own area sidebar inside the box with
  the platform's `<AreaSidebar>`. It has a fixed width, a scroll area, an
  aria label, a fixed-size skeleton while the page chunk loads, and the
  phone bottom-sheet behavior. A page may draw no sidebar, one, two, or a
  sidebar on one child route only [T010].
- The sidebar arrives with the page chunk. An area switch shows the
  skeleton for a moment. The rail never moves [T010].
- `ShellLayout` loses `ContextualPanel` and its panel branch.
  `HomePanel.vue` and `FilesPanel.vue` render inside `<AreaSidebar>`. The
  Mail and Calendar placeholder panels are deleted [T010].
- **Outside.** A `frame: 'none'` route renders with no shell [T010].
- **Guest frame.** A visitor without a session on an `allowGuest` route
  gets the shell's guest frame (section 10.3) [T011].
- **Document mount.** An open document gets one full-pane mount box
  (section 8.4) [T009].
- **Page header.** The shell hosts frappe-ui's `PageHeaderTarget`. An area
  page owns the content it teleports there. A page may use `PageHeader` and
  `PageHeaderMobile`, use `PageHeaderBase` for a different shape, or declare
  no shell header. The shell owns placement and mobile safe-area behavior.
  It never interprets product actions or branches on a product id [T002].
- The shell has no product-specific branch [T002, T009].
- **Mounting spike.** Freeze the exact CSS seam only after a spike proves,
  on desktop and phone: one shell-scrolling Drive page, one self-scrolling
  adopted area, and one full-pane editor. The spike is an implementation
  gate, not a product decision [T002]. The map adds Writer, the Sheets
  canvas and the Slides stage to its proof [MAP].

### 3.5 Rail and phone nav

- The rail holds the areas in composition order, the Notifications bell,
  the Settings gear and the account avatar. It has no Search button
  [T010, T012].
- The rail lists an area only while its flip is on (section 14.1). Before
  flip 1 it lists no area. The bottom nav reads the same list [T018].
- Between the flips the rail shows a temporary Apps entry (grid icon, below
  the areas). It lists the old Drive, Slides, Writer and Sheets pages. It
  shows while `suite_flip_shell` is on and `suite_flip_files` is off, and
  is deleted with the old pages (section 14.8) [T018].
- The Settings gear opens the one Suite settings dialog (section 12)
  [T010].
- The bell is shell chrome, not an area. It has no registry entry
  (section 11.5) [T012]. It lives in `composition/notifications/` and the
  shell mounts it through a slot [IMPL].
- The Drive rail item shows upload progress (section 6.3) [T007].
- The phone bottom nav shows the areas plus an account entry. The account
  entry is an avatar that opens a sheet (section 12.4) [T010].
- The bottom nav reads the same registry as the rail [T002].
- A tap on the active area's bottom-nav item dispatches the existing
  `suite:open-active-area-panel` window event with `{ area }`. The page's
  `<AreaSidebar>` listens and opens its phone sheet
  (`shell/ShellLayout.vue:153`) [T015].
- The shell hides its bottom nav in Mail and Calendar. Those areas keep
  their own phone bars (section 9.3) [T010].
- The guest frame has no rail and no bottom nav [T011].

### 3.6 Unavailable surface

- The router evaluates a direct URL with the same capability evaluator as
  composition [T002].
- When an area is unavailable, the shell keeps the URL. It renders a
  product-neutral unavailable surface with the reason and the applicable
  next step [T002].
- It does not load the product bundle, redirect silently, or wait for an
  API failure [T002].
- Permissions inside an available area stay product-owned and
  server-enforced [T002].

### 3.7 Platform entry rule

- Code enters `platform/` only when it is product-neutral and either the
  shell or composition needs it, or two real products use it
  [T002, ARCH 8.5].
- A single product-neutral consumer keeps the code local until a second
  consumer exists [T002].
- Product language keeps code in the owning product. Cross-product use goes
  through that product's public interface [T002].
- Day-one platform modules: `@/platform/session`, `transport`,
  `server-state`, `realtime`, `translation`, `theme`, `page-meta` and
  `feedback` [T013]. The platform also exports `<AreaSidebar>` [T010] and
  registers the Suite service worker (section 3.15) [T010].

### 3.8 Session

`boot/session.ts` is rewritten behind one `@/platform/session` interface
[T002].

```ts
useSession(): {
  status: Ref<'loading' | 'guest' | 'authenticated'>
  user: Ref<{ id: string; fullName: string; avatar: string | null } | null>
  capabilities: Ref<{ jmap: boolean; systemManager: boolean }>
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
  refresh(): Promise<void>
}
```

[T002; IMPL]

- Remove the parallel cookie refs, the reactive session object and the
  alternate read helpers as callers migrate [T002].
- Boot seeds `systemManager` false. The account route
  (`GET /api/suite/account`) is the only source. The `system_user` cookie
  is not read: it means "not a Website User", not System Manager [T021].
- Mail accounts, mailboxes, Calendar identities and other product profile
  data stay private to their products [T002].
- Drive root discovery does not enter session boot (section 5.1) [T006].
- Sign out clears the Drive link store and the guest name (sections 7.1,
  10.5) [T008, T011].

### 3.9 Server state

`@/platform/server-state` is a Suite-owned, Frappe-semantic engine. It
replaces `createResource`, `useDoc`, `useList`, `useCall` and direct `call`
as the application abstraction [T002, SSC]. The reference
[`server-state-client.md`](references/server-state-client.md) is the
guideline. Frontend work starts on it and tightens it as pages land [MAP].

Layers stay separate: transport, generated contract, engine, per-product
client modules, and the Vue binding. Application code imports only
`@/platform/server-state` and the `client/*` modules of its own product.
Composition and other products reach a descriptor only through
`@/apps/<product>` [T002, SSC, T013, ARCH 8.3].

Fixed names [IMPL]: `useQuery`, `useMutation`, `settled()`, `run()`,
`silent`, `member`, `touches`, `optimistic`, descriptor builders `query`,
`infinite`, `mutation`, `upload`, and `createServerState({ transport })` for
tests.

One way per job [SSC]:

- Read with `useQuery(descriptor)`. Write with `useMutation(descriptor)`,
  also outside components. Await a read outside a component with
  `useQuery(descriptor).settled()`.
- Errors are values in `.error`. `run` and `settled()` never reject. A
  malformed descriptor or an input that fails the generated validator
  throws at the `run` call.
- `run` resolves to the output, or to `undefined` on failure.
- Inputs are always validated. Outputs are validated in dev builds. Output
  validation in production builds is an open item (section 16).
- A getter makes descriptor params reactive. A getter that returns nothing
  disables the query.
- Realtime, focus and reconnect refetch are on for every query.
  `refetchInterval` covers polling.
- Descriptors are inert values. Application code never sees a URL, a dotted
  Python path, a DocType string or a cache key [T002, SSC].
- Application calls have strictly typed inputs and outputs derived from an
  authoritative server contract (section 4.5) [T002].
- Mutations toast on error by default. `silent` is `true` or a list of error
  types the caller handles. Queries never toast [SSC].
- Every mutation response is normalized into the entity store [SSC].

The engine must support cached reads, stale-while-revalidate, focus and
reconnect refetch, request deduplication, cancellation and mutation-driven
invalidation. A narrow Drive area vertical slice proves these before the engine
becomes the platform contract for every product [T002].

Errors [SSC]:

- Classify by `errors[0].type`, never by HTTP status.
- Base shape: `{ type, message, status }`. Each operation has a generated
  string-literal union of error types.
- Retry only GETs, only on network and 5xx failures. Never retry a 4xx.
- `TimestampMismatchError`: refetch the entity and surface a conflict.
  Never retry it automatically.
- `SessionExpired`: pause all queries until login.
- A 429 respects `Retry-After`.

Cache model [SSC]:

- The entity store holds `id -> {data, version, fetchedAt}` for outputs the
  contract tags as entities. Drive nodes use `name` and `modified`.
- The query store holds lists as entity refs, so one write patches every
  list that shows the entity.
- `member` declares which entities belong to a list. `touches` marks
  entities stale after a write whose response carries no shapes. Lists whose
  filter the client cannot mirror, such as search, invalidate or rely on
  focus refetch.
- Paging strategy is declared per list: `cursor` (Drive), `offset` or
  `window`.
- The entity store persists in IndexedDB. A persisted entity is stale on
  boot and always revalidates.

`upload()` in `platform/server-state` creates, chunks, finishes, reports
progress and cancels. It accepts a start offset so a resumed upload does
not begin at byte 0 [T007].

### 3.10 Transport

- Transport owns fetch, CSRF, the Frappe v2 envelope, error decoding, abort
  and retry. It calls every RPC through `/api/v2/method/...`. v1 decoding
  exists only for legacy shims [SSC].
- Transport sends an `X-Drive-Links` header only when the caller gives it
  one. It does not select, store or cut link codes. The `LinkStore` hook in
  `frontend/src/platform/transport/index.ts` is removed [T008].

### 3.11 Realtime

- `@/platform/realtime` owns one lazy singleton Socket.IO connection per
  browser tab to the Frappe site namespace. It owns host and port discovery,
  session credentials, reconnect and room lifecycle [T002].
- The server-state engine interprets generic document and list events.
  Each `apps/<product>/client` owns its product event names and payloads
  and maps them to descriptors [T002].
- Every subscription returns a cleanup function [T002].
- There is no universal product event bus. Meet SFU signalling and WebRTC,
  Hocuspocus/Yjs, SSE and media streams stay product-private [T002].
- Drive's `drive:changed` event is handled in section 5.9 [T006].

Engine rules for generic events [SSC]:

- `doc_update` with an equal version does nothing. A newer version marks
  the entity stale. The engine refetches it if a view observes it.
- `list_update` invalidates the lists of that doctype that do not contain
  the name. The engine coalesces these events per doctype.
- `doc_rename` re-keys the entity.
- `update_user_permissions` invalidates everything.
- The engine joins a doc room while a view observes the entity, and a
  doctype room while a view observes a list. It leaves the room on GC.

### 3.12 Theme

- `@/platform/theme` initializes appearance once. It exposes the saved mode
  (`light`, `dark` or `automatic`), the resolved mode, and actions to set or
  cycle it [T002].
- It reads and writes Frappe User's `desk_theme`. Suite and Desk share one
  per-user preference. There is no Suite-only field and no device-local
  preference [T002].
- A product may apply a scoped override, such as Meet forcing dark during a
  call. The override never writes the saved preference. It restores the
  resolved mode when its scope ends [T002].
- Products delete their own Theme menus and theme keyboard listeners
  [T010].

### 3.13 Page metadata

- `@/platform/page-meta` is the only code that writes the browser title and
  favicon [T002].
- Route metadata supplies the fallback title and the area favicon [T002].
- The active view may register a reactive title override, such as a
  document name, a mail subject, an unread count or a calendar month [T002].
- A view override changes the title only. The area favicon stays route
  metadata [T002].
- The platform arbitrates precedence across navigation and Vue activation,
  deactivation and unmount. It restores the route fallback when an
  override's scope ends [T002].
- Product code does not write `document.title` or the favicon [T002].
  Per-app page titles in Mail, Meet and Calendar stay as debt (section 9.6)
  [T010].

### 3.14 Translation

- `@/platform/translation` loads one catalog before normal UI mounts. It
  calls Frappe's cached `frappe.translate.get_boot_translations` directly
  [T002].
- It installs the site-wide catalog behind the existing `__()`, replacement
  and context semantics. There are no product catalogs to merge and no new
  Suite facade [T002].
- The new frontend has no product route loaders for translations [T002].
- The Drive and Mail translation wrappers stay only while an old page calls
  them. Rollout deletes them with their last legacy caller [T002].
  Per-app catalogs through `suite.mail.api.get_translations` stay as debt in
  Mail, Meet and Calendar [T010].

### 3.15 Feedback and PWA

Feedback [T002]:

- The platform owns one app-level UI provider. It owns toast presentation,
  generic confirm and prompt behavior, server-state challenge hosting,
  focus containment, stacking and Escape policy.
- The shell owns shell surfaces such as Settings and Account.
- Each product owns its dialog content, words, state and outcomes. There is
  no central registry of product dialogs.
- A product component does not enter `platform/` because the common host
  can render it.

PWA [T010]:

- There is one Suite PWA. The manifest is available on every route.
  `setPwaTags` does not key on the area.
- The platform registers the service worker after sign-in. `MailLayout`
  does not register it.
- Mail's push handlers stay in `sw.ts`, so push works in every area.
- The manifest `id` changes from `/mail`. A phone with the Mail PWA
  installed can show a second installed app. This risk is accepted.
- `start_url` is `/suite/start`, which goes to `/home` at flip 2
  [T010, T014].

### 3.16 frappe-ui components and wrappers

- Suite's pin (`a89a95fa`, 15 commits after `v1.0.0-beta.55`) exports all
  28 components the prototype uses. No bump is needed [T004].
- A move to `v1.0.0-beta.56` is optional. It costs one toast migration (two
  wrapper sites, four `removeAll` sites) and re-tests of Button and
  TabButtons [T004].
- New lists use `frappe-ui/list` [T004, T013].
- New code adds no `frappe-ui/experimental` import and no private-path
  import such as `frappe-ui/src/...` (section 13.3) [T004, T013].
- frappe-ui's Rail and Sidebar are shallow. The rail wrapper under
  `shell/` owns rail geometry, route rules and badges. The platform's
  `<AreaSidebar>` owns sidebar geometry, the scroll area and fades
  (section 3.4) [T004, T010].
- The upload ring uses frappe-ui's `ProgressRing` [T007].
- Styling uses frappe-ui design tokens [MAP]. Icons are frappe-ui's lucide
  set on every surface. This overrides the standing Figma rule for this
  effort. No Figma swap is planned [T021].
- Icon names live in two lookups: `apps/drive/files/internal/icons.ts` for
  MIME families and content kinds, and each `DocumentTypeDefinition.icon`
  for the product mark. Every other icon is a literal name [T021].

## 4. REST endpoint structure

[T003, T005]

### 4.1 Path grammar and transport contract

- New routes use resource nouns and HTTP verbs under the unversioned
  `/api/suite/<owner>/...` namespace. Legacy RPC method names do not appear
  in paths [T003].
- Drive is the reference contract and the first implementation [T003].
- Other products converge on this contract step by step. They do not carry
  their old conventions into the new namespace [T003].
- Suite resources (account, site, users, invitations, people) sit directly
  under `/api/suite/<resource>`. There is no `/api/suite/shell/...`
  namespace [T003, T008].
- The common transport contract is: Frappe v2 success and error envelopes,
  framework authentication, shared HTTP status meanings and validation
  mechanics, and an opaque cursor for a paged collection. A singleton or a
  bounded window has no cursor [T003].
- Resource shapes and domain error types stay with the owning product. Mail
  does not expose Drive-named errors [T003].
- A path identifier wins over a conflicting body value [T003].

### 4.2 Dispatcher and route tables

- `suite/composition` owns one `before_request` dispatcher. It selects the
  `<owner>` segment and delegates to that owner's table [T003].
- Suite and each product own typed route tables and handlers in their HTTP
  adapters. Composition does not collect product routes in one central
  table [T003].
- Drive's translator is adapted into this shape. It stays the behavior
  reference [T003, Drive §11.1].
- Product-neutral account, site, user and invitation resources are Suite
  resources under `suite/api/`. Product account details and settings stay
  product-owned. The shell is a caller, not a backend domain owner [T003].
- Suite resources register each resource name as its own first segment
  (`account`, `site`, `users`, `invitations`). All of them point at the
  Suite table. Ask S1 adds `people` [T003, T008].

```python
# suite/composition/http.py
@dataclass(frozen=True)
class Route:
    method: str
    path: str
    handler: str
    body: Any = None
    errors: tuple[type[Exception], ...] = ()
    allow_guest: bool = False
    query: Any = None
    output: Any = None
    entity: dict[str, str] | None = None

# suite/composition/registrations.py: owner segment -> owner table
HTTP_OWNERS = {"drive": "suite.drive.framework.HTTP", ...}
```

[T003; IMPL]

### 4.3 Launch surface beyond Drive

| Caller | Route | Owner |
|---|---|---|
| Boot and session | `GET /api/suite/account` | Suite |
| Onboarding and site settings | `GET/PATCH /api/suite/site` | Suite |
| Suite user settings | `GET /api/suite/users` | Suite |
| Suite invitations | `GET/POST /api/suite/invitations` | Suite |
| Share dialog people picker | `GET /api/suite/people?q=` (ask S1) | Suite |
| Mail rail badge | `GET /api/suite/mail/inbox-summary` | Mail |
| Home Upcoming | `GET /api/suite/calendar/events` | Calendar |
| Instant or restricted Meet | `POST /api/suite/meet/rooms` | Meet |
| Scheduled Meet | `POST /api/suite/meet/scheduled-meetings` | Meet |

[T003, T008, T012]

- Drive recents, notifications and document creation use Drive's own table
  [T003].
- Widening this surface is a separate decision [T003].
- `GET /api/suite/people?q=` returns users and groups, paged. Any Suite user
  may call it. "Principal" stays a Drive word. Drive's picker maps each
  result to a principal [T008].

### 4.4 Adoption rules

- REST adoption is additive during grow-beside. A legacy method and its
  REST handler are thin adapters over one product-owned workflow. Behavior,
  authorization and tests are never copied [T003].
- The product owner removes a legacy adapter only after its migration owns
  a checked zero-caller inventory. The shell switch alone is not enough
  [T003].
- Mounted product internals keep their legacy calls until their own
  migration [T003, T010].
- Home queries product resources concurrently in the client. Each section
  keeps its own cache, refresh and failure state. A Suite backend aggregate
  needs a real cross-product invariant, not page convenience [T003].
- New frontend code makes no legacy `suite.drive.api.*` call and has no
  legacy RPC fallback. A missing route is implementation work
  [T014, IMPL].
- All 69 `suite.drive.api.*` names are legacy, the 19
  `suite.drive.api.product` methods included. New code calls none of them.
  The Drive routes of Drive §11.2 "Settings and WebDAV" (`GET` and
  `PATCH /settings`, `GET` and `PATCH /site-settings`, `GET /webdav`) and
  the Suite resources of section 4.3 replace the product methods. Drive
  Cleanup deletes every name and the `/api/method/suite.drive.api.`
  allowlist prefix. Only `/dav` stays [T017, Drive §11.7, Drive §14.10].
- Mail, Calendar and Meet keep their dotted paths and move off them in
  their own efforts. Drive sets the example [T017].

### 4.5 Contract and conformance

- Drive's translator tests become an executable conformance kit for every
  registered adapter. It checks method and path routing, v2 envelopes,
  path identifiers over body values, status and error behavior, and opaque
  cursor behavior where it applies [T003].
- Typed registration plus this kit is the handoff contract. Written
  conventions alone are not enough [T003].
- `bench --site <site> execute suite.composition.contract.write_all` writes
  one `frontend/src/apps/<owner>/client/contract.json` per owner. The Suite
  owner writes to `frontend/src/platform/transport/contract.json` [IMPL].
- `frontend/scripts/generate-contract.mjs` turns each JSON into
  `client/generated.ts`: `api.<id>` descriptors, input and output types,
  and error unions. A body union emits one operation per member, for
  example `node_patch.rename` and `node_patch.move`. Both files are
  committed [IMPL, SSC].
- Changing the Drive route table also updates its generated contract and
  the conformance tests [T006].

## 5. Drive area: listing, navigation and roots

[T006, with T007, T010, T011]

Drive owns the Drive area: rail label "Drive", prefix `/drive` [T020]. The
base prototype fixes the layout. Drive
behavior comes from [Drive §5], [Drive §8], [Drive §9.5] and [Drive §11].

### 5.1 Destinations and roots

- The Drive page draws an area sidebar with `<AreaSidebar>` [T006, T010].
- **Locations** holds **My files** (`/drive`) and, on business sites,
  **Organization files** (`/drive/organization`). They are direct entries,
  not a header picker and not one merged listing [T006].
- **Views** holds **Shared with me**, **Recent** and **Starred**, then a
  visually separated **Trash**. There is no **All** destination [T006].
- Each saved view calls one Drive view: Shared with me calls
  `views/shared`, Recent calls `views/recents`, Starred calls
  `views/favourites`, Trash calls `views/trash` with a root id. The first
  three keep the order the Drive spec freezes [T006, Drive §11.2].
- Trash shows one root at a time with a `My files | Organization files`
  tab switcher. `/drive/trash` is My files.
  `/drive/trash?root=organization` is Organization files. The query names
  the semantic root, never its opaque id. Personal sites omit the tabs
  [T006].
- The Drive area loads and caches `GET /api/suite/drive/roots` when it
  mounts. The data is
  `{personal: {node, title}, organization: {node, title} | null}` and holds
  active roots only. `/drive` and `/drive/organization` translate through
  it [T006, Drive §11.2].
- Root discovery is Drive data. It does not enter session boot [T006].
- Quota stays on `GET /roots/<id>/usage` [T006].

### 5.2 Folder listing

- A root lists through the ordinary children route with its discovered
  node id. A folder route fetches the folder detail and its children
  [T006, Drive §11.2].
- The default window is 60 rows. Every cursor is opaque [T006, Drive §11.4].
- Listings load infinitely. Near the end of the rendered rows the client
  echoes `next_cursor` and appends the result. Only a null cursor ends a
  list [T006].
- A window with zero visible rows and a non-null cursor is skipped
  automatically. Initial loading continues until a visible row or the end
  [T006, Drive §11.4].
- A failed next page keeps the loaded rows and shows an inline retry
  [T006].

### 5.3 Sort, group and presentation state

- Sorting and grouping are server-owned. The client never sorts or groups
  only the loaded window [T006, Drive §5.3].
- A sort or group change clears the loaded pages and starts again with no
  cursor [T006].
- Folder and root listings group by **Type**, **Owner** or **Modified**.
  The client derives each group heading from fields on the row [T006].
- The server makes each group contiguous. With a group, folders come first
  inside each group. Without one, folders come first globally. The chosen
  sort is the secondary order, and the node id breaks ties
  [T006, Drive §5.3]. The client does not reorder rows.
- The initial presentation is list view, no grouping, title ascending
  (shown as Name) [T006].
- Default list columns are **Name**, **Owner** and **Modified**. **Type**
  and **Size** are optional. Location and sharing-summary columns do not
  launch. The client never sends one request per row to imitate a column
  [T006].
- Precedence: URL query, then the saved Drive preference, then defaults.
  `view`, `sort`, `dir` and `group` are presentation keys. A change
  replaces the current history entry and updates the saved preference
  [T006].
- Folder navigation carries supported settings forward. Saved views drop
  sort and group keys they cannot honor. Visible columns are a saved
  preference, not URL state [T006].

### 5.4 Expansions

| Surface | `expand` |
|---|---|
| Open folder detail and header | `access,breadcrumbs` |
| Folder and root list rows | `access` |
| Folder and root grid tiles | `access,preview` |
| Saved-view list rows | `access` |
| Saved-view grid tiles | `access,preview` |
| Search rows | `access,breadcrumbs`, plus `preview` in grid |

[T006, Drive §11.3]

- Breadcrumbs describe the open folder once. They are not repeated on each
  child. Search is the exception: each result shows its path, for example
  `My files > Finance` [T006].

### 5.5 Grid previews

- While a grid is visible, the client refreshes preview URLs in the
  background at 10 minutes, two thirds of the 15-minute TTL
  [T006, Drive §6.8].
- A hidden tab pauses the timer and revalidates on focus [T006].
- Existing images stay painted during a refresh [T006].
- One failed image fetch refreshes its preview once, then falls back to the
  MIME icon [T006].

### 5.6 Rows, icons and open targets

| Kind | Icon | Open target |
|---|---|---|
| `folder` | Folder icon | `/drive/f/<node-id>/<slug>` |
| `document` | The registered Writer, Sheets or Slides icon | `/d/<node-id>/<slug>`; the document registry selects the adapter |
| `file` | MIME-family icon or preview | `/d/<node-id>/<slug>` |
| `link` | External-link icon | Confirm the target origin, then open a new browser tab |

[T006]

- An unsupported file format keeps the `/d/` route. It shows a **No
  preview** state with Download. It never downloads immediately [T006].
- Root nodes never appear as ordinary rows [T006].
- Row menu: Open, Open in new tab, Download, Rename, Move, Make a copy,
  Star/Unstar, Share, Move to trash [T006].
- Download is unavailable for links. Folder Download shows only when the
  folder-archive routes exist [T006, Drive §11.2].
- The `access` expansion hides every action the row's role does not allow
  [T006, Drive §4.2].
- Share shows only to users with MANAGE (section 7.2) [T006, T008].

### 5.7 Rename, move, copy and the folder picker

- Rename and Move keep a `DriveConflict` visible. The rename control stays
  open. The move dialog keeps its source and asks for another title or
  destination. The client never adds a suffix [T006, Drive §8.6,
  Drive §8.7].
- Copy and Restore accept the title the server returns, such as
  `Report (2).pdf`. The client never predicts a suffix [T006, Drive §8.9].
- Move, Copy and Restore use one Drive-owned folder picker. It has a My
  files tab and, when present, an Organization files tab. It pages folders
  lazily with `kind=folder` [T006, T007].
- The picker may traverse readable folders. Only a root or folder with
  UPLOAD may be selected [T006].
- Cross-root moves and copies are allowed. The server stays authoritative
  for cycles, depth, title conflicts, quota and permission changes [T006].

### 5.8 Selection and bulk actions

- Selection holds explicit node ids from the loaded rows. **Select all**
  means all loaded rows, never unseen matches. A new cursor window does not
  select its rows [T006].
- A change of folder, root, saved view, search, sort, group or Trash tab
  clears selection [T006].
- Desktop: a checkbox or Cmd/Ctrl-click enters selection. Shift-click
  selects a loaded visible range. Escape clears [T006].
- Phone: a long press or **Select** in the row menu enters selection. Taps
  then toggle rows. Back exits selection mode [T006].
- In selection mode checkboxes appear. The bulk bar replaces the toolbar at
  equal height and does not move the list [T006].
- The active-node bulk bar holds only **Move** and **Move to trash**. One
  gesture is one `POST /nodes/batch` request [T006, Drive §11.5].
- An action is enabled only when every selected row's access permits it.
  The server rechecks every node [T006].
- Rename, copy, star, share, download and open stay single-row actions
  [T006].
- Trash replaces the bar with Restore and Delete forever (section 6)
  [T006, T007].
- Batch results follow section 6.11 [T006, T007].

### 5.9 Mutation outcomes and realtime

- An own mutation updates the normalized node store from its REST result.
  It revalidates affected queries in the background [T006].
- After commit, Drive emits one payload-free `drive:changed` event to each
  affected user [T006, Drive §9.5].
- Observed Drive listing queries debounce the event and refetch their visible
  listing. The event carries no node or root id [T006].
- Without the event, focus refetch, reconnect refetch, own-write
  normalization and manual refresh stay correct. Remote edits are then not
  live [T006].
- Query failures never toast. A refresh failure keeps stale rows with a
  compact warning. Mutations use the platform feedback path [T006].

### 5.10 Search

- The inline field is **Search files**. It calls the tree-wide
  `views/search` [T006, Drive §5.7].
- Search covers the caller's readable Personal, active Shared, shared and
  archived-root content. It never covers Mail or Calendar [T006].
- The term is the `q` query. Clearing it restores the listing at the
  current route [T006].
- Results are newest-modified first and use the search expansions
  (section 5.4) [T006, Drive §5.7].
- Search has no New menu and refuses drops [T006, T007].

### 5.11 Visits and stars

- Call `POST /nodes/<id>/visit` only after a signed-in user opens a folder,
  document or file route, or confirms and follows a link [T006].
- Route success owns the call, so direct navigation and browser history
  count [T006].
- Tile preview, selection, roots and a cancelled link prompt create no
  Recent [T006].
- An item reached only through a link records no visit and hides Star
  (section 10.7) [T011].
- Star and Unstar are per signed-in user. They update every cached copy of
  the node through the normalized store [T006]. A row shows its star state
  only once the node shape carries `favourite` (ask D28).

### 5.12 New menu

- **New** holds Folder, Upload files, Upload folder, one entry per document
  type (Document, Spreadsheet, Presentation), Link and From template. Each
  document label is the type's `newLabel` [T006, T009, T012, T021].
- Upload folder uses a hidden `<input type="file" webkitdirectory>`. It
  hides on the phone layout, where the OS pickers offer no folders [T021].
- From template opens the Drive-owned template picker under
  `apps/drive/files/features/`. The picker has one tab per registered
  document type (label from `newLabel()`, filter from `contentDoctype`,
  both read through `DOCUMENT_TYPES_KEY`), tiles from
  `GET /views/templates?content_doctype=` with the preview expansion, and a
  Name field. Create calls `POST /nodes/<template>/copy` with the open
  folder as `parent` and the name as `title`, then opens the returned
  node's `/d/` route. Copy keeps the server's title on a conflict
  [T021, T009, Drive §8.10].
- New shows only in a concrete root or folder where the caller has UPLOAD.
  Saved views and search hide it [T006].
- Document entries come from the document registry and call the generic
  Drive creation workflow (section 8.9) [T006, T009].
- Upload progress follows section 6 [T006, T007].
- Through a link below EDIT, New hides the three document entries and From
  template (section 10.14) [T011, T021].

### 5.13 States and accessibility

- Initial queries show a layout-matched skeleton. They then show rows, an
  access-aware empty state, or an inline error with Retry [T006].
- Empty-state copy names the destination. It offers New only where UPLOAD
  exists [T006].
- Rows and tiles use native table or list semantics, one roving tab stop
  where needed, Enter to open, Space to select, and an accessible menu
  trigger [T006].
- Focus returns to its origin after a menu or dialog closes [T006].

### 5.14 Phone

- From another area, the Drive bottom-nav item opens `/drive` [T006].
- While Drive is active, tapping the Drive item opens the Drive area
  sidebar as a bottom sheet. The tap reaches the page through the shell's
  window event (section 3.5) [T006, T010, T015].
- A header destination button (`My files ▾`, `Starred ▾` and so on) opens
  the same sheet. Folder breadcrumbs sit under it [T006].
- The sheet closes after a destination is chosen [T006].

### 5.15 Drive client and public interface

- Drive owns all Drive area UI and client behavior under
  `frontend/src/apps/drive/` [T006, T013].
- Resource descriptor modules live under `apps/drive/client/`. URLs, cache
  keys, generated transport names, cursor parsing and normalization stay
  inside them [T006].
- `apps/drive/index.ts` is the only cross-product seam [T006, ARCH 8.3].

| Export | Kind | Source |
|---|---|---|
| `filesArea` | `AreaDefinition` | [T006] |
| `driveRecents()` | server-state descriptor | [T006] |
| `createDriveDocument()` | server-state descriptor | [T006] |
| `driveNodeRoute(node)` | canonical route; no navigation side effect | [T006] |
| `DriveNodeSummary` | type | [T006] |
| `DocumentSession` and its factory | Drive-owned document workflow | [T006, T009] |
| `filePreviewSurface` | lazy surface for a node with no content doctype (section 8.1) | [T011, T015] |
| `driveUploadProgress()` | queue progress for the rail badge | [T007] |

- Raw generated transport, resources, the root cache, list state, dialogs,
  `prettyData`, `allUsers` and product internals are not exported.
  Individual Drive dialogs do not cross the seam [T006].
- Existing Writer and Slides subpath imports are migration debt, not the
  interface [T006, T013].

### 5.16 Required tests

- Listing tests cover short and empty filtered windows, cursor reset on
  presentation changes, stable folders-first grouping, preview refresh,
  search breadcrumbs, permission changes and mixed batch outcomes [T006].
- Browser coverage includes both root kinds, personal sites, desktop
  keyboard selection and both phone bottom-sheet affordances [T006].

## 6. Upload, restore and batch outcomes

[T007, with T011]

### 6.1 Ownership

- Drive owns the Upload queue, the tracker and all upload state under
  `frontend/src/apps/drive/`. The platform owns only `upload()`
  (section 3.9) [T007].
- No other product needs a browser upload queue. Mail posts whole files to
  its own endpoint. Meet recordings arrive from the recorder. Slides images
  and the workspace logo use frappe-ui `<FileUploader>` [T007].
- `utils/useChunkedUpload.ts` stays legacy debt. It is not a platform module
  [T013].

### 6.2 Chunks, lifetime and resume

- Chunks inside one file are sequential. Parallelism is across files only
  [T007].
- A chunk is at most `MAX_CHUNK_BYTES` (16 MB) [T007].
- An upload lives for the tab. It survives folder and area changes [T007].
- Per upload, the client stores
  `{upload_id, parent, name, size, lastModified, bytesSent, handle?}` in
  IndexedDB for 24 hours [T007].
- On mount, each Interrupted upload shows in the tracker with Resume
  [T007].
  - With a stored `FileSystemFileHandle`: request permission, read the
    file, continue.
  - Without one: Resume opens the native picker. The client accepts the
    file only when name, size and `lastModified` match. Otherwise it starts
    a new upload and leaves the old session alone.
- Resume sends the next chunk at `bytesSent` and trusts the `received`
  value in the reply. A zero-byte chunk at offset 0 is a status probe
  [T007].
- A resumed upload sends a sha256 `checksum` at finish. A continuous upload
  does not. This needs a streaming (wasm) hasher [T007].
- A checksum mismatch destroys the session. The client-side match before
  resume protects the user's progress [T007].
- Guests resume on the same code path. An interrupted guest upload cannot
  resume after sign-in. The tracker shows it failed with "Upload again"
  [T011].

### 6.3 Progress in the rail

- The Drive rail item shows one ring for the whole queue, weighted by
  bytes, in every area while uploads run. In the Drive area the tracker panel also
  shows [T007].
- Clicking the ring opens `/drive` with the tracker open [T007].

| State | Indicator |
|---|---|
| Uploading | Determinate ring |
| Paused or retrying | Amber |
| All done | Ring completes, then fades after about 3 s |
| Some failed, or interrupted after reload | Red dot until the user opens the tracker |

[T007]

- The phone Drive bottom-nav item shows the same indicator [T007].
- In the guest frame the ring sits in a fixed header slot (section 10.6)
  [T011].
- The tracker component does not cross the Drive seam [T007].

### 6.4 Collisions

- The server catches a title collision in `create_upload` before bytes
  move. It returns `DriveConflict` (409) with the free title it would use
  (ask D11) [T007].
- The dialog offers Replace, Keep both (saved under the server's free
  title), Rename (checked again) and Skip. A batch adds "Apply to all"
  [T007].
- The client never predicts a suffix [T007].
- Replace shows only when the caller has EDIT on the existing file. A guest
  on an UPLOAD link never sees it [T011, Drive §4.2].

### 6.5 Quota

- Before a batch starts, the client sums declared sizes and reads
  `GET /roots/<id>/usage`. If the batch does not fit, it says so and offers
  Upload what fits or Cancel [T007].
- This check is advisory. `create_upload` stays the gate [T007, Drive §7.3].
- On a 413 during a batch, the queue stops starting uploads. It shows one
  banner and offers Retry all [T007].

### 6.6 Folder upload

- The client creates folder nodes top-down with `POST /nodes`, then uploads
  the files into them [T007].
- Only the top folder can collide. The choices are Keep both (the server's
  free title, ask D12) or Skip. There is no merge [T007].
- Entry points: Upload folder in New (section 5.12), and a dropped
  directory on any drop target (section 6.7) [T021].

### 6.7 Drop targets

- Drops work only in a root or folder where the caller has UPLOAD. Saved
  views and search refuse them [T007].
- The pane drops into the open folder. A folder row or tile with UPLOAD
  retargets the drop into that folder [T007].
- The overlay names the target and does not move the layout [T007].
- A dropped directory (`DataTransferItem.webkitGetAsEntry().isDirectory`)
  runs the folder flow (section 6.6) into the target: top folder collision
  only, Keep both or Skip. Same UPLOAD rule and same overlay as a file drop.
  There is no separate drop surface [T021].
- Dragging existing rows to move them is not part of this spec [T007].

### 6.8 Replace

- "Upload new version" is a header action on the file preview page. The
  confirm reads: "This replaces report.pdf. The current file is not kept."
  [T007]
- A browser replace keeps no old version (ask D13). A WebDAV PUT keeps the
  auto version [T007, Drive §8.5].
- Plain files have no versions panel [T007].

### 6.9 Restore

- The client restores with `{state: Active}` first [T007].
- When the original parent chain is not Active, the server returns
  `DriveRestoreDestinationRequired` (409), a `DriveConflict` subtype
  (ask D14) [T007, Drive §8.8].
- In a batch, the client collects the items that need a destination. One
  prompt ("8 items' folders are gone") opens the folder picker limited to
  the same root and to folders with UPLOAD [T007].
- A second batch sends `{state: Active, parent}` for those items only
  [T007].
- Cancel leaves them in Trash. An access change before submit returns as a
  per-item failure [T007].

### 6.10 Delete forever and Empty trash

- Bulk Delete forever uses a batch purge route with the `{ok, failed}`
  shape (ask D15). Purge needs MANAGE [T007, Drive §4.2, §11.5].
- Trash has Empty trash in its header, per root, through a route such as
  `POST /roots/<id>/trash/empty` (ask D16). It needs MANAGE on the root
  [T007].
- The Empty trash confirm reads: "Delete everything in Trash forever?"
  [T007]

### 6.11 Batch outcomes and retry

- `BatchOutcome.vue` shows results for trash, restore, move and delete
  forever [T006, T007].
- Successful ids leave the selection and the affected lists. Failed ids
  stay selected [T006].
- The result reads, for example, `14 moved · 4 failed`. **Details** shows
  per-node messages [T006].
- The outcome has no Retry button. Running the action again is the retry
  [T007].
- A whole-request failure (network, 5xx, deadlock) applies nothing. It shows
  a platform toast with Retry [T007].
- A write that needs more than 20 link codes refuses before sending
  (section 7.1). Batch outcomes have no partial-result case for it [T008].
- In the upload tracker, a failed file has Retry, which resumes from
  `received`, plus Retry all [T007].

## 7. Sharing dialog and link credentials

[T008, amended by T011]

Ticket 008 owns link-code storage, selection and the share dialog. Section
10 owns the guest screens [T008, T011].

### 7.1 Link-code store

- The Drive client owns link-code storage and selection. Other products get
  codes only through the `DocumentSession` (section 8.6) [T008, T009].
- **Tagging.** When a read or listing returns through a link, the client
  tags each returned node with that link's code [T008].
- A request for a tagged node sends that code. A request for an untagged
  node sends no code [T008, Drive §6.2].
- A deep URL this browser never reached through the link needs the link
  again [T008].
- **Store.** `localStorage` holds two keyed maps [T008]:

```ts
type LinkEntry = { target: string; ticket?: string; lastUsed: number }
type Links = Record<string, LinkEntry>   // code -> entry, at most 50
type Tags = Record<string, string>       // node -> code, at most 1000
```

- An entry is forgotten when [T008]:
  - the server returns 404 or 410 for that code: drop the link and its
    tags;
  - the unlock ticket expires: drop the ticket, keep the bare code;
  - the store is full: least recently used first;
  - the user signs out: clear everything.
- The store survives sign-in [T011].
- **Cap.** The header carries at most 20 codes [Drive §4.7].
  - A read that needs more splits into groups of 20 and merges the results
    [T008].
  - A write (move, trash, star, batch) refuses with: "These items come from
    more than 20 share links. Select fewer and try again." [T008]
- The unlock ticket format and its 30-day lifetime follow [Drive §4.8].

### 7.2 Who can share

- Share shows only to users with MANAGE. Reading grants needs MANAGE
  [T008, Drive §11.2].
- Drive owns and hosts the one share dialog. The Drive area and every Document
  surface use it (section 8.8) [T009].

### 7.3 Dialog sections

Top to bottom [T008]:

1. People picker.
2. **People**: local user and group grants.
3. **General access**: everyone at the org, and Public on the web.
4. **Share links**.
5. A folded **From "<folder>"** part per ancestor that holds inherited
   grants (ask D19).

On phone the dialog opens as a bottom sheet with the same sections [T008].

### 7.4 Remove and Deny

- A local row's role menu ends with **Remove**. On a folder it also has
  **Remove here and inside** (`?below=1`). The result says how many items
  inside lost the grant [T008, Drive §5.10].
- An inherited row has **Deny access here**. The deny row then shows in
  People as "Denied here" with **Allow again**, which deletes the deny row
  [T008].
- After Remove the dialog reads access again. If the person still has
  access, it says why: "Asha still has access through Design team." [T008]
- UI words follow the Drive glossary: Deny, not Block [T008].
- Removing or lowering your own MANAGE asks first: "You will no longer be
  able to share this item." [T008]

### 7.5 Roles offered

| Who | Folder | File or document |
|---|---|---|
| Person or group | View, Comment, Upload, Edit, Manage | View, Comment, Edit, Manage |
| Everyone at the org | Off, View, Comment, Upload, Edit | Off, View, Comment, Edit |
| Public on the web | Off, View | Off, View |
| Share link | View, Comment, Upload, Edit | View, Comment, Edit |

[T008]

- Upload is hidden on files and documents because it gives nothing there
  [T008, Drive §4.2].
- Manage is never offered to everyone at the org [T008].

### 7.6 General access and publishing

- General access shows the effective state [T008].
- Public from a parent shows `On · from "<folder>"` with **Deny access
  here**. It also appears in the folded part [T008].
- On a root, the Public row and the Share links section are hidden
  [T008, Drive §4.9, §6.5].
- Publishing is the `$PUBLIC` View grant, shown as "Public on the web"
  [T008, Drive §6.5].

### 7.7 Share links

- **+ New link** makes a View link with no expiry and no password. It
  copies the URL and shows "Link copied" [T008].
- A link row shows role, a lock when a password is set, expiry, date made,
  and "sent to <email>" when it was sent. Links have no names [T008].
- Row menu: Access; Set, Change or Remove password; Set, Change or Remove
  expiry; **Get new URL**; Delete link [T008].
- **Get new URL** rotates the link. Its confirm reads "The old URL stops
  working" [T008, Drive §6.4].
- Changing expiry keeps the stored password (ask D20) [T008].
- Link URLs are `/l/<token>` (ask D17) [T008].

### 7.8 People and outsiders

- The people picker searches users and groups through
  `GET /api/suite/people?q=` (ask S1). Groups show a member count [T008].
- An email that is not a user shows "Send a link to <email>". Each send
  makes a new link for that one email with the role chosen in the picker
  (ask D21) [T008].
- Cutting off one outsider means deleting their link. A copied link can go
  to anyone and is not recorded [T008].
- **Notify by email** is on by default for people added (ask D22). Users
  also get the in-app notification [T008].

### 7.9 Expiry and refresh

- Expired grants and links stay in the list, greyed, "Expired <date>", with
  Remove [T008, Drive §6.4].
- Expiry is a date picker. Access ends at the end of that day in the
  sharer's timezone. `expires_on` is a Datetime [T008].
- After any write, the dialog reads grants and access again [T008, T009].
- A failed write shows an inline error on its row [T008].

## 8. Content page contract

[T009, with T010, T011]

### 8.1 Document host

- Composition owns one generic `DocumentHost` for `/d/<node-id>/<slug>`
  [T009].
- It opens a live Drive-owned `DocumentSession`. It selects a product
  adapter from the document registry. It mounts that adapter keyed by node
  id [T009].
- Moving to another document runs the old product's leave guard. It
  disposes the surface and the session, then mounts fresh instances.
  Server-state caches may survive disposal [T009].
- An uploaded file opens on `/d/` and renders through `DocumentHost`
  [T001, T011].
- Drive owns the file preview surface. It exports it from its package root
  as `filePreviewSurface`. `DocumentHost` uses it when the node has no
  content doctype. `openDocumentSession` serves documents and files
  [T011, T015].
- Guests use the same `DocumentHost` (section 10.4) [T011].

### 8.2 Document type definition

```ts
interface DocumentTypeDefinition {
  contentDoctype: string              // 'Writer Document' | 'Spreadsheet' | 'Presentation'
  newLabel: () => string              // translated New-menu label
  icon: Component
  loadSurface: () => Promise<Component> // receives the prop `session: DocumentSession`
}
```

[T009; IMPL]

- Each product exports one definition through `apps/<product>/index.ts`
  [T009].
- Composition owns the ordered registry. The host uses it to open
  documents. There is no second content-type mapping and no runtime
  self-registration [T009].
- The Drive area uses it for its New menu and template filter [T009]. Home uses it
  for its New menu [T012].
- Composition provides the registry through the platform injection key
  `DOCUMENT_TYPES_KEY` (`App.vue`). Drive never imports composition
  [T009, T013, T015].

### 8.3 Document surface

- A product adapter renders the complete Document surface inside the
  content pane: title bar, editor, save and connection indicators,
  presence, share action, comments and versions panels, and read-only or
  refused presentation [T009].
- The shell owns the rail and content-pane placement. It receives no title,
  save, presence, panel or chrome state from the product [T009].
- The adapter interface is one-way. The host supplies a `DocumentSession`.
  The product supplies a lazy surface [T009].
- The product owns its body shape, load and save calls, save and sync
  state, collaboration client, presence model and recovery format. The host
  never sees Writer HTML, Sheets state or Slides data [T009].

### 8.4 Mount box

- Every document gets the same full-pane mount box: full width and height,
  zero minimum inline and block size, and hidden host overflow [T009].
- The product owns every internal scroll region and responsive layout,
  including Writer's editor, the Sheets canvas and the Slides stage and
  panels [T009].
- There are no product-specific sizing flags and no shell branches [T009].
- The CSS seam is frozen only after the mounting spike (section 3.4)
  [T002, MAP].

### 8.5 Document session

`DocumentSession` is the Drive frontend's deep interface for an open node
[T009].

```ts
interface DocumentSession {
  readonly nodeId: string
  readonly contentDoctype: string                 // immutable
  readonly contentDocname: string                 // immutable
  readonly title: Readonly<Ref<string>>           // Drive Node title
  readonly state: Readonly<Ref<'Active' | 'Trashed'>>   // Drive Node state [Drive §3.1]
  readonly access: Readonly<Ref<DriveAccess>>     // effective access, reactive
  rename(title: string): Promise<DriveNode>
  share(): unknown                                // opens Drive's share dialog (section 7)
  copy(parent: string, title?: string): Promise<DriveNode>
  comments: DriveComments                         // Drive §9.3 records and mutations
  versions: DriveVersions                         // Drive §9.1 records and mutations
  media(id: string): MediaHandle
  readonly credentials: CredentialGrouper
  refreshAccess(): Promise<void>
  dispose(): void
}

interface MediaHandle {
  readonly id: string
  readonly src: Readonly<Ref<string | null>>
  readonly cacheKey: Readonly<Ref<string>>        // signature-free blob key
  readonly status: Readonly<Ref<'loading' | 'ready' | 'refused'>>
}
```

[T009; IMPL]. The exact signatures of `share`, `comments` and `versions`
are an open item (section 16).

- Refusal is `access` below READ (section 8.6). It is not a `state`
  value.
- Drive Node `title` is the sole document title. Product doctypes do not
  mirror it. A product title bar renames only through the session [T009].
- The session gives the product the content docname and scoped
  authorization. It does not wrap product body operations [T009].

### 8.6 Access, refresh and credentials

- Drive access is the baseline editor mode. A collaboration verdict may
  only narrow it [T009, Drive §6.7].
- A downgrade from EDIT freezes new edits at once. It cancels or rejects
  pending writes. Unsaved work becomes a local, explicit recovery copy. It
  is never replayed automatically [T009].
- A verdict below READ unmounts the document content and shows the
  product's refused surface [T009].
- A trashed document stays read-only [T009, Drive §4.2].
- While a session is open, it refreshes access after a local share
  mutation, when the window regains focus, and every five minutes [T009].
- Any authorization error or collaboration downgrade restricts the surface
  at once. There is no Drive access-change socket event [T009].
- Link codes are not a public array. The session offers scoped
  capabilities for REST requests, collaboration authorization and
  composite grouping [T009].
- The session selects only credentials relevant to the target nodes. It
  includes the document's own credential when required. It enforces the
  20-code limit and returns explicit overflow or refusal errors [T009].
- Raw codes appear only in the final product-private collaboration
  connection payload [T009, Drive §6.7].

### 8.7 Media and composite decks

- Stored document bodies name media by Drive node id [T009].
- `media(id)` returns a stable reactive handle with `src`, a signature-free
  `cacheKey` and a status [T009].
- The session fetches the document's media set. It refreshes signed URLs at
  10 minutes of their 15-minute TTL. Products own no URL timers and parse no
  signatures [T009, Drive §6.8].
- Pinned copies use the signature-free blob key [T009, Drive §6.8].
- For a composite deck, Slides submits its ordered reference ids to the
  session's credential grouper. The grouper splits only the authorization
  material under the 20-code cap [T009, Drive §6.6].
- Slides owns its composite requests. It merges each result into the
  original positions [T009].
- Groups render progressively. Every position is content, an unreadable
  placeholder, a loading placeholder, or a failed-group placeholder with
  retry [T009].
- One failed group never blocks or reorders the others. An unreadable
  reference is never omitted [T009, Drive §6.6].

### 8.8 Comments, versions and share

- Comments and versions stay Drive records and mutations, exposed through
  the session. Each product renders its own panels [T009, Drive §9.1,
  Drive §9.3].
- Anchors, selection, version preview and restore presentation stay
  product-owned. There is no generic panel with product slots [T009].
- A product places its own Share button. The button calls the session's
  share action. Products do not import the dialog's wiring or repeat its
  permission rules [T009].
- Guest comment names follow section 10.5 [T011].

### 8.9 Creation

- New, New from template, and Copy always use the generic Drive workflows
  [T009, ARCH 8.6, Drive §8.3, Drive §8.9, Drive §8.10].
- After creation, the client navigates to the returned node's `/d/` route
  [T009].
- Templates are filtered by the definition's content doctype. New from
  template is a Drive copy [T009]. The Drive area hosts the template picker
  (section 5.12) [T021].
- New frontend code has no product-specific creation endpoint and no
  new-document route [T009].

### 8.10 Leave guard

- Each product surface installs the standard router leave guard [T009].
- Clean state leaves at once. A save in progress is flushed before leaving.
  Failed or unsaved state offers Stay or Leave with a retained recovery copy
  [T009].
- Rail links stay ordinary router navigation. The shell never queries
  product save state [T009].

### 8.11 Grow-beside

- `/d/` mounts only the new host and surfaces [T009].
- Every legacy Writer, Sheets and Slides URL mounts its old page until its
  redirect flips (section 14) [T009, T014].
- The new surface is never mounted under an old URL [T009].

## 9. Mail, Meet and Calendar adoption

[T010, with T016]

Mail, Meet and Calendar keep their own sidebars and phone bars. The shell
adds the rail and takes the Suite-level menu items [T010].

### 9.1 What each app drops

Inside the shell, Mail, Calendar and Meet drop these from their sidebar
header menu [T010]:

- the app switcher (`useAppSwitcher`): the rail replaces it;
- Log out and the Suite account row: the rail account menu replaces them;
- the Theme submenu and the Cmd+Shift+L listener: the platform owns theme;
- Settings and their `SettingsModal`: the rail gear opens the Suite
  settings dialog (section 12);
- the Suite logo and branding row. The header row stays and shows the
  active mail account.

While their routes are outside the shell (`suite_flip_shell` off, section
14.2), each app keeps Apps, Settings and Log out as standalone chrome (Meet:
its `MeetSidebar` with the Theme submenu), rendered on
`route.meta.frame === 'none'`. Settings there opens the Suite settings
dialog through `openSettings('<product>.<first tab>')`. That call is the one
product-to-shell import per app; it replaces today's baselined
`SettingsModal|SuiteSettingsDialog` entries. The entries and the import go
in the deletion commit (section 14.8) [T018].

### 9.2 What each app keeps

- Its own sidebar body, its Shortcuts entry and dialog, and its
  mail-account switcher. The shell never learns what a mail account is
  [T010, T016].
- Meet keeps its device settings inside the call [T010].
- Mail's Admin dashboard becomes an admin-only row in Mail's own sidebar
  [T016].
- Mail and Calendar sidebars stay page-drawn. Their placeholder shell
  panels are deleted [T010].

### 9.3 Phone

- Mail keeps `MobileTabBar`. Calendar keeps `CalendarTabBar`. The shell
  hides its bottom nav in those areas [T010].
- Area switching in Mail stays on Mail's Apps tab [T010].
- In Mail and Calendar the shell's account entry is hidden with the shell
  nav. Mail's Profile tab and Calendar's profile page cover it [T010].
- `mail-profile` and `calendar-profile` stay as the Profile tab of each
  app's phone bar. Their inline settings list becomes the shell drill-in
  (section 12.4). Log out stays on those pages [T016].

### 9.4 Meet area

- Meet is an area with a rail icon, placed last. It has no capability gate
  [T010].
- `/meet` keeps today's page: New meeting, Join with code, the Schedule
  dialog and Upcoming meetings. It loses the sidebar and the header menu.
  It adds no endpoint [T010].
- Home keeps its Meet controls. Home is the launcher; `/meet` is the fuller
  view [T010, T012].
- `/meet/:meetingId` stays outside the shell: fixed, dark, guests allowed.
  `/meet/audio-test` sits inside the shell [T010].
- The recorder keeps its own entry and build (`recorder.html`,
  `vite.recorder.config.ts`, `dist-recorder`), served by the recorder
  container. The shell does not touch it [T010].
- Meet code loads only when a Meet route opens [T010, T013].
- Meet keeps its in-call settings dialog. It reuses the Meet tab bodies and
  adds Controls [T016].
- Recordings and past meetings are not on `/meet` (section 16) [T010].

### 9.5 Fix before the switch

These break inside the shell. The adoption includes them [T010]:

- `body.mail-app` sets `overflow:hidden` and `height:100%` on the document
  and overrides dialog, menu and popover z-index. Scope it to Mail's box.
- Mail, Meet and Calendar each mount a second `FrappeUIProvider`. Remove
  all three. The platform provides one (section 3.15) [T010, T015].
- `initSocket()` runs on every `MailLayout` mount and never disposes.
  Dispose it on unmount. `apps/meet/socket.ts` opens its own site socket in
  the same way and gets the same fix (section 3.11) [T010, T015].
- Mail's `window` key listeners (`?`, `g`+letter) fire only while a Mail
  route is active. The theme cycle listener goes.

`body.calendar-app` sets only the icon stroke width. It does not break the
shell and needs no fix [T015].

### 9.6 Stays as debt

Each app's later migration owns these. They are named and baselined
[T010]:

- `h-dvh`, `h-screen` and `calc(100dvh-…)` heights;
- the 17 Mail and Meet imports of Calendar internals, and the one Calendar
  import of Meet. The adoption clears none of them;
- per-app stores and legacy API calls;
- Calendar reading mail accounts and branding through `suite.mail.api.*`;
- per-app translation catalogs through `suite.mail.api.get_translations`;
- per-app page titles.

### 9.7 Unchanged routes

- Calendar keeps its account-scoped URLs and its shortcut routes [T010].
- Mail's sign-in, signup, forgot-password, reset-password and
  `mime-message` pages stay outside the shell, unchanged [T010].
- Mail's `noLayout` and `isLogin` flags stay [T010].

### 9.8 Switch

- All three apps flip in one change, after all three are ready. There is
  no mixed state. The key undoes it: with `suite_flip_shell` off, the three
  apps render outside the shell with their standalone chrome (section 9.1).
  A revert of the adoption also undoes it [T010, T018].
- "Switched" means: the routes leave `frame: 'none'`, the chrome in 9.1 is
  hidden, and the fixes in 9.5 are done [T010, T018].
- Mail's and Calendar's `SettingsModal` and Mail's `PWASettings` are
  deleted when the apps adopt the shell, before flip 1 [T016, T018].
- Flip mechanics follow section 14 [T014].

## 10. Guest and link routes

[T011, with T001, T008]

### 10.1 The server resolves the link

- `/l/<token>` is a Frappe website route [T011, Drive §6.2, §11.2].
- It resolves the grant and answers 302 [T011]:
  - a folder goes to `/drive/f/<node>#link=<token>`;
  - a file or document goes to `/d/<node>#link=<token>`.
- The server sends no slug. The router adds it [T011].
- The token rides the URL fragment. A fragment never reaches a server log
  or a `Referer`. The 302 keeps `/l/<token>` out of browser history
  [T011].
- The SPA reads `#link=`, seeds the Drive link store (section 7.1), then
  removes the fragment before the first node request [T011].
- A client navigation to `/l/<token>` does a full page load, so the server
  rule answers. The SPA has no `/l/` route [T014, T015].
- `/drive/l/<token>` redirects to `/l/<token>` [T011, T014].
- Until the Drive ask D24 lands, `/drive/l/<token>` works through
  `drive_link.py` [T014].

### 10.2 Unlock

- Unlock is a state of the node route, not a route. A `401 DriveLocked` on
  the node shows the unlock screen in place [T011, Drive §6.3].
- The same screen covers an unlock ticket that expires while someone
  browses [T011].
- The screen is centred. It shows no node title, owner or kind. It has a
  password field, an Open button and an inline error [T011].
- A 401 on unlock shows "Wrong password" inline [T011].
- A 429 disables the form and shows a live countdown, "Try again in
  14:32", from `Retry-After` (ask D25) [T011].
- There is no attempts-left counter [T011].
- A signed-in user sees the unlock screen inside the shell. The rail stays
  [T011].
- A successful unlock stores the ticket in the link store (section 7.1)
  [T008, Drive §4.8].

### 10.3 Guest surface

- The Guest surface is a shell state. `ShellLayout` gets a guest frame: no
  rail, no area sidebar, one slim header [T011].
- The header holds the Suite mark, the upload ring (section 10.6) and Sign
  in. On `/d/` it holds only the Suite mark and Sign in [T011].
- The same `FilesPage` and `DocumentHost` render for guests. Actions hide
  by role (section 5.6). There is no second folder list [T011].
- On folder routes the trail is `FilesPage`'s own breadcrumbs through
  `PageHeaderTarget`. The server clamps the trail to readable ancestors, so
  a guest's trail starts at the shared folder [T011].
- `GuestSurface.vue` is a static placeholder today. The guest frame in
  `ShellLayout` supersedes it [T011, T015]. The `/l/:token` SPA
  placeholder route is removed (section 10.1) [T014, T015].

### 10.4 A guest opens a document or file

- Writer, Sheets, Slides and file previews render through `DocumentHost`.
  Below EDIT each product is read-only [T011].
- READ includes download. Every guest sees Download or the product's
  export [T011, Drive §4.2].
- The product's own title bar sits under the guest header [T011, T009].

### 10.5 Guest names

- The comment composer shows guests an optional "Your name" field of 140
  characters. It warns at the limit and never trims silently [T011].
- A comment shows "Ravi (Acme) · Guest", or "Guest" when the field is empty
  [T011].
- The Drive client keeps the name in one `localStorage` key. Sign out
  clears it with the link store. It is ignored while signed in [T011].
- Presence and cursors use the collaboration server's generated guest name.
  The typed name does not reach presence [T011, Drive §6.7].
- A `$PUBLIC` visitor sees no composer. `$PUBLIC` caps at READ
  [T011, Drive §6.5].

### 10.6 Guest uploads through a link

- The progress ring sits in the guest header in a fixed slot and opens the
  tracker [T011].
- The upload shows in the listing. UPLOAD includes READ, and the folder's
  link covers the new child [T011].
- No creator grant is written, so the guest cannot rename or trash the
  upload [T011, Drive §4.5].
- The tracker says once per batch: "Uploaded. Only people who manage this
  folder can remove files." [T011]
- Resume and collisions follow sections 6.2 and 6.4 [T011].

### 10.7 A signed-in user opens a link

- The user gets the full shell. The code is always stored [T011].
- A user who already holds a grant sees no difference [T011].
- With access through the link only: no sidebar location is selected; the
  trail starts at the shared item; the item is not in Shared with me,
  Recent or Starred [T011].
- Star is hidden and no visit is recorded. Those lists send no link codes
  and could never show the item [T011].
- Not verified: that Recent and Starred drop link-only items. It follows
  from Drive §6.2 [T011].

### 10.8 A signed-out visitor opens a canonical URL without the link

- A `$PUBLIC` node renders in the guest frame [T011].
- Otherwise the guest frame shows "Sign in to open this", Sign in, and "If
  someone sent you a share link, open that link." [T011]
- The URL stays. There is no automatic redirect. The screen never says
  whether the item exists [T011].
- `/home`, `/drive` and other area routes keep the `/login` redirect
  [T011].

### 10.9 Sign in from the guest header

- Sign in goes to `/login?redirect-to=<current path>`. It returns to the
  same item inside the shell [T011].
- The link store survives sign-in. Sign out clears it [T008, T011].

### 10.10 Login and signup

- Frappe's `/login` stays. There is no Suite login page [T010, T011].
- The guest header offers Sign in only. People join through Suite
  invitations [T011].
- Drive's signup page is not ported. `/drive/signup` and its page are
  deleted when invitation accept moves to the server. If the Suite
  invitation resource slips past flip 2, `/drive/signup` stays as a legacy
  page until deletion (section 14.6) [T011, T014].
- Mail keeps its own login, signup and reset pages [T010, T011].
- The setup gate skips `allowGuest` routes (ask S3). A System Manager on a
  site that is not set up can open a shared item. Area routes still go to
  setup [T011].
- Writer's dead `/drive/login` handoff becomes `/login?redirect-to=`
  (ask S4) [T011].

### 10.11 Dead-link page

The dead-link page is server-rendered. It has the correct HTTP status,
`no_cache`, the Suite mark, no node details and no Sign in (ask S2)
[T011].

| Status | Copy |
|---|---|
| 404 | "This link doesn't work. It may be mistyped, or its owner turned it off." |
| 410 | "This link has expired. Ask the person who shared it for a new one." |

A signed-in visitor also sees "Go to Home" [T011].

### 10.12 Phone guest frame

- There is no bottom nav, because every tab needs a session [T011].
- The header is the same slim header [T011].
- Folders use the existing mobile Back button, which stays inside the
  shared folder [T011].

### 10.13 Drive page in the guest frame

- There is no area sidebar, no search and no Star. Views and roots are
  session-only [T011].
- New and drop targets follow the role [T011].

### 10.14 New menu through a link

- Below EDIT through a link, New hides Document, Spreadsheet, Presentation
  and From template. With no creator grant, the maker could not edit the
  new document. Upload folder follows Upload files [T011, T021].

## 11. Home and notifications at launch

[T012, amended by T010, with T003]

Home lives in `composition/home/` because it composes product seams
[IMPL]. Home's `PageHeader` title is "Home". Home has no greeting line
[T012].

### 11.1 Recent

- Source: Drive Recent only, through `GET /api/suite/drive/views/recents`.
  There is no joined feed and no Suite aggregate [T012].
- The window is 12 rows, one page, no cursor. Home never pages Recent
  [T012, T003].
- No expansion. The card shows a kind icon, not a thumbnail [T012].
- A card shows the kind icon, the title and an "opened" relative time from
  `opened_at` [T012, Drive §9.5].
- **View all** opens `/drive/recent` [T012].

### 11.2 Upcoming

- Source: Calendar events only, through `GET /api/suite/calendar/events`.
  Meet has no list route [T012].
- The window runs from now to the end of tomorrow, grouped as **Today** and
  **Tomorrow** [T012].
- The endpoint expands recurring events across the range [T012].
- The query covers every account the caller owns. The request omits
  `account` (ask C2) [T012].
- A row shows time, title, and **Join** when the event has a meeting. Join
  reads the typed `conferencing: {meeting_id, url} | null` field (ask C1)
  [T012].

### 11.3 New menu

- Home's **New** menu has Document, Spreadsheet and Presentation. Upload
  belongs to the Drive area. Meeting belongs to the Upcoming controls [T012].
- All three use generic Drive creation: `POST /api/suite/drive/nodes` with
  the content kind. The client then opens `/d/<node-id>/<slug>`
  [T012, T009, Drive §8.3].
- A Home create lands at the top level of the caller's Personal Root and
  opens at once. There is no destination dialog and no remembered folder
  [T012].

### 11.4 Meet and Schedule controls

- A **Meet** dropdown replaces the prototype's Rooms dropdown [T012]:
  - Start instant meeting: `POST /api/suite/meet/rooms`;
  - Start restricted meeting: `POST /api/suite/meet/rooms` with the
    restricted type;
  - Join with code: a dialog and a client route. No new endpoint.
- The **Schedule** dropdown keeps Event and Meeting. Meeting calls
  `POST /api/suite/meet/scheduled-meetings` [T012].
- The Home Meet control is one of two Meet entry points. `/meet` is the
  other [T010, T012].

### 11.5 Notifications bell

- The bell shows Drive notifications only, through
  `GET /api/suite/drive/notifications` [T012].
- The badge reads `GET /notifications/unread-count` [T012, Drive §11.2].
- The bell opens a popover over the rail. The paged feed scrolls inside it
  [T012].
- Opening the popover marks nothing [T012].
- Clicking a row marks that row read and navigates to its node. **Mark all
  read** clears the rest. Both use `POST /notifications/read` [T012,
  Drive §11.2].
- A notification is a pointer at one Drive activity row [CONTEXT,
  Drive §9.5].

### 11.6 Mail badge

- The Mail rail badge comes from `GET /api/suite/mail/inbox-summary`
  through `useInboxSummary()` [T003, T012].
- The badge seam is composition's badge source (section 3.2). There is no
  `loadBadge()` on `AreaDefinition` and no platform badge bus [T012].

### 11.7 Empty and failure states

- Every section always renders its heading. Sections never hide [T012].
- Empty Recent reads "Nothing yet" and points at **New** [T012].
- Empty Upcoming reads "Nothing scheduled" and keeps its Meet and Schedule
  controls [T012].
- A failed section keeps its heading and shows an inline retry. The other
  section still renders [T012].

## 12. Settings dialog and account surfaces

[T016, with T010]

### 12.1 Contribution

- Products hand settings to composition through one list,
  `composition/settings.ts` [T016].
- Each entry lazily imports a product's small settings module [T016]. The
  product exports a lazy settings loader from its package root, the same
  shape as `loadSurface`. There is no subpath import [T013, T016, T015].
- `AreaDefinition` does not change. A product without an area can still
  contribute [T016].
- There is no runtime registration [T016].

### 12.2 Groups and tabs

There is one Settings group per product, named after the product. Order
[T016]:

| Group | Tabs | Condition |
|---|---|---|
| Account | Profile, Preferences | none |
| Drive | Statistics; External access | `suite_flip_files` on; External access when WebDAV is on or the caller is a Drive admin (`GET /api/suite/drive/webdav`) |
| Mail | Mail's tabs | mail users only |
| Calendar | Calendar's tabs | mail users only |
| Meet | Devices, Audio, Video, Notifications, Layout | none |
| Workspace | General, Users | system managers |

- Today's product sub-headings ("Mail Setup", "Data", "Developer") are
  removed [T016].
- Meet's Controls tab needs a live meeting. It stays in the in-call dialog
  only [T016].
- Theme lives in Preferences [T016].
- Profile editing stays in Settings [T016].
- The legacy Storage tab does not ship. Every control on it dies with Drive
  Build and Cleanup, and no route carries the `disk_settings` write path
  [Drive §3.13, T017].
- Statistics reads `GET /roots/<id>/usage`. External access reads
  `GET /api/suite/drive/webdav` when the dialog opens, writes
  `PATCH /settings` and `PATCH /site-settings`, and mints keys through
  `suite.utils.user.generate_user_keys`, a Suite method on `/api/method/`
  outside the ban. External access waits on Drive issue 39; Statistics does
  not [T017, Drive §11.2].
- The Drive group's condition reads the files flip. Before flip 2 the group
  would configure an area the rail does not show, and the legacy Drive
  `SettingsDialog` still serves it [T018].

### 12.3 Loading

- A settings module holds labels, icons, cheap `condition` checks and lazy
  tab bodies (`() => import(...)`) [T016].
- The modules load when the dialog opens [T016].
- A tab body loads when its tab is first clicked, behind a fixed-height
  loading state [T016].
- A condition must not pull in a product store [T016].
- Shared tab bodies are pure components. They do not depend on the shell
  dialog state [T016].

### 12.4 Phone

- The shell owns a drill-in settings surface: a full-screen list of
  headings and rows. A tab opens full screen with a back arrow [T016].
- Mail's `PWASettings` becomes this shell component. Mail deletes its copy
  [T016].
- Back goes up one level: tab, then list, then closed [T016].
- The desktop dialog and the phone list read the same settings groups
  [T016].

### 12.5 Tab ids and opening

- Tab ids are namespaced and typed, for example `'mail.screener'` or
  `'drive.statistics'` [T016].
- `openSettings(tab)` takes the union built from the composition list. A
  typo fails at compile time [T016].
- On phone, `openSettings(tab)` opens that tab's drill-in page [T016].
- This replaces Mail's label lookups (`MailThread.vue`, `ScreenerView.vue`)
  and Drive's numeric tab indexes [T016].

### 12.6 Account surfaces

| Surface | Items |
|---|---|
| Desktop rail avatar menu | Name and email header, Settings, Open Desk (system managers), Upgrade plan (system managers; disabled until ask S5), Log out |
| Phone avatar sheet | Header, Settings, Theme, Log out |

[T010, T016]

- Theme is on the phone sheet to save a drill-in. It is not on the desktop
  menu [T016].
- There is no Desk item on phone [T016].
- The Desk item moves from `apps/registry.ts` into `shell/accountMenu.ts`.
  The registry's Desk item is deleted [T016].
- Open Desk and Upgrade plan both key on the `systemManager` capability
  (section 3.8). There is no `systemUser` capability: Suite creates every
  invited user as a System User, so "system users" would be nearly everyone
  [T016, T021].
- Open Desk is a plain `<a href="/app">`: a full page load in the same tab,
  placed after Settings and before Upgrade plan [T021].
- Upgrade plan stays disabled with the tooltip "Not available yet" until
  the site resource carries `upgrade_url` (ask S5) [T021].
- Shortcuts stays in each app. Mail's mailbox switcher stays in Mail's
  sidebar [T010, T016].

### 12.7 After the switch

- Mail's and Calendar's `SettingsModal` go when the apps adopt the shell
  (plan stage 5), before flip 1. With the shell flip off, each app's
  Settings entry opens the Suite settings dialog (section 9.1)
  [T016, T018].
- The legacy Drive `SettingsDialog`, its `showSettings` emitter and its
  numeric tab indexes go at deletion (section 14.8) [T016, T014].
- Meet keeps its in-call dialog [T016].
- There is no merged shell `/profile` route [T016].

## 13. Module layout and import boundaries

[T013, with T002, T006, T010, ARCH 8]

### 13.1 Layout

```text
frontend/src/
├── composition/        # appRegistry, routes, documentRegistry, DocumentHost,
│                       # settings, home/, notifications/
├── shell/              # rail, content pane, phone nav, settings surfaces
├── platform/           # session, transport, server-state, realtime,
│                       # translation, theme, page-meta, feedback
└── apps/
    ├── drive/
    │   ├── index.ts    # the only cross-product seam
    │   ├── client/     # descriptor modules + generated contract
    │   ├── files/      # pages, features, internal
    │   └── legacy/     # today's /drive UI, deletable as one unit
    ├── writer|sheets|slides/index.ts   # DocumentTypeDefinition
    ├── mail/index.ts                   # useInboxSummary()
    ├── calendar/index.ts               # upcoming events descriptor
    └── meet/index.ts                   # room and scheduled-meeting mutations
```

[T013, T016; IMPL]

- Drive owns the Drive area. New code lives under
  `frontend/src/apps/drive/files/{pages,features,internal}`. There is no
  `apps/files` product [T013].
- The current `/drive` UI lives under `frontend/src/apps/drive/legacy`. It
  stays separately routed during grow-beside [T013].
- The Drive area routes load the new subtree directly. `suite_flip_files`
  selects which route table mounts under `/drive` until flip 2: `legacy/`
  or `files/`. That is the one route flag that selects between two
  implementations. It goes with the old pages (section 14.8) [T013, T020].
- New shell, composition and Drive area code use these paths directly [T013].
- Legacy code may use temporary compatibility shims into the platform.
  Old `boot/`, composable and utility paths may forward to platform modules
  [T013].
- Sentry stays where it is until its ownership is decided [T013].
- Shared-looking utilities do not move only because they sit outside a
  product [T013].

### 13.2 Dependency direction

```text
composition -> shell, platform, and product package roots
shell       -> platform
products    -> platform and explicitly allowed product package roots
platform    -> no shell, composition, or product module
files       -X-> legacy
```

[T013, IMPL]

- Products never import shell or composition [T013, ARCH 8.4].
- The shell never imports a product [T013].
- Composition imports a product only through `@/apps/<product>` [T013].
- One product never imports another product's pages, state, components or
  internal utilities [ARCH 8.2].

### 13.3 Public interfaces and enforcement

- Every product exposes one lightweight seam at `apps/<product>/index.ts`.
  It exports only interfaces with real consumers, such as area definitions
  and document adapters. There are no public subpath imports [T013,
  ARCH 8.3].
- `frontend/scripts/check-import-boundaries.mjs` enforces the full graph in
  13.2, the `files`-to-`legacy` ban, package-root-only cross-product imports,
  and the legacy-name ban: any `suite.drive.api.` string outside
  `apps/drive/legacy` fails, in `frontend/src` and in `suite/public/js`.
  There is no allowlist, because no name is permanent. One shrinking
  baseline lists today's callers outside `legacy/`, each with an owner and
  the stage whose route replaces it (sections 14.7 and 14.8)
  [T013, T014, T017].
- Existing violations use exact baseline entries. Each entry carries an
  owner, a reason, and a removal or review condition [T013, ARCH 9.5]. A
  new violation fails. A resolved entry left in the baseline also fails
  [T013].
- The same shrinking-baseline rule covers existing `frappe-ui/experimental`
  and `frappe-ui/src/...` imports [T013, T004].
- The Writer and Slides subpath imports into Drive, the 17 Mail and Meet
  imports of Calendar internals, and the one Calendar import of Meet are
  baselined debt [T005, T010].

### 13.4 Code splitting and budget

- Each area's `loadRoutes` is lazy. Entering one area does not load another
  area's implementation [T013, T010].
- Document surfaces and heavy libraries load behind deeper dynamic imports:
  Writer, Sheets, Slides, PDF, charts, XLSX, media processing and
  Meet/WebRTC load only when their surface or feature opens [T013].
- The complete initial static JavaScript graph for shell, router and
  platform is at most 200 KiB gzip [T013].
- The gate traverses the generated build graph and measures compressed
  bytes. It does not depend on hashed filenames or a hand-kept
  `manualChunks` table [T013].

### 13.5 Tests

- Unit and contract tests sit beside their code under `src/shell`,
  `src/platform` and `src/apps/drive/files` [T013].
- Browser journeys live under `e2e/unified-frontend/shell` and
  `e2e/unified-frontend/files`. Platform browser behavior is tested through
  those surfaces [T013].
- The unified-frontend test project is zero-red [T013].
- The legacy Vitest job uses an exact, shrinking failure manifest, not a
  numeric allowance. Any new failure fails the job. A recovered entry must
  be removed [T013].
- The manifest's initial entries, measured on 2026-09-15, are 57 failing
  Slides assertions and Writer's `docximporter.test.js` collection error
  from unresolved `mammoth` [T013].

### 13.6 Ownership

| Path | Owner |
|---|---|
| `frontend/src/composition`, `src/shell`, `src/platform`, architecture enforcement, shell browser journeys | `@netchampfaris` |
| All Drive paths, including `apps/drive/index.ts`, `files`, `legacy`, and Drive browser journeys | `@BreadGenie` and `@netchampfaris`, jointly |

[T013]

- `CODEOWNERS` encodes these paths [T013].
- A public product-interface change also needs review from at least one
  affected consumer owner [T013, ARCH 9.3].

## 14. Rollout, redirects and old-page deletion

[T014, with T009, T010, T011, T016]

### 14.1 Two flips

```text
today    old pages live; new pages grow beside them
flip 1   suite_flip_shell: Mail, Meet, Calendar in the shell
flip 2   suite_flip_files: Home, Drive, documents; / -> /home
hold     one full release, at least 14 days, legacy-call counter at zero
delete   one commit; 302s become 301s; Drive Cleanup (issue 36) unblocks
```

[T014]

- **Flip 1** is the shell with Mail, Meet and Calendar (section 9.8). The
  rail shows Mail, Calendar and Meet only. `/` goes to `/mail` through the
  existing last-app fallback. There is no Home stub [T014].
- **Flip 2** is Home, Drive and documents together. They share the node
  routes, and Home Recent opens `/d/<id>`. The rail gains Home and Drive.
  `/` goes to `/home` [T014].
- Before flip 2, `/home` and `/d/` answer a direct URL for every signed-in
  user. `/drive` mounts the old Drive pages until the key is on (section
  2.2) [T009, T013, T014, T020].
- The rail lists the areas whose flip is on. On `/home` and `/d/` before
  flip 2 no rail item is active. Before flip 1 the rail lists no area:
  bell, gear and avatar only. Between the flips it carries the temporary
  Apps entry (section 3.5) [T018].
- Drive Build and the code of stages 0 to 6 reach `develop` in one
  release, with both keys off. Stages 8 to 12 follow in later releases,
  with `suite_flip_files` still off. Each flip happens later by key [T019].

### 14.2 Switch

- Each flip is one `frappe.conf` key: `suite_flip_shell` and
  `suite_flip_files`, set as a site config key (`bench set-config`
  locally; `site_config.json` on Frappe Cloud) [T014, T019].
- Faris sets and clears both keys on Frappe Cloud by hand and records the
  time in the stage report. No allowlist ask is filed [T019].
- The server reads the key for redirects. It sends the key to the client in
  the SPA boot. The client reads the flag from boot only [T014].
- A key turns a flip off without a deploy [T014].
- `suite_flip_shell` off after the code ships: Mail, Calendar and Meet
  routes keep `frame: 'none'` and render their standalone chrome (section
  9.1). The platform registers the service worker in both states. The key
  does not undo the manifest `id` change (section 3.15); ticket 010
  accepted that risk at deploy time [T018].
- The keys are deleted with the old pages [T014].

### 14.3 Redirect table

Composition owns one redirect table. It runs in `before_request`, so cold
loads, emails and bookmarks reach it [T014]. Every legacy route has a row
or a stated reason to have none [T020].

| Old | New |
|---|---|
| `/drive` | none: the Drive area's own route. `suite_flip_files` selects the route table (section 2.2) [T014, T020] |
| `/drive/trash` | none: the same path in the new table [T006, T020] |
| `/drive/recents` | `/drive/recent` [T006] |
| `/drive/favourites` | `/drive/starred` [T006] |
| `/drive/shared` | `/drive/shared-with-me` [T006] |
| `/drive/inbox`, `/drive/documents`, `/drive/presentations`, `/drive/attachments/<doctype>?/<docname>?` | `/drive` [T020] |
| `/drive/signup` | none: deleted (section 14.6) [T014] |
| `/drive/d/<id>` (folder) | `/drive/f/<id>` [T014] |
| `/drive/f/<id>` (file) | none: the new folder route's kind check replace-redirects to `/d/<id>` (section 2.2) [T020] |
| `/drive/w/<id>`, `/writer/w/<id>` | `/d/<id>` [T014] |
| `/drive/g/<id>` | by node kind (one read): `/drive/f/<id>` or `/d/<id>` [T014] |
| `/drive/{folder,document,file}/<old>`, `/drive/t/<team>/` | by kind, through `Drive Legacy Route` [Drive §3.15, T014, T015] |
| `/drive/t/<team>/<letter>/<id>` | as `/drive/g/<id>` [T014] |
| `/drive/l/<token>` | `/l/<token>` [T011, T014] |
| `/writer`, `/sheets`, `/sheets/new`, `/slides`, `/slides/presentation/new`, `/slides/not-permitted` | `/home` [T020] |
| `/sheets/trash` | `/drive/trash` [T020] |
| `/sheets/<docname>` | `/d/<node>` (one read of `Sheet.node`) [T014] |
| `/slides/presentation/view/<docname>` | `/d/<node>` [T020] |
| `/slides/presentation/<docname>`, `/slides/slideshow/<docname>` | `/d/<node>` (one read of `Presentation.node`) [T014] |
| `/suite` | `/home` [T014] |
| `/suite/start` | `/home` at flip 2 (section 14.9) [T014] |
| `/suite/setup`, `/suite/load-error` | none: they stay [T020] |
| `/mail/...`, `/calendar/...`, `/meet/...` | none: the prefixes stay (section 14.11) [T010, T014] |
| `/` | `/home` (section 2.1) [T001] |

[T014, T008, T011, T020]

- Every row targets a flip-2 surface. The server and the client guard
  apply the table only while `suite_flip_files` is on. With the key off,
  each old URL mounts its old page [T014, T009].
- Old Drive listings go to `/drive`. Old product home and utility pages go
  to `/home`, whose New menu and Recent cover them [T020].
- Matching order: exact rows come before parameter rows, and a parameter
  matches one path segment. So `/sheets/new`, `/sheets/trash`,
  `/slides/presentation/new` and `/slides/presentation/view/<docname>`
  match their own rows, not the parameter rows [T020].
- Every row accepts an optional trailing `/<slug>` and an optional trailing
  `/`, and drops both. The server sends no slug; the router adds the
  current one without a history entry (section 2.3) [T020].
- A row carries the query string through unchanged. The new page ignores
  keys it does not know. `/slides/presentation/<docname>?slide=3` becomes
  `/d/<node>?slide=3` [T020].
- A lookup that finds no node does not redirect. The request falls through
  to normal routing. While a flag can turn off, the old page mounts and
  shows its own missing-document state. After deletion an unmatched
  `/writer`, `/sheets` or `/slides` URL answers Frappe's 404 (section
  14.8); an unmatched `/drive/...` URL answers the Drive area's not-found
  view, because the `/drive` website rules serve the area [T020].
- A redirect never creates a document. `/sheets/new` and
  `/slides/presentation/new` go to a page. A GET that creates would spawn
  one document per visit [T020].
- The `/drive/t/<team>/<letter>/<id>` row matches today's legacy router
  (`frontend/src/apps/drive/legacy/routes.ts:172`).
- The server answers 302 while a flag can turn off. It answers 301 after
  deletion. Browsers cache a 301, which would break rollback [T014].
- One client router guard reads the same table, exported to the client. It
  handles old links clicked inside the app, such as an old link in a stored
  notification [T014].
- For Sheets and Slides the guard does a full page load, so the server does
  the lookup [T014].
- Desk's File form (`suite/public/js/file.js:9`) opens `/drive/g/<name>`.
  The `/drive/g/` row keeps it working. It is client code, so `node_url`
  does not cover it; rewriting it at deletion is optional [T020].
- Sheets' trash becomes Drive trash at Build (`Sheet.trashed` is a frozen
  legacy field), so `/sheets/trash` maps to `/drive/trash` with no loss
  [T020].
- Mail's `website_redirects` in `suite/hooks.py` (`/auth/validate`,
  `/outbound/...`, `/inbound/...`, `/spamd/...`) are Stalwart callbacks,
  not user pages. They stay [T020].
- The `/files/...` routes of ticket 001 never reached production, so they
  have no rows [T020].

### 14.4 Redirect lifetime

- Redirects stay forever. Stored rows are not rewritten [T014].
- The `/drive/{folder,document,file}/<old>` and `/drive/t/<team>/` rows
  read `Drive Legacy Route` through Drive's public interface. Drive keeps
  that table through Cleanup [Drive §3.15, §3.16, §14.10], so these rows
  stay with the rest.
- This corrects ticket 014 item 4, which removes these rows when Drive
  Cleanup drops the translate tables. The Drive spec wins for Drive
  behavior, so its §3.15 rule applies [T014].

### 14.5 Links the server builds

- One helper, `node_url(node)`, returns a URL by node kind. It reads
  `suite_flip_files`, so a rollback also rolls back new links. No caller
  builds a path string [T014].
- `node_url` lives on the Drive Python interface. Drive, Writer and Meet
  may not import `suite/composition`. It reads `suite_flip_files` from
  `frappe.conf` [ARCH 2.1, ARCH 2.2, T015].
- It replaces: notifications `get_link`, the share link, `drive_link.py`'s
  `NODE_ROUTE`, the shims' `/drive/w` and `/drive/g`, the Writer wikilink,
  the Meet recording email, and WebDAV HTML links [T014].
- The share notification's broken `/sheets?id=` link is fixed in the same
  pass [T014].

### 14.6 Invitations and signup

- Invitations use the Suite invitation resource over the framework's
  `User Invitation`. Its accept link lands on `/suite`, which the redirect
  table sends to `/home` once `suite_flip_files` is on [T017].
- The user sets a password through Frappe's `/update-password` [T014].
- `/drive/signup` and its page are deleted. The Drive invitation URL
  (`drive_user_invitation.py:91`) is retired with it [T011, T014]. The
  `Drive User Invitation` and `Account Request` tables are kept; Drive
  Cleanup deletes only their callers and permission hooks
  [Drive §3.16, T017].
- If the Suite invitation resource slips past flip 2, `/drive/signup` stays
  as a legacy page until deletion [T014].

### 14.7 Gates

Flip 1 [T014]:

- Browser journeys pass for Mail, Meet and Calendar in the shell.
- The four fixes in section 9.5 have landed.
- The Slides service worker serves no stale shell.
- Rollback is rehearsed once on the dev site, with a cold load of each
  page [T014, T018]:
  - Flag off: `/mail`, `/calendar` and `/meet` show no rail and their own
    sidebar header with Apps, Settings and Log out; Settings opens the
    Suite dialog on that product's first tab; Log out signs out; `/home`
    and a `/d/` route show the shell with an empty rail; `/drive` shows the
    old Drive page; `/suite/start` lands on `/mail`.
  - Flag on: the three prefixes show the rail with Mail, Calendar and Meet;
    the sidebar headers have no Apps, Settings or Log out; the rail gear
    opens Settings; the avatar menu logs out; the rail shows the temporary
    Apps entry; each row opens its old page.
  - A tab open across the flip keeps its state until reload, because the
    client reads the flag from boot only.

Flip 2 [T014]:

- Browser journeys pass for Home, Drive and documents.
- The first five Drive asks from ticket 006 have shipped (D1 to D5).
- New code calls none of the 69 legacy `suite.drive.api.*` names, checked
  by the boundary check (section 13.3) [T014, T017].
- A test hits every old path in the redirect table and checks the new path.
- Invitation accept lands on `/home`.
- The `/l/<token>` server rule exists and opens a folder and a file
  (ask D24).

The legacy Vitest manifest is not a gate. It shrinks by deletion [T014].

### 14.8 Deletion

- Deletion happens after flip 2 holds for one full release on production,
  and at least 14 days, with the legacy-call counter (ask D26) at zero over
  all 69 names [T014, T017].
- "One full release" is one production deploy of Frappe Cloud release
  group `bench-40775` that contains the files-flip code. The hold record
  names the deploy id and date [T019].
- The hold clock: 14 consecutive days at zero plus that one release.
  "Zero" means no count on any of the 69 names rose between two reads.
  Reads happen at the start, once a week, and at the end, by whoever sets
  the flip key. A non-zero read ends the streak. After the client is fixed
  or retired, the 14 days start again at the next zero read. The release
  clock restarts only if the fix itself needs a release. A hit from a
  browser user agent in the first days is a stale legacy tab; it retires
  itself on reload, so wait for the next zero read [T017].
- The Desk file picker (`suite/public/js/FileUploader.vue`, shipped as
  `ff_integration.bundle.js`) calls `files.get_root_folder`, `list.files`
  and `files.upload_file` today. It moves to `GET /roots`,
  `GET /nodes/<id>/children` and the upload routes before Cleanup. The
  boundary check and the deletion grep cover `suite/public/js` as well as
  `frontend/src`; the Drive Cleanup gate refuses until it is gone (Drive
  issue 40) [T017].
- One commit deletes: `apps/drive/legacy`, the old Writer, Sheets and
  Slides pages (the editors stay), both flag keys, `SUITE_APPS` and
  `lastApp`, the legacy Drive `SettingsDialog`, the standalone chrome of
  Mail, Calendar and Meet with `useAppSwitcher` and `getAppSwitcherItems`,
  and the temporary rail Apps entry [T014, T016, T018].
- The same commit removes the `/slides`, `/slides/<path>`, `/sheets`,
  `/sheets/<path>`, `/writer` and `/writer/<path>` rows from
  `website_route_rules`, and `/drive/l/<token>` once ask D24 has shipped.
  `/suite/<path>` stays for `/suite/setup`, `/suite/start` and
  `/suite/load-error`; the `/drive` rows stay for the Drive area. An
  unmatched `/writer`, `/sheets` or `/slides` URL then answers Frappe's
  404 instead of the SPA's not-found view with HTTP 200 [T020].
- Slides' `Slideshow.vue` is an old page, deleted in this commit. The
  Slides surface already has a slideshow mode. `ExportView.vue` moves into
  the Slides surface before deletion, so guests keep the product's export
  on `/d/` (section 10.4) [T015].
- The same change unregisters the Slides service worker and turns the
  redirects into 301s [T014].
- The counter is the evidence that Drive issue
  [36](../drive-layer-spec/implementation/issues/36-cleanup-later-release.md)
  asks for. Drive Cleanup then unblocks [T014].
- Legacy REST adapters go only after their product's zero-caller proof
  (section 4.4) [T003].

### 14.9 Service worker and PWA

- At flip 1 the Slides service worker stops caching the shell. Mail lives
  in the shell from flip 1, and a stale shell breaks rollback [T014].
- At flip 2 the PWA `start_url` path `/suite/start` goes to `/home` [T014].

### 14.10 Desk

- The `add_to_apps_screen` entry stays at `/suite`, which redirects to
  `/home` [T014].
- The Desk workspace link `/drive` opens the old Drive pages before flip 2
  and the Drive area after it. It needs no redirect row, so rollback holds
  [T014, T020].

### 14.11 Untouched by either flip

Mail's own login, signup and reset pages, `/meet/<code>` and
`/calendar/account/...` [T014].

### 14.12 Release note

One note per flip. The stage 7 or stage 13 report writes it and Faris
sends it. Four lines [T019]:

- what moved into the shell;
- old links redirect and bookmarks keep working;
- the key that turns it off and who holds it;
- where to report a broken page.

The Drive Build note (`links_minted`, changed anyone-with-link URLs)
belongs to the Drive program [T019, Drive §14.9].

## 15. Backend asks

Status values: **open** (not yet in the owning spec or code contract),
**specified** (the Drive spec now defines it, so Drive behavior follows
that section), **met** (the code already does it; no audit confirms it),
**filed** (an implementation issue exists), **withdrawn**, **superseded**.
"Specified" records that the Drive spec absorbed the ask; this spec does
not claim the code passes.

A feature that depends on an open ask ships disabled, with the reason in
its tooltip, until the ask ships. There is no interim behavior. The stage
that builds the feature waits on the ask. The one exception is the share
link: while D17 and D24 are open, `/drive/l/<token>` works through
`drive_link.py` (section 10.1) [T014, T015].

Where the asks land [T019]:

- There is one development branch, `forge/drive-layer`. Merge only, never
  rebase. Pull requests target `develop`.
- Drive asks D10 to D28 are Drive implementation issues under
  `wayfinder/drive-layer-spec/implementation/issues/`, built and merged on
  `forge/drive-layer`. The Issue column names each one. D1 to D9 shipped on
  the same branch (`20befde95`).
- Suite, Calendar, Meet, Mail and Writer asks land on `forge/drive-layer`
  in the stage that waits. An ask with no waiting stage stays open here and
  gets no branch until a stage needs it.

### 15.1 Drive program

| Id | Ask | Raised by | Depends | Issue | Status |
|---|---|---|---|---|---|
| D1 | Root discovery: `GET /roots` returns `{personal: {node, title}, organization: {node, title} \| null}`, active roots only | T005, T006 | 5.1 | shipped (`20befde95`) [T019] | specified [Drive §11.2] |
| D2 | Server ordering on children: folders first, `group_by=type\|owner\|modified`, `order_by` as stable secondary order, node id as final tie-breaker | T006 | 5.3 | shipped (`20befde95`) [T019] | specified [Drive §5.3, §11.2] |
| D3 | `kind=folder` filter inside the SQL window on children | T006 | 5.7, 6.9 | shipped (`20befde95`) [T019] | specified [Drive §5.3, §11.2] |
| D4 | Page-batched `expand=access` on every node-valued view | T006 | 5.4 | shipped (`20befde95`) [T019] | specified [Drive §11.2, §11.3] |
| D5 | Batched `expand=breadcrumbs` on `views/search` | T006 | 5.4, 5.10 | shipped (`20befde95`) [T019] | specified [Drive §5.7, §11.3] |
| D6 | Folder archive build, status and download routes | T005, T006 | 5.6 | shipped (`20befde95`) [T019] | specified [Drive §11.2] |
| D7 | Payload-free, after-commit `drive:changed` realtime event | T006 | 5.9 | shipped (`20befde95`) [T019] | specified [Drive §9.5] |
| D7a | Node event with `{node, parent, root, modified, action}` and per-folder rooms | SSC | 5.9 | none | superseded by D7 [T006] |
| D8 | `opened_at` on `views/recents` rows | T012 | 11.1 | shipped (`20befde95`) [T019] | specified [Drive §9.5, §11.2] |
| D9 | Notification unread-count route | T005, T012, SSC | 11.5 | shipped (`20befde95`) [T019] | specified [Drive §11.2] |
| D10 | Storage breakdown aggregates (by-type totals, largest files) | T005 | 12.2, 16 | [Drive 41](../drive-layer-spec/implementation/issues/41-storage-breakdown-on-root-usage.md) | filed |
| D11 | `create_upload` checks the title and returns 409 with the free title | T007 | 6.4 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed |
| D12 | `POST /nodes` 409 carries the free title | T007 | 6.6 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed |
| D13 | A browser (HTTP) replace skips the auto version and its charge. WebDAV keeps the rule | T007 | 6.8 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed. Today [Drive §8.5] versions every replace path |
| D14 | `DriveRestoreDestinationRequired`, a `DriveConflict` subtype | T007 | 6.9 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed |
| D15 | Batch purge route with the `{ok, failed}` shape | T007 | 6.10 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed |
| D16 | Empty trash route per root | T007 | 6.10 | [Drive 42](../drive-layer-spec/implementation/issues/42-upload-collisions-restore-and-purge-routes.md) | filed |
| D17 | A grant's `url` becomes `/l/<token>` | T008 | 7.7 | [Drive 43](../drive-layer-spec/implementation/issues/43-link-routes-and-unlock-lockout.md) | filed. [Drive §11.2] still returns `/drive/l/<token>` |
| D18 | `GET /links/<token>` returns `{node, kind, locked}` | T008 | none | none | withdrawn [T011] |
| D19 | List inherited grants with their source node, for example `GET /nodes/<id>/grants?inherited=1` | T008 | 7.3 | [Drive 44](../drive-layer-spec/implementation/issues/44-inherited-grants-passwords-and-share-email.md) | filed |
| D20 | Grant PUT: an omitted `password` keeps the hash; `password: null` clears it | T008 | 7.7 | [Drive 44](../drive-layer-spec/implementation/issues/44-inherited-grants-passwords-and-share-email.md) | filed |
| D21 | `PUT …/grants/$LINK` accepts `send_to: <email>`, sends the email and stores the address | T008 | 7.8 | [Drive 44](../drive-layer-spec/implementation/issues/44-inherited-grants-passwords-and-share-email.md) | filed |
| D22 | Grant PUT accepts `notify: true` and sends a share email to a user | T008 | 7.8 | [Drive 44](../drive-layer-spec/implementation/issues/44-inherited-grants-passwords-and-share-email.md) | filed |
| D23 | Spec fix: §11.2 shows `explain?: [...]` where code and §5.8 return an object | T008 | 7.4 | [Drive 44](../drive-layer-spec/implementation/issues/44-inherited-grants-passwords-and-share-email.md) | filed. The `{ticket, expires}` half is already in [Drive §11.2] |
| D24 | `/l/<token>` redirects by kind to `/drive/f/` or `/d/` with `#link=` | T011 | 2.4, 10.1, 14.7 | [Drive 43](../drive-layer-spec/implementation/issues/43-link-routes-and-unlock-lockout.md) | filed |
| D25 | Unlock 429 carries `Retry-After`; the failure that sets the lockout answers 429 | T011 | 10.2 | [Drive 43](../drive-layer-spec/implementation/issues/43-link-routes-and-unlock-lockout.md) | filed |
| D26 | Legacy-call counter in the `suite.drive.api.*` dispatch, keyed by name and user agent, read by a bench command | T014 | 14.8 | [Drive 45](../drive-layer-spec/implementation/issues/45-legacy-call-counter.md) | filed. Counts every name; the gate reads all 69 [T017] |
| D27 | Accept an expected `modified` on PATCH and answer `DriveConflict` | SSC | 3.9 | [Drive 46](../drive-layer-spec/implementation/issues/46-node-shape-favourite-and-expected-modified.md) | filed |
| D28 | `favourite` on the Drive node shape | T006, via [`ACCOUNTING.md`](ACCOUNTING.md) | 5.11 | [Drive 46](../drive-layer-spec/implementation/issues/46-node-shape-favourite-and-expected-modified.md) | filed |
| D29 | Type `shapes.py` outputs | SSC | 3.9, 4.5 | none | met. `suite/drive/http/shapes.py` already uses `TypedDict` |
| D30 | Settings, site settings and WebDAV routes (`GET`/`PATCH /settings`, `GET`/`PATCH /site-settings`, `GET /webdav`); Cleanup deletes all 69 names and the allowlist prefix | T017 | 4.4, 12.2, 14.8 | Drive issues [39](../drive-layer-spec/implementation/issues/39-settings-and-webdav-routes.md) and [40](../drive-layer-spec/implementation/issues/40-cleanup-deletes-every-legacy-name.md) | filed, ready-for-agent [T017] |

### 15.2 Suite

| Id | Ask | Raised by | Depends | Status |
|---|---|---|---|---|
| S1 | `GET /api/suite/people?q=`: users and groups, paged, any Suite user. Also carries `get_user_groups`'s job [T017] | T008 | 7.8 | open |
| S2 | `drive_link.html`: separate 404 and 410 copy, plus "Go to Home" for signed-in visitors | T011 | 10.11 | open |
| S3 | The setup gate skips `allowGuest` routes (`router/index.ts:198`) | T011 | 10.10 | open |
| S4 | Writer `ErrorPage.vue:61`: `/drive/login` becomes `/login?redirect-to=` | T011 | 10.10 | open |
| S5 | `GET /api/suite/site` carries `upgrade_url`, null when the site has no plan page | T021 | 12.6 | open. Upgrade plan stays disabled until it ships |

### 15.3 Meet

| Id | Ask | Raised by | Depends | Status |
|---|---|---|---|---|
| M1 | A route and a list endpoint for recordings and past meetings | MAP (T010) | 9.4 | open |

### 15.4 Calendar

| Id | Ask | Raised by | Depends | Status |
|---|---|---|---|---|
| C1 | Typed `conferencing: {meeting_id, url} \| null` on the event shape | T012 | 11.2 | met. `suite/calendar/http/routes.py` returns it (`47311aa11`) |
| C2 | `account` is optional on events; omitted means every account the caller owns | T012 | 11.2 | met. `suite/calendar/http/routes.py` reads every account when it is omitted (`47311aa11`) |
| C3 | Stop faking `modified` on calendars | SSC | none at launch | open |

### 15.5 Mail and Writer

These serve each product's later migration. No launch section depends on
them [SSC].

| Id | Ask | Raised by | Status |
|---|---|---|---|
| L1 | Mail: return `modified`, type outputs, fix `get_threads` returning a tuple | SSC | open |
| L2 | Writer: add return annotations | SSC | open |

### 15.6 Frappe framework

| Id | Ask | Raised by | Depends | Status |
|---|---|---|---|---|
| F1 | `StaticDataMiddleware` (`frappe/middlewares.py`) falls through on a miss under `/files/` instead of raising `NotFound`, which is a 500 on `bench serve` | T020 | none | filed as [frappe/frappe#43523](https://github.com/frappe/frappe/issues/43523). After the `/drive` rename Suite does not depend on it |

## 16. Open items

Each item names the affected section. "Meanwhile" appears only where a
source says what to do. Tickets 017 to 021 are folded in
([ticket 022](tickets/022-fold-decisions-into-the-spec-and-plan.md)).
What remains is implementation-time work, environment approvals and
post-launch fog.

### 16.1 From the map's "Not yet specified"

1. **Cross-product notification feed** (11.5). Meanwhile the bell is
   Drive-only. A joined feed is the planned upgrade [T012].
2. **Mounting spike** (3.4, 8.4). It must prove the full-pane box with
   Writer, the Sheets canvas and the Slides stage on desktop and phone.
   Meanwhile the CSS seam is not frozen [T002, MAP].
3. **Phone behavior per area beyond the shell chrome** (9.3, 11). Ticket
   006 answers the Drive area (section 5.14). The other areas stay open
   [MAP, T006].
4. **Sentry ownership** (13.1). Meanwhile Sentry stays where it is
   [T010, T013].
5. **Meet recordings and past meetings** (9.4). Meanwhile they are not on
   `/meet` (ask M1) [T010].
6. **Keyboard shortcuts across areas** (Cmd+number, Escape) (3.5). Cmd+K
   is out of scope. Meanwhile each app keeps its Shortcuts entry, Mail's
   keys fire only on Mail routes, and the theme shortcut is not restored
   for the flag-off state [T010, T012, T016, T018].
7. **Quota and storage breakdown surface** (6.5, 12.2). Settings > Drive >
   Statistics is the launch surface [T016, T017]. Until ask D10 lands it
   shows `/roots/<id>/usage` totals [Drive §11.7]. Whether the Drive area
   sidebar also shows it is open [MAP].
8. **Named Meet rooms** (11.4). A Meet-program idea with no doctype and no
   route [MAP, T012].
9. **Finding link-only items again** (10.7). Meanwhile link-only items
   stay out of Recent, Starred and Shared with me. A server record of
   opened links would be a Drive ask [MAP, T011].
10. **WebDAV clients and redirects** (14.3). Does a WebDAV client follow a
    302 on `/drive/d/<id>`? Not verified [MAP].

### 16.2 Gaps found while drafting

11. **In-shell `frame` literal** (3.3). Ticket 010 collapses the frame set
    to "in the shell or outside". No ticket names the in-shell value.
    IMPLEMENTATION.md and `platform/contracts` still show
    `'area' | 'document' | 'none'`. Code keeps `frame` optional with the
    default `'area'` (`composition/routes.ts:26`). The plan's shell frame
    stage names it.
12. **DocumentSession signatures** (8.5). No ticket fixes the signatures of
    `share`, `comments` and `versions`. Current code types their results as
    `unknown` and `share()` returns an unavailable placeholder. The stage
    that builds them designs them with the codebase-design skill.
13. **Server-state details** (3.9). GC timeout, default stale time, output
    validation in production builds, and prefetch on hover are undecided
    [SSC].
14. **Share dialog container on phone** (7.3). Ticket 008 says "the shell's
    bottom sheet". Ticket 010 moved the shell's sheet into `<AreaSidebar>`.
    frappe-ui `BottomSheet` exists at Suite's pin
    (`references/frappe-ui-shell-gap.md`). No source names it for the
    dialog.

### 16.3 Post-launch

15. **Making a document a template from the client** (5.12, 8.9).
    `is_template` on a user's node has no entry point at launch: no "Use as
    template" row action and no Templates saved view. Drive §8.10 ships
    templates from Administrator's Templates folder [T021, T006].
