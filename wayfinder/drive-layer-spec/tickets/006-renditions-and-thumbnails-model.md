---
id: 006
title: Renditions and thumbnails model
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: []
---

## Question

Decide the derived-artifact model: renditions keyed on source checksum
(duplicate uploads share thumbnails) vs per-node; which variants exist
(thumb sizes, doc exports); who generates them (Drive worker per mime vs
app exporters via ContentTypeSpec); how they serve (signed /f/ URLs);
and how they die (GC coupled to the source blob). Today: PIL/PyAV/pymupdf
generation behind a Redis lock, stored as `.thumbnail` files, plus the
framework's `make_thumbnail` which is broken for private v2 files.

Handed from [GC reference discovery mechanism](003-gc-reference-discovery-mechanism.md):
a rendition blob is live while a `Drive Node Blob` row names it. GC is
settled; decide here only when Drive deletes those rows (source blob
replaced, node trashed, node purged) and whether renditions keyed on
source checksum share one row set across nodes.

Handed from [Content app contract](005-content-app-contract.md): versions of
every content document (Writer, Slides, Sheets) become one Drive-owned table
whose bytes are blobs. Decide here how version blobs are stored beside
renditions and exports, and confirm the tiered retention policy that applies
to every app.

## Resolution

Decided with Faris, 2026-09-03. Eight decisions. An agent surveyed the
current code first (`suite/drive/utils/files.py`, `suite/drive/api/files.py`,
`suite/slides/doctype/presentation/presentation.py`,
`suite/sheets/versioning/tasks.py`, `frappe/storage/*`).

### 1. Per-node preview rows, reuse by source blob

Doctype `Drive Node Preview`: `node`, `source_blob` (the node's head blob
when rendered), `blob` (the preview bytes). One row per node. Before Drive
renders, it looks for a row with the same `source_blob`; if one exists, the
new row points at that preview blob and no render runs. Framework blobs are
content-addressed, so the bytes dedup by themselves either way. The row is
the Reference that keeps the preview blob alive (ticket 003).

Rejected: one global row per source checksum. It needs a Drive-side sweep to
find rows whose source no node or version names any more. Rejected: per-node
rows with no reuse; it repeats the render for every duplicate upload.

### 2. One derived kind: the preview image

A 512 px WebP, as today. Nothing else is stored beside a node. Exports (a
Writer doc as PDF, a sheet as XLSX) are produced by the app on request and
streamed to the requester. Folder ZIP and WebDAV ask the app for bytes then;
no export is cached. The working names `variant`, `rendition`, and
`Drive Node Blob` are retired.

### 3. Who renders

- Nodes with bytes: Drive's worker renders by mime after upload or replace.
  Image through PIL, video frame through PyAV, PDF page through pymupdf, as
  today. Unsupported mime: no row.
- Content documents: the app pushes one ready image through one Drive call,
  or declares nothing and has no preview. Slides keeps its browser capture
  and posts it through that call. Drive never renders a document.

### 4. Serving

The folder listing has already passed the permission check. For each row
with a preview it mints a short-TTL signed `/f/` URL for the preview blob
and returns it in the row. The browser fetches from `/f/` directly. No
per-tile permission request, no Python streaming. A signed URL outlives an
unshare by its TTL, the same as file downloads.

### 5. Row lifetime

- Bytes replaced: delete the row, enqueue a render (reuse applies).
- Node trashed: keep the row. The trash view shows tiles; restore is free.
- Node purged: delete the row in the same transaction as the node.

Today `delete_from_trash` leaves the `.thumbnail` object orphaned
(`suite/drive/utils/files.py:531`). That class of bug goes with the sidecar
directory.

### 6. Versions are a second table

Doctype `Drive Node Version`, with the schema fixed in ticket 005: `node`,
`seq`, `kind` (auto | named | milestone), `label`, `pinned`, `actor`,
`size`, `blob`. Immutable. It holds versions of content documents and of
file nodes alike: replacing a file node's bytes keeps the old head as an
`auto` version. Previews and versions have different shapes, lifetimes, and
queries, so they do not share a table. The framework GC is meta-driven, so
both Link columns count.

### 7. Retention

The Sheets ladder becomes the one Drive policy for every node kind
(`suite/sheets/versioning/tasks.py:23`): keep all auto versions for 24 h,
one per hour to 7 d, one per day to 30 d, one per week to 90 d, none beyond.
Named, milestone, and pinned versions stay until the node is purged. One
daily job thins `Drive Node Version`; `site_config` can override the tiers.

### 8. Gaps

Upload or replace enqueues one render job. No lock: the source blob is
immutable. A daily sweep finds active nodes with a renderable mime and no
preview row, and enqueues them. It covers failed renders and migrated nodes.
Migration creates no preview rows. Documents get no sweep; only the app
supplies their image.

### Handed off

- Slides media tiles use the same table -> Slides media to nodes (012),
  now unblocked.
- Whether preview and version bytes count against quota -> Quota policy
  (010).
- `.thumbnail` sidecars are dropped, not migrated; Slides cover File rows ->
  `Drive Node Preview`; `Writer Version` and `Sheet Snapshot` ->
  `Drive Node Version` -> Migration mapping (011).
- Exact fields, the preview-push call, the listing field name, the sweep
  query -> Draft the spec (013).
- Glossary updated: Preview added, Version widened to file nodes
  (`suite/drive/CONTEXT.md`).
