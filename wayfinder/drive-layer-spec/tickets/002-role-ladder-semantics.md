---
id: 002
title: Role ladder semantics
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: []
---

## Question

Freeze the role ladder. Proposed: NONE=0 (stored deny, nearest-wins),
READ=10, COMMENT=20, UPLOAD=30, EDIT=40, MANAGE=50. Decide: what each
level means per node kind (what does UPLOAD mean on a file? COMMENT on a
folder?), the framework ptype mapping (read/write/share/create/delete to
levels), the grant ceiling rule, and which levels a link principal may
hold. Today's five-flag rows (read/comment/share/upload/write + deny) must
map onto the ladder for migration.

Context from [Shared spaces and offboarding model](001-shared-spaces-and-offboarding-model.md):
owner no longer grants access, so the ladder is the only mechanism. Two extra
things to settle here:

- Does the `Suite Admin` ALL_ACCESS bypass (`suite/drive/api/permissions.py:31`)
  survive, or become an explicit role principal?
- Is `upload` without `read` valid? Under the dropped owner short-circuit, a
  user in that state cannot see their own upload.

## Resolution

Decided with Faris, 2026-09-02. Nine decisions.

### The ladder

Strict: `NONE=0` (stored deny), `READ=10`, `COMMENT=20`, `UPLOAD=30`,
`EDIT=40`, `MANAGE=50`. A higher role contains every lower one. No
skip-level holes, so `upload` without `read` is unrepresentable. That
closes the second sub-question: the state does not exist in the new model.
Gaps of 10 leave room for later named levels (GitHub inserted `triage` and
`maintain` the same way).

### Verbs per level and node kind

Each level includes everything below it.

| Level | Folder | File | Doc (app-owned) |
|---|---|---|---|
| READ | list children, search, ZIP download | download, preview | open read-only, export |
| COMMENT | nothing direct; inheritable only | comment | comment |
| UPLOAD | create children | nothing direct | nothing direct |
| EDIT | rename, move, trash, restore own trashing | + edit content, new version | + edit in its app |
| MANAGE | grant/deny/revoke, revoke-below, restore anyone's trash, permanent delete | same | same |

- Move also needs UPLOAD at the destination folder.
- EDIT holds move and trash. It already holds the destructive right
  (overwrite content), so a higher fence buys nothing.
- MANAGE alone deletes permanently. Retention empties trash regardless.

### Creator grant (the upload-then-edit problem)

UPLOAD is add-only. When a user whose effective level is below EDIT
creates a node, the engine writes one EDIT grant for them on that node.
Rights stay grant-rows-only; "owner grants nothing" survives. No row is
written when the creator already holds EDIT, so personal roots and
EDIT-level members cost nothing. Rejected: GDrive-style UPLOAD-includes-
content-edit (the name lies), and strict drop-in (hostile UX).
Consequence for the spec: revoke must offer "delete this principal's
grants below this path", or eviction half-works against nearest-wins.

### Framework ptype mapping

`read`/`select` -> READ. `create` -> UPLOAD, answered against the
destination folder. `write` -> EDIT (trash/restore are state writes).
`delete` -> MANAGE (permanent). `share` -> MANAGE. Unknown ptypes -> EDIT,
parity with today's fallback.

### Grant ceiling

- Granting, denying, and revoking require MANAGE at the node.
- A MANAGE holder may set any role up to MANAGE. The per-flag ceiling
  (`exceeds_grant_ceiling`) has nothing left to police and is dropped.
- Self-removal is allowed, including self-lockout.
- Guardrail: inside a Personal Root, a deny naming the root's own user is
  invalid. It would otherwise beat the root grant by nearest-wins and lock
  the user out of their own space. Denies on `$GENERAL` in the Shared Root
  stay legal; that is the members-only-folder feature.

### Anchor grants

Personal Root: its user holds MANAGE. Fresh Shared Root: `$GENERAL` holds
UPLOAD (open contribution, protected content; one row to change per
site). Today's row is `$GENERAL read` only
(`suite/drive/utils/__init__.py:186`); migrated sites keep what their row
maps to.

### Link principals

A link may hold READ, COMMENT, UPLOAD, or EDIT. Never MANAGE: an
anonymous bearer that mints grants breaks the ceiling and the guardrail.
UPLOAD links keep the file-request feature one UI toggle away. Whether
the creator grant fires for a link's uploads is handed to
[Link sharing semantics](008-link-sharing-semantics.md).

### Suite Admin bypass

Survives as code: a Suite Admin's effective role is MANAGE on every node,
resolved before grants, so no deny can touch it. `explain()` must report
"site admin". Rejected: `$ROLE:Suite Admin` grant rows (a row per root
that must always exist and never be denied rebuilds the bypass out of
data, with outages for missed rows). Spec must state the privacy
consequence: admins reach personal roots, as today.

### Migration mapping (five flags -> ladder)

Per `Drive Permission` row. Grants round down, denies round up.

| Row | Becomes |
|---|---|
| `deny = 1`, any flags | NONE (total deny) |
| `share` and `write` | MANAGE |
| `write` | EDIT |
| `upload` | UPLOAD (gains read; forced by the strict ladder) |
| `comment` | COMMENT |
| `read` only | READ |
| `share` without `write` | share ignored; highest content flag wins |
| no flags | dropped |

Partial per-flag decisions (a row deciding only the flags it sets,
`webdav/perms.py:64`) cannot survive; the table collapses them. The
shipped make-private flow writes deny rows meaning full deny
(`suite/drive/overrides/file.py:246`), so total deny matches intent.
Executing this rewrite is [Migration mapping](011-migration-mapping.md).

### Handed off

- Creator grant on link uploads -> Link sharing semantics (008).
- Revoke-below operation and the admin-privacy statement -> the spec
  (Draft the spec, 013).
- Glossary updated: **Role** term, verb line, creator-grant rule
  (`suite/drive/CONTEXT.md`).
