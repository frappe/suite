---
id: 016
title: Settings dialog groups and account surfaces
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

Ticket 010 takes Settings away from Mail, Calendar and Meet: the rail gear
opens one `SuiteSettingsDialog`. Each app passes its own `groups` today from
its own `SettingsModal`, and the Drive legacy pages have a fourth dialog.
Define the one dialog.

- How a product contributes its settings groups. Composition owns the rail,
  and the shell must not import product code (ticket 002). Is it a lazy
  entry on the area, a composition-side registry, or a platform
  registration call?
- Which tabs exist at launch, and their order: profile, preferences,
  workspace general, users, plus the per-app bodies for Mail, Calendar, Meet
  and Drive.
- Whether a product's group loads its chunk only when its tab opens.
- The phone shape. Mail teleports a full-screen `PWASettings` page today and
  has a `mail-profile` route. Ticket 010 gives the shell's phone nav an
  account entry that opens a sheet with account, Settings, theme and Log out.
- The Desk switcher for system users, and where the account surfaces sit:
  the rail account menu, the dialog, or both.
- What happens to the per-app settings routes and dialogs after the switch:
  deleted with the old pages (ticket 014), or kept for their own pages.

Inputs: `frontend/src/shell/settings/`, the four product `SettingsModal` /
`SettingsDialog` files, ticket 010 "What each app drops", ticket 002.
