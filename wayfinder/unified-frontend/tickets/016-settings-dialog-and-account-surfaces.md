---
id: 016
title: Settings dialog groups and account surfaces
label: wayfinder:grilling
status: closed
assignee: netchampfaris
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

## Resolution

Resolved on 2026-09-29. Faris answered decisions 1 to 4. Claude subagents
answered 5 and 6 on his request, and he approved the whole resolution.

1. **Contribution.** Products hand their settings to composition through one
   list, `composition/settings.ts`. Each entry lazily imports a product's
   small settings module. `AreaDefinition` stays frozen (ticket 012), and a
   product without an area can still contribute. Runtime registration is
   rejected: the dialog would change with the areas you had visited.
2. **Tabs and order.** There is one sidebar heading per product, named after
   the product. The order is Account (Profile, Preferences), Files
   (Statistics, External access when WebDAV is on, Storage for admins), Mail
   and Calendar (mail users only), Meet (Devices, Audio, Video,
   Notifications, Layout), then Workspace (General and Users, system
   managers) last. The product sub-headings from today ("Mail Setup",
   "Data", "Developer") are removed, so no two headings clash. Meet's
   Controls tab needs a live meeting and stays in the in-call dialog only.
3. **Loading.** A product's settings module holds labels, icons, cheap
   `condition` checks and lazy tab bodies (`() => import(...)`). The modules
   load when the dialog opens. A body loads when its tab is first clicked,
   behind a fixed-height loading state. A condition must not pull in a
   product store.
4. **Phone.** The shell owns a drill-in settings surface: a full-screen list
   of headings and rows, and a tab opens full screen with a back arrow. Mail's
   `PWASettings` becomes this shell component, and Mail deletes its copy. The
   back gesture goes up one level: tab, then list, then closed. The desktop
   dialog and the phone list read the same settings groups.
5. **Account surfaces.**
   - Desktop rail avatar menu: name and email header, Settings, Open Desk
     (system users only), Upgrade plan (as today), Log out.
   - Phone avatar sheet: header, Settings, Theme, Log out. There is no Desk
     on phone, as today.
   - Theme lives in Preferences. It is also on the phone sheet to save a
     drill-in, but not on the desktop menu.
   - The Desk item moves from `apps/registry.ts` into `shell/accountMenu.ts`
     with its `systemUser` condition. The registry's Desk item is deleted.
   - Profile editing stays in Settings.
   - Mail's Admin dashboard becomes an admin-only row in Mail's own sidebar.
     It is not a Settings row, because every Settings row opens a tab body.
   - Shortcuts stays in each app. Mail's mailbox switcher stays in Mail's
     sidebar (ticket 010).
6. **After the switch.**
   - Mail's and Calendar's `SettingsModal` are deleted when the three apps
     flip together (ticket 010). They do not wait for ticket 014.
   - The legacy Drive `SettingsDialog`, its `showSettings` emitter and its
     numeric tab indexes are deleted with the legacy pages (ticket 014).
   - Meet keeps its in-call dialog. It reuses the Meet tab bodies and adds
     Controls. Shared tab bodies are pure components that do not depend on
     the shell dialog state.
   - `mail-profile` and `calendar-profile` stay as the Profile tab of each
     app's phone bar. Their inline settings list becomes the shell drill-in
     component. Log out stays on those pages, because the shell avatar sheet
     is hidden in those areas. A merged shell `/profile` route was rejected
     because it would take the user out of the area.
   - Tab ids are namespaced and typed, for example `'mail.screener'` or
     `'files.storage'`. `openSettings(tab)` takes the union built from the
     composition list, so a typo fails at compile time. On phone it opens
     that tab's drill-in page. This replaces Mail's label lookups
     (`MailThread.vue`, `ScreenerView.vue`) and Drive's numeric indexes.

Not decided: whether Upgrade plan hides for non-admins. It is outside this
ticket.
