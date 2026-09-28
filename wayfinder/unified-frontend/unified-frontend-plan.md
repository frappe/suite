# Unified frontend implementation plan

| | |
|---|---|
| Status | Draft, not audited. Agents wrote it for ticket 015. |
| Date | 2026-09-29 |
| Spec | [`unified-frontend-spec.md`](unified-frontend-spec.md) |
| Source map | [`MAP.md`](MAP.md) and the closed tickets in [`tickets/`](tickets/) |
| Architecture | [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| Drive program | [`../drive-layer-spec/drive-layer-plan.md`](../drive-layer-spec/drive-layer-plan.md), [`implementation/README.md`](../drive-layer-spec/implementation/README.md) |
| Base prototype | [suite-shell-prototype](https://sketch.netchamp.dev/u/netchampfaris/suite-shell-prototype) |

This plan executes the spec. The spec owns behavior. Each ticket's
`## Resolution` wins over the spec where they disagree. The Drive spec wins
for Drive behavior. `ARCHITECTURE.md` rule 8 wins for module boundaries.

The plan starts from the code at HEAD `f0f6a5c13` on
`forge/wayfinder-unified-frontend`. It does not start from zero.

## Starting state

Verified on 2026-09-29 against HEAD. The 2026-09-15 documents
(`IMPLEMENTATION.md`, `HANDOFF-home-files-implementation.md`,
`ACCOUNTING.md`) describe the earlier wave. They predate tickets 007, 008,
010, 011, 014 and 016. Where they differ from the code, this section wins.

### Branches

- `forge/drive-layer` is an ancestor of HEAD. HEAD is 38 commits ahead and
  0 behind.
- HEAD is 341 commits behind `upstream/develop` (merge base `bf6eb9c82`,
  2026-09-16). `upstream/develop` changes 202 files under
  `frontend/src/apps/{mail,calendar,meet}` and `frontend/src/router`.
- The earlier wave's backend asks landed on this map branch, not on
  `forge/drive-layer`: `20befde95` (Drive asks for tickets 006 and 012) and
  `47311aa11` (ticket 003 dispatcher and routes).
- The last code commit is `fb5213940` (2026-09-17, reconcile with develop).
  Later commits change only `wayfinder/`.

### Built and kept

| Area | State at HEAD | Paths |
|---|---|---|
| Platform | Eight modules plus `contracts` | `frontend/src/platform/{session,transport,server-state,realtime,translation,theme,page-meta,feedback,contracts}` |
| Composition | Area registry, routes, `DocumentHost`, document registry | `frontend/src/composition/{appRegistry.ts,routes.ts,DocumentHost.vue,documentRegistry.ts}` |
| Home | Recent, Upcoming, New, Meet control | `frontend/src/composition/home/` |
| Bell | Drive notifications with unread count | `frontend/src/composition/notifications/` |
| Files | Roots, saved views, cursors, server sort and group, search, selection, Move and Move to trash, `BatchOutcome`, folder picker, file preview | `frontend/src/apps/drive/files/`, `frontend/src/apps/drive/client/` |
| Documents | `DocumentSession` with access refresh, `media()`, credential grouper; Writer, Sheets, Slides surfaces | `frontend/src/apps/drive/client/session.ts`, `frontend/src/apps/{writer,sheets,slides}/surface/` |
| Legacy Drive | Relocated whole | `frontend/src/apps/drive/legacy/` |
| Backend | Owner dispatcher, conformance kit, Suite and product routes | `suite/composition/{http.py,registrations.py,contract.py}`, `suite/composition/tests/http_conformance.py`, `suite/api/routes.py` |
| Gates | Boundary checker, bundle budget, unified and legacy Vitest projects, three Playwright projects, CODEOWNERS | `frontend/scripts/`, `frontend/vitest.config.ts`, `e2e/unified-frontend/{shell,files,home}`, `.github/CODEOWNERS` |

### Rework that later tickets force

- **Ticket 010, shell.** `AreaDefinition` still has `loadPanel`
  (`platform/contracts/index.ts:35`). `shell/ContextualPanel.vue` still
  calls it. `ShellLayout.vue` still has the panel branch. `<AreaSidebar>`
  does not exist. Mail and Calendar placeholder panels sit in
  `apps/mail/index.ts:22-31` and `apps/calendar/index.ts:25-34`.
- **Ticket 010, areas.** No Meet area. Mail and Calendar routes are
  `frame: 'none'` (`composition/routes.ts`). Mail, Calendar and Meet keep
  their own layouts: `MailLayout.vue`, `CalendarLayout.vue`,
  `MeetLayout.vue`.
- **Ticket 010, four fixes.** All four are open:
  - `body.mail-app` CSS at `apps/mail/pages/MailLayout.vue:134-135`.
  - A second `FrappeUIProvider` in `MailLayout.vue` and `MeetLayout.vue`.
  - `provide('$socket', initSocket())` per mount, never disposed, at
    `MailLayout.vue:122` and `MeetLayout.vue:10`.
  - Mail `window` listeners for `?`, `g`+letter and Cmd/Ctrl+Shift+L at
    `MailLayout.vue:88-149` and `211-218`; one more at `MailThread.vue:1268`.
- **Beyond ticket 010's list.** `CalendarLayout.vue` also sets
  `body.calendar-app` (lines 34, 38, 73, 82) and mounts a third
  `FrappeUIProvider`. Meet also creates a socket per mount. See Open items.
- **Ticket 008.** `platform/transport/index.ts` still has the `LinkStore`
  hook that ticket 008 removes. The default transport (line 160) has no
  link store, so it sends no `X-Drive-Links`. `SlidesSurface.vue:207` sets
  the header by hand.
- **Ticket 011.** `/l/:token` renders `UnavailableSurface`
  (`composition/routes.ts`). `shell/GuestSurface.vue` is a static card.
  Guest is a `showGuestSurface` branch, not a frame. Nothing reads
  `#link=`. The setup gate (`router/index.ts:193-205`) lets guests through
  on `allowGuest` routes, but still sends a signed-in user to setup.
- **Ticket 007.** `upload()` has no start offset
  (`platform/server-state/index.ts:219-229`, offset fixed at 0 on line 440).
  Upload, Restore and Delete forever are disabled buttons in Files. No
  queue, tracker, IndexedDB record or rail ring. `driveUploadProgress` is
  absent.
- **Ticket 016.** `composition/settings.ts` is absent.
  `shell/accountMenu.ts` has Settings, a disabled Upgrade plan and Log out,
  but no Open Desk. `DESK_APP_SWITCHER_ITEM` is still in `apps/registry.ts`.
  `SuiteSettingsDialog` is called from Mail's and Calendar's
  `SettingsModal`, Meet's `components/settings/SettingsDialog.vue` and the
  legacy Drive `SettingsDialog`.
- **Ticket 014.** No `suite_flip_shell`, `suite_flip_files`, `node_url` or
  redirect table. `suite/hooks.py:444-447` runs WebDAV, then the
  composition dispatcher, in `before_request`. `utils/lastApp.ts` and
  `SUITE_APPS` (`apps/registry.ts`) are live. No platform PWA: Mail
  registers `sw.js` (`MailLayout.vue:161-207`). Slides registers
  `/service-worker.js` in `apps/slides/SlidesShell.vue:44-68`.
- **Drive seam debt.** `apps/drive/index.ts` exports legacy `ShareDialog`,
  `MoveDialog`, `InfoDialog` and `InlineRenameInput`.
  `apps/drive/runtime.ts` imports `legacy/data/selection` and calls
  `suite.drive.api.product.get_translations`. Writer imports
  `apps/drive/legacy/*` from 10 files, and Slides from
  `components/SharePopover.vue`. `router/index.ts` imports
  `@/apps/drive/legacy/routes`. The legacy tree cannot go in one commit
  until these edges go.
- **Workaround.** `createDocument` in `apps/drive/client/nodes.ts` chains
  `roots_discover` and `node_create` through `upload()`.
- **Earlier-wave gaps (ACCOUNTING.md, still open).** Media handles unused by
  products; Sheets has no comments or versions panel and keeps its legacy
  header with its own Share control; no collaboration verdict narrowing;
  no New from template; Copy does not open the new node; shell surfaces
  still read `@/boot/session`; Slides writes `document.title` directly;
  Files column switches have no accessible name.

### Facts that differ from the 2026-09-15 documents

- Boundary baseline: 315 owned graph violations and 83 unstable frappe-ui
  imports. ACCOUNTING.md recorded 191 and 82. The rise came with
  `fb5213940`.
- `IMPLEMENTATION.md` shows `AreaDefinition` without `loadPanel`. The code
  still has it.
- ACCOUNTING.md lists `shell/ContextualPanel.vue` as a kept wrapper. Ticket
  010 deletes it.
- The legacy Vitest manifest (`frontend/test-manifest/legacy-failures.json`)
  lists 0 failures. Ticket 013 expected 57 Slides failures and one Writer
  collection error; ACCOUNTING.md already recorded them as fixed.
- `.github/CODEOWNERS` covers `e2e/unified-frontend/{shell,files}` but not
  `e2e/unified-frontend/home`.
- No CI job runs the unified browser journeys. CI
  (`.github/workflows/suite-ci.yml`) runs the boundary check, the budget,
  the build, `test:unified` and `test:legacy`.
- The bench webserver port is 8006 (`sites/common_site_config.json`). The
  Drive plan says 8010.

## Test commands

Frontend, from `frontend/`:

```sh
yarn test:unified                 # zero-red project (vitest --project unified)
yarn test:legacy                  # legacy project against the exact manifest
yarn test <file>                  # one file (frontend/AGENTS.md)
yarn check:import-boundaries      # layer graph, seams, frappe-ui baseline
yarn check:bundle-budget          # runs its own vite build; 200 KiB gzip cap
yarn build                        # app plus service worker build
yarn generate:contract            # contract.json -> client/generated.ts
```

Browser journeys, from `e2e/`:

```sh
yarn test:unified-shell
yarn test:unified-files
yarn test:unified-home
yarn typecheck
```

Journey environment: `BASE_URL` (default `http://slides.localhost:8086`),
`BENCH_PATH` (default `/home/faris/benches/suite-bench`), `BENCH_SITE`
(default `slides.localhost`), `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.

Backend, from the bench root (`suite/AGENTS.md`):

```sh
bench --site slides.localhost run-tests --module suite.composition.tests.test_http
bench --site slides.localhost run-tests --module suite.composition.tests.test_contract
bench --site slides.localhost run-tests --module suite.api.test_routes
bench --site slides.localhost run-tests --module suite.api.test_account
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_routes
bench --site slides.localhost execute suite.composition.contract.write_all
```

The last command regenerates every `contract.json` after a route table
changes. Run `yarn generate:contract` after it.

No frontend typecheck script exists. See Open items.

## Stages

### Order and lanes

```text
0 branch and baseline
│
├─ shell lane   1 frame rework ─┬─ 4 settings ─┐
│               3 four fixes ───┴──────────────┴─ 5 adoption ─ 6 flip plumbing ─ 7 FLIP 1
│
├─ files lane   2 link credentials ─(needs 1)─┬─ 8 guest and link routes
│                                             ├─ 9 sharing dialog
│                                             └─ 10 upload, restore, batch
│
├─ documents    11 document surfaces complete (any time after 0)
│
└─ rollout      12 redirects, node_url, invitations (server half after 0;
                   client half after 6)

7 + 8 + 9 + 10 + 11 + 12 ─ 13 FLIP 2 ─ 14 HOLD ─ 15 DELETE ─ handoff to Drive issue 36
```

- Stages 1 and 3 run in parallel. Stage 2 runs in parallel with 1 and 3.
- Stages 8, 9 and 10 run in parallel after 1 and 2. They share
  `FilesPage.vue`; see Shared files.
- Stage 11 runs in parallel with every stage before 13.
- Stage 12's server half runs in parallel with every stage before 13.
- Stages 7, 13, 14 and 15 are serial.

### Shared files

One stage edits a shared file at a time. Stages edit these files in the
order shown. A later stage rebases on the earlier stage's merge.

| File | Order |
|---|---|
| `frontend/src/platform/contracts/index.ts` | 1 |
| `frontend/src/shell/ShellLayout.vue` | 1, 5, 8 |
| `frontend/src/shell/MobileNav.vue`, `mobileNav.ts` | 1, 5, 10 |
| `frontend/src/shell/Rail.vue`, `RailItem.vue` | 10 |
| `frontend/src/composition/appRegistry.ts` | 1, 5, 6, 10 |
| `frontend/src/composition/routes.ts` | 5, 6, 8, 12 |
| `frontend/src/router/index.ts` | 5, 6, 8, 12 |
| `frontend/src/apps/drive/files/pages/FilesPage.vue` | 1, 8, 9, 10 |
| `frontend/src/apps/drive/index.ts` | 2, 9, 10, 11 |
| `frontend/src/apps/drive/client/session.ts` | 2, 9, 11 |
| `frontend/src/apps/slides/surface/SlidesSurface.vue` | 2, 11 |
| `frontend/scripts/check-import-boundaries.mjs` | 0, then each stage removes only its own resolved baseline entries |
| `suite/www/suite.py` | 6 |
| `suite/hooks.py` | 8, 12 |

### Stage 0. Branch and baseline

- **Goal:** an integration branch with current upstream code and recorded
  green gates.
- **Spec:** none.
- **Files:** merge conflict resolutions only.
- **Work:**
  - Create `forge/unified-frontend` off `forge/wayfinder-unified-frontend`
    after the spec and plan commit.
  - Merge `upstream/develop` into it. Resolve conflicts in favor of
    develop's Mail, Calendar and Meet behavior and the unified shell's
    structure.
  - Record the boundary baseline counts, the budget, and each test count.
- **Depends on:** the spec and plan are approved.
- **Exit gate:** every command in Test commands passes on the merged branch.
  The report states the new baseline counts. Faris approves the merge.

### Stage 1. Shell frame rework

- **Goal:** the shell gives a rail and one full box. Pages draw their own
  sidebar.
- **Spec:** §3, §9.
- **Files (owned):** `platform/contracts/index.ts`, a new `<AreaSidebar>`
  under `frontend/src/platform/`, `shell/ContextualPanel.vue` (deleted),
  `shell/ShellLayout.vue`, `shell/MobileNav.vue`, `shell/mobileNav.ts`,
  `shell/MobileSheet.vue`, `shell/useMobileSheet.ts`,
  `composition/appRegistry.ts`, `composition/home/{HomePage,HomePanel}.vue`,
  `apps/drive/files/pages/{FilesPage,FilesPanel}.vue`, the placeholder
  panels in `apps/mail/index.ts` and `apps/calendar/index.ts`, colocated
  tests, `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - `AreaDefinition` loses `loadPanel`: `id`, `label`, `icon`, `to`,
    `loadRoutes`, `requires`.
  - The frame set is in the shell or outside it (`frame: 'none'`).
  - `<AreaSidebar>`: fixed width, scroll area, aria label, fixed-size
    skeleton while the page chunk loads, phone sheet behavior.
  - Home and Files render their panels inside `<AreaSidebar>`.
  - The shell bottom nav gains the account entry: avatar, then a sheet with
    account, Settings, Theme and Log out.
- **Depends on:** stage 0.
- **Exit gate:**
  - `grep -rn loadPanel frontend/src` returns nothing.
  - `shell/ContextualPanel.vue` does not exist.
  - Shell, Files and Home journeys pass on desktop and phone widths.
  - Layout does not move when an area switches: the rail stays fixed and
    the sidebar skeleton has the loaded width.
  - `test:unified`, `check:import-boundaries` and `check:bundle-budget`
    pass.

### Stage 2. Drive link credentials

- **Goal:** the Drive client owns link codes. Platform transport only sends
  a header it is given.
- **Spec:** §7 (link credentials), §10.
- **Files (owned):** `platform/transport/index.ts` (remove `LinkStore`),
  `apps/drive/client/` (new link store module, tagging, header selection),
  `apps/drive/client/session.ts`, `apps/drive/index.ts`, the manual header
  at `apps/slides/surface/SlidesSurface.vue:207`, colocated tests.
- **Work:**
  - Store in `localStorage`: links `code -> {target, ticket?, lastUsed}` and
    tags `node -> code`.
  - Tag nodes returned through a link. Send a code only for a tagged node.
  - Evict on 404 or 410, on ticket expiry (keep the bare code), and LRU at
    50 links and 1000 tags. Clear everything on sign out.
  - Over 20 codes: reads split into groups of 20 and merge; writes refuse
    with the ticket 008 message.
  - One `localStorage` key for the guest name. Clear it with the store on
    sign out. Ignore it while signed in.
- **Depends on:** stage 0. No backend ask.
- **Exit gate:** unit tests cover tagging, the 20-code split, the write
  refusal, each eviction rule and sign-out clear. No code outside
  `apps/drive/client` sets `X-Drive-Links`. `test:unified` and
  `check:import-boundaries` pass.

### Stage 3. Four shell-breaking fixes

- **Goal:** Mail and Meet stop breaking a shared page.
- **Spec:** §9.
- **Files (owned):** `apps/mail/pages/MailLayout.vue`,
  `apps/mail/components/MailThread.vue` (listener only),
  `apps/meet/pages/MeetLayout.vue`, the Mail socket module
  (`apps/mail/socket.ts`), colocated tests.
- **Work:**
  - Scope `body.mail-app` CSS to Mail's box.
  - Remove the second `FrappeUIProvider` from Mail and Meet.
  - Dispose the socket on unmount.
  - Mail `window` key listeners fire only on Mail routes. Delete the theme
    cycle listener.
- **Depends on:** stage 0.
- **Exit gate:** a journey opens Mail, then Files, then Mail again, and
  checks: document `overflow` and dialog stacking are normal outside Mail;
  one socket is open; `?` does nothing outside Mail. `test:unified` and
  `test:legacy` pass.

### Stage 4. Settings dialog and account surfaces

- **Goal:** one settings list, one dialog, one phone drill-in.
- **Spec:** §12.
- **Files (owned):** `composition/settings.ts` (new), `shell/settings/`,
  `shell/accountMenu.ts`, `shell/AccountMenu.vue`, `apps/registry.ts`
  (Desk item only), one small settings module per product (Drive, Mail,
  Calendar, Meet), `components/settings/` (tab bodies),
  `apps/mail/components/PWASettings.vue` (becomes the shell drill-in),
  `shell/LauncherView.vue` and `shell/useWorkspace.ts` (`@/boot/session`
  reads), colocated tests, `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Headings in order: Account, Files, Mail, Calendar, Meet, Workspace.
  - Tab ids are namespaced and typed. `openSettings(tab)` takes the union.
    Replace Mail's label lookups (`MailThread.vue`, `ScreenerView.vue`) and
    Drive's numeric indexes.
  - Modules load when the dialog opens. A body loads on first click behind
    a fixed-height loading state.
  - Desktop avatar menu: header, Settings, Open Desk (system users), Upgrade
    plan, Log out. Phone sheet: header, Settings, Theme, Log out.
  - Mail's Admin dashboard becomes an admin-only row in Mail's sidebar.
  - Meet's in-call dialog reuses the Meet tab bodies and adds Controls.
- **Depends on:** stage 1 (phone account entry). Files Statistics waits on
  Drive ask D25 (storage breakdown).
- **Exit gate:** journeys open each heading's first tab on desktop and phone;
  the phone back gesture goes tab, list, closed. A misspelled tab id fails
  the type check (see Open items). No bundle for a tab body loads before
  its click. `check:bundle-budget` passes.

### Stage 5. Mail, Meet and Calendar adoption

- **Goal:** the three apps mount in the shell as they are.
- **Spec:** §9.
- **Files (owned):**
  - Mail: `apps/mail/` sidebar header, `SettingsModal`, app switcher use,
    `MobileTabBar` visibility.
  - Calendar: `apps/calendar/` sidebar header, `SettingsModal`,
    `CalendarTabBar`, `CalendarLayout.vue`.
  - Meet: `apps/meet/index.ts` (area definition), `apps/meet/` page
    sidebar and header menu.
  - PWA: a new platform PWA module under `frontend/src/platform/`, Mail's
    `sw.js` registration (moved out of `MailLayout.vue`), `setPwaTags`.
  - Shell: `ShellLayout.vue` and `MobileNav.vue` (hide the bottom nav in
    Mail and Calendar), `composition/appRegistry.ts` (Meet last),
    `composition/routes.ts`, `router/index.ts`.
  - Journeys: `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Each app deletes the app switcher, Log out and the account row, the
    Theme submenu, Settings and its modal, and the logo row.
  - Meet becomes an area with no capability gate. `/meet` and
    `/meet/audio-test` are in the shell. `/meet/:meetingId` stays outside.
  - The platform registers the service worker after sign-in. Push handlers
    stay in `sw.ts`. The manifest is on every route.
  - Mail's sign-in pages and `mime-message` stay outside the shell.
- **Sub-lanes:** Mail, Calendar and Meet run in parallel. The PWA and shell
  part runs last. All three land in one merge.
- **Depends on:** stages 1, 3 and 4. Open item O1 (what the rollback state
  shows) must close before the chrome deletions.
- **Exit gate:** Mail, Meet and Calendar journeys pass in the shell on
  desktop and phone. The rail is Home, Files, Mail, Calendar, Meet (flag
  filtering comes in stage 6). `grep -rn useAppSwitcher frontend/src/apps`
  returns nothing. No product imports `shell/`.

### Stage 6. Shell flip plumbing

- **Goal:** two `frappe.conf` keys switch the flips without a deploy.
- **Spec:** §14.
- **Files (owned):** `suite/www/suite.py` (boot values), a boot flag reader
  under `frontend/src/platform/`, `composition/appRegistry.ts`,
  `composition/routes.ts`, `router/index.ts`,
  `apps/slides/SlidesShell.vue`, `apps/slides/service-worker.js`,
  `suite/www/service-worker.js`, `suite/www/service_worker.py`.
- **Work:**
  - The server reads `suite_flip_shell` and `suite_flip_files` and sends
    them in the SPA boot. The client reads them from boot only.
  - `suite_flip_shell` on: Mail, Calendar and Meet routes use the shell
    frame. Off: they keep the old frame.
  - `suite_flip_files` off: the rail shows Mail, Calendar and Meet only, and
    `/` goes to `/mail` through the last-app fallback. On: the rail gains
    Home and Files, and `/` goes to `/home`.
  - The Slides service worker stops caching the shell.
- **Depends on:** stage 5.
- **Exit gate:** a journey runs each prefix with each flag on and off. The
  Slides service worker test shows no cached shell document.

### Stage 7. Flip 1

- **Goal:** Mail, Meet and Calendar in the shell on production.
- **Spec:** §14.
- **Files:** none. `bench set-config suite_flip_shell 1` on the site.
- **Gates (ticket 014, decision 7):**
  - Browser journeys pass for Mail, Meet and Calendar in the shell.
  - The four shell fixes from ticket 010 have landed.
  - The Slides service worker serves no stale shell.
  - Rollback is rehearsed once on the dev site: flag on, flag off, a cold
    load of each prefix.
- **Depends on:** stage 6, and the code released to production (Open item
  O6).
- **Exit:** the report records the release, the date and the rehearsal
  output. Faris sets the key or names who does (map Not yet specified).

### Stage 8. Guest and link routes

- **Goal:** a visitor without a session opens shared items in the shell's
  guest frame.
- **Spec:** §10.
- **Files (owned):**
  - Server: the `/l/<token>` website rule and `suite/www/drive_link.py`
    (Drive program, asks D22 and D23), `suite/www/drive_link.html` (Suite
    ask S3), `suite/hooks.py` (`website_route_rules` entry).
  - Client: `shell/ShellLayout.vue` (guest frame), `shell/GuestSurface.vue`
    (becomes the guest header and the Sign-in screen), `composition/routes.ts`
    (`/l/:token` placeholder removed; a `#link=` reader seeds the Drive
    store and strips the fragment before the first node request),
    `router/index.ts` (setup gate skips `allowGuest` routes for everyone),
    `apps/drive/files/` (unlock state on `401 DriveLocked`, 429 countdown
    from `Retry-After`, Star hidden and no visit for link-only access, New
    hides document kinds below EDIT), `composition/DocumentHost.vue`
    (unlock state on `/d/`).
  - Journeys: `e2e/unified-frontend/files/specs/` (guest cases).
- **Depends on:** stages 1 and 2. Drive asks D22 and D23. Suite asks S3
  and S4.
- **Exit gate:**
  - `/l/<token>` opens a folder and a file, signed out and signed in. The
    URL keeps no token after load.
  - Unlock: 401 shows "Wrong password"; 429 disables the form and counts
    down.
  - A copied URL without the link shows the Sign-in screen and never says
    whether the item exists.
  - Dead-link page: 404 and 410 copy; "Go to Home" when signed in.
  - Guest frame on phone has no bottom nav.

### Stage 9. Sharing dialog

- **Goal:** one Drive-owned share dialog for Files and every document.
- **Spec:** §7.
- **Files (owned):** a new share feature under `apps/drive/files/features/`,
  a grants descriptor module in `apps/drive/client/`,
  `apps/drive/client/session.ts` (`share` action), `apps/drive/index.ts`
  (drop the legacy `ShareDialog` export), `FilesPage.vue` (row Share),
  journeys in `e2e/unified-frontend/files/specs/`.
- **Work:** People, General access, Share links, folded inherited part;
  Remove and Remove here and inside; Deny access here and Allow again;
  roles per principal table; + New link; row menu; outsiders by email;
  Notify by email; expired rows greyed; self-demotion confirm; re-read after
  every write; phone bottom sheet.
- **Depends on:** stages 1 and 2. Drive asks D16 to D20. Suite ask S2.
- **Exit gate:** journeys cover a local grant, an inherited grant with Deny,
  a password link whose expiry changes without losing the password, an
  outsider link, and Public on the web. Product Share buttons (stage 11)
  open this dialog.

### Stage 10. Upload, restore and batch outcomes

- **Goal:** uploads, restore and permanent delete work in Files.
- **Spec:** §6.
- **Files (owned):** `platform/server-state/index.ts` (`upload()` start
  offset only), a new upload feature under `apps/drive/files/features/`,
  `apps/drive/index.ts` (`driveUploadProgress()`), `composition/appRegistry.ts`
  (Files badge), `shell/Rail.vue`, `shell/RailItem.vue`, `shell/MobileNav.vue`
  (ring), `FilesPage.vue` (drop targets, Restore, Delete forever, Empty
  trash), the file preview header in `apps/drive/files/features/preview/`
  (Upload new version), journeys in `e2e/unified-frontend/files/specs/`.
- **Work:** the queue and tracker; IndexedDB record for 24 hours; resume with
  a stored handle or a re-pick check; sha256 on resume through a streaming
  hasher; chunks up to 16 MB, sequential per file; collision dialog; quota
  preflight; 413 banner; folder upload; drop targets; browser replace;
  restore with the same-root picker; batch purge; Empty trash; guest
  uploads through the ring slot from stage 8.
- **Depends on:** stages 1 and 2; stage 8 for the guest ring slot. Drive
  asks D10 to D15. Open item O7 (hasher package).
- **Exit gate:** journeys cover a batch upload with a collision, a reload
  mid-upload then Resume, a folder upload, a quota refusal, a restore that
  needs a destination, Delete forever on a mixed batch, and Empty trash.
  The ring shows in another area while an upload runs.

### Stage 11. Document surfaces complete

- **Goal:** the `/d/` surfaces meet ticket 009 and stop depending on legacy
  Drive code.
- **Spec:** §8, §10 (guest names in comments).
- **Files (owned):** per product, run in parallel:
  - Writer: `apps/writer/` (10 files that import `apps/drive/legacy`,
    `surface/`, `CommentEditor`, `ErrorPage.vue:61`).
  - Sheets: `apps/sheets/surface/`, `apps/sheets/components/SheetEditor/`
    (legacy header and its Share control).
  - Slides: `apps/slides/surface/`, `components/SharePopover.vue`,
    `pages/Slideshow.vue:332`, `pages/PresentationEditor.vue:166`.
  - Drive: `apps/drive/client/session.ts`, `apps/drive/client/nodes.ts`
    (`createDocument` without `upload()`), `apps/drive/index.ts` (legacy
    `MoveDialog`, `InfoDialog`, `InlineRenameInput` exports),
    `apps/drive/runtime.ts`.
- **Work:**
  - No file outside `apps/drive/legacy` imports it, except
    `router/index.ts` (stage 15).
  - Products name media by node id and use session media handles.
  - Sheets renders its own comments and versions panels and title bar.
  - A collaboration verdict narrows access and cancels pending writes.
  - New from template with the doctype filter; Copy opens the new node.
  - Guests see an optional "Your name" field in comment composers.
  - Writer's `/drive/login` link becomes `/login?redirect-to=`.
  - Product Share buttons call `session.share`.
- **Depends on:** stage 0. Share wiring completes after stage 9.
- **Exit gate:** `check:import-boundaries` shows no Writer or Slides edge
  into `apps/drive/legacy`. Document journeys pass for all three kinds,
  signed in and as a guest. No legacy `suite.drive.api.*` request appears
  in a `/d/` journey's network log.

### Stage 12. Files flip plumbing

- **Goal:** old links reach new routes, and the server builds every node
  link in one place.
- **Spec:** §14.
- **Files (owned):**
  - Composition: a redirect table module in `suite/composition/`, its
    `before_request` entry in `suite/hooks.py`, the exported client copy,
    and one client router guard in `frontend/src/composition/`.
  - `node_url(node)`: owner per Open item O3.
  - Callers replaced by `node_url`: `suite/drive/api/notifications.py:8`,
    the grant share URL (`suite/drive/_core/access.py:1161`, Drive ask
    D16), `suite/www/drive_link.py:31`, `product.py` and OAuth `/drive`,
    `suite/drive/http/shims.py:1793` and `:2380`, the Writer wikilink, the
    Meet recording email, WebDAV HTML links, and the broken
    `/sheets?id=` link in `suite/sheets/api.py:228`.
  - Invitations: `suite/drive/doctype/drive_user_invitation/drive_user_invitation.py:91`
    and the legacy signup page.
  - Legacy-call counter: Drive program (ask D24).
  - Tests: a redirect test in `suite/composition/tests/`, journeys in
    `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Redirect rows per ticket 014 decision 3; 302 while a flag can turn off.
  - Sheets and Slides URLs look up the content `node` field; `/drive/g/<id>`
    looks up the node kind.
  - Invitation accept creates and logs in the user, then redirects through
    `node_url`'s flag to `/home` (or `/drive/` before flip 2).
    `/drive/signup` and its page go.
  - PWA `/suite/start` goes to `/home` when `suite_flip_files` is on.
- **Split:** the server half (table, `node_url`, callers, invitations,
  counter) runs after stage 0. The client guard runs after stage 6.
- **Depends on:** Drive asks D16 and D24.
- **Exit gate:** the redirect test hits every old path in the table and
  checks the new path, with the flag on and off. No server code outside
  `node_url` builds a node path string (grep for `/drive/`, `/d/`,
  `/files/f/`).

### Stage 13. Flip 2

- **Goal:** Home, Files and documents are the default.
- **Spec:** §14.
- **Files:** none. `bench set-config suite_flip_files 1` on the site.
- **Gates (ticket 014, decision 7):**
  - Browser journeys pass for Home, Files and documents.
  - The five Drive asks from ticket 006 have shipped.
  - New code makes zero legacy `suite.drive.api.*` calls (ticket 013's
    boundary check).
  - A test hits every old path in the redirect table and checks the new
    path.
  - Invitation accept lands on `/home`.
  - The `/l/<token>` server rule exists and opens a folder and a file.
  - The legacy Vitest manifest is not a gate. It shrinks by deletion.
- **Depends on:** stages 7 to 12, and the Drive Build release on production
  (Open item O6).
- **Exit:** the report records the release, the date, and the gate output.

### Stage 14. Hold

- **Goal:** proof that no client calls the legacy Drive API.
- **Files:** none.
- **Gate (ticket 014, decision 8):** flip 2 holds for one full release on
  production, and at least 14 days, with the legacy-call counter at zero.
- **Evidence:** the counter's bench command output at the start and end of
  the hold, by method name and user agent. A non-zero count names the
  client; fix or retire it, then restart the 14 days.
- **Depends on:** stage 13 and ask D24 on production.

### Stage 15. Deletion commit

- **Goal:** remove the old pages in one commit.
- **Spec:** §14.
- **Files (one commit):**
  - `frontend/src/apps/drive/legacy/` and `@/apps/drive/legacy/routes` in
    `router/index.ts`.
  - The old Writer, Sheets and Slides pages. The editors stay. Candidate
    paths: `apps/writer/pages/`, `apps/sheets/pages/`,
    `apps/slides/pages/{Home,PresentationEditor,Slideshow,ExportView}.vue`
    and their routes (see Open item O8).
  - Both flag keys and their boot and client reads.
  - `SUITE_APPS` and `utils/lastApp.ts`.
  - The legacy Drive `SettingsDialog`, its `showSettings` emitter and its
    numeric tab indexes.
  - The Drive translation wrapper and its last caller.
  - Every boundary baseline entry and legacy manifest entry that the
    deletion resolves.
- **Also in the commit:** the Slides service worker is unregistered.
  Redirects become 301.
- **Depends on:** stage 14.
- **Exit gate:** `yarn build`, `test:unified`, `test:legacy`,
  `check:import-boundaries`, `check:bundle-budget` and the three journey
  projects pass. `grep -rn "suite.drive.api" frontend/src` returns only the
  permanent names (Open item O4).

## Backend asks by stage

Status is at HEAD `f0f6a5c13`. "Map branch" means the code landed on
`forge/wayfinder-unified-frontend`, not on `forge/drive-layer`.

### Drive program

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| D1 | `GET /roots` | 006 | done | shipped, map branch |
| D2 | Folders first, `group_by`, id tie-break | 006 | done | shipped, map branch |
| D3 | `kind=folder` in the SQL window | 006 | done | shipped, map branch |
| D4 | Page-batched `expand=access` | 006 | done | shipped, map branch |
| D5 | Batched `expand=breadcrumbs` on search | 006 | done | shipped, map branch |
| D6 | Folder archive routes | 006 | done | shipped (synchronous build), map branch |
| D7 | Payload-free `drive:changed` | 006 | done | shipped, map branch |
| D8 | `opened_at` on recents | 012 | done | shipped, map branch |
| D9 | Notification unread-count route | 012 | done | shipped, map branch |
| D10 | `create_upload` 409 with free title | 007 | 10 | not shipped |
| D11 | `POST /nodes` 409 with free title | 007 | 10 | partial: 409 without the title (`suite/drive/_core/nodes.py:2255-2268`) |
| D12 | HTTP replace skips the §8.5 auto version | 007 | 10 | not shipped |
| D13 | `DriveRestoreDestinationRequired` | 007 | 10 | not shipped |
| D14 | Batch purge route | 007 | 10 | not shipped |
| D15 | Empty trash per root | 007 | 10 | not shipped |
| D16 | Grant `url` is `/l/<token>` | 008 | 9, 12 | not shipped (`access.py:1161` returns `/drive/l/`) |
| D17 | Inherited grants with source node | 008 | 9 | not shipped |
| D18 | Omitted password keeps the hash; `null` clears | 008 | 9 | not shipped |
| D19 | `send_to` on `$LINK` PUT | 008 | 9 | not shipped |
| D20 | `notify: true` sends email | 008 | 9 | not shipped |
| D21 | Spec §11.2 fix: explain object, `{ticket, expires}` | 008 | none | not done: spec line 2934 still shows an array |
| D22 | `/l/<token>` redirects by kind to `/files/f/` or `/d/` with `#link=` | 011 | 8, 13 | not shipped (`drive_link.py:31` goes to `/drive/g/`) |
| D23 | Unlock 429 with `Retry-After`; the lockout failure answers 429 | 011 | 8 | not shipped |
| D24 | Legacy-call counter by method and user agent, bench command | 014 | 12, 14 | not shipped |
| D25 | Storage breakdown route | 005 | 4 (Files Statistics) | partial: `GET /roots/{root}/usage` has totals only |
| D26 | `favourite` on the node shape | ACCOUNTING.md, no ticket | none assigned | not shipped (Open item O9) |

Withdrawn: ticket 008 ask 2 (`GET /links/<token>`).

### Suite

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| S1 | Ticket 003 routes: `account`, `site`, `users`, `invitations`, Mail `inbox-summary`, Calendar `events`, Meet `rooms` and `scheduled-meetings`; dispatcher; conformance kit | 003 | done | shipped, map branch |
| S2 | `GET /api/suite/people?q=` | 008 | 9 | not shipped |
| S3 | `drive_link.html` 404 and 410 copy, Go to Home | 011 | 8 | not shipped |
| S4 | Setup gate skips `allowGuest` routes | 011 | 8 | partial: guests pass, signed-in users do not |
| S5 | Writer `ErrorPage.vue:61` to `/login?redirect-to=` | 011 | 11 | not shipped |

### Calendar and Meet

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| C1 | Typed `conferencing` on events | 012 | done | shipped |
| C2 | Optional `account`, omitted means all | 012 | done | shipped |

Meet has no launch ask. Recordings and named rooms are map fog.

The Drive implementation README tracks no issue for D10 to D26. See Open
item O2.

## Branch rules

- Every branch on this devbox uses the `forge/` prefix.
- Never commit on `develop` or `main`.
- `forge/wayfinder-unified-frontend` holds the map, tickets, spec, plan and
  the earlier wave's code. Documentation changes stay on it.
- `forge/unified-frontend` is the integration branch and the sole merge
  target for stages 0 to 15. Stage 0 creates it off
  `forge/wayfinder-unified-frontend`.
- Each stage gets its own branch, `forge/uf-<stage>-<slug>`, forked from
  the current tip of `forge/unified-frontend`. Each stage branch gets its
  own worktree. Sub-lanes of one stage use `forge/uf-<stage>-<slug>-<part>`
  and merge into the stage branch.
- Run `git branch --show-current` before every merge. Run the merge as a
  separate command from `git worktree add` (Drive README rule).
- Drive asks follow the Drive program's rules: branch off
  `forge/drive-layer`, merge into `forge/drive-layer`. This effort then
  merges `forge/drive-layer` into `forge/unified-frontend`. Never merge
  `forge/unified-frontend` into `forge/drive-layer`.
- Merge `upstream/develop` into `forge/unified-frontend` in stage 0, again
  before stage 5, and again before stage 7.
- Research branches are `forge/research-<name>`.
- No push, no PR and no merge into `develop` or `main` without Faris.

## Handoff to Drive Cleanup (issue 36)

Issue 36 is blocked until "the unified suite frontend effort has migrated
every Drive client off the legacy methods". Drive spec §14.10 gate 3 says
"the SPA has moved off the 69 old method names". Ticket 014 names the
counter as the evidence.

After stage 15 lands, this effort hands issue 36:

- The flip 2 release and date (stage 13).
- The hold record: release id, start and end dates (at least 14 days), and
  the counter output at both ends, by method name and user agent, at zero
  (stage 14).
- The deletion commit hash, and `grep -rn "suite.drive.api" frontend/src`
  output that shows only permanent names (stage 15).
- The `check:import-boundaries` output after deletion.
- The list of old URLs that still redirect forever, and the two rows that
  go with Drive's translate tables when Cleanup drops them:
  `/drive/{folder,document,file}/<old>` and `/drive/t/<team>/...`.

The orchestrator writes this evidence under issue 36's "Completion
evidence" with Faris's approval. Issue 36's other gates (a Build release, a
distinct later release, backup, destructive-deployment authority) stay with
the Drive program.

## Rules for all agents

- Work only inside the Suite repository.
- Never push, post, comment or write outside the repository. No PRs.
- Subagents must not post, comment, push, merge or write anywhere outside
  the current repo without Faris's confirmation. Put that limit in each
  subagent prompt.
- No service restarts. No `pip install`. Add no npm package without
  Faris's approval.
- Test only against `slides.localhost`. No other bench or site.
- Workflow agents do not commit. The orchestrator commits each stage's
  verified changes on the stage branch.
- Edit only the files your stage owns. Edit a shared file only in your turn
  in Shared files.
- Load the `frappe-ui` skill before styling. Use design tokens. Layout must
  not move on load, hover or state change.
- New code makes no legacy `suite.drive.api.*` call. A missing route is a
  backend ask, not a reason for a fallback.
- A new boundary violation fails. Remove each baseline entry your stage
  resolves.
- Treat the spec, the tickets, `MAP.md` and `ARCHITECTURE.md` as approved
  inputs. Change them only in a documentation-sync pass.
- Report real command output. If a check did not run, say "not verified"
  and name it.
- End every stage report with a `Not done:` line.

## Open items

- **O1. Rollback state for flip 1.** Ticket 014 turns flip 1 off by a
  config key. Tickets 010 and 016 delete Mail's and Calendar's app
  switcher, Settings and `SettingsModal` when the three apps flip. With the
  key off, what does Mail show: the old chrome (kept until stage 15), or
  the old frame without it? Stage 5 waits on this.
- **O2. Drive issues for new asks.** D10 to D26 have no Drive issue. The
  earlier wave shipped D1 to D9 and S1 on the map branch, not on
  `forge/drive-layer`. Decide whether to file D10 to D26 as Drive issues
  and whether to port `20befde95` and `47311aa11` to `forge/drive-layer`.
- **O3. Owner of `node_url`.** Ticket 014 names the helper and its
  callers, not its module. Candidates: the Drive public interface
  (`suite.drive`) or `suite/composition/`.
- **O4. Counter scope.** Ticket 014 says "the legacy `suite.drive.api.*`
  dispatch". Drive spec §14.10 names the 69 old names, three of which are
  permanent. Ticket 005 keeps 17 product methods on `/api/method/` by
  design. Decide which names must read zero.
- **O5. Calendar and Meet beyond ticket 010's fix list.** `CalendarLayout`
  sets `body.calendar-app` and mounts a `FrappeUIProvider`; Meet opens a
  socket per mount. Confirm they fall under the same fixes in stage 3.
- **O6. Release path and order.** No rule says how `forge/unified-frontend`
  reaches production, or its order against the Drive Build release. Flip 2
  needs Build on production, because the new pages read Drive Nodes only.
  Issue 36 needs Cleanup in a later release than Build.
- **O7. Streaming sha256 hasher.** Ticket 007 needs a wasm hasher for
  resume. No package is chosen, and adding one needs approval.
- **O8. Old Slides pages.** The redirect table maps
  `/slides/slideshow/<docname>` to `/d/<node>`. Decide whether
  `Slideshow.vue` and `ExportView.vue` are old pages or parts the `/d/`
  surface keeps.
- **O9. Star state.** The node shape has no `favourite`, so no row shows
  its star (ACCOUNTING.md). No ticket records the ask. It needs an owner and
  a stage.
- **O10. Type gate.** Ticket 016 wants a misspelled tab id to fail at
  compile time. No frontend typecheck script or CI step exists. Decide the
  command.
- **O11. Mail journeys need a mail account.** Administrator on
  `slides.localhost` has no JMAP account (ACCOUNTING.md). Flip 1's gate
  needs Mail and Calendar journeys in the shell.
- **O12. From the map, still open.** Who runs `bench set-config` for each
  flip on Frappe Cloud, and the release note. Whether WebDAV clients follow
  a 302 on `/drive/d/<id>`. Icon source (Figma set or lucide) before the
  first new styling in stages 4, 8, 9 and 10.
