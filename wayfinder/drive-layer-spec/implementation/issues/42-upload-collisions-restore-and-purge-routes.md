# 42 — Refuse collisions with the free title, and complete restore, purge, and empty-trash over HTTP

**What to build:** Six changes the unified upload, restore, and batch flows need (unified frontend spec §6): `create_upload` and `POST /nodes` refuse a title collision with `DriveConflict` carrying the free title; a browser replace keeps no auto version; restore without a live parent chain answers `DriveRestoreDestinationRequired`; a batch purge route; an empty-trash route per root.

**Asks:** D11, D12, D13, D14, D15, D16 (unified frontend spec §15.1).

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md); [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive node workflows and HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [007 — Upload, restore and batch outcomes](../../../unified-frontend/tickets/007-upload-restore-and-batch-outcomes.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 10 (Upload, restore and batch outcomes) waits on every ask here.

**Source:** [Drive spec](../../drive-layer-spec.md), §8.4 (upload), §8.5 (replace and the empty-head rule), §8.6 (sibling dedupe rule), §8.8 (trash, restore, purge), §9.1 (versions), §11.2 "Nodes" and "Uploads", §11.5 (batch), §11.6 (errors), §12.3 (WebDAV PUT).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] **D11.** `POST /uploads` checks `filename` against Active siblings of `parent` before `create_blob_upload` runs. On a collision it answers `DriveConflict` (409) whose envelope carries `free_title`, the title `get_new_file_name`'s rule would give (§8.6). No upload session is created. `POST /uploads/<id>/finish` keeps its own check, because the title can be taken during the upload.
- [ ] **D12.** `POST /nodes` answers the same `DriveConflict` with `free_title` on a collision for every kind (`suite/drive/_core/nodes.py:2255-2268` today refuses without the title).
- [ ] **D13.** A replace through `POST /uploads/<id>/finish` with `replaces`, and through `PUT /nodes/<id>/content`, writes no auto version of the old head and releases the old head's bytes. WebDAV PUT and internal Drive workflows keep the §8.5 rule. The activity row's `detail` says `{"version": null}` for a browser replace.
- [ ] **D14.** `DriveRestoreDestinationRequired`, a subclass of `DriveConflict` with status 409, is raised by restore when the original parent chain is not Active and no `parent` is given (§8.8). The envelope `type` is the subclass name. `PATCH /nodes/<id>` and `POST /nodes/batch` both surface it.
- [ ] **D15.** `POST /nodes/batch` accepts `{nodes, purge: true}` (or a sibling `POST /nodes/batch/purge`; pick one and record it in §11.2). Each node purges under MANAGE inside its own savepoint; the answer is the §11.5 `{ok, failed}` shape. One activity row per purged node.
- [ ] **D16.** `POST /roots/<id>/trash/empty` purges every Trashed node whose `trash_root` is in that root, under MANAGE on the root node, and answers `{purged: <n>}`. A root the caller cannot manage answers 404 or 403 per §5.2.
- [ ] Each new or changed route is one `Route` row in `suite/drive/http/translator.py`, one handler in `suite/drive/http/routes.py` with its verb declared, and typed shapes in `suite/drive/http/shapes.py`. Every refusal is raised by the workflow, not pre-checked in the handler.
- [ ] Tests cover: upload and node collisions with the free title and a Trashed sibling that does not block; a browser replace with no version row and the freed bytes; a WebDAV PUT that still versions; restore refusal, then restore with `parent`; batch purge with one forbidden node; empty trash with nodes trashed at two different times; the verb check between the route table and the decorator.
- [ ] Documentation synced in the same change: Drive spec §8.5 (the HTTP exception), §8.8 (the new error class), §11.2 (the two routes and the `free_title` field), §11.5, §11.6 (the error table); `suite/drive/CONTEXT.md` if a term is new.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes`, `test_upload`, `test_versions`, `test_webdav`, then `suite.drive.http.tests.test_http` and `test_translator`. Record real output.

## Notes

- The unified client never predicts a suffix (unified spec §6.4). Keep both offers the server's `free_title` unchanged; Rename sends a new title, which is checked again.
- Empty trash is per root because trash listing is per root (§5.6). A user with two roots empties each one on its own page.
- Quota: a browser replace releases the old head's bytes, so `used_bytes` moves by `new - old`, not by `new` alone. Recompute (§7.7) must agree.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
