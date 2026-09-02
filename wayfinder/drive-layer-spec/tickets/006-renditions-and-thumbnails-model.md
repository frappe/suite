---
id: 006
title: Renditions and thumbnails model
label: wayfinder:grilling
status: open
assignee:
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
