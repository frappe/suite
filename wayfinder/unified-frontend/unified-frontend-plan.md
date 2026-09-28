# Unified frontend implementation plan

| | |
|---|---|
| Status | Drafted and audited 2026-09-29; open decisions in tickets 017 to 021. Agents wrote it for ticket 015. |
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
  2026-09-16). `upstream/develop` changes 189 files under
  `frontend/src/apps/{mail,calendar,meet}` and `frontend/src/router` since
  the merge base.
- The earlier wave's backend asks landed on this map branch, not on
  `forge/drive-layer`: `20befde95` (Drive asks for tickets 006 and 012) and
  `47311aa11` (ticket 003 dispatcher and routes).
- The last code commit is `fb5213940` (2026-09-17, reconcile with develop).
  Later commits change only `wayfinder/` and `frontend/CONTEXT.md`.
- Both `forge/drive-layer` and this branch were reconciled with develop by
  rebase on 2026-09-17. `fb5213940` has one parent. The branches
  `backup/drive-layer-pre-rebase-20260917-a848d9c6d` and
  `backup/unified-frontend-pre-rebase-20260917-0ba97fc5e` exist.

### Built and kept

| Area | State at HEAD | Paths |
|---|---|---|
| Platform | Eight modules plus `contracts` | `frontend/src/platform/{session,transport,server-state,realtime,translation,theme,page-meta,feedback,contracts}` |
| Composition | Area registry, routes, `DocumentHost`, document registry | `frontend/src/composition/{appRegistry.ts,routes.ts,DocumentHost.vue,documentRegistry.ts}` |
| Home | Recent, Upcoming, New, Meet control | `frontend/src/composition/home/` |
| Bell | Drive notifications with unread count | `frontend/src/composition/notifications/` |
| Files | Roots, saved views, cursors, server sort and group, search, selection, Move and Move to trash, `BatchOutcome`, folder picker, file preview | `frontend/src/apps/drive/files/`, `frontend/src/apps/drive/client/` |
| Documents | `DocumentSession` with access refresh, `media()`, credential grouper; Writer, Sheets, Slides surfaces. `DocumentHost` renders Drive's `filePreviewSurface` for a file node, and `openDocumentSession` serves both kinds [T011, T015] | `frontend/src/apps/drive/client/session.ts`, `frontend/src/apps/{writer,sheets,slides}/surface/`, `frontend/src/composition/DocumentHost.vue` |
| Legacy Drive | Relocated whole | `frontend/src/apps/drive/legacy/` |
| Backend | Owner dispatcher, conformance kit, Suite and product routes | `suite/composition/{http.py,registrations.py,contract.py}`, `suite/composition/tests/http_conformance.py`, `suite/api/routes.py` |
| Gates | Boundary checker, bundle budget, unified and legacy Vitest projects, three Playwright projects, CODEOWNERS | `frontend/scripts/`, `frontend/vitest.config.ts`, `e2e/unified-frontend/{shell,files,home}`, `.github/CODEOWNERS` |

### Rework that later tickets force

- **Ticket 010, shell.** `AreaDefinition` still has `loadPanel`
  (`platform/contracts/index.ts:34`). `shell/ContextualPanel.vue` still
  calls it. `ShellLayout.vue` still has the panel branch. `<AreaSidebar>`
  does not exist. Mail and Calendar placeholder panels sit in
  `apps/mail/index.ts:22-31` and `apps/calendar/index.ts:26-35`.
- **Ticket 010, areas.** No Meet area. Mail and Calendar routes are
  `frame: 'none'` (`composition/routes.ts`). Mail, Calendar and Meet keep
  their own layouts: `MailLayout.vue`, `CalendarLayout.vue`,
  `MeetLayout.vue`.
- **Ticket 010, four fixes.** All four are open:
  - `body.mail-app`: class toggle at `apps/mail/pages/MailLayout.vue:134-135`;
    `body.mail-app` rules at 246-348.
  - A second `FrappeUIProvider` in `MailLayout.vue` and `MeetLayout.vue`.
  - A socket per mount, never disposed: `provide('$socket', initSocket())`
    at `MailLayout.vue:122`; bare `initSocket()` at `MeetLayout.vue:10`.
  - Mail `window` listeners for `?`, `g`+letter and Cmd/Ctrl+Shift+L at
    `MailLayout.vue:88-149` and `211-218`; one more at `MailThread.vue:1268`.
- **Beyond ticket 010's list.** `CalendarLayout.vue` also sets
  `body.calendar-app` (lines 34, 38, 73, 82) and mounts a third
  `FrappeUIProvider`. Meet also creates a socket per mount. Stage 3 removes
  the Calendar provider and disposes the Meet socket. `body.calendar-app`
  only sets icon stroke width, so it does not break the shell [T015].
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
  Stage 2's `apps/drive/index.ts` edit waits for stage 1's `loadPanel`
  line.
- Stages 8, 9 and 10 start after 1 and 2. Their edits to a shared file
  follow the Shared files order. So Stage 8's route and shell edits wait
  for Stage 6, and 9 and 10 edit `FilesPage.vue` after 8.
- Stage 11 runs in parallel with every stage before 13.
- Stage 12's server half starts after stage 0. Its `hooks.py` edit waits
  for stage 8.
- Stages 7, 13, 14 and 15 are serial.
- Tickets 017 to 021 hold open decisions (see Open items). A stage that one
  of them blocks cannot pass its exit gate until ticket 022 folds the
  answers into the spec and this plan.

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
| `frontend/src/composition/routes.ts` | 1, 5, 6, 8, 12 |
| `frontend/src/router/index.ts` | 5, 6, 8, 12 |
| `frontend/src/apps/drive/files/pages/FilesPage.vue` | 1, 8, 9, 10 |
| `frontend/src/apps/drive/index.ts` | 1, 2, 9, 10, 11 |
| `frontend/src/apps/drive/client/session.ts` | 2, 9, 11 |
| `frontend/src/apps/slides/surface/SlidesSurface.vue` | 2, 11 |
| `frontend/src/apps/mail/pages/MailLayout.vue` | 3, 5 |
| `frontend/src/apps/mail/components/MailThread.vue` | 3, 4 |
| `frontend/src/apps/calendar/pages/CalendarLayout.vue` | 3, 5 |
| `frontend/scripts/check-import-boundaries.mjs` | 0, 11 (legacy-call rule), then each stage removes only its own resolved baseline entries |
| `suite/www/suite.py` | 6 |
| `suite/www/drive_link.py` | 8, 12 |
| `suite/hooks.py` | 8, 12 |
| `e2e/unified-frontend/shell/specs/` | 1, 3, 4, 5, 12 (one new spec file per stage) |
| `e2e/unified-frontend/files/specs/` | 8, 9, 10 (one new spec file per stage) |

### Stage 0. Branch and baseline

- **Goal:** an integration branch with current upstream code and recorded
  green gates.
- **Spec:** none.
- **Files:** conflict resolutions, and `.github/CODEOWNERS`
  (`/e2e/unified-frontend/home/ @netchampfaris`).
- **Work:**
  - Create `forge/unified-frontend` off `forge/wayfinder-unified-frontend`
    after the spec and plan commit.
  - Bring `upstream/develop` into it by the method ticket 019 sets (merge
    or rebase). Resolve conflicts in favor of develop's Mail, Calendar and
    Meet behavior and the unified shell's structure.
  - Record the boundary baseline counts, the budget, and each test count.
- **Depends on:** the spec and plan are approved. Ticket 019 (branch
  shape).
- **Exit gate:** every command in Test commands passes on the reconciled
  branch. The report states the new baseline counts. Faris approves the
  reconciled branch.

### Stage 1. Shell frame rework

- **Goal:** the shell gives a rail and one full box. Pages draw their own
  sidebar.
- **Spec:** §2.2, §3, §9.
- **Files (owned):** `platform/contracts/index.ts`, a new `<AreaSidebar>`
  under `frontend/src/platform/`, `shell/ContextualPanel.vue` (deleted),
  `shell/ShellLayout.vue`, `shell/MobileNav.vue`, `shell/mobileNav.ts`,
  `shell/MobileSheet.vue`, `shell/useMobileSheet.ts`,
  `shell/DocumentFrame.vue`, `composition/appRegistry.ts`,
  `composition/home/index.ts`, `composition/home/{HomePage,HomePanel}.vue`,
  `composition/routes.ts` (frame literals only), `apps/drive/index.ts`
  (`loadPanel` line only),
  `apps/drive/files/pages/{FilesPage,FilesPanel}.vue`, the placeholder
  panels in `apps/mail/index.ts` and `apps/calendar/index.ts`, colocated
  tests, `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - `AreaDefinition` loses `loadPanel`: `id`, `label`, `icon`, `to`,
    `loadRoutes`, `requires`.
  - The frame set is in the shell or outside it (`frame: 'none'`). Stage 1
    names the in-shell literal (spec §16, "In-shell `frame` literal").
  - `<AreaSidebar>`: fixed width, scroll area, aria label, fixed-size
    skeleton while the page chunk loads, phone sheet behavior.
  - A bottom-nav tap on the active area dispatches the existing
    `suite:open-active-area-panel` window event with `{ area }`
    (`shell/ShellLayout.vue:152`, `apps/drive/files/pages/FilesPage.vue:372`).
    `<AreaSidebar>` listens and opens its phone sheet [T015].
  - Home and Files render their panels inside `<AreaSidebar>`.
  - `/files/f/<root-node>` replace-redirects to `/files` or
    `/files/organization` (spec §2.2) [T001, T015].
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
- **Spec:** §7 (link credentials), §10, §3.10.
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
  refusal, each eviction rule and sign-out clear. Only `apps/drive/client`
  selects link codes. `platform/transport` sets `X-Drive-Links` only from a
  caller value. `test:unified` and `check:import-boundaries` pass.

### Stage 3. Four shell-breaking fixes

- **Goal:** Mail and Meet stop breaking a shared page.
- **Spec:** §9.
- **Files (owned):** `apps/mail/pages/MailLayout.vue`,
  `apps/mail/components/MailThread.vue` (listener only),
  `apps/meet/pages/MeetLayout.vue`, `apps/calendar/pages/CalendarLayout.vue`
  (provider only), the socket modules (`apps/mail/socket.ts`,
  `apps/meet/socket.ts`), colocated tests,
  `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Scope `body.mail-app` CSS to Mail's box.
  - Remove the extra `FrappeUIProvider` from Mail, Meet and Calendar
    [T015].
  - Dispose the Mail and Meet sockets on unmount [T015].
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
  `apps/mail/components/MailThread.vue` and `apps/mail/pages/ScreenerView.vue`
  (settings calls only), `shell/LauncherView.vue` and `shell/useWorkspace.ts`
  (`@/boot/session` reads), colocated tests,
  `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Headings in order: Account, Files, Mail, Calendar, Meet, Workspace.
  - Tab ids are namespaced and typed. `openSettings(tab)` takes the union.
    Replace Mail's label lookups (`MailThread.vue`, `ScreenerView.vue`) and
    Drive's numeric indexes.
  - Each product exports a lazy settings loader from its package root, the
    same shape as `loadSurface`. No subpath import [T013, T016, T015].
  - Modules load when the dialog opens. A body loads on first click behind
    a fixed-height loading state.
  - Desktop avatar menu: header, Settings, Open Desk (system users), Upgrade
    plan, Log out. Phone sheet: header, Settings, Theme, Log out.
  - Mail's Admin dashboard becomes an admin-only row in Mail's sidebar.
  - Meet's in-call dialog reuses the Meet tab bodies and adds Controls.
- **Depends on:** stage 1 (phone account entry). Files Statistics shows
  totals from `GET /roots/<id>/usage` until Drive ask D10 (storage
  breakdown) ships [T015]. Upgrade plan, Open Desk and icons wait on
  ticket 021. The Files tabs that call Drive product methods wait on
  ticket 017.
- **Exit gate:** journeys open each heading's first tab on desktop and phone;
  Files Statistics shows totals only until D10 ships. The phone back
  gesture goes tab, list, closed. A misspelled tab id fails the type check
  (see Open items). No bundle for a tab body loads before its click.
  `check:bundle-budget` passes.

### Stage 5. Mail, Meet and Calendar adoption

- **Goal:** the three apps mount in the shell as they are.
- **Spec:** §9, §3.15, §2.1.
- **Files (owned):**
  - Mail: `apps/mail/` sidebar header, `SettingsModal`, app switcher use,
    `MobileTabBar` visibility.
  - Calendar: `apps/calendar/` sidebar header, `SettingsModal`,
    `CalendarTabBar`, `CalendarLayout.vue`.
  - Meet: `apps/meet/index.ts` (area definition), `apps/meet/` page
    sidebar and header menu.
  - PWA: a new platform PWA module under `frontend/src/platform/`, Mail's
    `sw.js` registration (moved out of `MailLayout.vue`), `setPwaTags`,
    `frontend/public/pwa/suite/manifest.webmanifest` (`id` only;
    `start_url` stays `/suite/start`).
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
- **Depends on:** stages 1, 3 and 4. Ticket 018 (what the rollback state
  shows) must close before the chrome deletions. The gate needs a Mail
  account (Open items).
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
  - Before flip 2, `/home`, `/files` and `/d/` answer a direct URL for
    every signed-in user [T009, T013, T014]. The rail with the flags off
    is ticket 018's.
  - The Slides service worker stops caching the shell.
- **Depends on:** stage 5. Ticket 018 (the rail and chrome with a flag off).
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
    load of each prefix. Ticket 018 sets what flag off shows.
- **Depends on:** stage 6, and the code released to production (ticket
  019).
- **Exit:** the report records the release, the date and the rehearsal
  output. Faris sets the key or names who does (ticket 019).

### Stage 8. Guest and link routes

- **Goal:** a visitor without a session opens shared items in the shell's
  guest frame.
- **Spec:** §10.
- **Files (owned):**
  - Server: the `/l/<token>` website rule and `suite/www/drive_link.py`
    (Drive program, asks D24 and D25), `suite/www/drive_link.html` (Suite
    ask S2), `suite/hooks.py` (`website_route_rules` entry).
  - Client: `shell/ShellLayout.vue` (guest frame), `shell/GuestSurface.vue`
    (becomes the guest header and the Sign-in screen), `composition/routes.ts`
    (the `/l/:token` SPA placeholder route is removed: the client guard
    does a full page load, so the server rule answers [T014, T015]; a
    `#link=` reader seeds the Drive store and strips the fragment before
    the first node request),
    `router/index.ts` (setup gate skips `allowGuest` routes for everyone),
    `apps/drive/files/` (unlock state on `401 DriveLocked`, 429 countdown
    from `Retry-After`, Star hidden and no visit for link-only access, New
    hides document kinds below EDIT), `composition/DocumentHost.vue`
    (unlock state on `/d/`).
  - Journeys: `e2e/unified-frontend/files/specs/` (guest cases).
- **Depends on:** stages 1 and 2. Drive asks D24 and D25. Suite asks S2
  and S3. Ticket 019 (where the asks land). Icons wait on ticket 021.
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
- **Depends on:** stages 1 and 2. Drive asks D17 and D19 to D22. Suite ask
  S1. Ticket 019 (where the asks land). Icons wait on ticket 021.
- **Exit gate:** journeys cover a local grant, an inherited grant with Deny,
  a password link whose expiry changes without losing the password, an
  outsider link, and Public on the web.

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
  asks D11 to D16. Ticket 019 (where the asks land). The hasher package
  (Open items). Folder upload entry points and icons wait on ticket 021.
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
    `pages/Slideshow.vue:333`, `pages/PresentationEditor.vue:201`,
    `pages/ExportView.vue` (moves into the surface).
  - Drive: `apps/drive/client/session.ts`, `apps/drive/client/nodes.ts`
    (`createDocument` without `upload()`), `apps/drive/index.ts` (legacy
    `MoveDialog`, `InfoDialog`, `InlineRenameInput` exports),
    `apps/drive/runtime.ts`.
  - Boundary check: `frontend/scripts/check-import-boundaries.mjs`.
- **Work:**
  - No file outside `apps/drive/legacy` imports it, except
    `router/index.ts` (stage 15).
  - Products name media by node id and use session media handles.
  - Sheets renders its own comments and versions panels and title bar.
  - A collaboration verdict narrows access and cancels pending writes.
  - New from template with the doctype filter; Copy opens the new node.
  - Guests see an optional "Your name" field in comment composers.
  - Writer's `/drive/login` link becomes `/login?redirect-to=` (Suite ask
    S4).
  - Product Share buttons call `session.share`.
  - `ExportView.vue` moves into the Slides surface, so `/d/` keeps the
    export. `Slideshow.vue` stays an old page for stage 15 [T015].
  - Extend `check-import-boundaries.mjs` to fail on any `suite.drive.api.`
    string outside `apps/drive/legacy`, with an exact shrinking baseline.
    It bans the names ticket 017 settles.
- **Depends on:** stage 0. Guest parts and the guest journeys wait for
  stages 2 and 8. Share wiring and the Share-button journey wait for
  stage 9. The boundary rule's name list waits on ticket 017. New from
  template entry points wait on ticket 021.
- **Exit gate:** `check:import-boundaries` shows no Writer or Slides edge
  into `apps/drive/legacy`, and the legacy-call rule runs. Document
  journeys pass for all three kinds, signed in and as a guest. Each
  product's Share button opens the stage 9 dialog. No legacy
  `suite.drive.api.*` request appears in a `/d/` journey's network log.

### Stage 12. Files flip plumbing

- **Goal:** old links reach new routes, and the server builds every node
  link in one place.
- **Spec:** §14.
- **Files (owned):**
  - Composition: a redirect table module in `suite/composition/`, its
    `before_request` entry in `suite/hooks.py`, the exported client copy,
    and one client router guard in `frontend/src/composition/`.
  - `node_url(node)`: on the Drive Python interface (the `suite.drive`
    package root), per `ARCHITECTURE.md` rules 2.1 and 2.2. It reads
    `suite_flip_files` from `frappe.conf` [T015].
  - Callers replaced by `node_url`: `suite/drive/api/notifications.py:8`,
    the grant share URL (`suite/drive/_core/access.py:1161`, Drive ask
    D17), `suite/www/drive_link.py:31`, `product.py` and OAuth `/drive`,
    `suite/drive/http/shims.py:1793` and `:2380`, the Writer wikilink, the
    Meet recording email, WebDAV HTML links, and the broken
    `/sheets?id=` link in `suite/sheets/api.py:228`.
  - Invitations: `suite/drive/doctype/drive_user_invitation/drive_user_invitation.py:91`
    and the legacy signup page.
  - Legacy-call counter: Drive program (ask D26).
  - Tests: a redirect test in `suite/composition/tests/`, journeys in
    `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Redirect rows per ticket 014 decisions 3 and 4, including
    `/drive/{folder,document,file}/<old>` and `/drive/t/<team>/...` through
    Drive's translate tables. Today these exist only as SPA routes in
    `apps/drive/legacy/routes.ts:157-185`, which stage 15 deletes. 302
    while a flag can turn off. For Sheets and Slides the client guard does
    a full page load.
  - Sheets and Slides URLs look up the content `node` field; `/drive/g/<id>`
    looks up the node kind.
  - Invitation accept creates and logs in the user, then redirects through
    `node_url`'s flag to `/home` (or `/drive/` before flip 2).
    `/drive/signup` and its page go.
  - If the Suite invitation resource is not ready by flip 2, `/drive/signup`
    stays until stage 15.
  - PWA `/suite/start` goes to `/home` when `suite_flip_files` is on.
- **Split:** the server half (table, `node_url`, callers, invitations,
  counter) runs after stage 0. The client guard runs after stage 6.
- **Depends on:** Drive asks D17 and D26. Ticket 020 (missing and wrong
  rows). Ticket 017 (which names the counter counts). Ticket 019 (where
  the asks land).
- **Exit gate:** the redirect test hits every old path in the table and
  checks the new path, with the flag on and off. No server code outside
  `node_url` builds a node path string (grep for `/drive/`, `/d/`,
  `/files/f/`). The redirect table module is excluded from the grep.

### Stage 13. Flip 2

- **Goal:** Home, Files and documents are the default.
- **Spec:** §14.
- **Files:** none. `bench set-config suite_flip_files 1` on the site.
- **Gates (ticket 014, decision 7):**
  - Browser journeys pass for Home, Files and documents.
  - The five Drive asks from ticket 006 have shipped.
  - New code makes zero legacy `suite.drive.api.*` calls (ticket 013's
    boundary check, extended in stage 11 to the names ticket 017 settles).
  - A test hits every old path in the redirect table and checks the new
    path.
  - Invitation accept lands on `/home`.
  - The `/l/<token>` server rule exists and opens a folder and a file.
  - The legacy Vitest manifest is not a gate. It shrinks by deletion.
- **Depends on:** stages 7 to 12, and the Drive Build release on production
  (ticket 019). Ticket 017 (which names read zero).
- **Exit:** the report records the release, the date, and the gate output.

### Stage 14. Hold

- **Goal:** proof that no client calls the legacy Drive API.
- **Files:** none.
- **Gate (ticket 014, decision 8):** flip 2 holds for one full release on
  production, and at least 14 days, with the legacy-call counter at zero.
- **Evidence:** the counter's bench command output at the start and end of
  the hold, by method name and user agent. A non-zero count names the
  client. Fix or retire it. The hold gate is not met until a full release
  and 14 days pass at zero. Ticket 017 decides whether the clock restarts.
- **Depends on:** stage 13 and ask D26 on production. Ticket 017 (which
  names the counter counts).

### Stage 15. Deletion commit

- **Goal:** remove the old pages in one commit.
- **Spec:** §14.
- **Files (one commit):**
  - `frontend/src/apps/drive/legacy/` and `@/apps/drive/legacy/routes` in
    `router/index.ts`.
  - The old Writer, Sheets and Slides pages. The editors stay. Candidate
    paths: `apps/writer/pages/`, `apps/sheets/pages/`,
    `apps/slides/pages/{Home,PresentationEditor,Slideshow}.vue` and their
    routes. `ExportView.vue` moved into the Slides surface in stage 11
    [T015].
  - Both flag keys and their boot and client reads.
  - `SUITE_APPS` and `utils/lastApp.ts`.
  - The legacy Drive `SettingsDialog`, its `showSettings` emitter and its
    numeric tab indexes.
  - The Drive translation wrapper and its last caller.
  - Every boundary baseline entry and legacy manifest entry that the
    deletion resolves.
- **Also in the commit:** the Slides service worker is unregistered.
  Redirects become 301.
- **Depends on:** stage 14. Ticket 017 (exempt names). Ticket 020 (legacy
  routes with no redirect row).
- **Exit gate:** `yarn build`, `test:unified`, `test:legacy`,
  `check:import-boundaries`, `check:bundle-budget` and the three journey
  projects pass. `grep -rn "suite.drive.api" frontend/src` returns only the
  names ticket 017 exempts.

## Backend asks by stage

Ids match spec §15. Status is at HEAD `f0f6a5c13`. "Map branch" means the
code landed on `forge/wayfinder-unified-frontend`, not on
`forge/drive-layer`.

No interim behavior ships before an open ask. A feature that depends on an
open ask stays disabled, with the reason in its tooltip, until the ask
ships. The stage that builds it waits on the ask. D17 is the exception:
`/drive/l/<token>` works today through `drive_link.py` [T015].

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
| D10 | Storage breakdown route | 005 | 4 (Files Statistics breakdown) | partial: `GET /roots/{root}/usage` has totals only |
| D11 | `create_upload` 409 with free title | 007 | 10 | not shipped |
| D12 | `POST /nodes` 409 with free title | 007 | 10 | partial: 409 without the title (`suite/drive/_core/nodes.py:2255-2268`) |
| D13 | HTTP replace skips the §8.5 auto version | 007 | 10 | not shipped |
| D14 | `DriveRestoreDestinationRequired` | 007 | 10 | not shipped |
| D15 | Batch purge route | 007 | 10 | not shipped |
| D16 | Empty trash per root | 007 | 10 | not shipped |
| D17 | Grant `url` is `/l/<token>` | 008 | 9, 12 | not shipped (`access.py:1161` returns `/drive/l/`, which works through `drive_link.py`) |
| D18 | `GET /links/<token>` | 008 | none | withdrawn [T011] |
| D19 | Inherited grants with source node | 008 | 9 | not shipped |
| D20 | Omitted password keeps the hash; `null` clears | 008 | 9 | not shipped |
| D21 | `send_to` on `$LINK` PUT | 008 | 9 | not shipped |
| D22 | `notify: true` sends email | 008 | 9 | not shipped |
| D23 | Spec §11.2 fix: explain object, `{ticket, expires}` | 008 | none | not done: spec line 2934 still shows an array |
| D24 | `/l/<token>` redirects by kind to `/files/f/` or `/d/` with `#link=` | 011 | 8, 13 | not shipped (`drive_link.py:31` goes to `/drive/g/`) |
| D25 | Unlock 429 with `Retry-After`; the lockout failure answers 429 | 011 | 8 | not shipped |
| D26 | Legacy-call counter by method and user agent, bench command | 014 | 12, 14 | not shipped. Ticket 017 sets which names it counts |
| D27 | Expected `modified` on PATCH answers `DriveConflict` | server-state reference | none at launch | open |
| D28 | `favourite` on the node shape | 006, through ACCOUNTING.md | none assigned; not a flip gate | not shipped |
| D29 | Type `shapes.py` outputs | server-state reference | none | met |

### Suite

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| none | Ticket 003 routes: `account`, `site`, `users`, `invitations`, Mail `inbox-summary`, Calendar `events`, Meet `rooms` and `scheduled-meetings`; dispatcher; conformance kit | 003 | done | shipped, map branch; no spec id |
| S1 | `GET /api/suite/people?q=` | 008 | 9 | not shipped |
| S2 | `drive_link.html` 404 and 410 copy, Go to Home | 011 | 8 | not shipped |
| S3 | Setup gate skips `allowGuest` routes | 011 | 8 | partial: guests pass, signed-in users do not |
| S4 | Writer `ErrorPage.vue:61` to `/login?redirect-to=` | 011 | 11 | not shipped |

### Calendar, Meet, Mail and Writer

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| C1 | Typed `conferencing` on events | 012 | done | shipped |
| C2 | Optional `account`, omitted means all | 012 | done | shipped |
| C3 | Stop faking `modified` on calendars | server-state reference | none at launch | open |
| M1 | Route and list endpoint for recordings and past meetings | MAP (010) | none at launch | open |
| L1 | Mail: return `modified`, type outputs, fix `get_threads` returning a tuple | server-state reference | none at launch | open |
| L2 | Writer: add return annotations | server-state reference | none at launch | open |

Recordings and named Meet rooms are map fog.

The Drive implementation README tracks no issue for D10 to D28. Ticket 019
decides where they land.

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
- Reconcile `forge/unified-frontend` with `upstream/develop` in stage 0,
  again before stage 5, and again before stage 7. Ticket 019 decides merge
  or rebase. Both branches were reconciled by rebase on 2026-09-17 (see
  Starting state). A later rebase of `forge/drive-layer`, followed by a
  merge into `forge/unified-frontend`, would duplicate commits.
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
  output that shows only the names ticket 017 exempts (stage 15).
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
  backend ask, not a reason for a fallback. A feature that waits on an
  open ask stays disabled, with the reason in its tooltip (Backend asks by
  stage).
- Every stage exit gate also includes `yarn test:unified`,
  `yarn test:legacy`, `yarn check:import-boundaries` and
  `yarn check:bundle-budget`, all passing.
- A new boundary violation fails. Remove each baseline entry your stage
  resolves.
- Treat the spec, the tickets, `MAP.md` and `ARCHITECTURE.md` as approved
  inputs. Change them only in a documentation-sync pass.
- Report real command output. If a check did not run, say "not verified"
  and name it.
- End every stage report with a `Not done:` line.

## Open items

Each item names its owner and the stages it blocks. Ticket 022 folds the
ticket answers into the spec and this plan.

### Owned by open tickets

- **Product methods and the zero-call gate.** Owner:
  [Product methods and the zero-call gate](tickets/017-product-methods-and-the-zero-call-gate.md).
  Which names the stage 11 boundary rule bans and the D26 counter counts.
  Whether the Files settings tabs call product methods at launch
  (`webdav_config`, `set_webdav_enabled`, `disk_settings`,
  `is_site_admin`). The Drive §11.7 against §14.10 conflict. Whether the
  hold clock restarts. Drive §11.7 keeps the 19
  `suite.drive.api.product` methods on `/api/method/`; the legacy UI calls
  17 of them (ticket 005). Blocks stages 4 (Files tabs), 11, 12, 13, 14
  and 15.
- **Flip 1 rollback.** Owner:
  [Flip 1 rollback with deleted app chrome](tickets/018-flip-1-rollback-with-deleted-app-chrome.md).
  What Mail and Calendar show with `suite_flip_shell` off after stage 5
  deletes their chrome, and what the rail shows on `/home`, `/files` and
  `/d/` while `suite_flip_files` is off. Blocks stage 5's chrome
  deletions, stage 6, and the stage 7 rollback rehearsal.
- **Branches, backend asks and release path.** Owner:
  [Branches, backend asks and the release path](tickets/019-branches-backend-asks-and-release-path.md).
  Where D10 to D28 land, and whether to port `20befde95` and `47311aa11`
  to `forge/drive-layer`. Merge or rebase from here on. How
  `forge/unified-frontend` reaches production, its order against the
  Drive Build release, who runs `bench set-config` per flip on Frappe
  Cloud, and the release note. Blocks stage 0 (branch shape), stages 8,
  9, 10 and 12 (asks), and stages 7 and 13 (release).
- **Unmapped legacy routes and `/files`.** Owner:
  [Unmapped legacy routes and the /files path](tickets/020-unmapped-legacy-routes-and-the-files-path.md).
  Routes with no redirect row or a wrong match, the trailing slug, a
  lookup that finds no node, and the clash with Frappe's public `/files/`
  path. Blocks stages 12 and 15.
- **Account menu, Files entry points and icons.** Owner:
  [Account menu, Files entry points and icons](tickets/021-account-menu-files-entry-points-and-icons.md).
  Upgrade plan visibility and the Open Desk condition block stage 4.
  Entry points for folder upload and New from template block stages 10
  and 11. The icon source (Figma set or lucide) blocks the first styling
  in stages 4, 8, 9 and 10.

### Owned by a stage or the spec

- **`DocumentSession` signatures.** Owner: stage 9 (`share`) and stage 11
  (`comments`, `versions`). Each designs its signatures under the
  `codebase-design` skill. Blocks nothing outside those stages.


### Environment approvals

- **Streaming sha256 hasher.** Ticket 007 needs a wasm hasher for resume.
  No package is chosen. Needs Faris's approval; blocks stage 10 only.
- **Type gate.** Ticket 016 wants a misspelled tab id to fail at compile
  time. The frontend has no `vue-tsc` and no typecheck script or CI step.
  Needs Faris's approval; blocks stage 4 only.
- **Mail account for journeys.** Administrator on `slides.localhost` has
  no JMAP account (ACCOUNTING.md). The Mail and Calendar journeys need
  one. Needs Faris's approval; blocks stages 5 and 7 only.

### Post-launch fog

- **WebDAV clients and redirects.** Whether WebDAV clients follow a 302 on
  `/drive/d/<id>` (spec §16). Not verified. Blocks nothing.
