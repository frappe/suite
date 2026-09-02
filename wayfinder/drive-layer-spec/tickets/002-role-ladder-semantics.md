---
id: 002
title: Role ladder semantics
label: wayfinder:grilling
status: open
assignee:
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
