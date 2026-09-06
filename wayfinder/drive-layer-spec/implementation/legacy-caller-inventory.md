# Legacy Drive caller inventory

What calls each of §11.7's 69 legacy whitelisted names, what the name does
after ticket 23, and what has to be true before Cleanup deletes it.

Written for two readers: the frontend ticket that moves the SPA onto
`/api/suite/drive/`, and the Cleanup ticket (§14.10) that removes the
forwarders one release after Build.

Agents produced the caller table and the payload comparison it rests on; the
classification, the retention reasons, and the Cleanup gates are this ticket's.

**Revision:** suite `9797d1ea6` on `implement/drive-23-legacy-compatibility`.
Every path is relative to the app root. The classification is executable:
`suite.drive.http.shims.CLASSIFICATION`, checked against the legacy modules by
`suite/drive/http/tests/test_shims.py`.

## Counts

| | Count |
|---|---|
| Legacy whitelisted names | 69 |
| Guest-callable | 26 |
| Forwarder | 37 |
| Permanent | 21 |
| Retained | 8 |
| Retired | 3 |

Call shapes below: `CR` = frappe-ui `createResource`, `call()` = frappe-ui
`call`, `fR` = `frappeRequest`, `URL` = a raw URL used as `src`/`href`/
navigation, `XHR` = synchronous `XMLHttpRequest`, `py` = Python import, `pw` =
Playwright.

## `suite.drive.api.files` (26)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `upload_file` | forwarder | yes | `drive/components/FileUploader.vue:117` (chunked XHR), `drive/utils/files.js:547`, `writer/utils/index.js:447`, `suite/public/js/FileUploader.vue:289` (Desk), `suite/writer/api/embed.py:12` (py) | `upload.create_upload` / `upload_chunk` / `finish_upload`; the client's `uuid` is bound to the server's `upload_id` in cache |
| `get_thumbnail` | forwarder | yes | `drive/utils/files.js:305` → `GridItem.vue:62`, `DriveListRow.vue:258` (`<img src>`) | `previews.preview_expansions`; 302 to the signed preview, `""` when there is none |
| `create_folder` | forwarder | no | `NewFolderDialog.vue:38`, `MoveDialog.vue:298` | `nodes.create_folder` |
| `create_link` | forwarder | no | `NewLinkDialog.vue:36` | `nodes.create_link` |
| `create_auth_token` | **retired** | yes | `FileTypePreview/MSOfficePreview.vue:46` | `DriveRetired` 410. §8.4's signed URL replaces it |
| `get_file_content` | forwarder | yes | `utils/download.js:12`, `FileRender.vue:51`, `PDFPreview.vue:42`, `TextPreview.vue:32`, `ImagePreview.vue:40`, `AudioPreview.vue:30,46`, `MSOfficePreview.vue:61`; `api/s3.py:13` (py) | `nodes.signed_content_url`; 302. A `token` argument is refused |
| `stream_file_content` | forwarder | yes | `FileTypePreview/VideoPreview.vue:36,54` | Same 302. Ranges are storage's now |
| `download_folder` | **retained** | yes | `utils/download.js:25` | Legacy body. No §11.2 route builds a folder archive |
| `download_status` | **retained** | yes | `utils/download.js:76` | Legacy body. No route reports archive progress |
| `download_archive` | **retained** | yes | `utils/download.js:43` | Legacy body. No route streams a built archive |
| `set_favourite` | forwarder | no | `resources/files.js:182` ← `GenericPage.vue:610,623`, `Navbar.vue:272,284` | `activity.set_favourite`; `clear_all` walks the favourites view |
| `remove_or_restore` | forwarder | no | `utils/confirmActions.js:27,46`, `writer/components/RemoveDialog.vue:38,50,85` | `nodes.update(state=...)`; reads the current state to pick the direction |
| `delete_entities` | forwarder | no | `resources/files.js:249`, `utils/confirmActions.js:75`, `writer/utils/docximporter.js:38`; `api/scripts.py:114` (py, daily job) | `nodes.purge`; `clear_all` walks the trash view |
| `rename` | forwarder | no | `resources/files.js:270` ← `useInlineRename.js:92`, `writer/components/CoreEditor.vue:349`; `ui/drive/js/resources.js:50` | `nodes.update(title=...)` |
| `update_access` | forwarder | no | `ui/drive/js/resources.js:33` ← `ShareDialog.vue:210,220,266,283,291` | `access.grant` / `access.revoke`. Bits → one rung; an unshare writes nothing |
| `remove_recents` | forwarder | no | `resources/files.js:229` ← `GenericPage.vue:633`, `confirmActions.js:88` | `activity.clear_recents`; an empty list still clears nothing |
| `does_entity_exist` | forwarder | no | `FileUploader.vue:33` (synchronous XHR) | `nodes.title_taken`, which keeps the UPLOAD gate |
| `get_new_title` | **retired** | no | `FileUploader.vue:52`; `suite/writer/api/docs.py:49` (py) | `DriveRetired` 410. §8.6 refuses a collision at write time |
| `move` | forwarder | no | `resources/files.js:305` ← `GenericPage.vue:448`, `Sidebar.vue:260`; `ui/drive/js/resources.js:12` ← `MoveDialog.vue:347` | `nodes.update(parent=...)` |
| `search` | forwarder | no | `SearchPopup.vue:113` | `nodes.views("search")` |
| `translate_old_name` | forwarder | yes | `resources/files.js:324` ← `routes.ts:153,168,182` | §14.3 preserves ids; the id passes through when readable, else `None` |
| `get_entity_type` | forwarder | yes | `routes.ts:106` | `nodes.get` |
| `get_root_folder` | forwarder | no | `resources/files.js:46`, `ui/drive/js/resources.js:6`, `suite/public/js/FileUploader.vue:118` (Desk) | `roots.active_root_for` and `roots.personal_root_for` |
| `redirect_to_original` | forwarder | yes | `GenericPage.vue:567`, `Navbar.vue:218` | `nodes.get`. §14.4 drops the content link, so this refuses after Build |
| `track_visit` | forwarder | no | `pages/File.vue:121`, `writer/composables/useDocument.ts:8`, `slides/stores/presentation.js:330`, `sheets/.../usePersistence.js:33` | `activity.visit`, plus `mark_read` for that node |
| `resolve_legacy_route` | forwarder | no | `routes.ts:211` | `Drive Legacy Route`, then a readability check |

## `suite.drive.api.list` (6)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `files` | forwarder | yes | `resources/files.js:37,59,78,162`, `pages/Folder.vue:36`, `data/folderTree.js:25`, `GenericPage.vue:317`, `MoveDialog.vue:202`, `suite/public/js/FileUploader.vue:213` (Desk) | `nodes.children`, or `nodes.views("search")` when `search` is set |
| `shared` | forwarder | no | `resources/files.js:108` ← `pages/Personal.vue:2,24` | `nodes.views("shared")`. `shared_type="public"` is refused |
| `favourites` | forwarder | no | `resources/files.js:72` ← `pages/Favourites.vue:3` | `nodes.views("favourites")` |
| `recents` | forwarder | no | `resources/files.js:53` ← `pages/Recents.vue:4` | `nodes.views("recents")` |
| `trash` | forwarder | no | `resources/files.js:117` ← `pages/Trash.vue:3`, `confirmActions.js:30,52` | `nodes.views("trash", root=<own root>)` |
| `get_attachments` | **retained** | no | `resources/files.js:65` ← `pages/Attachments.vue:31` | Legacy body. §14.4 keeps framework attachments as `File` rows |

## `suite.drive.api.permissions` (4)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `get_user_access` | forwarder | yes | none. `suite/writer/api/general.py:100,124,148` (py) | `access.effective_role` → the five bits. Zeros for an unseen node |
| `get_general_access` | forwarder | yes | `ShareDialog.vue:190`, `InfoDialog.vue:145` | `$PUBLIC` then `$GENERAL` → `public` / `site` / `restricted` |
| `get_entity_with_permissions` | forwarder | yes | `pages/Folder.vue:57`, `pages/File.vue:125`, `MoveDialog.vue:235`, `writer/composables/useDocument.ts:19`; `overrides/file.py:621`, `suite/writer/api/docs.py:89` (py) | `nodes.get` + `breadcrumbs` + `access` + `personal_marks`. Keeps `frappe.response["data"]` |
| `get_shared_with_list` | forwarder | no | `resources/permissions.js:7`, `ui/drive/js/resources.js:28` ← `ShareDialog.vue:137`, `InfoDialog.vue:151` | `access.grants_for` (MANAGE), owner row first, links and denies hidden |

## `activity` (1), `notifications` (3), `storage` (2), `scripts` (2), `embed` (1), `s3` (1)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `activity.get_entity_activity_log` | forwarder | no | **none** | `activity.history`, under the old column names |
| `notifications.get_notifications` | forwarder | no | `pages/Notifications.vue:102` | `activity.notifications`, flattened to one level |
| `notifications.get_unread_count` | forwarder | no | `resources/permissions.js:18` ← `Sidebar.vue:161` | `activity.unread_count`. Still a scalar |
| `notifications.mark_as_read` | forwarder | no | `pages/Notifications.vue:116,131` | `activity.mark_read`. Still answers `None` |
| `storage.storage_bar_data` | forwarder | no | `resources/files.js:328` ← `StorageBar.vue:31`, `FileUploader.vue:224` | `roots.usage_for` on the caller's own root |
| `storage.storage_breakdown` | forwarder | no | `Settings/StorageSettings.vue:82` | `roots.usage_for`, plus the two aggregates read from `Drive Node` |
| `scripts.sync_preview` | **retained** | no | `SyncBreakdown.vue:100` | Legacy body. §11.7 points at a route that uploads a thumbnail |
| `scripts.sync_from_disk` | **retired** | no | `SyncBreakdown.vue:105` | `DriveRetired` 410. Build takes over the disk import |
| `embed.get_file_content` | forwarder | yes | **none** | `content.list_media`, then 302 to the matching signed URL |
| `s3.fetch` | **permanent** | yes | none. Reached only through stored `File.file_url` values | Untouched |

## `suite.drive.api.product` (19)

All 19 are **permanent** and untouched: `get_my_invites`,
`get_pending_invites`, `signup`, `oauth_providers`, `send_otp`, `verify_otp`,
`get_settings`, `set_settings`, `invite_users`, `get_users`,
`get_user_groups`, `accept_invite`, `reject_invite`, `get_translations`,
`is_site_admin`, `disk_settings`, `webdav_config`, `set_webdav_enabled`,
`signup_disabled`. None touches a node. Nine are guest-callable: `signup`,
`oauth_providers`, `send_otp`, `verify_otp`, `get_settings`, `accept_invite`,
`get_translations`, `disk_settings`, `signup_disabled`.

Callers live in `drive/resources/permissions.js`, `drive/pages/Signup.vue`,
and `drive/components/Settings/*`. `accept_invite` is also an emailed URL
built at `api/notifications.py:100` and
`doctype/drive_user_invitation/drive_user_invitation.py:49`.

## `suite.drive.overrides.file` (4)

| Name | Class | Guest | Callers | Now |
|---|---|---|---|---|
| `File.share` | retained | no | `api/files.py` only, before this ticket | Legacy body, unreachable from the forwarder. Dies with the override |
| `File.unshare` | retained | no | `api/files.py` only, before this ticket | Same |
| `File.rename` | retained | no | `overrides/file.py:612` (`sync_content_file`) | Legacy body, still the content-title sync |
| `get_file_for_doc` | **permanent** | no | `drive/sdk.js:25` ← `slides/components/SharePopover.vue:22` | Untouched. Its payload is `get_entity_with_permissions`'s |

## What Cleanup needs

**Three names have no caller at all** in this repository - frontend, `suite/`,
`e2e/`, and the checked-in bundles. They can go first:

1. `api.activity.get_entity_activity_log`
2. `api.embed.get_file_content`
3. `api.product.oauth_providers`

**Six more have no client caller** and are reachable only from Python here.
Deleting their HTTP surface breaks no released client, but each needs its
Python caller edited first:

| Name | Only reached from |
|---|---|
| `permissions.get_user_access` | `suite/writer/api/general.py:100,124,148` |
| `product.signup_disabled` | `suite/drive/api/product.py:129` |
| `overrides.file.File.share` | nothing, after this ticket |
| `overrides.file.File.unshare` | nothing, after this ticket |
| `overrides.file.File.rename` | `suite/drive/overrides/file.py:612` |
| `s3.fetch` | stored `File.file_url` values (`suite/drive/utils/files.py:21`) |

**Five call sites break on a string rename**, not only on a shape change. The
frontend ticket has to touch these by hand:

- `drive/components/GenericPage.vue:317` builds the load-more path from the
  resource's own `url`.
- `drive/components/FileUploader.vue:32,51` concatenate `/api/method/` and
  issue a **synchronous** `XMLHttpRequest`.
- `writer/components/RemoveDialog.vue:85` resolves `url` from a computed map.
- `drive/resources/permissions.js:12` points at
  `suite.drive.api.files.share`, which does not exist. Already dead.
- `writer/utils/index.js:447` has a doubled prefix,
  `/api/method//api/method/suite.drive.api.files.upload_file`.

**Three Desk callers** are outside the SPA and will not move with it:
`suite/public/js/FileUploader.vue` calls `get_root_folder`, `list.files`, and
`upload_file`, and is loaded into Desk by `app_include_js`
(`suite/hooks.py:31`).

**Hardening.** `/api/suite/drive/` is in `ALLOWED_WILDCARD_PATHS` as of this
ticket. Cleanup removes `/api/method/suite.drive.api.` from the same list.
`DENIED_WILDCARD_PATHS = ["/api/"]` is declared and nothing in suite or frappe
reads it; that gate is external.

## Compatibility gaps carried into the forwarders

Recorded, not hidden. Each one is a place where the old payload cannot be
rebuilt from the new surface without inventing data.

1. **Permission bits.** The five legacy bits are read off one rung of §5.9's
   ladder. A legacy `Drive Permission` row decided each type independently and
   could say `write=1, comment=0`; the ladder cannot spell that.
2. **`slide_count`.** No producer on either surface. Left off the list row
   rather than guessed. Read by `DriveListRow.vue:289-291`.
3. **`share_count` on a list row** is counted from local `Drive Grant` rows.
   Legacy tested inherited general access. §5.10 keeps local rows and
   inheritance apart, so a per-row count cannot fold them.
   `get_entity_with_permissions` still resolves inheritance, because it asks
   about one node.
4. **`attached_to_doctype` / `attached_to_name`** are published as `None`.
   §14.4 drops the attachment join for migrated rows.
5. **`file_url`** is published only for links, as `hide_storage_key` did.
6. **`order_by`.** §11.4 has four columns. `file_name`, `file_size`, and
   `modified` map; `owner`, `file_type`, `creation`, and `name` fall back to
   `modified`, which is what the old surface did with an unknown column.
7. **`shared_type="public"`** has no view. Refused rather than answered with
   the "shared with me" list.
8. **Trash lists trash roots.** §8.7 lists one row for a deleted folder where
   the old query listed the folder and everything under it.
9. **`s3.fetch` refusals** are now `DriveNotFound`, not the
   `DoesNotExistError` its `except` clause names. Both are 404 and both are
   the same answer for missing and unreadable. The permanent body is not
   edited to catch the new class.
10. **`storage_breakdown`** is scoped to the caller's personal root, not to
    every file they own. A user with files in the Shared Root sees them in
    neither the old number nor the new one.
