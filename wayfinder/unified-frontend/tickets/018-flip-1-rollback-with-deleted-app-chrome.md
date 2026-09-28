---
id: 018
title: Flip 1 rollback with deleted app chrome
label: wayfinder:grilling
status: open
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014 makes each flip one `frappe.conf` key, so turning the key off
rolls the flip back without a deploy. Tickets 010 and 016 delete Mail's and
Calendar's app switcher, Settings dialog, Theme and Log out at flip 1, and
ticket 010 says "one revert undoes it". With `suite_flip_shell` off after
that deletion, Mail and Calendar run outside the shell with no Settings and
no Log out.

Decide what "flag off" shows after flip 1 ships:

- The old chrome stays in code and renders only while the key is off, until
  the deletion commit.
- Rollback is a revert and a deploy for the chrome, and the key only moves
  the rail and `/`.
- Another shape.

The answer sets Stage 5's deletions and the Stage 7 rollback rehearsal in
the plan.

Raised by the plan audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

Also decide what the rail shows on `/home`, `/files` and `/d/` while
`suite_flip_files` is off. Those routes answer a direct URL for every
signed-in user before flip 2 (spec §14.1); ticket 014 fixes the rail only
for flip 2 on. Spec open item 24.
