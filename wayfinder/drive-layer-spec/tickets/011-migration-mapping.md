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
