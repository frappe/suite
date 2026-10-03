---
id: 005
title: Legacy Drive client inventory
label: wayfinder:research
status: closed
assignee: codex (agent, 2026-09-11)
blocked-by: []
---

## Question

Inventory every call the frontend makes into legacy Drive methods and map
each to the new REST route table, so the Files area, the content pages, and
the switch gate know what must move.

Cover:

- Every `suite.drive.api.*` method referenced under `frontend/src` (60
  distinct names on 2026-09-11), with the file, the caller (Drive, Writer,
  Sheets, Slides, Meet, Mail, shell), and the frappe-ui primitive used
  (`createResource`, `createListResource`, `useCall`, raw fetch, socket).
- For each method: the replacement route in Drive spec §11.2 and the shim
  status in §11.7, or "no replacement" with the reason.
- Calls that bypass the Drive interface: Writer and Slides endpoints called
  directly from `apps/drive`, and Drive internals imported by Writer and
  Slides (ARCHITECTURE.md rule 8 debt, `frontend/scripts/check-import-boundaries.mjs`).
- The three permanent names (`api.s3.fetch` in stored URLs,
  `get_file_for_doc` in a built bundle, `/dav`) and where the SPA touches
  them.
- Socket events the Drive UI listens to and their new-world equivalents.

Output: `wayfinder/unified-frontend/references/legacy-drive-client-inventory.md`
with one table per caller app and a short list of methods with no REST
replacement.

## Resolution

Resolved 2026-09-11 by a codex agent. Findings:
[`../references/legacy-drive-client-inventory.md`](../references/legacy-drive-client-inventory.md)
(branch `forge/research-legacy-drive-client`, commit `1e3e2c5bc`). The
orchestrator spot-checked the route count, the shim classes and three rows
against `suite/drive/http/translator.py` and `shims.py`.

- 60 distinct legacy names, all in Drive UI code. Writer repeats six, Sheets
  and Slides one each (`track_visit`). Meet, Mail, shell and boot call none.
- 29 names have an exact REST replacement in the 42-route table. 31 do not:
  17 product methods stay on `/api/method/` by design (invites, settings,
  signup, OTP, users, translations, WebDAV config); 3 folder-archive calls
  have no route; 3 are retired (`create_auth_token`, `get_new_title`,
  `sync_from_disk`); `get_root_folder`, `translate_old_name` and
  `resolve_legacy_route` are forwarders with no route; `get_attachments`,
  `sync_preview` are retained; `get_unread_count` and `storage_breakdown`
  have shim-only aggregates; `files.share` calls a method that does not
  exist.
- Backend asks this surfaces for the Drive program: a root-discovery route
  (the client cannot learn its Personal or Shared root id), a notification
  unread count, folder archive download, and storage breakdown aggregates.
- The Drive UI bypasses the generic creation rule: it calls Writer, Sheets
  and Slides endpoints directly (`resources/files.js:85-104,291-301`).
  Writer imports Drive subpaths in nine files; Slides in one.
- Socket: four list events are subscribed in `GenericPage.vue`; only
  `list-add` has an emitter, from the legacy upload shim. REST handlers emit
  nothing.
- Spec §11.7 and the code differ on nine names. The reference lists each.

Handed to [Files area](006-files-area-listing-and-navigation.md), [Upload,
restore and batch outcomes](007-upload-restore-and-batch-outcomes.md) and
[Home, palette and notifications](012-home-palette-and-notifications-at-launch.md).
