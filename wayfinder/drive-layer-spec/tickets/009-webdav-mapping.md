---
id: 009
title: WebDAV mapping
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [002]
---

## Question

Map WebDAV onto the new engine: PROPFIND to the folder-page queries, GET
to node-authorized signed URLs or streams, PUT to upload sessions, MOVE to
the single path-rewrite UPDATE, locks stay in Drive DAV Lock/Property.
Decide the role required per DAV method and the behavior for doc-backed
nodes (export? 404? empty?). The engine prototype came from
`suite/drive/webdav/perms.py`; the spec should absorb it, not special-case
it. Blocked by Role ladder semantics.

## Resolution

Decided with Faris, 2026-09-03. Twelve decisions. An agent surveyed the
shipped server first (`suite/drive/webdav/*`, the two DAV doctypes,
`hooks.py:336`, `tests/litmus_expected.txt`).

### 1. Three mounts

`PROPFIND /dav/` lists `Home` (the user's Personal Root), `Everyone` (the
Shared Root, business sites only), and `Shared with me`. The third is a
read-only virtual collection whose children are the user's grant roots:
the nearest nodes that carry a grant naming one of the user's principals,
outside the Shared Root. It includes grant roots inside Archived Roots.
MKCOL, PUT, MOVE, and COPY with that collection as the parent are 403.
Rename inside it is 403. Archived Roots have no mount of their own.

Name collision among grant roots: the plain title when unique, else
`<title> (<root owner email>)`. Path lookup tries the plain name, then the
suffixed form.

Rejected: Home and Everyone only (content shared from another Personal Root
stays unreachable over DAV); one flat mount (the Shared Root would look
like a child of a Personal Root).

### 2. Role per method

| Method | Role | Where |
|---|---|---|
| OPTIONS | none | pre-auth |
| PROPFIND | READ on target; children shown when role >= READ | |
| GET, HEAD | READ | |
| PUT create | UPLOAD | parent |
| PUT replace | EDIT | node |
| MKCOL | UPLOAD | parent |
| DELETE | EDIT | node (trash) |
| MOVE | EDIT on source, UPLOAD on destination parent, EDIT on an overwritten target | |
| COPY | READ on source, UPLOAD on destination parent; unreadable children skipped | |
| LOCK, existing | EDIT | node |
| LOCK, unmapped | UPLOAD | parent |
| UNLOCK | lock owner, or Suite Admin | |
| PROPPATCH | EDIT | node |

Unreadable is always 404, never 403. DELETE tightens from today's
read-only check (`structure.py:76`). The Suite Admin bypass applies to
what an admin reaches by path; there is no admin mount of other users'
roots. Rejected: EDIT for COPY (READ already includes download and ZIP);
EDIT for LOCK-create (an UPLOAD contributor could not save a new Office
file, because Office locks before it PUTs); a `Users` mount for admins.

### 3. Content Documents appear as read-only export files

A document node lists as `<title>.<ext>` in its app's declared default
export format. GET streams the export; `getcontentlength` is omitted.
PUT, LOCK, and a content PROPPATCH on it are 403. MOVE, rename, DELETE,
and COPY work as node operations; COPY calls the declared duplicate. A
rename must keep the extension (else 403) and sets the title to the stem.
An app that declares no export stays invisible, as every document is
today (`pathmap.py:34`). A document node is a leaf in DAV: its child
nodes (Writer embeds, Slides media) never appear.

Collision with a real file of the same name: the document keeps the
name, the file shows as `<stem> (2).<ext>`, oldest first. Lookup tries a
document match, then a file match. A MOVE overwrite onto a document
trashes the document.

Rejected: invisible (no move or trash from Finder); zero-byte placeholder
(sync clients copy empty files to the desktop).

### 4. GET streams; a site key redirects

GET authorizes by node, then streams through the framework's public
stream-read with `send_file(conditional=True)` for Range and 304.
`drive_webdav_s3_redirect` survives as the opt-in 302 to a signed native
URL for clients that follow cross-host redirects. Framework ask: Range on
non-local drivers.

Rejected: always 302 to a signed `/f/` URL (breaks the Windows
WebClient).

### 5. PUT is one `put_blob`; every replace versions

PUT spools the body into `put_blob`. Quota is preflighted from
Content-Length, or enforced while spooling when the length is absent. No
upload session; sessions are the browser's chunked path. A replace keeps
the old head as an auto Version with no DAV exception; the retention
ladder thins them. One rule for every replace path: a head of size 0 is
not kept as a Version.

Deleted with this: the disk and S3 staging, generation keys, compensation,
and drift repair in `put.py:340-800`. `put_blob` is atomic.

### 6. LOCK on an unmapped URL creates an empty Active node

UPLOAD on the parent; the creator grant fires as for any create. The node
holds the empty blob. If the lock expires with no PUT, the empty node
stays. Rejected: a Pending state visible only to the lock owner (a fourth
lifecycle state and a per-owner rule in every listing query).

### 7. Cross-root MOVE is allowed

Same rule as the UI move. The subtree UPDATE rewrites `path` and `root`.
Quota moves from the source root to the destination root, and the move is
refused when the destination root would exceed its quota. Own grants on
the moved nodes travel. The creator grant fires when the mover lands below
EDIT. Rejected: 403 (clients fall back to COPY then DELETE, which doubles
bytes and loses grants and versions).

### 8. COPY is the Drive copy primitive

New nodes are owned by the requester and charged to the destination root.
Blobs are shared, not moved. Versions, comments, and grant rows are not
copied. The creator grant fires when the requester is below EDIT at the
destination. Dead properties are cloned, as today. Rejected: copying
grants (pasting a folder into Home would hand its old sharees access to
your space); copying versions.

### 9. `content_modified` on Drive Node

Today's `File.file_modified` custom field, renamed. Set by create,
replace, `touch`, a client mtime on upload (`api/files.py:53`), or a DAV
mtime header (`X-OC-Mtime`, `Win32LastModifiedTime`). Read by the listing
sort (`api/list.py:454`), recents, `getlastmodified`, and the ETag input
for documents. `modified` stays the framework row time. Rejected: dropping
it (listing sort would flip on every grant or rename write).

ETag stays strong: the blob checksum for files; `content_modified` plus
the latest version seq for documents.

### 10. Same SDK calls, same activity rows

DAV handlers call the Drive node SDK and get the rows the UI gets. The
actor is the session user. A `client` column on the activity row records
the User-Agent for DAV requests. No DAV-specific activity types. Today
only a replace writes a row (`put.py:243`).

### 11. Auth stays Basic; no link principals

HTTP Basic with a site password or an API key and secret, per-user opt-in,
Guest refused. A DAV session's principals are the signed-in user's: email,
groups, `$GENERAL`, `$PUBLIC`. No `$LINK:<token>` is ever added, so Link
sharing (008) has no DAV surface. Rejected: link token as a Basic password
(an anonymous bearer with a lockable, PUT-able endpoint).

### 12. The spec absorbs the protocol modules and drops the storage code

Kept, relinked to Drive Node: dispatch, auth, context, pathmap (title
lookup on the frozen `(parent, state, title)` index), propfind, proppatch,
deadprops, locks, lock, ifheader, conditional, xmlutil, options, settings,
log. `Drive DAV Lock` and `Drive DAV Property` keep their shape with
`entity` retargeted. Deleted: `perms.py` (the engine's folder-page query
is that batch now), the storage machinery in `put.py`, and every direct
`manager.*` call in `get`, `copy`, `structure`, `lock`. Depth 1 PROPFIND
costs the engine's three folder-page queries plus one dead-property and
one lock fetch. `quota-used-bytes` and `quota-available-bytes` read the
collection's Drive Root. The method allow-list, per-user opt-in, and log
settings survive. Litmus stays the acceptance test.

### Handed off

- Cross-root move rebill; whether the DAV quota properties count versions
  and previews -> Quota policy (010).
- `file_modified` -> `content_modified`; DAV doctype `entity` retarget;
  `.thumbnails` reserved name dropped -> Migration mapping (011).
- Client mtime parameter on create and replace; `client` column on the
  activity row; the copy endpoint -> HTTP API surface (014).
- The method-role table, the export naming and collision rules, the
  Shared-with-me query, the empty-head version rule, the Range framework
  ask -> Draft the spec (013).
- Glossary updated: **Grant Root**, **Content Time**, DAV relationship
  lines, the mount-name ambiguity (`suite/drive/CONTEXT.md`).

Handed from [Link sharing semantics](008-link-sharing-semantics.md)
(2026-09-03): no link auth over WebDAV. Clients present user credentials
only; a `$LINK:<token>` principal never enters a WebDAV request's
principal list. The two-pass resolution (own principals first, deny final,
else max with `$PUBLIC` and links) still applies, with an empty link set.
