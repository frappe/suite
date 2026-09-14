# Accounting: what the branch implements per ticket bullet

Status: written 2026-09-15 by the W4-verify package on branch
`forge/wayfinder-unified-frontend`, at commit `d54f91803` plus the Files and
shell fixes named in the verify report. One row per normative bullet of the
ticket resolutions this effort implements: 001, 002, 003, 006, 009, 012, 013,
and the Home and Files parts of 004 and 005.

Columns:

- **State** is `done`, `partial`, `delegated` or `missing`.
- **Verified by** names the browser journey (spec file plus test title) or the
  unit test that proves the row. Journeys live under `e2e/unified-frontend/`.
  A row with no test says `code only`.
- **Note** says what is missing or which ticket owns the rest.

Browser journeys ran against the dev server on `http://slides.localhost:8086`
with the bench on `127.0.0.1:8006`, site `slides.localhost`, Playwright's own
Chromium.

## Ticket 001: route grammar

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Canonical area routes `/home`, `/files`, `/mail`, `/calendar`; Meet full-screen at `/meet/<code>` | done | shell/specs/navigation.spec.ts "the rail moves between Home and Files"; composition/routes.ts | Meet keeps its own full-screen route from the legacy router. |
| Historical `/suite` and `/drive/...` survive only as redirects | partial | shell/specs/navigation.spec.ts "the legacy /drive page stays reachable beside the new Files area" | `/suite` and `/drive` still mount their old pages. Ticket 014 owns the gated redirects. |
| `/` replacement-redirects to `/home` | done | shell/specs/navigation.spec.ts "the root path redirects to /home" | |
| Node-first `/d/<node-id>/<slug>`, id authoritative, slug decorative | done | files/specs/folder.spec.ts and presentation.spec.ts "a document row opens the canonical /d/ route" | |
| A missing or stale slug resolves, then the router replaces the URL without a history entry | done | files/specs/folder.spec.ts "a missing slug is replaced without a new history entry" and "a stale slug is corrected to the current title" | Folder route proves the rule; DocumentHost.vue uses the same helper. |
| One content route for Writer, Sheets, Slides and previewable files; the node response selects the renderer | done | files/specs/new-and-open.spec.ts "each registered document type opens its own surface" and "an unsupported file keeps the /d/ route and offers Download" | |
| Unicode-aware slugs, 80-character cap at a character boundary | done | frontend/src/apps/drive/files/internal/slugify.test.ts | |
| `/files` is My files, `/files/organization` is Organization files, personal sites omit it | done | files/specs/roots.spec.ts "a business site lists both roots in the Locations section" and "a personal-only site hides Organization files and its Trash tabs" | |
| `/files/shared-with-me` is a computed view, never a third root | done | files/specs/saved-views.spec.ts "Shared with me renders its own empty or listed state" | |
| Folder routes stay node-id based, the API supplies breadcrumbs | done | files/specs/folder.spec.ts "breadcrumbs describe the open folder and navigate back" | |
| Saved destinations are paths; query keys describe presentation only | done | files/specs/saved-views.spec.ts "a saved view drops sort and group keys it cannot honor"; files/specs/presentation.spec.ts | |
| `/l/<token>` resolves the grant, remembers the token and replacement-navigates | delegated | shell route table only | `/l/:token` renders the unavailable surface. Ticket 011 owns the flow. |
| Every route declares `area`, `frame`, `scroll`, `allowGuest`, `title`, `favicon` | done | shell/specs/page-meta.spec.ts "each area route sets its title and favicon" | |
| A guest on an allowed route gets the Guest surface | partial | code only (shell/ShellLayout.vue, shell/GuestSurface.vue) | No guest journey. Ticket 011 owns guest entry. |

## Ticket 006: Files area listing and navigation

### Destinations and roots

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Locations section with My files and, on business sites, Organization files | done | files/specs/roots.spec.ts "a business site lists both roots in the Locations section" | |
| Views section with Shared with me, Recent, Starred, then a separated Trash; no All | done | files/specs/saved-views.spec.ts (four listing journeys) | |
| Ticket 001 routes drive the four views (`views/shared`, `views/recents`, `views/favourites`, `views/trash`) | done | files/specs/saved-views.spec.ts "Starred lists the starred node", "Recent lists a visited node", "Trash lists the trashed node under My files" | |
| Trash has a root tab switcher, `?root=organization` names the semantic root | done | files/specs/roots.spec.ts "Trash shows one root at a time through its tabs" | |
| `GET /api/suite/drive/roots` loaded and cached when Files mounts; semantic routes translate through it | done | files/specs/roots.spec.ts "Organization files opens the site's shared root" and the stubbed personal-only journey | |

### Folder listing and presentation

| Bullet | State | Verified by | Note |
|---|---|---|---|
| A root lists through the ordinary children route; a folder route fetches detail plus children | done | files/specs/folder.spec.ts "opening a folder row navigates to its canonical route" | |
| 60-row default window, opaque cursors | done | files/specs/paging.spec.ts "the server answers a 60-row window with a cursor" | |
| Infinite loading appends `next_cursor` windows; only a null cursor ends the list | done | files/specs/paging.spec.ts "the listing loads the next window when the sentinel becomes visible" | |
| A permission-filtered empty window with a cursor is skipped automatically | done | frontend/src/apps/drive/files/features/listingWindows.test.ts | |
| A failed next page keeps the rows and shows an inline retry | done | files/specs/paging.spec.ts "a failed next window keeps the loaded rows and offers a retry" | Fixed in this package: the walk stopped only on a null cursor and retried forever. |
| Sorting and grouping are server-owned; a change clears pages and restarts without a cursor | done | files/specs/paging.spec.ts "changing the sort restarts the listing without a cursor" and "changing the group restarts the listing without a cursor"; apps/drive/client/nodes.test.ts | |
| Group by Type, Owner and Modified; server-contiguous groups, client derives headings | done | files/specs/presentation.spec.ts "group by Type renders contiguous server-ordered sections"; features/grouping.test.ts | The menu offers all three keys (FilesPage.vue:304-307). |
| Initial presentation is list, no grouping, Name ascending | done | files/specs/presentation.spec.ts "the initial presentation is list, no grouping, Name ascending" | |
| Default columns Name, Owner, Modified; Type and Size optional; no Location or sharing column | done | files/specs/presentation.spec.ts "optional columns are a saved preference, not URL state" | |
| URL query beats the saved preference beats the defaults; `view`, `sort`, `dir`, `group` replace history | done | features/presentation.test.ts; files/specs/presentation.spec.ts | |
| Folder navigation carries supported settings forward; saved views drop what they cannot honor | done | files/specs/folder.spec.ts "folder navigation carries the presentation query forward"; files/specs/saved-views.spec.ts "a saved view drops sort and group keys it cannot honor" | |
| Visible columns are a saved preference, not URL state | done | files/specs/presentation.spec.ts "optional columns are a saved preference, not URL state" | |
| Exact expansion sets per surface | done | files/specs/presentation.spec.ts (list `access`, grid `access,preview`); files/specs/search.spec.ts "search asks for the breadcrumb expansion" | |
| Grid preview URLs refresh at 10 minutes, pause on a hidden tab, revalidate on focus | partial | code only (files/features/previewRefresh.ts:1,37) | No journey. A 10-minute timer is impractical in a browser test. |
| One failed image refreshes its preview once, then falls back to the MIME icon | partial | code only (files/features/FilesListing.vue previewError) | No journey. |

### Rows, icons and opening

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Folder rows open `/files/f/...`; document rows open `/d/...` through the content registry | done | files/specs/presentation.spec.ts "a document row opens the canonical /d/ route" | |
| A file opens the same `/d/` route; an unsupported format shows No preview with Download | done | files/specs/new-and-open.spec.ts "an unsupported file keeps the /d/ route and offers Download" | |
| A link confirms its target origin, then opens a new tab | done | files/specs/new-and-open.spec.ts "a link row confirms its origin before opening a tab" | |
| Root nodes never appear as ordinary rows | done | files/specs/roots.spec.ts "Organization files opens the site's shared root" | |
| Row menu: Open, Open in new tab, Download, Rename, Move, Make a copy, Star/Unstar, Share, Move to trash | partial | files/specs/mutations.spec.ts (rename, move, copy, star, share, trash) | The menu adds Select, matching the prototype. Star/Unstar cannot show its state: see the star row below. |
| Download is hidden for links; folder download needs the archive route | done | code (FilesPage.vue rowMenuOptions) and the archive route family in suite/drive/http/translator.py:99-113 | |
| The access expansion hides actions the row's role does not allow | partial | code (FilesPage.vue hasRole gates Rename, Move, Share, Move to trash) | No journey: the Administrator fixture owns every node. |
| Rename and Move preserve a `DriveConflict` and never suffix silently | done | files/specs/mutations.spec.ts "a rename conflict keeps the dialog open with the server message" | |
| Copy and Restore accept the server title | done | files/specs/mutations.spec.ts "Make a copy accepts the title the server returns" | Restore is ticket 007. |
| One Drive-owned folder picker with root tabs, lazy folder paging, UPLOAD-only selection | done | files/specs/mutations.spec.ts "Move uses the Drive folder picker and rewrites the parent"; code (FolderPicker.vue:79,82) | |

### Selection and mutation outcomes

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Selection holds explicit loaded node ids; Select all means all loaded rows | done | files/specs/selection.spec.ts "Select all loaded selects only the loaded rows"; features/selection.test.ts | |
| Destination, view, sort, group or Trash-tab changes clear selection | done | files/specs/selection.spec.ts "changing the destination clears the selection" | |
| Desktop enters selection through a checkbox or Cmd/Ctrl-click; Shift-click takes a loaded range; Escape clears | done | files/specs/selection.spec.ts "Ctrl-click enters selection and the bulk bar carries two actions", "Shift-click takes the loaded visible range", "Space selects, Shift+Space extends the range and Escape clears" | Deliberate deviation: checkboxes appear only in selection mode, matching the prototype. Entry is Cmd/Ctrl-click, the toolbar menu, or the row menu. Shift-click was fixed in this package. |
| Mobile enters through a long press or row-menu Select; taps toggle; Back exits | done | files/specs/mobile.spec.ts "a long press on a grid tile enters selection mode", "a long press on a list row enters selection mode", "the row menu Select enters selection mode on mobile", "browser Back leaves selection mode instead of the folder" | Both long presses were fixed in this package. |
| The bulk bar is equal height and replaces the toolbar without moving the list | partial | code (FilesPage.vue toolbar row is `h-7` for both states) | No pixel journey; the pixel package owns that check. |
| The bulk bar carries only Move and Move to trash, one gesture is one request | done | files/specs/selection.spec.ts "Ctrl-click enters selection and the bulk bar carries two actions" | |
| Successful ids leave selection, failed ids stay, the result reads `n moved · n failed` with Details | done | files/specs/selection.spec.ts "a mixed bulk move reports both halves and keeps the failures selected" | |
| Trash replaces the bar with Restore and Delete forever | done | files/specs/saved-views.spec.ts "the trash bulk bar offers only the ticket 007 placeholders" | Both stay disabled. Ticket 007 owns their flows. |
| Own mutations update the normalized store and revalidate in the background | done | code (apps/drive/client/nodes.ts optimistic/invalidates); files/specs/mutations.spec.ts "a rename that succeeds updates the row and the server" | |
| A payload-free `drive:changed` event debounces observed listings | done | suite/drive/_core/changes.py:9 and suite/drive/tests/test_changes.py; frontend apps/drive/client/realtime.ts:11 | No two-browser journey. |

### Search, visits, starring and creation

| Bullet | State | Verified by | Note |
|---|---|---|---|
| The Search files field calls tree-wide `views/search`, the term is `q`, clearing restores the listing | done | files/specs/search.spec.ts "the search field finds nodes across the tree and shows their path" and "clearing the term restores the listing at the current route" | |
| Search rows show a path beneath every result | done | files/specs/search.spec.ts "the search field finds nodes across the tree and shows their path" | |
| `POST /nodes/<id>/visit` only after a successful open or a confirmed link | done | files/specs/saved-views.spec.ts "Recent lists a visited node"; code (FilesPage.vue:292,390 and apps/drive/client/session.ts:106) | |
| Star and Unstar are per user and update every cached appearance | partial | files/specs/mutations.spec.ts "Star from the row menu reaches the Starred view"; fixme "a starred row shows its star and offers Unstar" | The node shape has no `favourite` field, so no row ever paints its star and the menu always reads Star. Backend gap, recorded for the Drive program. |
| New holds Folder, Upload files, Writer document, Spreadsheet, Presentation and Link | done | files/specs/new-and-open.spec.ts (New Folder, New Writer, New Spreadsheet, New Presentation, Upload disabled) | The document entries come from the registry, so the labels read Document, Spreadsheet, Presentation. |
| New appears only in a concrete destination with UPLOAD; views and search hide it | done | files/specs/saved-views.spec.ts "saved views hide New because they have no destination"; files/specs/search.spec.ts "search hides New because it has no destination" | |
| All three document entries call the generic Drive creation workflow | done | files/specs/new-and-open.spec.ts "New Writer document creates the node and lands on /d/" and the Sheet and Presentation journeys | |

### Mobile and state behavior

| Bullet | State | Verified by | Note |
|---|---|---|---|
| The Files bottom-nav item opens `/files` from another area, and the panel sheet while Files is active | done | files/specs/mobile.spec.ts "the bottom-nav item and the header button open the same sheet" | |
| A header destination button opens the same sheet, breadcrumbs sit beneath it | done | files/specs/mobile.spec.ts "the mobile header shows the destination and a back control inside a folder" | |
| The sheet closes after a destination is chosen | done | files/specs/mobile.spec.ts "the sheet closes after a destination is chosen" | Fixed in this package: nothing closed the sheet on navigation. |
| Skeleton, rows, access-aware empty state, or inline error with Retry | partial | code (FilesListing.vue:5,14,121) | Empty copy names the destination. The empty state does not carry its own New button. |
| Query failures never toast; a refresh failure keeps stale rows with a compact warning | done | code (FilesListing.vue:121 Alert "Could not refresh files"); files/specs/paging.spec.ts "a failed next window keeps the loaded rows and offers a retry" | |
| Native list semantics, Enter to open, Space to select, accessible menu trigger, restored focus | partial | files/specs/selection.spec.ts "Enter on a focused row opens it" and the Space journey | The column switches in the view menu render as `role="switch"` with no accessible name, so they are reachable only by position. |

### Frontend module and interface

| Bullet | State | Verified by | Note |
|---|---|---|---|
| All Files UI and client behavior live under `apps/drive/`; descriptors under `apps/drive/client/` | done | `yarn check:import-boundaries` | |
| `apps/drive/index.ts` exports `filesArea`, `driveRecents()`, `createDriveDocument()`, `driveNodeRoute()`, `DriveNodeSummary` | done | code (apps/drive/index.ts:42-61); home/specs/home.spec.ts uses all three paths through Home | |
| Raw transport, resources, dialogs and product internals stay private | partial | `yarn check:import-boundaries` | Writer and Slides keep their legacy Drive subpath imports, baselined as existing violations. |

### Backend asks

| Ask | State | Verified by | Note |
|---|---|---|---|
| 1. Root discovery `GET /api/suite/drive/roots` | done | files/specs/roots.spec.ts | |
| 2. Server ordering and grouping on children, folders first, id tie-breaker | done | files/specs/presentation.spec.ts "group by Type renders contiguous server-ordered sections"; suite.drive.http.tests | |
| 3. SQL-window `kind=folder` filter for the picker | done | code (FolderPicker.vue:79) and the children route parameter | |
| 4. Page-batched `expand=access` | done | files/specs/presentation.spec.ts | |
| 5. Batched `expand=breadcrumbs` on `views/search` | done | files/specs/search.spec.ts "search asks for the breadcrumb expansion" | |
| 6. Folder archive build, status and download routes | done | suite/drive/http/translator.py:99-113; row menu Download for folders | No journey: the archive build is asynchronous. |
| 7. Payload-free `drive:changed` signal | done | suite/drive/_core/changes.py:9 | |
| Node shape carries `favourite` | missing | files/specs/mutations.spec.ts fixme "a starred row shows its star and offers Unstar" | `NodeShape` in suite/drive/http/shapes.py has no `favourite` key, so the star never renders. Drive program work. |

## Ticket 012: Home, palette and notifications at launch

### Home Recent

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Source is Drive Recent through `GET /api/suite/drive/views/recents` only | done | home/specs/home.spec.ts "Recent lists the documents the account opened"; apps/drive/client/views.ts:35 | |
| 12 rows, one page, no cursor | done | apps/drive/client/views.ts:35-38 (`query`, limit 12, no cursor param) | |
| No `expand=preview`; the card shows a kind icon | done | apps/drive/client/views.ts:36 sends only `view` and `limit` | |
| The card shows kind icon, title and an opened relative time | done | composition/home/HomePage.vue:104-115; composition/home/homeTime.test.ts | |
| View all targets the Files Recent saved view | done | composition/home/HomePage.vue:43 (`/files/recent`) | |
| Backend ask: `views/recents` rows carry `opened_at` | done | suite/drive/http/routes.py:801-802 and shapes.py:79 | |

### Home Upcoming

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Source is `GET /api/suite/calendar/events` only | done | home/specs/home.spec.ts "Upcoming groups the events and offers Join for a conferencing one"; apps/calendar/client/events.ts:12 | Administrator has no JMAP account on this site, so the journey stubs the answer and the empty case is checked against the live route. |
| The window is now to end of tomorrow, giving Today and Tomorrow groups | done | composition/home/homeTime.ts:8-15; composition/home/homeTime.test.ts:34 | |
| A row shows time, title and a Join button when the event has a meeting | done | home/specs/home.spec.ts "Upcoming groups the events and offers Join for a conferencing one" | |
| Backend ask: typed `conferencing` object or null | done | suite/calendar/http/routes.py:52,89,101 | |
| Backend ask: `account` optional, omitted means every account | done | suite/calendar/http/routes.py:57,77-78 | |

### The New menu

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Three items: Document, Spreadsheet, Presentation | done | home/specs/home.spec.ts New journeys; composition/documentRegistry.ts:6-10 | |
| All three use generic Drive creation, then open `/d/<node>/<slug>` | done | home/specs/home.spec.ts "New Document creates a Writer node in the Personal Root and opens it", "New Spreadsheet creates a Sheet node and opens it", "New Presentation creates a Presentation node and opens it" | |
| A Home create lands at the top of the Personal Root with no destination dialog | done | home/specs/home.spec.ts "New Document creates a Writer node in the Personal Root and opens it" asserts the parent | |

### Meet entry point

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Meet dropdown: instant, restricted, Join with code | partial | code (composition/home/HomePage.vue:396-415; apps/meet/client/mutations.ts:5) | No journey: creating a room needs the Meet backend and leaves a room behind. |
| Join with code is a dialog plus a client route, no new endpoint | partial | code (composition/home/HomePage.vue:259-277,445-454) | No journey. |
| Schedule dropdown keeps Event and Meeting; Meeting calls `scheduled-meetings` | partial | code (composition/home/HomePage.vue:417-431) | No journey. |

### Command palette

| Bullet | State | Verified by | Note |
|---|---|---|---|
| No Cmd+K palette and no rail Search button | done | grep over frontend/src/{shell,composition} finds no palette; shell/Rail.vue:32-36 holds only the bell, Settings and the account menu | |

### Notifications

| Bullet | State | Verified by | Note |
|---|---|---|---|
| The bell shows Drive notifications through `GET /api/suite/drive/notifications` | done | home/specs/notifications.spec.ts "the badge counts unread notifications and Mark all read clears them" | Nothing creates a Drive Notification over HTTP yet, so the journey seeds real rows through the site, then removes them. |
| The bell opens a popover over the rail and the feed scrolls inside it | done | home/specs/notifications.spec.ts (popover visible with its rows); composition/notifications/NotificationsBell.vue:2,63 | |
| Clicking a row marks that row and navigates; Mark all read clears the rest | partial | home/specs/notifications.spec.ts asserts Mark all read; composition/notifications/NotificationsBell.test.ts:109,139 covers the single row | The single-row click has no browser journey: a seeded row points at a fixture node. |
| Opening the popover marks nothing | done | composition/notifications/NotificationsBell.test.ts:97; home/specs/notifications.spec.ts reads the badge before and after opening | |
| Backend ask: notification unread-count route | done | suite/drive/http/routes.py:1106-1110; home/specs/notifications.spec.ts reads the badge from it | |
| The Mail rail badge comes from `GET /api/suite/mail/inbox-summary` through `appRegistry` | done | composition/appRegistry.test.ts:75,81 | Administrator has no JMAP account, so no browser journey renders the badge. |
| `AreaDefinition` stays frozen: no `loadBadge`, no platform badge bus | done | platform/contracts/index.ts:26-36 | |
| The bell is shell chrome with no registry entry | done | composition/appRegistry.ts:10-15; App.vue:9-11 mounts it in the rail slot | |

### Empty and failure states

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Every section always renders its heading | done | home/specs/home.spec.ts "a failing Recent read leaves Upcoming intact" and "a failing Upcoming read leaves Recent intact" | |
| Empty Recent reads "Nothing yet" and points at New | done | composition/home/HomePage.vue:79-91; composition/home/HomePage.test.ts | |
| Empty Upcoming reads "Nothing scheduled" and keeps its controls | done | home/specs/home.spec.ts "Upcoming reports an empty calendar when the account has no events" | |
| A failed section keeps its heading and shows an inline retry; the other still renders | done | home/specs/home.spec.ts "a failing Recent read leaves Upcoming intact" and "a failing Upcoming read leaves Recent intact" | |
| No greeting line; the PageHeader title is "Home" | done | composition/home/HomePage.vue:5 | |

## Ticket 009: content page contract

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Composition owns one generic `DocumentHost` for `/d/<node>/<slug>`, keyed by node id, disposing on the move | done | files/specs/new-and-open.spec.ts "each registered document type opens its own surface"; composition/DocumentHost.test.ts:60 | |
| The adapter renders the complete document surface; the interface is one-way | done | platform/contracts/index.ts:44-48; composition/DocumentHost.test.ts:48 | |
| One full-pane mount box, no product sizing flags | done | composition/DocumentHost.vue:122,144; composition/ShellMounting.test.ts:30 | |
| `DocumentSession` is the deep interface; the Drive Node title is the sole title | done | apps/drive/client/session.ts:48-78,253-302; apps/drive/client/session.test.ts:18; shell/specs/page-meta.spec.ts "a hosted document sets the page title to the document title" | |
| The product owns its body, save calls, collaboration client and recovery | done | apps/writer/surface/WriterSurface.vue:32-46; apps/sheets/surface/SheetsSurface.vue:109 | |
| Drive access is the baseline; a collaboration verdict may only narrow it and cancels pending writes | partial | apps/writer/surface/access.test.ts:6 | No collaboration verdict path exists. The surface reacts to the Drive role only and cancels nothing. |
| Access refreshes after a share mutation, on focus and every five minutes | done | apps/drive/client/session.ts:246-251,269-276 | No test asserts the timers. |
| Link codes stay scoped behind a grouper with the 20-code cap | done | apps/drive/client/session.ts:201-234; apps/drive/client/session.test.ts:19 | |
| Media named by node id resolves to a reactive handle refreshed at ten minutes | partial | apps/drive/client/session.ts:171-194 | No product calls `session.media()`, so stored bodies still do not name media by node id. |
| Composite decks group credentials and render progressively with per-group retry | done | apps/slides/surface/compositeGroups.test.ts:22; apps/slides/surface/SlidesSurface.vue:128-156 | |
| Comments and versions are Drive records rendered by product-owned panels | partial | apps/writer/surface/WriterSurface.vue:223-243; apps/slides/surface/SlidesSurface.vue:280-290 | Sheets renders neither panel. |
| A product Share button calls the session's Drive-owned share action, Drive hosts the one dialog | delegated | files/specs/mutations.spec.ts "Share stays explicitly unavailable until ticket 008" | The session's share action returns an unavailable stub and no share dialog exists. Ticket 008 owns it. |
| One `DocumentTypeDefinition` per product, composition owns the ordered registry | done | composition/documentRegistry.test.ts:5; apps/{writer,sheets,slides}/index.ts:16-21 | |
| New, New from template and Copy use generic Drive workflows and navigate to `/d/` | partial | files/specs/new-and-open.spec.ts (New); files/specs/mutations.spec.ts "Make a copy accepts the title the server returns" | There is no New from template and no template filter. Copy stays in the listing instead of navigating. |
| Each surface installs the standard leave guard | done | apps/writer/surface/navigation.test.ts:6; sheets and slides carry the same module | |
| Grow-beside: `/d/` mounts only the new host; legacy URLs keep the old pages | done | composition/routes.ts:97-106; shell/specs/navigation.spec.ts "the legacy /drive page stays reachable beside the new Files area" | |

## Ticket 013: frontend module layout and import boundaries

| Bullet | State | Verified by | Note |
|---|---|---|---|
| New Files code under `apps/drive/files/{pages,features,internal}`, no sibling `apps/files` | done | `yarn check:import-boundaries`; apps/drive/index.ts:33-40 | |
| The old `/drive` UI sits under `apps/drive/legacy` and stays separately routed | done | apps/drive/index.ts:73-82; shell/specs/navigation.spec.ts "the legacy /drive page stays reachable beside the new Files area" | |
| New Files code must not import `apps/drive/legacy`, enforced by the checker | done | frontend/scripts/check-import-boundaries.mjs:497-504 with self-test cases at 589-591 | |
| Day one creates the eight platform modules | done | frontend/src/platform/{session,transport,server-state,realtime,translation,theme,page-meta,feedback} each with tests | |
| Old paths may forward to the platform | done | frontend/src/boot/session.ts:4-12 | |
| Sentry and PWA stay where they are | done | frontend/src/boot/sentry.ts; no platform/sentry | |
| `utils/useChunkedUpload.ts` stays legacy debt | done | frontend/src/utils/useChunkedUpload.ts; no platform/upload | |
| The four-layer dependency direction is enforced | done | `yarn check:import-boundaries`; frontend/scripts/check-import-boundaries.mjs:493-529 | |
| One seam per product at `apps/<product>/index.ts`, package-root-only cross imports | done | frontend/scripts/check-import-boundaries.mjs:487-491 | |
| Exact shrinking baseline: a new violation fails, a resolved entry left behind fails | done | frontend/scripts/check-import-boundaries.mjs:400-414,611-631 | |
| The same rule covers `frappe-ui/experimental` and `frappe-ui/src/...` imports | done | frontend/scripts/check-import-boundaries.mjs:536-543 | 82 unstable frappe-ui imports are baselined today. |
| Each area keeps lazy `loadRoutes` and `loadPanel`; entering one area loads no other | done | composition/appRegistry.test.ts; platform/contracts/index.ts:36-37 | |
| Document surfaces and heavy libraries stay behind deeper dynamic imports | done | `yarn check:bundle-budget` (107.93 KiB gzip, 23 chunks); apps/{writer,sheets,slides}/index.ts:20 | echarts sits behind the Sheets chart surface; see the note under the gates. |
| The initial static graph is capped at 200 KiB gzip and measured from the build graph | done | `yarn check:bundle-budget` | Measured 107.93 KiB gzip on this branch. |
| Unit tests beside the code, browser journeys under `e2e/unified-frontend` | done | frontend/vitest.config.ts:41-48; e2e/unified-frontend/{shell,files,home} | |
| The unified project is zero-red; legacy uses an exact shrinking manifest | done | `yarn test:unified` (101 passed); `yarn test:legacy` (matched the manifest, 0 expected failures) | The 57 Slides assertions and the Writer collection error are resolved and removed from the manifest. |
| CODEOWNERS encodes the new paths | done | .github/CODEOWNERS:31-38 | |

## Ticket 004: frappe-ui shell component gap (Home and Files parts)

| Bullet | State | Verified by | Note |
|---|---|---|---|
| No gap at the pin: every shell primitive the prototype imports is exported | done | shell/specs/navigation.spec.ts and mobile.spec.ts run the rail, panel, bottom nav and sheet | No frappe-ui bump was needed. |
| `frappe-ui/list` is the stable entry and Files uses it | done | apps/drive/files/features/FilesListing.vue imports `frappe-ui/list` | |
| New code adds no `frappe-ui/experimental` or `frappe-ui/src/...` import | done | grep over composition, shell, platform and apps/drive/{files,client,index.ts} returns nothing; `yarn check:import-boundaries` | |
| Suite keeps its own Rail and Sidebar wrappers for geometry, fades, route rules and badges | done | shell/Rail.vue, shell/ContextualPanel.vue; shell/specs/navigation.spec.ts "the contextual panel follows the active area" | |
| Debt: `frappe-ui/src/components/Dialog/types` in apps/writer/utils/dialogs.ts | partial | `yarn check:import-boundaries` baseline | Still present, still baselined. |

## Ticket 005: legacy Drive client inventory (Home and Files parts)

| Bullet | State | Verified by | Note |
|---|---|---|---|
| New Files and Home code calls REST, never the 60 legacy names | done | `yarn check:import-boundaries`; every Files and Home journey drives `/api/suite/drive/...` only | The legacy names remain in apps/drive/legacy and in Writer and Slides. |
| The generic creation rule replaces direct Writer, Sheets and Slides creation endpoints | done | files/specs/new-and-open.spec.ts and home/specs/home.spec.ts New journeys | Both menus post to `/api/suite/drive/nodes`. |
| Backend ask: root discovery route | done | files/specs/roots.spec.ts | |
| Backend ask: notification unread count | done | home/specs/notifications.spec.ts | |
| Backend ask: folder archive download | done | suite/drive/http/translator.py:99-113 | |
| Backend ask: storage breakdown aggregates | missing | no client module | New Files code shows no quota or storage surface. Nothing in `apps/drive/client` reads it. |
| Socket: the legacy list events are replaced by one `drive:changed` signal | done | apps/drive/client/realtime.ts:11; suite/drive/_core/changes.py:9 | |

## Ticket 002: shell and platform interface

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Each product exports its area through `apps/<product>/index.ts`; composition owns the registry | done | composition/appRegistry.test.ts:53; composition/appRegistry.ts:3-15 | |
| `AreaDefinition` carries only id, label, icon, `to`, lazy loaders and capabilities; array order sets rail position | done | platform/contracts/index.ts:26-36; shell/specs/navigation.spec.ts "the rail moves between Home and Files" | |
| The shell owns rail, panel, content pane, mobile nav and sheet; a document replaces the panel with a full-pane mount | done | composition/ShellMounting.test.ts:29-95; shell/specs/mobile.spec.ts; files/specs/new-and-open.spec.ts "each registered document type opens its own surface" | |
| Code enters `platform/` only when product-neutral with two consumers | done | frontend/scripts/check-import-boundaries.mjs:506-526 | |
| `boot/session.ts` is rewritten behind one `@/platform/session` | partial | platform/session/index.test.ts; shell/specs/capabilities.spec.ts | Shell surfaces still read `@/boot/session`: LauncherView.vue:48, useWorkspace.ts:4, settings/SuiteSettingsDialog.vue:42, settings/PreferencesSettings.vue:63. |
| A Suite-owned, Frappe-semantic server-state engine, proved by a Files vertical slice | done | platform/server-state/index.test.ts:59-119; every Files journey | |
| One app-level UI provider owns toast, confirm and prompt mechanics | done | platform/feedback/index.test.ts; files/specs/mutations.spec.ts (rename prompt, share toast) | |
| One translation catalog load before normal UI mounts | partial | platform/translation/index.test.ts | apps/mail/routes.ts:462 and apps/calendar/routes.ts:93 still load product catalogs. |
| One lazy realtime socket per tab; products own their event names | partial | platform/realtime/index.test.ts | Mail, Calendar and Meet still open their own site sockets (apps/mail/socket.ts:1). |
| Theme reads and writes Frappe `desk_theme`, with scoped overrides that never persist | done | shell/specs/theme.spec.ts "the appearance choice persists to desk_theme and survives a reload" | |
| `@/platform/page-meta` is the only writer of title and favicon | partial | shell/specs/page-meta.spec.ts (three journeys) | Slides still writes `document.title` directly: pages/Slideshow.vue:332 and pages/PresentationEditor.vue:166. |
| Capability gating: unavailable areas leave the rail; a direct URL keeps its URL and shows the unavailable surface | done | shell/specs/capabilities.spec.ts (four journeys) | |
| The shell hosts `PageHeaderTarget`; the area page owns what it teleports | done | composition/ShellMounting.test.ts:12; files and Home journeys use the page headers | |

## Ticket 003: REST endpoint structure

| Bullet | State | Verified by | Note |
|---|---|---|---|
| Resource nouns and HTTP verbs under `/api/suite/<owner>/...`; no RPC names in paths | done | suite.drive.http.tests.test_translator (32 tests); suite/meet/http/routes.py:44; suite/mail/http/routes.py:16 | |
| The shared transport contract stays smaller than any product: envelopes, auth, statuses, opaque cursor | done | suite.composition.tests.test_http; suite/composition/http.py:23-44 | |
| One composition dispatcher selects the owner; products own typed tables | done | suite.composition.tests.test_http (dispatcher tests) | |
| Product-neutral account, site, user and invitation resources stay under `suite/api/` | done | suite.api.test_routes (9 tests); suite/api/routes.py:73-97 | No `/api/suite/shell/...` namespace exists. |
| The minimum non-Drive launch surface exists | done | suite.api.test_account, suite.mail.http.tests.test_routes, suite.calendar.http.tests.test_routes, suite.meet.http.tests.test_routes | |
| Home queries product resources concurrently, each with its own cache and failure state | done | home/specs/home.spec.ts "a failing Recent read leaves Upcoming intact" and "a failing Upcoming read leaves Recent intact" | |
| REST adoption is additive; legacy methods stay until a zero-caller inventory | done | suite/mail/http/routes.py:20 and suite/calendar/http/routes.py:74 wrap existing workflows | |
| The translator tests are an executable conformance kit for every adapter | done | suite/composition/tests/http_conformance.py:49-146, mixed into all five owners | |

## Gates on this branch

| Gate | Result |
|---|---|
| `yarn check:import-boundaries` | passed, 191 owned graph violations and 82 unstable frappe-ui imports baselined |
| `yarn test:unified` | 31 files, 101 tests, all passed |
| `yarn test:legacy` | matched the exact failure manifest, 0 expected failures |
| `yarn check:bundle-budget` | 107.93 KiB gzip across 23 chunks, budget 200.00 KiB |
| `yarn test:unified-shell` | 15 passed |
| `yarn test:unified-files` | 61 passed, 2 skipped |
| `yarn test:unified-home` | 10 passed |
| `suite.composition.tests.test_contract` | 2 passed |
| `suite.composition.tests.test_http` | 2 unit plus 2 integration, all passed |
| `suite.api.test_account` | 10 passed |
| `suite.api.test_routes` | 9 passed, 2 skipped |
| `suite.drive.http.tests.*` | 603 passed across dispatch, routes, shapes, shims and translator |
| `suite.mail.http.tests.test_routes` | 8 passed, 2 skipped |
| `suite.calendar.http.tests.test_routes` | 9 passed, 2 skipped |
| `suite.meet.http.tests.test_routes` | 9 passed, 2 skipped |

### echarts on /files

The dev server fetches 497 `node_modules/echarts/**` modules on `/files` and
on `/home`. The chain is `main.ts:33` dynamically importing
`frappe-ui/experimental` for the sprite plugin, whose barrel reaches
`frappe-ui/experimental/Charts/ECharts.vue`, which imports the echarts barrel.
Vite excludes `frappe-ui` from `optimizeDeps` in dev, so the browser fetches
every transitive module raw.

This is dev-only. In a production build no reachable chunk of the initial
graph contains echarts. The echarts chunk has two importers,
`node_modules/vue-echarts/dist/index.js` and
`src/apps/sheets/components/SheetEditor/ChartView.vue`, and the static closure
of the `frappe-ui/experimental` chunk does not contain it.

## Open items this accounting records

| Item | Owner |
|---|---|
| `NodeShape` carries no `favourite`, so no row paints its star and the row menu always reads Star | Drive program |
| Storage breakdown aggregates have no route and no client | Drive program |
| Share action and dialog | ticket 008 |
| Upload, Restore and Delete forever | ticket 007 |
| `/l/<token>` credential entry and the guest surface journey | ticket 011 |
| `/suite` and `/drive` redirects, deletion of the old pages | ticket 014 |
| New from template and the template filter | ticket 009 follow-up |
| Copy does not navigate to the new node | ticket 009 follow-up |
| Media handles unused by Writer, Sheets and Slides | ticket 009 follow-up |
| Sheets renders no comments or versions panel | ticket 009 follow-up |
| Collaboration verdict narrowing and pending-write cancellation | ticket 009 follow-up |
| Shell surfaces still read `@/boot/session` | ticket 002 follow-up |
| Mail and Calendar load product translation catalogs and open their own sockets | ticket 010 |
| Slides writes `document.title` directly | ticket 010 |
| Column switches in the Files view menu have no accessible name | ticket 006 follow-up |
| The Sheets surface keeps the legacy editor header with its own Share control and avatar stack | ticket 008 and the Sheets program |
