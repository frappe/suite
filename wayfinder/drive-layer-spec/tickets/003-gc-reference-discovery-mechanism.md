---
id: 003
title: GC reference discovery mechanism
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

Blocker framework ask. `frappe/storage/gc.py` counts only `tabFile`
references; a blob held only by a Drive Node or Drive Node Blob row is
deleted after 24 h. Decide the mechanism: meta-driven scan of all Link
fields pointing at File Blob, vs an explicit `storage_blob_references`
hook returning extra liveness queries. Consider: query cost per GC run,
behavior for large tables, and whether the mechanism also covers future
apps. The spec must state the chosen design precisely enough to implement
on the `forge/storage-v2` branch.
