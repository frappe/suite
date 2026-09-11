---
id: 010
title: Mail, Meet and Calendar adoption contract
label: wayfinder:grilling
status: open
assignee:
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
