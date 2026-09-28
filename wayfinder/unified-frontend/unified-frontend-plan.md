# Unified frontend implementation plan

| | |
|---|---|
| Status | Decisions folded 2026-09-29 (tickets 017 to 021). Agents wrote it for ticket 015 and folded the decisions for ticket 022. |
| Date | 2026-09-29 |
| Spec | [`unified-frontend-spec.md`](unified-frontend-spec.md) |
| Source map | [`MAP.md`](MAP.md) and the closed tickets in [`tickets/`](tickets/) |
| Architecture | [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| Drive program | [`../drive-layer-spec/drive-layer-plan.md`](../drive-layer-spec/drive-layer-plan.md), [`implementation/README.md`](../drive-layer-spec/implementation/README.md) |
| Base prototype | [suite-shell-prototype](https://sketch.netchamp.dev/u/netchampfaris/suite-shell-prototype) |

This plan executes the spec. The spec owns behavior. Each ticket's
`## Resolution` wins over the spec where they disagree. The Drive spec wins
for Drive behavior. `ARCHITECTURE.md` rule 8 wins for module boundaries.

The plan starts from the code on `forge/drive-layer` at `a8cb8ff6e`
(2026-09-29). It does not start from zero. The code facts below were
verified at `f0f6a5c13`, the last commit before that merge; the merge added
six fixes and no new surface.

## Starting state

Verified on 2026-09-29. The 2026-09-15 documents
(`IMPLEMENTATION.md`, `HANDOFF-home-files-implementation.md`,
`ACCOUNTING.md`) describe the earlier wave. They predate tickets 007, 008,
010, 011, 014 and 016. Where they differ from the code, this section wins.

### Branches

- One development branch: `forge/drive-layer`, published on `frappe/suite`.
  Map, Drive and frontend work all land on it [T019, Faris].
- `forge/unified-frontend` was never created. `forge/wayfinder-unified-frontend`
  and `forge/wayfinder-drive-layer` are retired: `a8cb8ff6e` merged the six
  remote commits of `forge/wayfinder-unified-frontend` (tip `0018352d2`,
  Bread Genie's shell fixes, one in `suite/drive/_core/previews.py`) with no
  conflict, and `forge/drive-layer` was fast-forwarded to it and pushed
  [T019].
- The earlier wave's backend asks, `20befde95` (Drive asks for tickets 006
  and 012) and `47311aa11` (ticket 003 dispatcher and routes), are on the
  branch. No port is needed [T019].
- `upstream/develop` (`29d9f510e`, 2026-09-28) is 341 commits ahead of the
  merge base `bf6eb9c82` (2026-09-16). Since the base upstream changed 282
  files in `suite/mail`, 83 in `suite/meet`, 51 in `suite/calendar`, 258
  under `frontend/` and 3 in `suite/drive`. It did not touch `suite/hooks.py`
  or `router/index.ts`. Eight files changed on both sides [T019].
- The branch has 38 merge commits since the develop base. It was last
  rebased on 2026-09-17 (`backup/drive-layer-pre-rebase-20260917-a848d9c6d`
  exists). No rebase happens again: the branch is published and shared
  [T019].
- Production is Frappe Cloud site `frappemail.frappe.cloud`, release group
  `bench-40775` (a public bench owned by `team@erpnext.com`), suite at
  `fd3bb88f5`, an `upstream/develop` commit of 2026-09-27. Production tracks
  `develop`, so a deploy of `develop` runs on every suite site in that
  bench [T019].
- Frappe `forge/storage-v2` is 36 commits ahead of frappe `upstream/develop`
  and is published on `netchampfaris/frappe`. Drive issue 31 names it in the
  release candidate; Frappe Cloud must allowlist `storage_driver` and
  `storage_driver_config` before production migrates (Drive spec §14.1).
  The Drive program owns both, and Drive issue 36 lists both. Stage 7's
  deploy waits on both (Open items) [T019].

### Built and kept

| Area | State at HEAD | Paths |
|---|---|---|
| Platform | Eight modules plus `contracts` | `frontend/src/platform/{session,transport,server-state,realtime,translation,theme,page-meta,feedback,contracts}` |
| Composition | Area registry, routes, `DocumentHost`, document registry | `frontend/src/composition/{appRegistry.ts,routes.ts,DocumentHost.vue,documentRegistry.ts}` |
| Home | Recent, Upcoming, New, Meet control | `frontend/src/composition/home/` |
| Bell | Drive notifications with unread count | `frontend/src/composition/notifications/` |
| Drive area | Roots, saved views, cursors, server sort and group, search, selection, Move and Move to trash, `BatchOutcome`, folder picker, file preview. Built under the `/files` prefix; ticket 020 renames the prefix to `/drive` and the rail label to "Drive" (stage 6) | `frontend/src/apps/drive/files/`, `frontend/src/apps/drive/client/` |
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
  Upload, Restore and Delete forever are disabled buttons in the Drive
  area. No queue, tracker, IndexedDB record or rail ring.
  `driveUploadProgress` is absent.
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
  Drive listing column switches have no accessible name.
- **Ticket 020.** The area routes (`composition/routes.ts:50-70`), the rail
  label, the `/files` `website_route_rules` rows (`suite/hooks.py:54-55`)
  and the Vite dev bypass (`frontend/vite.config.ts:185-195`), all from
  commit `504d6ab10`, say `/files`. The legacy Drive router owns `/drive`.
- **Ticket 021.** `platform/session/index.ts` seeds `systemManager` from the
  `system_user` cookie.

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

Stage 0 adds `yarn typecheck` (`vue-tsc`) to the frontend. Until then no
frontend typecheck script exists [Faris, 2026-09-29].

## Stages

### Order and lanes

```text
0 baseline on forge/drive-layer
│
├─ shell lane   1 frame rework ─┬─ 4 settings ─┐
│               3 four fixes ───┴──────────────┴─ 5 adoption ─ 6 flip plumbing ─ 7 FLIP 1
│
├─ drive lane   2 link credentials ─(needs 1)─┬─ 8 guest and link routes
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
- Drive issues 39 and 41 to 46 run on the same branch under the Drive
  README's rules. A stage that waits on one (Backend asks by stage) starts
  its dependent work after that issue's merge.

### Shared files

One stage edits a shared file at a time. Stages edit these files in the
order shown. A later stage merges `forge/drive-layer` after the earlier
stage lands; no rebase [T019].

| File | Order |
|---|---|
| `frontend/src/platform/contracts/index.ts` | 1 |
| `frontend/src/shell/ShellLayout.vue` | 1, 5, 8 |
| `frontend/src/shell/MobileNav.vue`, `mobileNav.ts` | 1, 5, 10 |
| `frontend/src/shell/Rail.vue`, `RailItem.vue` | 6, 10 |
| `frontend/src/composition/appRegistry.ts` | 1, 5, 6, 10 |
| `frontend/src/composition/routes.ts` | 1, 5, 6, 8, 12 |
| `frontend/src/router/index.ts` | 5, 6, 8, 12 |
| `frontend/src/apps/drive/files/pages/FilesPage.vue` | 1, 6, 8, 9, 10, 11 |
| `frontend/src/apps/drive/files/pages/FilesPanel.vue` | 1, 6 |
| `frontend/src/composition/home/{HomePage,HomePanel}.vue` | 1, 6 |
| `frontend/src/composition/settings.ts` | 4, 6 |
| `frontend/src/apps/drive/index.ts` | 1, 2, 6, 9, 10, 11 |
| `frontend/src/apps/drive/client/session.ts` | 2, 9, 11 |
| `frontend/src/apps/slides/surface/SlidesSurface.vue` | 2, 11 |
| `frontend/src/apps/mail/pages/MailLayout.vue` | 3, 5 |
| `frontend/src/apps/mail/components/MailThread.vue` | 3, 4 |
| `frontend/src/apps/mail/components/AppSidebar.vue` | 5, 15 |
| `frontend/src/apps/calendar/pages/CalendarLayout.vue` | 3, 5 |
| `frontend/src/apps/calendar/components/AppSidebar.vue` | 5, 15 |
| `frontend/src/apps/meet/components/MeetSidebar.vue` | 5, 15 |
| `frontend/scripts/check-import-boundaries.mjs` | 0, 11 (legacy-call rule), then each stage removes only its own resolved baseline entries |
| `frontend/vite.config.ts` | 6 (the `/files` bypass goes) |
| `suite/www/suite.py` | 5, 6 |
| `suite/www/drive_link.py` | 8, 12 |
| `suite/hooks.py` | 6, 8, 12, 15 |
| `e2e/unified-frontend/shell/specs/` | 1, 3, 4, 5, 6, 12 (one new spec file per stage) |
| `e2e/unified-frontend/files/specs/` | 6 (paths), 8, 9, 10, 11 (one new spec file per stage) |

### Stage 0. Baseline on `forge/drive-layer`

- **Goal:** `forge/drive-layer` carries current upstream code and recorded
  green gates. No branch is cut: the development branch exists and is
  published [T019, Faris].
- **Spec:** none.
- **Files:** conflict resolutions, `.github/CODEOWNERS`
  (`/e2e/unified-frontend/home/ @netchampfaris`), `frontend/package.json`,
  a `vue-tsc` config for the new tree, and
  `.github/workflows/suite-ci.yml` (typecheck step).
- **Work:**
  - Merge `upstream/develop` into `forge/drive-layer`. Merge only, never
    rebase [T019]. Do the merge on a stage branch
    (`forge/uf-0-baseline`), then merge that branch back.
  - Conflict rule: Mail, Calendar and Meet files take develop's side. The
    eight Drive-overlap files (`suite/drive/api/files.py`, `list.py`,
    `webdav/tests/test_put_get.py`, `patches.txt`, `presentation.py`,
    `writer/api/general.py` and the two others the merge names) keep
    `forge/drive-layer`'s behavior, then re-apply upstream's intent by
    hand. The Drive spec wins for Drive behavior [T019].
  - Add `vue-tsc` as a dev dependency, a `typecheck` script in
    `frontend/package.json`, and a CI step in
    `.github/workflows/suite-ci.yml`. The check covers the new tree only:
    `platform/`, `shell/`, `composition/`, `apps/drive/files/`,
    `apps/drive/client/` and the product `surface/` folders. Legacy trees
    are excluded. If the new tree has type errors, report the count before
    fixing any [Faris, 2026-09-29].
  - Record the boundary baseline counts, the budget, and each test count.
- **Depends on:** the spec and plan are approved.
- **Exit gate:** every command in Test commands passes on the merged
  branch. The report states the new baseline counts and the merge commit.
  Faris approves the merge.

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
  - Home and the Drive area render their panels inside `<AreaSidebar>`.
  - The area's folder route with a root node id replace-redirects to the
    area root or its organization root (spec §2.2) [T001, T015]. The
    prefix is still `/files` here; stage 6 renames it to `/drive` [T020].
  - The shell bottom nav gains the account entry: avatar, then a sheet with
    account, Settings, Theme and Log out.
- **Depends on:** stage 0.
- **Exit gate:**
  - `grep -rn loadPanel frontend/src` returns nothing.
  - `shell/ContextualPanel.vue` does not exist.
  - Shell, Drive and Home journeys pass on desktop and phone widths.
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
- **Exit gate:** a journey opens Mail, then the Drive area, then Mail
  again, and checks: document `overflow` and dialog stacking are normal
  outside Mail;
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
  (`@/boot/session` reads), `platform/session/index.ts` (boot seed),
  colocated tests, `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Headings in order: Account, Drive, Mail, Calendar, Meet, Workspace
    [T016, T020].
  - Tab ids are namespaced and typed. `openSettings(tab)` takes the union.
    Replace Mail's label lookups (`MailThread.vue`, `ScreenerView.vue`) and
    Drive's numeric indexes.
  - Each product exports a lazy settings loader from its package root, the
    same shape as `loadSurface`. No subpath import [T013, T016, T015].
  - Modules load when the dialog opens. A body loads on first click behind
    a fixed-height loading state.
  - Drive tabs: Statistics and External access. No Storage tab: every
    control on it dies with Drive Build and Cleanup [T017, Drive §3.13].
    Statistics reads `GET /roots/<id>/usage`; it shows totals only until
    Drive issue 41 (D10) ships the breakdown. External access reads
    `GET /api/suite/drive/webdav` when the dialog opens, writes
    `PATCH /settings` and `PATCH /site-settings`, and mints keys through
    `suite.utils.user.generate_user_keys`, a Suite method on `/api/method/`
    outside the ban [T017, Drive §11.2]. Stage 6 adds the group's
    `suite_flip_files` condition [T018].
  - Desktop avatar menu: header, Settings, Open Desk (system managers, an
    `<a href="/app">` full page load), Upgrade plan (system managers,
    disabled with the tooltip "Not available yet" until Suite ask S5),
    Log out. Phone sheet: header, Settings, Theme, Log out [T021].
  - Session boot seeds `systemManager: false` and stops reading the
    `system_user` cookie. The account route is the only source [T021].
  - Mail's Admin dashboard becomes an admin-only row in Mail's sidebar.
  - Meet's in-call dialog reuses the Meet tab bodies and adds Controls.
  - Icons are frappe-ui's lucide set [T021].
- **Depends on:** stage 1 (phone account entry). Drive issue 39 (the
  settings, site-settings and webdav routes) for External access. Drive
  issue 41 (D10) for the Statistics breakdown; Statistics ships without
  it.
- **Exit gate:** journeys open each heading's first tab on desktop and phone;
  Drive Statistics shows totals only until Drive issue 41 ships. A plain
  user's boot shows no Workspace group and no Open Desk. The phone back
  gesture goes tab, list, closed. A misspelled tab id fails the type check
  (stage 0 adds it). No bundle for a tab body loads before its click.
  `check:bundle-budget` passes.

### Stage 5. Mail, Meet and Calendar adoption

- **Goal:** the three apps mount in the shell as they are.
- **Spec:** §9, §3.15, §2.1.
- **Files (owned):**
  - Mail: `apps/mail/components/AppSidebar.vue` (header menu),
    `SettingsModal` and `PWASettings` (deleted), app switcher use,
    `MobileTabBar` visibility.
  - Calendar: `apps/calendar/components/AppSidebar.vue` (header menu),
    `SettingsModal` (deleted), `CalendarTabBar`, `CalendarLayout.vue`.
  - Meet: `apps/meet/index.ts` (area definition),
    `apps/meet/components/MeetSidebar.vue` (header menu).
  - Boot: `suite/www/suite.py` (the `suite_flip_shell` boot value) and a
    boot flag reader under `frontend/src/platform/` [T018].
  - PWA: a new platform PWA module under `frontend/src/platform/`, Mail's
    `sw.js` registration (moved out of `MailLayout.vue`), `setPwaTags`,
    `frontend/public/pwa/suite/manifest.webmanifest` (`id` only;
    `start_url` stays `/suite/start`).
  - Shell: `ShellLayout.vue` and `MobileNav.vue` (hide the bottom nav in
    Mail and Calendar), `composition/appRegistry.ts` (Meet last),
    `composition/routes.ts`, `router/index.ts`.
  - Journeys: `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - Each app renders its Apps, Settings and Log out entries (Meet: its
    `MeetSidebar` with the Theme submenu) only on
    `route.meta.frame === 'none'`. That is the standalone chrome. Settings
    there calls `openSettings('<product>.<first tab>')`. Each app deletes
    the account row, the logo row, its `SettingsModal` and Mail's
    `PWASettings` [T018].
  - The three apps' route frame reads `suite_flip_shell` from boot. A
    release that carries this stage without stage 6 shows today's Mail
    [T018].
  - Meet becomes an area with no capability gate. `/meet` and
    `/meet/audio-test` are in the shell. `/meet/:meetingId` stays outside.
  - The platform registers the service worker after sign-in, in both flag
    states. Push handlers stay in `sw.ts`. The manifest is on every route
    [T018].
  - Mail's sign-in pages and `mime-message` stay outside the shell.
- **Sub-lanes:** Mail, Calendar and Meet run in parallel. The PWA and shell
  part runs last. All three land in one merge.
- **Depends on:** stages 1, 3 and 4. The gate needs the local Stalwart
  test accounts (Open items).
- **Exit gate:** Mail, Meet and Calendar journeys pass in the shell on
  desktop and phone with `suite_flip_shell` set on the dev site. One
  journey per app checks the standalone chrome with it off: no rail, the
  sidebar header shows Apps, Settings and Log out, Settings opens the Suite
  dialog on that product's first tab, Log out signs out [T018]. The rail is
  Home, Drive, Mail, Calendar, Meet (flag filtering comes in stage 6).
  `grep -rn useAppSwitcher frontend/src/apps` returns only the three
  standalone branches. The boundary baseline swaps each
  `SettingsModal|SuiteSettingsDialog` entry for one
  `AppSidebar|useSettingsDialog` entry; no other product import of `shell/`.

### Stage 6. Shell flip plumbing

- **Goal:** two site config keys switch the flips without a deploy, and the
  area moves to its final prefix.
- **Spec:** §14, §2.1.
- **Files (owned):** `suite/www/suite.py` (the `suite_flip_files` boot
  value), the boot flag reader from stage 5, `composition/appRegistry.ts`,
  `composition/routes.ts`, `router/index.ts`, `shell/Rail.vue` (the
  temporary Apps entry), `composition/settings.ts` (the Drive group's
  `condition`), `apps/drive/index.ts` (the area `to` and the folder path),
  `apps/drive/files/pages/{FilesPage,FilesPanel}.vue` and
  `composition/home/{HomePage,HomePanel}.vue` (the `/files` paths),
  `suite/hooks.py` (the `/files` website rule rows
  become `/drive` rows), `frontend/vite.config.ts` (the `/files` bypass
  goes), `apps/slides/SlidesShell.vue`, `apps/slides/service-worker.js`,
  `suite/www/service-worker.js`, `suite/www/service_worker.py`,
  `e2e/unified-frontend/{shell,files}/specs/` (paths).
- **Work:**
  - The server reads `suite_flip_files` and sends it in the SPA boot beside
    `suite_flip_shell` (stage 5). The client reads both from boot only.
  - `suite_flip_shell` on: Mail, Calendar and Meet routes use the shell
    frame. Off: they keep `frame: 'none'` and show their standalone chrome
    (stage 5) [T018].
  - The area prefix becomes `/drive` and the rail label "Drive": `/drive`,
    `/drive/organization`, `/drive/f/<node-id>/<slug>`, `/drive/recent`,
    `/drive/starred`, `/drive/shared-with-me`, `/drive/trash`. The `/files`
    routes never shipped, so they get no redirect rows. The Vite `/files`
    bypass and the reserved upload names go: nothing clashes with Frappe's
    `/files/` any more [T020, Faris].
  - `suite_flip_files` selects which route table mounts under `/drive`: on,
    the area routes; off, the legacy Drive routes. This amends ticket 013's
    "no route flag" for this prefix only [T020]. The `/drive/f/<id>` route
    resolves by node kind: a non-folder id replace-redirects to `/d/<id>`,
    because the old `/drive/f/<id>` meant a file [T020].
  - `suite_flip_files` off: `/` goes to `/mail` through the last-app
    fallback. On: `/` goes to `/home`.
  - The rail lists the areas whose flip is on. Before flip 1 it lists no
    area: bell, gear and avatar only. `allAreas` stays whole so
    `activeArea`, the unavailable surface and the sheet title keep working.
    The phone bottom nav reads the same list [T018].
  - Before flip 2, `/home` and `/d/` answer a direct URL for every signed-in
    user; they render in the shell frame with that rail and no active item
    [T009, T013, T014, T018]. `/drive` is the old Drive app until flip 2
    [T020].
  - While `suite_flip_shell` is on and `suite_flip_files` is off, the rail
    shows a temporary Apps entry (grid icon, below the areas) that lists
    Drive, Slides, Writer and Sheets. It hides when `suite_flip_files` is
    on and is deleted in stage 15 [T018, orchestrator, option A].
  - The Drive settings group's `condition` reads `suite_flip_files` [T018].
  - The Slides service worker stops caching the shell.
- **Depends on:** stage 5.
- **Exit gate:** a journey runs each prefix with each flag on and off,
  including `/drive` under both route tables and the folder route's kind
  check. The Slides service worker test shows no cached shell document.
  ``grep -rnE "[\"'\`]/files(/(f|organization|recent|starred|shared-with-me|trash)\b|[\"'\`])" frontend/src/composition frontend/src/apps/drive frontend/src/shell``
  returns nothing, and `suite/hooks.py` has no `/files`
  `website_route_rules` row.

### Stage 7. Flip 1

- **Goal:** Mail, Meet and Calendar in the shell on production.
- **Spec:** §14.
- **Files:** none. The site config key `suite_flip_shell` is set to `1`:
  `bench set-config` locally; Faris sets it in the site config on Frappe
  Cloud by hand [T019].
- **Gates (ticket 014, decision 7):**
  - Browser journeys pass for Mail, Meet and Calendar in the shell.
  - The four shell fixes from ticket 010 have landed.
  - The Slides service worker serves no stale shell.
  - Rollback is rehearsed once on the dev site, cold load each [T018]:
    - Flag off: `/mail`, `/calendar` and `/meet` show no rail and their own
      sidebar header with Apps, Settings and Log out; Settings opens the
      Suite dialog on that product's first tab; Log out signs out; `/home`
      and a `/d/` route show the shell with an empty rail; `/drive` shows
      the old Drive page; `/suite/start` lands on `/mail`.
    - Flag on: the three prefixes show the rail with Mail, Calendar and
      Meet; the sidebar headers have no Apps, Settings or Log out; the rail
      gear opens Settings; the avatar menu logs out; the rail shows the
      temporary Apps entry; each row opens its old page.
    - A tab open across the flip keeps its state until reload, because the
      client reads the flag from boot only.
- **Release order:** the Drive Build release and this branch reach
  `develop` in one pull request and one deploy, with both keys off. Flip 1
  waits for that deploy [T019, Faris]. The Drive Build release runbook and
  its gates stay with Drive issue 36.
- **Depends on:** stage 6, and that deploy on production.
- **Exit:** the report records the deploy id, the date and the rehearsal
  output. Faris sets the key on Frappe Cloud and records the time in the
  report. The report carries the four-line release note Faris sends: what
  moved into the shell; old links redirect and bookmarks keep working; the
  key that turns it off and who holds it; where to report a broken page
  [T019].

### Stage 8. Guest and link routes

- **Goal:** a visitor without a session opens shared items in the shell's
  guest frame.
- **Spec:** §10.
- **Files (owned):**
  - Server: the `/l/<token>` website rule and `suite/www/drive_link.py`
    (Drive issue 43, asks D24 and D25), `suite/www/drive_link.html` (Suite
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
- **Depends on:** stages 1 and 2. Drive issue 43 (D24, D25). Suite asks S2
  and S3.
- **Exit gate:**
  - `/l/<token>` opens a folder (`/drive/f/<id>`) and a file (`/d/<id>`),
    signed out and signed in. The URL keeps no token after load.
  - Unlock: 401 shows "Wrong password"; 429 disables the form and counts
    down.
  - A copied URL without the link shows the Sign-in screen and never says
    whether the item exists.
  - Dead-link page: 404 and 410 copy; "Go to Home" when signed in.
  - Guest frame on phone has no bottom nav.

### Stage 9. Sharing dialog

- **Goal:** one Drive-owned share dialog for the Drive area and every
  document.
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
- **Depends on:** stages 1 and 2. Drive issue 43 (D17) and Drive issue 44
  (D19 to D22). Suite ask S1.
- **Exit gate:** journeys cover a local grant, an inherited grant with Deny,
  a password link whose expiry changes without losing the password, an
  outsider link, and Public on the web.

### Stage 10. Upload, restore and batch outcomes

- **Goal:** uploads, restore and permanent delete work in the Drive area.
- **Spec:** §6.
- **Files (owned):** `platform/server-state/index.ts` (`upload()` start
  offset only), a new upload feature under `apps/drive/files/features/`,
  `apps/drive/index.ts` (`driveUploadProgress()`), `composition/appRegistry.ts`
  (Drive badge), `shell/Rail.vue`, `shell/RailItem.vue`, `shell/MobileNav.vue`
  (ring), `FilesPage.vue` (New menu entries, drop targets, Restore, Delete
  forever, Empty trash), the file preview header in
  `apps/drive/files/features/preview/` (Upload new version), journeys in
  `e2e/unified-frontend/files/specs/`.
- **Work:** the queue and tracker; IndexedDB record for 24 hours; resume with
  a stored handle or a re-pick check; sha256 on resume through `hash-wasm`,
  loaded only when an upload resumes [Faris, 2026-09-29]; chunks up to 16 MB, sequential per file; collision dialog; quota
  preflight; 413 banner; folder upload; drop targets; browser replace;
  restore with the same-root picker; batch purge; Empty trash; guest
  uploads through the ring slot from stage 8. Upload folder in New,
  directly after Upload files, through a hidden
  `<input type="file" webkitdirectory>`, hidden on phone; a dropped
  directory (`webkitGetAsEntry().isDirectory`) runs the folder flow into
  the drop target with the same overlay [T021].
- **Depends on:** stages 1 and 2; stage 8 for the guest ring slot. Drive
  issue 42 (D11 to D16).
- **Exit gate:** journeys cover a batch upload with a collision, a reload
  mid-upload then Resume, a folder upload started from New and one started
  from a drop, a quota refusal, a restore that needs a destination, Delete
  forever on a mixed batch, and Empty trash. The ring shows in another area
  while an upload runs.

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
    `apps/drive/runtime.ts` (`product.get_translations`),
    `apps/drive/files/features/` (the template picker), `FilesPage.vue`
    (the From template entry).
  - Desk: `suite/public/js/FileUploader.vue`, the Desk file picker shipped
    as `ff_integration.bundle.js` through `app_include_js`. Owner: the
    Drive sub-lane of this stage [T017].
  - Boundary check: `frontend/scripts/check-import-boundaries.mjs`.
- **Work:**
  - No file outside `apps/drive/legacy` imports it, except
    `router/index.ts` (stage 15).
  - Products name media by node id and use session media handles.
  - Sheets renders its own comments and versions panels and title bar.
  - A collaboration verdict narrows access and cancels pending writes.
  - New from template: **From template** is the last New entry, after
    Link. It opens one Drive-owned template picker under
    `apps/drive/files/features/`: one TabButtons per registered document
    type (label from `newLabel()`, filter from `contentDoctype`, both
    through `DOCUMENT_TYPES_KEY`), tiles from
    `GET /views/templates?content_doctype=` with the preview expansion, a
    Name field, then `POST /nodes/<template>/copy` with the open folder as
    `parent` and the name as `title`, and the new node's `/d/` route. Below
    EDIT through a link the entry hides with the document kinds. No row
    action and no Home entry [T021, T009, Drive §8.10]. Copy opens the new
    node.
  - Guests see an optional "Your name" field in comment composers.
  - Writer's `/drive/login` link becomes `/login?redirect-to=` (Suite ask
    S4).
  - Product Share buttons call `session.share`.
  - `ExportView.vue` moves into the Slides surface, so `/d/` keeps the
    export. `Slideshow.vue` stays an old page for stage 15 [T015].
  - `apps/drive/runtime.ts`, `apps/writer/runtime.ts` and
    `apps/writer/routes.ts` stop calling `product.get_translations`; the
    platform translation module reads `frappe.translate.get_boot_translations`
    (spec §3.14). Slides' `SharePopover.vue` stops reaching
    `get_file_for_doc` through `legacy/sdk.js`; it reads
    `GET /nodes/<id>?expand=access`. The Sheets and Slides `track_visit`
    calls become `POST /nodes/<id>/visit` [T017].
  - The Desk file picker moves to `GET /roots`, `GET /nodes/<id>/children`
    and the upload routes. Drive Cleanup refuses until it is gone (Drive
    issue 40) [T017].
  - Extend `check-import-boundaries.mjs` to fail on any `suite.drive.api.`
    string outside `apps/drive/legacy`, in `frontend/src` and
    `suite/public/js`. There is no allowlist: no name is permanent. There is
    one exact shrinking baseline for today's callers outside `legacy/`,
    each entry with an owner and the stage whose route replaces it: the
    three `get_translations` callers, the `sdk.js` edge, the Sheets and
    Slides `track_visit` entries, the six Writer components, and the Desk
    picker [T017, Drive §11.7].
- **Depends on:** stage 0. Guest parts and the guest journeys wait for
  stages 2 and 8. Share wiring and the Share-button journey wait for
  stage 9.
- **Exit gate:** `check:import-boundaries` shows no Writer or Slides edge
  into `apps/drive/legacy`, and the legacy-call rule runs with the baseline
  reduced to entries stages 12 and 15 own. Document journeys pass for all
  three kinds, signed in and as a guest. A journey creates a document from
  a template and lands on its `/d/` route. Each product's Share button
  opens the stage 9 dialog. No legacy `suite.drive.api.*` request appears
  in a `/d/` journey's network log. The Desk file picker uploads through
  `/api/suite/drive/uploads/` in a Desk journey or a recorded manual check.

### Stage 12. Drive flip plumbing

- **Goal:** old links reach new routes, and the server builds every node
  link in one place.
- **Spec:** §14.
- **Files (owned):**
  - Composition: a redirect table module in `suite/composition/`, its
    `before_request` entry in `suite/hooks.py`, the exported client copy,
    and one client router guard in `frontend/src/composition/`.
  - `node_url(node)`: on the Drive Python interface (the `suite.drive`
    package root), per `ARCHITECTURE.md` rules 2.1 and 2.2. It reads
    `suite_flip_files` from `frappe.conf` [T015]. Drive issue 43 builds it,
    because the `/l/<token>` redirect needs it first; this stage replaces
    the callers.
  - Callers replaced by `node_url`: `suite/drive/api/notifications.py:8`,
    the grant share URL (`suite/drive/_core/access.py:1161`, Drive issue
    43), `suite/www/drive_link.py:31` (Drive issue 43),
    `suite/drive/http/shims.py:1793` and `:2380`, the
    Writer wikilink, the Meet recording email, WebDAV HTML links, and the
    broken `/sheets?id=` link in `suite/sheets/api.py:228`.
  - Invitations: `suite/drive/doctype/drive_user_invitation/drive_user_invitation.py:91`
    and the legacy signup page.
  - Legacy-call counter: Drive issue 45 (D26).
  - Tests: a redirect test in `suite/composition/tests/`, journeys in
    `e2e/unified-frontend/shell/specs/`.
- **Work:**
  - The redirect table, one row per old path. Rules [T020]: exact rows
    match before parameter rows, and a parameter matches one segment;
    every row accepts and drops an optional trailing `/<slug>` and `/`;
    the query string passes through unchanged; a lookup that finds no node
    does not redirect, the request falls through; a redirect never
    creates a document. 302 while a flag can turn off. For Sheets and
    Slides the client guard does a full page load.
  - Rows [T014, T020, Faris]:
    - `/drive` needs no row: the prefix is the same, and the flag selects
      the route table (stage 6).
    - `/drive/inbox`, `/drive/documents`, `/drive/presentations`,
      `/drive/attachments/<doctype>?/<docname>?` to `/drive`.
    - `/drive/recents` to `/drive/recent`; `/drive/favourites` to
      `/drive/starred`; `/drive/shared` to `/drive/shared-with-me`;
      `/sheets/trash` to `/drive/trash`.
    - `/drive/d/<id>` (old folder) to `/drive/f/<id>`. Old `/drive/f/<id>`
      (a file) needs no row: the new folder route's kind check sends a
      non-folder id to `/d/<id>` (stage 6).
    - `/drive/w/<id>`, `/writer/w/<id>` to `/d/<id>`.
    - `/drive/g/<id>` by node kind (one read). Desk's File form
      (`suite/public/js/file.js:9`) opens `/drive/g/<name>`, so this row
      keeps it working; rewriting it in stage 15 is optional.
    - `/sheets/<docname>`, `/slides/presentation/<docname>`,
      `/slides/presentation/view/<docname>`, `/slides/slideshow/<docname>`
      to `/d/<node>` (one read of the doc's `node` field).
    - `/drive/{folder,document,file}/<old>`, `/drive/t/<team>/` by kind
      through `Drive Legacy Route`; `/drive/t/<team>/<letter>/<id>` as
      `/drive/g/<id>`. Today these exist only as SPA routes in
      `apps/drive/legacy/routes.ts:157-185`, which stage 15 deletes.
    - `/drive/l/<token>` to `/l/<token>`.
    - `/writer`, `/sheets`, `/sheets/new`, `/slides`,
      `/slides/presentation/new`, `/slides/not-permitted`, `/suite` to
      `/home`.
    - `/suite/start` to `/home` at flip 2 (the PWA rule below).
    - No row: `/drive/trash` (the same path in the new table),
      `/drive/signup` (deleted), `/suite/setup`, `/suite/load-error`,
      `/mail/...`, `/calendar/...`, `/meet/...`, Mail's Stalwart callbacks
      in `website_redirects`.
  - Invitations use the Suite invitation resource over the framework's
    `User Invitation`. Its accept link lands on `/suite`, which the
    redirect table sends to `/home` once `suite_flip_files` is on [T017].
    `/drive/signup` and its page go.
  - If the Suite invitation resource is not ready by flip 2, `/drive/signup`
    stays until stage 15.
  - PWA `/suite/start` goes to `/home` when `suite_flip_files` is on.
  - The counter's first read: run Drive issue 45's bench command once the
    code is on production and paste the output into the stage report.
- **Split:** the server half (table, `node_url` callers, invitations)
  runs after stage 0. The client guard runs after stage 6.
- **Depends on:** Drive issues 43 (D17, `node_url`) and 45 (D26). T020.
- **Exit gate:** the redirect test hits every old path in the table and
  checks the new path, with the flag on and off. It covers the four paths
  the earlier table matched wrongly (`/sheets/new`, `/sheets/trash`,
  `/slides/presentation/new`, `/slides/presentation/view/<docname>`), a
  slug and a query carry-through, and one no-node fall-through with the
  flag on. No server code outside `node_url` builds a node path string
  (grep for `/drive/` and `/d/`). The redirect table module is excluded
  from the grep.

### Stage 13. Flip 2

- **Goal:** Home, Drive and documents are the default.
- **Spec:** §14.
- **Files:** none. The site config key `suite_flip_files` is set to `1`:
  `bench set-config` locally; Faris sets it in the site config on Frappe
  Cloud by hand [T019].
- **Gates (ticket 014, decision 7):**
  - Browser journeys pass for Home, Drive and documents.
  - The five Drive asks from ticket 006 have shipped.
  - New code calls none of the 69 legacy `suite.drive.api.*` names,
    checked by the boundary check over `frontend/src` and
    `suite/public/js` (stage 11) [T017].
  - A test hits every old path in the redirect table and checks the new
    path.
  - Invitation accept lands on `/home`.
  - The `/l/<token>` server rule exists and opens a folder and a file
    (Drive issue 43).
  - The legacy Vitest manifest is not a gate. It shrinks by deletion.
- **Release order:** the code of stages 8 to 12 and Drive issues 39 and 41
  to 45 reach `develop` by pull request and deploy before the key is set.
  The Drive Build release shipped with stage 7's deploy [T019, Faris].
- **Depends on:** stages 7 to 12, and that deploy on production.
- **Exit:** the report records the deploy id, the date, and the gate
  output. Faris sets the key on Frappe Cloud and records the time. The
  report carries the four-line release note (stage 7) [T019].

### Stage 14. Hold

- **Goal:** proof that no client calls the legacy Drive API.
- **Files:** none.
- **Gate (ticket 014, decision 8):** flip 2 holds for one full release on
  production, and at least 14 consecutive days, with the legacy-call
  counter at zero over all 69 names. "One full release" is one Frappe
  Cloud deploy of release group `bench-40775` that contains the files-flip
  code; the hold record names the deploy id and date [T019].
- **Evidence:** Drive issue 45's bench command output at the start, once a
  week, and at the end of the hold, by method name and user agent. "Zero"
  means no count on any name rose between two reads. Faris, who sets the
  key, runs the reads [T017, T019].
- **Hold clock [T017]:** a non-zero read ends the streak and names the
  client. Fix or retire it. The 14 days start again at the next zero read.
  The release clock restarts only if the fix itself needs a release. A hit
  from a browser user agent in the first days is a stale legacy tab; it
  retires itself on reload, so wait for the next zero read.
- **Depends on:** stage 13 and Drive issue 45 on production.

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
  - Both flag keys and their boot and client reads, and the legacy route
    table under `/drive` (the flag no longer selects it).
  - `SUITE_APPS` and `utils/lastApp.ts`.
  - The standalone chrome in `apps/mail/components/AppSidebar.vue`,
    `apps/calendar/components/AppSidebar.vue` and
    `apps/meet/components/MeetSidebar.vue`, `useAppSwitcher`,
    `getAppSwitcherItems`, and the temporary rail Apps entry [T018].
  - The legacy Drive `SettingsDialog`, its `showSettings` emitter and its
    numeric tab indexes.
  - The Drive translation wrapper and its last caller.
  - The `website_route_rules` rows for `/slides`, `/slides/<path>`,
    `/sheets`, `/sheets/<path>`, `/writer` and `/writer/<path>` in
    `suite/hooks.py`, and the `/drive/l/<token>` rule (Drive issue 43 has
    shipped by then). The `/drive` and `/drive/<path>` rows stay: they
    serve the area. `/suite/<path>` stays for `/suite/setup`,
    `/suite/start` and `/suite/load-error` [T020].
  - Every boundary baseline entry and legacy manifest entry that the
    deletion resolves, including the three `SettingsModal` swaps from
    stage 5 [T018].
- **Also in the commit:** the Slides service worker is unregistered.
  Redirects become 301.
- **Depends on:** stage 14.
- **Exit gate:** `yarn build`, `test:unified`, `test:legacy`,
  `check:import-boundaries`, `check:bundle-budget` and the three journey
  projects pass. `grep -rn "suite.drive.api" frontend/src suite/public/js`
  returns nothing. A cold load of `/sheets/<unknown>` answers Frappe's 404;
  a cold load of `/drive/<unknown>` shows the area's not-found view
  [T020].

## Backend asks by stage

Ids match spec §15. Status is at `a8cb8ff6e` on `forge/drive-layer`. Every
shipped ask is on that branch; nothing needs a port [T019].

Drive asks are Drive implementation issues in
`wayfinder/drive-layer-spec/implementation/issues/`, built and merged under
the Drive README's rules on the same branch. Suite, Calendar, Meet, Mail and
Writer asks land in the stage that waits on them [T019].

No interim behavior ships before an open ask. A feature that depends on an
open ask stays disabled, with the reason in its tooltip, until the ask
ships. The stage that builds it waits on the ask. D17 is the exception:
`/drive/l/<token>` works today through `drive_link.py` [T015].

### Drive program

| Id | Ask | Source | Issue | Stage waiting | Status |
|---|---|---|---|---|---|
| D1 | `GET /roots` | 006 | none | done | shipped |
| D2 | Folders first, `group_by`, id tie-break | 006 | none | done | shipped |
| D3 | `kind=folder` in the SQL window | 006 | none | done | shipped |
| D4 | Page-batched `expand=access` | 006 | none | done | shipped |
| D5 | Batched `expand=breadcrumbs` on search | 006 | none | done | shipped |
| D6 | Folder archive routes | 006 | none | done | shipped (synchronous build) |
| D7 | Payload-free `drive:changed` | 006 | none | done | shipped |
| D8 | `opened_at` on recents | 012 | none | done | shipped |
| D9 | Notification unread-count route | 012 | none | done | shipped |
| D10 | Storage breakdown aggregates on `GET /roots/<id>/usage` | 005 | 41 | 4 (Drive Statistics breakdown) | partial: totals only |
| D11 | `create_upload` 409 with free title | 007 | 42 | 10 | not shipped |
| D12 | `POST /nodes` 409 with free title | 007 | 42 | 10 | partial: 409 without the title (`suite/drive/_core/nodes.py:2255-2268`) |
| D13 | HTTP replace skips the §8.5 auto version | 007 | 42 | 10 | not shipped |
| D14 | `DriveRestoreDestinationRequired` | 007 | 42 | 10 | not shipped |
| D15 | Batch purge route | 007 | 42 | 10 | not shipped |
| D16 | Empty trash per root | 007 | 42 | 10 | not shipped |
| D17 | Grant `url` is `/l/<token>` | 008 | 43 | 9, 12 | not shipped (`access.py:1161` returns `/drive/l/`, which works through `drive_link.py`) |
| D18 | `GET /links/<token>` | 008 | none | none | withdrawn [T011] |
| D19 | Inherited grants with source node | 008 | 44 | 9 | not shipped |
| D20 | Omitted password keeps the hash; `null` clears | 008 | 44 | 9 | not shipped |
| D21 | `send_to` on `$LINK` PUT | 008 | 44 | 9 | not shipped |
| D22 | `notify: true` sends email | 008 | 44 | 9 | not shipped |
| D23 | Spec §11.2 fix: explain object, `{ticket, expires}` | 008 | 44 | none | not done: spec §11.2 still shows an array |
| D24 | `/l/<token>` redirects by kind to `/drive/f/` or `/d/` with `#link=`; `node_url` | 011, 020 | 43 | 8, 12, 13 | not shipped (`drive_link.py:31` goes to `/drive/g/`) |
| D25 | Unlock 429 with `Retry-After`; the lockout failure answers 429 | 011 | 43 | 8 | not shipped |
| D26 | Legacy-call counter over all 69 names by name and user agent, bench command | 014, 017 | 45 | 12, 14 | not shipped |
| D27 | Expected `modified` on PATCH answers `DriveConflict` | server-state reference | 46 | none at launch | open |
| D28 | `favourite` on the node shape | 006, through ACCOUNTING.md | 46 | none; not a flip gate | not shipped |
| D29 | Type `shapes.py` outputs | server-state reference | none | none | met |
| D30 | Settings, site-settings and webdav routes (issue 39); Cleanup deletes all 69 names and the allowlist prefix (issue 40) | 017 | 39, 40 | 4 (External access, issue 39); Drive Cleanup (issue 40) | filed, ready-for-agent |

### Suite

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| none | Ticket 003 routes: `account`, `site`, `users`, `invitations`, Mail `inbox-summary`, Calendar `events`, Meet `rooms` and `scheduled-meetings`; dispatcher; conformance kit | 003 | done | shipped; no spec id |
| S1 | `GET /api/suite/people?q=` (users and groups; also carries `get_user_groups`'s job) | 008, 017 | 9 | not shipped |
| S2 | `drive_link.html` 404 and 410 copy, Go to Home | 011 | 8 | not shipped |
| S3 | Setup gate skips `allowGuest` routes | 011 | 8 | partial: guests pass, signed-in users do not |
| S4 | Writer `ErrorPage.vue:61` to `/login?redirect-to=` | 011 | 11 | not shipped |
| S5 | `GET /api/suite/site` carries `upgrade_url`, null when the site has no plan page | 021 | none: Upgrade plan stays disabled | not shipped |

### Frappe framework

| Id | Ask | Source | Stage waiting | Status |
|---|---|---|---|---|
| F1 | `StaticDataMiddleware` falls through on a miss under `/files/` instead of raising `NotFound` (`frappe/middlewares.py:39`); dev only | 020 | none | filed as [frappe/frappe#43523](https://github.com/frappe/frappe/issues/43523). Suite no longer depends on it after the `/drive` rename |

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

C3, M1, L1 and L2 have no waiting stage. They stay open in spec §15 and get
no branch until a stage needs them [T019].

## Branch rules

- Every branch on this devbox uses the `forge/` prefix.
- Never commit on `develop` or `main`. Local `main` is unused. Pull
  requests target `develop`, which production deploys [T019].
- `forge/drive-layer` is the one development branch: the sole base and the
  sole merge target for stages 0 to 15, for Drive issues, and for the map,
  tickets, spec and plan. It is published on `frappe/suite` and shared, so
  it is never rebased and never force-pushed [T019, Faris].
- Each stage gets its own branch, `forge/uf-<stage>-<slug>`, forked from
  the current tip of `forge/drive-layer`. Each stage branch gets its own
  worktree. Sub-lanes of one stage use `forge/uf-<stage>-<slug>-<part>`
  and merge into the stage branch.
- Drive issues follow the Drive README: `forge/drive-<issue>-<slug>` off
  `forge/drive-layer`, merged back into it. A stage that waits on an issue
  forks or merges after that issue's merge.
- Run `git branch --show-current` before every merge. Run the merge as a
  separate command from `git worktree add` (Drive README rule).
- Reconcile with `upstream/develop` by merge only: in stage 0, again before
  stage 5, again before stage 7, and whenever a stage needs an upstream
  change. Never rebase. Stage 0's conflict rule applies to every
  reconciliation [T019].
- Research branches are `forge/research-<name>`.
- No push, no PR and no merge into `develop` or `main` without Faris.

## Handoff to Drive Cleanup (issue 36)

Issue 36 is blocked until "the unified suite frontend effort has migrated
every Drive client off the legacy methods". Drive spec §14.10 gate 3 says
every Suite client has moved off all 69 old method names: the SPA, the Desk
file picker, and Suite Python outside `suite/drive/api` and
`suite/drive/http`. No name is exempt [T017]. Ticket 014 names the counter
as the evidence.

After stage 15 lands, this effort hands issue 36:

- The release order and deploy ids: the deploy that carried Drive Build and
  the shell code (stage 7), the deploy that carried the files-flip code
  (stage 13), and the flip dates and times Faris recorded [T019].
- The hold record: deploy id, start and end dates (at least 14 days), and
  the counter output at the start, each week and the end, by method name
  and user agent, at zero over all 69 names (stage 14).
- The deletion commit hash, and
  `grep -rn "suite.drive.api" frontend/src suite/public/js` output that
  returns nothing, the Desk file picker included (stage 15). There is no
  permanent list [T017].
- The `check:import-boundaries` output after deletion.
- The list of old URLs that still redirect forever. The
  `/drive/{folder,document,file}/<old>` and `/drive/t/<team>/...` rows read
  `Drive Legacy Route`, which Drive keeps through Cleanup (Drive §3.15), so
  they stay with the rest.

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
  not move on load, hover or state change. Icons are frappe-ui's lucide
  set on every surface; no Figma set [T021, Faris]. Icon names live in
  `apps/drive/files/internal/icons.ts` and in each
  `DocumentTypeDefinition.icon`; every other icon is a literal name.
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

Each item names its owner and the stages it blocks. Tickets 017 to 021 are
closed and folded (ticket 022); no stage waits on a ticket.

### Owned by a stage or the spec

- **`DocumentSession` signatures.** Owner: stage 9 (`share`) and stage 11
  (`comments`, `versions`). Each designs its signatures under the
  `codebase-design` skill. Blocks nothing outside those stages.

### Owned by Faris

- **Frappe Cloud `storage_driver` allowlist.** Frappe Cloud must allowlist
  `storage_driver` and `storage_driver_config` before production migrates
  (Drive spec §14.1). Faris takes it to Frappe Cloud [Faris, 2026-09-29].
  Blocks stage 7's deploy.
- **Frappe `forge/storage-v2` on `bench-40775`.** Build needs frappe
  `forge/storage-v2` on the production bench. It is not on frappe
  `upstream/develop`. Faris arranges it [Faris, 2026-09-29]. Blocks
  stage 7's deploy.

### Environment

- **Mail accounts for journeys.** Administrator on `slides.localhost` has
  no JMAP account (ACCOUNTING.md). Faris asked for a local Stalwart server
  with test accounts [Faris, 2026-09-29]. Setup is in progress. Blocks
  stages 5 and 7 only.

Faris approved `vue-tsc` (stage 0) and `hash-wasm` (stage 10) on
2026-09-29.

### Post-launch fog

- **WebDAV clients and redirects.** Whether WebDAV clients follow a 302 on
  `/drive/d/<id>` (spec §16). Not verified. Blocks nothing.
- **Cold load of a Drive route through nginx.** A cold load of
  `/drive/recent` through a real nginx and Frappe Cloud's nginx template
  was not verified under the `/files` prefix (T020 decision 9). The
  `/drive` prefix has no clash with a served path, so the risk is smaller.
  Stage 7's rehearsal on the dev site covers the bench; production is
  checked at flip 2. Blocks nothing.
