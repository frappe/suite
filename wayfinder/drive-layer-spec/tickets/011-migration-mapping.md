---
id: 011
title: Migration mapping
label: wayfinder:grilling
status: open
assignee:
blocked-by: [001, 002]
---

## Question

Define the migration from current suite data to the new model: File rows
with suite custom fields (team-less, content_doctype/content_docname,
status, file_modified) to Drive Node with path; Drive Permission five-flag
rows (including deny and the "" / $GENERAL / $GROUP principals) to Drive
Grant roles; blobs backfilled through storage_v2; satellite doctypes
(Favourite, Entity Log, Notification) to their replacements; and the
custom-field cleanup on File. Include ordering, idempotency, and a
rollback story. Blocked by Shared spaces and offboarding model and Role
ladder semantics.

Context from [Shared spaces and offboarding model](001-shared-spaces-and-offboarding-model.md):
the target shape is `Drive Root` (`kind` Personal|Shared, `state`
Active|Archived). `Users/<email>` folders become Personal roots, `Drive`
becomes the one Shared root, and `Drive/Previous Teams` stays an ordinary
folder under it with its group grants intact.
