---
id: 018
title: Flip 1 rollback with deleted app chrome
label: wayfinder:grilling
status: open
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014 makes each flip one `frappe.conf` key, so turning the key off
rolls the flip back without a deploy. Tickets 010 and 016 delete Mail's and
Calendar's app switcher, Settings dialog, Theme and Log out at flip 1, and
ticket 010 says "one revert undoes it". With `suite_flip_shell` off after
that deletion, Mail and Calendar run outside the shell with no Settings and
no Log out.

Decide what "flag off" shows after flip 1 ships:

- The old chrome stays in code and renders only while the key is off, until
  the deletion commit.
- Rollback is a revert and a deploy for the chrome, and the key only moves
  the rail and `/`.
- Another shape.

The answer sets Stage 5's deletions and the Stage 7 rollback rehearsal in
the plan.

Raised by the plan audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

Also decide what the rail shows on `/home`, `/files` and `/d/` while
`suite_flip_files` is off. Those routes answer a direct URL for every
signed-in user before flip 2 (spec §14.1); ticket 014 fixes the rail only
for flip 2 on. Spec open item 24.

## Proposed resolution

Proposed on 2026-09-29 by a Fable subagent. Pending Faris's answers to the
irreversible decisions below.

In short: the key is the rollback, so the old chrome stays in code. Mail,
Calendar and Meet draw their Apps, Settings and Log out entries only while
their routes are outside the shell, and one commit deletes those entries
with the keys at deletion. The rail lists an area only when its flip is on.
One question is Faris's: whether the rail gets a temporary Apps entry for
the old Drive, Writer, Sheets and Slides pages between the flips.

Proposed term (not in `frontend/CONTEXT.md` yet): **standalone chrome**. The
Apps, Settings and Log out entries (and Meet's Theme submenu) that an app
draws in its own sidebar header while its routes are outside the shell.
Inside the shell the rail and the account menu replace them.

### Decided (reversible)

1. **Flag off shows the old chrome.** After the flip 1 code ships,
   `suite_flip_shell` off keeps Mail, Calendar and Meet routes on
   `frame: 'none'`, and each app renders its standalone chrome: Apps
   (`useAppSwitcher`), Settings, Log out, and for Meet its `MeetSidebar`
   with the Theme submenu. A key is a rollback only if the flag-off page
   works, and without Log out and Settings it does not [T014 decision 2,
   T010 "Rollout"]. The second shape in the question (revert plus deploy,
   key moves only the rail and `/`) is rejected: it reverses ticket 014's
   approved "turns off without a deploy".
2. **The condition is the frame, not the flag.** Each app renders its
   standalone chrome when `route.meta.frame === 'none'`. Chrome then shows
   exactly when there is no rail. Products already read typed route
   metadata; no boot flag enters product code [T002, T013].
   `MailLayout.vue` and `CalendarLayout.vue` do not change for this: the
   entries live in each app's `AppSidebar.vue` header menu
   (`apps/mail/components/AppSidebar.vue:280-340`,
   `apps/calendar/components/AppSidebar.vue:117-153`) and in
   `apps/meet/components/MeetSidebar.vue:50-100`.
3. **Standalone Settings opens the Suite settings dialog.** The entry calls
   `openSettings('<product>.<first tab>')`. `ShellLayout.vue` mounts
   `SuiteSettingsDialog` outside its frame branches, so the dialog opens
   over a `frame: 'none'` page today. Mail's and Calendar's `SettingsModal`
   and Mail's `PWASettings` copy are deleted in plan stage 5, before flip 1,
   because stage 4 moves their groups into `composition/settings.ts` and the
   dialog stops taking `groups` [T016 decisions 1, 4]. This amends ticket
   016 decision 6 ("deleted when the three apps flip"): the wrappers go
   earlier, the menu entries stay longer. The one product-to-shell import
   per app replaces today's baselined
   `SettingsModal|@/shell/settings/SuiteSettingsDialog.vue` entries
   (`frontend/scripts/check-import-boundaries.mjs:89,176,293`). Stage 15
   removes them. A window event like `suite:open-active-area-panel` was
   rejected for this: it is untyped, and ticket 016 wants tab ids to fail
   at compile time.
4. **Deletion time is the deletion commit (plan stage 15).** The standalone
   chrome, `useAppSwitcher` and `getAppSwitcherItems` go with `SUITE_APPS`,
   `lastApp` and both keys. Ticket 014 deletes the keys with the old pages,
   and a key with no off state is dead weight. `SUITE_APPS`, which the
   switcher reads, is deleted there anyway [T014 decision 8]. Keeping the
   old lines in place also keeps `upstream/develop` merges of the three
   sidebar files clean; a deletion would conflict on every upstream edit
   [plan "Starting state"].
5. **The `suite_flip_shell` read lands in stage 5, not stage 6.** Stage 5
   adds the boot value in `suite/www/suite.py` and one platform reader, and
   sets the three apps' frame from it. A production release that carries
   stage 5 without stage 6 then shows today's Mail. `suite_flip_files`, the
   rail filter, `/` and the Slides service worker stay in stage 6. This
   follows the `disable_slides_service_worker` precedent
   (`suite/www/suite.py:72-74`) [T014 decision 2]. Assumption on ticket
   019: a release can land between two stage merges.
6. **The theme shortcut is not restored for flag off.** Stage 3 removes
   Mail's and Calendar's Cmd+Shift+L listener as a shell fix, and
   `platform/theme` has no listener. Theme stays reachable in Settings >
   Account > Preferences in both states, and Meet keeps its Theme submenu in
   its standalone chrome. Cross-area shortcuts stay open (spec §16 item 15)
   [T010 "Fix before the switch", T016 decision 5].
7. **The rail lists the areas whose flip is on.** `filterAreas` adds the two
   flags to the capability filter; `allAreas` stays whole so `activeArea`,
   the unavailable surface and the sheet title keep working
   (`shell/ShellLayout.vue:118-134`). With `suite_flip_files` off, `/home`,
   `/files` and `/d/` render in the shell frame with that rail and no active
   rail item. The phone bottom nav reads the same list. A rail that changes
   per route was rejected: it is the mixed state ticket 010 refused, and
   the layout would jump [T010, T014 decision 1, T015 ruling 13].
8. **Before flip 1 the rail lists no area.** Bell, gear and avatar only.
   No production link reaches the shell before flip 1: Desk goes to
   `/suite` (launcher, `frame: 'none'`), `/suite/start` goes to the last
   app, and every server-built link goes to `/drive/...` [T014 decisions 5
   and 10, `router/index.ts:65-67`]. One rule for both flags beats a special
   case for a page only developers open.
9. **The Files settings group waits for flip 2.** Its `condition` reads the
   files flip. Before flip 2 the group would configure an area the rail does
   not show, and the old Drive `SettingsDialog` still serves it. A condition
   is one line and may read a platform flag [T016 decision 3].
10. **The platform registers the service worker in both states.** Push must
    work with the flag off, and `sw.ts` caches no shell [T010 "One Suite
    PWA", T014 decision 9].
11. **The key does not undo the manifest `id`.** `manifest.webmanifest` is a
    static file (`id: "/mail"` today). Stage 5 changes it at deploy, so a
    phone with the Mail PWA can show two apps from that deploy on, flag on
    or off. Ticket 010 accepted this risk; serving the manifest per flag
    would need a server route for a cosmetic effect [T010 "One Suite PWA"].
12. **The stage 7 rehearsal checks these, cold load each.** Flag off:
    `/mail`, `/calendar` and `/meet` show no rail and their own sidebar
    header with Apps, Settings and Log out; Settings opens the Suite dialog
    on that product's first tab; Log out signs out; `/home` and `/files`
    show the shell with an empty rail; `/suite/start` lands on `/mail`.
    Flag on: the three prefixes show the rail with Mail, Calendar and Meet;
    the sidebar headers have no Apps, Settings or Log out; the rail gear
    opens Settings; the avatar menu logs out. A tab open across the flip
    keeps its state until reload, because the client reads the flag from
    boot only [T014 decision 2].

### For Faris (irreversible)

1. **A temporary rail Apps entry between the flips.** After flip 1 the
   rail replaces the Apps menu in Mail's, Calendar's and Meet's sidebar
   header. The rail lists Mail, Calendar and Meet only until flip 2 [T014].
   Drive, Writer, Sheets and Slides stay old pages in that gap, and nothing
   in the shell leads to them. Example: a person reads mail and wants a
   spreadsheet. Today: Apps > Sheets. After flip 1 with nothing added: type
   `/sheets`, use a bookmark, or go through Desk. The gap runs from flip 1
   to flip 2, which is stages 8 to 12: weeks at least. Phone loses nothing:
   Mail's own Apps tab lists Mail and Calendar only, as today.
   Options:
   - **A. A rail Apps entry** (grid icon, below the areas) that lists
     Drive, Slides, Writer and Sheets, the rows the Apps menu shows today
     minus the areas and Desk (Desk is in the avatar menu from stage 4,
     T016). Hidden once `suite_flip_files` is on; deleted at stage 15.
     Pro: nothing lost, one click, removes itself. Con: a rail element the
     prototype does not have, seen on production for the whole gap, and it
     leads out of the shell to a page with different chrome.
   - **B. The same list as a submenu in the rail avatar menu.** Pro: the
     rail stays as the prototype. Con: two clicks, hidden, and an account
     menu is an odd place for navigation.
   - **C. Nothing.** Pro: no code. Con: Mail users lose the path to Drive
     for the whole gap.
   Recommendation: A. It is the smallest change that keeps today's path,
   and it disappears by itself at flip 2. I did not decide it because the
   rail's content is your product call from the prototype (MAP Notes), and
   production users see this element for weeks.
   **Question:** does the rail get a temporary Apps entry for Drive, Slides,
   Writer and Sheets between the flips (A), or the avatar submenu (B), or
   nothing (C)?

### Spec and plan changes

`unified-frontend-spec.md`:

- **§3.5 Rail and phone nav.** Add: "The rail lists an area only while its
  flip is on (section 14.1). The bottom nav reads the same list [T018]."
  If Faris picks A, add: "Between the flips the rail shows a temporary Apps
  entry that lists Drive, Slides, Writer and Sheets. It hides when
  `suite_flip_files` is on and is deleted with the old pages [T018]." For
  B, put the same sentence under §12.6 as an avatar menu row instead.
- **§9.1 What each app drops.** Change the lead sentence to: "Inside the
  shell, Mail, Calendar and Meet drop these from their sidebar header menu
  [T010]." Add after the list: "While their routes are outside the shell
  (`suite_flip_shell` off, section 14.2), each app keeps the same entries
  as standalone chrome, rendered on `route.meta.frame === 'none'`.
  Settings there opens the Suite settings dialog through `openSettings`.
  The entries go in the deletion commit (section 14.8) [T018]."
- **§9.8 Switch.** Replace "One revert undoes it [T010]. What the flag off
  shows ... (section 16)." with: "The key undoes it: with
  `suite_flip_shell` off, the three apps render outside the shell with
  their standalone chrome (section 9.1). A revert of the adoption also
  undoes it [T010, T018]." Replace "Mail's and Calendar's `SettingsModal`
  are deleted at this flip [T016]." with: "Mail's and Calendar's
  `SettingsModal` and Mail's `PWASettings` are deleted when the apps adopt
  the shell, before flip 1 [T016, T018]."
- **§12.2 Groups and tabs.** Files row, Condition column: prepend
  "`suite_flip_files` on;" [T018].
- **§12.7 After the switch.** Replace the first bullet with: "Mail's and
  Calendar's `SettingsModal` go when the apps adopt the shell (plan stage
  5), before flip 1. With the shell flip off, each app's Settings entry
  opens the Suite settings dialog [T016, T018]."
- **§14.1 Two flips.** Replace the last bullet's second sentence with: "The
  rail lists the areas whose flip is on. On those pages no rail item is
  active. Before flip 1 the rail lists no area [T018]." Add the answer to
  the Faris question as one bullet.
- **§14.2 Switch.** Add: "`suite_flip_shell` off after the code ships:
  Mail, Calendar and Meet routes keep `frame: 'none'` and render their
  standalone chrome (section 9.1). The platform registers the service
  worker in both states. The key does not undo the manifest `id` change
  (section 3.15); ticket 010 accepted that risk at deploy time [T018]."
- **§14.7 Gates, flip 1.** Expand the rehearsal bullet with the checklist
  in decision 12.
- **§14.8 Deletion.** Add to the one-commit list: "the standalone chrome of
  Mail, Calendar and Meet, `useAppSwitcher` and `getAppSwitcherItems`, and
  the temporary rail Apps entry if it exists [T018]."
- **§16.1 item 2 and §16.3 item 24.** Remove.

`unified-frontend-plan.md`:

- **Shared files.** `suite/www/suite.py`: order "5, 6". Add
  `frontend/src/apps/mail/components/AppSidebar.vue`,
  `frontend/src/apps/calendar/components/AppSidebar.vue` and
  `frontend/src/apps/meet/components/MeetSidebar.vue`: order "5, 15".
- **Stage 5.** Files: add `suite/www/suite.py` (the `suite_flip_shell`
  boot value) and a boot flag reader under `frontend/src/platform/`; add the
  three sidebar files above. Work: replace "Each app deletes the app
  switcher, Log out and the account row, the Theme submenu, Settings and its
  modal, and the logo row." with "Each app renders its Apps, Settings and
  Log out entries (Meet: its `MeetSidebar` with Theme) only on
  `route.meta.frame === 'none'`; Settings there calls
  `openSettings('<product>.<first tab>')`. Each app deletes the account
  row, the logo row, its `SettingsModal` and Mail's `PWASettings`. The
  three apps' route frame reads `suite_flip_shell` from boot." Depends on:
  remove "Ticket 018 ... must close before the chrome deletions". Exit gate:
  replace the `grep` line with "`grep -rn useAppSwitcher frontend/src/apps`
  returns only the three standalone branches. The boundary baseline swaps
  each `SettingsModal|SuiteSettingsDialog` entry for one
  `AppSidebar|useSettingsDialog` entry; no other product import of
  `shell/`." Add: "Journeys run with `suite_flip_shell` set on the dev
  site, and one journey per app checks the standalone chrome with it off."
- **Stage 6.** Work: change the first bullet to `suite_flip_files` only.
  Replace "Off: they keep the old frame." with "Off: they keep
  `frame: 'none'` and show their standalone chrome (stage 5)." Replace
  "The rail with the flags off is ticket 018's." with "The rail lists the
  areas whose flip is on; `/home`, `/files` and `/d/` render in the shell
  with that rail and no active item. The Files settings group's condition
  reads the files flip." Add the Faris answer (rail Apps entry or avatar
  submenu) as a work item. Depends on: remove ticket 018.
- **Stage 7.** Replace "Ticket 018 sets what flag off shows." with the
  decision 12 checklist.
- **Stage 15.** Add to Files: the standalone chrome in the three sidebar
  files, `useAppSwitcher`, `getAppSwitcherItems`, and the temporary rail
  Apps entry if Faris chose A or B.
- **Open items.** Remove "Flip 1 rollback".

### Asks

None.
