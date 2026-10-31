---
id: 003
title: GC reference discovery mechanism
label: wayfinder:grilling
status: closed
assignee: faris
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

## Resolution

Decided with Faris, 2026-09-03. Six decisions.

### Mechanism: meta-driven, no hook

GC discovers reference columns from meta at run time. It calls
`frappe.model.rename_doc.get_link_fields("File Blob")`, the same
discovery that rename and delete already trust. That query returns
standard DocFields, Custom Fields, and Property Setter overrides, skips
virtual doctypes, and flags Single doctypes. Nothing is registered. An
app that adds a Link field with `options: File Blob` is covered on its
next GC run. Rejected: a `storage_blob_references` hook (the map forbids
new framework hooks, and a hook is one more thing an app can forget) and
a hybrid (two mechanisms for one question).

### Reference rule

A blob is live while any Link field with `options: File Blob` names it.
Nothing else keeps a blob alive: not a Data column, not a Dynamic Link,
not a blob name inside JSON. An app that holds a blob any other way must
also write a Link row. That is what `Drive Node Blob` is for. Rejected:
scanning Dynamic Link columns (rarely indexed, and suite has none).

### Query shape

One candidate query, one `NOT EXISTS` per discovered column:

```sql
select b.name, b.key, b.driver, b.is_private
from `tabFile Blob` b
where b.modified < %(cutoff)s
  and not exists (select 1 from `tabFile` where blob = b.name)
  and not exists (select 1 from `tabDrive Node` where blob = b.name)
  and not exists (select 1 from `tabDrive Node Blob` where blob = b.name)
  and not exists (select 1 from `tabSingles`
                  where doctype = 'X' and field = 'y' and value = b.name)
limit %(batch)s
```

- Normal and child doctypes: `NOT EXISTS` on their own table.
- Single doctypes: `NOT EXISTS` on `tabSingles` filtered by doctype and
  field.
- Virtual doctypes: skipped (no table).
- `is_still_orphan` applies the same predicate to one name under the row
  lock. One function builds the predicate for both callers.

Rejected: Python set difference (reads every referencing table in full
per batch), and a LEFT JOIN per column (row-multiplies when one blob has
many rows in one table).

### Unindexed reference column: include, warn

Every discovered column is always in the predicate. A column without an
index makes the run slow, never wrong. GC logs one warning per unindexed
column per run. Rejected: aborting the sweep (one forgotten index on any
app stops cleanup site-wide).

### Discovery failure: delete nothing

If the meta query fails, or a discovered doctype has no table
(`TableMissingError`, an app installed but not migrated), the run logs an
error and returns with `blobs_deleted = 0`. Upload-session expiry still
runs. A blob kept one more day costs disk. A blob deleted under an
incomplete reference set costs data.

### Public helper

`frappe.storage.gc.blob_reference_columns() -> list[dict]` returns the
discovered set as `{"doctype", "fieldname", "issingle"}`. Public function,
not a hook. Drive's tests assert that `Drive Node.blob` and
`Drive Node Blob.blob` appear in it.

### Framework ask, as the spec will state it

Branch `forge/storage-v2`, `frappe/storage/gc.py`:

1. Add `blob_reference_columns()` (above).
2. Add `orphan_predicate(blob_alias)` that builds the `NOT EXISTS` chain
   from it; use it in `get_orphan_blobs` and `is_still_orphan`.
3. Wrap discovery and the first candidate query in the delete-nothing
   guard. Warn per unindexed column (check `frappe.db.has_index` or the
   DocField `search_index` flag; the spec accepts either).
4. Tests: a blob held only by a non-File Link survives GC; a blob held
   only by a Single survives; a Custom Field Link counts; a missing table
   makes the run delete nothing; the unindexed warning fires.

### Drive-side obligations

- `Drive Node.blob` and `Drive Node Blob.blob` are `Link` to `File Blob`
  with `search_index: 1`.
- Drive deletes no bytes. Deleting a node or a `Drive Node Blob` row is
  how Drive drops a reference; the framework GC does the rest after 24 h.
- Cost per GC run on a suite site: three indexed probes per candidate
  blob (File, Drive Node, Drive Node Blob) plus one per future column.
  Bounded by the 500-row batch; no full scan of any referencing table.

### Handed on

- [Renditions and thumbnails model](006-renditions-and-thumbnails-model.md):
  "how renditions die" is now fixed at the framework edge. A thumbnail
  blob lives while its `Drive Node Blob` row exists. Coupling a rendition
  to its source is a Drive rule (delete the rows when the source blob
  changes), not a GC feature.
