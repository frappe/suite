---
id: 005
title: Content app contract
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: []
---

## Question

Sheets is the app furthest from Drive. Decide the three ContentTypeSpec
additions it needs: (1) `related_doctypes` so Sheet Op Log and Sheet
Snapshot resolve permissions through the sheet's node; (2) a declared
quiet-write path that fires no Drive sync (cell autosave already relies on
`db.set_value` firing no doc events); (3) one owner for trash retention
(Sheets has a 30-day purge in `sheets/trash.py`; Drive has its own 30-day
clock). Also: DocShare removal plan for existing shares.

Red-team walkthrough: scenario S9.

## Reframed

Decided with Faris, 2026-09-03. Sheets is being rewritten on branch
`sheets/ironcalc-core` (frontend only at decision time), so its doctypes will
change. The ticket now defines the contract for
every content app (Writer, Slides, Sheets, future apps). Sheets is one worked
example, not the target.

## Resolution

Seven decisions. Together they are the content app contract.

### Two owners, one seam

A content app is a product with a document body and an editor. Drive is where
that document lives in a tree, is shared, is trashed, and is found.

Drive owns, per document node: title, place in the tree, grants, lifecycle
state and retention, versions, comments, activity, recents, favourites,
modified time.

The app owns: the live document body, its change log if it has one, its
collab state, its editor, its internal counters.

### 1. Title lives on the node only

The content doctype has no title field. It carries one Link to its node and
reads and writes the title through Drive. No mirror in either direction.
Today every content doctype holds its own title and Drive renames on
`on_update` (`suite/drive/overrides/file.py:604`); that sync is deleted.

### 2. Lifecycle is Drive's

The node state (Active, Trashed, Purged) is the only lifecycle truth. No
content doctype carries a trashed field. Trash, restore, and permanent delete
are Drive operations; an app's delete button calls Drive. One retention clock
for every node kind. Purge calls the app's declared `on_purge`, which deletes
the document and its app-owned rows. Drive never reaches into app tables.

Today Sheets holds `trashed` fields plus a 30-day purge
(`suite/sheets/trash.py`) beside Drive's own 30-day clock
(`suite/drive/api/scripts.py:106`), and Drive's trash moves the File without
telling the Sheet. Both go.

### 3. Versions and comments are Drive's; change logs and live state are the app's

Inventory (agents surveyed all four modules):

| Kind | Writer | Slides | Sheets |
|---|---|---|---|
| Versions | `Writer Version`, HTML, no pruning | none | `Sheet Snapshot`, gzip JSON, tiered pruning |
| Change log | inside the Yjs body | none | `Sheet Op Log`, per-cell before/after |
| Comments | second Yjs blob in `ycomments` | none | inside `sheets_data` |
| Collab state | overwrites the body | none | `Sheet Collab State`; rewrite drops it |

No app uses the framework `Version` or `Comment` doctypes.

- **Versions become one Drive table.** Per node: sequence, label, kind (auto,
  named, milestone), pinned, actor, size, bytes as a blob. Immutable. Drive
  owns one tiered retention policy for every app. The app declares two
  functions: produce version bytes, and load version bytes back into the
  live document.
- **Comments become one Drive table.** Per node: thread, opaque anchor,
  text, resolved, actor, mentions. The anchor is app-defined (cell id, Yjs
  relative position, slide id); Drive stores and lists it, the app resolves
  it on screen. This makes the Comment role enforceable. Today a Sheets
  comment is a workbook edit and needs Edit.
- **Change logs stay app-owned.** Only Sheets has one. In the rewrite the
  command log is the document's source of truth and a snapshot is a replay
  shortcut, so it is part of the body.
- **Live and collab state stays app-owned.** It is the document body.

### 4. A content edit owes Drive one touch

The app's save path calls `touch`, debounced: bump the node's modified time
and actor. One indexed update, no document load, no events. Nothing else
flows from app to Drive on edit. Version creation is a separate explicit
call. The autosave permission check is the already-decided point read for
Edit on the node.

The "quiet write" in the ticket's original question is not needed. It existed
only to dodge doc events that mirrored title and trash, and those events are
gone.

### 5. Creation goes through Drive

"New spreadsheet in this folder" is a Drive call: check Upload on the folder,
create the node, call the app's declared factory for the empty document, one
transaction. The node holds the content reference (doctype, name); the
document holds one Link to its node. Both are set once and never change, so
they are identities, not synced facts. Copy is the same shape with the app's
declared duplicate. Import (an xlsx becoming a sheet) is a file node plus a
declared conversion, not a separate path.

Today the app inserts first and `after_insert` creates the File
(`suite/sheets/doctype/sheet/sheet.py:55`, `suite/slides/.../presentation.py:64`).
Reversed.

### 6. Sharing has one home

No content doctype has share code, share endpoints, or a share dialog. Every
content doctype gets the same two hooks pointing at generic Drive targets
(per-document check, list filter), resolved through the node Link. The role
row is a wide-open `All` row, as `Writer Document` has today. Guest access
exists only through link grants. No "document without a node" fallback
(`content_has_permission`, `suite/drive/overrides/file.py:525`): under
decision 5 that state cannot exist, so it is an error.

Sheets `DocShare` rows become grants on the sheet's node: `read` -> Read,
`write` -> Edit, the `everyone` row -> the any-signed-in-user principal at the
same level. Then the rows and the three share endpoints
(`share_sheet`, `unshare_sheet`, `get_sheet_shares`) are deleted.

### 7. The declaration

One object per app, registered through a hook:

- Identity: doctype, mime, node link field.
- Factories: create empty, duplicate, import from a file node.
- Bytes: export to a format (download, ZIP, previews), produce version
  bytes, restore from version bytes.
- Cleanup: on purge.
- Satellites: doctypes that take their rights from the node, each with its
  link field. Read to see, Edit to change. Drive supplies their
  per-row check and list filter; the app writes no permission code for
  them. Internal tables the user never reads are not declared.

Drive calls the app. The app calls only the public `suite.drive` facade: the
point permission check, touch, take a version now, create or copy this
document here, and—after the later decision in ticket 012—push a document
preview. It imports that facade with `from suite import drive`.

### Defaults

- A trashed document opens read-only. Edits and comments are refused.
- Restoring a version needs Edit and first takes a version of the current
  state, so restore is never destructive.
- Adding a comment or resolving a thread needs Comment. Editing or deleting
  a comment needs Edit, or being its author.
- Versions and comments of a purged node go with it. Drive deletes them.

### Handed off

- Version blob storage and export renditions -> Renditions and thumbnails
  model (006).
- Whether a document body counts against quota -> Quota policy (010).
- DocShare-to-grant rewrite; `Writer Version` -> Drive versions;
  `ycomments` and Sheets in-workbook comments -> Drive comments ->
  Migration mapping (011).
- The declaration's exact fields, the version and comment schemas, and the
  satellite hook targets -> Draft the spec (013).
- Glossary updated: Content Document, Content Type, Satellite, Version,
  Comment (`suite/drive/CONTEXT.md`); Sheets seam line in `CONTEXT-MAP.md`.
