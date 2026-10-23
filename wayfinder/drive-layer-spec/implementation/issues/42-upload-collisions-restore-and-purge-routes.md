# 42 — Refuse collisions with the free title, and complete restore, purge, and empty-trash over HTTP

**What to build:** Six changes the unified upload, restore, and batch flows need (unified frontend spec §6): `create_upload` and `POST /nodes` refuse a title collision with `DriveConflict` carrying the free title; a browser replace keeps no auto version; restore without a live parent chain answers `DriveRestoreDestinationRequired`; a batch purge route; an empty-trash route per root.

**Asks:** D11, D12, D13, D14, D15, D16 (unified frontend spec §15.1).

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md); [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** done (merged into `forge/drive-layer` at `116dfa952`)

**Owner:** Suite Drive node workflows and HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [007 — Upload, restore and batch outcomes](../../../unified-frontend/tickets/007-upload-restore-and-batch-outcomes.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 10 (Upload, restore and batch outcomes) waits on every ask here.

**Source:** [Drive spec](../../drive-layer-spec.md), §8.4 (upload), §8.5 (replace and the empty-head rule), §8.6 (sibling dedupe rule), §8.8 (trash, restore, purge), §9.1 (versions), §11.2 "Nodes" and "Uploads", §11.5 (batch), §11.6 (errors), §12.3 (WebDAV PUT).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] **D11.** `POST /uploads` checks `filename` against Active siblings of `parent` before `create_blob_upload` runs. On a collision it answers `DriveConflict` (409) whose envelope carries `free_title`, the title `get_new_file_name`'s rule would give (§8.6). No upload session is created. `POST /uploads/<id>/finish` keeps its own check, because the title can be taken during the upload.
- [x] **D12.** `POST /nodes` answers the same `DriveConflict` with `free_title` on a collision for every kind (`suite/drive/_core/nodes.py:2255-2268` today refuses without the title).
- [x] **D13.** A replace through `POST /uploads/<id>/finish` with `replaces`, and through `PUT /nodes/<id>/content`, writes no auto version of the old head and releases the old head's bytes. WebDAV PUT and internal Drive workflows keep the §8.5 rule. The activity row's `detail` says `{"version": null}` for a browser replace.
- [x] **D14.** `DriveRestoreDestinationRequired`, a subclass of `DriveConflict` with status 409, is raised by restore when the original parent chain is not Active and no `parent` is given (§8.8). The envelope `type` is the subclass name. `PATCH /nodes/<id>` and `POST /nodes/batch` both surface it.
- [x] **D15.** `POST /nodes/batch` accepts `{nodes, purge: true}` (or a sibling `POST /nodes/batch/purge`; pick one and record it in §11.2). Each node purges under MANAGE inside its own savepoint; the answer is the §11.5 `{ok, failed}` shape. One activity row per purged node.
- [x] **D16.** `POST /roots/<id>/trash/empty` purges every Trashed node whose `trash_root` is in that root, under MANAGE on the root node, and answers `{purged: <n>}`. A root the caller cannot manage answers 404 or 403 per §5.2.
- [x] Each new or changed route is one `Route` row in `suite/drive/http/translator.py`, one handler in `suite/drive/http/routes.py` with its verb declared, and typed shapes in `suite/drive/http/shapes.py`. Every refusal is raised by the workflow, not pre-checked in the handler.
- [x] Tests cover: upload and node collisions with the free title and a Trashed sibling that does not block; a browser replace with no version row and the freed bytes; a WebDAV PUT that still versions; restore refusal, then restore with `parent`; batch purge with one forbidden node; empty trash with nodes trashed at two different times; the verb check between the route table and the decorator.
- [x] Documentation synced in the same change: Drive spec §8.5 (the HTTP exception), §8.8 (the new error class), §11.2 (the two routes and the `free_title` field), §11.5, §11.6 (the error table); `suite/drive/CONTEXT.md` if a term is new.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes`, `test_upload`, `test_versions`, `test_webdav`, then `suite.drive.http.tests.test_http` and `test_translator`. Record real output.

## Notes

- The unified client never predicts a suffix (unified spec §6.4). Keep both offers the server's `free_title` unchanged; Rename sends a new title, which is checked again.
- Empty trash is per root because trash listing is per root (§5.6). A user with two roots empties each one on its own page.
- Quota: a browser replace releases the old head's bytes, so `used_bytes` moves by `new - old`, not by `new` alone. Recompute (§7.7) must agree.

## Completion evidence

Revision: worktree `suite-drive-42`, branch `forge/drive-42-upload-restore-purge`,
base `ec448fa23` (`forge/drive-layer`), uncommitted. Frappe: `forge/storage-v2`
at `ad5cd7f1a7`, unchanged. An agent (uf-implementer) wrote the change and ran
the checks below on 2026-09-29.

Changed behavior:

- `DriveConflict` takes `free_title=`. `_refuse_sibling_collision` computes it
  with §8.6's rule (one `_free_title` helper now serves `available_title`,
  restore dedupe, and every collision refusal). The HTTP boundary
  (`routes._refuse`) copies it into the v2 error entry. Every create kind,
  finish, rename, and move carry it.
- D11: `upload.create_upload` refuses a taken `filename` (plain read, no lock)
  after the UPLOAD and guest checks and before the quota preflight and
  `create_blob_upload`. Finish keeps its locked check. The legacy
  `upload_file` shim opens its session under `available_title`, so a legacy
  client still gets its silent suffix.
- D13: `finish_upload(replaces=...)` passes `_keep_old_head=False` to
  `nodes.update`. `_replace_file` then writes no version and `release`s the old
  head's size before `admit`. WebDAV PUT and `versions` keep the default.
- D14: `DriveRestoreDestinationRequired(DriveConflict)`, raised by `_restore`
  when the parent chain is gone and no `parent` is given.
- D15: `POST /nodes/batch/purge` `{nodes}` (a sibling route, recorded in
  §11.2). `routes._each` is the per-node savepoint loop, shared with
  `node_batch`. Session only.
- D16: `POST /roots/<id>/trash/empty` -> `nodes.empty_trash`: MANAGE on the
  root node, every trash root shallowest first, one savepoint,
  `{purged: <n nodes>}`. Session only.
- Route rows: new rows for both routes; `errors` declared on `POST /nodes`,
  `POST /uploads`, and `PATCH /nodes/<id>` (adds the subclass). Shapes
  `BatchPurge`, `Purged`. Contract regenerated
  (`frontend/src/apps/drive/client/contract.json`, `generated.ts`).
- Docs: Drive spec §8.4, §8.5, §8.6, §8.8, §9.1, §11.2, §11.5, §11.6;
  `suite/drive/CONTEXT.md` replace and usage rules. No new term.

Activity: each purged node writes one `delete` row through `_purge_locked`, as
`DELETE /nodes/<id>` does. The §8.8 cascade then removes that row with the
node, so no test can count it after the fact; the batch and empty-trash tests
assert the rows and charges that remain.

Commands (all with `flock /tmp/suite-uf-site.lock env PYTHONPATH=<worktree>
bench --site slides.localhost run-tests --module <m>`; RQ `short`/`default`/
`long` were 0 before the runs):

| Module | Result |
|---|---|
| `suite.tests.test_architecture` | Ran 7, OK |
| `suite.drive.http.tests.test_translator` | Ran 32, OK |
| `suite.drive.http.tests.test_dispatch` | Ran 178, OK |
| `suite.drive.http.tests.test_routes` | Ran 102, OK |
| `suite.drive.http.tests.test_shapes` | Ran 46, OK |
| `suite.drive.http.tests.test_shims` | Ran 267, OK |
| `suite.drive.tests.test_nodes` | unit 15 OK; integration 28, 4 errors (below) |
| `suite.drive.tests.test_upload` | unit 8 OK; integration 31 OK |
| `suite.drive.tests.test_versions` | unit 7 OK; integration 14 OK |
| `suite.drive.tests.test_webdav` | Ran 125, OK |
| `suite.drive.webdav.tests.test_put_get` (WebDAV PUT still versions) | unit 6 OK; integration 50 OK |
| `suite.composition.tests.test_contract`, `test_http` | OK |

Also run once: `test_content`, `test_blob_provenance`, `test_rename_recent`,
`test_views`, `webdav.tests.test_mkcol_delete`, `webdav.tests.test_movecopy`
all OK. Frontend, after the `replaces` ruling: `yarn generate:contract`
(6 contracts); `yarn typecheck` passed (0 errors in scope);
`yarn test:unified` 34 files, 127 passed; `yarn test:legacy` matched the
failure manifest (0 expected failures); `yarn check:import-boundaries`
passed; `yarn check:bundle-budget` 150.11 KiB of 200.00 KiB gzip.

Unresolved, not caused by this change:

- `test_nodes`: 4 errors, `DriveConflict: An active Drive root already exists
  for Shared`. `slides.localhost` holds a real Shared root `Drive` (25 nodes,
  2026-09-05). The base checkout gives the same 4 errors. Two of them are
  restore tests (`test_original_trasher_with_direct_edit_restores_in_place_without_parent_upload`,
  `test_restore_by_another_edit_actor_requires_manage`): not verified on this
  site.
- `test_quota` (not touched): 12 errors from the site's real Administrator
  Personal Root. `test_savepoint_discipline` (not touched): 1 failure naming
  `webdav/settings.py:60` and `meet/api/recording.py:1298`, files this change
  does not edit.
- Stale fixture roots from 2026-09-06 runs (`drive-lifecycle-*`,
  `drive-upload-*`, `drive-version-*`) were deleted before the runs.

Replace after a D11 collision (orchestrator ruling, 2026-09-29): `POST /uploads`
takes an optional `replaces`. The server checks EDIT on that node and that it
is an Active file below `parent`. The node's own title does not collide; a
different sibling's title still refuses with `free_title`. The session finishes
only with the same `replaces`. A finish with `parent` and `title`, or with a
different `replaces`, raises `DriveForbidden` before the finalizer runs. Tests:
`test_upload.test_a_replace_session_may_reuse_its_own_title_and_finishes_only_as_that_replace`
and `test_dispatch.test_a_replace_session_opens_under_the_title_of_the_file_it_replaces`.
Spec §8.1, §8.2 and §11.2 describe it.

Review fixes (codex review, 2026-09-29), each test-first:

- Replace preflight: `create_upload(replaces=...)` preflights
  `size - <replaced head size>`, never below 0. A full 100-byte root now
  takes a 70-byte replacement of an 80-byte file and ends at 90. Test:
  `test_upload.test_a_replace_session_preflights_only_the_growth_over_the_file_it_replaces`.
- Finish collision: a create finish locks the parent chain
  (`_lock_create_parent`, the order `create_file` uses) and checks the title
  before `finish_upload_to_blob` claims the session. The loser of a race gets
  `DriveConflict` with `free_title` and finishes the same session under it.
  Test: `test_upload.test_the_loser_of_a_title_race_keeps_its_session_and_retries_with_the_free_title`
  (two threads). Spec §8.1 and §8.4 step 6 describe it.
- Batch purge: `POST /nodes/batch/purge` purges shallowest first
  (`nodes.stored_ancestors`, stable sort) and reports a node removed by a
  selected ancestor's purge in `ok`. Test:
  `test_dispatch.test_a_batch_purge_of_a_folder_and_its_descendant_purges_both`.
  Spec §11.2 and §11.5 describe it.
- `test_nodes.test_move_and_descendant_create_serialize_without_tree_drift`
  fails 1 run in 6 with "The Drive tree changed; retry the operation", on the
  base checkout too. This change does not touch move or `create_folder`.
