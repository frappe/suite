# 41 — Add the storage breakdown aggregates to root usage

**What to build:** `GET /roots/<id>/usage` gains the two aggregates the legacy `storage.storage_breakdown` shim computes today: bytes by file type, and the largest files. The Drive settings Statistics tab (unified frontend spec §12.2) reads one route for totals and breakdown.

**Asks:** D10 (unified frontend spec §15.1).

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** done

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [005 — Legacy Drive client inventory](../../../unified-frontend/tickets/005-legacy-drive-client-inventory.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 4 (Settings dialog and account surfaces) waits on it: Statistics shows totals only until this ships.

**Source:** [Drive spec](../../drive-layer-spec.md), §7.1 (what counts), §11.2 "Notifications, roots, admin" (`GET /roots/<id>/usage`), §11.7 (`suite.drive.api.storage`), §3.2 (`Drive Root`).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] `GET /roots/<id>/usage` accepts `?expand=breakdown`. Without it the answer is unchanged: `{used_bytes, reserved_bytes, quota_bytes, effective_quota}`.
- [x] With `expand=breakdown` the answer adds `by_type: [{type, bytes}]` and `largest: [{node, title, size, mime, kind}]`, read from Active nodes in that root only. The list is capped at a fixed count (the shim's floor rule is replaced by the cap). The same role rule as the totals applies: own root, or Suite Admin for any.
- [x] The two aggregates are computed by `roots.usage_for` or a sibling private function in `suite/drive/_core/roots.py`. The legacy shim `storage_breakdown` (`suite/drive/http/shims.py`) calls that function; it holds no second copy of the type grouping.
- [x] The type grouping is one rule shared by the route and the shim (`_file_type` today). Documents group by `content_doctype`; files by mime family; links and folders are never listed.
- [x] Typed shapes in `suite/drive/http/shapes.py`; one `Route` row change in `suite/drive/http/translator.py` if the query string needs it.
- [x] Tests cover: the route with and without the expansion for the owner, another user (404), and a Suite Admin; an empty root; the cap; and that the shim's answer equals the route's aggregates for the same root.
- [x] Documentation synced in the same change: Drive spec §11.2 (the usage row and the "Storage usage has no new route" bullet) and §11.7 (`storage_breakdown`).

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_http`, `test_translator`, `test_shims`, and `suite.drive.tests.test_quota`. Record real output.

## Notes

- Today `shims.storage_breakdown` reads `Drive Node` rows filtered by `owner = caller`, which misses files other people uploaded into the caller's root. The route reads by `root`, which is what quota charges (§7.1).
- Unified spec §16.1 item 7 records that whether the Drive area sidebar also shows the breakdown is open. This ticket serves the Settings tab only.

## Completion evidence

Branch `forge/drive-41-storage-breakdown`, based on `forge/drive-layer` at
`4d74965eb`. Uncommitted when recorded; the orchestrator commits. Revised
once after review.

Changed behavior:

- `roots.usage_for(root, principals, breakdown=False)` adds `by_type` and
  `largest` when `breakdown` is set. `_breakdown` reads Active `file` and
  `document` nodes with `size > 0` in that root: one
  `GROUP BY kind, content_doctype, mime` for the totals, one
  `ORDER BY size DESC, name LIMIT 10` for the list (`LARGEST_FILES = 10`).
  `_storage_type` is the one type rule: a document is its `content_doctype`,
  a file is `get_file_type(mime)` from the legacy mime table.
- Role rule. The totals admit the root's own user, a Suite Admin, or a
  caller with MANAGE on the root node (the Shared root names no user, so its
  manager stands in for an owner). That MANAGE clause predates this ticket
  and §11.2 does not clearly forbid it, so the totals are unchanged. The
  breakdown lists titles and follows §11.2 to the letter: own user or Suite
  Admin. A MANAGE collaborator gets `DriveForbidden` (403), the shape
  `require` gives a caller who sees the root but holds too low a role; a
  caller below READ still gets 404.
- `GET /roots/<id>/usage?expand=breakdown`. `shapes.expansions` takes an
  `allowed` tuple; the route accepts `breakdown` only. `RootUsageQuery`,
  `TypeBytes`, `LargestNode`; `RootUsage` gains two `NotRequired` lists. One
  `Route` row gains `query=`.
- Deviation: each `largest` entry also carries `type`. The shim needs it for
  `file_type`, and the client needs it for a document's icon.
- `shims.storage_breakdown` calls `usage_for(..., breakdown=True)`. Total
  rows are `{mime_type, file_size}`, the keys `StorageSettings.vue` reads;
  `mime_type` is the first non-`frappe…` mime of that type in the legacy
  table, which the tab's own table maps back to the same type (checked for
  every type in both tables), or null (shown as Unknown). Entities keep
  `name, file_name, file_size, file_type`. It lists by root, not owner, and
  the cap replaces the `limit/200` floor.
- Frontend: contract and `generated.ts` regenerated. The Statistics tab
  shows "By type" and "Largest files" in two fixed `h-80` boxes (side by
  side from `sm`, stacked on a phone). Failed, loading, loaded and empty
  share one layout; the status line under the bar carries the error. With
  usage but no active file it says "No active files. Files in the trash and
  their versions still count towards storage."

Commands and results (site `slides.localhost`, `PYTHONPATH` = the worktree):

- `run-tests --module suite.drive.tests.test_quota`: unit 15 OK; integration
  19 run, 12 errors, all `DriveConflict: An active Drive root already exists
  for Administrator` in `TestRootReservationsAndRecompute` and
  `TestSiteDefaultQuota` setUp. Site residue: Administrator's Personal root
  `4b15fe1948`, created 2026-08-16. The 7 `TestRootBreakdown` cases pass.
- `test_dispatch` 184 OK. `test_shims` 267 OK. `test_routes` 106 OK.
  `test_shapes` 47 OK. `test_translator` 32 OK.
- `python -m unittest suite.tests.test_architecture`: 7 OK.
- EXPLAIN of both queries: `key node_subtree`, `key_len 563`, `ref const`:
  the `(root, path)` index resolves `root`. Totals add
  `Using temporary; Using filesort`, the list `Using filesort`; both sort
  only that root's rows.
- Frontend, from `frontend/`: `yarn test:unified` 37 files, 138 tests
  passed. `yarn test:legacy` matched the failure manifest (0 expected).
  `yarn check:import-boundaries` passed. `yarn typecheck` 0 errors in scope.
  `yarn check:bundle-budget` 153.69 KiB of 200.00 KiB.
- Journeys: `e2e/unified-frontend/shell/specs/settings.spec.ts`, 13 passed
  with `--workers=1`, including Statistics at desktop and phone width.

Not done: the 12 `test_quota` errors need the Administrator root cleared from
the site, which this ticket did not do. A "Largest files" row does not open
the file; the spec does not say it should.
