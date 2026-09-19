---
id: 007
title: Upload, restore and batch outcomes
label: wayfinder:grilling
status: closed
assignee: faris (opus, 2026-09-16)
blocked-by: [006]
---

## Question

Specify the three flows ticket 32 named as frontend dependencies.

- Upload client: create and replace flows through
  `/api/suite/drive/uploads/` (spec §8.4, §13.7), preflight of declared size
  against quota (§7.3), chunking, progress, cancel, and the distinct failure
  states: validation, access, conflict, quota. The empty-head rule on replace
  (§8.5). Drag-and-drop targets in list and grid.
- Restore destination picker: when the original parent chain is not Active
  the user picks an eligible same-root destination and submits parent plus
  Active state (§8.8). Cancel leaves the item trashed. Access changes before
  submit show an explicit error.
- Batch outcomes: how the UI shows mixed ok/failed results from the batch
  route (§11.5) for trash, restore, move and delete, and what is retried.

Decide what the upload client is: the existing Dropzone-based uploader
rewritten, or a platform-level uploader other areas (Mail attachments, Meet
recordings) can reuse later.

Inputs: Drive spec §7.3, §8.4, §8.5, §8.8, §11.5, §13.7; ticket 32
acceptance criteria; `frontend/src/apps/drive/components/FileUploader*`.

Handed from [Legacy Drive client inventory](005-legacy-drive-client-inventory.md)
(2026-09-11): folder download has no REST route (archive build, status and
stream are retained legacy bodies). The old uploader probes
`does_entity_exist` and `get_new_title` synchronously; the new flow gets a
409 collision from `POST /nodes` instead. Only `list-add` has a socket
emitter, from the legacy upload shim.
## Resolution

Resolved with the user on 2026-09-19. Facts were checked against
`forge/wayfinder-unified-frontend` and frappe `forge/storage-v2`.

### Upload ownership

- Drive owns the upload queue, the tracker and all upload state under
  `frontend/src/apps/drive/`. The platform keeps its existing
  `upload()` primitive in `platform/server-state` (create, chunk, finish,
  progress, cancel). No other product needs a browser upload queue:
  - Mail posts whole files to its own endpoint and makes Frappe `File`
    rows; message bytes live on Stalwart over JMAP.
  - Meet recordings arrive from the recorder callback, not the browser.
  - Slides images and the workspace logo use frappe-ui `<FileUploader>`.
- Platform change: `upload()` accepts a start offset, so a resumed upload
  does not begin at byte 0.
- Chunks inside one file are sequential. `_write_upload_chunk` refuses an
  offset above `received`. Parallelism is across files only. Chunk size is
  at most `MAX_CHUNK_BYTES` (16 MB); the legacy client's 20 MB is too big.

### Upload lifetime and resume

- An upload lives for the tab and survives folder and area changes.
- Uploads resume after a reload. Per upload, the client stores
  `{upload_id, parent, name, size, lastModified, bytesSent, handle?}` in
  IndexedDB for 24 hours. That matches `BINDING_TTL_SECONDS` and
  `expire_stale_upload_sessions`.
- On mount, interrupted uploads show in the tracker with Resume.
  - With a stored `FileSystemFileHandle` (Chromium): request permission,
    read the file, continue.
  - Without one: Resume opens the native picker. The client accepts the
    file only when name, size and `lastModified` match the record.
    Otherwise it starts a new upload and leaves the old session alone.
- Resume sends the next chunk at `bytesSent` and trusts the `received`
  value in the reply. A zero-byte chunk at offset 0 is a status probe.
- A resumed upload sends a sha256 `checksum` at finish. A continuous
  upload does not. Web Crypto has no streaming digest, so this needs a
  streaming (wasm) hasher.
- A checksum mismatch destroys the session: `claim_session` runs before
  the check. The client-side match is what protects the user's progress.

### Upload progress in the rail

- The Files rail item shows one ring for the whole queue, weighted by
  bytes, in every area while uploads run. In Files, the tracker panel
  shows as well. Clicking the ring opens `/files` with the tracker open.
- States: uploading (determinate ring), paused or retrying (amber), all
  done (ring completes, fades after about 3 s), some failed or
  interrupted after reload (red dot until the user opens the tracker).
- The mobile bottom-nav Files item shows the same indicator.
- Drive exports `driveUploadProgress()` through `apps/drive/index.ts`.
  Composition maps it to the Files badge beside the Mail badge in
  `appRegistry.ts`, and `Rail.vue` renders it through the `RailItem`
  `#badge` slot. `AreaDefinition` does not change. The tracker component
  does not cross the seam. `ProgressRing` comes from frappe-ui.

### Collisions

- The server catches a title collision in `create_upload`, before any
  bytes move, and returns `DriveConflict` (409) with the free title the
  server would use. Today the collision fires in `create_file` after
  `finish_upload_to_blob` has consumed the session, so the whole upload
  is lost.
- The dialog offers Replace, Keep both (saved under the server's free
  title), Rename (re-checked) and Skip, with "Apply to all" for a batch.
  The client never predicts a suffix.

### Quota

- Before a batch starts, the client sums declared sizes and reads
  `GET /roots/<id>/usage`. If the batch does not fit, it says so and
  offers Upload what fits or Cancel. This check is advisory;
  `create_upload` stays the gate.
- On a 413 mid-batch, the queue stops starting uploads, shows one banner
  and offers Retry all.

### Folder upload

- Folder upload ships. The client creates folder nodes top-down with
  `POST /nodes`, then uploads the files into them.
- Only the top folder can collide. The choices are Keep both (server's
  free title) or Skip. There is no merge, so a new top folder has no
  inner conflicts.

### Drop targets

- Drops work only in a root or folder where the caller has UPLOAD.
  Saved views and search refuse them.
- The pane drops into the open folder. A folder row or tile with UPLOAD
  retargets the drop into that folder. The overlay names the target and
  does not move the layout.
- Dragging existing rows to move them is not part of this ticket.

### Replace

- "Upload new version" is a header action on the file preview page. The
  confirm reads: "This replaces report.pdf. The current file is not kept."
- A browser replace keeps no old version. The WebDAV PUT keeps the §8.5
  auto version, because it is the only undo for editor saves over WebDAV.
- There is no versions panel for plain files. Choosing to keep a version
  on replace is a later feature.

### Restore

- The client restores with `{state: Active}` first. When the original
  parent chain is not Active, the server returns the new subtype
  `DriveRestoreDestinationRequired` (409). Today every restore refusal is a
  plain `DriveConflict`, and `original_available` is never sent.
- In a batch, the items that need a destination are collected. One
  prompt ("8 items' folders are gone") opens the Drive folder picker
  limited to the same root and to folders with UPLOAD. A second batch
  sends `{state: Active, parent}` for those items only.
- Cancel leaves them in Trash. Access changes before submit come back as
  per-item failures in the batch outcome.

### Delete forever and Empty trash

- Bulk Delete forever uses a new batch purge route with the §11.5
  `{ok, failed}` shape. Purge needs MANAGE.
- Trash gets Empty trash in its header, per root, through a new route
  such as `POST /roots/<id>/trash/empty`. It needs MANAGE on the root.
  The confirm reads: "Delete everything in Trash forever?"

### Batch outcomes and retry

- `BatchOutcome.vue` from ticket 006 shows results for trash, restore,
  move and delete forever.
- The outcome has no Retry button. Failed rows stay selected, so running
  the action again is the retry. Most per-item types (`DriveForbidden`,
  `DriveConflict`, `DriveNotFound`) would fail again.
- A whole-request failure (network, 5xx, deadlock) applies nothing and
  shows a platform toast with Retry.
- In the upload tracker, a failed file has Retry, which resumes from
  `received`, plus Retry all.

### Drive backend asks

1. `create_upload` checks the title and returns 409 with the free title.
2. `POST /nodes` 409 carries the free title, for folder Keep both.
3. A browser (HTTP) replace skips the §8.5 auto version and its charge.
   WebDAV keeps the rule.
4. `DriveRestoreDestinationRequired`, a `DriveConflict` subtype.
5. A batch purge route with the §11.5 result shape.
6. An Empty trash route per root.

### Handed on

- [Guest and link routes](011-guest-and-link-routes.md): uploads through
  a link credential (`create_upload` already accepts a bound link).
- Not yet specified: where the quota and storage breakdown surface lives.

### Findings for other programs

Checked while settling ownership. They are out of scope for this map.

- Mail attachment bytes live on Stalwart (JMAP `Blob/upload`, Mail
  Cluster Store backend). Incoming attachments make no `File` row;
  `Mail Message Part` is virtual. Stalwart store types include S3 but no
  HTTP backend, so Suite cannot put `File Blob` behind it. Counting mail
  against quota means reading per-account usage from Stalwart (JMAP quota
  support not verified), not a reservation.
- The Mail composer's `File` row (`suite/mail/api/mail.py:1582`) is never
  deleted after send (`mail_queue.py:762-767`), so each sent attachment is
  stored twice.
- Meet recordings become legacy `File` rows through `FileManager`
  (`suite/meet/recording/ingest.py:208-227`), not `File Blob` or Drive
  Nodes. The reservation is released at a terminal state
  (`meet_recording.py:268-282`), so under §7.1 a finished recording charges
  nothing. Not checked: whether the Build migration turns these rows into
  nodes.
