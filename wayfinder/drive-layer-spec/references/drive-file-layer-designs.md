# Drive file layer: three design approaches

Greenfield redesign of Drive as the file, permission, and sharing layer of
Frappe Suite. No backwards compatibility. Three subagents produced the
designs, each under a different constraint. This spec condenses them.

Status: decided on 2026-09-02. See "Decision" at the end. The three designs
below are kept for the record; none of them won as written. The decision is
backed by a MariaDB benchmark (250k nodes, 30k grants, on this bench) and a
13-scenario red-team, both run by subagents.

Architecture synchronization, 2026-09-05: this is a historical decision
record, not the implementation module map. The accepted repository structure
is [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md), and the executable
design is [`../drive-layer-spec.md`](../drive-layer-spec.md). Current product
code imports `from suite import drive`; `suite.drive._core` stays private.

## Context

What exists today (suite app, vendored Drive):

- The framework `File` doctype doubles as the Drive node via 5 custom fields.
  A 651-line override disables parts of core `File`.
- Node kinds (file, folder, link, doc-backed, attachment-ref) are told apart
  by field shape. A `FORBIDDEN_DOWNLOAD_TYPES` list is copied into 5 call
  sites.
- `Drive Permission` rows are resolved by recursive upward folder traversal
  in Python (~314 lines). List queries cannot express inherited or public
  grants, so list views under-report.
- Sheets does not use Drive permissions at all. It uses DocShare. A Sheet
  shared in Drive grants nothing on the `Sheet` doctype, and vice versa.
- ~2,500 lines of storage plumbing (backend abstraction, chunked upload,
  serving, thumbnails, trash-on-disk, quota).

Decisions taken as given:

- Bytes go only through storage_v2 blobs (`put_blob`, drivers, `/f/` egress,
  daily GC). No disk paths in app code.
- Live editor content (Writer Yjs blob, Slides JSON, Sheets workbook) stays
  in the editor doctype. Immutable artifacts (versions, snapshots, exports,
  thumbnails) become blobs.
- Per-user roots. No team doctype.

Hot paths with hard budgets:

1. List a folder with permissions: one SQL query, no per-row Python.
2. Serve bytes: permission check without loading N documents.
3. Editor autosave check: fires every 2-5 s per active editor.

## Shared ground

All three designs converged on these points. Treat them as settled.

- **Ordered role integer** replaces the five permission flags.
  `READ=10, COMMENT=20, UPLOAD=30, EDIT=40, MANAGE=50`. Higher includes
  lower. One integer comparison in SQL. The share dialog becomes a picker,
  not a checkbox matrix.
- **A kind registry** replaces `FORBIDDEN_DOWNLOAD_TYPES`. Each kind answers
  `content_source()`: a file returns its blob, a doc returns its export (or
  None), a folder returns None. Download, ZIP, WebDAV, and previews all ask
  the registry. A Writer doc inside a folder ZIP becomes its PDF export.
- **A content app integrates with ~15 declarative lines**: hooks that point
  at generic Drive targets, plus one link field on its doctype. Sheets drops
  DocShare and joins the same engine.
- **Drive contains zero blob-deletion code.** Bytes die only through the
  framework GC after references drop.
- **Egress is authorized by node, not by blob.** Under dedup, one blob can
  back nodes with different sharing.

---

## Design A: flatten at write time, stay on File

Constraint: optimize for the most common callers (editors, Drive UI).

Core idea: keep the framework `File` doctype as the node. Keep grants in
`Drive Grant`. A write-time flattener materializes every grant into a
`Drive Access` table, one row per (descendant, grant). Every hot path
becomes one indexed lookup. The sharer pays; the reader never does.

### Doctypes

| Doctype | Purpose | Key fields |
|---|---|---|
| File (framework) | the node | `kind` (file/folder/link/doc), `content_doctype/docname`, `status`, `trashed_root`, `no_inherit` |
| Drive Grant | source of truth, share dialog edits this | node, principal, level, expires_on, password_hash |
| Drive Access | engine-owned, flattened | node, principal, level, `source` (the grant), expires_on |
| Drive Node Blob | versions, snapshots, exports, thumbnails | node, slot, blob, seq |

Principals: email, `$GROUP:<name>`, `$SITE` (logged-in), `$LINK` (anyone
with the link). Groups stay unexpanded in Access rows: a folder of 10k
nodes shared with a 50-member group costs 10k rows, not 500k.

No deny bit. Removing access is deleting a grant. Carve-outs use a
`no_inherit` folder flag (an inheritance barrier).

### Interface

```python
# Historical Design A surface. `design_a` is pseudocode, not suite.drive.

# read side: one indexed query each
design_a.check(node, EDIT)              # bool

# write side: the flattener runs here
design_a.grant(node, "alice@x.com", EDIT)
design_a.grant(node, "$LINK", READ, expires_on=..., password="...")
design_a.revoke(node, "alice@x.com")

# nodes
design_a.create_folder(parent, "Reports")
design_a.update(node, parent=new_parent)
design_a.update(node, state="Trashed")

# bytes
design_a.get_content(node)             # check + signed URL or stream
```

This sample describes Design A's shape. The accepted narrow package-root
interface does not export its low-level grant, folder, or update operations;
Drive-owned HTTP and WebDAV adapters call those private workflows.

### Flattening rules

- `share(F, p, level)`: recursive CTE enumerates descendants, stops below
  `no_inherit` nodes, inserts one Access row each with `source = grant`.
- `unshare`: `DELETE FROM tabDrive Access WHERE source = %s`. One statement.
- `move`: delete Access rows sourced outside the subtree, re-propagate the
  new ancestor chain's grants into it.
- Subtrees over 500 nodes propagate in a background job; the API returns a
  `propagating` flag.
- A recursive resolver exists only as a test oracle. A nightly job diffs it
  against the table and alerts on drift.

### Hot path SQL

Folder listing, one query, EXISTS probe is index-only on
(node, principal, level):

```sql
SELECT f.name, f.file_name, f.kind, f.mime_type, f.file_size
FROM `tabFile` f
WHERE f.folder = %(folder)s AND f.status = 'Active'
  AND (f.owner = %(user)s
       OR EXISTS (SELECT 1 FROM `tabDrive Access` a
                  WHERE a.node = f.name
                    AND a.principal IN %(principals)s
                    AND a.level >= 10
                    AND (a.expires_on IS NULL OR a.expires_on > NOW())))
ORDER BY f.file_name LIMIT 60;
```

Autosave check: owner short-circuit in Python, then the same EXISTS with
`level >= 40` on `doc.drive_node`. One SELECT.

### New content app (Whiteboard)

```python
# whiteboard/hooks.py
has_permission = {"Whiteboard": "suite.drive.framework.doc_has_permission"}
permission_query_conditions = {
    "Whiteboard": "suite.drive.framework.doc_query_conditions"
}
drive_node_kinds = [{
    "kind": "whiteboard", "doctype": "Whiteboard",
    "open_route": "/whiteboard/{content_docname}",
    "exporter": "whiteboard.api.export_png",
}]
```

Plus one hidden `drive_node` Link field on the doctype. Autosave, sharing,
and list views then work with zero Drive code.

### Trade-offs

- (+) All three hot paths are index-only probes. List views and per-doc
  checks come from the same table, so they cannot disagree.
- (+) `source` on every Access row: any grant is auditable and reversible
  with one DELETE.
- (+) Free egress, uploads, and attachment unification from staying on File.
- (-) Write amplification: share/move/trash write O(subtree) rows.
- (-) No per-user deny. "Everyone except Bob" is not expressible.
- (-) File's schema stays a negotiation with the framework.

---

## Design B: ports and adapters, resolve at read time

Constraint: maximize flexibility. Every cross-seam dependency is an
interface with named adapters, each marked real or hypothetical.

Core idea: a new `Drive Node` doctype; framework `File` returns to plain
attachments. Ancestry is a closure table. Grants are never flattened:
checks resolve at read time with a nearest-wins rule and per-right deny.
A Redis cache keyed on a per-root generation counter absorbs hot reads.

### Doctypes

| Doctype | Purpose | Key fields |
|---|---|---|
| Drive Node | the node | title, kind, parent_node, root, blob, ref_doctype/docname, status, props JSON |
| Drive Ancestry | closure table, engine-owned | node, ancestor, depth (0 = self) |
| Drive Grant | grants, with deny | node, principal, read/comment/upload/write/share checks, deny, expires_at |
| Drive Root | per-user root, quota, acl_generation | kind (Personal / future Team), quota_bytes |
| Drive Share Link | link tokens | node, token_hash, rights, expires_at |
| Drive Version / Drive Rendition | artifact blobs | node, blob, label / source_checksum, variant |

Principals are typed and pluggable through a `PrincipalProvider` port:
`u:alice@x.com`, `g:staff`, `l:<link>`, `site`, `all`. Adding org units
later changes no caller.

### Interface (the ports)

```python
# Access port: five signatures hide the whole engine
access.check(node, "write")                    # cached; one query cold
access.grant(node, "g:design", {"read": 1, "comment": 1})
access.grant(node, "u:bob@x.com", {"read": 1}, deny=True)   # nearest-wins deny
access.explain(node, "u:bob@x.com")            # ordered deciding rows, for debugging
access.read_predicate("n", principals)         # the one SQL fragment builder

# Content port: a spec object, not hook spaghetti
SPEC = ContentTypeSpec(
    doctype="Whiteboard",
    mime="application/vnd.suite.whiteboard",
    title_field="title",
    exporters={"png": "whiteboard.export.to_png"},
    include_in_zip="png",
)
# hooks.py: drive_content_types = ["whiteboard.drive.SPEC"] + 3 generic hook lines

# Kind port
class NodeKind(ABC):
    has_bytes: bool
    def content_source(self, node) -> BlobRef | None: ...
    def on_purge(self, node): ...    # doc kind deletes its ref doc here

# Events port: post-commit observers (activity, notifications, renditions)
drive_node_observers = ["suite.drive.activity.on_event"]
```

### Resolution: nearest wins

For one right, the deciding row is the grant on the nearest ancestor
(minimum depth), tie-broken by principal specificity (user beats link
beats group beats site beats all). `deny=1` decides no; no row decides no.

```sql
SELECT g.deny
FROM `tabDrive Ancestry` a
JOIN `tabDrive Grant` g ON g.node = a.ancestor
WHERE a.node = %(node)s
  AND g.principal IN %(principals)s
  AND g.`read` = 1
ORDER BY a.depth ASC, <specificity CASE> ASC
LIMIT 1;
```

Trash writes one row: `Trashed` on the top node only. Every list query
pays a `NOT EXISTS` trashed-ancestor probe instead.

### Framework asks (both small)

1. Split `serve.py` into authorize + respond; export
   `respond_with_blob(blob, filename)`. Drive's `/d/<node>/<name>` route
   authorizes by node, then reuses X-Accel, Range, ETag, S3 302.
2. An `upload_finishers` hook so `finish_upload` can create a Drive Node
   instead of a framework File row.

### Trade-offs

- (+) Cleanest separation: the framework File is untouched; the 651-line
  override, `ignore_file_permissions`, and the MRO splice all disappear.
- (+) Deny and principal pluggability, honestly priced. Trash is O(1).
- (+) `explain()` keeps permission debugging local.
- (-) The list predicate is a correlated `ORDER BY ... LIMIT 1` subquery
  per row, plus a trash NOT EXISTS. Unverified on the MariaDB planner.
  The Redis epoch cache exists to compensate; invalidation is coarse.
- (-) `move` rewrites the closure table, O(subtree x depth).
- (-) Most machinery of the three designs.

---

## Design C: minimal interface

Constraint: minimize the interface. Three modules, ten entry points, six
doctypes.

Core idea: new `Drive Node` with a materialized `path` column. `Drive
Access` stores the fully resolved role per (node, principal). One
`update()` call is the whole node lifecycle, in the style of Google Drive
`files.update`. `role_of()` returns one integer from one point read.

### Doctypes

| Doctype | Purpose | Key fields |
|---|---|---|
| Drive Node | the node | 16-char hash name (doubles as link token), title, parent, `path` (`/a1/b2/c3/`, depth cap 40), kind, blob, url, content ref, state (Pending/Active/Trashed), trashed_at, trash_root |
| Drive Share | source of truth | node, principal, role int, deny (blackout) |
| Drive Access | resolved closure, engine-owned | node, principal, tier, role |
| Drive Node Blob | versions, thumbnails, export caches | node, blob, purpose, label |
| Drive Node Event | activity + recents, one table | node, action, actor, detail JSON |
| Drive Label | favourites and tags | node, user, label (`fav` reserved) |

Deleted outright: Drive Permission, Drive Favourite, Drive Entity Log,
Drive Entity Activity Log, Drive Notification, Drive Storage Reservation,
Drive Settings.

### Interface: ten entry points

```python
# drive.node: 4
create(parent=..., title=..., kind="file", stream=..., upload_id=...)
update(node, title=...)                 # rename
update(node, parent=...)                # move
update(node, state="trashed")           # trash; "active" restores; "purged" is terminal
update(node, stream=buf)                # replace bytes: new blob, old head kept as Version
update(node, stream=buf, variant="thumbnail")
open(node)                              # BlobRef: .stream(), .url() -> signed /f/
open(node, variant="export:pdf")
browse("folder", folder=f)              # also "shared", "recents", "favourites", "trash", "search"

# drive.access: 3
share(node, "alice@x.com", Role.EDITOR)  # role=None unshares; unknown email -> invite
role_of(node)                            # one point read -> int
role_of(("Whiteboard", name))            # doc-addressed, for autosave hooks
readable_sql(user, min_role=Role.READER, alias="dn")   # the ONE place list SQL lives

# drive.content: 3
drive_content = {"Whiteboard": {...}}    # hook registration
class Whiteboard(DriveContent, Document): pass   # mixin does lifecycle sync both ways
node_of("Whiteboard", name)
```

Attachment references are not a special kind: Drive registers `"File"` in
its own content registry with an exporter that streams the blob.

### Hot path SQL

`browse("folder")` is one statement and returns the caller's role per row,
so the UI gets its button states free:

```sql
SELECT * FROM (
  SELECT dn.name, dn.title, dn.kind, dn.mime, dn.size,
         CASE WHEN dn.owner = %(user)s THEN 50
              ELSE COALESCE((
                SELECT a.role FROM `tabDrive Access` a
                WHERE a.node = dn.name AND a.principal IN %(principals)s
                ORDER BY a.tier ASC LIMIT 1), 0)
         END AS my_role
  FROM `tabDrive Node` dn
  WHERE dn.parent = %(folder)s AND dn.state = 'Active'
) t
WHERE t.my_role >= 10
ORDER BY t.title LIMIT 60;
```

Trash stamps the subtree with one `UPDATE ... WHERE path LIKE '/a/b/%'`.
Restore uses `trashed_at` as an anchor so an inner folder trashed earlier
stays in the trash.

### Framework asks

1. A blob-permission hook on `/f/` (or Drive 302s to signed URLs).
2. `complete_upload_session(upload_id) -> FileBlob`, so finishing an upload
   does not force a framework File row.
3. GC counts any Link field to File Blob (meta-driven), not only File rows.

### Trade-offs

- (+) Smallest surface to learn, test, and keep coherent. Ten entry points
  serve the UI, WebDAV, ZIP, and every editor.
- (+) `update()` gives WebDAV MOVE, the UI, and content sync one tested
  path.
- (-) Same write amplification as Design A, plus recompute on move.
- (-) `path` column caps depth at 40 and costs O(subtree) rewrites on move.
- (-) Deny is a per-principal blackout, coarser than B's per-right deny.

---

## Comparison

| | A: flatten, stay on File | B: ports, read-time | C: minimal |
|---|---|---|---|
| Node | framework File + fields | new Drive Node + closure table | new Drive Node + path column |
| Permission cost | write time (flatten) | read time (+ cache) | write time (resolve fully) |
| Deny | none (`no_inherit` barrier) | per-right, nearest-wins | per-principal blackout |
| List query | EXISTS probe, index-only | correlated ORDER BY LIMIT 1 + trash NOT EXISTS | scalar subquery, tier LIMIT 1 |
| Trash | stamp subtree | one row + read-time probe | stamp subtree via path |
| Move cost | re-flatten subtree | rewrite closure rows | rewrite paths + access |
| Framework changes | ~none | serve split + upload finisher | 3 small hooks |
| Main risk | write amplification | MariaDB planner on the predicate | expressiveness ceiling |

An earlier draft recommended a write-time hybrid here (flattened Drive
Access on C's skeleton). The benchmark and the red-team overturned it.

---

# Decision (2026-09-02): resolve from grants directly, batched

Two constraints from Faris shaped the final call:

1. **No custom fields on the framework File doctype.** The node is a new
   `Drive Node` doctype. This removed Design A's node model.
2. **No new framework hooks** (no `before_upload`, no `upload_finishers`).
   Drive owns its endpoints and preflights itself, then calls public
   framework functions. A Suite driver subclass (registered through the
   existing `storage_drivers` hook) is the seam for storage policy only
   (key layout, bucket rules). It is the wrong seam for quota:
   `driver.write` runs after the whole upload arrived, and direct-to-S3
   bytes can skip it.

## The engine

No `Drive Access` table. No `Drive Ancestry` closure table. `Drive Grant`
is the only permission table: source of truth AND read path. Ancestors
come from the node's `path` column, parsed in Python (depth cap 40). The
prototype already ships: `suite/drive/webdav/perms.py` does exactly this
for PROPFIND, batched, correct.

```python
def effective_role(node_path: str, principals: list[str]) -> int:
    ancestors = parse_ids(node_path)          # <= 40 ids, zero queries
    rows = frappe.db.sql("""
        SELECT node, principal, role FROM `tabDrive Grant`
        WHERE node IN %(ancestors)s AND principal IN %(principals)s
          AND (expires_on IS NULL OR expires_on > NOW())""", ...)
    # nearest wins: minimum depth, then principal specificity.
    # role = 0 is a stored value and means deny.
    return compose_nearest_wins(rows, ancestors, principals)
```

- **Deny returns as `role = 0`**, nearest-wins. Dropping deny was never a
  simplification: shipped code already inserts deny rows for "make this
  one file private inside a shared folder"
  (`suite/drive/overrides/file.py:246-287`). "Everyone except Bob" is one
  row: `share(folder, bob, Role.NONE)`.
- **Links are per-token principals**: `$LINK:<token>`, with
  `password_hash` and `expires_on` on the grant. A flat `$LINK` principal
  is a cross-link authorization bypass (any unlocked link matches every
  link-shared node on the site), on the read path and the collab write
  path. Both original designs had half of this fix; take both halves.
- Folder page = 3 cheap queries: child ids, grants on the parent chain,
  grants on the 60 child ids. Move = one `UPDATE ... WHERE path LIKE`.
  Trash = one subtree stamp. Grant and revoke = one row each.
- Unbounded views: shared-with-me renders grant roots directly (one
  covering-index scan). Tree-wide search fetches matches first, then one
  grant query over the ancestor-id union of the page.
- `explain(node, principal)` is trivial: the grant rows ARE the
  explanation, ordered by depth and specificity.
- Everything else from the designs carries over unchanged: ordered roles,
  the kind registry, `ContentTypeSpec` + mixin, Drive Node Blob for
  immutable artifacts, node-addressed egress via signed `/f/` URLs.

## Why: the benchmark

MariaDB 10.11.14 on this bench. 250k nodes, 30k grants, test principals
with 47% visibility (a regime that flatters the flattened model).
Flattened table: 843,752 rows, 233 MB. Closure: 1.31M rows, 102 MB. Path
model: the 7 MB grant table only.

| Operation | Flattened (A/C) | Closure (B) | Path model |
|---|---|---|---|
| 10k-folder page of 60 | 27.7 / 45.7 ms | 121.0 ms | **11.7 ms** |
| ...permission share of that | ~16 / ~34 ms | ~110 ms | **0.4 ms** |
| Point check (autosave) | 0.084 ms | 0.140 ms | 0.112 ms |
| Shared-with-me | 176-194 ms (full scan) | 96 ms | **8.5 ms** (roots) |
| Tree-wide search (643 hits) | 64.7 ms | 72.4 ms | 64.6 ms |
| Move 1k-node subtree | 193 ms | 17.6 ms | **9.5 ms** |
| Grant on a 10k subtree | 118 ms (10k rows) | 0.17 ms | **0.17 ms** |
| Revoke | 67 ms | 0.14 ms | **0.14 ms** |

Reading: 11.3 ms of every big-folder page is the `ORDER BY title`
filesort that all designs pay (fix: a `(parent, state, title)` index).
Permission resolution is noise in the path model. Point checks are
sub-0.15 ms everywhere, so autosave never decides the architecture. The
naive path-LIKE flatten took 16 minutes for 30k grants; done right it
needs the closure to be fast, meaning design A needs design B inside it.

## Why: the red-team

13 scenarios. Closure beat flattened 7-2; the batched path engine beats
both. Flattened-model kills:

- Concurrent share/unshare/move races can leave derived rows granting
  access for a deleted grant, silently, until a nightly job. Not
  self-healing.
- Restore-after-parent-move silently corrupts paths and ACLs of trashed
  subtrees (they are invisible to the move's rewrite).
- A 5k-node WebDAV MOVE returns success before permissions converge: a
  bounded-duration access leak that WebDAV cannot express.

Closure-model kills: the per-root cache generation cannot invalidate
per-user (removing someone from a group leaves stale cached access until
TTL), and shared-with-me / search have no anchor folder, so they
degenerate into a read-time flatten per request.

## Framework asks (storage_v2), in order

1. **Blocker: GC liveness.** `frappe/storage/gc.py` counts only `tabFile`
   references (`storage_blob_references` does NOT exist; an earlier note
   claiming it does was wrong). Any blob held only by a `Drive Node` or
   `Drive Node Blob` row is deleted after 24 h. Add reference discovery
   (meta-driven scan of Link fields to File Blob, or a hook). Nothing
   ships before this.
2. `finish_upload_to_blob(upload_id) -> FileBlob`: split `finish_upload`
   so a resumable session can end without creating a framework File row.
   Public function, not a hook.
3. `signed_url_for_blob(blob, filename, expires_in)`: sibling of
   `signed_url(file)`. The `/f/` route already accepts a valid HMAC before
   touching any table, so node-authorized egress needs no new seam.
4. Bug found on the branch: the `after_file_upload` hook never fires on
   the v2 upload path.
5. Valuable, not blocking: public stream-read API, Range for non-local
   drivers, derived blobs (thumbnails GC'd with their parent).

Dropped from the earlier list: `before_upload` hook, `upload_finishers`
hook, `respond_with_blob` split. `put_blob` is already public and
exported; Drive's own endpoints preflight quota and rights, then call it.

## Prerequisites (independent of the engine)

- **Slides media become Drive Nodes under the deck node**, as Writer
  embeds already are. Today they are framework attachments authorized by
  a separate `(src, presentation)` endpoint that no permission model can
  absorb.
- **Sheets adoption needs three Drive interface additions**: `related_doctypes`
  (Sheet Op Log and Sheet Snapshot resolve through the sheet's node), a
  declared quiet-write path that fires no Drive sync (autosave already
  depends on this), and one owner for trash retention (two 30-day clocks
  exist today).
- **Publishing needs an explicit capability.** Slides currently
  force-inserts a permission row on every save of a composite deck,
  bypassing the grant ceiling. Decide: publish is MANAGE-only, or a
  distinct app-granted right.

## Open questions

- Add `(parent, state, title)` to remove the filesort: the largest
  remaining cost on big-folder pages. Not yet benchmarked.
- Concurrency: all numbers are single-connection. No live-load test ran.
- Offboarding: ownership transfer is one chunked owner UPDATE by path
  prefix plus a grant-owner rewrite. Needs a resumable job and a per-root
  lock. Quota transfer policy undecided.
- Quota semantics: charge logical size (dedup is a physical saving only).
  Confirm as product policy.
- A small, non-authoritative derived index for search-within-shared, only
  if the ancestor-union round trip proves too slow on real data.
