# 41 — Add the storage breakdown aggregates to root usage

**What to build:** `GET /roots/<id>/usage` gains the two aggregates the legacy `storage.storage_breakdown` shim computes today: bytes by file type, and the largest files. The Drive settings Statistics tab (unified frontend spec §12.2) reads one route for totals and breakdown.

**Asks:** D10 (unified frontend spec §15.1).

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [005 — Legacy Drive client inventory](../../../unified-frontend/tickets/005-legacy-drive-client-inventory.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 4 (Settings dialog and account surfaces) waits on it: Statistics shows totals only until this ships.

**Source:** [Drive spec](../../drive-layer-spec.md), §7.1 (what counts), §11.2 "Notifications, roots, admin" (`GET /roots/<id>/usage`), §11.7 (`suite.drive.api.storage`), §3.2 (`Drive Root`).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] `GET /roots/<id>/usage` accepts `?expand=breakdown`. Without it the answer is unchanged: `{used_bytes, reserved_bytes, quota_bytes, effective_quota}`.
- [ ] With `expand=breakdown` the answer adds `by_type: [{type, bytes}]` and `largest: [{node, title, size, mime, kind}]`, read from Active nodes in that root only. The list is capped at a fixed count (the shim's floor rule is replaced by the cap). The same role rule as the totals applies: own root, or Suite Admin for any.
- [ ] The two aggregates are computed by `roots.usage_for` or a sibling private function in `suite/drive/_core/roots.py`. The legacy shim `storage_breakdown` (`suite/drive/http/shims.py`) calls that function; it holds no second copy of the type grouping.
- [ ] The type grouping is one rule shared by the route and the shim (`_file_type` today). Documents group by `content_doctype`; files by mime family; links and folders are never listed.
- [ ] Typed shapes in `suite/drive/http/shapes.py`; one `Route` row change in `suite/drive/http/translator.py` if the query string needs it.
- [ ] Tests cover: the route with and without the expansion for the owner, another user (404), and a Suite Admin; an empty root; the cap; and that the shim's answer equals the route's aggregates for the same root.
- [ ] Documentation synced in the same change: Drive spec §11.2 (the usage row and the "Storage usage has no new route" bullet) and §11.7 (`storage_breakdown`).

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_http`, `test_translator`, `test_shims`, and `suite.drive.tests.test_quota`. Record real output.

## Notes

- Today `shims.storage_breakdown` reads `Drive Node` rows filtered by `owner = caller`, which misses files other people uploaded into the caller's root. The route reads by `root`, which is what quota charges (§7.1).
- Unified spec §16 item 16 records that whether the Drive panel also shows the breakdown is open. This ticket serves the Settings tab only.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
