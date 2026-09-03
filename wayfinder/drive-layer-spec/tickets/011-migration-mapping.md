---
id: 011
title: Migration mapping
label: wayfinder:grilling
status: closed
assignee: faris
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

Handed from [Link sharing semantics](008-link-sharing-semantics.md)
(2026-09-03): the `$LINK:<token>` grant minted for a `user = ""` row above
read gets a fresh 22-char base62 token, `password_hash = NULL`,
`expires_on = NULL`. One link per such row. The new URL is
`/drive/l/<token>`; report the count so owners can be told their links
changed. `Drive Token` rows (single-use download capabilities) are not
links and are dropped.

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): the
`File.file_modified` custom field becomes `Drive Node.content_modified`
(same meaning, same values). `Drive DAV Lock.entity` and
`Drive DAV Property.entity` retarget from File to Drive Node by the node
identity map. The `.thumbnails` reserved name and the `.thumbnail` sidecar
check go.

Handed from [Quota policy](010-quota-policy.md) (2026-09-03):
`Drive Disk Settings.quota` (MB) becomes `default_personal_quota` (bytes,
value x 1024^2); `shared_quota` starts at 0 (unlimited). Each
`Drive Settings.quota` > 0 becomes that user's Personal Root
`quota_bytes` (MB x 1024^2); the field is then dropped.
`Drive Storage Reservation.storage_owner` becomes `root`, the owner's
Personal Root. `Drive Root.used_bytes` is not set by the patch: the daily
recompute fills it once nodes and versions are in place, so run it as the
last migration step.

## Resolution

Decided with Faris on 2026-09-03 and 2026-09-04. Fourteen decisions and a
report.

### 1. Two patches: Build, then Cleanup

Build is additive. It creates `Drive Root`, `Drive Node`, `Drive Grant`,
versions, comments, and the side tables from the File rows, and never
writes a File row except `File.blob`. Cleanup ships one release later and
deletes the old data. Rollback of Build is: truncate the new tables, ship
the old code. After Cleanup the only rollback is a database restore.

Rejected: one patch (no rollback lever below a restore); Build only, with
cleanup by hand (custom fields and dead rows forever).

### 2. Entry gate

Build throws when `frappe.storage.enabled()` is False, so a site cannot
half-migrate. It then calls `frappe.storage.backfill.run()` itself, which
is idempotent (`frappe/storage/backfill.py:31`) and links every local
Drive file to a blob in place. A local file row still without a blob after
that (bytes missing on disk) becomes a node with no blob and is listed in
the report. When `Drive Disk Settings.enabled` (S3) is on, Build also
throws unless `storage_driver = s3` and `storage_driver_config` are set in
site_config.

Rejected: require the framework backfill as a manual step; skip rows whose
bytes are missing.

### 3. S3 objects are copied into the framework layout

Facts from Frappe Cloud (read-only, 2026-09-03): `suite.frappe.io` is the
site `frappemail.frappe.cloud`; 57 sites have the suite app, 22 active
across 16 teams, and every non-Frappe site holds under 10 MB of files.
Faris confirmed S3 mode is on for suite.frappe.io. Frappe Cloud cannot
see Drive Disk Settings, so no other S3 site is known.

The framework backfill skips the S3 fetch URLs
(`/api/method/suite.drive.api.s3.fetch?path=`), so Build has its own step:
for each such File row without a blob, stream the object once to compute
its sha256, then server-side `CopyObject` it to the framework key
(`private/<ab>/<cd>/<sha256>[.ext]`, `frappe/storage/blob.py:39`) in the
same bucket, insert one File Blob with `driver = s3`, and set `File.blob`.
Objects above 5 GB go through the boto3 managed multipart copy. Two Drive
files with the same bytes end as one object and one blob row. The step is
resumable by the `File.blob` check. Objects exist twice until Cleanup
deletes Drive's prefix.

Rejected: a suite driver that reads legacy keys in place (two driver names
in blob rows forever, a subclass to keep, no dedup across the boundary);
hashing in a background job (S3 files have no blob until it lands);
a fabricated checksum (blobs no longer identified by content).

Precondition outside the spec: Frappe Cloud controls which site_config
keys a site may set, so `storage_driver` and `storage_driver_config` may
need allowlisting there before suite.frappe.io migrates.

### 4. Ids survive

`Drive Node.name = File.name`, and a root keeps the name of the File row
it came from. New nodes keep generating 10-char hashes, so the table holds
one id shape. Bookmarks and shared URLs keep working, every side table
keeps its values (only the Link target changes), and Build needs no id
map. The design sketch's 16-char id doubled as a link secret; that moved
to `$LINK:<token>` grants, so nothing needs a new id.

Rejected: fresh ids with a map table, side-table rewrites, and a redirect
layer.

### 5. Roots

`Drive` becomes the one Shared Root, state Active, on every migrated site.
No site flag says business or personal; every site has that tree today,
and an admin can archive and purge it later. Each `Users/<email>` folder
becomes a Personal Root with `user = <email>`: Active when the User is
enabled, Archived when the User is disabled or the row is gone (the email
is stored regardless). Children of a root folder become top-level nodes of
that root. The `Users` row is dropped. A user with no folder gets a
Personal Root lazily on first use, as today.

Rejected: no Shared Root when the `Drive` tree is empty; fresh root ids.

### 6. Scope and columns

Only rows reachable by walking `folder` up to `Drive` or a `Users/<email>`
folder become nodes. Framework attachments under `Home` stay File rows.
Drive rows with a broken chain are skipped and reported.

| Drive Node | From |
|---|---|
| `title` | `file_name` |
| `parent` | `folder`, NULL directly under a root |
| `root` | the root reached |
| `path` | ids of the ancestors below the root |
| `kind` | folder if `is_folder`; link if `file_type = Link` (with `url = file_url`); document if `content_doctype` is Writer Document, Presentation, or Sheet (with the content ref); else file |
| `blob` | `File.blob`, file nodes only |
| `size` | `file_size` for files, 0 for folders |
| `mime` | `mime_type` |
| `content_modified` | `file_modified` |
| `owner`, `creation`, `modified` | copied |

A row with `content_doctype = File` (an adopted library attachment,
`overrides/file.py:624`) becomes a plain file node from its own blob; the
content link is dropped.

### 7. Trash

A row with status Trashed becomes a Trashed node with `trash_root` =
itself and `trashed_at = file_modified` (the toggle stamps it,
`api/files.py:718`). Every Active descendant of a Trashed row also becomes
Trashed, with `trash_root` and `trashed_at` copied from the nearest
Trashed ancestor, so the subtree is consistent and the sweep needs no
recursion. Rows with status Removed, and everything below them, are not
migrated and are counted.

Rejected: descendants stay Active (the engine must then treat a Trashed
ancestor as hiding its subtree); Removed rows as Trashed (their bytes are
gone).

### 8. Titles

Active siblings with one title are deduped: the oldest keeps it, later
ones get ` (2)`, ` (3)`, the `get_new_file_name` rule
(`utils/__init__.py:644`). Every rename is reported. Trashed siblings are
left alone; restore already re-dedupes.

### 9. Grants

The flag-to-role table is [Role ladder semantics](002-role-ladder-semantics.md);
the `user = ""` rules are [Publishing capability](007-publishing-capability.md)
and [Link sharing semantics](008-link-sharing-semantics.md). Principals
keep today's spelling: email, `$GROUP:<name>`, `$GENERAL`; plus `$PUBLIC`
and `$LINK:<token>`. Every grant gets `expires_on` NULL. Grants on Trashed
nodes are kept.

Dropped and counted: rows naming a User or User Group that no longer
exists; rows on an unmigrated entity; rows with no flags; rows invalid
under the root guardrails (`$PUBLIC` or `$LINK` on a root; a deny naming
a Personal Root's own user inside that root). Duplicate `(entity, user)`
rows collapse as `dedupe_drive_permissions.py` does: deny wins, else the
most permissive.

Anchors: the owner row on `Users/<email>` becomes MANAGE for that user on
the Personal Root; `$GENERAL` read on `Drive` becomes `$GENERAL` READ on
the Shared Root (migrated sites keep what their row maps to, per 002).

Rejected: keep inert grants to dead principals; force the fresh-site
`$GENERAL` UPLOAD anchor on migrated Shared Roots.

### 10. Side tables are reshaped, not retargeted

Faris asked for the right shape rather than the smallest diff.

- `Drive Activity`: `node`, `action`, `actor`, `at`, `via_link`, `client`,
  `detail` (JSON: old and new title, principal and role, source and target
  folder). One row per action, written by the SDK. Same verbs as today.
  Not named Event; the calendar module owns that word.
- `Drive Favourite`: `user`, `node`, unique on the pair. Unchanged in
  shape, retargeted.
- `Drive Recent`: `user`, `node`, `opened_at`, unique on the pair. Today's
  `Drive Entity Log` under its real name. Kept apart from favourites:
  clearing history must not lose stars, and an open is not an activity
  others should see.
- `Drive Notification`: `activity`, `to_user`, `read`. A pointer at an
  activity row; the message renders from it and cannot drift.
- `Drive Legacy Route`: kept, retargeted. `Drive DAV Lock` and
  `Drive DAV Property`: retargeted (009). `Drive Token`: dropped (008).
- Every table links `node`; a node purge deletes its rows, activity
  included.

Build: favourites copy unchanged; Entity Log rows become Recent rows;
Activity Log rows become Activity rows with `message`, `old_value`,
`new_value`, `meta_value` folded into `detail`; old notifications are
dropped (they carry no activity link) and the inbox starts empty.

Rejected: minimal retarget of the four doctypes; one per-user mark table
for stars and recents.

### 11. Content-app data

- Sheet `DocShare` rows become grants on the sheet's node: `read` to READ,
  `write` to EDIT, `everyone` to `$GENERAL`. Rows for missing users are
  dropped and counted.
- `Writer Version` and `Sheet Snapshot` rows become `Drive Node Version`
  rows keeping their ids. Writer: `manual` maps to kind named, else auto;
  `label` from `title`; `seq` by creation order; bytes = the snapshot
  HTML through `put_blob`. Sheet Snapshot: field for field; bytes = the
  snapshot JSON. `Sheet.head_snapshot` retargets to the version row. Build
  migrates every version; the daily thinning job applies the ladder
  afterwards, and the report counts what it will thin.
- Writer `ycomments` (a Yjs map of comments with owner, text, replies,
  resolved, mentions; `writer_document.py:110`) and Sheets cell threads
  (`{resolved, thread: [{author, text, ts, mentions}]}` per cell inside
  `sheets_data`; `frontend/src/apps/sheets/engine/comments.js`) become
  Drive thread and comment rows. Writer anchor = the comment id (the mark
  in the body). Sheets anchor = sheet plus cell id. Mentions go into
  detail.
- Each content doc gets its `node` link from the File row. When
  `File.status` and `Sheet.trashed` disagree, File wins; the case is
  reported.
- A content doc with no File row, Presentation templates excepted, gets a
  node created in its owner's Personal Root and is reported.

Rejected: leave comments in the apps; Build applies the ladder itself.

### 12. Settings, quota, reservations

As [Quota policy](010-quota-policy.md) decided: `Drive Disk Settings.quota`
(MB) becomes `default_personal_quota` (bytes); `shared_quota` starts at 0;
each `Drive Settings.quota` > 0 becomes that user's Personal Root
`quota_bytes`; `Drive Storage Reservation.storage_owner` becomes `root`.
New here: a reservation owner with no Personal Root gets one created in
Build. `Drive Root.used_bytes` is filled by the daily recompute, run as
the last Build step.

### 13. Build order and mechanics

Gate; framework backfill and the S3 copy step; roots; nodes walked from
each root by depth (a parent's path exists before its children) with title
dedupe and trash propagation; grants from Drive Permission and DocShare;
versions and comments; favourites, recents, activity, legacy routes, DAV
locks and properties; content doc node links; settings, quotas, and
reservations; `used_bytes` recompute; report.

Every target row keeps its source id, so a rerun skips rows that exist.
Commit per batch of 1000, as the framework backfill does, so a stopped run
resumes. Bulk SQL inserts for nodes, grants, and side tables; the ORM only
where bytes are written. Build runs in `post_model_sync`; the rename of
`Drive Entity Log` to `Drive Recent` is a `pre_model_sync` step.

Rejected: ORM for every row (`remove_teams.py` style; slow on large
sites); a single transaction (a rerun starts from zero).

### 14. Cleanup

Ships one release after Build. Refuses to run unless every reachable Drive
File row has a node and the framework's blob-reference discovery
([GC reference discovery mechanism](003-gc-reference-discovery-mechanism.md))
exists; without it, deleting File rows orphans every blob under the
framework GC. Then:

- Deletes the Drive-owned File rows, the `Drive` and `Users` roots, and
  every Removed row.
- Deletes the seven custom fields (`fixtures/custom_field.json`) and the
  three property setters.
- Drops `Drive Permission`, `Drive Entity Activity Log`, `Drive Token`,
  and the old notification columns.
- Deletes Sheet `DocShare` rows; drops `Writer Version` and
  `Sheet Snapshot`; clears `ycomments`; strips cell comments from
  `sheets_data`.
- Drops title and trashed columns on content doctypes; `user_folder` and
  `quota` on Drive Settings; `quota` and the S3 fields on Drive Disk
  Settings; `storage_owner` on Drive Storage Reservation.
- Deletes `.thumbnail` sidecars.
- On S3 sites, enqueues a long job that deletes Drive's legacy prefix in
  the bucket.

Local legacy files are never deleted: backfilled blobs point at them in
place through `../<rel_path>` keys.

Rejected: keep the S3 legacy prefix; keep retired doctypes empty for a
release.

### Report

Printed and saved as JSON under the site's private directory. Counts:
Removed rows skipped, broken chains skipped, blobless nodes, title
renames, grant rows dropped by reason, root-guardrail rows dropped, links
minted for `user = ""` rows above read (owners must be told), DocShare
rows dropped, trash disagreements, orphan content docs adopted, versions
the ladder will thin, S3 objects copied and bytes, Personal Roots created
for reservation owners.

### Amendment (2026-09-04): one storage location

Decided with Faris after the resolution. After Build, blobs point at two
places on an S3 site: Drive files copied to the bucket (`driver = s3`) and
legacy attachments under `Home` linked in place on local disk
(`driver = local`, `../<rel_path>` keys). Faris wants one location.

Decision 15: a framework ask, not a suite job. `frappe.storage` gets a
public, resumable `relocate_blobs()` that moves every blob whose driver
differs from the configured one: copy the bytes, rewrite `driver` and
`key` under the same row lock the GC uses, delete the old bytes after
commit. It runs after Build, at any time, and needs no Drive knowledge. On
a local-disk site it folds the in-place `../` files into the blobs
directory. Build and Cleanup stay as decided.

Rejected: a suite job in Build or Cleanup (Drive would write and delete
bytes, and would copy a key layout that already drifted from the spec
once); leaving two locations.

Handed to Draft the spec (013): framework ask 5, `relocate_blobs()`.

### Handed off

- The migration section (all of the above), the Cleanup patch, and the
  schemas for `Drive Activity`, `Drive Recent`, `Drive Favourite`,
  `Drive Notification`, and the comment thread and comment tables; the
  site_config precondition for S3 sites -> Draft the spec (013).
- Favourites, recents, activity, and notification endpoints on the new
  shapes -> HTTP API surface (014).
- Slides media attachments are framework File rows attached to a
  Presentation, not Drive rows, so Build does not touch them; that
  ticket must add its own Build step -> Slides media to nodes (012).
- Frappe Cloud allowlisting of `storage_driver` and
  `storage_driver_config` for suite.frappe.io -> out of scope, an
  operational task; noted on the map.
- Glossary: **Activity**, **Favourite**, **Recent**, **Notification**;
  "Log" and "Event" ambiguities (`suite/drive/CONTEXT.md`).

## Amendment, 2026-09-04

Added while resolving [Slides media to nodes](012-slides-media-to-nodes.md),
after this ticket closed. These rows are part of the same patch set.

- Slide media `File` rows (`attached_to_doctype = "Presentation"`) become
  child nodes of the deck node, one node per deck per blob; duplicates
  within a deck collapse to one node. A video poster is a media node like
  any other.
- `Slide.elements` JSON is rewritten: `src` holds the node id, not a file
  path, and `attachmentName` is dropped. `Slide.background` and legacy
  `/files/` paths (left by `sanitize_attachment_urls.py`) are rewritten the
  same way. A legacy `poster` may be a dict, not a string.
- `Presentation.thumbnail` Files become `Drive Node Preview` rows on the
  deck node; the field and its `attached_to_field` handling go.
- Template decks (`is_template = 1`) gain nodes in Administrator's Personal
  Root under `Templates`, each with a `$GENERAL` READ grant, and carry
  `Drive Node.is_template`. They have no node today
  (`presentation.py:43`), so this is a create, not a move.
- `Writer Template` rows become `Writer Document` rows with nodes and
  `is_template`, granted the same way. The doctype is then dropped.
- The forced-public `Drive Permission` rows on composite decks
  (`user = ""`, written by `presentation.py:47`) are dropped, not mapped:
  ticket 007 removed the invariant and ticket 012 checks each reference per
  viewer. This is narrower than the general `user = ""` rule above, which
  still applies to rows a person created.
- Media nodes get no `Drive Node Preview` rows at migration; the daily sweep
  fills them (ticket 006). Deck previews come from the thumbnail Files
  above.
