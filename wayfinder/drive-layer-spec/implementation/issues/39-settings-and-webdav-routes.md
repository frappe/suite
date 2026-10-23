# 39 — Expose Drive settings, site settings, and WebDAV access through HTTP

**What to build:** Five resource routes under `/api/suite/drive/` that carry every capability of the `suite.drive.api.product` methods that touch Drive data, so no Suite client needs a `suite.drive.api.*` dotted path at launch of the unified frontend.

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** done

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [017 — Product methods and the zero-call gate](../../../unified-frontend/tickets/017-product-methods-and-the-zero-call-gate.md). Faris: "i dont want to keep any dotted paths when suite is launched". The Drive settings tabs (Statistics, External access) call these routes at launch.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.2 "Settings and WebDAV", §11.7 product table, §3.13, §3.14, §12.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] `GET` and `PATCH /settings` answer the caller's `Drive Settings` row with the §3.14 fields. `PATCH` writes `webdav_enabled` only and creates the row on first write. A guest is refused. Note: `auto_detect_links` is not answered. Upstream `c005af4b1` (#879) removed the field; the orchestrator ruled on 2026-09-29 to follow #879.
- [x] `GET /site-settings` answers `{is_admin, preview_size}` for every signed-in caller and adds `webdav_enabled`, `webdav_allowed_methods`, `default_personal_quota`, `shared_quota` for a Drive admin (write on `Drive Disk Settings`). `PATCH /site-settings` writes `webdav_enabled` only and answers 403 to a non-admin.
- [x] `GET /webdav` answers the `webdav_config` shape unchanged: `{}` when the site switch is off and the caller is no admin; `{globally_enabled, is_admin}` plus the connection fields when the switch is on. The API secret is never in the answer.
- [x] Each route is one `Route` row in `suite/drive/http/translator.py` in §11.2 table order, one handler in `suite/drive/http/routes.py` with its verb declared, and typed shapes in `suite/drive/http/shapes.py`. The handlers call the same private functions the legacy methods call today (`suite/drive/webdav/settings.py`, the `Drive Settings` and `Drive Disk Settings` documents). No rule is copied.
- [x] Legacy `get_settings`, `set_settings`, `is_site_admin`, `disk_settings` GET, `webdav_config`, and `set_webdav_enabled` keep answering unchanged during the Build release; `test_shims.py` still passes.
- [x] `suite/drive/http/shims.py`'s module docstring and the `PERMANENT` class no longer claim that any name outlives Cleanup. The class means "answered by its untouched legacy body until Cleanup, no Drive route replaces it".
- [x] Tests cover: the five routes for a plain user, a Drive admin, and a guest; the `{}` answer when WebDAV is globally off; `PATCH /settings` creating a row; a non-admin `PATCH /site-settings` refused before any write; the verb check between the route table and the decorator.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_translator`, `test_http`, and `test_shims`, then `suite.drive.webdav.tests.test_settings`. Run the architecture test. Record real output.

## Notes

- `set_settings` also accepts `single_click`; `Drive Settings` has no such field, so the write is a no-op today and is not carried.
- `disk_settings` PUT wrote `root_folder` and the S3 fields. All of them are dropped in Cleanup (§3.13), so no route carries the write path.
- `get_users`, `get_user_groups`, `get_pending_invites`, `invite_users` are served by Suite-owned routes (`suite/api/routes.py`; unified frontend spec §4.3). They are not part of this ticket.
- `get_translations`, `accept_invite`, `get_my_invites`, `reject_invite`, `signup`, `send_otp`, `verify_otp`, `oauth_providers`, `signup_disabled` have no Drive successor (§11.7). Ticket 40 deletes them.

## Completion evidence

Worktree `suite-drive-39`, branch `forge/drive-39-settings-webdav-routes`,
based on `forge/drive-layer` at `f2a7184f7`. Uncommitted; the orchestrator
commits. Agents wrote the code and ran the checks below on 2026-09-29.

### Changed behavior

- Five rows appended to `ROUTES` in `suite/drive/http/translator.py`, in §11.2
  order: `GET` and `PATCH /settings`, `GET` and `PATCH /site-settings`,
  `GET /webdav`. Handlers `settings_get`, `settings_patch`,
  `site_settings_get`, `site_settings_patch`, `webdav_get` in
  `suite/drive/http/routes.py`. No handler admits a guest.
- Shapes in `suite/drive/http/shapes.py`: `UserSettings`, `WebdavSwitch`
  (both PATCH bodies), `SiteSettings`, `AdminSiteSettings`, `WebdavHidden`,
  `WebdavOff`, `WebdavConnection`.
- The rules live in `suite/drive/webdav/settings.py`, beside
  `global_webdav_enabled` and `user_webdav_enabled`: `is_drive_admin`,
  `user_settings`, `set_user_webdav_enabled`, `site_settings`,
  `set_global_webdav_enabled`, `webdav_access`. A non-admin
  `PATCH /site-settings` raises `DriveForbidden` (403) before any write.
- `api/product.py`: the non-whitelisted helper `is_drive_site_admin` now
  calls `is_drive_admin`, so the admin rule has one spelling. No whitelisted
  body changed.
- `shims.py`: the module docstring and the `PERMANENT` constant now say the
  class means "answered by its untouched legacy body until Cleanup". No name
  outlives Cleanup; `/dav` is the only permanent address.
- `test_shims.py`: `set_settings` is compared with its structure at upstream
  `c005af4b1` (#879), which removed the `auto_detect_links` write. Every
  other permanent name is still compared with `e390a4487`. This clears the
  one failure the suite had before this ticket.
- Contract regenerated: `frontend/src/apps/drive/client/contract.json` and
  `generated.ts` gain the five operations. No other owner's contract changed.

### Deviations, ruled by the orchestrator on 2026-09-29

- `GET /settings` answers `{webdav_enabled, writer_settings}`, without
  `auto_detect_links`. Upstream `c005af4b1` (#879, "remove passive clipboard
  link detection") deleted that field from `Drive Settings`. The spec edit
  `448b4856c` still lists it in §3.14 and §11.2. Ruling: follow #879.
- `writer_settings` is answered as the JSON object it holds, not as the
  stored text the legacy `get_settings` answered. Ruling: accepted.

### Review fixes (codex review, 2026-09-29)

- `site_settings` casts `preview_size`, `default_personal_quota`, and
  `shared_quota` with `cint`. A Single loads a `Long Int` back as a string,
  so the admin answer carried `"5368709120"` where the contract says integer.
  New case `test_every_numeric_site_setting_is_a_json_integer` failed first
  (`<class 'str'> is not <class 'int'>`), then passed.
- `WebdavHidden` and `WebdavOff` are closed with pydantic
  `with_config(extra="forbid")`; `WebdavConnection` inherits it. The exported
  schema carries `additionalProperties: false`, and the generated `{}` answer
  is `Record<string, never>`, not an open object. New vitest
  `frontend/src/apps/drive/client/settings.test.ts` checks that
  `api.webdav_get.validateOutput` refuses each answer with an added
  `api_secret`. It failed first, then passed after regeneration.
- `set_user_webdav_enabled` runs the first insert in a savepoint. When a
  concurrent first write already made the row, `DuplicateEntryError` rolls
  the savepoint back and the call updates the row. New case
  `test_a_first_write_that_loses_the_race_becomes_an_update` in
  `suite.drive.webdav.tests.test_settings` failed first (MySQL 1062
  duplicate entry), then passed.

### Commands and results

All with `env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree>`,
under `flock /tmp/suite-uf-site.lock`, on `slides.localhost`.

| Command | Before | After |
|---|---|---|
| `run-tests --module suite.drive.http.tests.test_translator` | 32, OK | 32, OK (5 rows added to the table case and the guest columns) |
| `run-tests --module suite.drive.http.tests.test_dispatch` | 156, OK | 169, OK |
| `run-tests --module suite.drive.http.tests.test_shims` | 267, FAILED (failures=1: `set_settings` shape) | 267, OK |
| `run-tests --module suite.drive.webdav.tests.test_settings` | 9, OK | 10, OK |
| `run-tests --module suite.tests.test_architecture` | not run | 7, OK |
| `run-tests --module suite.composition.tests.test_http` | not run | 2 unit + 2 integration, OK |
| `run-tests --module suite.composition.tests.test_contract` | not run | 2, OK |
| `run-tests --module suite.drive.http.tests.test_routes` / `test_shapes` | not run | 102, OK / 46, OK |
| `run-tests --module suite.drive.tests.test_sync_permissions` | not run | 5, OK |
| `bench execute suite.composition.contract.write_all` | | wrote into the worktree; only the Drive contract changed |
| `yarn generate:contract` | | Generated 6 contracts |
| `yarn typecheck` | | 0 errors in scope |
| `yarn test:unified` | | 32 files, 105 tests passed |
| `yarn check:import-boundaries` | | passed |
| `yarn test:legacy` | | matched the failure manifest (0 expected failures) |
| `yarn check:bundle-budget` | | 148.12 KiB of 200 KiB |

`test_dispatch` adds `TestSettingsRoutes` (13 cases, including the integer check above): a guest refused on all
five routes with no write; field defaults with no row; the first `PATCH`
creating the row; a missing body field is 400; a plain user and an admin on
`/site-settings`; a non-admin `PATCH /site-settings` refused with the switch
unchanged; an admin turning the switch on and off; `/webdav` answering `{}`,
the admin switch shape, and the connection without the API secret; an admin
on their own `/settings`. The test `test_translator` checks the verb on each
row against the decorator.

A mutation check removed the three admin gates in `webdav/settings.py`.
Three `TestSettingsRoutes` cases failed. The file was restored.

### Not done

- The legacy `webdav_config` and `set_webdav_enabled` bodies still hold
  their own copy of the logic `webdav_access` and `set_global_webdav_enabled`
  now hold. Their bodies must stay untouched until Cleanup deletes
  `api/product.py` (ticket 40).
