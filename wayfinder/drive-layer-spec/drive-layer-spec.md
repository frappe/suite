# Drive layer spec

| | |
|---|---|
| Status | Draft |
| Date | 2026-09-05 |
| Source map | `wayfinder/drive-layer-spec/` (tickets 001 to 014, `MAP.md`, `explainer/`) |
| Companion plan | `drive-layer-plan.md` (file ownership and build order) |

Implementation-ready spec for the Drive layer of the `suite` app. Every
schema, query, and number here is frozen. Bracketed ids cite the ticket
that decided the rule, in `wayfinder/drive-layer-spec/tickets/`. Terms are
the glossary's (`suite/drive/CONTEXT.md`).

Every `> Spec pick:` line is a choice the map did not decide. Each one is
open to review.

## 1. Goal and non-goals

### Goal

One tree, one permission table, one storage path, for every Suite app.

- `Drive Node` is the tree entry. The framework `File` doctype is not
  extended and holds no Drive data.
- `Drive Grant` is the only permission table: source of truth and read
  path. Ancestors come from the node's `path` column, parsed in Python.
- Bytes go only through `frappe.storage` blobs. Drive deletes no bytes.
- Writer, Slides, Sheets, and later apps join through one declaration.
  They write no permission, share, trash, version, or comment code.
- One HTTP surface, one WebDAV mount, one SDK behind both.

### Non-goals

- Frontend work. The share dialog, the upload client, and the list views
  are a later effort.
- Many shared spaces. A `Space` root kind with its own quota and member
  list rebuilds the team model that `remove_teams.py` dissolved [001].
- Blind drop-box. UPLOAD contains READ, so upload without read is
  unrepresentable [008].
- Standalone `frappe/drive` migration. This spec covers suite sites.
- Site-wide API hardening. Only the Drive-shaped part is here [014].
- A derived search index. Add one only if the ancestor-union round trip
  proves slow on real data.

---

## 2. Architecture

### 2.1 Layers

Each layer calls only the layer below it.

```
HTTP routes (§11)   WebDAV (§12)   content apps (§10)     callers
------------------------------------------------------------------
suite/drive/sdk                        the only place a role is decided
------------------------------------------------------------------
Drive Node  Drive Grant  Drive Root  side tables (§3)     data
------------------------------------------------------------------
frappe.storage  (blob, upload, url, serve, gc)            bytes
```

- A caller never runs `require()` for the SDK. It calls an SDK function
  and maps the exception [014 §4].
- The SDK never reads `frappe.local.request`. Principals arrive as an
  argument, built once per request by `principals_for_request()` (§4.6).
- The data layer holds no permission logic. `has_permission` and
  `permission_query_conditions` hooks on content doctypes point at
  generic Drive targets (§10).

### 2.2 Module layout

| Module | Public names |
|---|---|
| `sdk/roles.py` | role constants, ptype map |
| `sdk/principals.py` | `principals_for_request`, `X-Drive-Links` parsing, unlock tickets |
| `sdk/access.py` | `effective_role`, `effective_roles`, `require`, `check`, `explain`, `grant`, `revoke`, `revoke_or_deny`, `revoke_below`, `rotate_link`, `unlock_link`, list predicates |
| `sdk/nodes.py` | `create_folder`, `create_file`, `create_document`, `create_link`, `get`, `update`, `purge`, `copy`, `children`, views |
| `sdk/upload.py` | `create_upload`, `finish_upload` |
| `sdk/quota.py` | `admit`, `release`, `effective_quota`, `recompute`, reservations |
| `sdk/versions.py` | `take_version`, `restore_version`, `label_version`, `delete_version`, `thin` |
| `sdk/previews.py` | `enqueue_render`, `render`, `push_preview`, `sweep_missing` |
| `sdk/comments.py` | threads and comments |
| `sdk/activity.py` | `record`, recents, favourites, notifications |
| `sdk/content.py` | `ContentTypeSpec`, `DriveContent`, registry, `touch`, `list_media`, `sweep_unused_media` |
| `sdk/errors.py` | `DriveNotFound`, `DriveForbidden`, `DriveLocked`, `DriveLinkExpired`, `DriveOverQuota`, `DriveConflict` |
| `http/` | `before_request` translator, route handlers |
| `webdav/` | kept protocol modules, relinked |
| `patches/build.py`, `patches/cleanup.py` | the two migration patches |

### 2.3 The three hot paths and their budgets

| Path | Shape | Budget |
|---|---|---|
| Folder page with roles | 3 queries: child window, grants on the parent chain, grants on the page's child ids | 0.57 ms for the window at 10k children [004]; 0.4 ms for both grant queries [design]; under 2 ms of SQL |
| Serve bytes | one point check, then a signed `/f/` URL; no Python in the byte path | 0.112 ms [design] |
| Editor autosave check | one point check for EDIT, every 2 s to 5 s per open editor | 0.112 ms [design] |

No cache stands between a grant row and an answer. There is no
`Drive Access` table and no closure table. A grant write is one row and
is visible to the next read [design].

### 2.4 What Drive never does

- **Delete bytes.** Drive deletes a Reference (a node, a version row, a preview row). The framework GC deletes the blob 24 h after the last reference goes [003].
- **Render a document.** Drive renders a preview from a file's bytes by mime. An app pushes the image for its own documents [006 §3].
- **Convert an upload.** A PNG put in a drive comes back a PNG. An app that wants a format converts before it calls Drive [012 §9].

---

## 3. Data model

Module `Drive`, app `suite`. Every doctype below is frozen. The index
mechanism is one of two: `search_index: 1` on the DocField for a
single-column index, or `frappe.db.add_index` / `frappe.db.add_unique`
inside the controller's `on_doctype_update()` for a composite.

### 3.1 `Drive Node`

Naming: `autoname: hash`, which is a 10-char id
(`frappe/model/naming.py:307`). Migrated nodes and roots keep the
`File` name they came from, which has the same shape [011 §4].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `title` | Data | | reqd 1 | Display name. Unique among Active siblings. |
| `parent` | Link | Drive Node | | Parent node. NULL for a top-level node of the root. |
| `root` | Link | Drive Root | reqd 1 | The namespace this node belongs to. |
| `path` | Data | | length 500 | Ids of the ancestors below the root, `/<id>/<id>/`. Empty string at top level. Depth cap 40. |
| `kind` | Select | `folder`<br>`file`<br>`link`<br>`document` | reqd 1 | What the node is. |
| `blob` | Link | File Blob | search_index 1 | The head bytes of a file node. NULL for every other kind. |
| `size` | Long Int | | default 0 | Logical bytes charged to the root (§7). 0 for folders, links, and documents. |
| `mime` | Data | | | The blob's sniffed mime, copied at create. Decides preview rendering. |
| `url` | Data | | length 500 | Target of a `link` node. |
| `content_doctype` | Link | DocType | | Content doctype of a `document` node. |
| `content_docname` | Dynamic Link | `content_doctype` | | The content document. Set once, never changed [005 §5]. |
| `state` | Select | `Active`<br>`Trashed` | reqd 1, default `Active` | Lifecycle. Purge deletes the row, so there is no stored Purged state. |
| `trashed_at` | Datetime | | | When the trash root was trashed. Copied to every descendant [011 §7]. |
| `trash_root` | Link | Drive Node | search_index 1 | The node whose trashing trashed this one. Equals `name` on the trash root itself. NULL when Active. |
| `content_modified` | Datetime | | | When the content last changed. Today's `File.file_modified` [009 §9]. |
| `is_template` | Check | | default 0, search_index 1 | A starting point for a new document [012 §6]. |
| `owner` | Data | | standard | Who put the node there. Grants no access [001]. |
| `creation`, `modified`, `modified_by` | standard | | | Row times. `modified` moves on a grant-free write too, so listings sort on `content_modified` [009 §9]. |

Rules on the columns:

- `path` is root-relative, so the same string repeats across roots. Every subtree query carries `root` as well.
- `root` changes only in a cross-root move, which rewrites `root` and `path` in one UPDATE (§8, §7.6).
- The tree is a logical namespace only. `frappe.storage` keys a blob by its sha256, so no root and no path maps to a storage location. Every cost in §5 and §7 is database work [001].
- A `document` node may hold child nodes (media, embeds) and is always a leaf in every listing [012 §1].
- `kind`, `state`, and `is_template` are three separate fields [012 §6].

> Spec pick: `path` is `Data` with `length: 500`. Depth 40 times an
> 11-char segment is 441 chars. `root` (varchar 140) plus `path`
> (varchar 500) is 2560 bytes of utf8mb4, under the 3072-byte InnoDB
> DYNAMIC key limit, so `(root, path)` is indexable with no prefix.

#### Index set

| Index | Mechanism | The query it serves |
|---|---|---|
| PRIMARY (`name`) | framework | Node fetch by id; every side table joins on it. |
| `node_parent_page (parent, state, title)` | `add_index` in `on_doctype_update()` | Folder page: `parent = ? AND state = 'Active' ORDER BY title`. Frozen by [004]: 11.7 ms to 0.57 ms at 10k children, index-only. Also the WebDAV path lookup by title and the children of a content document. |
| `node_root_page (root, parent, state, title)` | `add_index` | Root page: `root = ? AND parent IS NULL AND state = 'Active' ORDER BY title`, index-only. Leading `root` also serves the per-root sweeps: trash purge, preview gap, usage recompute, cross-root move sums. |
| `node_subtree (root, path)` | `add_index` | Path-prefix `LIKE` for move, trash, restore, purge cascade, `revoke_below`, and the cross-root byte sum: `root = ? AND path LIKE '<prefix>%'`. |
| `node_content (content_doctype, content_docname)` | `add_index` | Content reference lookup: the node of one content document, run on every autosave check and every satellite check (§10). |
| `trash_root` | `search_index: 1` | Restore and purge of one trashed subtree: `trash_root = ?`. A path prefix cannot be used, because a subtree can hold nodes trashed earlier under their own trash root. |
| `blob` | `search_index: 1` | The framework GC's liveness probe: `NOT EXISTS (SELECT 1 FROM tabDrive Node WHERE blob = b.name)` [003]. |
| `is_template` | `search_index: 1` | Template picker: `is_template = 1 AND state = 'Active' AND content_doctype = ?`. The flag is rare, so the extra filter runs on the fetched rows. |
| `modified` | framework | Standard row index. |

Not created:

- `(parent, state)`. A redundant prefix of the frozen index [004].
- `(parent, state, modified)` and `(parent, state, size)`. Sorting a big folder by date or size stays a filesort: 11.5 ms at 10k children, 1.2 ms at 1k, 0.24 ms at 48. Add `(parent, state, modified)` alone only if telemetry shows the sort in use; it costs +11.5 MB per 250k nodes and about +5% on insert [004].
- Any index for shared-with-me. That view starts from the `grant_principal` index on `Drive Grant` and fetches nodes by PRIMARY key (§5.4).

> Spec pick: `node_root_page`. Ticket [004] benchmarked the child page
> only. Without a root-leading index the root page reads the whole
> NULL-parent bucket of every root and looks up `root` per row.

### 3.2 `Drive Root`

Naming: `autoname: hash`. Never the email, so recreating a deleted email
gives a fresh root instead of reviving an archived one [001].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `user` | Link | User | | The owner of a Personal root. Empty on a Shared root. |
| `kind` | Select | `Personal`<br>`Shared` | reqd 1 | Which namespace this is. |
| `state` | Select | `Active`<br>`Archived` | reqd 1, default `Active` | Archived is offboarding: one field, no node writes [001]. |
| `quota_bytes` | Long Int | | default 0 | 0 means inherit the site default for the kind [010 §6]. |
| `used_bytes` | Long Int | | default 0 | The counter (§7.2). Maintained in the same transaction as every charged write. |
| `acl_generation` | Int | | default 0 | Reserved [001]. No reader in this spec. Nothing increments it. |

Rules:

- A business site holds one Shared root and one Personal root per user. A personal site holds Personal roots only [001].
- The Shared root has `owner = Administrator` and carries the `$GENERAL` grant. A fresh Shared root carries `$GENERAL UPLOAD`; a migrated one keeps whatever its row maps to [002].
- A Personal root carries one grant: MANAGE for its own user [002].
- "One active Shared root per site" is checkable as `kind = 'Shared' AND state = 'Active'` [001].
- A user may hold at most one Active Personal root. `user` is not unique: an Archived root keeps the email of a user whose address can be recreated [001].

| Index | Mechanism | The query it serves |
|---|---|---|
| PRIMARY (`name`) | framework | Root fetch; `Drive Node.root` joins on it. |
| `root_owner (user, kind, state)` | `add_index` | The caller's Personal root: `user = ? AND kind = 'Personal' AND state = 'Active'`. Runs on every session bootstrap and every quota preflight. |
| `root_kind (kind, state)` | `add_index` | The site's Shared root: `kind = 'Shared' AND state = 'Active'`. Also the daily recompute's list of Active roots, and the admin list of Archived roots. |

### 3.3 `Drive Grant`

The only permission table. Naming: `autoname: hash`.

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `node` | Data | | reqd 1, length 140 | A `Drive Node` name or a `Drive Root` name. |
| `principal` | Data | | reqd 1, length 200 | Who the grant names (§4.4). |
| `role` | Int | | reqd 1 | One of 0, 10, 20, 30, 40, 50. 0 is a stored deny. |
| `expires_on` | Datetime | | | The grant stops at this moment. Valid on every principal [008 §8]. |
| `password_hash` | Data | | length 255 | Passlib hash. Valid on `$LINK:*` only [008 §8]. |

> Spec pick: `node` is `Data`, not a Link. A grant may name a
> `Drive Root` (the Personal root's MANAGE row, the Shared root's
> `$GENERAL` row), and the ancestor chain is one `IN` list holding a
> root id and node ids together. A Link cannot span two doctypes, and a
> Dynamic Link adds a second column to the hot query. Referential
> cleanup is the purge cascade's job (§8), not the framework's.

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE grant_node_principal (node, principal)` | `add_unique` in `on_doctype_update()` | The engine's two hot queries: grants on the parent chain and grants on the page's child ids, both `node IN (...) AND principal IN (...)`. Also the share dialog's list for one node, and the one-row-per-pair rule. |
| `grant_principal (principal, node)` | `add_index` | Shared-with-me and archived-roots, both `principal IN (...)` (§5.4, §5.5). Also link lookup by token, `principal = '$LINK:<token>'`, on `/drive/l/<token>` and on unlock. |
| `expires_on` | `search_index: 1` | The daily expired-link sweep: `expires_on < NOW()` (§6.4). |

### 3.4 `Drive Node Version`

Immutable version bytes beside a node. One table for file nodes and
content documents alike [006 §6].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `node` | Link | Drive Node | reqd 1 | The node this version belongs to. |
| `seq` | Int | | reqd 1 | Version number inside the node, from 1. |
| `kind` | Select | `auto`<br>`named`<br>`milestone` | reqd 1, default `auto` | Only `auto` is thinned by the ladder [006 §7]. |
| `label` | Data | | | What the user called it. |
| `pinned` | Check | | default 0 | Pinned versions are never thinned. |
| `actor` | Link | User | | Who caused the version. |
| `size` | Long Int | | default 0 | Bytes charged to the root (§7.1). |
| `blob` | Link | File Blob | search_index 1 | The version bytes. |

`creation` is the version time and drives the retention ladder.
Migrated rows keep their ids [011 §11].

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE version_node_seq (node, seq)` | `add_unique` | The version list of one node, `node = ? ORDER BY seq DESC`, and the next `seq`. Also the purge cascade's delete by node. |
| `version_thin (kind, pinned, creation)` | `add_index` | The daily thinner's candidate list: `kind = 'auto' AND pinned = 0 AND creation < ?` (§9). |
| `blob` | `search_index: 1` | The framework GC's liveness probe [003]. |

### 3.5 `Drive Node Preview`

The one 512 px WebP beside a node. One row per node [006 §1].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `node` | Link | Drive Node | reqd 1, unique 1 | The node the image shows. |
| `source_blob` | Link | File Blob | search_index 1 | The node's head blob when the image was made. NULL when an app pushed the image. |
| `blob` | Link | File Blob | reqd 1, search_index 1 | The preview bytes. |

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE node` | `unique: 1` on the DocField | The preview of one node, and the folder page's preview expansion (`node IN (...)`, §11). |
| `source_blob` | `search_index: 1` | Reuse before rendering: `SELECT blob FROM \`tabDrive Node Preview\` WHERE source_blob = %s LIMIT 1` [006 §1]. Also a GC liveness probe. |
| `blob` | `search_index: 1` | The framework GC's liveness probe [003]. |

### 3.6 `Drive Comment Thread`

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `node` | Link | Drive Node | reqd 1 | The content document node. |
| `anchor` | Data | | reqd 1, length 255 | Opaque, app-defined. Writer: the comment id in the body. Sheets: sheet plus cell id [011 §11]. Drive stores and returns it; the app resolves it [005 §3]. |
| `resolved` | Check | | default 0 | |
| `resolved_by` | Link | User | | |
| `resolved_at` | Datetime | | | |

| Index | Mechanism | The query it serves |
|---|---|---|
| `thread_node (node, resolved)` | `add_index` | Open threads of one document: `node = ? AND resolved = 0`. Also the purge cascade's delete by node. |

### 3.7 `Drive Comment`

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `thread` | Link | Drive Comment Thread | reqd 1 | |
| `node` | Link | Drive Node | reqd 1, search_index 1 | Denormalised so a purge deletes by node in one statement [011 §10]. |
| `content` | Text | | reqd 1 | |
| `author` | Link | User | reqd 1 | The server sets it. `Guest` for a link visitor [008 §6]. |
| `author_name` | Data | | | The display name a guest typed. The client never sets `author` [008 §6]. |
| `mentions` | JSON | | | User ids mentioned in `content`. |

| Index | Mechanism | The query it serves |
|---|---|---|
| `comment_thread (thread, creation)` | `add_index` | One thread in order. |
| `node` | `search_index: 1` | Comment count per node, and the purge cascade. |

### 3.8 `Drive Activity`

One thing that happened to a node. Written once, never edited [011 §10].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `node` | Data | | reqd 1, length 140 | The node, or the root when a grant names a root. |
| `action` | Select | `create`<br>`rename`<br>`move`<br>`edit`<br>`comment`<br>`trash`<br>`restore`<br>`delete`<br>`share_add`<br>`share_edit`<br>`share_remove` | reqd 1 | The verb. `delete` is a purge. |
| `actor` | Link | User | reqd 1 | The session user. `Guest` for a link visitor. There is no system actor, because no path skips the check [007 §7]. |
| `at` | Datetime | | reqd 1 | |
| `via_link` | Data | | length 200 | The `$LINK:<token>` principal when a link decided the right [008 §6]. |
| `client` | Data | | length 255 | The User-Agent. WebDAV only [009 §10]. |
| `detail` | JSON | | | Verb-specific payload (§9). Grant writes carry `principal`, `old_role`, `new_role`, `expires_on`, `has_password` (§5.12). |

> Spec pick: `action` splits today's `delete` into `trash`, `restore`,
> and `delete` (the purge). Ticket [011] says "same verbs as today", and
> today's declared list has one word for three acts that now differ in
> retention and in the role they need. The `detail` JSON per verb is
> §9.

> Spec pick: `node` is `Data` for the same reason as
> `Drive Grant.node`: a grant write on a root writes an activity row
> naming that root.

| Index | Mechanism | The query it serves |
|---|---|---|
| `activity_node_at (node, at)` | `add_index` | A node's history, newest first, and the purge cascade. |

Activity rows survive grant deletion and node trash. They go on purge
[007 §7].

### 3.9 `Drive Recent`

One person's last open of a node. Today's `Drive Entity Log` under its
real name; renamed pre-model-sync in Build [011 §10].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `user` | Link | User | reqd 1 | |
| `node` | Link | Drive Node | reqd 1 | |
| `opened_at` | Datetime | | reqd 1 | |

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE recent_user_node (user, node)` | `add_unique` | The upsert on open, and the purge cascade by node. |
| `recent_user_opened (user, opened_at)` | `add_index` | The recents view: `user = ? ORDER BY opened_at DESC`. |

Opening a node writes a Recent, never an Activity.

### 3.10 `Drive Favourite`

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `user` | Link | User | reqd 1 | |
| `node` | Link | Drive Node | reqd 1 | |

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE fav_user_node (user, node)` | `add_unique` | The star toggle, the "is it starred" check on a page (`user = ? AND node IN (...)`), the favourites view (`user = ?`), and the purge cascade. |

Clearing recents never touches favourites [011 §10].

### 3.11 `Drive Notification`

A pointer at an activity row. It carries no message of its own, so the
message cannot drift [011 §10].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `activity` | Link | Drive Activity | reqd 1 | |
| `to_user` | Link | User | reqd 1 | |
| `read` | Check | | default 0 | |

| Index | Mechanism | The query it serves |
|---|---|---|
| `UNIQUE notif_activity_user (activity, to_user)` | `add_unique` | One notification per person per activity; the purge cascade through the activity row. |
| `notif_inbox (to_user, read, creation)` | `add_index` | The inbox: `to_user = ? AND read = 0 ORDER BY creation DESC`, and the unread count. |

### 3.12 `Drive Storage Reservation`

Bytes promised to a root and not yet stored. Python-only, for Meet. It
gets no HTTP endpoint [014].

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `root` | Link | Drive Root | reqd 1, search_index 1 | Was `storage_owner`, a Link to User [010 §3]. |
| `reserved_bytes` | Long Int | | reqd 1, default 0 | Counts as used from the moment it is made. |

Naming stays `prompt` (the caller sets the name). The four operations
stay: create, grow, reduce, release. A reservation never moves with a
node [010 §3].

| Index | Mechanism | The query it serves |
|---|---|---|
| `root` | `search_index: 1` | The daily recompute's `SUM(reserved_bytes)` per root (§7.7). |

### 3.13 `Drive Disk Settings` (Single)

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `preview_size` | Int | | reqd 1, default 512 | Longest side of the preview, in px [006 §2]. |
| `default_personal_quota` | Long Int | | default 0 | Site default for a Personal root, in bytes. 0 is unlimited [010 §6]. |
| `shared_quota` | Long Int | | default 0 | Site default for the Shared root, in bytes. 0 is unlimited [010 §6]. |
| `webdav_enabled` | Check | | default 0 | Site switch for the DAV mount. |
| `webdav_allowed_methods` | Small Text | | | The method allow-list [009 §12]. |

Dropped in Cleanup: `quota` (MB), `root_folder`, `thumbnail_prefix`,
`flat`, and the six S3 fields (`enabled`, `bucket`, `aws_key`,
`aws_secret`, `endpoint_url`, `signature_version`). Storage
configuration moves to `site_config` [011 §14].

### 3.14 `Drive Settings` (per user)

| Field | Fieldtype | Options | Flags | Meaning |
|---|---|---|---|---|
| `user` | Link | User | unique 1 | Naming: `field:user`. |
| `auto_detect_links` | Check | | default 0 | |
| `webdav_enabled` | Check | | default 0 | Per-user DAV opt-in [009 §11]. |
| `writer_settings` | JSON | | | |

Dropped in Cleanup: `quota` (its value moves to the user's Personal root
`quota_bytes`) and `user_folder` (the Personal root replaces it)
[010 §6, 011 §12].

### 3.15 Kept and retargeted

| Doctype | Change |
|---|---|
| `Drive DAV Lock` | `entity` retargets from `File` to `Drive Node`. Fieldname and values unchanged. Rest of the shape unchanged: `token` (unique, autoname), `owner_user`, `lock_root`, `owner_xml`, `scope`, `depth`, `timeout_seconds`, `expires_at`. Indexes: `entity`, `owner_user`, `expires_at`, all `search_index: 1` as today. |
| `Drive DAV Property` | `entity` retargets to `Drive Node`. `ns`, `prop_name`, `value_xml` unchanged. Index: `entity`, `search_index: 1`. |
| `Drive Legacy Route` | `entity` retargets to `Drive Node`. `old_id` stays Data, unique, the autoname field. |

### 3.16 Dropped in Cleanup

`Drive Permission`, `Drive Entity Activity Log`, `Drive Token`,
`Writer Template`, `Writer Version`, `Writer Doc Version`,
`Sheet Snapshot` [011 §14, 012 §6]. `Writer Doc Version` is the child
table behind `Writer Document.versions`; it goes with that field. `Drive Entity Log` is renamed to `Drive Recent` in Build,
pre-model-sync [011 §13].

### 3.17 Blob references, for the framework GC

Ticket [003] fixes the rule: a blob is live while some Link field with
`options: File Blob` names it. Drive's columns are four:

| Column | Doctype |
|---|---|
| `blob` | `Drive Node` |
| `blob` | `Drive Node Version` |
| `blob` | `Drive Node Preview` |
| `source_blob` | `Drive Node Preview` |

All four carry `search_index: 1`, so each is one indexed probe per
candidate blob. Ticket [003] names two columns, `Drive Node.blob` and
`Drive Node Blob.blob`. Ticket [006 §2] retired the working name
`Drive Node Blob` and split it into `Drive Node Version` and
`Drive Node Preview`. [006 §6] confirms that the meta-driven GC counts
both. Drive's tests assert that all four columns appear in
`frappe.storage.gc.blob_reference_columns()` (§13.1).

---

## 4. Roles and principals

### 4.1 The ladder

Strict. A higher role contains every lower one, so there are no
skip-level holes and `upload` without `read` is unrepresentable
[002].

```python
# suite/drive/sdk/roles.py
NONE = 0        # a stored deny
READ = 10
COMMENT = 20
UPLOAD = 30
EDIT = 40
MANAGE = 50

ROLES = (NONE, READ, COMMENT, UPLOAD, EDIT, MANAGE)
```

Gaps of 10 leave room for later named levels [002].

### 4.2 Verbs per level and kind

Each level includes everything below it [002].

| Level | Folder | File | Content document |
|---|---|---|---|
| READ | list children, search, ZIP download | download, preview | open read-only, export |
| COMMENT | nothing direct; inheritable only | comment | comment |
| UPLOAD | create children | nothing direct | nothing direct |
| EDIT | rename, move, trash, restore own trashing | + replace bytes, take a version | + edit in its app |
| MANAGE | grant, deny, revoke, revoke-below, restore anyone's trash, purge | same | same |

- A move also needs UPLOAD at the destination folder.
- EDIT holds move and trash. EDIT already overwrites content, so a higher fence buys nothing.
- MANAGE alone purges. Retention empties trash whatever the role.
- A trashed document opens read-only. Edits and comments are refused [005].

### 4.3 Framework ptype mapping

```python
PTYPE_ROLE = {
	"read": READ,
	"select": READ,
	"create": UPLOAD,      # answered against the destination folder
	"write": EDIT,         # trash and restore are state writes
	"delete": MANAGE,      # permanent
	"share": MANAGE,
}
DEFAULT_PTYPE_ROLE = EDIT  # unknown ptype, parity with today's fallback
```

`create` has no meaning on the row being inserted, so it is answered
against the parent [002].

### 4.4 Principal spellings

| Spelling | Meaning | Own or open |
|---|---|---|
| `<email>` | one User | own |
| `$GROUP:<name>` | one User Group | own |
| `$GENERAL` | any signed-in user | own |
| `$PUBLIC` | anyone at all, Guest included [007 §1] | open |
| `$LINK:<token>` | whoever holds one secret; token 22 chars base62 [008 §1] | open |

"Own" principals are the ones a person carries by identity. "Open"
principals are the ones anyone can present. The split is the two passes
of §5.1, and it is structural: `Principals.own` and `Principals.open`
are separate tuples, never re-derived from the string at compose time.

### 4.5 Creator grant

When a user whose effective role at the parent is below EDIT creates a
node, the engine writes one grant on the new node: that user, EDIT. No
row is written when the creator already holds EDIT, so personal roots
and EDIT-level members cost nothing [002].

An upload through an UPLOAD link writes no creator grant. The grant would name the token, and every holder would edit and trash every upload [008 §5].

Rejected: UPLOAD that includes content edit (the name lies); strict drop-in with no creator grant (hostile UX) [002].

Consequence that drives the API: revoke must offer "delete this principal's grants below this path", or eviction half-works against nearest-wins (§5.10).

### 4.6 Session principals

```python
# suite/drive/sdk/principals.py

@dataclass(frozen=True)
class Principals:
	user: str
	own: tuple[str, ...]      # email, $GROUP:*, $GENERAL
	open: tuple[str, ...]     # $PUBLIC, $LINK:<token>...
	is_admin: bool

	def all(self) -> tuple[str, ...]:
		return self.own + self.open


def principals_for_request() -> Principals:
	user = frappe.session.user
	links = tuple(valid_link_principals(frappe.request.headers.get("X-Drive-Links")))
	if user == "Guest":
		return Principals(user, (), ("$PUBLIC", *links), False)
	groups = frappe.cache().hget(
		"drive_user_groups", user, generator=lambda: _user_groups(user)
	)
	own = (user, *(f"$GROUP:{g}" for g in groups), "$GENERAL")
	return Principals(user, own, ("$PUBLIC", *links), is_drive_admin(user))
```

- A signed-in user sends the header too, so a link a colleague pasted works without signing out [008 §2].
- `is_drive_admin(user)` keeps today's rule: `Administrator`, or the `Suite Admin` role (`suite/drive/api/permissions.py:31`).
- A WebDAV session never adds a link principal. `open` is `("$PUBLIC",)` there [008 §9, 009 §11].

### 4.7 `X-Drive-Links` grammar

```
X-Drive-Links = link *( "," link )
link          = token [ "." exp "." mac ]
token         = 22( ALPHA / DIGIT )         ; base62
exp           = 1*10 DIGIT                  ; epoch seconds
mac           = 64 HEXDIG                   ; HMAC-SHA256, lowercase hex
```

`valid_link_principals` splits on `,`, trims, splits each item on `.` into at most three parts, and drops anything malformed. It returns `$LINK:<token>` for each surviving item. The ticket check runs later, in the engine, because it needs the grant row.

> Spec pick: at most 20 links per request. Later items are ignored. The
> header is caller-controlled and lands in a `principal IN (...)` list
> on the hot path.

### 4.8 Unlock ticket

A password link needs one proof. The proof is stateless [008 §3].

```python
TICKET_CONTEXT = b"suite-drive-link-ticket"
TICKET_TTL = 30 * 24 * 3600        # 30 days

def ticket_key() -> bytes:
	from frappe.utils.password import get_encryption_key
	return hashlib.sha256(TICKET_CONTEXT + b":" + get_encryption_key().encode()).digest()

def make_ticket(token: str, password_hash: str, exp: int) -> str:
	payload = f"{token}|{password_hash}|{exp}"
	mac = hmac.new(ticket_key(), payload.encode(), hashlib.sha256).hexdigest()
	return f"{exp}.{mac}"

def ticket_ok(token: str, password_hash: str, exp: str, mac: str) -> bool:
	if not exp.isdigit() or int(exp) < int(time.time()):
		return False
	return hmac.compare_digest(make_ticket(token, password_hash, int(exp)), f"{exp}.{mac}")
```

- The hash is an input, so a password change or a rotation kills every ticket at once [008 §3].
- Each request costs one HMAC, never a passlib verify.
- A bare token on a password grant matches nothing. The node answers `DriveLocked` (401), not 403 [014 §5].
- No row is written anywhere.

### 4.9 Suite Admin bypass and privacy

A Suite Admin's effective role is MANAGE on every node. It resolves
before grants, so no deny touches it. `explain()` reports the source as
`site admin` [002].

Two guardrails bind the admin as well: no `$PUBLIC` grant and no
`$LINK` grant on a `Drive Root` [007 §5, 008 §9].

**Privacy statement.** A Suite Admin reads every Personal root on the site, including content its owner never shared, and including Archived roots. This is today's behaviour (`suite/drive/api/permissions.py:31`), kept on purpose. Offboarding relies on it: content a departed user never shared is reachable by Suite Admins only [001]. An admin write records the admin as actor; an admin read records nothing.

Rejected: `$ROLE:Suite Admin` grant rows. A row per root that must always exist and never be denied rebuilds the bypass out of data, with an outage for every missed row [002].

---

## 5. Permission engine

`suite/drive/sdk/access.py`. Every query below is exact. Every one runs
against the indexes in §3.

### 5.1 Two-pass resolution

The rule [008 §4]:

1. Own principals (email, `$GROUP:*`, `$GENERAL`). Nearest wins. A tie
   at the same depth goes email > group > `$GENERAL`. A deny here is
   final: the answer is 0 and pass 2 does not run.
2. Otherwise `$PUBLIC` and every valid `$LINK:*` resolve together.
   Nearest wins. A tie at the same depth takes the highest role.
3. The answer is the higher of pass 1 and pass 2.

A link never lowers anyone. A deny naming a person or a group beats a link anywhere below it. A `$PUBLIC` deny nearer the node cuts link holders of a folder above, because nearest wins inside pass 2.

Rejected: one pass over all principals. Presenting a link then lowers the
visitor, and one file has two answers depending on the header. Rejected:
"links only fill gaps". Links then do nothing for members, and nothing on
published content [008 §4].

The chain and the accumulator:

```python
# suite/drive/sdk/access.py

def chain_ids(node: dict) -> list[str]:
	"""Root first, node last. Zero queries. At most 42 ids."""
	ids = [node["root"]]
	if node["path"]:
		ids.extend(node["path"].strip("/").split("/"))
	ids.append(node["name"])
	return ids


def own_tier(principal: str, user: str) -> int:
	if principal == user:
		return 0
	if principal.startswith("$GROUP:"):
		return 1
	return 2                      # $GENERAL


@dataclasses.dataclass
class Acc:
	"""Nearest-wins state for one node. One instance answers one node."""

	own: int | None = None
	own_depth: int = -1
	own_tier: int = 9
	open: int | None = None
	open_depth: int = -1

	def copy(self) -> "Acc":
		return dataclasses.replace(self)

	def offer(self, principal: str, role: int, depth: int, p: Principals) -> None:
		if principal in p.own:
			tier = own_tier(principal, p.user)
			if depth > self.own_depth:
				self.own, self.own_depth, self.own_tier = role, depth, tier
			elif depth == self.own_depth and tier < self.own_tier:
				self.own, self.own_tier = role, tier
			elif depth == self.own_depth and tier == self.own_tier and role < self.own:
				self.own = role               # deny before grant inside one tier
		elif depth > self.open_depth:
			self.open, self.open_depth = role, depth
		elif depth == self.open_depth and role > self.open:
			self.open = role                  # ties take the highest role

	def answer(self) -> int:
		if self.own == 0:
			return 0                          # a deny on you is final
		return max(self.own or 0, self.open or 0)
```

> Spec pick: two own rows at one depth in one tier (two groups on one
> folder, one granting and one denying) resolve to the lower role. The
> shipped prototype orders rows the same way,
> `sorted(rows, key=lambda row: (tier(row), -row.deny))` in
> `suite/drive/webdav/perms.py:97`. No ticket decided it.

### 5.2 Point check for one node

Used by the autosave check, by byte serving, and by `require()`.

```sql
SELECT node, principal, role
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND principal IN %(principals)s
  AND (expires_on IS NULL OR expires_on > %(now)s)
```

Index: `grant_node_principal`. At most 42 chain ids, and the principal
list is the caller's own principals plus `$PUBLIC` plus at most 20
links.

```python
def effective_role(node: dict, p: Principals) -> int:
	if p.is_admin:
		return MANAGE                        # resolved before grants
	chain = chain_ids(node)
	depth = {node_id: i for i, node_id in enumerate(chain)}
	rows = frappe.db.sql(POINT_SQL, {
		"chain": chain, "principals": p.all(), "now": frappe.utils.now(),
	}, as_dict=True)
	acc = Acc()
	for row in rows:
		acc.offer(row.principal, row.role, depth[row.node], p)
	return acc.answer()


def check(node: dict, need: int, p: Principals) -> bool:
	return effective_role(node, p) >= need


def require(node: dict, need: int, p: Principals) -> None:
	role = effective_role(node, p)
	if role >= need:
		return
	if role < READ:
		raise DriveNotFound(node["name"])     # unreadable is never 403
	if locked_link_in_play(node, p):
		raise DriveLocked(node["name"])
	raise DriveForbidden(node["name"], need)
```

`require` hides an unreadable node behind 404, on every surface. WebDAV
does the same [009 §2].

### 5.3 Folder page: three queries

The children window, the grants on the parent chain, and the grants on the
page's child ids [design].

```sql
-- 1. the child window. Index: node_parent_page (parent, state, title)
SELECT name, title, kind, state, blob, size, mime, url,
       content_doctype, content_docname, content_modified,
       is_template, owner, creation, modified
FROM `tabDrive Node`
WHERE parent = %(parent)s AND state = 'Active' AND is_template = 0
ORDER BY title
LIMIT %(limit)s OFFSET %(offset)s

-- the root page is the same query on node_root_page, with the predicate
-- WHERE root = %(root)s AND parent IS NULL AND state = 'Active' AND is_template = 0

-- 2. grants on the parent chain (root ... parent). Index: grant_node_principal
SELECT node, principal, role
FROM `tabDrive Grant`
WHERE node IN %(chain)s
  AND principal IN %(principals)s
  AND (expires_on IS NULL OR expires_on > %(now)s)

-- 3. the same query again, with %(child_ids)s in place of %(chain)s
```

Composing the rows into one role per row:

```python
def effective_roles(chain: list[str], child_rows: dict[str, list], chain_rows, p) -> dict[str, int]:
	"""The batch check. One role per child id, from the two grant queries."""
	if p.is_admin:
		return dict.fromkeys(child_rows, MANAGE)
	depth = {node_id: i for i, node_id in enumerate(chain)}
	base = Acc()
	for row in chain_rows:
		base.offer(row.principal, row.role, depth[row.node], p)
	child_depth = len(chain)                 # a child is nearer than every ancestor
	roles = {}
	for child_id, rows in child_rows.items():
		acc = base.copy()
		for row in rows:
			acc.offer(row.principal, row.role, child_depth, p)
		roles[child_id] = acc.answer()
	return roles
```

The caller drops every row whose role is below READ and returns the rest.
`expand=access` adds the role and the derived flags to each row (§11).

**Preview URLs are opt-in.** A page mints them only when the caller asks
for `expand=preview` (§9.2, §11.3). Ticket [006 §4] has the folder listing
mint a URL for every row; ticket [014 §7] makes `preview` an `?expand=`.
No amendment resolves the two, so the later ticket wins.

**Cursor window.** The cursor is opaque and holds the offset today [014 §6]. Page size is 60 rows by default and 200 at most. The permission filter runs after the SQL window, so a window of 60 can return fewer than 60 rows. The handler returns what it has and sets `next_cursor` to `offset + <rows in the window>`, not `offset + <rows returned>`. `next_cursor` is null when the window came back short. The client pages until then (§11).

Rejected: pushing the grant join into the child query. It re-opens the index frozen by [004] [014 §6].

One PROPFIND Depth 1 costs the same three queries, plus one dead-property
fetch and one lock fetch [009 §12]. `suite/drive/webdav/perms.py` is deleted:
this batch is the engine now.

### 5.4 Shared with me: grant roots

A grant root is the nearest node at which a grant names one of the
caller's own principals. What lies below it is reached through it and is
never listed on its own.

```sql
SELECT g.node AS name, n.root, n.path, n.title, n.kind, n.content_doctype,
       n.content_docname, n.size, n.mime, n.content_modified, n.owner
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
JOIN `tabDrive Root` r ON r.name = n.root
WHERE g.principal IN %(own)s
  AND g.role > 0
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
  AND n.state = 'Active'
  AND n.is_template = 0
  AND r.state = 'Active'
  AND n.root <> %(my_personal_root)s
ORDER BY n.title
LIMIT %(limit)s OFFSET %(offset)s
```

Index: `grant_principal` drives it; the node and root rows come by
PRIMARY key. Benchmarked at 8.5 ms [design].

Four things the query shape does on its own:

- The `JOIN` to `tabDrive Node` drops grants that name a `Drive Root`, so a root never appears in this view. The Personal root and the Shared root have their own entry points.
- `own` only. Links and `$PUBLIC` put nothing in your shared list.
- `n.root <> my_personal_root` drops the creator grants the engine wrote on the caller's own nodes (§4.5).
- `r.state = 'Active'` keeps archived roots out. They have their own view (§5.5).

Two Python passes finish it:

```python
def shared_with_me(rows, p) -> list[dict]:
	ids = {row.name for row in rows}
	# 1. keep only the nearest grant: drop a node that has an ancestor in the set
	roots = [row for row in rows if not (set(chain_ids(row)) - {row.name}) & ids]
	# 2. a deny nearer the node can still cut it; resolve the survivors
	return [row for row in roots if effective_role(row, p) >= READ]
```

Pass 2 costs one point query per surviving root. The count is the number
of things shared with one person, not the number of nodes.

### 5.5 Archived roots view

Offboarding archives a root in place, so its content stays reachable by
whoever held a grant inside it [001].

```sql
SELECT DISTINCT n.root AS root, r.user, r.used_bytes, r.quota_bytes
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
JOIN `tabDrive Root` r ON r.name = n.root
WHERE g.principal IN %(own)s
  AND g.role > 0
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
  AND r.state = 'Archived'
```

Index: `grant_principal`, then PRIMARY key lookups. A Suite Admin
instead reads every archived root:

```sql
SELECT name AS root, user, used_bytes, quota_bytes
FROM `tabDrive Root`
WHERE kind = 'Personal' AND state = 'Archived'
```

Index: `root_kind (kind, state)`.

Opening one archived root runs §5.4 with `r.state = 'Archived'` and `n.root = %(root)s`, so the caller sees their grant roots inside it. Archived roots appear in no folder listing. This is a root-level query, not a special case inside folder listing [001].

### 5.6 Trash view

Only the trash roots are listed. A node trashed as part of a subtree
carries the same `trash_root` and is reached by opening it.

```sql
SELECT name, title, kind, size, mime, trashed_at, owner
FROM `tabDrive Node`
WHERE root = %(root)s
  AND state = 'Trashed'
  AND trash_root = name
ORDER BY trashed_at DESC
LIMIT %(limit)s OFFSET %(offset)s
```

Index: `node_root_page` gives the root range; `state` and `trash_root = name` filter the rows, and `ORDER BY trashed_at` is a filesort over the root's trashed rows only. Rows then run through `effective_roles`, with the chain taken from each row's own `path`, and rows below READ are dropped.

The daily purge sweep runs the same range per root:

```sql
SELECT name FROM `tabDrive Node`
WHERE root = %(root)s AND state = 'Trashed' AND trash_root = name
  AND trashed_at < %(cutoff)s
```

`cutoff` is 30 days back, as today
(`suite/drive/api/scripts.py:107`).

### 5.7 Tree-wide search

Matches first, then one grant query over the ancestor-id union of the
page [design].

```sql
-- 1. matches. No index: a leading-wildcard LIKE cannot use one.
SELECT name, title, root, path, kind, mime, size, content_modified, owner
FROM `tabDrive Node`
WHERE state = 'Active'
  AND is_template = 0
  AND root IN %(visible_roots)s
  AND title LIKE %(term)s              -- '%<term>%'
ORDER BY modified DESC
LIMIT %(limit)s OFFSET %(offset)s
```

`visible_roots` is the caller's Personal root, the Active Shared root,
and every root named by §5.4 and §5.5. It is computed once per request.
Measured at 64.6 ms for 643 hits over 250k nodes [design]; the same
LIKE shape ships today (`suite/drive/api/list.py:216`).

```python
# 2. one grant query over the union of every match's chain
union, depths = set(), {}
for row in matches:
	chain = chain_ids(row)
	depths[row.name] = {node_id: i for i, node_id in enumerate(chain)}
	union.update(chain)

rows = frappe.db.sql(POINT_SQL, {
	"chain": list(union), "principals": p.all(), "now": frappe.utils.now(),
}, as_dict=True)
by_node = collections.defaultdict(list)
for row in rows:
	by_node[row.node].append(row)

visible = []
for match in matches:
	acc = Acc()
	for node_id, depth in depths[match.name].items():
		for row in by_node.get(node_id, ()):
			acc.offer(row.principal, row.role, depth, p)
	if acc.answer() >= READ:
		visible.append(match)
```

The union is at most 42 ids per match and deduplicates hard, because
matches share ancestors. One query per page, whatever the hit count.

### 5.8 `explain`

The grant rows are the explanation [design].

```python
def explain(node: dict, p: Principals) -> dict:
	"""Every row that could decide this node, ordered, with the winner marked."""
	if p.is_admin:
		return {"role": MANAGE, "source": "site admin", "rows": []}
	chain = chain_ids(node)
	depth = {node_id: i for i, node_id in enumerate(chain)}
	rows = frappe.db.sql(EXPLAIN_SQL, {"chain": chain, "now": frappe.utils.now()}, as_dict=True)
	acc = Acc()
	for row in rows:
		if row.principal in p.all():
			acc.offer(row.principal, row.role, depth[row.node], p)
	out = [{
		"node": row.node, "depth": depth[row.node], "principal": row.principal,
		"role": row.role, "expires_on": row.expires_on,
		"pass": 1 if row.principal in p.own else 2,
		"held": row.principal in p.all(),
		"winner": _is_winner(row, acc, depth, p),
	} for row in sorted(rows, key=lambda r: (-depth[r.node], r.principal))]
	answer = acc.answer()
	return {"role": answer, "source": "grant" if answer else "none", "rows": out}
```

`EXPLAIN_SQL` is the point query without the `principal IN` filter, so
the answer shows the rows the caller does not hold as well. `explain`
needs MANAGE at the node, like the share dialog it feeds (§11).

### 5.9 Grant

```python
def grant(node_id: str, principal: str, role: int, p: Principals, *,
          expires_on: datetime | None = None, password: str | None = None) -> dict:
```

Refusal list, in order. Every refusal is a raise, and none of them
writes a row.

| # | Condition | Raises | Source |
|---|---|---|---|
| 1 | The node or root does not exist | `DriveNotFound` | |
| 2 | The caller's effective role at the node is below MANAGE | `DriveForbidden` | [002] |
| 3 | `role` is not one of 0, 10, 20, 30, 40, 50 | `frappe.ValidationError` | |
| 4 | The principal spelling is not one of the five in §4.4 | `frappe.ValidationError` | |
| 5 | An `<email>` principal names no User, or a `$GROUP:` principal names no User Group | `frappe.ValidationError` | |
| 6 | `principal = '$PUBLIC'` and `role > READ` | `DriveForbidden` | [007 §2] |
| 7 | `principal = '$PUBLIC'` and the target is a `Drive Root` | `DriveForbidden` | [007 §5] |
| 8 | `principal` starts with `$LINK:` and the target is a `Drive Root` | `DriveForbidden` | [008 §9] |
| 9 | `principal` starts with `$LINK:` and `role > EDIT` | `DriveForbidden` | [002] |
| 10 | `password` is set and the principal is not a link | `DriveForbidden` | [008 §8] |
| 11 | `role = 0` and the principal is the `user` of the Personal root that contains the node (the root itself included) | `DriveForbidden` | [002] |
| 12 | `expires_on` is in the past | `frappe.ValidationError` | |

Refusals 7, 8, and 11 bind a Suite Admin as well.

> Spec pick: refusals 3, 4, 5, and 12 are malformed arguments, not Drive
> conditions, so they raise `frappe.ValidationError` (400). Ticket [014]
> froze six Drive exception classes and none of them covers a bad
> argument.

What it does when nothing refuses:

1. When `principal == "$LINK"` with no token, mint one: 22 chars base62.
   The stored principal is `$LINK:<token>` [014].
2. Hash `password` with the same passlib context as User passwords
   [008 §3].
3. Upsert on `(node, principal)`: insert, or update `role`,
   `expires_on`, and `password_hash`.
4. Write one activity row (§5.12).
5. Return the row. For a link, the response carries the URL
   `/drive/l/<token>` [014].

There is no grant ceiling. A MANAGE holder may set any role up to
MANAGE. Self-removal is allowed, self-lockout included [002].

Rejected: `exceeds_grant_ceiling`
(`suite/drive/api/permissions.py:210`). With one ordered role and
MANAGE as the only granting right, it has nothing left to police [002].

Publish and unpublish are `grant` and `revoke` with principal
`$PUBLIC`. They may exist as sugar, and they raise without MANAGE.
There is no publish verb and no publish capability [007 §3].

### 5.10 Revoke and revoke-below

```python
def revoke(node_id: str, principal: str, p: Principals) -> None
```

Refusals: 1 and 2 of §5.9. It deletes the row and writes one
`share_remove` activity row.

**Revoke or deny.** Deleting a row does not always cut access: an ancestor
may still reach the principal. `revoke_or_deny` deletes the row, re-resolves
that one principal, and writes a deny when access survives. The rule is the
same for every principal, not only `$PUBLIC` [007 §6].

```python
def revoke_or_deny(node_id: str, principal: str, p: Principals) -> str:
	"""Returns "revoked" or "denied"."""
	revoke(node_id, principal, p)
	node = nodes.get(node_id, p)
	if effective_role_for(node, (principal,)) >= READ:
		grant(node_id, principal, NONE, p)
		return "denied"
	return "revoked"
```

`effective_role_for(node, (principal,))` runs the point query of §5.2 with
that one principal, so the answer is the access the principal keeps from
above. Unpublish is `revoke_or_deny(node, "$PUBLIC")`. The share dialog's
"remove" button is `revoke_or_deny` for any principal; the API maps it to
`DELETE /nodes/<id>/grants/<principal>` (§11.2), and the response says which
of the two happened.

Nothing is notified. Composites re-check on every render, and signed
`/f/` URLs already minted expire on their own clock [007 §6].

```python
def revoke_below(node_id: str, principal: str, p: Principals) -> int
```

Needs MANAGE at `node_id`. It deletes the principal's grants on the node
and on every node below it, in one statement:

```sql
DELETE g FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
WHERE g.principal = %(principal)s
  AND n.root = %(root)s
  AND (n.name = %(node)s OR n.path LIKE %(prefix)s)
```

`prefix` is `CONCAT(node.path, node.name, '/')` plus `%`. Index:
`node_subtree (root, path)`. It writes one `share_remove` activity row
on the origin node with `detail.scope = "below"` and
`detail.rows = <deleted count>`, and returns that count.

This is the eviction operation the creator grant makes necessary: a
creator grant sits below the folder you are revoking at, and
nearest-wins keeps it alive [002].

### 5.11 Rotate and unlock

```python
def rotate_link(grant: str, p: Principals) -> dict
```

It takes the `Drive Grant` name, as [014] asked, and reads `node` and
`principal` from the row. The HTTP route is `POST /grants/<id>/rotate`
(§11.2).

Needs MANAGE at the grant's node. It refuses a principal that is not
`$LINK:*`. It mints a new
22-char token and updates the row in place, keeping `role`,
`password_hash`, and `expires_on`. One activity row: `share_edit`, with
`detail.old_principal` and `detail.new_principal`. Every ticket for the
old token dies, because the token is an input to the HMAC (§4.8)
[008 §8].

```python
def unlock_link(token: str, password: str) -> dict
```

No role is needed: the password is the proof. It reads the grant by
`principal = '$LINK:<token>'` (index `grant_principal`), verifies the
passlib hash, and returns `{"ticket": make_ticket(...)}`, valid 30
days. It writes no row anywhere. Rate limit in §6.3. It raises
`DriveLinkExpired` when the grant is past `expires_on`, and
`DriveNotFound` when the token names no grant.

### 5.12 The activity row a grant write produces

Every insert, update, or delete of a `Drive Grant` writes exactly one
activity row [007 §7].

| Grant write | `action` | `detail` |
|---|---|---|
| new row | `share_add` | `{"principal", "old_role": null, "new_role", "expires_on", "has_password"}` |
| role, expiry, or password changed | `share_edit` | `{"principal", "old_role", "new_role", "expires_on", "has_password"}` |
| rotate | `share_edit` | `{"old_principal", "new_principal", "new_role", "expires_on", "has_password"}` |
| row deleted | `share_remove` | `{"principal", "old_role", "new_role": null}` |
| `revoke_below` | `share_remove` | `{"principal", "scope": "below", "rows"}` |

Other columns: `node` is the node or root the grant names, `actor` is
the session user, `at` is now, `via_link` is set when a link decided the
caller's own right, `client` is the User-Agent on WebDAV only.

Publish and unpublish produce `share_add` and `share_remove` rows whose
principal is `$PUBLIC`. The UI labels them. There is no publish verb
and no system actor, because no path skips the check [007 §7].

Today `share()` and `unshare()` (`suite/drive/overrides/file.py:184` and
`:237`) write no activity row at all, although `Drive Entity Activity Log`
declares `share_add`, `share_edit`, and `share_remove` [007 §7].

### 5.13 List predicates

Four helpers carry the engine into the framework's permission hooks:
`doc_has_permission`, `doc_query_conditions`, `satellite_has_permission`,
and `satellite_query_conditions`. Their signatures are the framework's and
are frozen in §10.3. Each resolves through
`node_content (content_doctype, content_docname)` and the grant table. The
hook wiring and the SQL fragment are in §10. There is no "document without a
node" fallback: under [005 §5] that state cannot exist, so it is an error.

---

## 6. Share links and publishing

### 6.1 A link is a grant with a clear token

Principal `$LINK:<token>`, token 22 chars base62, about 128 bits, stored in
clear in `Drive Grant.principal` [008 §1]. The share dialog must show the URL
again, the engine matches `principal IN (...)`, and the grants table is
already the trust root. Many links per node, one row each: a READ link and an
UPLOAD link on one folder are both legitimate. A link grant on a folder
reaches everything below it, and a deny naming a link principal on a child is
an ordinary grant row [008 §10].

Rejected: a hashed token (the URL can then be shown once only); one link per
node [008 §1].

### 6.2 Transport is stateless

The URL `/drive/l/<token>` seeds the client. The server resolves the grant,
redirects to the node route, and seeds the token, so the node id never appears
in a shared URL and a rotation changes the URL [008 §9]. The SPA keeps tokens
in `localStorage` and sends `X-Drive-Links` on every API call (§4.7).

Rejected: a signed cookie (a cookie-held capability rides forged cross-site
requests, and Guest has no CSRF token); a server-side link-session doctype
[008 §2].

### 6.3 Password unlock

`password_hash` uses the same passlib context as User passwords.
`unlock_link(token, password)` (§5.11) returns the ticket of §4.8.

Rate limit, per token, in the site cache: **5 failures in 15 minutes**, then a
**15-minute lockout**. The counter key is `drive:link_unlock:<token>`, and a
success clears it. The shape follows the framework's login-attempt tracker
[008 §3].

A node reached through a password link with no ticket answers `DriveLocked`
(401), a distinct response, never a 403 [014 §5].

### 6.4 Rotate and expiry sweep

Rotate is one operation: new token, same role, password, and expiry, one
activity row naming the old and the new principal (§5.11). It changes the URL
and kills every unlock ticket [008 §8].

`expires_on` is a column on every grant, any principal. The engine filters it
on every read, so an expired grant is inert before any sweep runs. A **daily**
job then deletes the link rows:

```sql
DELETE FROM `tabDrive Grant`
WHERE principal LIKE '$LINK:%'
  AND expires_on IS NOT NULL
  AND expires_on < NOW()
```

Index: `expires_on`. Activity rows stay.

> Spec pick: the sweep deletes link grants only. Ticket [008 §8] says "a daily
> sweep deletes link grants past `expires_on`" and says nothing about other
> principals. An expired grant on a person is inert, and deleting it would
> lose the record of what was shared.

### 6.5 `$PUBLIC` rules

- Every session holds `$PUBLIC`, Guest included [007 §1].
- A published node is one grant row `(node, $PUBLIC, READ)`. No node flag, no second table.
- `$PUBLIC` caps at READ. Anonymous comment, upload, or edit rides a `$LINK:<token>` grant, which has a password, an expiry, and a rotation [007 §2].
- A `$PUBLIC` grant on a folder publishes everything below it. A `$PUBLIC` deny nearer the node wins [007 §5].
- A `$PUBLIC` grant naming a `Drive Root` is invalid for everyone, Suite Admin included. Publishing a folder under the root is the supported way to publish many nodes [007 §5].
- MANAGE publishes. There is no app-declared publish capability and no SDK path that skips the check [007 §3].
- Unpublish deletes the node's own `$PUBLIC` grant, or writes a `$PUBLIC` deny when READ still reaches `$PUBLIC` from above. It needs MANAGE. The code is in §5.10 [007 §6].

Stated consequence: in the Shared root (`$GENERAL UPLOAD`) a contributor holds
the creator's EDIT on a deck they made and cannot publish it. In a Personal
root the user holds MANAGE and can [007 §3].

Rejected: publish as a READ link (a stable public URL must then carry a
token); a `published` column on `Drive Node` (a second permission truth the
engine must OR in, and a deny cannot cut) [007 §1]; refusing unpublish under a
published folder; a publish hook in the content declaration [007 §6].

### 6.6 Composite decks

A composite deck is an ordinary deck. Rendering it for a viewer runs one READ
point check per referenced deck against that viewer's principals. Being named
by a composite grants nothing, and nothing is copied: the composite stays a
live view [007 §4, 012 §7].

- A private composite of private decks works for a team. A published composite shows a guest only its published references.
- For each readable reference, Drive inlines its slides and mints media links for that reference's own node (§6.8).
- The response marks a reference the caller cannot read instead of dropping it silently. The client decides whether to draw a placeholder [012 §7].

The save-time rule "every reference must be public" becomes the ordinary read
check: you may reference what you can read
(`suite/slides/doctype/presentation/presentation.py:35-40` goes, and the
forced-public row at `:47-61` with it) [007 §3].

### 6.7 Collab re-check and guest identity

The browser sends the sid and its link tokens as the connection token.
`check_collab_access` resolves the node role from the full principal list
[008 §7]: EDIT or higher means read and write, READ or COMMENT means
read-only, below READ is refused. Guests get a generated display name. The
collab server re-asks Frappe for every connection **every 5 minutes**, users
and links alike, and disconnects a principal whose grant was revoked or has
expired. Writer collab is WebRTC and checks on save; it is not changed here.

Rejected: a check at connect only (today's unbounded leak,
`suite/sheets/collab.py:40`); a Redis push from grant writes (new plumbing for
an exact answer nobody asked for) [008 §7].

`owner` and activity `actor` stay `Guest`. Every activity row carries
`via_link`, set to the link principal when the grant that decided the right
named a link, for guests and signed-in users alike. A comment carries author
`Guest` plus the optional `author_name` the visitor typed; the server sets the
author, and the client no longer does. The token is never an author: it is a
secret, and a rotation would rename history [008 §6].

### 6.8 Signed URLs for previews and media

One permission check on the node, then short-TTL signed `/f/` URLs minted with
`frappe.storage.url.signed_url_for_blob` (§13.3). Python leaves the byte path,
so ranges, conditional requests, and resume come from the file server
[006 §4, 012 §2].

- TTL **15 minutes**; the page refreshes its media links at **two thirds of the TTL**, so at 10 minutes [012 §3].
- A signed URL outlives an unshare by its TTL, the same as a file download [006 §4].
- Pinning a deck keeps its pictures until the deck is unpinned. Unsharing does not reach into a pinned cache [012 §3].
- The pinned-cache key is the blob with the signature stripped, so one picture is one cache entry across every pinned deck [012 §3].

Rejected: a long TTL (a day-long window is a different security promise); a
permanent `/drive/media/<node>` address that redirects (it costs one
permission check per picture, which is the cost being removed) [012 §3].

### 6.9 WebDAV has no links

WebDAV clients present user credentials and have no place for a token, so a
DAV session's principals are the signed-in user's: email, groups, `$GENERAL`,
`$PUBLIC`. Rejected: the link token as a Basic password, which is an anonymous
bearer with a lockable, PUT-able endpoint [008 §9, 009 §11].

---

## 7. Quota

### 7.1 Charge rule and what counts

Logical size, each reference pays. Every `Drive Node` that holds a blob pays
the blob's full size to its root. Two nodes with the same bytes in one root
pay twice. Usage is a plain sum with no `DISTINCT` on blob [010 §1]. Dedup is
a physical saving for the site, never a discount for a root: a 50 MB video in
three decks costs 150 MB against one 50 MB blob, because a deck you can delete
alone must cost you something [012 §4].

| Counts | Free |
|---|---|
| Active nodes | `Drive Node Preview` |
| Trashed nodes | Exports (never stored) |
| Every `Drive Node Version`, of every kind, pinned or not | Content document bodies (they live in the app doctype) |
| Every `Drive Storage Reservation` | Folders, links, and empty nodes (size 0) |

Each line of that table is a rule [010 §2]:

- Trash counts because the bytes are held and restorable. Purge frees them, by hand or by the 30-day sweep.
- Versions count because a kept version is the user's choice and auto versions are bounded by the ladder. Deleting a version frees space.
- A preview is Drive's own artifact with no user lever.
- A body has no reliable byte size and would rebill on every touch. Its embedded nodes and its versions still pay.

Rejected: dedup within a root (deleting one copy then frees nothing); physical
accounting only (it drops the per-root quota Meet's recording budget relies
on) [010 §1]; Active nodes only (trash becomes free storage, and a restore can
push a root over quota); versions free (fifty pinned versions of a 1 GB video
cost 1 GB); only named and pinned versions count (the charge then moves on pin
and unpin) [010 §2].

### 7.2 Counter and admission

`Drive Root.used_bytes` is maintained in the same transaction as every node
create, replace, purge, version create, version thin, reservation change, and
move [010 §4].

```sql
UPDATE `tabDrive Root`
SET used_bytes = used_bytes + %(delta)s
WHERE name = %(root)s
  AND (%(effective_quota)s = 0 OR used_bytes + %(delta)s <= %(effective_quota)s)
```

```python
def admit(root: str, delta: int) -> None:
	"""Run the UPDATE. Zero rows affected raises DriveOverQuota (413)."""

def release(root: str, delta: int) -> None:
	"""Plain decrement, floored at 0. Never refuses."""
```

The row UPDATE is the lock. The Redis owner lock
(`acquire_owner_storage_lock`, `suite/drive/api/storage.py:12`) goes, and so
do its six call sites outside `storage.py`: `api/files.py:104,700`,
`webdav/put.py:155,229`, `webdav/copy.py:66`, and `webdav/lock.py:202`. Rejected: a `SUM` on every preflight (a scan per write,
and still a lock to make check-then-write atomic); a counter with no repair
job [010 §4].

### 7.3 Preflight, browser and WebDAV

Browser, two stages [010 §5]:

1. `create_upload` reads the root's `used_bytes` and effective quota and refuses when the declared size exceeds the free bytes. It is a plain read before `frappe.storage.upload.create_upload`, so no byte lands on an obvious overshoot. The refusal is `DriveOverQuota`, not a permission error [014].
2. On finish, node create runs the admission UPDATE with the actual size. A refusal there aborts the node; the blob then has no reference and the framework GC removes it after 24 h.

A late refusal happens only when concurrent uploads race near the limit.

WebDAV PUT preflights from `Content-Length`. When the length is absent, the
spool ceiling is the free bytes and the spool stops there. The admission
UPDATE runs at commit. A replace charges the new head size; the old head
becomes a version and stays charged, unless it was size 0, which is never kept
[009 §5, 010 §5]. Link uploads with actor `Guest` are charged to the root the
node lands in.

Rejected: a reservation per upload session (one row per upload, plus a sweep
that must track storage_v2 session expiry); charging at finish only (a 4 GB
upload refused at the end) [010 §5].

### 7.4 Configuration

```python
def effective_quota(root: dict) -> int:
	if root["quota_bytes"]:
		return root["quota_bytes"]
	settings = frappe.get_cached_doc("Drive Disk Settings")
	if root["kind"] == "Shared":
		return settings.shared_quota
	return settings.default_personal_quota
```

0 means unlimited at both levels. Only a Suite Admin sets `quota_bytes` (§11).
Rejected: the root row only (a site default change then touches no existing
root); the Shared root always unlimited (no way to cap the shared space)
[010 §6].

### 7.5 Archived roots

An Archived root keeps its `used_bytes` and `quota_bytes`. Nothing is
rebilled. Uploads by grant holders are admitted against the archived root's
own quota, like any other root. There is no reclaim clock: a Suite Admin
purges an Archived root deliberately, in one operation that purges every node
in it, and the blobs follow through GC [010 §7].

Rejected: rebilling to the Shared root (a personal site has none, and a
leaver's private files would count against a space they never used); a site
retention timer (a shared folder in use vanishes on a clock); reclaim on
archive (irrevocable at the worst moment) [010 §7].

### 7.6 Cross-root move and copy

Move is UI-only; no DAV move crosses roots [010 §8, 009 amendment]. The delta
is one query, on `node_subtree (root, path)`:

```sql
SELECT COALESCE(SUM(n.size), 0) + COALESCE((
         SELECT SUM(v.size) FROM `tabDrive Node Version` v
         WHERE v.node IN (SELECT name FROM `tabDrive Node` s
                          WHERE s.root = %(root)s
                            AND (s.name = %(node)s OR s.path LIKE %(prefix)s))
       ), 0) AS delta
FROM `tabDrive Node` n
WHERE n.root = %(root)s AND (n.name = %(node)s OR n.path LIKE %(prefix)s)
```

Both states count. `admit` runs on the destination, then `release` on the
source, in the same transaction as the path rewrite. The move is refused when
the destination would overflow. Reservations never move. Copy charges the
destination root for the head bytes alone, because no version is copied
[009 §8, 010 §8].

### 7.7 Recompute job

One **daily** job recomputes every Active and Archived root, writes the
corrected value, and logs the drift [010 §4].

```sql
SELECT
  (SELECT COALESCE(SUM(size), 0) FROM `tabDrive Node`
    WHERE root = %(root)s) AS nodes,
  (SELECT COALESCE(SUM(v.size), 0) FROM `tabDrive Node Version` v
     JOIN `tabDrive Node` n ON n.name = v.node
    WHERE n.root = %(root)s) AS versions,
  (SELECT COALESCE(SUM(reserved_bytes), 0) FROM `tabDrive Storage Reservation`
    WHERE root = %(root)s) AS reserved
```

`used_bytes = nodes + versions + reserved`. Indexes: `node_root_page` for the
node sum, `version_node_seq` through the node join, and
`Drive Storage Reservation.root`. Build runs this job as its last step,
because the patch does not set `used_bytes` itself [011 §12].

### 7.8 Reservations, and the Meet call sites

`Drive Storage Reservation` keeps its four operations: create, grow, reduce,
release. They move from `suite/drive/api/storage.py` to
`suite/drive/sdk/quota.py`, and `storage_owner` (a Link to User) becomes
`root` (a Link to Drive Root) [010 §3]. Reserved bytes count as used from the
moment the row is made. A reservation never moves with a node.

Drive's own callers go with the lock (§7.2). Meet is the only caller
outside Drive, and it must move with the reservation functions:

| File | Lines | Calls |
|---|---|---|
| `suite/meet/api/recording.py` | 17-21, 73, 413, 453, 776, 780 | `acquire_owner_storage_lock`, `create_storage_reservation`, `grow_storage_reservation`, `get_storage_usage` |
| `suite/meet/recording/ingest.py` | 19, 94, 200 | `acquire_owner_storage_lock`, `reduce_storage_reservation` |
| `suite/meet/doctype/meet_recording/meet_recording.py` | 277 | `release_storage_reservation` |
| `suite/meet/patches/backfill_recording_storage_reservations.py` | 19, 36 | writes `storage_owner` on the row |

The lock calls are deleted, not moved: the admission UPDATE of §7.2 is the
lock. Meet reserves against the Room Owner's Personal Root [010 §3].

### 7.9 DAV quota properties

Both read the Personal root, the only DAV mount [009 amendment, 010 §9]:
`quota-used-bytes` is `used_bytes`; `quota-available-bytes` is
`max(0, effective_quota - used_bytes)`, omitted when the root is unlimited
(RFC 4331 §4). Rejected: reporting only the head bytes of Active nodes, which
is two truths for one root [010 §9].

---

## 8. Node operations

The SDK in `suite/drive/sdk/nodes.py` and `suite/drive/sdk/upload.py`. Every
function checks its own permission through `sdk.access.require` and raises;
no caller checks first [014 §4]. Every write records one `Drive Activity`
row through `sdk.activity.record` in the same transaction. Every write that
changes bytes charged to a root runs the admission `UPDATE` from §7.

Drive never deletes bytes, never renders a document, and never converts an
upload [design, 012 §9].

### 8.1 Signatures

```python
# suite/drive/sdk/nodes.py
def create_folder(parent: str, title: str) -> str: ...
def create_file(parent: str, title: str, *, blob: str, size: int, mime: str,
	content_modified: datetime | None = None) -> str: ...
def create_document(parent: str, title: str, *, content_doctype: str,
	from_node: str | None = None, is_template: bool = False) -> str: ...
def create_link(parent: str, title: str, *, url: str) -> str: ...
def get(node: str, *, expand: tuple[str, ...] = ()) -> dict: ...
def update(node: str, *, title: str | None = None, parent: str | None = None,
	state: str | None = None,          # "Active" | "Trashed"
	blob: str | None = None, size: int | None = None, mime: str | None = None,
	content_modified: datetime | None = None) -> dict: ...
def purge(node: str) -> int: ...          # returns the node count purged
def copy(node: str, parent: str, *, title: str | None = None) -> str: ...
def children(parent: str, *, cursor: str | None = None, limit: int = 60,
	order_by: str = "title", ascending: bool = True,
	mime_prefix: str | None = None) -> dict: ...
def views(name: str, *, cursor: str | None = None, limit: int = 60, **filters) -> dict: ...

# suite/drive/sdk/upload.py
def create_upload(parent: str, filename: str, size: int, *, mime: str | None = None) -> dict: ...
def finish_upload(upload_id: str, *, parent: str | None = None, title: str | None = None,
	checksum: str | None = None, content_modified: datetime | None = None,
	replaces: str | None = None) -> str: ...
```

`finish_upload` takes either `parent` and `title` (a create) or `replaces`
(a replace), never both and never neither. Any other combination raises
`frappe.ValidationError`. `PUT /nodes/<id>/content` is the replace form and
`POST /uploads/<upload_id>/finish` is either (§11.2).

### 8.2 Role, activity, quota, refusals

| Function | Role and where | Activity verb and `detail` keys | Quota | Refuses |
|---|---|---|---|---|
| `create_folder` | UPLOAD on `parent` | `create`: `kind`, `title` | none (size 0) | `DriveForbidden`, `DriveNotFound` (parent), `DriveConflict` (depth > 40) |
| `create_file` | UPLOAD on `parent` | `create`: `kind`, `title`, `size`, `blob` | `+size` on the parent's root | `DriveForbidden`, `DriveOverQuota`, `DriveConflict` |
| `create_document` | UPLOAD on `parent`; READ on `from_node` when given | `create`: `kind`, `title`, `content_doctype` | none (bodies are free) [010 §2] | `DriveForbidden`, `DriveNotFound`, `DriveConflict` |
| `create_link` | UPLOAD on `parent` | `create`: `kind`, `title`, `url` | none | `DriveForbidden`, `DriveConflict` |
| `get` | READ on `node` | none | none | `DriveNotFound`, `DriveLocked`, `DriveLinkExpired` |
| `update(title=)` | EDIT on `node` | `rename`: `old_title`, `new_title` | none | `DriveForbidden`, `DriveConflict` |
| `update(parent=)` | EDIT on `node`, UPLOAD on the new parent [002] | `move`: `from`, `to`, `from_root`, `to_root` | moves `SUM(size)` of the subtree plus its versions between roots [010 §8] | `DriveForbidden`, `DriveOverQuota`, `DriveConflict` (cycle, depth > 40) |
| `update(state="Trashed")` | EDIT on `node` | `trash`: `trash_root`, `nodes` | none; trash stays charged [010 §2] | `DriveForbidden` |
| `update(state="Active")` | EDIT when the actor trashed it, else MANAGE [002] | `restore`: `trash_root`, `nodes`, `reparented_to` | none | `DriveForbidden`, `DriveConflict` |
| `update(blob=)` | EDIT on `node` | `edit`: `blob`, `size`, `version` | `+new_size` (the old head stays charged as a version) | `DriveForbidden`, `DriveOverQuota` |
| `purge` | MANAGE on `node` | `delete`: `nodes`, `bytes` | `-SUM(size)` of the subtree plus its versions | `DriveForbidden` |
| `copy` | READ on `node`, UPLOAD on `parent` [009 §8] | `create`: `kind`, `title`, `copied_from` | `+size` of the new nodes on the destination root; no version is copied | `DriveForbidden`, `DriveOverQuota`, `DriveConflict` |
| `children` | READ on `parent` | none | none | `DriveNotFound`, `DriveLocked`, `DriveLinkExpired` |
| `views` | per view, see §11 | none | none | `DriveForbidden` |
| `create_upload` | UPLOAD on `parent` | none | reads the counter, writes nothing [010 §5] | `DriveForbidden`, `DriveOverQuota` |
| `finish_upload` | UPLOAD on `parent`; EDIT on `replaces` | `create` or `edit` | `+actual size` through the admission `UPDATE` | `DriveForbidden`, `DriveOverQuota`, `DriveConflict` |

Rules that hold for every row above.

- An unreadable node is `DriveNotFound`, never `DriveForbidden` [009 §2].
- The creator grant fires on every create when the actor's effective role at
  the new node is below EDIT: one `Drive Grant` row `(node, actor, EDIT)`
  [002]. It does not fire when the right came from a `$LINK` principal
  [008 §5].
- The activity row carries `via_link` when the grant that decided the right
  named a link, and `client` (the User-Agent) on WebDAV requests
  [008 §6, 009 §10].
- A Suite Admin holds MANAGE everywhere and is never refused by a grant
  [002].

### 8.3 Create, per kind

| Kind | `blob` | `size` | `mime` | `url` | `content_doctype` / `content_docname` |
|---|---|---|---|---|---|
| `folder` | NULL | 0 | NULL | NULL | NULL |
| `file` | required | blob size | sniffed by the framework | NULL | NULL |
| `document` | NULL | 0 | the spec's `mime` | NULL | required, set once |
| `link` | NULL | 0 | NULL | required | NULL |

`create_document` runs in one transaction [005 §5]:

1. `access.require(parent, UPLOAD)`.
2. Insert the `Drive Node` row with `kind = "document"` and
   `content_doctype`, `content_docname` left empty.
3. Call the content type's `create_empty(node)` factory. When `from_node`
   is given, read its `content_docname` and call
   `duplicate(source_docname, node)` instead (§10.1). `from_node` may name
   a template or an ordinary document; there is no template verb [012 §6].
4. Write `content_docname` on the node and the node id on the document's
   node field. Both are set once and never change.
5. Write the creator grant when needed, then the `create` activity row.

Rejected: the app inserting first and creating the node in `after_insert`,
which is what `sheets/doctype/sheet/sheet.py:55` and
`slides/doctype/presentation/presentation.py:42` do today [005 §5].

### 8.4 Upload, end to end

Ten steps. Names in `frappe.storage.*` are the functions on branch
`forge/storage-v2`.

1. `POST /api/suite/drive/uploads` with `parent`, `filename`, `size`.
   The handler calls `sdk.upload.create_upload`.
2. `access.require(parent, UPLOAD)`.
3. Preflight, a plain read and no write: `Drive Root.used_bytes` and
   `quota.effective_quota(root)` (§7.4). Refuse with `DriveOverQuota` when
   the quota is not 0 and `size > quota - used` [010 §5]. `quota.admit`
   does not run here; no byte has landed and no counter moves.
4. `frappe.storage.upload.create_upload(filename, size, is_private=1,
   check_permission=False, restrict_mimetypes=False)`
   (`frappe/storage/upload.py:36`; the two keywords are framework ask 7,
   §13.7). Drive passes no `doctype` and no `docname`, so
   `check_write_permission(None, None)` returns at once
   (`frappe/handler.py:248`) and Drive's UPLOAD check is the only one.
   The call returns `{"mode": "direct", "upload_id", ...}` when the driver
   offers a native target, else `{"mode": "chunked", "upload_id"}`.
5. Chunked mode: the browser `PUT`s each part to
   `/api/suite/drive/uploads/<upload_id>/chunk?offset=<n>`, which forwards
   to `frappe.storage.upload.upload_chunk` (`upload.py:75`). Cumulative
   size is enforced per chunk by the framework.
   Direct mode: the browser `PUT`s the bytes to the driver's target.
6. `POST /api/suite/drive/uploads/<upload_id>/finish` with `parent`,
   `title`, optional `checksum`, optional `content_modified` (epoch ms),
   optional `replaces`. The handler calls `sdk.upload.finish_upload`.
7. `frappe.storage.upload.finish_upload_to_blob(upload_id, checksum=...)`
   returns a `File Blob` and creates no `File` row. This function is a
   framework ask (see §13); today's `finish_upload` (`upload.py:110`) ends
   in `create_file_from_blob`, which Drive must not reach.
8. `quota.admit(root, blob.file_size)` runs the conditional admission
   `UPDATE` from §7 with the actual size. Zero rows affected raises
   `DriveOverQuota`; the transaction rolls back, the blob keeps no
   reference, and the framework GC removes it after 24 h [003, 010 §5].
9. `nodes.create_file(...)` (or `nodes.update(replaces, blob=...)`) writes
   the node, the creator grant, and the activity row.
10. `previews.enqueue_render(node)` queues one render job when the mime is
    renderable [006 §8].

Two facts a caller must respect.

- The framework caps the request body at `max_file_size` for any path
  outside `/api/method/upload_file` (`frappe/app.py:215`). Suite adds
  `/api/suite/drive/uploads/` to `streaming_request_paths` so a chunk body
  is streamed, not buffered, exactly as `/dav/` does today
  (`suite/hooks.py:341`).
- `is_private` is always 1. A Drive blob is never served by nginx from a
  guessable path; egress is signed and node-authorized [design].

`frappe.storage.upload.create_upload` refuses any mime outside the legacy
allow-list for a user without desk access, and every Drive website user is
such a user. Drive's session must not inherit that gate. The fix is
framework ask 7 (§13.7); Drive passes `restrict_mimetypes=False` after its
own UPLOAD check.

### 8.5 Replace, and the empty-head rule

`update(node, blob=..., size=..., mime=...)` replaces a file node's bytes.

1. `access.require(node, EDIT)`.
2. When the current head blob is set and its size is greater than 0, write
   one `Drive Node Version` row of kind `auto` holding the old blob, and
   charge its size to the root. A head of size 0 is not kept
   [009 §5]. This rule holds for every replace path: the HTTP route, the
   WebDAV PUT, and the SDK.
3. `quota.admit(root, new_size)`.
4. Write `blob`, `size`, `mime`, and `content_modified` on the node.
5. Delete the `Drive Node Preview` row and enqueue a render [006 §5].
6. Activity `edit` with `detail = {"blob", "size", "version": <seq>}`.

### 8.6 Rename, and the sibling dedupe rule

`update(node, title=...)` needs EDIT.

- The title is compared against Active siblings only. A Trashed sibling
  never blocks a title [011 §8].
- On collision the caller is refused with `DriveConflict`. The UI asks for
  a new title. Drive does not silently suffix a user's rename.
- Every path that creates a node without a user in the loop deduplicates
  instead of refusing: `copy`, restore, and the Build patch. The rule is
  `get_new_file_name`'s: the oldest keeps the plain title, later ones get
  ` (2)`, ` (3)` (`suite/drive/utils/__init__.py:644`).
- A document node keeps no extension of its own. Over WebDAV its export
  extension is appended by the DAV layer and a rename must preserve it
  (§12) [009 §3].

### 8.7 Move, as one path rewrite

`path` holds the ids of the ancestors below the root, root-relative, in the
form `/<id>/<id>/`, and the empty string for a top-level node. The path a
node gives its children is

```sql
CONCAT(IF(p.path = '', '/', p.path), p.name, '/')
```

Guards, in order, before any write.

| Guard | Result |
|---|---|
| `access.require(node, EDIT)` and `access.require(dest, UPLOAD)` | `DriveForbidden` |
| `dest = node`, or `dest.path LIKE CONCAT('%/', :node, '/%')` | `DriveConflict` |
| `depth(dest) + height(subtree) > 40` | `DriveConflict` |
| Active sibling with the same title under `dest` | `DriveConflict` |
| Cross-root: `quota.admit(dest_root, subtree_bytes)` | `DriveOverQuota` |

Then two statements. `:old_prefix` is the moved node's own child prefix,
`:new_prefix` is what it becomes under the destination.

```sql
-- 1. the subtree below the node
UPDATE `tabDrive Node`
SET path = CONCAT(%(new_prefix)s, SUBSTRING(path, CHAR_LENGTH(%(old_prefix)s) + 1)),
    root = %(dest_root)s
WHERE root = %(src_root)s
  AND path LIKE CONCAT(%(old_prefix)s, '%%');

-- 2. the node itself
UPDATE `tabDrive Node`
SET parent = %(dest)s,
    path = %(dest_child_path)s,
    root = %(dest_root)s,
    modified = %(now)s,
    modified_by = %(actor)s
WHERE name = %(node)s;
```

Cross-root move then decrements the source root by the same delta, inside
the same transaction as the rewrite [010 §8]. The delta is
`SUM(node.size) + SUM(version.size)` over the moved node and every row
matching `path LIKE CONCAT(:old_prefix, '%')` in the source root.

Active and Trashed nodes both count. Reservations never move [010 §3, §8].
Own grants on the moved nodes travel with them, because grants name node
ids and no id changes [009 §7]. The creator grant fires when the mover
lands below EDIT at the destination.

Benchmark: the subtree rewrite is 9.1 ms for 1000 nodes and is not affected
by the frozen `(parent, state, title)` index [004].

### 8.8 Trash, restore, purge

Trash stamps the subtree with one statement.

```sql
UPDATE `tabDrive Node`
SET state = 'Trashed',
    trash_root = %(node)s,
    trashed_at = %(now)s
WHERE state = 'Active'
  AND root = %(root)s
  AND (name = %(node)s OR path LIKE CONCAT(%(self_prefix)s, '%%'));
```

`state = 'Active'` in the `WHERE` is what makes restore work. A node
trashed earlier keeps its own `trash_root` and its own `trashed_at`, so
this statement does not touch it.

Restore is the inverse, anchored on `trashed_at`.

```sql
UPDATE `tabDrive Node`
SET state = 'Active',
    trash_root = NULL,
    trashed_at = NULL
WHERE state = 'Trashed'
  AND trash_root = %(node)s
  AND trashed_at = %(stamp)s;
```

`:stamp` is the node's own `trashed_at`, read under the row lock. The
inner folder trashed earlier stays in the trash [design C, 011 §7].

Restore rules.

- EDIT restores what the actor trashed. Restoring anyone else's trashing
  needs MANAGE [002].
- The restored node's title is deduplicated against Active siblings before
  the state flips [011 §8].
- A document node opens read-only while it is Trashed. Edits and comments
  are refused [005].

> Spec pick: when the restored node's parent chain is not Active, restore
> reparents the node to the nearest Active ancestor inside the same root,
> and to the root's top level when there is none. The alternative, an
> Active node under a Trashed parent, would force every listing query to
> walk the path, which is exactly what [011 §7] avoided by propagating the
> trash stamp.

Purge deletes the node row. There is no stored `Purged` state.

Purge cascade, in this order, for the node and every descendant:

1. `Drive Comment` (through their threads)
2. `Drive Comment Thread`
3. `Drive Notification` (they point at activity rows)
4. `Drive Activity`
5. `Drive Recent`
6. `Drive Favourite`
7. `Drive Node Preview`
8. `Drive Node Version`
9. `Drive Grant`
10. `Drive DAV Lock`
11. `Drive DAV Property`
12. `Drive Legacy Route`
13. the content type's `on_purge(docname)` for each document node, which
    deletes the document and its satellites [005 §2]
14. `Drive Node`
15. `Drive Root.used_bytes -= SUM(node.size) + SUM(version.size)`

Notifications go before activity because they are pointers at it [011 §10].
No byte is deleted. Blobs die through the framework GC 24 h after the last
Link field stops naming them [003].

The daily trash sweep purges every node whose `trashed_at` is older than
30 days, one `trash_root` at a time.

### 8.9 Copy

`copy(node, parent, title=None)` is the one COPY primitive. WebDAV COPY,
"new from template", "duplicate this deck", and paste across decks all call
it [009 §8, 012 §4, 014].

- READ on the source, UPLOAD on the destination parent. Unreadable children
  are skipped, not refused [009 §2].
- New nodes are owned by the caller and charged to the destination root
  [010 §8].
- Blobs are shared. No byte is copied.
- Grants are not copied. Versions are not copied. Comments are not copied
  [009 §8].
- `Drive Node Preview` rows are copied, pointing at the same preview blob,
  so a duplicate looks right at once [012 §8].
- Dead WebDAV properties are cloned, as today [009 §8].
- The creator grant fires when the caller is below EDIT at the destination.
- A document node is copied by calling the content type's `duplicate`
  factory, then copying its child media nodes and rewriting the app's own
  references from the old node ids to the new ones [012 §4].
- Inside one document, one media node per blob. Pasting the same picture
  twice reuses the node, so a logo on twenty slides is one node and one
  charge [012 §4].
- `is_template` is not copied. A copy of a template is an ordinary
  document.
- Title collision at the destination deduplicates; it does not refuse.

### 8.10 The leaf rule, and templates

A content document node may hold child nodes. It is always a leaf in every
listing [012 §1].

- `children(parent)` refuses when `parent.kind = "document"`:
  `DriveConflict`. No listing descends into a content document.
- Media nodes are reached only through §11's media route, and only through
  the document above them.
- Over WebDAV a document is an export file and has no children (§12).
- The permission path walk is unchanged. READ on the deck reaches the
  pictures under it through the same nearest-wins walk, so no app writes
  permission code [012 §1].

Templates [012 §6]:

- `Drive Node.is_template` is one flag, for every content app.
- Who may use a template is the grant on its node. There is no other rule.
- Ordinary listings and `children` exclude `is_template` nodes. They appear
  only in the `templates` view [014].
- "New from template" is `copy` plus the app's declared `duplicate`. There
  are no template verbs.
- Shipped templates are documents in Administrator's Personal Root under a
  `Templates` folder, each with a `$GENERAL` READ grant, not `$PUBLIC`: a
  logged-out visitor may view a published deck but never start a new one.

### 8.11 `content_modified`

`Drive Node.content_modified` is today's `File.file_modified` under its
decided name [009 §9].

| Written by | Value |
|---|---|
| create, replace | now, or the client mtime when one is given |
| `content.touch` | now [005 §4] |
| browser upload | the `content_modified` argument, epoch ms |
| WebDAV PUT | `X-OC-Mtime` (`suite/drive/webdav/put.py:941`), or `Win32LastModifiedTime` |
| a preview push | never [012 §8] |
| a grant write | never |

Read by the listing sort, the recents view, DAV `getlastmodified`, and the
ETag input for documents. `modified` stays the framework row time.

---

## 9. Versions, previews, comments, and the record tables

Schemas are in §3. This section is behaviour only.

### 9.1 Versions

`suite/drive/sdk/versions.py`: `take_version`, `restore_version`, `thin`.

```python
def take_version(node: str, *, kind: str = "auto", label: str | None = None) -> int: ...
def restore_version(node: str, seq: int) -> int: ...
def label_version(node: str, seq: int, *, label: str | None, pinned: bool) -> None: ...
def delete_version(node: str, seq: int) -> None: ...
def thin(ladder: dict | None = None) -> dict: ...
```

Who writes a version.

| Trigger | Kind | Role |
|---|---|---|
| A file node's bytes are replaced (HTTP, WebDAV, SDK) | `auto` | EDIT |
| An app calls `take_version` on its save path | `auto` | EDIT |
| A person names a version | `named` | EDIT |
| A person marks a milestone or pins one | `milestone`, `pinned = 1` | EDIT |
| `restore_version`, before it writes | `auto` | EDIT |

Rules.

- A version row is immutable except `label` and `pinned`, which
  `label_version` sets under EDIT [006 §6].
- `delete_version` needs MANAGE. It deletes the row and releases its size
  from the root. It is the only other write to the table, and the thinner
  is the only other caller.
- A replaced head of size 0 is never kept [009 §5].
- Version bytes come from the content type's `version_bytes(docname)` for a
  document, and from the old head blob for a file node.
- `restore_version` first takes a version of the current state, so restore
  is never destructive [005 defaults]. It then calls the content type's
  `restore_version(docname, stream)` for a document, or repoints the head
  blob for a file node.
- Every version's size is charged to the node's root [010 §2]. Deleting a
  version frees the bytes.
- Versions and comments of a purged node go with it [005 defaults].

The retention ladder, one policy for every node kind [006 §7]:

| Age | Kept auto versions |
|---|---|
| under 24 h | all |
| 24 h to 7 d | one per hour |
| 7 d to 30 d | one per day |
| 30 d to 90 d | one per week |
| over 90 d | none |

`named`, `milestone`, and `pinned` versions are never thinned. They live
until the node is purged. `site_config` overrides the tiers under
`drive_version_ladder`. The `thin` job runs daily and decrements
`used_bytes` for what it deletes.

### 9.2 Previews

`suite/drive/sdk/previews.py`: `enqueue_render`, `render`, `push_preview`,
`sweep_missing`.

One derived artifact exists: a 512 px longest-side WebP, one row per node
in `Drive Node Preview` [006 §1, §2].

Render pipeline, for nodes with bytes.

1. Upload or replace calls `enqueue_render(node)`. No lock is taken; the
   source blob is immutable [006 §8].
2. `render(node)` looks for any `Drive Node Preview` row with the same
   `source_blob`. When one exists it writes a new row pointing at that
   preview blob and runs no render [006 §1].
3. Otherwise it renders by mime: image through PIL, a video frame through
   PyAV, a PDF page through pymupdf, as today. An unsupported mime writes
   no row.
4. The preview blob is stored with `frappe.storage.blob.put_blob(stream,
   is_private=True, filename=...)`.

Content documents are never rendered by Drive. The app pushes one ready
image through `push_preview(node, image_bytes, mime)`, which needs EDIT on
the node and owes no `touch` [006 §3, 012 §8].

Row lifetime [006 §5]:

- bytes replaced: delete the row, enqueue a render
- node trashed: keep the row, so the trash view shows tiles
- node purged: delete the row in the same transaction
- node copied: copy the row, pointing at the same preview blob [012 §8]

Previews are free of quota [010 §2].

Serving. The folder page has already passed the permission check, so it
mints the URL itself: one signed `/f/` URL per row through
`frappe.storage.url.signed_url_for_blob` (§13.3) with a 15-minute TTL. The
browser fetches `/f/<blob>/<filename>?e=&s=` directly. There is no per-tile
permission request and no Python in the byte path [006 §4]. A signed URL
outlives an unshare by its TTL.

The listing field is `preview`, and it is opt-in: a page mints preview URLs
only when the caller asks for `expand=preview`. [006 §4] had the listing
mint one for every row; [014 §7] made it an expansion, and the later ticket
wins (§5.3). The field holds `{"url", "expires"}` (§11.3).

The gap sweep runs daily. It covers failed renders and migrated nodes.
Documents get no sweep [006 §8].

```sql
SELECT n.name
FROM `tabDrive Node` n
LEFT JOIN `tabDrive Node Preview` pv ON pv.node = n.name
WHERE n.state = 'Active'
  AND n.kind = 'file'
  AND n.blob IS NOT NULL
  AND n.mime IN %(renderable_mimes)s
  AND pv.name IS NULL
ORDER BY n.creation
LIMIT %(batch)s
```

`renderable_mimes` is the mime list the render pipeline handles. Index:
`Drive Node Preview.node` (the UNIQUE) drives the anti-join; the outer scan
is bounded by `LIMIT` and resumes from the last `creation` on the next run.

### 9.3 Comments

`suite/drive/sdk/comments.py` owns `Drive Comment Thread` and
`Drive Comment`.

```python
def create_thread(node: str, anchor: str, text: str, *, author_name: str | None = None) -> str: ...
def reply(thread: str, text: str, *, author_name: str | None = None) -> str: ...
def resolve(thread: str, resolved: bool = True) -> None: ...
def edit_comment(comment: str, text: str) -> None: ...
def delete_comment(comment: str) -> None: ...
def threads(node: str, *, resolved: bool | None = None) -> list[dict]: ...
```

- The anchor is opaque. Drive stores it and lists it; the app resolves it on
  screen. Writer uses the comment id in the body, Sheets uses sheet plus
  cell id [005 §3, 011 §11].
- Adding a comment or resolving a thread needs COMMENT. Editing or deleting
  one needs EDIT, or being its author [005 defaults].
- A trashed node refuses new comments and edits [005 defaults].
- A guest's comment carries `owner = "Guest"` plus the `author_name` the
  visitor typed. The server sets the author; the client never does
  [008 §6].
- Mentions go into the comment's `mentions` field and produce one
  `Drive Notification` each.

### 9.4 Activity

`suite/drive/sdk/activity.py`: `record()`, plus the recents, favourites,
and notification helpers.

```python
def record(node: str, action: str, *, detail: dict | None = None) -> str: ...
```

Columns: `node`, `action`, `actor`, `at`, `via_link`, `client`, `detail`
(JSON) [011 §10]. The verb set is the eleven of §3.8: today's nine, with
`delete` split into `trash`, `restore`, and `delete`.

| Verb | Written by | `detail` keys |
|---|---|---|
| `create` | every create, `copy`, `finish_upload`, DAV LOCK-create | `kind`, `title`, `size`, `blob`, `content_doctype`, `copied_from` |
| `rename` | `update(title=)` | `old_title`, `new_title` |
| `move` | `update(parent=)` | `from`, `to`, `from_root`, `to_root` |
| `edit` | replace, `take_version`, `restore_version` | `blob`, `size`, `version` |
| `trash` | `update(state="Trashed")` | `trash_root`, `nodes` (the subtree count) |
| `restore` | `update(state="Active")` | `trash_root`, `nodes`, `reparented_to` |
| `delete` | `purge`, the daily trash sweep | `nodes`, `bytes` |
| `comment` | thread create, reply, resolve | `thread`, `comment`, `resolved` |
| `share_add` | a `Drive Grant` insert | `principal`, `new_role`, `expires_on`, `has_password` |
| `share_edit` | a `Drive Grant` update, and rotate | `principal`, `old_role`, `new_role`, `old_principal` |
| `share_remove` | a `Drive Grant` delete | `principal`, `old_role`, `scope`, `rows` |

`delete` means purge and nothing else. A row written before Build carries
today's single `delete` verb; §14.6 states how Build maps it.

Rules.

- One activity row per grant write, always. Publish and unpublish are grant
  writes whose principal is `$PUBLIC`; the UI labels them. There is no
  publish verb and no system actor [007 §7].
- `actor` is the session user, `Guest` included. The token is never an
  actor; `via_link` records which link decided the right [008 §6].
- `client` holds the User-Agent on WebDAV requests only [009 §10].
- Activity rows survive grant deletion and node trash. They go on purge
  [007 §7].
- `touch` writes no activity row. It is one indexed update [005 §4].
- A preview push writes no activity row [012 §8].

### 9.5 Recents, favourites, notifications

| Table | Written by | Read by | Cleared by |
|---|---|---|---|
| `Drive Recent` (`user`, `node`, `opened_at`, unique on the pair) | opening a node | the `recents` view | `DELETE /views/recents`, which never touches favourites [014] |
| `Drive Favourite` (`user`, `node`, unique on the pair) | the star toggle | the `favourites` view | the star toggle |
| `Drive Notification` (`activity`, `to_user`, `read`) | mentions, and grant writes naming a user | the notification list | mark-read |

- Opening a node writes a Recent, never an Activity [011 §10].
- A Notification is a pointer at one Activity row. Its message renders from
  that row and cannot drift [011 §10].
- All three are deleted when their node is purged (§8.8).

---

## 10. Content app contract

One object per app, in `suite/drive/sdk/content.py`. Drive calls the app
through it. The app calls Drive for four things only [005 §7].

### 10.1 `ContentTypeSpec`

```python
# suite/drive/sdk/content.py
from collections.abc import Callable
from dataclasses import dataclass
from typing import IO


@dataclass(frozen=True)
class Satellite:
	"""A doctype that takes its rights from a content document's node: Read
	to see, Edit to change. Drive supplies the per-row check and the list
	filter; the app writes no permission code [005 §7]."""

	doctype: str
	link_field: str      # fieldname on `doctype` holding a Link to the content doctype


@dataclass(frozen=True)
class ContentTypeSpec:
	# identity. Set once, never changes.
	doctype: str                       # the app's document doctype, e.g. "Writer Document"
	mime: str                          # the mime written on the Drive Node, e.g. "frappe/writer"
	node_field: str                    # fieldname holding the Link to Drive Node [005 §1]
	default_export: str | None = None  # WebDAV and ZIP format key; None = invisible over DAV [009 §3]
	export_formats: tuple[str, ...] = ()   # every format `export` accepts; must contain default_export

	# factories. Drive creates the node first, then calls these.
	create_empty: Callable[[str], str] = None
	"""(node) -> docname. Insert an empty document bound to `node`."""
	duplicate: Callable[[str, str], str] = None
	"""(source_docname, node) -> docname. Used by copy, duplicate, and
	new-from-template [012 §4, §6]."""
	import_from_file: Callable[[str, str], str] | None = None
	"""(file_node, node) -> docname. An xlsx becoming a sheet [005 §5]."""

	# bytes
	export: Callable[[str, str], tuple[IO[bytes], str]] | None = None
	"""(docname, format) -> (stream, mime). Streamed, never stored [006 §2]."""
	version_bytes: Callable[[str], tuple[IO[bytes], str]] | None = None
	"""(docname) -> (stream, mime). The bytes Drive stores as a version."""
	restore_version: Callable[[str, IO[bytes]], None] | None = None
	"""(docname, stream) -> None. Drive has already taken a version of the
	current state, so this call is not destructive."""

	# preview. True when the app calls previews.push_preview; Drive never
	# renders a document and documents get no gap sweep [006 §3, §8].
	pushes_preview: bool = False

	# cleanup. (docname) -> None: delete the document and its app-owned
	# rows. Drive never reaches into app tables [005 §2].
	on_purge: Callable[[str], None] | None = None

	satellites: tuple[Satellite, ...] = ()

	# media sweep. (docname) -> the node ids the body still names. Only the
	# app can read its own body, so only the app can answer [012 §5].
	used_nodes: Callable[[str], set[str]] | None = None
```

Every callable takes and returns names, never documents. `create_empty`,
`duplicate`, and `on_purge` are required; the rest are optional and their
absence removes a capability, never breaks Drive.

### 10.2 The `DriveContent` mixin

```python
class DriveContent:
	"""Mixin for a content doctype. Provides the four calls, and refuses
	the three fields Drive owns."""

	@property
	def node(self) -> str: ...
	@property
	def node_title(self) -> str: ...        # read-only, from the node

	def drive_check(self, role: int) -> None: ...   # point check, raises
	def drive_touch(self) -> None: ...              # debounced
	def drive_take_version(self, *, kind="auto", label=None) -> int: ...
```

Provides: the node id, the node title as a read-only property, the point
permission check, `touch`, and `take_version`. It also registers the
`before_insert` guard that refuses a document with no node.

Forbids, checked at boot by `content.validate_registry()` and by a test:

| Forbidden | Why |
|---|---|
| a `title` field | the title lives on the node only, with no mirror in either direction [005 §1] |
| a trashed or trashed-at field | the node state is the only lifecycle truth [005 §2] |
| share code, share endpoints, a share dialog | sharing has one home [005 §6] |
| a "document without a node" fallback | under [005 §5] that state cannot exist, so it is an error, not a case |

### 10.3 Registry and hook

```python
def registry() -> dict[str, ContentTypeSpec]: ...     # cached per site
def spec_for(doctype: str) -> ContentTypeSpec: ...
def validate_registry() -> None: ...

def doc_has_permission(doc, ptype="read", user=None, debug=False) -> bool: ...
def doc_query_conditions(user: str | None = None, doctype: str | None = None) -> str: ...
def satellite_has_permission(doc, ptype="read", user=None, debug=False) -> bool: ...
def satellite_query_conditions(user: str | None = None, doctype: str | None = None) -> str: ...

def touch(doctype: str, docname: str) -> None: ...
def list_media(node: str) -> list[dict]: ...
def sweep_unused_media() -> dict: ...
```

`registry()` reads the `drive_content_types` hook, a list of dotted paths to
`ContentTypeSpec` objects, and keys the result by `spec.doctype`.

The four signatures are the framework's, not ours. `has_permission` hooks
are called as `method(doc=doc, ptype=ptype, user=user, debug=debug)`
(`frappe/permissions.py:500`), and `permission_query_conditions` hooks as
`method(user, doctype=doctype)` (`frappe/model/db_query.py:1339`). A
handler that drops either keyword raises `TypeError` at request time.

`doc_has_permission` maps the ptype to a role with the §4 table, resolves
the node from `spec.node_field`, and answers one point check.
`satellite_has_permission` resolves the content document through
`Satellite.link_field`, then its node, and answers READ for a read ptype and
EDIT for anything else [005 §7].

`doc_query_conditions` returns the ancestor-union grant predicate from §5
against `<doctype>.<node_field>`. It replaces today's owner-or-direct-share
SQL (`suite/drive/overrides/file.py:530`), which cannot see a
folder-inherited grant.

### 10.4 Hook entries

A content doctype adds these lines to `suite/hooks.py`:

```python
drive_content_types = [
	"suite.writer.drive.SPEC",
	"suite.slides.drive.SPEC",
	"suite.sheets.drive.SPEC",
]

has_permission = {
	"Writer Document": "suite.drive.sdk.content.doc_has_permission",
	"Presentation": "suite.drive.sdk.content.doc_has_permission",
	"Sheet": "suite.drive.sdk.content.doc_has_permission",
}

permission_query_conditions = {
	"Writer Document": "suite.drive.sdk.content.doc_query_conditions",
	"Presentation": "suite.drive.sdk.content.doc_query_conditions",
	"Sheet": "suite.drive.sdk.content.doc_query_conditions",
}
```

A satellite doctype adds two more, pointing at the satellite targets:

```python
has_permission = {
	"Sheet Op Log": "suite.drive.sdk.content.satellite_has_permission",
}

permission_query_conditions = {
	"Sheet Op Log": "suite.drive.sdk.content.satellite_query_conditions",
}
```

The doctype's role row stays a wide-open `All` row, as `Writer Document`
has today [005 §6]. Guest access exists only through link grants.

Deleted with this: `doc_events` entries pointing at
`suite.drive.overrides.file.sync_content_file` (`suite/hooks.py:232-243`),
`suite.writer.overrides.filter_templates`,
`suite.writer.overrides.template_has_permission`,
`suite.writer.overrides.version_has_permission`,
`suite.slides...presentation.has_permission`, and
`suite.sheets.permissions.*`.

### 10.5 The four calls an app makes

| Call | When | Cost |
|---|---|---|
| `access.check(node, role)` | autosave, editor open | one point read, under 0.15 ms [design benchmark] |
| `content.touch(doctype, docname)` | the save path, debounced | one indexed update, no doc load, no events [005 §4] |
| `versions.take_version(node, kind=..., label=...)` | an explicit "save a version" | one insert plus one `put_blob` |
| `nodes.create_document(...)` or `nodes.copy(...)` | new, duplicate, new-from-template | one transaction [005 §5] |

Nothing else flows from app to Drive. The "quiet write" of the original
question is not needed: the doc events it dodged mirrored title and trash,
and those are gone [005 §4].

### 10.6 Media listing and the unused-media sweep

`list_media(node)` answers one Read check on the document, then returns
every child node paired with a signed `/f/` URL for its blob, minted with a
15-minute TTL. The page re-requests at two thirds of the TTL, so at 10
minutes [012 §2, §3].

`sweep_unused_media()` runs daily. Drive owns the whole mechanism; the app
answers one question [012 §5].

1. Select document nodes whose `content_modified` is newer than the last
   run.
2. For each, call `spec.used_nodes(docname)`.
3. Trash every Active child node of that document that is absent from the
   answer and whose `creation` is older than 7 days.
4. Trashed, never purged. The node lands in the owner's bin and follows the
   30-day clock. Nothing deletes a person's content without showing it to
   them first.

An app with no `used_nodes` is skipped, and its media is never swept.

### 10.7 Worked declarations

Each is checked against the doctype as it stands today. The "app must add"
column is the work the app owes.

**Writer Document** (`suite/writer/doctype/writer_document/`). Fields today:
`content` (the Yjs body), `settings`, `versions` (child table of
`Writer Doc Version`), `updates`, `ycomments`, `html`, `collab`. It already
has no title field and no trashed field, so it is compliant on [005 §1] and
[005 §2].

```python
SPEC = ContentTypeSpec(
	doctype="Writer Document",
	mime="frappe/writer",
	node_field="node",
	default_export="html",
	export_formats=("html",),
	create_empty=writer.drive.create_empty,
	duplicate=writer.drive.duplicate,
	export=writer.drive.export,
	version_bytes=writer.drive.version_bytes,
	restore_version=writer.drive.restore_version,
	pushes_preview=False,
	on_purge=writer.drive.on_purge,
	satellites=(),
	used_nodes=writer.drive.used_nodes,
)
```

App must add: a `node` Link field; `export` reading the stored `html`
column; `used_nodes` scanning the body for embed node ids. App must delete:
`Writer Version` (its rows become `Drive Node Version`),
the `versions` field and its child table `Writer Doc Version`,
`Writer Template` (its rows become Writer Documents with `is_template`),
`ycomments` (its comments become Drive threads),
`filter_templates` and `template_has_permission`
(`suite/writer/overrides/__init__.py:9,16`),
`new_version` and `save_comments`
(`writer_document.py:40,110`), and `update_file` (`writer_document.py:100`),
which is replaced by `touch`.

> Spec pick: Writer's default export is `html`, taken from the stored
> `html` column. Its docx exporter runs in the browser
> (`frontend/src/apps/writer/utils/docxexporter.js`), so no server-side
> docx exists today, and [009 §3] needs a format that does.

**Presentation** (`suite/slides/doctype/presentation/`). Fields today:
`slides` (child table), `title`, `slug`, `theme`, `thumbnail`,
`is_template`, `is_composite`, `reference_presentations`.

```python
SPEC = ContentTypeSpec(
	doctype="Presentation",
	mime="frappe/slides",
	node_field="node",
	default_export=None,
	create_empty=slides.drive.create_empty,
	duplicate=slides.drive.duplicate,
	export=None,
	version_bytes=slides.drive.version_bytes,
	restore_version=slides.drive.restore_version,
	pushes_preview=True,
	on_purge=slides.drive.on_purge,
	satellites=(Satellite(doctype="Slide", link_field="parent"),),
	used_nodes=slides.drive.used_nodes,
)
```

App must add: a `node` Link field; `used_nodes` reading every
`Slide.elements` `src`, `Slide.background`, and every poster.
App must delete: `title` and `is_template` (both move to the node),
`thumbnail` and its File handling (`presentation.py:109-189`, `:361-395`),
the composite public invariant (`presentation.py:29-40`), the forced-public
row (`presentation.py:47-61`), the `is_template` early return
(`presentation.py:43`), `get_permission_query_conditions` and
`has_permission` (`presentation.py:490-498`), the webp convert-and-delete
(`presentation.py:581-625`), and `suite/slides/api/file.py` entire.
Slides keeps its browser capture and pushes it through `push_preview`
[012 §8]. Conversion to webp happens before the node exists [012 §9].

**Sheet** (`suite/sheets/doctype/sheet/`). Fields today: `title`,
`sheets_data`, `head_seq`, `head_snapshot`, `trashed`, `trashed_on`,
`trashed_by`.

```python
SPEC = ContentTypeSpec(
	doctype="Sheet",
	mime="frappe/sheet",
	node_field="node",
	default_export=None,
	create_empty=sheets.drive.create_empty,
	duplicate=sheets.drive.duplicate,
	import_from_file=sheets.drive.import_from_file,
	export=None,
	version_bytes=sheets.drive.version_bytes,
	restore_version=sheets.drive.restore_version,
	pushes_preview=False,
	on_purge=sheets.drive.on_purge,
	satellites=(
		Satellite(doctype="Sheet Op Log", link_field="sheet"),
		Satellite(doctype="Sheet Collab State", link_field="sheet"),
	),
	used_nodes=sheets.drive.used_nodes,
)
```

App must add: a `node` Link field; `import_from_file` for the xlsx path.
App must delete: `title`, `trashed`, `trashed_on`, `trashed_by`,
`head_snapshot` (it retargets to a `Drive Node Version`),
`after_insert`'s `create_drive_file` (`sheet.py:55`),
`suite/sheets/trash.py` and its 30-day purge, the three DocShare endpoints
`share_sheet`, `unshare_sheet`, `get_sheet_shares`, and
`suite/sheets/permissions.py`. `Sheet Snapshot` is dropped; its rows become
`Drive Node Version` rows field for field, because its schema already
carries `seq`, `kind` (auto, milestone, named), `label`, `pinned`, and
`actor` [011 §11].

> Spec pick: Slides and Sheets declare `default_export = None`, so their
> documents stay invisible over WebDAV, which is what every content
> document does today (`suite/drive/webdav/pathmap.py:34`). Neither app has
> a server-side exporter; both export in the browser. [009 §3] already
> allows this and the field turns the behaviour on when an exporter lands.

---

## 11. HTTP API

Real routes under `/api/suite/drive/`, mounted by a translator, not a
dispatcher [014 §1, §2]. The app segment (`drive`) exists because eight
suite apps share one site and two of them want the noun `attachments`.

### 11.1 The translator

```python
# suite/drive/http/translator.py
import re

import frappe
from werkzeug.exceptions import NotFound

PREFIX = "/api/suite/drive/"
TARGET = "/api/v2/method/suite.drive.http.routes."

# (method, pattern, handler, path-segment names)
ROUTES = (
	("POST",   re.compile(r"^nodes$"),                          "node_create",   ()),
	("GET",    re.compile(r"^nodes/([^/]+)$"),                  "node_get",      ("node",)),
	("PATCH",  re.compile(r"^nodes/([^/]+)$"),                  "node_patch",    ("node",)),
	("DELETE", re.compile(r"^nodes/([^/]+)$"),                  "node_purge",    ("node",)),
	("GET",    re.compile(r"^nodes/([^/]+)/children$"),         "node_children", ("node",)),
	# ... one tuple per row of the table in 11.2
)


def handle_before_request() -> None:
	request = frappe.local.request
	path = request.path
	if not path.startswith(PREFIX):
		return

	rest = path[len(PREFIX) :].rstrip("/")
	for method, pattern, handler, names in ROUTES:
		if method != request.method:
			continue
		match = pattern.match(rest)
		if not match:
			continue

		# form_dict already holds the JSON body and the query string:
		# make_form_dict ran at frappe/app.py:221, before this hook at :226
		frappe.local.form_dict.update(dict(zip(names, match.groups(), strict=True)))
		frappe.local.form_dict.pop("cmd", None)

		target = TARGET + handler
		request.environ["PATH_INFO"] = target
		# `path` is assigned from PATH_INFO when the Request is built
		# (werkzeug/wrappers/request.py:124) and read again by
		# get_api_version() (frappe/api/__init__.py:104). frappe/app.py:215
		# already read it, so rewriting environ alone would route to v2 and
		# answer in the v1 envelope.
		request.path = target
		for cached in ("full_path", "url", "base_url"):
			request.__dict__.pop(cached, None)
		return

	raise NotFound
```

Facts this depends on, all verified on this bench.

| Fact | Where |
|---|---|
| `API_URL_MAP` is built at import time, so an app cannot add a rule | `frappe/api/__init__.py:92` |
| `before_request` runs at the end of `init_request` | `frappe/app.py:226` |
| `validate_auth()` runs after `init_request`, so API-key auth is not resolved at translate time; delegating means Drive never re-implements it | `frappe/app.py:118` |
| `/api/` is dispatched before the GET/HEAD/POST method gate, so PATCH and DELETE reach `frappe.api.handle` | `frappe/app.py:134` |
| `frappe.call(method, **frappe.form_dict)` turns form_dict keys into handler kwargs | `frappe/api/v2.py:71` |
| Success is `{"data": ...}` | `frappe/api/__init__.py:69` |
| Failure is `{"errors": [{"type", "message"}]}` | `frappe/utils/response.py:62` |

The hook is added to the existing list in `suite/hooks.py:336` beside the
WebDAV dispatcher. Suite also adds `/api/suite/drive/uploads/` to
`streaming_request_paths` so chunk bodies stream (§8.4).

Every handler in `suite/drive/http/routes.py` is `@frappe.whitelist` with
its verb declared, for example `@frappe.whitelist(methods=["PATCH"])`.
Routes reachable by a guest or a link holder add `allow_guest=True`. A
handler parses nothing beyond its arguments: it seeds principals from
`X-Drive-Links` (§4), calls the SDK, and maps the exception [014 §4].

### 11.2 Route table

`R` is the role and the node it is answered against. Every route may raise
`DriveNotFound`, `DriveLocked`, and `DriveLinkExpired`; only extra errors
are listed.

**Nodes**

| Method | Path | R | Body | `data` | Extra errors |
|---|---|---|---|---|---|
| POST | `/nodes` | UPLOAD on `parent` | `{parent, title, kind, blob?, size?, mime?, url?, content_doctype?, from_node?, content_modified?}` | node shape | 403, 409, 413 |
| GET | `/nodes/<id>` | READ on node | `?expand=access,breadcrumbs,preview` | node shape | none |
| PATCH | `/nodes/<id>` | see §8.2 | `{title}` \| `{parent}` \| `{state}` \| `{content_modified}` | node shape | 403, 409, 413 |
| DELETE | `/nodes/<id>` | MANAGE on node | none | `{purged: <n>}` | 403 |
| GET | `/nodes/<id>/children` | READ on node | `?limit=&cursor=&order_by=&ascending=&mime_prefix=` | cursor page of node shapes | 409 on a document node |
| POST | `/nodes/<id>/copy` | READ on node, UPLOAD on `parent` | `{parent, title?}` | node shape | 403, 409, 413 |
| POST | `/nodes/batch` | per node | `{nodes: [...], patch: {...}}` | batch shape | none |
| PUT | `/nodes/<id>/content` | EDIT on node | `{upload_id, checksum?, content_modified?}` | node shape | 403, 413 |
| GET | `/nodes/<id>/content` | READ on node | `?format=` for documents | 302 to a signed `/f/` URL, or the streamed export | 403 |
| GET | `/nodes/<id>/media` | READ on node | none | `{media: [{node, title, mime, size, url, expires}]}` | 403 |
| POST | `/nodes/<id>/preview` | EDIT on node | `{image: <base64>, mime}` | `{preview: {...}}` | 403 |
| GET | `/nodes/<id>/activity` | READ on node | `?limit=&cursor=` | cursor page of activity rows | none |
| POST | `/nodes/<id>/visit` | READ on node | none | `{}` | none |
| PUT | `/nodes/<id>/favourite` | READ on node | none | `{}` | none |
| DELETE | `/nodes/<id>/favourite` | READ on node | none | `{}` | none |

`GET /nodes/<id>/media` is the deck-media call. It runs one READ check on
the document, then mints a signed `/f/` URL per child node with a 15-minute
TTL. The page calls it again at 10 minutes [012 §2, §3, 014].

**Uploads**

| Method | Path | R | Body | `data` |
|---|---|---|---|---|
| POST | `/uploads` | UPLOAD on `parent` | `{parent, filename, size, mime?}` | `{mode, upload_id, ...}` |
| PUT | `/uploads/<upload_id>/chunk` | UPLOAD on `parent` | raw bytes, `?offset=` | `{upload_id, received}` |
| POST | `/uploads/<upload_id>/finish` | UPLOAD on `parent`, EDIT on `replaces` | `{parent, title, checksum?, content_modified?, replaces?}` | node shape |

`POST /uploads` returns `DriveOverQuota` (413) from the declared size, never
a permission error [010 §5, 014]. Slide media uploads use this same call
and get the same error [012].

**Grants, links, publishing**

| Method | Path | R | Body | `data` |
|---|---|---|---|---|
| GET | `/nodes/<id>/grants` | MANAGE on node | `?principal=<p>` for the explain chain | `{grants: [...], explain?: [...]}` |
| PUT | `/nodes/<id>/grants/<principal>` | MANAGE on node | `{role, expires_on?, password?}` | `{grant, url?}` |
| DELETE | `/nodes/<id>/grants/<principal>` | MANAGE on node | `?below=1` for revoke-below | `{"result": "revoked" \| "denied"}`, or `{"result": "revoked", "rows": <n>}` with `below=1` |
| POST | `/grants/<id>/rotate` | MANAGE on the grant's node | none | `{grant, url}` |
| POST | `/links/<token>/unlock` | none | `{password}` | `{ticket, expires}` |

- Publish is `PUT .../grants/$PUBLIC {role: 10}`. Unpublish is the DELETE.
  The DELETE is `revoke_or_deny` (§5.10) for every principal, not only
  `$PUBLIC`: it writes a deny when READ still reaches the principal from a
  folder above, and says which of the two it did. There are no publish verbs
  [007 §1, §6].
- `?below=1` on the DELETE is `revoke_below` (§5.10). It deletes the
  principal's grants on the node and on every node under it, and returns the
  count [002].
- A link is created with principal `$LINK`; the server mints the 22-char
  base62 token and returns `url = "/drive/l/<token>"` [008 §1, 014].
- Refusals on the grant route: `$PUBLIC` above READ; `$PUBLIC` or `$LINK`
  naming a Drive Root; `password` on a principal that is not `$LINK:*`; a
  link role above EDIT; a deny naming a Personal Root's own user inside
  that root. All are 403 [002, 007 §2, §5, 008 §8, §9].
- `rotate` mints a new token, keeps the role, the password, and the expiry,
  and writes one `share_edit` activity row carrying `old_principal`
  [008 §8].
- `unlock` verifies the passlib hash, counts failures per token in the site
  cache and refuses after 5 in 15 minutes with a 15-minute lockout, then
  returns `ticket = exp + "." + HMAC-SHA256(site_secret, token + "|" +
  password_hash + "|" + exp)` with a 30-day `exp`. No row is written
  [008 §3].

> Spec pick: `explain` is exposed as `?principal=<p>` on
> `GET /nodes/<id>/grants`, not as its own route. [014] did not list a
> route for it, and the grant rows are the explanation, so the answer
> belongs beside the rows [design].

`GET /drive/l/<token>` is a website route, not an API route. It resolves
the grant, seeds the token into the SPA, and redirects to the node route.
The node id never appears in a shared URL, and rotation changes the URL
[008 §9].

A composite deck's render is a Slides route, outside the Drive namespace.
It runs one READ check per referenced deck and returns a reference the
caller cannot read marked as unreadable, instead of dropping it silently
[007 §4, 012 §7].

**Views**

`GET /api/suite/drive/views/<name>`, cursor-paged. Frozen names:

| Name | Rows | Role |
|---|---|---|
| `shared` | the caller's grant roots outside their own Personal Root | per grant |
| `recents` | `Drive Recent` for the caller, newest first | READ |
| `favourites` | `Drive Favourite` for the caller | READ |
| `trash` | Trashed nodes where `trash_root = name`, in roots the caller reaches | READ to list; EDIT or MANAGE to restore (§8.8) |
| `archived-roots` | Archived Roots holding a grant for the caller | per grant [001] |
| `templates` | readable nodes with `is_template = 1`, `?content_doctype=` filters | READ [012 §6] |
| `search` | title matches, ancestor-union grant filtered | READ |

`DELETE /api/suite/drive/views/recents` clears the caller's recents and
never touches favourites [014]. Every view excludes `is_template` nodes
except `templates`, and no view returns the children of a document node
[012 §1, 014].

**Versions, comments**

| Method | Path | R | `data` |
|---|---|---|---|
| GET | `/nodes/<id>/versions` | READ | cursor page of version rows |
| POST | `/nodes/<id>/versions` | EDIT | `{seq}` |
| PATCH | `/nodes/<id>/versions/<seq>` | EDIT | `{label, pinned}` |
| DELETE | `/nodes/<id>/versions/<seq>` | MANAGE | `{}` |
| GET | `/nodes/<id>/versions/<seq>/content` | READ | 302 to a signed `/f/` URL |
| POST | `/nodes/<id>/versions/<seq>/restore` | EDIT | `{seq}` (the version taken first) |
| GET | `/nodes/<id>/threads` | READ | `{threads: [...]}` |
| POST | `/nodes/<id>/threads` | COMMENT | `{thread, comment}` |
| PATCH | `/threads/<id>` | COMMENT | `{resolved}` |
| POST | `/threads/<id>/comments` | COMMENT | `{comment}` |
| PATCH | `/comments/<id>` | EDIT or author | `{}` |
| DELETE | `/comments/<id>` | EDIT or author | `{}` |

**Notifications, roots, admin**

| Method | Path | R | Body | `data` |
|---|---|---|---|---|
| GET | `/notifications` | own | `?limit=&cursor=&unread=` | cursor page of `{activity, read, ...}` |
| POST | `/notifications/read` | own | `{notifications: [...]}` or `{all: true}` | `{read: <n>}` |
| GET | `/roots/<id>/usage` | own root, or Suite Admin for any | none | `{used_bytes, reserved_bytes, quota_bytes, effective_quota}` |
| PATCH | `/roots/<id>` | Suite Admin | `{quota_bytes}` \| `{state}` | root shape |
| DELETE | `/roots/<id>` | Suite Admin | none | `{purged: <n>}` |

`DELETE /roots/<id>` purges every node in an Archived Root. Only a Suite
Admin may call it, and only on an Archived Root. There is no reclaim clock
[010 §7]. The reservation functions stay Python-only for Meet and get no
HTTP endpoint [010 §3, 014].

### 11.3 The node shape

Base fields, identical in a list row and in a detail fetch [014 §7]:

```json
{ "name": "a1b2c3d4e5", "title": "Q3 deck", "kind": "document",
  "parent": "f9e8d7c6b5", "root": "r1a2b3c4d5", "state": "Active",
  "size": 0, "mime": "frappe/slides", "url": null,
  "content_doctype": "Presentation", "content_docname": "deck-7",
  "is_template": 0, "owner": "priya@example.com",
  "creation": "2026-09-01 09:14:22", "modified": "2026-09-04 11:02:10",
  "content_modified": "2026-09-04 11:02:10" }
```

Three expansions, each costing its queries only when named in `?expand=`:

| Name | Adds |
|---|---|
| `access` | `{"role": 40, "via_link": "$LINK:...", "source_node": "...", "source_principal": "..."}` |
| `breadcrumbs` | `[{"name", "title"}]` from the root down to the parent |
| `preview` | `{"url": "/f/<blob>/<file>?e=&s=", "expires": <epoch>}` |

### 11.4 Cursor

```json
{ "data": { "rows": [ ... ], "next_cursor": "b2Zmc2V0OjUw" } }
```

- The cursor is opaque. The client echoes it back and never parses it.
- It holds a base64 offset today and can hold a keyset later with no call
  site changed [014 §6].
- `next_cursor` is `null` on the last page.
- `limit` defaults to 60 and is capped at 200.
- A page of 60 may return fewer rows, because permission filtering happens
  after the SQL window. There is no page count and no page jumping
  [014 §6].

### 11.5 Batch

```
POST /api/suite/drive/nodes/batch
{ "nodes": ["a", "b", "c"], "patch": { "parent": "folder-9" } }

{ "data": { "ok": ["a", "b"],
            "failed": [ { "node": "c", "type": "DriveForbidden",
                          "message": "..." } ] } }
```

Partial success is a result, not an error, and the response is 200. `patch`
takes the same fields as `PATCH /nodes/<id>`. One gesture is one request
and produces one activity row per node that moved [014 §8].

### 11.6 Errors

```python
# suite/drive/sdk/errors.py
class DriveError(frappe.ValidationError):
	http_status_code = 400

class DriveNotFound(DriveError):    http_status_code = 404
class DriveForbidden(DriveError):   http_status_code = 403
class DriveLocked(DriveError):      http_status_code = 401
class DriveLinkExpired(DriveError): http_status_code = 410
class DriveOverQuota(DriveError):   http_status_code = 413
class DriveConflict(DriveError):    http_status_code = 409
```

| Condition | Class | Status |
|---|---|---|
| Node missing, or hidden from you | `DriveNotFound` | 404 |
| Role below what the act needs | `DriveForbidden` | 403 |
| Password link, no ticket | `DriveLocked` | 401 |
| Link past `expires_on` | `DriveLinkExpired` | 410 |
| Admission `UPDATE` hit zero rows | `DriveOverQuota` | 413 |
| Title taken, or node moved under itself | `DriveConflict` | 409 |

The body is the v2 envelope, produced by the framework:

```json
{ "errors": [ { "type": "DriveOverQuota",
                "message": "Needs 4 MB, 1 MB free" } ] }
```

The class name is the code. Over quota is never a permission error, a
locked link is never a 403, and an expired link is never a locked one
[014 §5].

### 11.7 The shim plan

Build adds the routes and keeps every one of the 69 old whitelisted method
names as a thin forwarder into the new SDK. Cleanup deletes the forwarders
one release later, gated on the SPA having moved [014 §9]. Counted from the
code on this bench: 69 methods in 11 files, 26 of them guest-callable.

**`suite.drive.api.files` (26)**

| Old name | New route |
|---|---|
| `upload_file` | `POST /uploads`, `PUT /uploads/<id>/chunk`, `POST /uploads/<id>/finish` |
| `create_folder` | `POST /nodes` with `kind=folder` |
| `create_link` | `POST /nodes` with `kind=link` |
| `rename` | `PATCH /nodes/<id>` `{title}` |
| `move` | `PATCH /nodes/<id>` `{parent}`, or `POST /nodes/batch` |
| `remove_or_restore` | `PATCH /nodes/<id>` `{state}`, or `POST /nodes/batch` |
| `delete_entities` | `DELETE /nodes/<id>`, or `POST /nodes/batch` |
| `update_access` | `PUT`/`DELETE /nodes/<id>/grants/<principal>` |
| `set_favourite` | `PUT`/`DELETE /nodes/<id>/favourite` |
| `track_visit` | `POST /nodes/<id>/visit` |
| `remove_recents` | `DELETE /views/recents` |
| `search` | `GET /views/search` |
| `get_file_content` | `GET /nodes/<id>/content` |
| `stream_file_content` | `GET /nodes/<id>/content` |
| `get_thumbnail` | `GET /nodes/<id>?expand=preview` |
| `download_folder` | `GET /nodes/<id>/content` on a folder |
| `download_status` | `GET /nodes/<id>/content` on a folder |
| `download_archive` | `GET /nodes/<id>/content` on a folder |
| `create_auth_token` | dropped; `/f/` signatures replace it [008] |
| `does_entity_exist` | `GET /nodes/<id>` |
| `get_new_title` | dropped; `DriveConflict` replaces it (§8.6) |
| `get_entity_type` | `GET /nodes/<id>` |
| `get_root_folder` | `GET /roots/<id>/usage` and the node shape's `root` |
| `redirect_to_original` | `GET /nodes/<id>` |
| `translate_old_name` | kept as a forwarder over `Drive Legacy Route` |
| `resolve_legacy_route` | kept as a forwarder over `Drive Legacy Route` |

**`suite.drive.api.list` (6)**: `files` to `GET /nodes/<id>/children`;
`shared`, `favourites`, `recents`, `trash` to `GET /views/<name>`;
`get_attachments` to `GET /nodes/<id>/media`.

**`suite.drive.api.permissions` (4)**: `get_user_access` and
`get_general_access` to `GET /nodes/<id>?expand=access`;
`get_entity_with_permissions` to
`GET /nodes/<id>?expand=access,breadcrumbs,preview`; `get_shared_with_list`
to `GET /nodes/<id>/grants`.

**`suite.drive.api.activity` (1)**: `get_entity_activity_log` to
`GET /nodes/<id>/activity`.

**`suite.drive.api.notifications` (3)**: `get_notifications` and
`get_unread_count` to `GET /notifications`; `mark_as_read` to
`POST /notifications/read`.

**`suite.drive.api.storage` (2)**: `storage_breakdown` and
`storage_bar_data` to `GET /roots/<id>/usage`.

**`suite.drive.api.scripts` (2)**: `sync_preview` to
`POST /nodes/<id>/preview`; `sync_from_disk` is dropped, because Build
takes over the disk import.

**`suite.drive.api.embed` (1)**: `get_file_content` to
`GET /nodes/<id>/media`.

**`suite.drive.api.product` (19)**: `get_my_invites`, `get_pending_invites`,
`signup`, `oauth_providers`, `send_otp`, `verify_otp`, `get_settings`,
`set_settings`, `invite_users`, `get_users`, `get_user_groups`,
`accept_invite`, `reject_invite`, `get_translations`, `is_site_admin`,
`disk_settings`, `webdav_config`, `set_webdav_enabled`, `signup_disabled`.
None of these touch a node. They stay on `/api/method/` and are outside the
Drive route namespace.

**`suite.drive.api.s3` (1)**: `fetch`. Permanent.

**`suite.drive.overrides.file` (4)**: `get_file_for_doc` permanent; the
whitelisted `File` document methods `share`, `unshare`, and `rename` are
dropped in Cleanup with the `File` override itself.

Three names are permanent whatever else happens [014 §9]:

| Name | Why |
|---|---|
| `suite.drive.api.s3.fetch` | it sits inside stored `File.file_url` values |
| `suite.drive.overrides.file.get_file_for_doc` | it sits inside the checked-in bundle `suite/public/frontend/assets/sdk-o7hlQ1xj.js` |
| `/dav` | it sits inside third-party file managers |

Hardening: Build adds `/api/suite/drive/` to `ALLOWED_WILDCARD_PATHS` and
Cleanup removes `/api/method/suite.drive.api.`
(`suite/hooks.py:429-446`). Site-wide enforcement is out of scope;
`DENIED_WILDCARD_PATHS = ["/api/"]` is declared at `suite/hooks.py:450`
and nothing in suite or frappe reads it, so the gate is external
[014 §10].

---

## 12. WebDAV

One mount: the user's Personal Root [009 §1 as amended by 010 §10].
`PROPFIND /dav/` lists that root. There is no `Everyone` mount, no
`Shared with me` collection, no grant-root query, and no collision suffix.
Content in the Shared Root or shared from another Personal Root is not
reachable over DAV. No DAV MOVE crosses roots.

### 12.1 Role per method

| Method | Role | Where |
|---|---|---|
| OPTIONS | none | pre-auth |
| PROPFIND | READ on the target; a child shows when its role is READ or higher | |
| GET, HEAD | READ | node |
| PUT, create | UPLOAD | parent |
| PUT, replace | EDIT | node |
| MKCOL | UPLOAD | parent |
| DELETE | EDIT (trash) | node |
| MOVE | EDIT on the source, UPLOAD on the destination parent, EDIT on an overwritten target | |
| COPY | READ on the source, UPLOAD on the destination parent; unreadable children skipped | |
| LOCK, existing node | EDIT | node |
| LOCK, unmapped URL | UPLOAD | parent |
| UNLOCK | the lock owner, or a Suite Admin | |
| PROPPATCH | EDIT | node |

Unreadable is always 404, never 403. The Suite Admin bypass applies to what
an admin reaches by path; there is no admin mount of other users' roots
[009 §2].

### 12.2 Content documents

A document node lists as `<title>.<ext>` in its content type's
`default_export`. An app that declares none stays invisible [009 §3, §10.7].

- GET streams the export. `getcontentlength` is omitted.
- PUT, LOCK, and a content PROPPATCH on it are 403.
- MOVE, rename, DELETE, and COPY work as node operations. COPY calls the
  declared `duplicate`.
- A rename must keep the extension, else 403; the title becomes the stem.
- A document node is a leaf. Its child nodes never appear [009 §3, 012 §1].
- Name collision with a real file: the document keeps the name and the file
  shows as `<stem> (2).<ext>`, oldest first. Lookup tries a document match,
  then a file match. A MOVE overwrite onto a document trashes the document.

### 12.3 GET, PUT, LOCK, COPY

**GET** authorizes by node, then streams through the framework's public
stream-read with `send_file(conditional=True)` for Range and 304.
`drive_webdav_s3_redirect` survives as the opt-in 302 to a signed native
URL. Range on non-local drivers is a framework ask (§13) [009 §4].

**PUT** spools the body straight into
`frappe.storage.blob.put_blob(stream, is_private=True, filename=...)`.
There is no upload session; sessions are the browser's chunked path. Quota
is preflighted from `Content-Length`, or the spool ceiling is the free bytes
when the length is absent, and the admission `UPDATE` runs at commit
[009 §5, 010 §5]. Every replace keeps the old head as an `auto` version,
except a head of size 0 (§8.5). Deleted with this: the disk and S3 staging,
the generation keys, the compensation, and the drift repair in
`suite/drive/webdav/put.py:340-800`. `put_blob` is atomic.

**LOCK on an unmapped URL** creates an empty Active node under UPLOAD on the
parent, and the creator grant fires as for any create. The node holds no
blob. If the lock expires with no PUT, the empty node stays [009 §6].

**COPY** is the Drive copy primitive of §8.9. Blobs are shared, grants and
versions are not copied, dead properties are cloned [009 §8].

### 12.4 `content_modified`, ETag, auth, quota

- `content_modified` feeds `getlastmodified` and is set by a client mtime
  header (§8.11) [009 §9].
- ETags stay strong: the blob checksum for a file node, and
  `content_modified` plus the latest version seq for a document
  [009 §9]. Today's fallback shape is at
  `suite/drive/webdav/properties.py:19`.
- Auth stays HTTP Basic with a site password or an API key and secret,
  per-user opt-in, Guest refused. A DAV session's principals are the
  signed-in user's: email, groups, `$GENERAL`, `$PUBLIC`. No
  `$LINK:<token>` is ever added [008 §9, 009 §11].
- `quota-used-bytes` = `Drive Root.used_bytes` of the Personal Root.
  `quota-available-bytes` = `max(0, quota - used)`, omitted when the root is
  unlimited (RFC 4331 §4) [010 §9].
- DAV handlers call the same SDK and produce the same activity rows. The
  actor is the session user, and the `client` column holds the User-Agent
  [009 §10].

### 12.5 Modules kept and deleted

Kept, relinked to `Drive Node`: `dispatch`, `auth`, `context`, `pathmap`
(title lookup on the frozen `(parent, state, title)` index), `propfind`,
`proppatch`, `deadprops`, `locks`, `lock`, `ifheader`, `conditional`,
`xmlutil`, `options`, `settings`, `log`. `Drive DAV Lock` and
`Drive DAV Property` keep their shape with `entity` retargeted.

Deleted: `perms.py` (the engine's folder-page batch replaces it), the
storage machinery in `put.py`, and every direct `manager.*` call in `get`,
`copy`, `structure`, and `lock`.

A Depth 1 PROPFIND costs the engine's three folder-page queries plus one
dead-property fetch and one lock fetch. The method allow-list, the per-user
opt-in, and the log settings survive. Litmus stays the acceptance test
[009 §12].

---

## 13. Framework asks (storage_v2)

Branch `forge/storage-v2` in `apps/frappe`. Seven asks. Each is a public
function or a keyword on one, never a hook: the map forbids new framework
hooks [design, 003]. Signatures are written against the code on the branch
today.

| # | Ask | Blocker |
|---|---|---|
| 1 | GC reference discovery [003] | **Yes.** Nothing ships before it. |
| 2 | `finish_upload_to_blob()` | **Yes.** The browser upload path needs it. |
| 3 | `signed_url_for_blob()` | **Yes.** Previews, media, and downloads need it. |
| 4 | `after_file_upload` never fires on the v2 path | No. Drive stops using the hook. |
| 5 | Public stream-read with Range on non-local drivers | **Yes on an S3 site**, for WebDAV GET. No on a local-disk site. |
| 6 | `relocate_blobs()` [011 amendment] | No. It runs after Build; Build and Cleanup do not depend on it. |
| 7 | `restrict_mimetypes` keyword on `create_upload` | **Yes.** Drive's upload path refuses ordinary files without it. |

Asks 1 to 6 come from the tickets. Ask 7 was found while writing §8.4 and
is new here.

### 13.1 GC reference discovery [003]

`frappe/storage/gc.py` counts only `tabFile` references today
(`get_orphan_blobs`, `is_still_orphan`). A blob held only by a `Drive Node`
row is deleted after 24 h. That is data loss.

The mechanism is meta-driven, with no hook. GC discovers reference columns
from meta at run time. It calls
`frappe.model.rename_doc.get_link_fields("File Blob")`
(`frappe/model/rename_doc.py:460`), the same discovery that rename and
delete already trust. That query returns standard DocFields, Custom Fields,
and Property Setter overrides, skips virtual doctypes, and flags Single
doctypes. Nothing is registered. An app that adds a Link field with
`options: File Blob` is covered on its next GC run.

**Reference rule.** A blob is live while any Link field with
`options: File Blob` names it. Nothing else keeps a blob alive: not a Data
column, not a Dynamic Link, not a blob name inside JSON. An app that holds a
blob any other way must also write a Link row.

```python
# frappe/storage/gc.py

def blob_reference_columns() -> list[dict]:
	"""Every Link column pointing at File Blob, from meta.

	Returns [{"doctype": str, "fieldname": str, "issingle": 0 | 1}]. Public
	function, not a hook. Raises nothing: the caller decides what a
	discovery failure means."""


def orphan_predicate(blob_alias: str = "b") -> str:
	"""One NOT EXISTS per discovered column, as one SQL fragment.

	Normal and child doctypes probe their own table. Single doctypes probe
	`tabSingles` filtered by doctype and field. Virtual doctypes are
	skipped: they have no table."""
```

The candidate query becomes:

```sql
select b.name, b.key, b.driver, b.is_private
from `tabFile Blob` b
where b.modified < %(cutoff)s
  and not exists (select 1 from `tabFile` where blob = b.name)
  and not exists (select 1 from `tabDrive Node` where blob = b.name)
  and not exists (select 1 from `tabDrive Node Version` where blob = b.name)
  and not exists (select 1 from `tabDrive Node Preview` where blob = b.name)
  and not exists (select 1 from `tabDrive Node Preview` where source_blob = b.name)
  and not exists (select 1 from `tabSingles`
                  where doctype = 'X' and field = 'y' and value = b.name)
limit %(batch)s
```

Behaviour, four rules from [003]:

1. `get_orphan_blobs` and `is_still_orphan` both build their predicate from
   `orphan_predicate()`, so the batch selection and the re-check under the
   row lock can never disagree.
2. **Unindexed reference column: include and warn.** Every discovered column
   is always in the predicate. A column without an index makes the run slow,
   never wrong. GC logs one warning per unindexed column per run, checked
   through `frappe.db.has_index` or the DocField `search_index` flag; either
   is accepted. Rejected: aborting the sweep, because one forgotten index on
   any app then stops cleanup site-wide.
3. **Discovery failure: delete nothing.** When the meta query fails, or a
   discovered doctype has no table (`TableMissingError`, an app installed
   but not migrated), the run logs an error and returns with
   `blobs_deleted = 0`. Upload-session expiry still runs. A blob kept one
   more day costs disk. A blob deleted under an incomplete reference set
   costs data.
4. The guard wraps discovery and the first candidate query.

Rejected: a `storage_blob_references` hook (a hook is one more thing an app
can forget); a hybrid of both (two mechanisms for one question); a Python set
difference (it reads every referencing table in full per batch); a LEFT JOIN
per column (it row-multiplies when one blob has many rows in one table) [003].

Cost per run on a suite site: five indexed probes per candidate blob (File
plus Drive's four columns), plus one per future column. Bounded by the
500-row batch (`gc.py:16`). No full scan of any referencing table.

Tests [003 §4]: a blob held only by a non-File Link survives GC; a blob held
only by a Single survives; a Custom Field Link counts; a missing table makes
the run delete nothing; the unindexed warning fires. Drive-side:
`blob_reference_columns()` contains all four columns of §3.17.

### 13.2 `finish_upload_to_blob()`

`frappe.storage.upload.finish_upload` always ends by calling
`create_file_from_blob` (`upload.py:166`), so a resumable session cannot end
without a framework `File` row. Drive's uploads end in a `Drive Node`.

```python
# frappe/storage/upload.py

def finish_upload_to_blob(
	upload_id: str,
	*,
	checksum: str | None = None,
	filename: str | None = None,
	is_private: bool | None = None,
) -> "FileBlob":
	"""Turn a finished session into a blob. No File row.

	Everything finish_upload does up to and including validate_upload: load
	the session, re-check the upload permission, refuse an empty session,
	claim the session atomically (claim_session), spool the parts or the
	direct object through put_blob, compare the checksum, validate the
	content. Then delete the session and return the blob."""
```

`finish_upload` becomes a wrapper: call `finish_upload_to_blob`, then
`create_file_from_blob`. Behaviour on the existing path does not change.

Tests: a chunked session finishes to a blob and creates no `File` row; a
direct session finishes and deletes the temporary object; a checksum mismatch
raises and deletes the session; two concurrent finishes leave one winner (the
`os.rename` claim holds); `finish_upload` still creates the same `File` row.

### 13.3 `signed_url_for_blob()`

`frappe.storage.url.signed_url(file, expires_in)` takes a `File` doc and
reads `file.blob` and `file.file_name` (`url.py:48`). Node-addressed egress
has no `File` row.

```python
# frappe/storage/url.py

def signed_url_for_blob(
	blob: "str | FileBlob",
	filename: str,
	expires_in: int = 3600,
) -> str:
	"""Expiring download URL for a blob, with a caller-chosen filename.

	Prefers the driver's native signed URL, as signed_url does. Falls back to
	/f/<blob>/<filename>?e=<epoch>&s=<sig>, signed with
	make_signature(blob.name, filename, expires)."""
```

`signed_url(file, expires_in)` becomes
`signed_url_for_blob(file.blob, file.file_name or file.blob, expires_in)`.
The `/f/` route needs no change: it accepts a valid HMAC before it touches
any table (`serve.py:88`), so node-authorized egress needs no new seam
[design].

Tests: a signed URL verifies through `verify_signature`; a URL past `e` is
refused; a filename that differs from the signed one is refused; an S3 blob
returns the driver's presigned URL; `signed_url(file)` is unchanged.

### 13.4 `after_file_upload` never fires on the v2 path

The hook fires in `frappe/handler.py:241`, inside `upload_file` only.
`finish_upload` never calls it, so an app that adopts an uploaded row through
the hook loses that adoption under the flag.

Ask: run the `after_file_upload` hooks on the new `File` doc inside
`create_file_from_blob` (`frappe/core/doctype/file/file_v2.py:231`), before
the insert, with `handler.py`'s contract (each hook takes `doc=` and returns
the doc).

Not a blocker for Drive: `suite.drive.overrides.file.after_file_upload` is
deleted, because Drive owns its endpoints and adopts no framework row. The
ask stands for every other app on the branch.

Tests: a registered hook fires on `finish_upload`, before the insert, and a
mutation it makes is saved; `upload_file` is unchanged.

### 13.5 Public stream-read with Range on non-local drivers

WebDAV GET authorizes by node, then streams with
`send_file(conditional=True)` for Range and 304 [009 §4]. Today
`frappe/storage/serve.py:134` gets Range for the local driver only, because
`send_file` needs a real path. `S3Driver.read` returns a botocore
`StreamingBody` (`s3_driver.py:76`), which is not seekable, so a Range
request over S3 sends the whole object.

```python
# frappe/storage/driver.py
class StorageDriver(ABC):
	def read_range(self, key: str, start: int, end: int | None, *, is_private: bool = False) -> IO[bytes]:
		"""Bytes [start, end] inclusive. Default: read all and slice."""

# frappe/storage/serve.py
def stream_blob(
	blob: "str | FileBlob",
	filename: str,
	*,
	as_attachment: bool = False,
	environ: dict | None = None,
) -> Response:
	"""Public: serve a blob's bytes to the current request.

	The response modes of build_response, without the permission check and
	without make_access_log: native redirect, X-Accel-Redirect, send_file for
	a local path, and a 206 built from read_range for a non-local driver with
	a Range header. The caller has already authorized the read."""
```

`S3Driver.read_range` passes `Range="bytes=<start>-<end>"` to `get_object`.
A driver without it keeps working through the default. `serve_file` keeps its
own permission check and calls `stream_blob` for the body.
`drive_webdav_s3_redirect` survives as the opt-in 302 to a signed native URL.
Rejected: always 302 to a signed `/f/` URL, because it breaks the Windows
WebClient [009 §4].

Tests: `Range: bytes=0-99` returns 206 and 100 bytes on the local driver and
on the memory driver; an open-ended range returns the tail; an unsatisfiable
range returns 416; a matching `If-None-Match` returns 304; `stream_blob`
writes no access log and runs no permission query.

### 13.6 `relocate_blobs()` [011 amendment]

After Build, an S3 suite site holds blobs in two places: Drive's objects
copied into the framework layout (`driver = s3`) and legacy attachments under
`Home` linked in place on local disk (`driver = local`, `../<rel_path>` keys,
`backfill.py:148`). One storage location is a framework job, not a suite job.

```python
# frappe/storage/relocate.py

def relocate_blobs(batch_size: int = 100, target_driver: str | None = None) -> dict:
	"""Move every blob whose driver is not the configured one. Resumable.

	Per blob: copy the bytes to the target driver under make_key(checksum),
	take the row lock the GC takes (get_value(..., for_update=True)), rewrite
	`driver` and `key`, commit, then delete the old bytes through
	frappe.db.after_commit. Returns {"moved", "bytes", "skipped", "errors"}.
	Commits per batch, so a stopped run resumes: a blob already on the target
	driver is skipped."""
```

It needs no Drive knowledge and no Drive code, runs after Build at any time,
and on a local-disk site folds the in-place `../` files into the blobs
directory. The old bytes go after commit, so a crash leaves an unreferenced
object, never a blob row pointing at nothing.

Rejected: a suite job in Build or Cleanup (Drive would then write and delete
bytes, and would copy a key layout that already drifted from the spec once);
leaving two locations [011 amendment].

Tests: a local blob moves to S3 with matching bytes, a rewritten `driver` and
`key`, and no old file; a rerun after an interrupted batch moves the rest; a
blob already on the target is untouched; a driver error on one blob is logged
and the run continues; a blob deduped onto an existing target key keeps one
row; a GC run during a relocation deletes nothing live.

### 13.7 `create_upload` gates that Drive must not inherit

`frappe.storage.upload.create_upload` runs two gates before any byte lands
(`frappe/storage/upload.py:45-46`), and `finish_upload` runs them again
(`upload.py:135-136`):

| Gate | What it does | Why Drive must skip it |
|---|---|---|
| `check_upload_permission` (`upload.py:263`) | a Guest is refused unless `allow_guests_to_upload_files` is on and the target doctype is allow-listed | an UPLOAD link lets a Guest upload [008 §5]. Drive has already resolved the role from the grant. |
| `check_restricted_mimetypes` (`upload.py:288`) | a user without desk access may upload only `frappe.handler.ALLOWED_MIMETYPES` | every Drive website user lacks desk access. A drive that refuses a `.zip` is not a drive. |

Drive passes no `doctype` and no `docname`, so the first gate has no
document to check and only its Guest branch bites. Drive's own UPLOAD check
already ran (§8.4 step 2).

```python
# frappe/storage/upload.py

def create_upload(
	filename: str,
	size: int,
	is_private: bool | int | str = 0,
	doctype: str | None = None,
	docname: str | None = None,
	*,
	check_permission: bool = True,
	restrict_mimetypes: bool = True,
): ...


def finish_upload(
	upload_id: str,
	*,
	check_permission: bool = True,
	restrict_mimetypes: bool = True,
	**kwargs,
): ...
```

Both default to `True`, so every existing caller is unchanged. `False`
skips the matching gate. `finish_upload_to_blob` (§13.2) takes the same two
keywords and stores them in the session at create time, so a finish cannot
re-apply a gate the create waived. `check_declared_size` and
`validate_upload`'s content sniff are never waived.

Rejected: a Drive copy of the session machinery (it re-implements chunk
accounting and the `os.rename` claim); giving every Drive user desk access.

Tests: a session created with `restrict_mimetypes=False` accepts a `.zip`
for a website user and finishes; the default still refuses it; a Guest
session with `check_permission=False` is created and finished with guest
uploads off site-wide; `upload_file` and the existing `create_upload`
callers are unchanged.

---

## 14. Migration

Two patches: additive Build, then Cleanup one release later [011 §1].

### 14.1 Build gate

Build throws when any of these is false [011 §2]:

| Check | Reason |
|---|---|
| `frappe.storage.enabled()` | a site must not half-migrate |
| `Drive Disk Settings.enabled` (S3) implies `storage_driver = "s3"` and `storage_driver_config` in `site_config` | the S3 copy step needs a configured driver |

Build then calls `frappe.storage.backfill.run()` itself. It is idempotent
(`frappe/storage/backfill.py:31`) and links every local Drive file to a
blob in place. A local row still without a blob becomes a node with no blob
and is listed in the report. Build runs in `post_model_sync`; the rename of
`Drive Entity Log` to `Drive Recent` is a `pre_model_sync` step
[011 §13].

Precondition outside this spec: Frappe Cloud must allowlist
`storage_driver` and `storage_driver_config` before `suite.frappe.io`
migrates.

### 14.2 Build order

1. Gate.
2. `frappe.storage.backfill.run()`.
3. S3 copy step: for each Drive `File` row whose `file_url` is a
   `suite.drive.api.s3.fetch?path=` URL and which has no blob, stream the
   object once to compute its sha256, server-side `CopyObject` it to
   `private/<ab>/<cd>/<sha256>[.ext]` (`frappe/storage/blob.py:39`) in the
   same bucket, insert one `File Blob` with `driver = "s3"`, and set
   `File.blob`. Objects above 5 GB go through the boto3 managed multipart
   copy. The step is resumable by the `File.blob` check [011 §3].
4. Roots.
5. Nodes, walked from each root by depth, with title dedupe and trash
   propagation.
6. Grants, from `Drive Permission` and Sheet `DocShare`.
7. Versions and comments.
8. Slides media, decks, previews, and templates (§14.7).
9. Favourites, recents, activity, legacy routes, DAV locks and properties.
10. Content document node links.
11. Settings, quotas, reservations.
12. `used_bytes` recompute, run as the last step.
13. Report.

Every target row keeps its source id, so a rerun skips rows that exist.
Commit per batch of 1000 rows, so a stopped run resumes. Bulk SQL inserts
for nodes, grants, and side tables; the ORM only where bytes are written
[011 §13].

### 14.3 Roots and ids

`Drive Node.name = File.name`, and a root keeps the name of the File row it
came from. New nodes keep generating 10-char hashes. Build needs no id map,
so bookmarks, shared URLs, and every side table keep working [011 §4].

| Source | Becomes |
|---|---|
| the `Drive` folder | the one Shared Root, state Active |
| `Users/<email>` | a Personal Root with `user = <email>`; Active when the User is enabled, Archived when the User is disabled or gone |
| children of a root folder | top-level nodes of that root, `path = ""` |
| the `Users` row | dropped |
| a user with no folder | no row; a Personal Root is created lazily on first use |

### 14.4 Nodes

Only rows reachable by walking `folder` up to `Drive` or a `Users/<email>`
folder become nodes. Framework attachments under `Home` stay File rows.
Broken chains are skipped and reported [011 §6].

| `Drive Node` | From |
|---|---|
| `title` | `file_name` |
| `parent` | `folder`, NULL directly under a root |
| `root` | the root reached |
| `path` | ids of the ancestors below the root |
| `kind` | `folder` if `is_folder`; `link` if `file_type = "Link"` (with `url = file_url`); `document` if `content_doctype` is `Writer Document`, `Presentation`, or `Sheet` (with the content ref); else `file` |
| `blob` | `File.blob`, file nodes only |
| `size` | `file_size` for files, 0 for folders |
| `mime` | `mime_type` |
| `content_modified` | `file_modified` |
| `owner`, `creation`, `modified` | copied |

A row with `content_doctype = "File"` (an adopted library attachment,
`suite/drive/overrides/file.py:624`) becomes a plain file node from its own
blob; the content link is dropped.

**Trash** [011 §7]: a row with status Trashed becomes a Trashed node with
`trash_root = itself` and `trashed_at = file_modified`. Every Active
descendant of a Trashed row also becomes Trashed, with `trash_root` and
`trashed_at` copied from the nearest Trashed ancestor. Rows with status
Removed, and everything below them, are not migrated and are counted.

**Titles** [011 §8]: Active siblings sharing a title are deduped by the
`get_new_file_name` rule: the oldest keeps it, later ones get ` (2)`,
` (3)`. Every rename is reported. Trashed siblings are left alone.

### 14.5 Grants

Per `Drive Permission` row. Grants round down, denies round up [002].

| Row | Becomes |
|---|---|
| `deny = 1`, any flags | NONE (total deny) |
| `share` and `write` | MANAGE |
| `write` | EDIT |
| `upload` | UPLOAD (gains read; forced by the strict ladder) |
| `comment` | COMMENT |
| `read` only | READ |
| `share` without `write` | share ignored; the highest content flag wins |
| no flags | dropped |

`user = ""` rows [007, 008, 011 §9]:

| Row | Becomes |
|---|---|
| read only | one `$PUBLIC` READ grant |
| above read | one `$PUBLIC` READ grant plus one `$LINK:<token>` grant at the mapped level, fresh 22-char base62 token, `password_hash = NULL`, `expires_on = NULL` |
| deny | one `$PUBLIC` deny |
| on a Drive Root | dropped, counted |
| forced-public rows on composite decks (`presentation.py:47`) | dropped, not mapped [011 amendment] |

Sheet `DocShare` rows become grants on the sheet's node: `read` to READ,
`write` to EDIT, the `everyone` row to `$GENERAL` at the same level. Rows
for missing users are dropped and counted [011 §11].

Dropped and counted: rows naming a User or User Group that no longer
exists; rows on an unmigrated entity; rows with no flags; rows invalid
under the root guardrails. Duplicate `(entity, user)` rows collapse as
`dedupe_drive_permissions.py` does: deny wins, else the most permissive.
Every grant gets `expires_on = NULL`. Grants on Trashed nodes are kept.

Anchors: the owner row on `Users/<email>` becomes MANAGE for that user on
the Personal Root; `$GENERAL` read on `Drive` becomes `$GENERAL` READ on
the Shared Root. Migrated sites keep what their row maps to; the fresh-site
`$GENERAL` UPLOAD anchor is not forced on them [002, 011 §9].

### 14.6 Side tables and content-app data

| Source | Target | Rule |
|---|---|---|
| `Drive Favourite` | `Drive Favourite` | copied unchanged, retargeted |
| `Drive Entity Log` | `Drive Recent` | renamed pre-model-sync; `last_interaction` becomes `opened_at` |
| `Drive Entity Activity Log` | `Drive Activity` | `message`, `old_value`, `new_value`, `meta_value` fold into `detail`; verbs map one for one, except `delete` (see below) |
| `Drive Notification` | none | dropped; they carry no activity link, so the inbox starts empty |
| `Drive Legacy Route`, `Drive DAV Lock`, `Drive DAV Property` | same | retargeted by the node identity map |
| `Drive Token` | none | dropped; it is not a link [008] |
| `Writer Version` | `Drive Node Version` | ids kept; `manual` maps to kind `named`, else `auto`; `label` from `title`; `seq` by creation order; bytes are the snapshot HTML through `put_blob` |
| `Sheet Snapshot` | `Drive Node Version` | field for field; bytes are the snapshot JSON; `Sheet.head_snapshot` retargets to the version row |
| Writer `ycomments` | `Drive Comment Thread` and `Drive Comment` | anchor = the comment id; mentions go into `detail` |
| Sheets cell threads in `sheets_data` | same | anchor = sheet plus cell id |

**The old `delete` verb** (§3.8, §9.4). `Drive Entity Activity Log` has one
`delete` verb for three acts. Build maps each row by the `File.status` of
the entity it names, read at map time:

| `File.status` of the named row | `Drive Activity.action` |
|---|---|
| Trashed | `trash` |
| Removed, or the File row is gone | `delete` |
| Active | `restore` |
| any other case | `trash` |

A row whose entity is Active is a restore: the last `delete`-verb act on it
put it back. A row that names no migrated node is dropped and counted.
Build writes `detail.migrated = true` on every mapped row, so a reader can
tell a derived verb from a recorded one.

Build migrates every version; the daily thinning job applies the ladder
afterwards, and the report counts what it will thin. Each content doc gets
its `node` link from its File row. When `File.status` and `Sheet.trashed`
disagree, File wins and the case is reported. A content doc with no File
row, Presentation templates excepted, gets a node created in its owner's
Personal Root and is reported [011 §11].

### 14.7 Slides media, previews, and templates

From the [012] amendment to [011]:

- Slide media `File` rows (`attached_to_doctype = "Presentation"`) become
  child nodes of the deck node, one node per deck per blob. Duplicates
  within a deck collapse to one node. A video poster is a media node like
  any other.
- `Slide.elements` JSON is rewritten: `src` holds the node id,
  `attachmentName` is dropped. `Slide.background` and legacy `/files/`
  paths are rewritten the same way. A legacy `poster` may be a dict, not a
  string.
- `Presentation.thumbnail` Files become `Drive Node Preview` rows on the
  deck node. The field and its `attached_to_field` handling go.
- Template decks (`is_template = 1`) gain nodes in Administrator's Personal
  Root under `Templates`, each with a `$GENERAL` READ grant and
  `Drive Node.is_template = 1`. They have no node today
  (`presentation.py:43`), so this is a create, not a move.
- `Writer Template` rows become `Writer Document` rows with nodes and
  `is_template`, granted the same way. The doctype is then dropped.
- Media nodes get no preview rows at migration; the daily gap sweep fills
  them. Deck previews come from the thumbnail Files above.

### 14.8 Settings, quota, reservations

| Source | Target |
|---|---|
| `Drive Disk Settings.quota` (MB) | `default_personal_quota` (bytes, value x 1024^2) |
| none | `shared_quota` starts at 0 (unlimited) |
| `Drive Settings.quota` > 0 (MB) | that user's Personal Root `quota_bytes` (x 1024^2) |
| `Drive Storage Reservation.storage_owner` | `root`, the owner's Personal Root |

A reservation owner with no Personal Root gets one created in Build.
`Drive Root.used_bytes` is not written by the mapping; the daily recompute
fills it as the last Build step [010 §6, 011 §12].

### 14.9 Report

Printed and saved as JSON under the site's private directory [011].

```json
{ "removed_rows_skipped": 0, "broken_chains_skipped": 0,
  "blobless_nodes": 0, "title_renames": 0,
  "grant_rows_dropped": { "dead_principal": 0, "unmigrated_entity": 0,
                          "no_flags": 0, "root_guardrail": 0 },
  "links_minted": 0, "docshare_rows_dropped": 0,
  "trash_disagreements": 0, "orphan_content_docs_adopted": 0,
  "activity_rows_dropped": 0, "activity_verbs_derived": 0,
  "versions_to_thin": 0,
  "s3_objects_copied": 0, "s3_bytes_copied": 0,
  "personal_roots_created_for_reservations": 0,
  "media_nodes_created": 0, "media_duplicates_collapsed": 0,
  "slide_elements_rewritten": 0, "deck_previews_created": 0,
  "template_nodes_created": 0, "writer_templates_converted": 0,
  "composite_rows_dropped": 0 }
```

`links_minted` is the count owners must be told about: their old
anyone-with-link URLs changed [011 §9].

### 14.10 Cleanup

Ships one release after Build. It refuses to run unless all three hold
[011 §14, 014 §9]:

1. Every reachable Drive `File` row has a node.
2. `frappe.storage.gc.blob_reference_columns()` exists, so deleting File
   rows does not orphan every blob under the framework GC [003].
3. The SPA has moved off the 69 old method names, so the forwarders can go.

Then, in order:

- Delete the Drive-owned `File` rows, the `Drive` and `Users` root rows, and
  every Removed row.
- Delete the seven `File` custom fields
  (`suite/fixtures/custom_field.json`: `section_break_nfot8`, `mime_type`,
  `status`, `file_modified`, `column_break_tapww`, `content_doctype`,
  `content_docname`) and the three property setters
  (`suite/fixtures/property_setter.json`).
- Drop `Drive Permission`, `Drive Entity Activity Log`, `Drive Token`, and
  the old notification columns.
- Delete Sheet `DocShare` rows; drop `Writer Version`, `Writer Doc Version`,
  `Writer Template`, and `Sheet Snapshot`; clear `ycomments`; strip cell
  comments from `sheets_data`. `Writer Doc Version` is the child table
  behind `Writer Document.versions`, so dropping the field drops it.
- Drop the title and trashed columns on content doctypes; `user_folder` and
  `quota` on `Drive Settings`; `quota` and the S3 fields on
  `Drive Disk Settings`; `storage_owner` on `Drive Storage Reservation`.
- Delete the 69 API forwarders except the three permanent names (§11.7),
  and remove `/api/method/suite.drive.api.` from `ALLOWED_WILDCARD_PATHS`.
- Delete the `.thumbnail` sidecars.
- On S3 sites, enqueue a long job that deletes Drive's legacy prefix in the
  bucket.

Local legacy files are never deleted: backfilled blobs point at them in
place through `../<rel_path>` keys.

### 14.11 One storage location, and rollback

After Build, an S3 site holds blobs in two places: Drive files copied into
the bucket (`driver = "s3"`) and legacy attachments under `Home` linked in
place on local disk (`driver = "local"`). The framework's
`relocate_blobs()` (§13) folds them into one. It runs after Build, at any
time. Build and Cleanup do not depend on it [011 amendment].

| Stage | Rollback |
|---|---|
| after Build | truncate the new tables and ship the old code |
| after Cleanup | a database restore, and nothing smaller |

---

## Fixed numbers

Every number the spec fixes, once. "picked" means the tickets left it to
the spec.

| Number | Value | Where | Source |
|---|---|---|---|
| Signed `/f/` URL TTL, previews and media | 15 minutes | §6.8, §9.2, §10.6, §11.2 | picked |
| Media link refresh point | two thirds of the TTL, so 10 minutes | §6.8, §10.6, §11.2 | picked |
| Unlock ticket lifetime | 30 days | §4.8, §5.11, §6.3, §11.2 | [008] |
| Unlock failures per token | 5 in 15 minutes, then a 15-minute lockout, in the site cache | §6.3, §11.2 | picked |
| Collab server re-check interval | 5 minutes | §6.7 | [008] |
| Unused-media grace period | 7 days | §10.6 | picked |
| Trash retention before the purge sweep | 30 days | §5.6, §8.8 | [011], as today |
| Version retention ladder | all auto versions for 24 h, one per hour to 7 d, one per day to 30 d, one per week to 90 d, none beyond; `site_config.drive_version_ladder` overrides | §9.1 | [006] |
| Preview | 512 px longest side, WebP | §3.13, §9.2 | [006] |
| Tree depth cap | 40 | §3.1, §8.7 | design |
| Node id | 10-char hash | §3.1, §14.3 | [011] |
| Link token | 22 chars base62, about 128 bits | §3.3, §4.4, §11.2, §14.5 | [008] |
| Folder and view page size | 60 rows by default, 200 at most | §5.3, §8.1, §11.4 | picked |
| Link tokens accepted per request | 20 | §4.7 | picked |
| `Drive Node.path` column length | `varchar(500)`; `(root, path)` is 2560 bytes, under the 3072-byte InnoDB DYNAMIC key limit | §3.1 | picked |
| Build commit batch | 1000 rows | §14.2 | [011] |
| S3 multipart copy threshold | 5 GB | §14.2 | [011] |
| Whitelisted methods shimmed | 69, in 11 files, 26 guest-callable | §11.7 | [014] |
| Daily jobs | six: expired-link sweep, usage recompute, preview gap sweep, version thinning, trash purge, unused-media sweep | §6.4, §7.7, §8.8, §9.1, §9.2, §10.6 | [006, 008, 010, 011, 012] |
| Framework GC orphan age | 24 h | §2.4, §8.4, §8.8, §13.1 | framework, `gc.py:17` |
| Framework GC batch | 500 rows | §13.1 | framework, `gc.py:16` |
| `relocate_blobs` batch | 100 blobs | §13.6 | picked |
| Folder page SQL budget | under 2 ms: 0.57 ms window plus 0.4 ms for both grant queries | §2.3 | [004], design |
| Point check budget | 0.112 ms | §2.3, §10.5 | design |
| Autosave check interval | every 2 s to 5 s per open editor | §2.3 | design |
