# 39 — Expose Drive settings, site settings, and WebDAV access through HTTP

**What to build:** Five resource routes under `/api/suite/drive/` that carry every capability of the `suite.drive.api.product` methods that touch Drive data, so no Suite client needs a `suite.drive.api.*` dotted path at launch of the unified frontend.

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [017 — Product methods and the zero-call gate](../../../unified-frontend/tickets/017-product-methods-and-the-zero-call-gate.md). Faris: "i dont want to keep any dotted paths when suite is launched". The Files settings tabs (Statistics, External access) call these routes at launch.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.2 "Settings and WebDAV", §11.7 product table, §3.13, §3.14, §12.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] `GET` and `PATCH /settings` answer the caller's `Drive Settings` row with the §3.14 fields. `PATCH` writes `webdav_enabled` only and creates the row on first write. A guest is refused.
- [ ] `GET /site-settings` answers `{is_admin, preview_size}` for every signed-in caller and adds `webdav_enabled`, `webdav_allowed_methods`, `default_personal_quota`, `shared_quota` for a Drive admin (write on `Drive Disk Settings`). `PATCH /site-settings` writes `webdav_enabled` only and answers 403 to a non-admin.
- [ ] `GET /webdav` answers the `webdav_config` shape unchanged: `{}` when the site switch is off and the caller is no admin; `{globally_enabled, is_admin}` plus the connection fields when the switch is on. The API secret is never in the answer.
- [ ] Each route is one `Route` row in `suite/drive/http/translator.py` in §11.2 table order, one handler in `suite/drive/http/routes.py` with its verb declared, and typed shapes in `suite/drive/http/shapes.py`. The handlers call the same private functions the legacy methods call today (`suite/drive/webdav/settings.py`, the `Drive Settings` and `Drive Disk Settings` documents). No rule is copied.
- [ ] Legacy `get_settings`, `set_settings`, `is_site_admin`, `disk_settings` GET, `webdav_config`, and `set_webdav_enabled` keep answering unchanged during the Build release; `test_shims.py` still passes.
- [ ] `suite/drive/http/shims.py`'s module docstring and the `PERMANENT` class no longer claim that any name outlives Cleanup. The class means "answered by its untouched legacy body until Cleanup, no Drive route replaces it".
- [ ] Tests cover: the five routes for a plain user, a Drive admin, and a guest; the `{}` answer when WebDAV is globally off; `PATCH /settings` creating a row; a non-admin `PATCH /site-settings` refused before any write; the verb check between the route table and the decorator.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_translator`, `test_http`, and `test_shims`, then `suite.drive.webdav.tests.test_settings`. Run the architecture test. Record real output.

## Notes

- `set_settings` also accepts `single_click`; `Drive Settings` has no such field, so the write is a no-op today and is not carried.
- `disk_settings` PUT wrote `root_folder` and the S3 fields. All of them are dropped in Cleanup (§3.13), so no route carries the write path.
- `get_users`, `get_user_groups`, `get_pending_invites`, `invite_users` are served by Suite-owned routes (`suite/api/routes.py`; unified frontend spec §4.3). They are not part of this ticket.
- `get_translations`, `accept_invite`, `get_my_invites`, `reject_invite`, `signup`, `send_otp`, `verify_otp`, `oauth_providers`, `signup_disabled` have no Drive successor (§11.7). Ticket 40 deletes them.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
