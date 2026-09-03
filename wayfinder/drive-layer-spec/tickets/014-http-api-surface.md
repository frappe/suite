---
id: 014
title: HTTP API surface
label: wayfinder:grilling
status: open
assignee:
blocked-by: [007, 008]
---

## Question

Define the HTTP API of the Drive layer: endpoint list, request and response
shapes, error codes, and paging. Inputs: the ten-entry-point shape from the
design doc (`drive-file-layer-designs.md`, design C), the role ladder, the
Drive Root model (archived-roots view), and the content app contract
(create/copy/touch/version/comment calls, satellite hooks). Blocked by
Publishing capability and Link sharing semantics because publish and link
endpoints are part of the surface.

Graduated from Not yet specified on 2026-09-03 after
[Content app contract](005-content-app-contract.md) closed.

Handed from [Publishing capability](007-publishing-capability.md)
(2026-09-03): publish and unpublish are the grant and revoke endpoints
with principal `$PUBLIC`; do not add separate verbs. The grant endpoint
must refuse `$PUBLIC` above READ and `$PUBLIC` on a Drive Root. The
activity endpoint returns grant writes with actor, principal, old role,
new role. Guest calls carry `$PUBLIC` as their only principal until link
sessions (008) add more.

Handed from [Link sharing semantics](008-link-sharing-semantics.md)
(2026-09-03): a link is created through the grant endpoint with principal
`$LINK` (server mints the token) plus optional `password` and
`expires_on`; the response returns the URL `/drive/l/<token>`. Add
`rotate(grant)` (new token, same settings, one activity row) and
`unlock(token, password)` returning the ticket. Every endpoint reads
`X-Drive-Links` to extend the principal list. A node reached through a
password link without a ticket returns a distinct "locked" response, not a
403. The grant endpoint refuses `$LINK` on a Drive Root, `password` on
non-link principals, and any link role above EDIT. Activity rows expose
`via_link`. `/drive/l/<token>` resolves the grant and redirects to the
node route with the token seeded.

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): create
and replace accept an optional client modification time that sets
`content_modified` (today `api/files.py:53`, epoch ms). The activity row
gains a `client` column (User-Agent, DAV only). A copy endpoint exists and
is the one COPY primitive: new nodes owned by the caller, charged to the
destination root, no grants or versions copied, documents through the
declared duplicate.

Handed from [Quota policy](010-quota-policy.md) (2026-09-03): a usage
endpoint per root returning `used_bytes`, reserved bytes, and the
effective quota (the storage bar reads the caller's Personal Root; a
Suite Admin may name any root). A Suite Admin endpoint sets
`Drive Root.quota_bytes`. A Suite Admin endpoint purges an Archived Root.
The create-upload endpoint takes the declared size and returns a distinct
over-quota error, not a permission error; node create, replace, and move
return the same error when the admission UPDATE affects zero rows. The
reservation functions stay Python-only for Meet; they get no HTTP
endpoint.

Handed from [Migration mapping](011-migration-mapping.md) (2026-09-04):
favourites, recents, activity, and notification endpoints read the
reshaped tables: `Drive Favourite` (user, node), `Drive Recent` (user,
node, opened_at), `Drive Activity` (node, action, actor, at, via_link,
client, detail), and `Drive Notification` as a pointer (activity, to_user,
read) whose message renders from the activity row. Mark-read and
clear-recents act on those rows only; clearing recents never touches
favourites.
