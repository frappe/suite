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

Handed from [Content app contract](005-content-app-contract.md): Sheets
`DocShare` rows become grants on the sheet's node (`read` -> Read, `write` ->
Edit, `everyone` -> any-signed-in-user principal), then the rows are deleted.
`Writer Version` and `Sheet Snapshot` rows become Drive versions. Writer
`ycomments` and Sheets in-workbook comments become Drive comments. Title and
trashed fields on content doctypes are dropped after the node holds them.

Handed from [Publishing capability](007-publishing-capability.md)
(2026-09-03): a `Drive Permission` row with `user = ""` (Guest, no token)
maps to a `$PUBLIC` READ grant. If the row carries flags above read, add
one `$LINK:<token>` grant at the mapped level beside it; the plain URL
keeps read, the new link URL keeps the rest. A `user = ""` deny row maps to
a `$PUBLIC` deny. Rows on a Drive Root (the shipped `Site` folder) are
invalid under the root guardrail: drop them and report the count. Also:
Slides' forced composite rows are ordinary `user = ""` read rows and need
no special case.

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): the
`File.file_modified` custom field becomes `Drive Node.content_modified`
(same meaning, same values). `Drive DAV Lock.entity` and
`Drive DAV Property.entity` retarget from File to Drive Node by the node
identity map. The `.thumbnails` reserved name and the `.thumbnail` sidecar
check go.
