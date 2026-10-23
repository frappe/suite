---
id: 010
title: Mail, Meet and Calendar adoption contract
label: wayfinder:grilling
status: closed
assignee: faris (opus, 2026-09-19)
blocked-by: [002]
---

## Question

Mail, Meet and Calendar mount in the new shell as they are. Define what
"as they are" costs each of them and what the shell gives back.

- What each app drops: its own top bar, app switcher, account menu, and
  sidebar chrome (`MailLayout`, `DefaultLayout`, `AppSidebar`,
  `MeetLayout`, `MeetSidebar`, `CalendarLayout`). What becomes a contextual
  panel body (the prototype shows Mailboxes and Folders for Mail, MiniMonth
  and calendars for Calendar).
- Meet in the shell: rooms, upcoming and join live on Home and the panel;
  the call is a full-screen page outside the shell. Where the recorder page
  and its separate Vite config sit.
- Mail specifics: the JMAP gate (`jmapUser`), the PWA scoping now done in
  the router, the service worker, the login and search mobile layouts.
- Calendar specifics: Mail and Meet import Calendar internals in 16 places
  (import-boundary debt). Which of those the adoption clears, and which stay
  allowlisted.
- Their existing endpoints stay in use inside their pages. Which calls the
  shell makes on their behalf (badge, upcoming) come from ticket 003.
- The minimum each app must do before the switch, and what stays for its own
  later migration.

Inputs: `frontend/src/apps/{mail,meet,calendar}`,
`frontend/scripts/check-import-boundaries.mjs`, the prototype's `MailArea`,
`CalendarArea` and `ContextualPanelBody`.

## Resolution

Resolved with the user on 2026-09-21. Mail, Meet and Calendar keep their own
sidebars and their own phone bars. The shell adds the rail and takes the
Suite-level menu items. Meet becomes an area with a rail icon. This
resolution amends tickets 001, 002 and 012; the amendments are listed at the
end.

### The shell gives a rail and a full box

Every in-shell route gets the rail and one full-height box. The shell owns no
contextual panel. A page draws its own sidebar inside the box when it wants
one.

- `AreaDefinition` loses `loadPanel`. An area is `id`, `label`, `icon`, `to`,
  `loadRoutes` and `requires`.
- `ShellLayout` loses `ContextualPanel` and the panel branch of its frame
  logic. Route `frame` says in the shell or outside it. Outside is the Meet
  call and Mail's sign-in pages.
- The platform exports `<AreaSidebar>`: fixed width, scroll area, aria label,
  a fixed-size skeleton while the page chunk loads, and the phone sheet
  behaviour. Pages render it. Without it the widths drift per product.
- Home and Files render their existing panels (`HomePanel.vue` 31 lines,
  `FilesPanel.vue` 25 lines) inside `<AreaSidebar>`. The Mail and Calendar
  placeholder panels are deleted.
- Reason: a per-route sidebar needs no new contract for a page with two
  sidebars, or with a sidebar on one child route only. The panel slot was
  small enough to move now and gets more expensive after Mail lands.
- Cost accepted: the sidebar arrives with the page chunk, so an area switch
  shows the skeleton for a moment. The rail never moves.

### What each app drops

Mail, Calendar and Meet each delete from their sidebar header menu:

- the app switcher (`useAppSwitcher`): the rail does this;
- Log out and the Suite account row: the rail account menu does this;
- the Theme submenu and the Cmd+Shift+L listener: the platform owns theme
  (ticket 002);
- Settings and their `SettingsModal`: the rail gear opens
  `SuiteSettingsDialog`. This clears the product-to-shell import that ticket
  013 forbids, in Mail, Calendar and Meet.
- the Suite logo and branding row. The header row stays and shows the active
  mail account.

Each app keeps: its own sidebar body, its Shortcuts entry and dialog, and its
mail-account switcher. The shell never learns what a mail account is
(ticket 002). Meet keeps its device settings inside the call.

### Phone

- Mail keeps `MobileTabBar` and Calendar keeps `CalendarTabBar`. The shell
  hides its own bottom nav in those areas. Two bars cannot both show, and the
  Mail bar is the most finished part of that app: the first tab follows the
  current folder, the Screener dot, the keyboard handling.
- Area switching in Mail stays on Mail's Apps tab.
- The shell's bottom nav gains an account entry: an avatar that opens a sheet
  with the account, Settings, theme and Log out. It replaces the account menu
  that used to sit under the shell's panel sheet. In Mail and Calendar that
  entry is hidden with the rest of the shell nav; Mail's Profile tab and
  Calendar's profile page cover it there.

### Meet

Meet becomes an area with a rail icon, placed last, after Calendar. It has no
capability gate: Meet does not need a mail account.

- `/meet` keeps today's page: New meeting, Join with code, the Schedule
  dialog and Upcoming meetings. It loses the sidebar and the header menu. No
  new endpoints.
- Home keeps its Meet controls (ticket 012). Home is the launcher; the Meet
  area is the fuller view.
- `/meet/:meetingId` stays outside the shell: fixed, dark, guests allowed.
  `/meet/audio-test` sits inside the shell.
- The recorder keeps its own entry point and build
  (`recorder.html`, `vite.recorder.config.ts`, `dist-recorder`), served by
  the recorder container. The shell does not touch it.
- Meet code loads only when a Meet route opens (ticket 013).
- Recordings and past meetings are not in this page. They have no route and
  no list endpoint. They are written into the map's fog as what the Meet area
  earns next.

### One Suite PWA

- The manifest is available on every route. `setPwaTags` stops keying on the
  area. `start_url` becomes `/home`.
- The platform registers the service worker after sign-in. `MailLayout` stops
  registering it. Mail keeps the push handlers inside `sw.ts`, so push works
  while the user sits in Files or Calendar.
- Accepted risk: the manifest `id` changes from `/mail`, so a phone with the
  Mail PWA installed can show a second installed app. The alternative was an
  installed app called Mail that opens a suite with a rail.
- This closes the map's open PWA question. Sentry ownership stays open.

### Fix before the switch

These break inside the shell, so the adoption includes them:

- `body.mail-app` sets `overflow:hidden` and `height:100%` on the document
  and overrides dialog, menu and popover z-index. Scope it to Mail's box.
- Mail and Meet each mount a second `FrappeUIProvider`. Remove them; the
  shell provides one.
- `initSocket()` runs per `MailLayout` mount and never disposes. Dispose on
  unmount.
- Mail's `window` key listeners (`?`, `g`+letter) must fire only while a Mail
  route is active. The theme cycle listener goes.

### Stays as debt

Named, baselined and owned by each app's own later migration: `h-dvh`,
`h-screen` and `calc(100dvh-…)` heights; the 17 Mail and Meet imports of
Calendar internals plus the one Calendar import of Meet; per-app stores and
legacy API calls; Calendar reading mail accounts and branding through
`suite.mail.api.*`; per-app translation catalogs through
`suite.mail.api.get_translations`; per-app page titles. The adoption clears
none of the 17 imports: Mail keeps its event card and its today widget, and
Meet keeps its schedule dialog.

Mail's route-level `noLayout` and `isLogin` flags stay. Ticket 001 governs
shell metadata, not an app's own layout switches.

Calendar keeps its account-scoped URLs
(`/calendar/account/:accountId/month/...`) and its shortcut routes. Mail's
sign-in, signup, forgot-password, reset-password and `mime-message` pages
stay outside the shell, unchanged. One Suite sign-in is not part of this
effort.

### Rollout

All three flip in one change, after all three are ready. No mixed state where
the rail shows in some areas and not others, and one revert undoes it.
Ticket 014 still owns redirects, deep links, the Desk switcher and old-page
deletion. For these three apps, "switched" means the routes leave
`frame: none`, the chrome above is deleted and the fix list is done.

### Amendments to closed tickets

- Ticket 002: the shell no longer owns a contextual panel or its body. The
  `AreaDefinition.loadPanel` field goes, `<AreaSidebar>` replaces the slot,
  and the frame set collapses. Everything else in 002 stands.
- Ticket 001: the rail is Home, Files, Mail, Calendar, Meet. `/meet` is an
  area route; the call at `/meet/:meetingId` stays outside the shell.
- Ticket 012: Meet has an area, so the Home Meet control is one of two entry
  points, not the only one. `AreaDefinition` is no longer frozen; it loses
  `loadPanel`.
