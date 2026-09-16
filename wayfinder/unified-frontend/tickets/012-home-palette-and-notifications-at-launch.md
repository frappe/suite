---
id: 012
title: Home, palette and notifications at launch
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [002, 003]
---

## Question

The prototype's Home shows Recent and Upcoming, the palette shows Upcoming,
Jump to, Create and Recent, and the rail carries a Mail unread badge and a
Notifications item. No suite-level endpoint joins these today.

Decide, given ticket 003's REST structure:

- Home Recent: Drive Recent only (content nodes and files), or a joined feed.
  Which endpoint, which expansions, how many rows.
- Home Upcoming: Calendar events and Meet rooms, join and schedule actions.
  Which endpoints move to REST now.
- The palette at launch: jump and create only, or per-area search delegated
  to the active area, or a suite search endpoint. Global search across
  products stays in Not yet specified unless decided here.
- Notifications: Drive Notification as an activity pointer (§3.11, §9.5),
  Mail unread; one rail badge or one feed; mark-read semantics.
- The New menu: which create actions exist on Home, and that each goes
  through the Drive document workflow.

Inputs: ticket 003's resolution, Drive spec §3.9 to §3.11, §9.5, the
prototype's `HomeArea.vue` and `CommandPalette.vue`,
`frontend/src/apps/calendar`, `frontend/src/apps/meet/pages/Home.vue`.

Handed from [Legacy Drive client inventory](005-legacy-drive-client-inventory.md)
(2026-09-11): `GET /notifications?unread=1` returns a page, not a count, so
a rail badge needs either a count ask on the Drive program or a client
count over the first page.
## Resolution

Resolved with the user on 2026-09-15. The base prototype stays the layout
authority for Home. This resolution replaces its mock data, removes its
command palette, and rebuilds its Rooms control from endpoints that exist.

### Home Recent

- Source is Drive Recent only, through the Files Recent saved view route:
  `GET /api/suite/drive/views/recents`. No joined feed and no Suite
  aggregate. A visited mail thread is not the same act as opening a
  document, so merging them shortens the list without improving it.
- The window is 12 rows, one page, no cursor. Home never pages Recent.
  Ticket 003's rule holds: a bounded window does not pretend to have a
  cursor.
- No expansion. The card shows a kind icon, not a thumbnail, so
  `expand=preview` is not requested.
- The card renders kind icon, title, and an "opened" relative time.
- **View all** targets the Files Recent saved view, not the Files area root.
- Backend ask: `views/recents` rows must carry `opened_at`. It is already
  the view's sort key, and the legacy shim still returns it as `accessed`.
  Without it the card would have to print `modified`, which is a different
  fact and reorders under another person's edit.

### Home Upcoming

- Source is Calendar events only: `GET /api/suite/calendar/events`. Meet
  gets no list route. Every scheduled meeting already writes a calendar
  event, so a second source would duplicate rows, not add them.
- The window is now to end of tomorrow, which reproduces the prototype's
  **Today** and **Tomorrow** groups. A range fits the endpoint, which must
  expand recurrences across a span.
- A row shows time, title, and a **Join** button when the event has a
  meeting.
- Backend asks on the Calendar program:
  - The event shape returns a typed `conferencing: {meeting_id, url} | null`.
    Today the client scans `links[].href` and the description for a
    same-origin `/meet/<id>` URL. Ticket 003 said accidental conventions do
    not enter the new namespace, and a regex over free text is one.
  - `account` is optional. Omitted means every account the caller owns.
    Home has no account picker, so a required account would silently hide
    events.

### The New menu

- Home's **New** menu carries three items: Document, Spreadsheet,
  Presentation. Upload needs a folder and belongs to Files. Meeting is not
  a document and belongs to the Upcoming section's Meet and Schedule
  controls.
- All three go through generic Drive creation: `POST /api/suite/drive/nodes`
  with the content kind, Drive calls the product's `create_empty`, and the
  client opens `/d/<node-id>/<slug>`. Ticket 005 found today's Drive UI
  calls Writer, Sheets and Slides endpoints directly. That stops here.
- A Home create lands at the top level of the caller's Personal Root and
  opens immediately. No destination dialog and no remembered folder.
  Filing is a move, and Files already does moves.

### Meet entry point on Home

- The prototype's **Rooms** dropdown listed named persistent rooms with
  handles and a cadence. No such concept exists in Meet: `meeting.create()` returns an opaque
  code, and there is no room list route. The dropdown is
  replaced by a **Meet** dropdown built only from reserved endpoints:
  - Start instant meeting: `POST /api/suite/meet/rooms`
  - Start restricted meeting: `POST /api/suite/meet/rooms` with the
    restricted type
  - Join with code: a dialog and a client route, no new endpoint
- The **Schedule** dropdown keeps Event and Meeting. Meeting calls
  `POST /api/suite/meet/scheduled-meetings`.
- Named rooms are not rejected. They move to the map's Not yet specified as
  a Meet-program idea this prototype surfaced.

### Command palette

Out of scope for this effort. The unified frontend ships with no Cmd+K
palette and no rail Search button. Global search across products returns as
a separate effort together with the palette that fronts it.

### Notifications

- The rail bell shows Drive notifications only, through the existing
  `GET /api/suite/drive/notifications`. A cross-product feed is a real
  cross-product invariant and would justify a Suite aggregate under ticket
  003, but Mail has no per-message notification rows to join. It is the
  planned upgrade, not the launch shape.
- The bell opens a popover over the rail. The paged feed scrolls inside it.
  Reading a notification must not cost the caller their place.
- Mark-read: clicking a row marks that row and navigates to its node; a
  **Mark all read** action clears the rest. Opening the popover marks
  nothing. Seeing what happened must not destroy the record of what was
  unseen.
  `POST /notifications/read` already answers both calls.
- Backend ask on the Drive program: a notification unread-count route.
  `activity_core.unread_count()` exists in Python and has no route.
  Counting rows client-side would fetch a page to render one digit and
  would be wrong above any cap.
- The Mail rail badge comes from `GET /api/suite/mail/inbox-summary`,
  reserved by ticket 003.
- Badge seam: `AreaDefinition` stays frozen as ticket 002 set it.
  `composition/appRegistry.ts` owns a badge source per area and imports
  `useInboxSummary()` from `apps/mail/index.ts`. The product never learns a
  rail exists. No `loadBadge()` on the area interface and no platform
  badge bus.
- The bell is shell chrome, not an area, so it reads the unread-count route
  directly and has no registry entry.

### Empty and failure states

- Every section always renders its heading. Sections never hide.
- Empty Recent reads "Nothing yet" and points at **New**.
- Empty Upcoming reads "Nothing scheduled" and keeps its Meet and Schedule
  controls. They matter most when the day is empty.
- A failed section keeps its heading and shows an inline retry. The other
  section still renders. One dead endpoint never blanks Home.
- Home has no greeting line. The `PageHeader` title is "Home".

### Backend asks recorded

| Program | Ask |
|---|---|
| Drive | `opened_at` on `views/recents` rows |
| Drive | notification unread-count route |
| Calendar | typed `conferencing` field on the event shape |
| Calendar | optional `account`, omitted means all the caller's accounts |
