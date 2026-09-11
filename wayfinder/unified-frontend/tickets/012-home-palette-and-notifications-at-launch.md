---
id: 012
title: Home, palette and notifications at launch
label: wayfinder:grilling
status: open
assignee:
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
