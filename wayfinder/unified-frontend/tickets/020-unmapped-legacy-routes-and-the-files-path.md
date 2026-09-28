---
id: 020
title: Unmapped legacy routes and the /files path
label: wayfinder:grilling
status: open
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014's redirect table misses legacy routes, and some rows resolve
wrongly.

- No row: `/drive/inbox`, `/drive/attachments/:doctype?/:docname?`,
  `/drive/documents`, `/drive/presentations`, `/writer`, `/sheets`,
  `/slides`, `/slides/not-permitted`.
- Wrong match: `/sheets/new` and `/sheets/trash` match
  `/sheets/<docname>`; `/slides/presentation/new` and
  `/slides/presentation/view/<id>` match `/slides/presentation/<docname>`.
- Old routes accept a trailing `/:slug?`; the table does not show it.
- No source says what a lookup row answers when it finds no node.

Also decide the `/files` clash: Frappe serves public uploads under
`/files/`. `IMPLEMENTATION.md` records a workaround (commit `504d6ab10`)
"pending Faris's review".

Route list from the content audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).
