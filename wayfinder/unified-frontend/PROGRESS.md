# Unified frontend: implementation ledger

The orchestrator session updates this file after each unit lands. The plan
is [`unified-frontend-plan.md`](unified-frontend-plan.md).

## Run rules (Faris, 2026-09-29)

- Scope: stages 0 to 6 and 8 to 12, Drive issues 39, 41 to 45 and 47, and
  Suite asks S1 to S4. Then a local rehearsal of both flip states. The run
  stops before stage 7.
- Stage 0 merge needs no approval pause.
- No push during the run. Every merge is local to `forge/drive-layer`.
- Opus agents on medium effort implement. Codex `gpt-5.6-sol` reviews,
  researches and gives second opinions.
- Error tracking (Sentry) is out of this run.
- Heavy lock: typecheck, bundle budget, build and journeys run under
  `flock /tmp/suite-uf-heavy.lock` (7 GB RAM, `earlyoom`). At most two
  frontend implementers at once.
- Site lock: every `run-tests`, `migrate`, `bench execute` and browser
  journey on `slides.localhost` runs under `flock /tmp/suite-uf-site.lock`.

## Units

| Unit | Branch | Status | Merge | Notes |
|---|---|---|---|---|
| Stage 0 baseline | `forge/uf-0-baseline` | done | `06d5c0225` | upstream `a3dba155c` merged at `98a0558fb`; codex review: 3 fixes applied |
| Stage 1 frame rework | `forge/uf-1-frame-rework` | done | `b7f3b49f7` | codex review: sheet focus and phone-to-desktop close; AccountSheet named. Shell journeys 24 of 24 |
| Stage 2 link credentials | `forge/uf-2-link-credentials` | done | `ec448fa23` | codex review: 7 link-store fixes; composite reference codes are pre-existing (stage 11) |
| Stage 3 four fixes | `forge/uf-3-shell-fixes` | done | `5b6443d87` | codex review: journey asserts exact socket counts |
| Stage 4 settings | `forge/uf-4-settings` | in progress | | |
| Stage 5 adoption | | waiting on 1, 3, 4 | | |
| Stage 6 flip plumbing | | waiting on 5 | | |
| Stage 8 guest and link routes | | waiting on 1, 2, 6, Drive 43, S2, S3 | | |
| Stage 9 sharing dialog | | waiting on 8, Drive 43, 44, S1 | | |
| Stage 10 upload, restore, batch | | waiting on 8, Drive 42 | | |
| Stage 11 document surfaces | `forge/uf-11-document-surfaces` | Writer sub-lane in progress; Sheets, Slides, Drive sub-lanes waiting | | |
| Stage 12 drive flip plumbing | | waiting on 0 (client half on 6), Drive 43, 45 | | |
| Drive 39 settings and webdav routes | `forge/drive-39-settings-webdav-routes` | done | `bcb7bb1d1` | codex review: 3 fixes (int quotas, closed WebDAV shapes, insert race) |
| Drive 41 storage breakdown | | waiting on 0 | | |
| Drive 42 upload, restore, purge routes | `forge/drive-42-upload-restore-purge` | in progress | | |
| Drive 43 link routes and unlock | `forge/drive-43-link-routes-unlock` | done | `8f1bb3ff2` | codex review: Retry-After read inside the lock; route test independent of the flag |
| Drive 44 grants, passwords, share email | | waiting on 0 | | |
| Drive 45 legacy-call counter | | waiting on 0 | | |
| Drive 47 recents content doctype filter | | waiting on 0 | | |
| Suite S1 to S4 | | waiting on 0 | | |
| Flip rehearsal | | waiting on all | | |

## Open questions for Faris

1. **Cmd+K palette (stage 0).** Upstream #848 added a Cmd+K palette to the
   shell and palette entries in the Mail, Calendar and Meet sidebars.
   Ticket 012 says launch has no palette. Production already has it,
   because production tracks `develop`. Interim: the run keeps upstream's
   palette and builds nothing new on it.
2. **`auto_detect_links` (Drive 39).** Upstream #879 (`c005af4b1`) deleted
   this field from `Drive Settings`. Drive spec §3.14 and §11.2 still list
   it. Orchestrator ruling: follow upstream; `GET /settings` answers
   `{webdav_enabled, writer_settings}`. Overrule to restore the field.
   `writer_settings` is a JSON object on the new route (legacy returned
   the stored text).
3. **Link eviction and tagging (stage 2).** Orchestrator reading of ticket
   008: a 404 drops a link only when one code was sent and the 404 is on
   the link's own target; any 410 drops it. A 404 inside a shared folder
   keeps the link. Any node-returning response through one code tags its
   nodes, writes included (ticket 008 says "a read or listing"), so a
   node created through a link stays reachable.

## Needs a manual check (cannot run on this devbox)

- iOS standalone keyboard in Mail after stage 3 removed body
  `overflow:hidden` (Mail's focusout scroll reset remains).
- Mail dark mode safe-area strips on a phone.

## Old bugs found, assigned to a unit

| Bug | Found in | Assigned to |
|---|---|---|
| `shell/MobileNav.vue` passes `:to`; frappe-ui item takes `route`, so phone nav items do nothing | stage 0 | stage 1 (fixed) |
| Capability journeys assume Administrator has no mail account; the site has `administrator@suite.test` since 2026-09-18 | stage 0 | stage 1 (shell journeys), stage 5 |
| `FilePreviewSurface.vue` passes `:link`; Button takes `href`, so Download does nothing | stage 0 | stage 11 (Drive sub-lane) |
| Writer surface throws on `storage.styleClipboard` | stage 0 | stage 11 (Writer) |
| `test_shims` permanent-surface check fails on `api.product.set_settings` | stage 0 | Drive 39 (fixed) |
| Logout no longer calls `clearSlidesUserData` (merge regression) | stage 0 | stage 0 |
| Upstream `SuiteCommandPalette.vue` calls legacy `suite.drive.api.*` for search | stage 0 review | stage 11 (legacy-call baseline) |
| `/mail` stays blank and does not redirect to the inbox | stage 3 | stage 5 (Mail sub-lane) |
| Calendar opens a site socket per mount and never closes it | stage 3 | stage 5 (Calendar sub-lane) |
| `shell/SuiteLayout.vue` is mounted nowhere; its theme-cycle and Mod+Shift+Comma shortcuts are dead | stage 3 | stage 15 |
| Slides composite references are Reference Presentation row ids, not node ids, so a separately linked deck sends no code. Needs the manifest to return each reference's node id (backend ask) | stage 2 review | stage 11 (Slides) |
| `suite/calendar/http/routes.py` types `recurrence_rule` as a string, route returns an object; Home Upcoming errors for any account with events | stage 0 | stage 5 (Calendar sub-lane) |

## Baselines

Stage 0, `06d5c0225`, 2026-09-29. Gates run by the orchestrator after the
review fixes.

| Gate | Result |
|---|---|
| `yarn test:unified` | 31 files, 103 tests pass |
| `yarn test:legacy` | 2870 tests; matches the manifest (0 expected failures). One timing-sensitive Meet test (`ParticipantConnection lifecycle`) failed once under load, then passed |
| `yarn check:import-boundaries` | 376 owned graph violations, 71 unstable frappe-ui imports baselined |
| `yarn check:bundle-budget` | 146.62 KiB gzip, 28 chunks (cap 200) |
| `yarn typecheck` | 0 errors in scope (128 at start); 1111 outside scope ignored |
| Architecture test | 7 tests OK |
| Journeys (agent run) | shell 12 of 16, files 58 of 63 (2 fixme), home 9 of 10. Failures also fail on the pre-merge commit |
| Backend (agent run) | `test_http` 4, `test_contract` 2, `suite.api.test_routes` 9, `test_account` 10, drive `test_routes` 102: all OK. `test_shims` 266 of 267 (`set_settings`, pre-existing) |

Site data on `slides.localhost`:

- 2026-09-29: three empty "Untitled Sheet" rows from 2026-09-23 (Sheets
  `42lu282cdd`, `5p1q8onbjh`, `7058epn4nm`) had legacy `File` rows and no
  Drive node, so `after_migrate` refused. The orchestrator backed them up
  to `~/backups/slides-localhost/orphan-sheets-20260929.json` and deleted
  them. `migrate --skip-fixtures` then completed.
- Four documents have nodes whose `name` field differs from the document
  (Writer `qpbhfljtgt`, `u69iadktp2`; Presentation `u6cck0hr73`; Sheet
  `u6ae4ocqai`). A full Drive Build rerun would stop on them. Migrate does
  not. Left alone.
- The dev site bench (`suite-bench.service`, 8006) runs without reload.
  It serves pre-merge Python until someone restarts it. The run does not
  restart services.
