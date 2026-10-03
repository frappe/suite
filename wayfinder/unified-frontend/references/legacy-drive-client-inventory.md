# Legacy Drive client inventory

## Scope and method

This inventory covers `frontend/src`. It was built with:

```text
rg -n "suite\.drive\.api\.|createResource|createListResource|createDocumentResource|useCall|useList|useDoc|frappeRequest|fetch\(|/api/method/|/api/suite/drive|socket\.on\(|emitter" frontend/src
```

The search found 104 text matches for `suite.drive.api.*`. Four are test fixtures or assertions. The other 100 are production references. There are 60 distinct names. All 60 occur in Drive UI code. Writer repeats six. Sheets and Slides repeat one each. Meet, Mail, shell, and boot repeat none.

The REST registry is `suite/drive/http/translator.py:30-40`. It registers 42 method and path pairs at `suite/drive/http/translator.py:40-100`. The handlers and verbs are in `suite/drive/http/routes.py:133-1076`. The implemented registry is the route authority used below. Every REST path below is relative to `/api/suite/drive`.

The shim status is the code classification at `suite/drive/http/shims.py:69-155`. The four statuses are defined at `suite/drive/http/shims.py:9-29`. A missing exact REST operation is written as `none`. A partial or intended route is then named in parentheses.

## Drive UI

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|
| `suite.drive.api.files.create_auth_token` | `frontend/src/apps/drive/components/FileTypePreview/MSOfficePreview.vue:46` | raw `fetch` | none. Signed `GET /nodes/<id>/content` replaces the token flow (`suite/drive/http/routes.py:362-392`) | retired (`suite/drive/http/shims.py:80`) |
| `suite.drive.api.files.create_folder` | `frontend/src/apps/drive/components/NewFolderDialog.vue:38`; `frontend/src/apps/drive/ui/drive/components/MoveDialog.vue:298` | `createResource` | `POST /nodes` with `kind=folder` (`suite/drive/http/translator.py:41`; `suite/drive/http/routes.py:133`) | forwarder (`suite/drive/http/shims.py:78`) |
| `suite.drive.api.files.create_link` | `frontend/src/apps/drive/components/NewLinkDialog.vue:36` | `createResource` | `POST /nodes` with `kind=link` (`suite/drive/http/translator.py:41`; `suite/drive/http/routes.py:133`) | forwarder (`suite/drive/http/shims.py:79`) |
| `suite.drive.api.files.delete_entities` | `frontend/src/apps/drive/resources/files.js:249`; `frontend/src/apps/drive/utils/confirmActions.js:75` | `createResource`; `call` | `DELETE /nodes/<id>` (`suite/drive/http/translator.py:45`; `suite/drive/http/routes.py:230`) | forwarder (`suite/drive/http/shims.py:88`) |
| `suite.drive.api.files.does_entity_exist` | `frontend/src/apps/drive/components/FileUploader.vue:33` | synchronous `XMLHttpRequest` | `POST /nodes`. The write performs the sibling collision check. There is no separate probe route (`suite/drive/http/routes.py:133-173`; `suite/drive/http/shims.py:2248-2266`) | forwarder (`suite/drive/http/shims.py:92`) |
| `suite.drive.api.files.download_archive` | `frontend/src/apps/drive/utils/download.js:43` | browser navigation | none. The content handler rejects folder nodes (`suite/drive/http/routes.py:364-392`) | retained (`suite/drive/http/shims.py:85`; reason at `suite/drive/http/shims.py:163`) |
| `suite.drive.api.files.download_folder` | `frontend/src/apps/drive/utils/download.js:25` | `call` | none. No route builds a folder archive (`suite/drive/http/shims.py:161`) | retained (`suite/drive/http/shims.py:83`) |
| `suite.drive.api.files.download_status` | `frontend/src/apps/drive/utils/download.js:76` | `call` | none. No route reports archive progress (`suite/drive/http/shims.py:162`) | retained (`suite/drive/http/shims.py:84`) |
| `suite.drive.api.files.get_entity_type` | `frontend/src/apps/drive/routes.ts:106` | `createResource` | `GET /nodes/<id>` (`suite/drive/http/translator.py:43`; `suite/drive/http/routes.py:176`) | forwarder (`suite/drive/http/shims.py:97`) |
| `suite.drive.api.files.get_file_content` | `frontend/src/apps/drive/components/FileRender.vue:43`; `frontend/src/apps/drive/components/FileTypePreview/PDFPreview.vue:42`; `frontend/src/apps/drive/components/FileTypePreview/MSOfficePreview.vue:61`; `frontend/src/apps/drive/components/FileTypePreview/TextPreview.vue:32`; `frontend/src/apps/drive/components/FileTypePreview/ImagePreview.vue:40`; `frontend/src/apps/drive/components/FileTypePreview/AudioPreview.vue:30,46`; `frontend/src/apps/drive/utils/download.js:12` | browser navigation; raw `fetch`; media or renderer URL | `GET /nodes/<id>/content` (`suite/drive/http/translator.py:49`; `suite/drive/http/routes.py:362`) | forwarder (`suite/drive/http/shims.py:81`) |
| `suite.drive.api.files.get_new_title` | `frontend/src/apps/drive/components/FileUploader.vue:52` | synchronous `XMLHttpRequest` | none. Writes now return a 409 collision (`wayfinder/drive-layer-spec/drive-layer-spec.md:3113-3116`) | retired (`suite/drive/http/shims.py:93`; refusal at `suite/drive/http/shims.py:1249-1260`) |
| `suite.drive.api.files.get_root_folder` | `frontend/src/apps/drive/resources/files.js:46`; `frontend/src/apps/drive/ui/drive/js/resources.js:6` | `createResource` | none. `GET /roots/<id>/usage` is partial and already needs the root id (`suite/drive/http/routes.py:525-529`; `suite/drive/http/shims.py:2349-2364`) | forwarder (`suite/drive/http/shims.py:98`) |
| `suite.drive.api.files.get_thumbnail` | `frontend/src/apps/drive/utils/files.js:305` | browser image URL | `GET /nodes/<id>?expand=preview` (`suite/drive/http/translator.py:43`; `suite/drive/http/routes.py:176-190`) | forwarder (`suite/drive/http/shims.py:77`) |
| `suite.drive.api.files.move` | `frontend/src/apps/drive/resources/files.js:305`; `frontend/src/apps/drive/ui/drive/js/resources.js:12` | `createResource` | `PATCH /nodes/<id>` or `POST /nodes/batch` (`suite/drive/http/translator.py:42,44`; `suite/drive/http/routes.py:193-227,297-320`) | forwarder (`suite/drive/http/shims.py:94`) |
| `suite.drive.api.files.redirect_to_original` | `frontend/src/apps/drive/components/GenericPage.vue:567`; `frontend/src/apps/drive/components/Navbar.vue:218` | `window.open` | `GET /nodes/<id>`, followed by client routing from the node shape (`suite/drive/http/translator.py:43`; shim limitation at `suite/drive/http/shims.py:2368-2381`) | forwarder (`suite/drive/http/shims.py:99`) |
| `suite.drive.api.files.remove_or_restore` | `frontend/src/apps/drive/utils/confirmActions.js:27,46` | `call` | `PATCH /nodes/<id>` or `POST /nodes/batch` (`suite/drive/http/translator.py:42,44`; `suite/drive/http/routes.py:193-227,297-320`) | forwarder (`suite/drive/http/shims.py:87`) |
| `suite.drive.api.files.remove_recents` | `frontend/src/apps/drive/resources/files.js:229` | `createResource` | `DELETE /views/recents` (`suite/drive/http/translator.py:71`; `suite/drive/http/routes.py:775-780`) | forwarder (`suite/drive/http/shims.py:91`) |
| `suite.drive.api.files.rename` | `frontend/src/apps/drive/resources/files.js:270`; `frontend/src/apps/drive/ui/drive/js/resources.js:50` | `createResource` | `PATCH /nodes/<id>` with `{title}` (`suite/drive/http/translator.py:44`; `suite/drive/http/routes.py:193-227`) | forwarder (`suite/drive/http/shims.py:89`) |
| `suite.drive.api.files.resolve_legacy_route` | `frontend/src/apps/drive/routes.ts:211` | `createResource` | none. Only the shim reads `Drive Legacy Route` (`suite/drive/http/shims.py:2455-2469`; spec check at `wayfinder/drive-layer-spec/drive-layer-spec.md:3119-3120`) | forwarder (`suite/drive/http/shims.py:101`) |
| `suite.drive.api.files.search` | `frontend/src/apps/drive/components/SearchPopup.vue:113` | `createResource` | `GET /views/search` (`suite/drive/http/translator.py:72`; `suite/drive/http/routes.py:706-756`) | forwarder (`suite/drive/http/shims.py:95`) |
| `suite.drive.api.files.set_favourite` | `frontend/src/apps/drive/resources/files.js:182` | `createResource` | `PUT` or `DELETE /nodes/<id>/favourite` (`suite/drive/http/translator.py:57-58`; `suite/drive/http/routes.py:1014-1032`) | forwarder (`suite/drive/http/shims.py:86`) |
| `suite.drive.api.files.share` | `frontend/src/apps/drive/resources/permissions.js:12` | `createResource` | none. This exact method does not exist. The apparent intended method is `update_access` at `suite/drive/api/files.py:486-495` | absent from the 26 file-method shim entries (`suite/drive/http/shims.py:75-101`) |
| `suite.drive.api.files.stream_file_content` | `frontend/src/apps/drive/components/FileTypePreview/VideoPreview.vue:36,54` | media URL | `GET /nodes/<id>/content` (`suite/drive/http/translator.py:49`; `suite/drive/http/routes.py:362`) | forwarder (`suite/drive/http/shims.py:82`) |
| `suite.drive.api.files.track_visit` | `frontend/src/apps/drive/pages/File.vue:121` | `createResource` | `POST /nodes/<id>/visit` (`suite/drive/http/translator.py:56`; `suite/drive/http/routes.py:1006-1011`) | forwarder (`suite/drive/http/shims.py:100`) |
| `suite.drive.api.files.translate_old_name` | `frontend/src/apps/drive/resources/files.js:324` | `createResource` | none. The shim performs an id readability check (`suite/drive/http/shims.py:2326-2334`; spec check at `wayfinder/drive-layer-spec/drive-layer-spec.md:3119-3120`) | forwarder (`suite/drive/http/shims.py:96`) |
| `suite.drive.api.files.update_access` | `frontend/src/apps/drive/ui/drive/js/resources.js:33` | `createResource` | `PUT` or `DELETE /nodes/<id>/grants/<principal>` (`suite/drive/http/translator.py:65-66`; `suite/drive/http/routes.py:596-660`) | forwarder (`suite/drive/http/shims.py:90`) |
| `suite.drive.api.files.upload_file` | `frontend/src/apps/drive/components/FileUploader.vue:117`; `frontend/src/apps/drive/utils/files.js:547` | Dropzone endpoint; `useFileUpload` | `POST /uploads`, `PUT /uploads/<id>/chunk`, `POST /uploads/<id>/finish` (`suite/drive/http/translator.py:52-54`; `suite/drive/http/routes.py:442-501`) | forwarder (`suite/drive/http/shims.py:76`) |
| `suite.drive.api.list.favourites` | `frontend/src/apps/drive/resources/files.js:72` | `createResource` | `GET /views/favourites` (`suite/drive/http/translator.py:72`; `suite/drive/http/routes.py:706-756`) | forwarder (`suite/drive/http/shims.py:105`) |
| `suite.drive.api.list.files` | `frontend/src/apps/drive/data/folderTree.js:25`; `frontend/src/apps/drive/resources/files.js:37,59,78,162`; `frontend/src/apps/drive/ui/drive/components/MoveDialog.vue:202`; `frontend/src/apps/drive/pages/Folder.vue:36` | `frappeRequest`; `createResource` | `GET /nodes/<id>/children` (`suite/drive/http/translator.py:46`; `suite/drive/http/routes.py:238-280`) | forwarder (`suite/drive/http/shims.py:103`) |
| `suite.drive.api.list.get_attachments` | `frontend/src/apps/drive/resources/files.js:65` | `createResource` | none. `GET /nodes/<id>/media` lists embedded media, not framework attachments (`suite/drive/http/routes.py:416-420`; `suite/drive/http/shims.py:164-169`) | retained (`suite/drive/http/shims.py:108`) |
| `suite.drive.api.list.recents` | `frontend/src/apps/drive/resources/files.js:53` | `createResource` | `GET /views/recents` (`suite/drive/http/translator.py:72`; `suite/drive/http/routes.py:706-756`) | forwarder (`suite/drive/http/shims.py:106`) |
| `suite.drive.api.list.shared` | `frontend/src/apps/drive/resources/files.js:108` | `createResource` | `GET /views/shared` (`suite/drive/http/translator.py:72`; `suite/drive/http/routes.py:706-756`) | forwarder (`suite/drive/http/shims.py:104`) |
| `suite.drive.api.list.trash` | `frontend/src/apps/drive/resources/files.js:117` | `createResource` | `GET /views/trash` (`suite/drive/http/translator.py:72`; `suite/drive/http/routes.py:706-767`) | forwarder (`suite/drive/http/shims.py:107`) |
| `suite.drive.api.notifications.get_notifications` | `frontend/src/apps/drive/pages/Notifications.vue:102` | `createResource` | `GET /notifications` (`suite/drive/http/translator.py:95`; `suite/drive/http/routes.py:1040-1050`) | forwarder (`suite/drive/http/shims.py:117`) |
| `suite.drive.api.notifications.get_unread_count` | `frontend/src/apps/drive/resources/permissions.js:18` | `createResource` | none. `GET /notifications?unread=1` returns a page, not the badge count (`suite/drive/http/routes.py:1040-1050`; `suite/drive/http/shims.py:1084-1094`) | forwarder (`suite/drive/http/shims.py:118`) |
| `suite.drive.api.notifications.mark_as_read` | `frontend/src/apps/drive/pages/Notifications.vue:116` | `createResource` | `POST /notifications/read` (`suite/drive/http/translator.py:96`; `suite/drive/http/routes.py:1053-1068`) | forwarder (`suite/drive/http/shims.py:119`) |
| `suite.drive.api.permissions.get_entity_with_permissions` | `frontend/src/apps/drive/ui/drive/components/MoveDialog.vue:235`; `frontend/src/apps/drive/pages/Folder.vue:57`; `frontend/src/apps/drive/pages/File.vue:125` | `createResource` | `GET /nodes/<id>?expand=access,breadcrumbs,preview` (`suite/drive/http/translator.py:43`; `suite/drive/http/routes.py:176-190`) | forwarder (`suite/drive/http/shims.py:112`) |
| `suite.drive.api.permissions.get_general_access` | `frontend/src/apps/drive/resources/permissions.js:38`; `frontend/src/apps/drive/ui/drive/components/ShareDialog.vue:190`; `frontend/src/apps/drive/ui/drive/components/InfoDialog.vue:145` | `createResource` | `GET /nodes/<id>?expand=access` (`suite/drive/http/translator.py:43`; `suite/drive/http/routes.py:176-190`) | forwarder (`suite/drive/http/shims.py:111`) |
| `suite.drive.api.permissions.get_shared_with_list` | `frontend/src/apps/drive/resources/permissions.js:7,42`; `frontend/src/apps/drive/ui/drive/js/resources.js:28`; `frontend/src/apps/drive/ui/drive/components/InfoDialog.vue:151` | `createResource` | `GET /nodes/<id>/grants` (`suite/drive/http/translator.py:59`; `suite/drive/http/routes.py:564-594`) | forwarder (`suite/drive/http/shims.py:113`) |
| `suite.drive.api.product.accept_invite` | `frontend/src/apps/drive/resources/permissions.js:75` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:142`) |
| `suite.drive.api.product.disk_settings` | `frontend/src/apps/drive/resources/permissions.js:99`; `frontend/src/apps/drive/components/Settings/BackendSettings.vue:138` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:146`) |
| `suite.drive.api.product.get_my_invites` | `frontend/src/apps/drive/resources/permissions.js:71` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:131`) |
| `suite.drive.api.product.get_pending_invites` | `frontend/src/apps/drive/components/Settings/UserListSettings.vue:190` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:132`) |
| `suite.drive.api.product.get_settings` | `frontend/src/apps/drive/resources/permissions.js:24` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:137`) |
| `suite.drive.api.product.get_translations` | `frontend/src/apps/drive/routes.ts:238` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:144`) |
| `suite.drive.api.product.get_user_groups` | `frontend/src/apps/drive/resources/permissions.js:57` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:141`) |
| `suite.drive.api.product.get_users` | `frontend/src/apps/drive/resources/permissions.js:46`; `frontend/src/apps/drive/ui/drive/js/resources.js:39` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:140`) |
| `suite.drive.api.product.invite_users` | `frontend/src/apps/drive/components/Settings/UserListSettings.vue:237` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:139`) |
| `suite.drive.api.product.is_site_admin` | `frontend/src/apps/drive/resources/permissions.js:84` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:145`) |
| `suite.drive.api.product.reject_invite` | `frontend/src/apps/drive/resources/permissions.js:79` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:143`) |
| `suite.drive.api.product.send_otp` | `frontend/src/apps/drive/pages/Signup.vue:227` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:135`) |
| `suite.drive.api.product.set_settings` | `frontend/src/apps/drive/resources/permissions.js:30` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:138`) |
| `suite.drive.api.product.set_webdav_enabled` | `frontend/src/apps/drive/components/Settings/WebDAVSettings.vue:124` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:148`) |
| `suite.drive.api.product.signup` | `frontend/src/apps/drive/pages/Signup.vue:205` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:133`) |
| `suite.drive.api.product.verify_otp` | `frontend/src/apps/drive/pages/Signup.vue:237` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:136`) |
| `suite.drive.api.product.webdav_config` | `frontend/src/apps/drive/resources/permissions.js:88` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:147`) |
| `suite.drive.api.scripts.sync_from_disk` | `frontend/src/apps/drive/components/SyncBreakdown.vue:105` | `createResource` | none. Build replaces the disk import (`wayfinder/drive-layer-spec/drive-layer-spec.md:3142-3144`) | retired (`suite/drive/http/shims.py:125`; refusal at `suite/drive/http/shims.py:1264-1274`) |
| `suite.drive.api.scripts.sync_preview` | `frontend/src/apps/drive/components/SyncBreakdown.vue:100` | `createResource` | none. `POST /nodes/<id>/preview` pushes an image. It does not list unregistered disk files (`suite/drive/http/routes.py:423-434`; `suite/drive/http/shims.py:170-174`) | retained (`suite/drive/http/shims.py:124`) |
| `suite.drive.api.storage.storage_bar_data` | `frontend/src/apps/drive/resources/files.js:328` | `createResource` | `GET /roots/<id>/usage` (`suite/drive/http/translator.py:97`; `suite/drive/http/routes.py:525-529`) | forwarder (`suite/drive/http/shims.py:122`) |
| `suite.drive.api.storage.storage_breakdown` | `frontend/src/apps/drive/components/Settings/StorageSettings.vue:82` | `createResource` | none. `GET /roots/<id>/usage` is partial. It omits by-type totals and largest files (`suite/drive/http/routes.py:525-529`; `suite/drive/http/shims.py:1155-1199`) | forwarder (`suite/drive/http/shims.py:121`) |

The two Drive test files add three non-runtime matches. They are `frontend/src/apps/drive/components/GenericPage.test.ts:113,199` and `frontend/src/apps/drive/components/FileTypePreview/TextPreview.test.ts:52`.

## Writer

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|
| `suite.drive.api.files.delete_entities` | `frontend/src/apps/writer/utils/docximporter.js:38` | `call` | `DELETE /nodes/<id>` (`suite/drive/http/translator.py:45`; `suite/drive/http/routes.py:230`) | forwarder (`suite/drive/http/shims.py:88`) |
| `suite.drive.api.files.remove_or_restore` | `frontend/src/apps/writer/components/RemoveDialog.vue:38,50` | dynamic `createResource` at `frontend/src/apps/writer/components/RemoveDialog.vue:84-85` | `PATCH /nodes/<id>` or `POST /nodes/batch` (`suite/drive/http/translator.py:42,44`; `suite/drive/http/routes.py:193-227,297-320`) | forwarder (`suite/drive/http/shims.py:87`) |
| `suite.drive.api.files.track_visit` | `frontend/src/apps/writer/composables/useDocument.ts:8` | `createResource` | `POST /nodes/<id>/visit` (`suite/drive/http/translator.py:56`; `suite/drive/http/routes.py:1006-1011`) | forwarder (`suite/drive/http/shims.py:100`) |
| `suite.drive.api.files.upload_file` | `frontend/src/apps/writer/utils/index.js:447` | `useFileUpload` | `POST /uploads`, `PUT /uploads/<id>/chunk`, `POST /uploads/<id>/finish` (`suite/drive/http/translator.py:52-54`; `suite/drive/http/routes.py:442-501`) | forwarder (`suite/drive/http/shims.py:76`) |
| `suite.drive.api.permissions.get_entity_with_permissions` | `frontend/src/apps/writer/composables/useDocument.ts:19` | `useDoc` | `GET /nodes/<id>?expand=access,breadcrumbs,preview` (`suite/drive/http/translator.py:43`; `suite/drive/http/routes.py:176-190`) | forwarder (`suite/drive/http/shims.py:112`) |
| `suite.drive.api.product.get_translations` | `frontend/src/apps/writer/routes.ts:57` | `createResource` | none. Product methods stay on `/api/method/` (`wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`) | permanent (`suite/drive/http/shims.py:144`) |

Writer also has one test-only `delete_entities` match at `frontend/src/apps/writer/utils/docximporter.test.js:309`. The upload URL has a doubled `/api/method/` prefix at `frontend/src/apps/writer/utils/index.js:447`.

## Sheets

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|
| `suite.drive.api.files.track_visit` | `frontend/src/apps/sheets/components/SheetEditor/usePersistence.js:33` | `frappeRequest` | `POST /nodes/<id>/visit` (`suite/drive/http/translator.py:56`; `suite/drive/http/routes.py:1006-1011`) | forwarder (`suite/drive/http/shims.py:100`) |

## Slides

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|
| `suite.drive.api.files.track_visit` | `frontend/src/apps/slides/stores/presentation.js:330` | `frappeRequest` | `POST /nodes/<id>/visit` (`suite/drive/http/translator.py:56`; `suite/drive/http/routes.py:1006-1011`) | forwarder (`suite/drive/http/shims.py:100`) |

## Meet

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|

The grep found no `suite.drive.api.*` references under `frontend/src/apps/meet`.

## Mail

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|

The grep found no `suite.drive.api.*` references under `frontend/src/apps/mail`.

## Shell and boot

| Legacy method | Caller file and line | Client primitive | Implemented REST replacement | Shim status |
|---|---|---|---|---|

The grep found no `suite.drive.api.*` references under `frontend/src/shell` or `frontend/src/boot`.

## Interface bypasses

Drive calls three content-product endpoints directly.

| Direction | Bypass | File and line |
|---|---|---|
| Drive to Slides | Lists presentations through `suite.slides.doctype.presentation.presentation.get_presentations`. | `frontend/src/apps/drive/resources/files.js:85-104` |
| Drive to Writer | Creates a Writer document through `suite.writer.api.docs.create_document`. | `frontend/src/apps/drive/resources/files.js:291-295` |
| Drive to Sheets | Creates a sheet through `suite.sheets.api.create_sheet`. | `frontend/src/apps/drive/resources/files.js:297-301` |

This conflicts with the generic Drive creation rule at `ARCHITECTURE.md:314-322`.

Writer and Slides import Drive paths below the package root. The checker permits only the exact canonical package root and records other cross-product paths as violations at `frontend/scripts/check-import-boundaries.mjs:154-188`.

| Caller | Drive import | File and line |
|---|---|---|
| Slides | `@/apps/drive/sdk` | `frontend/src/apps/slides/components/SharePopover.vue:13` |
| Writer | `@/apps/drive/sdk` | `frontend/src/apps/writer/components/CommentEditor.vue:44`; `frontend/src/apps/writer/components/CoreEditor.vue:73`; `frontend/src/apps/writer/components/Dialogs.vue:16`; `frontend/src/apps/writer/components/Navbar.vue:111`; `frontend/src/apps/writer/components/ToC.vue:118`; `frontend/src/apps/writer/composables/useDocument.ts:4`; `frontend/src/apps/writer/composables/useUsers.ts:1`; `frontend/src/apps/writer/routes.ts:7`; `frontend/src/apps/writer/utils/index.js:12` |
| Writer | `@/apps/drive/data/selection` | `frontend/src/apps/writer/components/Dialogs.vue:17` |
| Writer | `@/apps/drive/components/EditableBreadcrumbs.vue` | `frontend/src/apps/writer/components/Navbar.vue:110` |
| Writer | `@/apps/drive/resources/files` | `frontend/src/apps/writer/components/Navbar.vue:112` |

The checker baselines the Slides debt at `frontend/scripts/check-import-boundaries.mjs:60-64`. It baselines the Writer debt at `frontend/scripts/check-import-boundaries.mjs:66-82`. Drive does expose a package-root interface at `frontend/src/apps/drive/index.ts:1-14`, but the callers still use subpaths.

## Permanent names

| Permanent name | SPA touch | Source evidence |
|---|---|---|
| `suite.drive.api.s3.fetch` | There is no literal under `frontend/src`. The browser can receive it inside a stored `File.file_url`. Slides uses that field as a media source. Managed Drive thumbnails and downloads still call `get_thumbnail` and `get_file_content`. | The stored URL prefix and builder are at `suite/drive/utils/files.py:21,596-599`. The Slides consumer is `frontend/src/apps/slides/stores/element.js:614-615,711-715`. Drive thumbnail and download paths are at `frontend/src/apps/drive/utils/files.js:299-306` and `frontend/src/apps/drive/utils/download.js:10-15`. The permanent classification is `suite/drive/http/shims.py:129`. |
| `suite.drive.overrides.file.get_file_for_doc` | Drive SDK calls the permanent method. Slides calls the SDK before opening its share dialog. | `frontend/src/apps/drive/sdk.js:23-25`; `frontend/src/apps/slides/components/SharePopover.vue:20-23`; `suite/drive/http/shims.py:154` |
| `/dav` | Drive fetches `webdav_config` and copies the returned `server_url` in the settings panel. The literal comes from the backend response. | `frontend/src/apps/drive/resources/permissions.js:87-90`; `frontend/src/apps/drive/components/Settings/WebDAVSettings.vue:40`; `suite/drive/api/product.py:322-349` |

The spec says `get_file_for_doc` also sits in `suite/public/frontend/assets/sdk-o7hlQ1xj.js` at `wayfinder/drive-layer-spec/drive-layer-spec.md:3163-3169`. That bundle is not present in this worktree. `.gitignore:12-15` ignores generated frontend assets.

## Code and spec differences

- Section 11.7 maps the three archive calls to folder content at `wayfinder/drive-layer-spec/drive-layer-spec.md:3110-3112`. The handler serves files and documents only, then rejects other kinds at `suite/drive/http/routes.py:364-392`. The code retains all three calls at `suite/drive/http/shims.py:83-85,160-163`.
- Section 11.7 maps framework attachments to node media at `wayfinder/drive-layer-spec/drive-layer-spec.md:3122-3124`. The code says these are different records and retains the old call at `suite/drive/http/shims.py:164-169`.
- Section 11.7 maps `sync_preview` to preview push at `wayfinder/drive-layer-spec/drive-layer-spec.md:3142-3144`. The old call lists unregistered disk files. The route accepts rendered image bytes. The code records the name collision at `suite/drive/http/shims.py:170-174`.
- Section 11.7 maps `does_entity_exist` to node get at `wayfinder/drive-layer-spec/drive-layer-spec.md:3113-3116`. The shim instead performs the sibling-title check used by node creation at `suite/drive/http/shims.py:2248-2266`.
- Section 11.7 points `get_root_folder` at usage and the node shape at `wayfinder/drive-layer-spec/drive-layer-spec.md:3117`. Both already require a known id. The shim confirms that section 11.2 has no root-discovery route at `suite/drive/http/shims.py:2349-2364`.
- Section 11.7 groups both old-name methods over `Drive Legacy Route` at `wayfinder/drive-layer-spec/drive-layer-spec.md:3119-3120`. Only `resolve_legacy_route` reads that table at `suite/drive/http/shims.py:2455-2469`. `translate_old_name` performs an identity and readability check at `suite/drive/http/shims.py:2326-2334`.
- Section 11.7 maps unread count to notifications at `wayfinder/drive-layer-spec/drive-layer-spec.md:3135-3137`. The route returns paged rows. The scalar count remains shim-only at `suite/drive/http/shims.py:1084-1094`.
- Section 11.7 maps both storage calls to root usage at `wayfinder/drive-layer-spec/drive-layer-spec.md:3139-3140`. The breakdown also needs by-type totals and largest files. Those aggregates remain shim-only at `suite/drive/http/shims.py:1155-1199`.
- Section 11.7 says all 69 names become thin forwarders at `wayfinder/drive-layer-spec/drive-layer-spec.md:3084-3089`. The code has 37 forwarders, 21 permanent names, 8 retained bodies, and 3 retired names at `suite/drive/http/shims.py:69-155`.

## Socket events

Drive provides one socket to the layout at `frontend/src/apps/drive/pages/DriveLayout.vue:54-61`.

| Event | Frontend subscription | Backend emitter | REST or new-world equivalent |
|---|---|---|---|
| `list-add` | `frontend/src/apps/drive/components/GenericPage.vue:683-691` | Legacy upload emits to the uploader at `suite/drive/http/shims.py:1505` and `suite/drive/http/shims.py:1622-1624`. | Upload finish returns the new node at `suite/drive/http/routes.py:480-501`. The REST handler emits no event. |
| `list-update` | `frontend/src/apps/drive/components/GenericPage.vue:692-698` | none found in the repository | `PATCH /nodes/<id>` returns the updated node at `suite/drive/http/routes.py:193-227`. The handler emits no event. |
| `list-remove` | `frontend/src/apps/drive/components/GenericPage.vue:699-704` | none found in the repository | `PATCH /nodes/<id>` handles trash or restore at `suite/drive/http/routes.py:193-227`. `DELETE /nodes/<id>` handles purge at `suite/drive/http/routes.py:230-235`. Neither emits an event. |
| `client-rename` | `frontend/src/apps/drive/components/GenericPage.vue:705-708` | none found in the repository | `PATCH /nodes/<id>` with `{title}` returns the updated node at `suite/drive/http/routes.py:193-227`. The handler emits no event. |
| `drive-download-status` | `frontend/src/apps/drive/utils/download.js:50-82` | `suite/drive/api/files.py:304-307`, called for ready or failed builds at `suite/drive/api/files.py:310-333` | none. Folder archive build, progress, and stream routes do not exist (`suite/drive/http/shims.py:160-163`). |

The four list subscriptions have no unmount cleanup in `frontend/src/apps/drive/components/GenericPage.vue:682-708`. The download subscription removes itself at `frontend/src/apps/drive/utils/download.js:56-61`.

## Methods with no exact REST replacement

There are 31 distinct frontend names with no exact REST replacement.

- Seventeen product methods remain on `/api/method/`: `accept_invite`, `disk_settings`, `get_my_invites`, `get_pending_invites`, `get_settings`, `get_translations`, `get_user_groups`, `get_users`, `invite_users`, `is_site_admin`, `reject_invite`, `send_otp`, `set_settings`, `set_webdav_enabled`, `signup`, `verify_otp`, and `webdav_config`. Section 11.7 says they are outside the Drive route namespace at `wayfinder/drive-layer-spec/drive-layer-spec.md:3149-3155`.
- Three archive methods have no build, status, or download routes: `download_folder`, `download_status`, and `download_archive` (`suite/drive/http/shims.py:160-163`; spec claim checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3110-3112`).
- Three methods are retired: `create_auth_token`, `get_new_title`, and `sync_from_disk` (`suite/drive/http/shims.py:80,93,125`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3113-3115,3142-3144`).
- `get_root_folder`, `translate_old_name`, and `resolve_legacy_route` are forwarders with no public REST route (`suite/drive/http/shims.py:2326-2364,2455-2469`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3117-3120`).
- `get_attachments` is retained because framework attachments are not node media (`suite/drive/http/shims.py:164-169`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3122-3124`).
- `get_unread_count` is a shim-only scalar (`suite/drive/http/shims.py:1084-1094`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3135-3137`).
- `sync_preview` is retained because disk discovery is not preview upload (`suite/drive/http/shims.py:170-174`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3142-3144`).
- `storage_breakdown` has no route for its two aggregates (`suite/drive/http/shims.py:1155-1199`; spec checked at `wayfinder/drive-layer-spec/drive-layer-spec.md:3139-3140`).
- `suite.drive.api.files.share` is not a defined API method or shim. The caller is `frontend/src/apps/drive/resources/permissions.js:12`. The existing method is `update_access` at `suite/drive/api/files.py:486-495`.

## Not done

- The generated `sdk-o7hlQ1xj.js` bundle was not verified. It is absent from this worktree.
- Runtime network traffic was not captured in a browser. This is a source inventory.
- Backend emitters for `list-update`, `list-remove`, and `client-rename` were not found. Their absence was not verified against deployed custom apps.
