# 46 — Carry `favourite` on the node shape and accept an expected `modified` on PATCH

**What to build:** Two node-shape extras the unified frontend's server-state layer and Drive listing want: a `favourite` flag on every node-valued response, and an optimistic-concurrency check on `PATCH /nodes/<id>` that answers `DriveConflict` when the caller's expected `modified` is stale.

**Asks:** D27, D28 (unified frontend spec §15.1).

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers. No unified plan stage or flip gate waits on this ticket.

**Raised by:** unified frontend ticket [006 — Files area listing and navigation](../../../unified-frontend/tickets/006-files-area-listing-and-navigation.md) through [`ACCOUNTING.md`](../../../unified-frontend/ACCOUNTING.md) (D28), and the server-state reference (`wayfinder/unified-frontend/references/`) (D27). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan: no stage waits; "none at launch".

**Source:** [Drive spec](../../drive-layer-spec.md), §3.10 (`Drive Favourite`), §8.11 (`content_modified` against `modified`), §9.5, §11.2 "Nodes" (PATCH), §11.3 (the node shape and its expansions), §11.6. Unified frontend spec §3.9, §5.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] **D28.** `favourite: true | false` is on the node shape for a signed-in caller on every node-valued detail, children page, and view, resolved with one `Drive Favourite` query per page (the `access` expansion's batching pattern). A guest gets `false`. `PUT` and `DELETE /nodes/<id>/favourite` return the node shape with the new value, or keep `{}` and the client re-reads; pick one and record it in §11.2.
- [ ] **D27.** `PATCH /nodes/<id>` accepts `if_modified: <stamp>`. When it is given and differs from the node's stored `modified`, the workflow answers `DriveConflict` (409) with the current node shape in the envelope's `data`, before any write. Omitted means no check. `POST /nodes/batch` accepts the same field in `patch`.
- [ ] The check compares the framework row time `modified`, not `content_modified` (§8.11).
- [ ] Typed shapes in `suite/drive/http/shapes.py`; the `patch` allow-list gains `if_modified`.
- [ ] Tests cover: `favourite` on a detail, a children page, a view, and for a guest; a stale `if_modified` on rename and on move refusing with no write and the fresh shape in the answer; a matching stamp succeeding; the batch case.
- [ ] Documentation synced in the same change: Drive spec §11.2 (PATCH body, favourite routes), §11.3 (the shape), §11.6 if the conflict row needs a line.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_http`, `test_translator`, and `suite.drive.tests.test_activity`. Record real output.

## Notes

- Unified spec §5.11: the Drive listing shows a star per row today by joining the favourites view on the client. One flag per row removes that join.
- The server-state reference wants a conflict answer so the client can show "changed elsewhere" and re-read. Pending writes are cancelled by the client, not by Drive.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
