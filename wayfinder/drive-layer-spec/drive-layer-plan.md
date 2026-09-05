# Drive layer implementation plan

Executes the spec in `drive-layer-spec.md`. Read the spec first; it is the
source of truth for behavior.

The module structure and dependency rules come from
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). If this plan and the
architecture charter disagree about placement or imports, the charter wins;
if either disagrees with the spec about behavior, the spec wins.

## Target

- Suite repo: the repository root that contains this plan
- Current branch: `forge/wayfinder-drive-layer` (spec and tickets live here)
- Implementation branch: `forge/drive-layer`, to be created off
  `forge/wayfinder-drive-layer`. It does not exist yet.
- Framework work: described by the repository-local
  [`references/frappe-file-storage-v2-spec.md`](references/frappe-file-storage-v2-spec.md)
- Framework branch: `forge/storage-v2` (already checked out). The §13 asks
  land there first.
- Bench: the bench containing this repository, webserver port 8010
- Test site: `slides.localhost` (MariaDB, `allow_tests: true`,
  `developer_mode: 1`, installed apps `frappe`, `suite`)
- Python 3.14.6, frappe 17.0.0-dev, suite 0.0.1
- Do not touch `frappe-bench`, `builder-bench`, or `gameplan-bench-1`, and no
  site other than `slides.localhost`.

Verified with:

| Fact | Command |
|---|---|
| both branches | `bench version` from the bench root |
| python, frappe version | `./env/bin/python --version`, `./env/bin/python -c "import frappe; print(frappe.__version__)"` |
| `allow_tests`, db type, apps | `cat sites/slides.localhost/site_config.json` |
| port 8010 | `cat sites/common_site_config.json` |

Not verified: nothing on the bench. `bench --site <site> --version` is not a
valid option on this bench; `bench version` gives the same answer.

## Test commands

```sh
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.drive.tests.<mod>
bench --site slides.localhost run-tests --module frappe.storage.tests.<mod>
bench --site slides.localhost run-tests --app suite        # full suite, stage 8
```

WebDAV acceptance stays litmus against `/dav/` on port 8010 (§12.5).

## File map and ownership

One owner per file. Parallel agents must not share a file. Owner keys:
`arch` architecture, `fw` framework, `eng` engine, `node` node workflows,
`side` side tables, `http`, `dav`, `writer`, `slides`, `sheets`, `patch`.

All Suite paths below are relative to `suite/drive/` unless they start with
`suite/`, `frontend/`, or name a repository-root file. Framework rows are
implementation targets in the framework repository. The local storage design
linked above supplies background; §13 of the local Drive spec owns the exact
asks.

### Framework, branch `forge/storage-v2` (§13)

| Path | Owner | Content |
|---|---|---|
| `frappe/storage/gc.py` | fw | `blob_reference_columns()`, `orphan_predicate()`, include-and-warn, delete-nothing-on-discovery-failure (§13.1) |
| `frappe/storage/upload.py` | fw | `finish_upload_to_blob()`; `finish_upload` becomes its wrapper (§13.2); ask 7: `check_permission` and `restrict_mimetypes` keywords on `create_upload` and `finish_upload` (§13.7) |
| `frappe/storage/url.py` | fw | `signed_url_for_blob(blob, filename, expires_in)` (§13.3) |
| `frappe/core/doctype/file/file_v2.py` | fw | run `after_file_upload` hooks inside `create_file_from_blob` (§13.4) |
| `frappe/storage/driver.py` | fw | `StorageDriver.read_range()` with a read-and-slice default (§13.5) |
| `frappe/storage/s3_driver.py` | fw | `S3Driver.read_range()` passing `Range=` to `get_object` (§13.5) |
| `frappe/storage/serve.py` | fw | public `stream_blob()`; `serve_file` keeps its own check (§13.5) |
| `frappe/storage/relocate.py` | fw | **new.** `relocate_blobs()` (§13.6) |
| `frappe/storage/tests/test_gc_backfill.py` | fw | discovery tests of §13.1 |
| `frappe/storage/tests/test_serve_upload.py` | fw | `finish_upload_to_blob`, Range, 206, 416, 304 |
| `frappe/storage/tests/test_signing.py` | fw | `signed_url_for_blob` tests |
| `frappe/storage/tests/test_relocate.py` | fw | **new.** relocation tests of §13.6 |

### Drive interface and private implementation (§2.2)

| Path | Owner | Content |
|---|---|---|
| `suite/drive/__init__.py` | eng | **becomes the public seam.** Explicit `__all__`; facade functions for product workflows, with contract types, roles, and errors exposed only when used outside Drive |
| `_core/roles.py` | eng | **new private module.** Role constants, `PTYPE_ROLE` (§4.1, §4.3) |
| `_core/principals.py` | eng | **new private module.** `Principals`, link-header parsing, and unlock tickets (§4.6 to §4.8) |
| `_core/access.py` | eng | **new private module.** `chain_ids`, `Acc`, resolution, checks, grant workflows, and list predicates (§5) |
| `_core/errors.py` | eng | **new private module.** Six exception classes with status codes (§11.6) |
| `_core/nodes.py` | node | **new private module.** create per kind, `get`, `update`, `purge`, `copy`, `children`, views (§8) |
| `_core/upload.py` | node | **new private module.** `create_upload`, `finish_upload` (§8.4) |
| `_core/quota.py` | node | **new private module.** admission, release, quota calculation, recompute, and reservations (§7) |
| `_core/versions.py` | side | **new private module.** version workflows (§9.1) |
| `_core/previews.py` | side | **new private module.** preview workflows (§9.2) |
| `_core/comments.py` | side | **new private module.** threads and comments (§9.3) |
| `_core/activity.py` | side | **new private module.** activity, recents, favourites, notifications (§9.4, §9.5) |
| `_core/content.py` | writer | **new private module.** content registry and workflows (§10) |
| `framework.py` | eng | **new Frappe adapter.** Request principal construction and permission/query hook targets; delegates to `_core` |
| `jobs.py` | side | **new scheduler adapter.** Six daily hook targets; delegates to `_core` |

### `suite/drive/http/` (§11)

| Path | Owner | Content |
|---|---|---|
| `http/__init__.py` | http | **new.** |
| `http/translator.py` | http | **new.** `handle_before_request`, `ROUTES`, the cached-path fix (§11.1) |
| `http/routes.py` | http | **new.** One whitelisted handler per row of §11.2 |
| `http/shapes.py` | http | **new.** Node shape, three expansions, cursor encode and decode, error mapping (§11.3 to §11.6) |
| `http/shims.py` | http | **new.** The 69 forwarders of §11.7, deleted in stage 7 |

### New doctypes, `suite/drive/doctype/<dir>/`

Each holds `__init__.py`, `<name>.json`, `<name>.py`, `test_<name>.py`.
Composite indexes go in `on_doctype_update()` (§3).

| Directory | Owner | Notes |
|---|---|---|
| `drive_root/` | eng | §3.2. Indexes `root_owner`, `root_kind` |
| `drive_node/` | eng | §3.1. Indexes `node_parent_page`, `node_root_page`, `node_subtree`, `node_content` |
| `drive_grant/` | eng | §3.3. Unique `grant_node_principal`, index `grant_principal` |
| `drive_node_version/` | side | §3.4. Unique `version_node_seq`, index `version_thin` |
| `drive_node_preview/` | side | §3.5 |
| `drive_comment_thread/` | side | §3.6 |
| `drive_comment/` | side | §3.7 |
| `drive_activity/` | side | §3.8. Index `activity_node_at` |
| `drive_recent/` | side | §3.9. Renamed from `drive_entity_log/` pre-model-sync |

### Reshaped doctypes

| Path | Owner | Change |
|---|---|---|
| `doctype/drive_favourite/` | side | Unique `(user, node)`; `entity` becomes `node` (§3.10) |
| `doctype/drive_notification/` | side | Becomes a pointer at `Drive Activity` (§3.11) |
| `doctype/drive_storage_reservation/` | node | `storage_owner` becomes `root`, a Link to Drive Root (§3.12) |
| `doctype/drive_disk_settings/` | node | Gains `default_personal_quota`, `shared_quota`; drops `quota` and the S3 fields in stage 7 (§3.13) |
| `doctype/drive_settings/` | node | Drops `quota` and `user_folder` in stage 7 (§3.14) |
| `doctype/drive_dav_lock/` | dav | `entity` retargets to `Drive Node` (§3.15) |
| `doctype/drive_dav_property/` | dav | `entity` retargets to `Drive Node` (§3.15) |
| `doctype/drive_legacy_route/` | dav | `entity` retargets to `Drive Node` (§3.15) |

### Deleted doctypes, stage 7 (§3.16)

`doctype/drive_permission/`, `doctype/drive_entity_activity_log/`,
`doctype/drive_token/`, `suite/writer/doctype/writer_template/`,
`suite/writer/doctype/writer_version/`,
`suite/writer/doctype/writer_doc_version/`,
`suite/sheets/doctype/sheet_snapshot/`. All directories deleted whole.
`Writer Doc Version` is the child table behind `Writer Document.versions`
(`istable: 1`), so it goes with that field (§3.16, §14.10).

### `suite/drive/webdav/` (§12.5)

| Path | Owner | Fate |
|---|---|---|
| `perms.py` | dav | **deleted.** The engine's folder-page batch replaces it |
| `put.py` | dav | Rewritten: one `put_blob`; the staging, generation keys, compensation, and drift repair go |
| `get.py`, `copy.py`, `structure.py`, `lock.py` | dav | Rewritten: every direct `manager.*` call goes; `copy.py` calls `_core.nodes.copy` with explicit principals |
| `properties.py` | dav | ETag and `getlastmodified` read `content_modified` and the version seq (§12.4) |
| `pathmap.py` | dav | Title lookup on `node_parent_page`; export extension for documents (§12.2) |
| `dispatch.py`, `auth.py`, `context.py`, `propfind.py`, `proppatch.py`, `deadprops.py`, `locks.py`, `ifheader.py`, `conditional.py`, `xmlutil.py`, `options.py`, `settings.py`, `log.py`, `errors.py` | dav | Kept, relinked to `Drive Node` |
| `webdav/tests/` | dav | Retargeted to nodes |

### Patches and hooks

| Path | Owner | Content |
|---|---|---|
| `patches/rename_entity_log_to_recent.py` | patch | **new.** Pre-model-sync rename (§14.1) |
| `patches/build.py` | patch | **new.** The 13 Build steps (§14.2 to §14.9) |
| `patches/cleanup.py` | patch | **new.** Gate and steps (§14.10) |
| `suite/patches.txt` | patch | Adds the rename under `[pre_model_sync]`, `build` and later `cleanup` at the end of `[post_model_sync]` |
| `suite/hooks.py` | http | `before_request` gains the translator beside the DAV dispatcher (line 336); `streaming_request_paths` gains `/api/suite/drive/uploads/` (line 341); `drive_content_types` is new; `has_permission` and `permission_query_conditions` point to `suite.drive.framework`; the four `sync_content_file` `doc_events` go (lines 233 to 243); `scheduler_events` points six daily jobs to `suite.drive.jobs` (line 282); `ALLOWED_WILDCARD_PATHS` gains `/api/suite/drive/` and loses `/api/method/suite.drive.api.` in stage 7 (line 429) |
| `suite/fixtures/custom_field.json`, `suite/fixtures/property_setter.json` | patch | Stage 7 drops the seven `File` custom fields and the three property setters |

### Content apps (§10, ticket 012 "What goes")

| Path | Owner | Change |
|---|---|---|
| `suite/writer/drive.py` | writer | **new.** `SPEC` built with `from suite import drive`, plus `create_empty`, `duplicate`, `export`, `version_bytes`, `restore_version`, `on_purge`, `used_nodes` |
| `suite/writer/doctype/writer_document/writer_document.json` | writer | Adds `node`; drops `ycomments` and `versions` (with its `Writer Doc Version` child table) |
| `suite/writer/doctype/writer_document/writer_document.py` | writer | Adds `drive.DriveContent` through the public interface; deletes `new_version` (:40), `update_file` (:100), `save_comments` (:110) |
| `suite/writer/overrides/__init__.py` | writer | Deletes `filter_templates`, `template_has_permission`, `version_has_permission`, `document_query_conditions`, `version_query_conditions` |
| `suite/slides/drive.py` | slides | **new.** `SPEC` built with the public contract, with `pushes_preview=True` and a `Slide` satellite |
| `suite/slides/doctype/presentation/presentation.json` | slides | Adds `node`; drops `title`, `is_template`, `thumbnail` |
| `suite/slides/doctype/presentation/presentation.py` | slides | Deletes the composite public invariant (:29-40), the forced-public row (:47-61), the `is_template` early return (:43), thumbnail File handling (:109-189, :361-395), `get_permission_query_conditions` and `has_permission` (:490-498), the webp convert-and-delete (:581-625); rewrites `get_attachment`, `attach_poster`, `update_slide_attachments`, `get_updated_json` (:240-487) onto the public `drive.copy` workflow |
| `suite/slides/api/file.py`, `suite/slides/api/test_file.py` | slides | **deleted** (122 and 274 lines) |
| `suite/sheets/drive.py` | sheets | **new.** `SPEC` built with the public contract, with `import_from_file` and two satellites |
| `suite/sheets/doctype/sheet/sheet.json` | sheets | Adds `node`; drops `title`, `trashed`, `trashed_on`, `trashed_by`, `head_snapshot` |
| `suite/sheets/doctype/sheet/sheet.py` | sheets | Adds the mixin; deletes `after_insert`'s `create_drive_file` (:55) |
| `suite/sheets/permissions.py`, `suite/sheets/trash.py` | sheets | **deleted** (both replaced by the engine and the trash sweep) |
| `suite/sheets/api.py` | sheets | Deletes `share_sheet`, `unshare_sheet`, `get_sheet_shares` |
| `suite/sheets/collab.py` | sheets | `check_collab_access` calls the public Drive interface; re-check every 5 minutes (§6.7) |

Frontend files named by ticket 012
(`frontend/src/apps/slides/utils/canonicalMediaKey.ts`,
`frontend/src/apps/slides/utils/mediaUploads.js`, and
`frontend/src/apps/slides/utils/slidesRequests.js`) are out of scope: §1 makes
frontend work a later effort.
They go when the SPA moves, which is also the stage 7 gate.

### Deleted suite code (stage 7 unless marked)

| Path | Owner | Note |
|---|---|---|
| `overrides/file.py` | http | Deleted whole with the `File` override, except `get_file_for_doc`, which is permanent (§11.7) |
| `api/files.py`, `api/list.py`, `api/permissions.py`, `api/activity.py`, `api/notifications.py`, `api/storage.py`, `api/scripts.py`, `api/embed.py` | http | Bodies become forwarders in stage 4, deleted in stage 7 |
| `api/s3.py` | http | Kept. `fetch` is permanent |
| `api/product.py` | http | Kept. 19 methods, none touches a node |
| `tests/test_sync_permissions.py` | http | **deleted** in stage 4. It covers `sync_from_disk`, which Build replaces, and `sync_preview`, which becomes a route (§11.7) |
| `api/storage.py` | node | `acquire_owner_storage_lock` (:12) and `validate_quota` go in stage 2; the admission UPDATE is the lock (§7.2) |

Meet is the only caller outside Drive. Those are not Drive files, so they
change in stage 2 beside the Drive interface move (§7.8):

| Path | Owner | Change |
|---|---|---|
| `suite/meet/api/recording.py` | node | Drops `acquire_owner_storage_lock` (:17, :413, :776); reservation and usage calls use `from suite import drive` and name a root (§3.12) |
| `suite/meet/recording/ingest.py` | node | Drops locks at :19 and :200; `reduce_storage_reservation` at :94 uses the public Drive interface |
| `suite/meet/doctype/meet_recording/meet_recording.py` | node | `release_storage_reservation` (:277) uses `from suite import drive` |
| `suite/meet/patches/backfill_recording_storage_reservations.py` | node | Writes `root`, not `storage_owner` (:19, :36) |

### Tests, `suite/drive/tests/`

| Path | Owner | Covers |
|---|---|---|
| `test_access.py` | eng | Two-pass resolution, deny, nearest-wins, ties, Suite Admin, 404-not-403 |
| `test_principals.py` | eng | `X-Drive-Links` grammar, the 20-link cap, unlock tickets |
| `test_grants.py` | eng | The 12 refusals of §5.9, revoke, `revoke_below`, rotate, unpublish |
| `test_views.py` | eng | Shared-with-me, archived roots, trash, search, cursor windows |
| `test_nodes.py` | node | Create per kind, rename, move, trash, restore, purge cascade, copy, leaf rule |
| `test_upload.py` | node | Both modes, `finish_upload_to_blob`, the empty-head rule |
| `test_quota.py` | node | Admission UPDATE, preflight, cross-root move, recompute |
| `test_versions.py` | side | Ladder, pinning, restore, thinning |
| `test_previews.py` | side | Reuse by `source_blob`, push, gap sweep, copy |
| `test_comments.py` | side | Roles, guest authors, anchors |
| `test_activity.py` | side | One row per grant write, `via_link`, recents, favourites, notifications |
| `test_content.py` | writer | Registry validation, forbidden fields, satellites, media sweep |
| `test_http.py` | http | Translator, route table, node shape, cursor, batch, error codes |
| `test_shims.py` | http | Every one of the 69 forwarders answers |
| `test_webdav.py` | dav | Method-role table, document export, ETag, quota properties |
| `test_build_patch.py` | patch | Mapping tables, trash propagation, dedupe, report keys, rerun |
| `test_cleanup_patch.py` | patch | The three gates, then each drop |
| `test_gc_columns.py` | eng | All four columns of §3.17 appear in `blob_reference_columns()` |

Kept unchanged: `tests/test_download_archive.py`,
`tests/test_storage_helpers.py`.

## Behavior anchors (from spec)

- The engine runs two passes: own principals, then open principals. The answer
  is the higher of the two. §5.1
- A deny on an own principal is final. Pass 2 does not run. §5.1
- Role 0 is a stored deny, not a missing row. §4.1
- Nearest wins. A grant on the node beats every ancestor grant. §5.3
- `owner` grants nothing. Every right comes from a `Drive Grant` row. §3.1
- A creator whose role at the parent is below EDIT gets one EDIT grant on the
  new node. An upload through a `$LINK` principal gets none. §4.5
- `$PUBLIC` caps at READ, for every caller. §6.5
- A `$PUBLIC` or `$LINK` grant naming a `Drive Root` is refused, Suite Admin
  included. §5.9
- A Suite Admin holds MANAGE everywhere and resolves before grants. §4.9
- Unreadable is 404, never 403, on every surface. §5.2
- Ancestors come from the `path` column, parsed in Python. No closure table,
  no cache between a grant row and an answer. §2.3
- Drive deletes no bytes. Purge drops the last reference; the framework GC
  deletes the blob 24 h later. §2.4
- Drive renders no content document. The app pushes the image. §2.4
- Drive converts no upload. §2.4
- Quota admission is one conditional UPDATE on `Drive Root.used_bytes`. Zero
  rows affected is `DriveOverQuota` (413). §7.2
- Trash and versions stay charged. Previews and document bodies are free. §7.1
- A replaced head of size 0 is never kept as a version. §8.5
- Rename refuses on a sibling collision. Copy, restore, and Build deduplicate
  instead. §8.6
- A content document node is always a leaf in every listing. §8.10
- `content_docname` is set once and never changes. §3.1
- Trash stamps the subtree with `trash_root` and `trashed_at`. Restore keys on
  both, so a node trashed earlier stays trashed. §8.8
- Every grant write produces exactly one activity row. §5.12
- One DAV mount: the caller's Personal Root. No DAV MOVE crosses roots. §12
- A DAV session never carries a `$LINK` principal. §6.9
- The purge cascade deletes notifications before activity rows. §8.8

## Stages

Each stage ships on its own. A stage starts only when its entry condition
holds.

### Architecture gate. Boundaries before Stage 1

- **Entry:** the accepted [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)
  charter and this plan agree on the target tree and import path.
- **Files:** `suite/tests/test_architecture.py`,
  `frontend/scripts/check-import-boundaries.mjs`, `frontend/package.json`,
  and `suite/drive/__init__.py`.
- **Rules:** code outside `suite/drive/` cannot import `_core`, Drive DocType
  controllers, HTTP, or WebDAV modules. Product-to-product Python calls use a
  declared package-root interface. Frontend cross-product imports use only an
  app's `index.ts`. Existing debt is baselined; new debt fails.
- **Contract:** `suite.drive.__all__` is explicit and tested. The production
  caller inventory determines the exported names.
- **Green:** the architecture test and frontend boundary check pass.
- **Commit:** one architecture-boundary commit. This gate may run alongside
  Stage 0 but must finish before Stage 1.

### Stage 0. Framework asks, branch `forge/storage-v2`

- **Entry:** `frappe.storage` tests green on the branch as it stands.
- **Files:** every row of the framework table above.
- **Order:** ask 1 (GC discovery), ask 2 (`finish_upload_to_blob`), ask 3
  (`signed_url_for_blob`), ask 7 (`check_permission` and
  `restrict_mimetypes` on `create_upload` and `finish_upload`), ask 4
  (`after_file_upload`), ask 5 (Range), ask 6 (`relocate_blobs`).
- **Green:** `frappe.storage.tests.test_gc_backfill`, `test_serve_upload`,
  `test_signing`, `test_drivers`, `test_relocate`, then the whole
  `frappe.storage.tests` package.
- **Commit:** one commit per ask, seven in all.
- Asks 1, 2, 3, 5, and 7 are blockers (§13). Nothing in stage 2 ships
  without them. Ask 7 is a blocker because `create_upload` refuses a Guest
  and refuses any mime outside the legacy allow-list for a user without desk
  access, and every Drive website user is one (§13.7).

### Stage 1. Doctypes, roles, engine

- **Entry:** the architecture gate is green; stage 0 asks 1 to 3 committed.
  Branch `forge/drive-layer` created off `forge/wayfinder-drive-layer`.
- **Files:** the nine new doctype directories, the eight reshaped ones,
  `_core/roles.py`, `_core/principals.py`, `_core/access.py`,
  `_core/errors.py`, `framework.py`, `suite/drive/__init__.py`,
  `patches/rename_entity_log_to_recent.py`, and its `suite/patches.txt` entry.
- **Roles:** doctype permission rows. Content doctypes keep a wide-open `All`
  row (§10.4); code outside Drive reaches Drive through `suite.drive` only.
- **Green:** `bench --site slides.localhost migrate`, then `test_access`,
  `test_principals`, `test_grants`, `test_views`, `test_gc_columns`.
- **Commit:** one for the doctypes and the rename patch, one for the engine.

### Stage 2. Node workflows, upload, quota, versions, previews, activity

- **Entry:** stage 1 green. Stage 0 asks 2, 3, and 5 available on the bench.
- **Files:** `_core/nodes.py`, `_core/upload.py`, `_core/quota.py`,
  `_core/versions.py`, `_core/previews.py`, `_core/comments.py`,
  `_core/activity.py`, `jobs.py`, the six daily `scheduler_events` in
  `suite/hooks.py`,
  `streaming_request_paths`, the four Meet files above. Deletes
  `acquire_owner_storage_lock` and `validate_quota` from
  `api/storage.py` and its six call sites in `api/files.py`,
  `webdav/put.py`, `webdav/copy.py`, and `webdav/lock.py` (§7.2).
- **Green:** `test_nodes`, `test_upload`, `test_quota`, `test_versions`,
  `test_previews`, `test_comments`, `test_activity`.
- **Commit:** one per module group: nodes and upload, quota, then the side
  tables.

### Stage 3. Content contract and app adoption

- **Entry:** stage 2 green.
- **Files:** `_core/content.py`, `framework.py`, `suite/writer/drive.py`,
  `suite/slides/drive.py`, `suite/sheets/drive.py`, the content doctype JSON
  and controllers, the `has_permission` and `permission_query_conditions`
  rewiring, `drive_content_types`, the `sync_content_file` `doc_events`
  deletion. Deletes `suite/slides/api/file.py`,
  `suite/slides/api/test_file.py`, `suite/sheets/permissions.py`,
  `suite/sheets/trash.py`, and the listed methods in
  `suite/writer/overrides/__init__.py`,
  `suite/slides/doctype/presentation/presentation.py`,
  `suite/sheets/doctype/sheet/sheet.py`, and `suite/sheets/api.py`.
- **Green:** `test_content`, plus the existing Writer, Slides, and Sheets test
  modules.
- **Commit:** one for the contract, one per app.

### Stage 4. HTTP translator, routes, shims

- **Entry:** stage 3 green.
- **Files:** `http/translator.py`, `http/routes.py`, `http/shapes.py`,
  `http/shims.py`, the `before_request` and `ALLOWED_WILDCARD_PATHS` entries
  in `suite/hooks.py`. Deletes `tests/test_sync_permissions.py`.
- **Boundary:** the HTTP adapter calls private Drive workflows. It does not
  expose `_core`, and no product imports the HTTP adapter.
- **Green:** `test_http`, `test_shims`. Every one of the 69 old method names
  still answers.
- **Commit:** one for the translator and the shapes, one for the routes, one
  for the shims.

### Stage 5. WebDAV relink

- **Entry:** stage 4 green.
- **Files:** every `webdav/` row above, plus `webdav/tests/`.
- **Boundary:** WebDAV calls the same private Drive workflows as HTTP; it owns
  protocol translation, not Drive policy.
- **Green:** `test_webdav`, `webdav/tests`, and a litmus run against `/dav/`
  on port 8010.
- **Commit:** one for the relink, one for the `put.py` rewrite.

### Stage 6. Build patch

- **Entry:** stages 1 to 5 green. Stage 0 ask 1 committed, because Cleanup
  later gates on it.
- **Files:** `patches/build.py`, its `suite/patches.txt` entry,
  `test_build_patch.py`.
- **Green:** `test_build_patch`, then a real run. Restore a copy of a
  production site export onto `slides.localhost` and run
  `bench --site slides.localhost migrate`. A separate scratch site needs
  Faris's approval first.
- **Report:** the §14.9 JSON, printed and saved under the site's private
  directory. Read `links_minted`, the four `grant_rows_dropped` counts,
  `title_renames`, and `trash_disagreements` back to Faris before stage 7.
- **Commit:** one for the patch, one for the test.

### Stage 7. Cleanup patch, one release after Build

- **Entry:** all three §14.10 gates hold: every reachable Drive `File` row has
  a node; `blob_reference_columns()` exists; the SPA no longer calls the 69
  old names.
- **Files:** `patches/cleanup.py`, its `suite/patches.txt` entry,
  `test_cleanup_patch.py`, the six deleted doctype directories, the deleted
  `api/*` and `overrides/file.py` bodies, `http/shims.py`, the
  fixture edits, the dropped columns on `Drive Settings`,
  `Drive Disk Settings`, and `Drive Storage Reservation`.
- **Green:** `test_cleanup_patch`, then the full suite app run.
- **Commit:** one for the patch, one for the deletions.

### Stage 8. Review workflow

- **Entry:** the stage the review covers is green.
- Spec-compliance reviewer against `drive-layer-spec.md`, section by section.
- Security reviewer on the engine, the link paths, and the HTTP surface.
- Fix rounds, then `bench --site slides.localhost run-tests --app suite`.
- **Commit:** one per fix round.

## Deviations from spec (provisional picks)

The spec has no accepted deviation. It carries 13 `> Spec pick:` lines, which
this plan treats as provisional. Confirm each with Faris before the stage
named.

| Section | Pick | Confirm before |
|---|---|---|
| §3.1 | `path` is `Data(500)`; `(root, path)` indexed with no prefix | stage 1 |
| §3.1 | The `node_root_page` index exists; [004] benchmarked only the child page | stage 1 |
| §3.3 | `Drive Grant.node` is `Data`, not a Link | stage 1 |
| §3.8 | `action` splits today's `delete` into `trash`, `restore`, and `delete` | stage 1 |
| §3.8 | `Drive Activity.node` is `Data` | stage 1 |
| §4.7 | At most 20 link tokens per request | stage 1 |
| §5.1 | Two own rows at one depth in one tier resolve to the lower role | stage 1 |
| §5.9 | Refusals 3, 4, 5, and 12 raise `frappe.ValidationError` (400) | stage 1 |
| §6.4 | The daily expiry sweep deletes link grants only | stage 2 |
| §8.8 | Restore reparents to the nearest Active ancestor | stage 2 |
| §10.7 | Writer's `default_export` is `html`, from the stored column | stage 3 |
| §10.7 | Slides and Sheets declare `default_export = None` | stage 3 |
| §11.2 | `explain` is `?principal=` on `GET /nodes/<id>/grants`, not a route | stage 4 |

Three items the review closed, listed so nobody reopens them:

- **Activity verbs.** §3.8 and §9.4 now agree on eleven verbs, with `delete`
  meaning purge alone. §14.6 states how Build maps the old single `delete`
  verb. Stage 1 can build `Drive Activity` without a decision.
- **Preview URLs.** §5.3's conflict between [006 §4] and [014 §7] is resolved
  in favour of the later ticket: a page mints preview URLs only under
  `expand=preview`. §9.2 and §11.3 say the same.
- **Framework ask 7.** No longer a spec pick. It is a §13 blocker (§13.7) and
  ships in stage 0.

Two things the review added that no ticket decided. They need Faris, not a
stage gate:

| Item | Where | Question |
|---|---|---|
| Ask 7 is new work on `forge/storage-v2` | §13.7 | Two new keywords on two framework functions, added because the spec found the gates, not because a ticket asked. Sign off before stage 0. |
| `revoke_or_deny` is a new private workflow name | §5.10 | The frozen `access.py` list has `revoke` and `revoke_below`. `revoke_or_deny` implements [007 §6]'s rule for every principal, not only `$PUBLIC`. Sign off before stage 1. |

## Rules for all agents

- Work only inside the Suite repository and, for Stage 0, the framework
  repository named above.
- Never push, post, comment, or write outside those two repos. No PRs.
- Subagents must not post, comment, push, merge, or write anywhere outside the
  current repo without Faris's confirmation. Put that limit in the subagent
  prompt.
- No service restarts. No `pip install`.
- Only site `slides.localhost` may be migrated or tested against. No other
  bench, no other site.
- No commits by workflow agents. The orchestrator commits at each stage's
  commit point.
- Suite work stays on `forge/drive-layer`; framework work stays on
  `forge/storage-v2`. Verify with `git branch --show-current` before writing.
- Treat [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md),
  [`drive-layer-spec.md`](drive-layer-spec.md), the tickets, `MAP.md`, and the
  explainers as approved inputs. Change them only in a deliberate
  documentation-synchronization pass.
- Match frappe code style: tabs, existing import patterns, `frappe._()` for
  user-facing strings.
- Report the real test output. "Should work" is not done.
