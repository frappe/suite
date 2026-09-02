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
