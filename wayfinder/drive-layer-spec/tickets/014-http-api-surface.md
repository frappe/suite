---
id: 014
title: HTTP API surface
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [007, 008]
---

## Question

Define the HTTP API of the Drive layer: endpoint list, request and response
shapes, error codes, and paging. Inputs: the ten-entry-point shape from the
[file-layer decision record](../references/drive-file-layer-designs.md)
(design C), the role ladder, the
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

Handed from [Slides media to nodes](012-slides-media-to-nodes.md)
(2026-09-04): a call returns a content document's media — the node ids under
it paired with short-TTL signed `/f/` URLs — after one Read check on the
document, and the page calls it again on a timer to refresh expired links.
Template calls are generic, not per app: list nodes I can read where
`is_template` is set, filtered by content type; "new from template" is the
copy endpoint plus the app's declared duplicate; no template verbs. Ordinary
listings exclude `is_template` nodes, and no listing returns the children of
a content document node. The composite response marks a reference the caller
cannot read instead of dropping it silently. Slide media uploads use the
same create-upload call and so return the same over-quota error.

## Resolution

Resolved 2026-09-04. Repository-local explainer:
[`explainer/http-api.html`](../explainer/http-api.html).

**1. Real routes, not RPC.** The surface is
`/api/suite/drive/...`, not `/api/method/suite.drive.api....`. The
namespace carries an app segment (`drive`), because eight suite apps share
one site and two of them want the noun `attachments`. One segment gives
collision-free nouns, a readable owner in a log line, and one hardening
allowlist prefix per app instead of one per route.

**2. Mounted by a translator, not a dispatcher.** `API_URL_MAP` is built at
import time (`frappe/api/__init__.py:95`), so an app cannot add a rule. A
`before_request` hook matches the pretty path, seeds `frappe.form_dict`
from the path segments, rewrites `PATH_INFO` to `/api/v2/method/...`, and
lets the framework do auth, CSRF, rate limiting and response building. This
is the same catch point `/dav` uses (`suite/hooks.py:336`), but it delegates
instead of handling. Cost: one module. A full dispatcher was rejected
because `validate_auth()` runs after `before_request` (`app.py:118` vs
`:226`), so Drive would have to re-implement API-key auth, CSRF, rate
limits and the response envelope.

The translator must also clear the cached `request.path`. `frappe.api.handle`
routes from `request.environ`, but `get_api_version()` reads `request.path`,
which `init_request` already touched at `app.py:218`. Rewriting environ alone
changes the route and not the response version.

**3. Node changes: PATCH for what can be undone, DELETE for what cannot.**

    PATCH  /api/suite/drive/nodes/<id>   { title } | { parent }
                                         | { state: "trashed" | "active" }
    DELETE /api/suite/drive/nodes/<id>   purge, terminal

One PATCH keeps the
[file-layer decision record](../references/drive-file-layer-designs.md)'s
promise that `update()` gives WebDAV
MOVE and the UI one tested path: a MOVE is a rename, a move, or both, and it
does not know which. Purge is the one irreversible act, so it gets the one
HTTP verb that means it instead of hiding as `state: "purged"` beside
`state: "active"`.

**4. Drive checks permission. The HTTP layer translates.** A route handler
parses the path, seeds principals from `X-Drive-Links`, calls a private Drive
workflow and maps the exception. It never calls `require()` itself. Three callers reach the same
nodes — routes, `/dav`, and other suite apps through the content contract —
and all three get one rule because none of them owns it.

**5. Errors and successes both speak the v2 envelope.** Success is
`{ "data": ... }` (`frappe/api/__init__.py:66`); failure is
`{ "errors": [ { "type", "message" } ] }` (`frappe/utils/response.py:57-61`).
The exception class name is the code, and `http_status_code` on the class
gives the status. What `permissions.py:124` does today as a hack becomes the
rule.

No upstream ask. `frappe-ui`'s `useCall` already parses the v2 `errors[]`
array (`data-fetching/useFrappeFetch.ts:90-105`), takes an arbitrary `url`
(`useCall.ts:54`) and four verbs (`useCall/types.ts:11`), and unwraps
`data.data`. `useList` and `useDoc` do **not** fit: both build
`/api/v2/document/<doctype>` URLs (`useList.ts:65`, `useDoc.ts:63`), which is
the generic document API and bypasses the grant engine. The frontend moves
from `createResource` to `useCall`; that work belongs to the UI effort.

The class list, satisfying decisions 008 and 010:

| Condition | Class | Status |
|---|---|---|
| Node missing, or hidden from you | `DriveNotFound` | 404 |
| Role below what the act needs | `DriveForbidden` | 403 |
| Password link, no ticket | `DriveLocked` | 401 |
| Link past `expires_on` | `DriveLinkExpired` | 410 |
| Admission UPDATE hit zero rows | `DriveOverQuota` | 413 |
| Title taken, or node moved under itself | `DriveConflict` | 409 |

**6. Paging is an opaque cursor.** `{ "data": { "rows", "next_cursor" } }`,
where the client only echoes the cursor back. It holds an offset today and can
hold a keyset later with no call site changed. Offsets were rejected because
permission filtering happens after the SQL window, so a page of 50 can return
12 and `next_start` is not `start + limit` (`list.py:477-495`). Pushing the
grant join into the list query was rejected because it re-opens the index
frozen by [Index benchmark parent-state-title](004-index-benchmark-parent-state-title.md).

**7. One node shape, with opt-in expansions.** A list row and a detail fetch
carry identical base fields, so the client has one type. `?expand=` names the
extras — `access`, `breadcrumbs`, `preview` — and each costs its queries only
when asked for. This replaces today's two shapes: the fat
`get_entity_with_permissions` payload and the thin list row, which drifted.

**8. Batch writes report per item.**

    POST /api/suite/drive/nodes/batch
    { "nodes": [ ...ids... ], "patch": { "parent": "folder-9" } }

    { "data": { "ok": [ ...ids... ],
                "failed": [ { "node": "c", "type": "DriveForbidden" } ] } }

Partial success is a result, not an error. All-or-nothing punishes 27 files
for 3, and looping PATCH turns one gesture into 30 requests and 30 activity
rows.

**9. The 69 old methods are shimmed, then dropped.** Build adds the routes and
keeps every old name as a thin forwarder into the new Drive implementation. Cleanup deletes the
forwarders one release later, gated on the SPA having moved. This is the
two-patch shape [Migration mapping](011-migration-mapping.md) already chose for
the data, so the API and the tables move on one schedule, and the SPA rewrite
need not land in the same release as the backend.

Three names are permanent whatever else happens: `suite.drive.api.s3.fetch`
sits inside stored `File.file_url` values, `overrides.file.get_file_for_doc`
sits inside a checked-in built bundle
(`suite/public/frontend/assets/sdk-o7hlQ1xj.js`), and `/dav` sits inside
third-party file managers.

**10. Hardening: the Drive-shaped part only.** This spec adds
`/api/suite/drive/` to `ALLOWED_WILDCARD_PATHS` and removes
`/api/method/suite.drive.api.` in Cleanup (`suite/hooks.py:429-447`).
Site-wide enforcement is ruled out of scope — see the map. Note for whoever
picks it up: `DENIED_WILDCARD_PATHS = ["/api/"]` is already declared at
`suite/hooks.py:450`, and nothing in suite or frappe reads it, so the gate
lives outside this repo (Frappe Cloud). On a self-hosted bench nothing is
denied today.

### Handoff to [Draft the spec](013-draft-the-spec.md)

The HTTP API section is the ten decisions above. It states the route table,
the translator (including the cached-path clearing), the exception class list
with status codes, the cursor contract, the node shape with its three
expansions, the batch result shape, and the shim-then-drop plan for the 69
methods. The migration section gains the forwarder list and its Cleanup gate.
The frontend note — `useCall`, not `createResource`, and not `useList` or
`useDoc` — is a handoff to the UI effort, not part of this spec.
