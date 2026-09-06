# Legacy Drive caller inventory

What calls each of §11.7's 69 legacy whitelisted names, what the name does
after ticket 23, and what has to be true before Cleanup deletes it.

Written for two readers: the frontend ticket that moves the SPA onto
`/api/suite/drive/`, and the Cleanup ticket (§14.10) that removes the
forwarders one release after Build.

Agents produced the caller table and the payload comparison it rests on; the
classification, the retention reasons, and the Cleanup gates are this ticket's.

**Revision:** suite `f517358f0` on `review/drive-23-legacy-compatibility`.
The table below was written against `9797d1ea6`; the review branch changed no
name, no class, and no guest flag, so the table still holds. What the review
changed is recorded in "What the review fixed" below.
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
Playwright (`e2e/drive-backed-apps/`).

## `suite.drive.api.files` (26)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `upload_file` | forwarder | yes | `drive/components/FileUploader.vue:117` (Dropzone), `drive/utils/files.js:547`, `writer/utils/index.js:447`, `suite/public/js/FileUploader.vue:289` (Desk), `suite/writer/api/embed.py:12` (py) | `upload.create_upload` / `upload_chunk` / `finish_upload`; the client's `uuid` is bound to the server's `upload_id` in cache. Dropzone sets `chunking: true` and no `forceChunking`, so a file under its 20 MB `chunkSize` arrives in one part with no `total_file_size`, and the session declares the bytes in hand |
| `get_thumbnail` | forwarder | yes | `drive/utils/files.js:305` → `GridItem.vue:62`, `DriveListRow.vue:258` (`<img src>`) | `previews.preview_expansions`; 302 to the signed preview, `""` when there is none |
| `create_folder` | forwarder | no | `NewFolderDialog.vue:38`, `MoveDialog.vue:298` | `nodes.create_folder` |
| `create_link` | forwarder | no | `NewLinkDialog.vue:36` | `nodes.create_link` |
| `create_auth_token` | **retired** | yes | `FileTypePreview/MSOfficePreview.vue:46` | `DriveRetired` 410. §8.4's signed URL replaces it |
| `get_file_content` | forwarder | yes | `utils/download.js:12`, `FileRender.vue:51`, `PDFPreview.vue:42`, `TextPreview.vue:32`, `ImagePreview.vue:40`, `AudioPreview.vue:30,46`, `MSOfficePreview.vue:61`; `api/s3.py:13` (py) | `nodes.signed_content_url`; 302. A `token` argument is refused |
| `stream_file_content` | forwarder | yes | `FileTypePreview/VideoPreview.vue:36,54` | Same 302. Ranges are storage's now |
| `download_folder` | **retained** | yes | `utils/download.js:25` | Legacy body. No §11.2 route builds a folder archive |
| `download_status` | **retained** | yes | `utils/download.js:76` | Legacy body. No route reports archive progress |
| `download_archive` | **retained** | yes | `utils/download.js:43` | Legacy body. No route streams a built archive |
| `set_favourite` | forwarder | no | `resources/files.js:182` ← `GenericPage.vue:610,623`, `Navbar.vue:271,283` | `activity.set_favourite`; `clear_all` walks the favourites view |
| `remove_or_restore` | forwarder | no | `utils/confirmActions.js:27,46`, `writer/components/RemoveDialog.vue:38,50,85` | `nodes.update(state=...)`; reads the current state to pick the direction |
| `delete_entities` | forwarder | no | `resources/files.js:249`, `utils/confirmActions.js:75`, `writer/utils/docximporter.js:38`; `api/scripts.py:64` (py, daily job) | `nodes.purge`; `clear_all` walks the trash view |
| `rename` | forwarder | no | `resources/files.js:270` ← `useInlineRename.js:92`, `writer/components/CoreEditor.vue:349`; `ui/drive/js/resources.js:50` | `nodes.update(title=...)` |
| `update_access` | forwarder | no | `ui/drive/js/resources.js:33` ← `ShareDialog.vue:210,220,266,283,291` | `access.grant` / `access.revoke`. Bits → one rung; an unshare writes nothing |
| `remove_recents` | forwarder | no | `resources/files.js:229` ← `GenericPage.vue:633`, `confirmActions.js:88` | `activity.clear_recents`; an empty list still clears nothing |
| `does_entity_exist` | forwarder | no | `FileUploader.vue:33` (synchronous XHR) | `nodes.title_taken`, which keeps the UPLOAD gate |
| `get_new_title` | **retired** | no | `FileUploader.vue:52` | `DriveRetired` 410. §8.6 refuses a collision at write time. `suite/writer/api/docs.py:49` used to import it and now carries the rule itself |
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
| `get_entity_with_permissions` | forwarder | yes | `pages/Folder.vue:57`, `pages/File.vue:125`, `MoveDialog.vue:235`, `writer/composables/useDocument.ts:19`; `overrides/file.py:621`, `suite/writer/api/docs.py:89` (py) | `nodes.get` + `breadcrumbs` + `access` + `personal_marks`. Keeps `frappe.response["data"]`. Reads the `File` store for an id no node holds (§10.2 expand phase) |
| `get_shared_with_list` | forwarder | no | `resources/permissions.js:7`, `ui/drive/js/resources.js:28` ← `ShareDialog.vue:137`, `InfoDialog.vue:151` | `access.grants_for` (MANAGE), owner row first, links and denies hidden |

## `activity` (1), `notifications` (3), `storage` (2), `scripts` (2), `embed` (1), `s3` (1)

| Name | Class | Guest | Client callers | Now |
|---|---|---|---|---|
| `activity.get_entity_activity_log` | forwarder | no | **none** | `activity.history`, under the old column names |
| `notifications.get_notifications` | forwarder | no | `pages/Notifications.vue:102` | `activity.notifications`, flattened to one level, merged newest-first with the caller's pointerless rows |
| `notifications.get_unread_count` | forwarder | no | `resources/permissions.js:18` ← `Sidebar.vue:161` | `activity.unread_count` plus the pointerless unread count. Still a scalar |
| `notifications.mark_as_read` | forwarder | no | `pages/Notifications.vue:116,131` | `activity.mark_read`, and the pointerless rows beside it. Still answers `None` |
| `storage.storage_bar_data` | forwarder | no | `resources/files.js:328` ← `StorageBar.vue:31`, `FileUploader.vue:224` | `roots.usage_for` on the caller's own root |
| `storage.storage_breakdown` | forwarder | no | `Settings/StorageSettings.vue:82` | `roots.usage_for`, plus the two aggregates read from `Drive Node` |
| `scripts.sync_preview` | **retained** | no | `SyncBreakdown.vue:100` | Legacy body. §11.7 points at a route that uploads a thumbnail |
| `scripts.sync_from_disk` | **retired** | no | `SyncBreakdown.vue:105` | `DriveRetired` 410. Build takes over the disk import |
| `embed.get_file_content` | forwarder | yes | **none** | `content.list_media`, then 302 to the matching signed URL |
| `s3.fetch` | **permanent** | yes | none. Reached only through stored `File.file_url` values | Signature and decorator unchanged. Its `except` names `DriveError`, so a locked or expired stored URL no longer confirms the object on a guest-callable path |

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

## End-to-end callers

The table above lists client and Python callers. Twelve legacy names are also
called by name from `e2e/drive-backed-apps/`, which posts to `/api/method/`
directly and waits on the response URL. Every path below is relative to
`e2e/drive-backed-apps/`.

| Name | Called from |
|---|---|
| `files.update_access` | `helpers/drive.ts:100,113`, `helpers/writer.ts:31`, `specs/drive/sharing.spec.ts:18,71,107,177,209` |
| `files.remove_or_restore` | `specs/drive/lifecycle.spec.ts:21,54,62`, `specs/drive-writer/integration.spec.ts:121` |
| `permissions.get_entity_with_permissions` | `helpers/drive.ts:64`, `specs/drive/lifecycle.spec.ts:33`, `specs/drive/sharing.spec.ts:30` |
| `files.move` | `specs/drive/breadcrumbs.spec.ts:169`, `specs/drive/move-permissions.spec.ts:47`, `specs/drive-writer/integration.spec.ts:91` |
| `notifications.get_notifications` | `specs/drive/notifications.spec.ts:29,45` |
| `list.files` | `helpers/drive.ts:21`, `specs/drive/tree-expand.spec.ts:75` |
| `files.set_favourite` | `specs/drive/favourites-search.spec.ts:27,35` |
| `files.rename` | `specs/drive/breadcrumbs.spec.ts:126`, `specs/drive-writer/integration.spec.ts:80` |
| `permissions.get_shared_with_list` | `specs/drive/sharing.spec.ts:146` |
| `list.favourites` | `specs/drive/favourites-search.spec.ts:19` |
| `files.search` | `specs/drive/favourites-search.spec.ts:51` |
| `files.delete_entities` | `specs/drive/lifecycle.spec.ts:26` |

These were not run: this review has no site. One is known to fail by reading
it, and it is named under "Carried risks" below.

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

**Four dead search constants.** `api/files.py:537-563` still declares
`SEARCH_PAGE_LENGTH`, `SEARCH_SCAN_WINDOW`, `MAX_SEARCH_SCAN_WINDOWS`, and
`SEARCH_QUERY`. Nothing reads any of them: the shim walks
`nodes.views("search", ...)` and holds its own `SEARCH_PAGE_LENGTH`. Module 3
of the site gate found them by patching them and watching nothing change. They
are not a defect, so ticket 23 left them; Cleanup deletes them with the module.

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
2. **Partial shares.** `File.share` left an unnamed bit at whatever the
   existing row held. One rung cannot merge with a stored row, so a share that
   names no contiguous run from `read` upwards is refused rather than written.
   No shipped caller sends a partial: `ShareDialog.getAccess` sends all five.
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
9. **`s3.fetch` refusals.** Fixed by the review, see below. The gap as first
   recorded was wrong in one direction: `DriveForbidden` is 403, not 404, so a
   denied stored URL confirmed the object exists.
10. **`storage_breakdown`** is scoped to the caller's personal root, not to
    every file they own. A user with files in the Shared Root sees them in
    neither the old number nor the new one.

## What the review fixed

Independent review on `review/drive-23-legacy-compatibility`, commits
`037d067a9`, `d5f8d4590`, `f75f0aff1`, `be89d402d`, `29eadd1cd`, `ec5bd104c`,
`3a70a6228`, `45f9296b6`, `4a7c5a0ab`, `49b413d7c`, `2a18f766d`, `b4b6fde55`,
`f517358f0`. Each fix carries a regression test that was run against the
pre-fix body first.

**Security**

1. `update_access` read the five bits with `max()`, so a call naming only
   `share: 1` granted MANAGE and every verb below it. It walks the ordered
   ladder now and stops at the first bit the caller did not set.
2. `update_access` granted role 0 when no bit reached a rung. Role 0 is §5.10's
   deny, so a partial share cut inherited access. It refuses now.
3. `_child_counts` counted every Active child. A shared folder reported the
   rows the caller cannot open. It is `_core.nodes.readable_child_counts` now,
   which subtracts only the children carrying their own grant.
4. `api.s3.fetch` is guest-callable and answered 403 for a denied stored URL,
   confirming the object exists. Its `except` names the `_core` classes now.

**Correctness**

5. `_listing` cut rows that `next_cursor` had already passed, so paging lost
   up to a window per page.
6. `search` was accepted and ignored on `shared`, `favourites`, `recents`, and
   `trash`.
7. A listing with no `limit` and no `paginated` truncated at 100. The old
   non-paginated branch ran with no `LIMIT`, and `data/folderTree.js` and
   `MoveDialog.vue` both call that way.
8. `upload_file` refused a sibling collision where the old body renamed around
   it, and published no `list-add`, so an upload appeared only after a reload.
9. `move` answered the moved node. `File.move` answered the destination, which
   is what both frontend `move` resources route and refresh on.
10. Notification rows carried `entity_type: None`, which made every row on
    `Notifications.vue` unclickable.
11. Presentation rows lost `slide_count`, so the list showed a byte size
    instead of "12 slides".
12. `get_new_title`'s retirement broke `writer.api.docs.create_document`,
    which imported it.
13. `.name` was read off a dict in `writer/api/embed.py` and in
    `api/files.ensure_path`.
14. `auto_delete_from_trash` passed rows where `delete_entities` wants ids.

**Upload**

15. `upload_file` declared a zero-byte session for every file Dropzone did not
    chunk, which is every file under 20 MB. The session refused its own first
    chunk and deleted itself, so every SPA upload under that size and every
    Writer embed failed. The old body never read `total_file_size`; it sized
    the file off the disk.
16. A storage driver that offers a presigned target opens a direct session no
    chunk can be written to. Refused by name now; the framework's own answer
    named nothing a legacy client could act on. See "Carried risks".
17. `upload_file` minted a session id per chunk, so the last chunk finished a
    file with holes in it. The old body minted one only for a single-chunk
    upload and refused a chunked one that named none.

**Refusal messages**

18. The workflows raise, and `report_error` copies a message into the response
    only when `msgprint` stamped one on. A legacy client therefore read a
    status code and no text. `FileUploader.vue:208` reads `_server_messages`
    alone and printed "Please contact support." for a full disk;
    `ui/drive/js/resources.js:35` reads `error.messages[0]` and threw inside
    its own error handler. Every shim a legacy module reaches now throws the
    same class again at the boundary, which is what `routes._route` does at
    the other one.

**Listing bounds**

19. `list.files` is `allow_guest`, and `file_kinds` and `search` are applied to
    the page here rather than in SQL. A window of non-matching rows did not
    advance the page, so `limit=1&file_kinds=["NoSuchKind"]` in a folder of
    five thousand children ran five thousand SQL windows. A filtered listing
    now walks from the top, filters, and cuts; three bounds cap the reads.
20. The same rewrite repaired the offsets. `start` and `limit` counted matching
    rows on the old surface, so page two of a PDF-only folder began at the
    twenty-first PDF; a cursor built from `start` indexed unfiltered rows.

**Payloads**

21. `file_kinds=["Frappe Document"]` selected nothing. `get_file_type` answers
    the first `MIME_LIST_MAP` key holding the mime and `frappe_doc` is under
    `Document` first. The old filter was `mime_type IN (...)` over the union of
    the named families and matched both.
22. A legacy re-share cleared an expiry it has no field for: `access.grant`
    replaces the whole row. The existing expiry is read back and passed through.
23. `get_root_folder` published `root: None` on a site with no Shared root.
24. `get_user_access` answered `type: "admin"` beside `share: 0`.
    `_core.access` has no owner rule, so an owner holds UPLOAD on a node they
    created in a folder shared to them at UPLOAD. The label follows the rung
    the bits come from now.
25. `get_entity_with_permissions` served a trashed node. The old query filtered
    `status: STATUS_ACTIVE`.
26. `update_access` and `translate_old_name` answered a traceback rather than a
    refusal: one read `principal.startswith` before `access` could refuse a
    non-string, the other caught `DriveNotFound` alone and let `DriveLocked`
    and `DriveLinkExpired` travel.

**Evidence**

27. The permanent surface was checked with substring greps. Each of the 21 is
    now compared with its own structure at `e390a4487`, and every legacy name's
    `allow_guest` flag with it. One hook assertion passed on a file-text match
    that was not the value the hook holds.
28. `get_shared_with_list` claimed it drops expired link rows. It drops all of
    them.
29. `test_every_forwarder_delegates_and_holds_no_second_implementation` was a
    substring search for "shims.". Inlining a forwarder and leaving the comment
    "was a shims. forwarder" passed it. It walks for a call node now.
30. `_share_counts` and `_child_named` had no test at all. The second is the
    UPLOAD gate for a directory upload.

## What the site gate fixed

First module of the serialized gate,
`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shims`,
on `forge/drive-23-site-gate-shims`. It ran 164 tests and failed three. All
three failures need a terminal, so a piped run of the same command passed. The
first defect below reaches a client either way, and defect 33 is the rest of
the same class, swept for after defect 31 named it.

31. **A retired name named a route no reader could call.** `create_auth_token`
    and the `get_file_content` download token both answered
    `GET /api/suite/drive/nodes/<id>/content`, and the legacy `$LINK` refusal
    answered `PUT /api/suite/drive/nodes/<id>/grants/$LINK`. `msgprint` cleans
    the message it logs (`frappe/utils/messages.py:77`) and strips tags off the
    exception as well when the caller is a terminal (`:79-85`); both delete
    everything between angle brackets. Every legacy client read
    `nodes//content`. The placeholder is spelled `:id` now.
32. **A test replaced `frappe.cache` for the whole process.** `frappe._` reads
    the merged translation dict off that one object
    (`frappe/translate.py:177`), so the two upload refusals raised with a
    `MagicMock` for a message. On a terminal `strip_html_tags` refused it with
    `TypeError`; piped, the refusal carried a mock repr and the test still
    passed. The stub holds the shim's three upload keys and passes every other
    call to the real cache.

33. **A refusal deleted the value it was raised to name.** Six messages spelled
    a runtime value into the text, and every one of them could carry an angle
    bracket that `clean_html` and `strip_html_tags` then delete. Five spelled
    `type(x)`, which is always `<class 'list'>`: `set_favourite`,
    `remove_or_restore`, `delete_entities`, `move`, and `remove_recents` each
    told a legacy client `Expected list but got ` and named neither side. The
    sixth echoed the `method` argument `update_access` was called with, which is
    request text. `_home` spelled the user id, and a mail address written
    `<a@example.com>` left no name at all. A type is named by `__name__` now,
    and any other runtime value goes through `_spelled`.
34. **The `_legacy` boundary handed `_core` refusals to the cleaner.** Throwing
    the refusal again is what fills the message in for a legacy client
    (`shims.py:290`), and it is also the first time a `_core` message meets
    `clean_html`. Several `_core` refusals spell an id the caller sent, so a
    node named `a<b>c` answered `Drive node ac was not found`. The message goes
    through `_plain` at that boundary. The same messages on the §11.2 route
    surface are cleaned by `routes.py:112` and predate ticket 23; they are named
    under carried risks, not changed here.

Third module of the serialized gate,
`bench --site slides.localhost run-tests --module suite.drive.api.tests.test_files`,
on `forge/drive-23-site-gate-api-files`. It ran 49 tests and reported 6
failures and 21 errors. Twenty-six of the twenty-seven were test defects: the
fixtures built `File` rows for names that read `Drive Node`, `TestDriveSearch`
patched targets that no longer run, and one case asserted a mint that §11.7
retired. Rewriting the fixtures onto nodes then reached production for the
first time and found defect 35.

35. **A folder's child count was never counted.** `nodes.readable_child_counts`
    asked `frappe.get_all` for `count(name) as total`, and `frappe.db.query`
    refuses a function spelled as a string in `fields`:
    `SQL functions are not allowed as strings in SELECT`. The ticket 23 review
    added the function and no run on a site had reached it. Every legacy list
    row carries `children_count`, and so does the `list-add` row an upload
    publishes, so `upload_file` raised on every call and no legacy listing
    could be built. The count is a `frappe.db.sql` `GROUP BY` now, the way the
    readable-child query below it in the same function is already written.

Fourth module of the serialized gate,
`bench --site slides.localhost run-tests --module suite.drive.api.tests.test_list`,
on `forge/drive-23-site-gate-api-list`. It ran 8 tests and errored on all 8,
one cause: `TestDriveListPagination` built `File` rows, so every `files()` call
reached `nodes.children` with a parent that is in no root. A test defect, and
the same one module 3 met. Rewriting the fixtures onto nodes reached production
and found defects 36 and 37, which are one defect seen twice.

36. **A folder page was sorted by a value the client is never shown.**
    `_legacy_row` publishes legacy `modified` as `content_modified or
    modified`, which is the `COALESCE(file_modified, modified)` the old query
    both sorted by and published (`utils/__init__.py:160`). `ORDER_COLUMN`
    mapped the same legacy name to §11.4's `modified`, so `children` ordered
    the SQL window by the row's own mtime. `content.touch` stamps
    `content_modified` with `update_modified=False` and `upload_file` stamps it
    from the client's `file_modified`, so the two differ on every uploaded and
    every edited file: the page arrived in an order the dates printed on it
    contradict. The four discovery views never had this, because `_sort_key`
    already coalesces, so one legacy argument meant two things depending on
    which list was open. The legacy name maps to `content_modified` now, and
    `_core.nodes.ORDER_TERMS` makes that order
    `COALESCE(content_modified, modified)` - a folder has no `content_modified`
    at all, so the raw column clumps every folder at one end of the list.
37. **An unknown sort column fell back past the mapping.** Both call sites read
    `ORDER_COLUMN.get(order_by, "modified")`, and the default is the legacy
    name rather than the §11.4 name it maps to. Two of the five columns the
    toolbar sends - "Type" and "Owner" - fall back, so they sorted by the wrong
    column even once the mapping was right.

Fifth module of the serialized gate,
`bench --site slides.localhost run-tests --module suite.drive.api.tests.test_notifications`,
on `forge/drive-23-site-gate-api-notifications`. It ran 1 unit test and 3
integration tests and failed one:
`TestMarkAsRead.test_recipient_can_mark_own_notification_as_read` called
`mark_as_read` and the row stayed unread. One test defect and one production
defect, from the same root.

The fixture built a `Drive Notification` by hand with `to_user`, `from_user`,
`message`, and no `activity`. §9.5 made the row a pointer at a `Drive Activity`
row, so `activity._visible_notifications` read the pointer, found nothing, and
dropped it. That is the test defect. The other two cases in the class passed
for the wrong reason: nothing in the module was markable at all, so "another
user cannot mark this" and "mark all leaves it alone" asserted only that a
no-op is a no-op.

38. **A notification with no activity pointer was invisible to every legacy
    name.** `get_notifications` answered a page without it, `get_unread_count`
    did not count it, and `mark_as_read` could not clear it. Pointerless rows
    are not only historical: `api.notifications.create_notification` still
    writes one for every mention in a legacy Writer document's comments
    (`writer_document.notify_comments`), and for the folder share every new
    `User` is given (`Drive Permission.after_insert` -> `notify_share`, reached
    from `utils.get_user_folder`). §14 drops the table's rows at Build and
    starts the inbox empty, but Build has not run and neither writer is
    Build-gated, so the inbox would fill with rows the page cannot show and the
    reader cannot clear. `shims._legacy_inbox`, `_legacy_unread_count`, and
    `_mark_legacy_read` answer for them, scoped to `to_user` - the only scope
    the old query had. They live in the shim, not in `_core`: §11.2 has no way
    to publish a row with no activity, and the read dies with the module.

Fourteenth module of the serialized gate,
`bench --site slides.localhost run-tests --module suite.writer.tests.test_drive_adoption`,
on `forge/drive-23-site-gate-writer-adoption`. It ran 44 tests and errored on
one: `create_document` wrote a document and `get_document` could not open it.
One production defect, no test defect.

39. **A document the product creates cannot be opened.**
    `writer.api.docs.create_document` writes a `File` and a `Writer Document`
    with no node, and that is the only row it can write while
    `drive_content_types` is empty. §10.2 keeps a type's legacy rows working
    through its expand phase (`_core/content.py:757-780`), and ticket 29 owns
    the activation that ends it. `get_entity_with_permissions` answered
    `DriveNotFound` for that id, which broke `writer/api/docs.py:92` and
    `writer/composables/useDocument.ts:19`.
    `shims._legacy_entity_with_permissions` reads the `File` store for an id no
    node holds, with the old query's status filter, the old gate
    (`get_user_access_for_user`, `frappe.PermissionError`), and the old
    payload. The store is chosen by which one holds the id and never by a
    refusal: §5.2 makes `DriveNotFound` the answer for a node the caller may
    not read, so retrying on the exception would be a bypass rather than a
    compatibility read. It lives in the shim and dies with it.

    The rest of the boundary was mapped and left alone. Every other legacy
    name still refuses a node-less id, and `get_user_access` answers zeros for
    one - which the three Writer reads in `writer/api/general.py` filter on, so
    the document list, the version list, and search all come back empty. That
    is `writer.api.tests.test_general`, module 16 of the gate, and it is
    outside the one command module 14 was allowed to run. Ticket 23 evidence,
    "The rest of the boundary, diagnosed and not fixed", lists every path.

The final known-residual audit for ticket 23, on
`forge/drive-23-residual-audit`, branched from `a2369aea0`. It started from the
three untested in-scope defects the module-14 handoff named: `get_user_access`
answers zeros for a node-less legacy `File`, `list.files` may not serve a
node-less legacy tree, and `embed.add` may not work for a node-less legacy
Writer document. The module-14 note above is now out of date: every row of "The
rest of the boundary, diagnosed and not fixed" is covered here, except the
names classified out of scope under carried risks.

The scope is one class of row. The Build gap, pre-Build legacy rows that Build
will link, is not a shipped regression. The genuine class is rows a live writer
creates that Build will never link before ticket 29: everything
`writer.api.docs.create_document` writes. `drive_content_types` is `[]`, so
`Writer Document` is in the §10.2 expand phase and every document the product
creates is a `File` with no node.

Every fix below takes the same shape, so the shape is stated once:

- The store is chosen by which one holds the id. `_unadopted_row(id)` is `not
  frappe.db.exists("Drive Node", id) and frappe.db.exists("File", id)`. Never
  by catching a refusal: §5.2 makes `DriveNotFound` the answer for a node the
  caller may not read.
- No node is created early. Dormant activation is intact and ticket 29 owns it.
- The gate is always the surviving legacy body's own check, so no deny is
  synthesized: `File.rename`, `toggle_entity_status`, `File.share`,
  `File.unshare`, `File.permanent_delete`, `user_has_permission`,
  `get_user_access_for_user`.
- No destination is synthesized. `move` refuses a cross-store move by name
  (`_refuse_crossing`), and `remove_or_restore` uses `toggle_entity_status`,
  which restores in place.
- The read and the write live in the shim and die with it. `_core` is not
  widened.
- Imports are function-local, because `api/permissions.py` imports `shims` and
  `drive/utils` builds a query-builder DocType at import time.

Site-free, the four http suites plus `suite.tests.test_architecture` ran 436
tests and passed, up from 367 on `main`. On the site: `test_shims` ran 263
(main: 194), `suite.writer.tests.test_drive_adoption` ran 23 and 73 (main: 23
and 47), `suite.writer.api.tests.test_general` ran 7 (main: 2), and
`suite.slides.tests.test_drive_adoption` ran 30 and 71, unchanged. Every site
case was mutation-checked: disabling its `_unadopted_row` branch makes the case
fail or error, and each mutation was reverted in place. `shims.py` changed
across sixteen names, so the root must rerun the suites this branch did not:
`suite.drive.http.tests.test_dispatch`, `suite.drive.api.tests.test_files`,
`suite.drive.api.tests.test_list`, `suite.drive.api.tests.test_notifications`,
`suite.drive.tests.test_sync_permissions`, the three WebDAV suites,
`suite.drive.tests.test_access`, `test_views`, `test_activity`, `test_nodes`,
and `test_grants`. They are unverified here.

40. **Zeros for a node-less `File` emptied three Writer reads.** The legacy
    owned-row rule handed the author every bit, and `get_user_access` answered
    zeros instead. `general.get_document_list` drops a row whose `read` is 0,
    `general.get_versions` throws `PermissionError`, and `general.search` drops
    the result and recounts the summary to zero. The author of a document could
    not list it, could not open its history, and could not find it.
    `_legacy_user_access` answers the bits the `Drive Permission` rows still
    carry, through `get_user_access_for_user`. A `Document` or a `_dict` is
    passed on rather than re-read, which is what the old body did.
41. **`embed.add` could not write a picture into the document that holds it.**
    `upload_core.create_upload` reads the parent as a node
    (`_core/upload.py:41`) and refuses, so no document the product creates
    could take a picture. `_legacy_upload` writes the chunked upload with the
    old body's own helpers: the `user_has_permission(parent, "upload")` gate,
    `get_new_file_name`, the same temp file, `validate_quota` then
    `update_file_size`, and `embed=1` as a placement in `.embeds` with no
    thumbnail. Two things are not the old body's. `list-add` reaches the
    uploader alone, because §5 does not let a row travel to a session that was
    never authorized for it. The answer is the legacy column dict this name
    already returns, not a `Document`, because §11.7 changed that shape once
    and one name may not carry two contracts. A directory upload into such a
    parent walks the `File` store: `ensure_path` is the old body and
    `create_folder` answers a legacy parent, so every part of the path is made.
    The gate is the old body's, on the parent the caller named, before the
    walk.
42. **A legacy folder's page was empty.** `create_document` writes into the
    caller's `Users/<email>` folder, and `files` read nodes only.
    `_merged_folder_page` answers a folder that still holds an Active `File`
    no node holds. Before Build no node holds the folder, so the legacy half is
    the whole page; after Build the node half is read too, and the documents
    written since are the only rows it cannot see. Both halves are read whole
    and sorted by `_ordered_legacy` under the names the client is shown,
    because a merged page cannot be paged in SQL, which is the answer
    `_ordered_listing` already gives to the same problem. `_unadopted_children`
    is one indexed lookup, so a folder with no legacy row never reaches the
    merge and an adopted tree still pays the SQL window §11.4 measured. The
    walk is bounded at `MAX_SORTABLE_ROWS` and `has_next` says when the bound
    was reached. The legacy read's own gate applies only when no node holds the
    folder: asking the old rules a second time would let one store refuse a
    page the other had granted.
43. **`track_visit` recorded nothing for a node-less document.** No unusual
    gesture reaches it: it runs on every document open. `Drive Entity Log
    .last_interaction` is written here and nowhere else, and
    `general.get_document_list` orders by it and publishes it as `accessed`, so
    every document the product creates had no opened-at and no recency order.
    `mark_as_viewed` writes the row, behind `frappe.get_doc`, because `File`
    carries a `has_permission` hook. `_mark_legacy_read` then clears the badge
    for that one file, narrowed by `notif_doctype_name`. Sheets and Slides send
    `doctype`/`docname`, so `_legacy_content_entity` resolves that pair against
    `tabFile`.
44. **`rename` refused the auto-title.** `CoreEditor.vue:349` renames an
    untitled document from its first line on the first Enter, so this is
    reached by typing rather than by a gesture the reader chose. `File.rename`
    is the rule that named the row: it checks Write, keeps the disk path, and
    writes the activity line.
45. **`remove_or_restore` refused a node-less document.** Writer's own
    `RemoveDialog.vue` names one for every document the product creates.
    `_LegacyTrash` calls `toggle_entity_status`, which reads the row's status
    to decide remove or restore and puts it back in place. It builds one
    `FileManager` and one lock set for the whole list, as the old body did, so
    two files with one owner lock that owner's storage once.
46. **Writer's navbar could not read or change a document's sharing.**
    `ShareDialog.vue` and `InfoDialog.vue` open on the document the editor
    holds. `_legacy_update_access` calls `File.share` and `File.unshare`, and
    passes the caller's own `user` spelling rather than the normalised
    `$PUBLIC`, because the old rules keep `""` and `$GENERAL`. The deny
    `File.unshare` writes is kept: on the `File` store it is the only way the
    old resolver spells "restricted", and dropping it would leave an unshared
    document readable. `_legacy_general_access` asks the old resolver the old
    body's three questions: does the caller read it, does `Guest`, does
    `$GENERAL`. `_legacy_shared_with_list` reads `Drive Permission` minus the
    two site-wide principals and every deny, with the owner in front, gated by
    `user_has_permission(entity, "share")`.
47. **`set_favourite`, `move` and `create_folder` refused a node-less row.**
    Favourite is an ordinary gesture and move is a less common one.
    `_legacy_favourite` writes `Drive Favourite` with no check of its own, as
    the old body did: the row is the caller's, `filter_drive_favourite` scopes
    every read to them, and a gate here would be a denial §11.7 may not invent.
    `clear_all` clears both stores, because the old name cleared everything the
    caller held. `move` works inside one store and refuses to cross by name.
    An unnamed destination is `File.move`'s own default, the caller's legacy
    user folder, which is not the node personal root. `create_folder` broke on
    a node-less parent, which Drive's New menu now names because the folder
    page opens; `_legacy_create_folder` keeps the old body whole behind
    `user_has_permission(parent, "upload")`.
48. **`delete_entities` and `does_entity_exist` broke on a node-less row.**
    `delete_entities` is reached through the DOCX-import rollback,
    `writer/utils/docximporter.js`, which purges the pictures a failed import
    uploaded. A named id purges from either store through
    `File.permanent_delete`, the rule that wrote the row, which carries its own
    Write check and tombstones with `status = "Removed"` as it always did.
    `clear_all` still names only the node trash view: §11.2 has no trash view
    for the legacy store, and listing one here would be a view the shim
    invented. `does_entity_exist` answers off `tabFile`, with the same UPLOAD
    gate, because `FileUploader.vue` asks about the folder it is about to
    upload into and that folder's page now opens.
49. **`create_link` broke on a node-less parent.** `NewLinkDialog.vue` names
    the folder its page is showing, and `list.files` now opens a folder no node
    holds. `_legacy_create_link` keeps the old body whole, behind the
    `user_has_permission(parent, "upload")` gate `create_folder` keeps.
50. **A file in a legacy folder could not be opened.** The fix in 42 put the
    files a legacy folder already held back on a page, which is what made this
    reachable. §6.8 signs a node's content and has nothing to sign for a row
    with no node, so `get_file_internal` serves the bytes, behind the old
    `user_has_permission(entity_name, "read")` gate. The retired download token
    is refused first, whichever store holds the row. `Document` is in
    `FORBIDDEN_DOWNLOAD_TYPES`, so the old body answered "Not found" for one
    and never reached its own redirect to the editor. That dead branch is left
    out, with the reason in the code: `openEntity` routes a `Document` to
    `/writer/w/` instead.

## Carried risks the review did not fix

- **`unshare` on a site-wide principal writes no deny.** `File.unshare` called
  `_insert_deny` when read was still inherited from above, so "Restricted" on a
  file inside a public folder cut the inheritance. §5.10 makes a deny something
  the client must ask for, so the shim removes rows and stops. A file inside a
  publicly shared folder stays readable after "Restricted", and the dialog says
  nothing. The frontend ticket owns telling the user.
- **The route surface still deletes the values its refusals name.**
  `_core/nodes.py:369, 759, 1939, 2231, 2316` and `_core/activity.py:51, 441`
  spell a client-supplied kind, doctype, node id, or view name into a message
  that `routes.py:112` throws. Legacy callers are covered by `_plain` at the
  shim boundary; a §11.2 caller still reads the text with the value deleted.
  Every one of those lines predates ticket 23 and belongs to the route surface,
  so ticket 23 did not edit them.
- **`update_access` cannot spell `share` without `write`.** The ladder puts
  MANAGE above EDIT. A legacy row that said "may re-share, may not edit"
  becomes UPLOAD or COMMENT, never MANAGE. One e2e test depends on the old
  reading: `specs/drive/sharing.spec.ts:192-221` shares `{read: 1, share: 1}`,
  then expects the re-share to be refused with "cannot grant". The first share
  now lands at READ, so the second call is refused by the MANAGE gate with a
  different message. The spec needs the frontend ticket, not a shim change.
  Read, not run: this review has no site.

- **Uploads fail on a site whose `storage_driver` is `s3`.** The driver offers
  a presigned target, so `create_blob_upload` opens a direct session. A legacy
  caller has already sent its bytes to the server, and §11.7 has no way to hand
  them on: a presigned POST pins the object to one request and the whole
  declared length, which a chunked legacy upload does not have. Relaying would
  mean buffering the whole file server-side, which is the temp file §14 removed.
  The refusal names the cause. The new route surface is unaffected, because it
  returns the target to the client.

- **`Administrator` has no personal Drive folder.** `provision_personal_root`
  refuses `Guest` and `Administrator` by §7, and legacy `get_user_folder()`
  made one for anybody. An Administrator with no root migrated by Build is
  refused by name at `_home` rather than handed a `None`. Reaching Drive as
  `Administrator` is a §7 question, not a shim one.

- **A share to an address with no `User` row is refused.** `File.share` called
  `create_invites(user, auto=True)` and made a `Drive User Invitation`;
  `access._validate_principal_target` refuses. `TagInput` still offers "Add
  email", so the dialog can still submit one.

- **A new share sends no email.** `Drive Permission.after_insert` enqueued
  `notify_share`, which sent one. `_core.access` writes a `Drive Notification`
  row and stops.

- **A site-wide share drops the sharer below MANAGE.** §5.1 resolves own
  principals nearest-first, and `$GENERAL` is an own principal. The owner of a
  Personal root holds MANAGE from the root anchor, which is the shallowest row
  in the chain, so a `$GENERAL` READ row written on one file is nearer and
  decides. The owner falls to READ on their own file, and the next
  `update_access` refuses with 403: publishing it, changing it, and unsharing
  it all need MANAGE. Only an admin can undo it. `$PUBLIC` does not do this,
  because pass 2 never lowers anyone. The old body had no such rule:
  `get_user_access_for_user` answered an owner full access before it read a
  row. The dialog sends `$GENERAL` for "Everyone at site", so this is one
  click. §5.1 is the engine's rule and the shim does not get to hold a second
  one, so ticket 23 pins the new answer in a test and records it here.
  Found by module 3 of the site gate.

- **`upload_file` needs `storage_v2` in `site_config`.** `_core.upload` opens a
  blob session, and `frappe.storage.upload.create_blob_upload` refuses with
  `File Storage v2 is not enabled for this site` when the flag is absent. The
  old body wrote a temp file and needed no flag. This is a §14 deployment
  prerequisite rather than a ticket 23 defect, but it is new for a legacy
  caller: a site that upgrades without the flag loses uploads on the legacy
  name as well as the new route.

- **A file's `file_type` comes from storage now, not from the bytes.** The old
  `upload_file` sniffed the staged file with
  `mimemapper.get_mime_type(path, native_first=False)` and typed it from that.
  `_core.upload.finish_upload` takes `blob.mime_type`, so an extension the site
  cannot name reads back as `application/octet-stream`, which the legacy mime
  table calls `Application`. The old answer for the same upload was the sniffed
  type. `file_type` drives icons and the legacy `file_kinds` filter, so a
  client sees a different bucket for the same bytes. The mime decision belongs
  to §14, not to the shim.

- **Retiring `get_new_title` breaks a directory upload that collides.**
  `FileUploader.vue:48-64` calls it to rename the top folder of a dropped
  directory when a sibling already holds the name, and a retired name answers
  410, so the SPA throws `Request failed with status 410`. No capability is
  lost server-side: `shims._ensure_path` reuses an existing folder by name, and
  `upload_file` still applies §8.6's dedupe rule to files. The retirement is
  §11.7's own decision; the frontend ticket owns the call site.

- **Two permission stores coexist until Build.** `generate_upward_path` and
  `user_has_permission` read `Drive Permission`; the forwarders write
  `Drive Grant`. The retained names (`download_folder`, `download_status`,
  `download_archive`, `get_attachments`, `sync_preview`) and `/dav` still read
  the first. Pointing them at `_core.access` before Build would deny
  everything, because no `Drive Node` exists yet. Cleanup owns the crossover.

- **`get_thumbnail` answers nothing for a node-less row.** The residual audit
  classified it out of scope. The URL is only built for Image, Video and PDF
  (`drive/utils/files.js:300-307`), and `GridItem.vue:5-24` shows the file-type
  icon until the thumbnail loads, so a refusal leaves the icon in place.

- **`get_entity_type` answers nothing for a node-less row.** Out of scope for
  the same audit. Only the `/drive/g/:id` guard reads it, and
  pre-team-restructure links feed that route.

- **`get_entity_activity_log` answers nothing for a node-less row.** Out of
  scope: zero call sites in `frontend/src` and `e2e/`.

- **`search` and `list.files(search=...)` do not reach the legacy store.** Out
  of scope. They return nothing rather than refusing, and a legacy full-text
  search would be a second search implementation.

- **The store decision reads existence.** A legacy `File` left behind by a
  purge after Build would be answered again by every name the residual audit
  fixed. It cannot happen before Build, because no node exists at all. Tickets
  27 and 29 own keeping the two stores in step.

- **The residual branches outlive their reason if ticket 29 does not replace
  `create_document`.** Once `drive_content_types` names Writer,
  `content.require_node` refuses a `Writer Document` with no node, so the
  endpoint fails loudly rather than writing more legacy rows.

- **A cross-store `move` is refused by name, not performed.** Build is what
  joins the two trees.

- **Two frontend defects were found and not fixed.** Both predate ticket 23 and
  belong to the frontend ticket.
  `frontend/src/apps/writer/components/ErrorPage.vue:6,14` branches on
  `error.type` while `frappeRequest` sets `exc_type`, so every non-string error
  renders "You do not have access to this."
  `frontend/src/apps/writer/utils/index.js:447` has a duplicated
  `/api/method/` prefix.
