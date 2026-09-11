---
id: 005
title: Legacy Drive client inventory
label: wayfinder:research
status: open
assignee:
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
