---
id: 006
title: Files area: listing, navigation and roots
label: wayfinder:grilling
status: closed
assignee: codex (agent, 2026-09-14)
blocked-by: [001, 005]
---

## Question

Specify the Files area on the real node model. The prototype's
`FilesArea.vue` fixes the layout: page header with breadcrumbs and New,
search field, view settings (list or grid, group by, columns), selection
mode with a bulk bar of equal height, context menu, empty state.

Settle on real data:

- How the Shared Root and the Personal Root appear now that the workspace
  switcher is gone: two panel entries, a root picker in the header, or one
  merged root view. Business sites have both roots; personal sites have
  Personal only.
- The saved views (`all`, `shared`, `starred`, `trash`, recents) against
  spec §5.3 to §5.7 queries, and the panel body that lists them.
- Folder listing with opaque cursors (§11.4, 60 rows default, short windows
  possible), sort and group on the server versus the client, and which
  `?expand=` sets each view requests.
- Node row shape to node kind mapping: folder, file, link, content document
  (Writer, Sheets, Slides) and their icons and open targets.
- Selection and bulk actions against the batch route (§11.5) with per-node
  ok/failed reporting.
- Rename with the sibling dedupe rule (§8.6), move as one path rewrite
  (§8.7), copy (§8.9), star and recents (§9.5).
- Where Drive's client module lives and what it exports to other areas
  (`@/apps/drive` interface, ARCHITECTURE.md rule 8.3).

Inputs: Drive spec §5, §8, §9.5, §11; ticket 32 acceptance criteria; the
legacy inventory from ticket 005; the frappe-ui skill for list patterns.

Handed from [Legacy Drive client inventory](005-legacy-drive-client-inventory.md)
(2026-09-11): no REST route returns the caller's root ids, so the Files area
cannot open without a root-discovery ask on the Drive program. Realtime:
REST handlers emit no socket events, so list refresh after a write is a
client decision. The 17 product methods (users, groups, settings, invites)
stay on `/api/method/`.

## Resolution

Resolved with the user on 2026-09-15. The base prototype remains the layout
authority; this resolution replaces its placeholder file data and removed
workspace switcher with the real Drive node model.

### Destinations and roots

- The contextual panel has a **Locations** section containing **My files**
  (`/files`, the caller's Personal Root) and, on business sites,
  **Organization files** (`/files/organization`, the site's active Shared
  Root). They are direct entries, not a header picker and not one merged
  listing. Personal sites omit Organization files.
- A **Views** section contains **Shared with me**, **Recent**, and **Starred**,
  followed by visually separated **Trash**. There is no **All** destination:
  that name would obscure which root owns the rows.
- The routes from ticket 001 are the sources: Shared with me calls
  `views/shared`, Recent calls `views/recents`, Starred calls
  `views/favourites`, and Trash calls `views/trash` with a root id. The first
  three views keep the order frozen by the Drive spec.
- Trash has a `My files | Organization files` tab switcher and shows one
  root at a time. `/files/trash` means My files;
  `/files/trash?root=organization` means Organization files. Personal sites
  omit the tabs. The query names the semantic root, never its opaque id.
- Add `GET /api/suite/drive/roots`, loaded and cached when the Files area
  mounts. Its data is
  `{personal: {node, title}, organization: {node, title} | null}`. It returns
  active roots only. `/files` and `/files/organization` translate the
  semantic route through this result; root discovery is Drive data and does
  not enter global session boot. Quota remains on the separate usage route.

### Folder listing and presentation

- A root is listed by calling the ordinary children route with its discovered
  node id. An ordinary folder route fetches the folder detail and its children.
  The default window is 60 and every cursor is opaque.
- Listings use infinite loading. Near the end of the rendered rows the client
  echoes `next_cursor` into the next request and appends the result. Only a
  null cursor ends a list. A permission-filtered window with zero visible rows
  and a non-null cursor is skipped automatically; initial loading continues
  until a visible row or the end is found. A failed next page keeps the
  existing rows and shows an inline retry.
- Sorting and grouping are server-owned. Changing either clears accumulated
  pages and starts again without a cursor. The client never sorts or groups
  only the loaded window. Folder and root listings support group by **Type**,
  **Owner**, and **Modified**; the server makes each group contiguous and the
  client derives the display heading from fields already on the row. With a
  group active, the group key is the primary order, folders come first inside
  each group, and the chosen sort is the secondary order. Without a group,
  folders form the first partition globally and non-folders the second; each
  partition follows the chosen sort. The initial presentation is list view,
  no grouping, title (shown as Name) ascending.
- The default list columns are **Name**, **Owner**, and **Modified**.
  **Type** and **Size** are optional. Location and sharing-summary columns do
  not launch because neither exists in the node shape; the client must not
  issue a request per row to imitate them.
- URL query values override the saved Files preference, which overrides the
  defaults. `view`, `sort`, `dir`, and `group` are presentation query keys;
  changes replace the current history entry and update the saved preference.
  Folder navigation carries supported settings forward. Saved views drop sort
  and group keys they cannot honor. Visible columns are a saved preference,
  not URL state.
- Exact expansion sets are:

  | Surface | Expansion |
  |---|---|
  | open folder detail/header | `access,breadcrumbs` |
  | folder/root list rows | `access` |
  | folder/root grid tiles | `access,preview` |
  | saved-view list rows | `access` |
  | saved-view grid tiles | `access,preview` |
  | search rows | `access,breadcrumbs` (plus `preview` in grid) |

  Breadcrumbs describe the open folder once; they are not duplicated onto
  each ordinary child. Search is the exception because identical titles need
  a visible `My files > Finance`-style path beneath every result.
- Grid preview URLs are refreshed in the background at 10 minutes, two thirds
  of their 15-minute TTL, while the grid is observed. A hidden tab pauses the
  timer and revalidates on focus. Existing images remain painted during the
  refresh. One failed image fetch refreshes its preview once, then falls back
  to the MIME icon.

### Rows, icons and opening

- A `folder` uses the folder icon and opens
  `/files/f/<node-id>/<decorative-slug>`. A `document` uses its registered
  Writer, Sheets, or Slides icon and opens `/d/<node-id>/<decorative-slug>`;
  the content registry selects the adapter. A `file` uses its MIME-family icon
  or preview and opens the same `/d/...` route. Unsupported file formats keep
  that stable route and show a **No preview** state with Download instead of
  downloading immediately. A `link` uses the external-link icon, confirms its
  target origin, and then opens a new browser tab. Root nodes never appear as
  ordinary rows.
- The row menu is Open, Open in new tab, Download, Rename, Move, Make a copy,
  Star/Unstar, Share, and Move to trash. Download is unavailable for links.
  Folder download is shown only when the folder-archive backend ask is
  available. The access expansion hides actions for which the row lacks the
  required role. Link Open retains the external-origin confirmation.
- Rename and Move preserve a `DriveConflict`: the rename control stays open
  or the move dialog retains its source and asks for another title/destination.
  The client never silently suffixes either operation. Copy and Restore accept
  the title returned by the server (`Report (2).pdf`, then `(3)`) and never
  predict a suffix locally.
- Move and Copy use one Drive-owned folder picker with My files and, when
  present, Organization files tabs. It pages folders lazily. Readable folders
  may be traversed; only a root/folder with UPLOAD may be selected. Cross-root
  moves and copies are allowed. The server remains authoritative for cycles,
  depth, title conflicts, quota, and permission changes.

### Selection and mutation outcomes

- Selection contains explicit node ids from the currently loaded rows.
  **Select all** means all loaded rows, never unseen matches. Loading another
  cursor window does not select the new rows. Folder, root, saved-view, search,
  sort, group, or Trash-tab changes clear selection.
- Desktop enters selection through a checkbox or Cmd/Ctrl-click; Shift-click
  selects a loaded visible range and Escape clears. Mobile enters through a
  long press or **Select** in the row menu, then ordinary taps toggle rows;
  Back exits selection mode. In selection mode checkboxes appear and the
  equal-height bulk bar replaces the normal toolbar without moving the list.
- The active-node bulk bar contains only **Move** and **Move to trash**, the
  two actions represented honestly by one `POST /nodes/batch` patch. One
  gesture is one request. An action is enabled only when every selected row's
  current access permits it; the server still rechecks every node. Successful
  ids leave selection and affected lists; failed ids remain selected. The
  result says, for example,
  `14 moved · 4 failed` and exposes per-node messages behind **Details**.
  Rename, copy, star, share, download, and open remain single-row actions.
  Trash replaces the bar with Restore and Delete forever; ticket 007 owns
  their destination and confirmation flows.
- Own mutations update the normalized node store from their REST result and
  revalidate affected queries in the background. After commit, Drive also
  emits one coarse, payload-free `drive:changed` event. The platform's single
  realtime connection lets observed Files queries debounce the event and
  refetch their visible listing. The event carries no node or root ids and
  therefore discloses no inaccessible Drive data.

### Search, visits, starring and creation

- The inline field is **Search files** and calls the tree-wide
  `views/search`; it covers the caller's readable Personal, active Shared,
  shared, and archived-root content, never Mail or Calendar. The term is the
  `q` URL query. Clearing it restores the listing at the current route.
  Search results are newest-modified first as specified by Drive and use the
  search expansion set above.
- Call `POST /nodes/<id>/visit` only after a signed-in user successfully opens
  a folder, document, or file route, or confirms and follows a link. Route
  success owns the call so direct navigation and browser history count too.
  Tile preview, selection, roots, and a cancelled external-link prompt do not
  create a Recent. Star/Unstar is per signed-in user and updates every cached
  appearance of the node through the normalized store.
- **New** contains Folder, Upload files, Writer document, Spreadsheet,
  Presentation, and Link. It appears only in a concrete root/folder on which
  the caller has UPLOAD. Saved views and search have no implicit destination,
  so they hide it. All three document entries call the generic Drive document
  creation workflow; ticket 007 owns upload progress.

### Mobile and state behavior

- From another area, the Files bottom-nav item opens `/files`. While Files is
  active, tapping it opens the Files contextual panel as a bottom sheet. A
  second, explicit header destination button (`My files ▾`, `Starred ▾`, and
  so on) opens the same sheet; folder breadcrumbs sit beneath it. The sheet
  closes after a destination is chosen.
- Initial queries show a layout-matched skeleton, then rows, an access-aware
  empty state, or an inline error with Retry. An empty state's copy names the
  destination. It offers New only where UPLOAD is available. Query failures
  never toast. A refresh failure keeps stale rows visible with a compact
  warning; mutations use the platform feedback path and mixed batch results
  use the result surface above.
- List rows and grid tiles use native table/list semantics, a single roving
  tab stop where needed, Enter to open, Space to select, an accessible menu
  trigger, and restored focus after a menu or dialog closes. Cross-area
  shortcuts remain ticket 012/later work.

### Frontend module and interface

- Drive owns all Files UI and client behavior under
  `frontend/src/apps/drive/`. Resource descriptor modules live under
  `apps/drive/client/`; application code combines them with
  `@/platform/server-state`. URLs, cache keys, generated transport names,
  cursor parsing, and response normalization remain inside those modules.
- `frontend/src/apps/drive/index.ts` is the only cross-product seam. Ticket
  006 exports `filesArea`, `driveRecents()`, `createDriveDocument()`,
  `driveNodeRoute()`, and the `DriveNodeSummary` type. The first is the area
  definition; the next two return typed server-state descriptors; the route
  helper returns a canonical route without navigating as a side effect.
- Ticket 009's `DocumentSession` and its factory also cross this seam as one
  complete Drive-owned workflow for product document surfaces. Products
  receive that session instead of importing Drive controls or state.
- Raw generated transport, resources, root cache, list state, dialogs,
  `prettyData`, `allUsers`, and product internals are not exported. The
  existing Writer and Slides subpath imports are migration debt, not the new
  interface. Individual Drive dialogs do not cross the seam.

### Drive backend asks and gates

Ticket 006 adds or confirms these inputs to the Drive program. The unified
Files implementation is gated on the first five; the last two gate their
individual menu/realtime capabilities.

1. Root discovery at `GET /api/suite/drive/roots` with the shape above.
2. Server ordering/grouping on children: folders first and
   `group_by=type|owner|modified`, with the selected `order_by` as the stable
   secondary order. When grouping is active, folders come first inside each
   group rather than fragmenting the groups. Every order has the node id as
   its final tie-breaker.
3. A SQL-window `kind=folder` filter on children for the Move/Copy/Restore
   picker; filtering after a cursor window is not sufficient.
4. Page-batched `expand=access` on every node-valued Drive view. It must not
   degrade into one node request/query per row.
5. Batched `expand=breadcrumbs` on `views/search`; ancestor titles are fetched
   for the page as a union, not once per result.
6. The folder archive build/status/download route family identified by ticket
   005. Until it exists, folder Download is absent rather than wired to a
   legacy method.
7. A payload-free, after-commit `drive:changed` signal suitable for the
   platform realtime connection. Until it exists, focus, reconnect, own-write
   normalization, and manual refresh remain correct but simultaneous remote
   edits are not live.

Changing the Drive route table also updates its generated contract and shared
adapter conformance tests. Listing tests must cover short and empty filtered
windows, cursor reset on presentation changes, stable folders-first grouping,
preview refresh, search breadcrumbs, permission changes, and mixed batch
outcomes. Browser coverage must include both root kinds, personal sites,
desktop keyboard selection, and both mobile bottom-sheet affordances.
