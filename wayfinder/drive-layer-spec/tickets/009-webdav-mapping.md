---
id: 009
title: WebDAV mapping
label: wayfinder:grilling
status: open
assignee:
blocked-by: [002]
---

## Question

Map WebDAV onto the new engine: PROPFIND to the folder-page queries, GET
to node-authorized signed URLs or streams, PUT to upload sessions, MOVE to
the single path-rewrite UPDATE, locks stay in Drive DAV Lock/Property.
Decide the role required per DAV method and the behavior for doc-backed
nodes (export? 404? empty?). The engine prototype came from
`suite/drive/webdav/perms.py`; the spec should absorb it, not special-case
it. Blocked by Role ladder semantics.
