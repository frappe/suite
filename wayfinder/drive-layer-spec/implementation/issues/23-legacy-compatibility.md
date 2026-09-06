# 23 — Keep legacy callers working through the new Drive workflows

**What to build:** Keep existing clients usable during the Build release while the new API becomes the supported surface.

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** in-progress

**Owner:** Suite Drive HTTP compatibility

**Starting revision:** Suite `e390a44877c0185522ff186da6c9df09c0e79b89` on
`implement/drive-23-legacy-compatibility`; Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/drive/http/shims.py`,
`suite/drive/api/activity.py`, `suite/drive/api/embed.py`,
`suite/drive/api/files.py`, `suite/drive/api/list.py`,
`suite/drive/api/notifications.py`, `suite/drive/api/permissions.py`,
`suite/drive/api/scripts.py`, `suite/drive/api/storage.py`,
`suite/drive/_core/nodes.py`, `suite/drive/_core/activity.py`,
`suite/hooks.py`, `suite/drive/http/tests/test_shims.py`,
`suite/drive/tests/test_sync_permissions.py`,
`suite/drive/webdav/tests/test_mkcol_delete.py`,
`wayfinder/drive-layer-spec/implementation/legacy-caller-inventory.md`, and this
ticket. The review added `suite/drive/api/s3.py`,
`suite/drive/tests/test_nodes.py`, `suite/writer/api/docs.py`,
`suite/writer/api/embed.py`, and `suite/tests/test_architecture.py`.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.7; plan compatibility stage.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Inventory the 69 named legacy methods against current code. Classify forwarders, permanent methods, and retired behavior explicitly.
- [ ] Forward supported legacy calls into the same Drive workflows, preserving required argument and result compatibility.
- [ ] Keep the product methods, stored S3 fetch URLs, permanent get_file_for_doc entry, and /dav contract.
- [ ] Retired behavior returns a tested explicit response; it cannot fabricate capability tokens or successful mutations.
- [ ] Never synthesize a deny or choose a restore destination for old clients.
- [ ] Preserve legacy authentication restrictions. Remove replaced tests only after equivalent contract coverage passes.
- [ ] Produce the caller inventory that later frontend and Cleanup tickets use. Leave destructive removal disabled.

## Verification

Run an executable inventory across all legacy names, including guest-callable methods, stored URLs, old payloads, and explicit unsupported cases.

## Completion evidence

Status: implementation written and run through every check this worktree can
run without a site. The acceptance boxes stay unchecked: they rest on the
serialized site gate below, which needs `bench` and a database, and on an
independent review. Nothing here was reported without being run.

### Revisions

- Suite start `e390a44877c0185522ff186da6c9df09c0e79b89`, work on
  `implement/drive-23-legacy-compatibility`.
- Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, read only, unchanged.
- Commits: `3770209da` (`_core` reads), `9797d1ea6` (shims and the `api/*`
  bodies), `058e38b27` (tests), `1366f947c` (caller inventory).

### Changed behavior

**New: `suite/drive/http/shims.py`.** One module holding what each of the 69
legacy names does now. `CLASSIFICATION` puts every name in exactly one of four
classes, and the class names are the ticket's:

| Class | Count | What it means |
|---|---|---|
| Forwarder | 37 | The call goes into the same `_core` workflow the §11.2 route calls, and the answer is translated back into the shape the old client reads |
| Permanent | 21 | Written into data or into a shipped artifact. Not edited |
| Retained | 8 | The legacy body is still the implementation, because the replacement §11.7 names does not exist |
| Retired | 3 | §11.7 drops the behavior. The name answers `DriveRetired` at 410 |

**Changed: the whitelisted bodies in eight `api/*` modules.** Each one keeps
its name, its signature, and its decorator - including `allow_guest` - and
delegates. No `api/*` module holds a second implementation of a Drive rule.
Non-whitelisted helpers are untouched, which is what keeps `/dav` and the
retained bodies on the legacy internals.

**New: two `_core` reads.** `nodes.title_taken` (UPLOAD-gated, for
`does_entity_exist`) and `activity.personal_marks` (per-row `is_favourite` and
`accessed`, for the legacy list row). §11.2 answers neither question.

**Changed: `suite/hooks.py`.** `ALLOWED_WILDCARD_PATHS` gains
`/api/suite/drive/`. Additive; `/api/method/suite.drive.api.` stays until
Cleanup. `drive_content_types` is still `[]` and no hook was activated: ticket
29 owns that.

**Changed: `_visible_rows` in `api/list.py`** calls `get_user_access_for_user`
instead of the whitelisted `get_user_access`. `_visible_rows` serves the
retained `get_attachments`, which reads `File` rows; the whitelisted name now
answers about `Drive Node`.

### Decisions

1. **A fourth class.** §11.7 names forwarders, permanent methods, and dropped
   behavior. Eight names fit none of the three: the replacement the spec points
   at does not exist or answers a different question. Calling them forwarders
   would be a claim the code does not support, and calling them retired would
   remove a working capability the spec never said to remove. They are
   `RETAINED`, and `RETAINED_REASON` names the missing route for each.
2. **`DriveRetired` lives in `shims.py`, not `_core/errors.py`.** §11.6's class
   table is the route surface's. This class is 410 - the capability existed and
   is gone - and it dies with the shim module.
3. **A refusal is never invented.** Where the old body answered a sentinel for
   a row the caller may not see, the forwarder catches the workflow's
   `DriveNotFound` and answers the same sentinel. `get_user_access` answers
   all-zeros; `translate_old_name` and `resolve_legacy_route` answer `None`.
4. **An unshare writes nothing.** The old `File.unshare` inserted a deny row to
   cut inheritance. §5.10 keeps removal and denial apart, so the forwarder
   calls `access.revoke` and never `access.grant`. A client that wants a denial
   must send `deny=1`, which is passed through as role 0 because that is the
   client asking.
5. **A restore names no destination.** `remove_or_restore` forwards
   `state="Active"` with no `parent`. §8.7 puts a node back where it was and
   raises `DriveConflict` when that place is gone; the forwarder passes the
   refusal on rather than picking somewhere else.
6. **A retired name refuses everyone, including a site admin.**
   `sync_from_disk` was admin-only. Answering `[]` would read to
   `SyncBreakdown.vue:113-118` as a successful run that found nothing. It
   refuses instead, and creates nothing on the way out.
7. **The two storage aggregates are read here.** §11.2 has no route for a
   by-type total or a largest-files list. `roots.usage_for` authorizes the root
   first; the two lists are then read from `Drive Node` inside that root and
   scoped to the caller. It is a read, not a second answer to a permission
   question.
8. **`get_entity_with_permissions` keeps `frappe.response["data"]`.** The
   frozen SDK's `call()` unwraps `message` while `useDoc` reads `data`. Both
   still work.

### Deviations from the plan

- **The plan deletes `suite/drive/tests/test_sync_permissions.py` at stage 4.**
  It is kept. Three of its four cases cover `sync_preview`'s site-admin gate,
  and `sync_preview` is retained, so the gate still applies and deleting the
  file would drop its only coverage. The `sync_from_disk` case now asserts the
  retirement, and one case was added proving nothing is created.
- **`suite/drive/webdav/tests/test_mkcol_delete.py:140`** called
  `remove_or_restore` to restore a `File` row. It now calls
  `toggle_entity_status`, the function the `/dav` DELETE path itself uses. Same
  coverage, on the path the test is about.

### Contradictions between the spec and this revision

Recorded, not worked around. None of them was resolved by writing code that
claims otherwise.

1. **`sync_preview` → `POST /nodes/<id>/preview` is a name collision.** The
   legacy name lists unregistered files on disk; the route uploads a rendered
   thumbnail. No route lists disk files. Retained.
2. **`get_attachments` → `GET /nodes/<id>/media` is a name collision.** The
   route lists a document's embedded media; the legacy name browses a business
   document's Drive attachments. §14.4 keeps framework attachments as `File`
   rows, so the node surface cannot answer it. Retained.
3. **The folder-download trio maps to `GET /nodes/<id>/content` on a folder**,
   which raises `DriveConflict` (`routes.py:375`). No archive route exists.
   Retained.
4. **There is no root-discovery route.** `get_root_folder`, both storage
   methods, and `GET /views/trash?root=` all need a root id that no route
   answers. The forwarders read `_core.roots` directly.
5. **`translate_old_name` "kept as a forwarder over `Drive Legacy Route`".**
   The legacy body never read that table, and §14.3 preserves ids, so no
   mapping is needed. It forwards to a readability check on the id itself.
   `resolve_legacy_route` does read the table.
6. **§11.7's `suite/hooks.py:429-446` and `:450` line references are stale.**
   The lists are at `:535-552` and `:556-558` on this revision.
7. **The bundle §11.7 cites for `get_file_for_doc` is not checked in.**
   `suite/public/frontend/assets/sdk-o7hlQ1xj.js` is gitignored
   (`.gitignore:14`). The real checked-in caller is
   `frontend/src/apps/drive/sdk.js:25`. The name stays permanent; the reason
   is the SDK, not that file.

### Commands and results

Site-free, run in this worktree:

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<worktree>:<frappe> \
  env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.drive.http.tests.test_shims suite.tests.test_architecture
Ran 261 tests in 1.525s
OK
```

`test_shims` alone: `Ran 88 tests in 0.265s / OK`.

```
env/bin/python -m compileall -q suite/drive suite/www suite/tests suite/hooks.py
(no output, exit 0)
```

```
ruff 0.14.10 format --check <15 changed files>
15 files already formatted
ruff 0.14.10 check <15 changed files>
All checks passed!
```

Not run here, and named as unverified: every `_core` suite, `test_dispatch`,
`suite.drive.api.tests.*`, the WebDAV suites, and
`suite.drive.tests.test_sync_permissions`. All of them need a live site and a
database.

### Tests written

`suite/drive/http/tests/test_shims.py`, 88 cases, no database.

- **Inventory (8 cases).** The 69 names are read out of the legacy modules with
  `ast`, not listed, so a name added or removed on that surface fails this file.
  The four classes partition the surface at 37/21/3/8. Every forwarder
  delegates; no permanent name was rewritten; every retained name says why.
- **Guest posture (3 cases).** The 26 guest-callable names are frozen as a set,
  and every one of the 69 is checked against it in both directions.
- **Retired (5 cases).** Each of the three raises `DriveRetired` at 410, names
  its replacement, and writes nothing. A download token presented to
  `get_file_content` is refused before the node is read.
- **Forwarding (67 cases).** Per group, with the workflow stubbed: the
  arguments passed and the keys answered. Permissions 14, records 6, storage
  and embed 5, files 26, access 5, listing 11. They cover the legacy list
  row's twenty columns, the `get_entity_with_permissions` payload with its
  trailing breadcrumb and its `data` envelope, the flattened notification, the
  storage bar that folds reservations into the total, the paginated
  `{rows, has_next, next_start}` envelope, and the `order_by` fallback.
  Three of the 67 are about what must *not* happen: an unshare never calls
  `grant`, a restore never names a parent, and `mark_as_read()` with nothing
  named calls nothing.
- **Permanent surface (5 cases).** `s3.fetch` and `get_file_for_doc` still hold
  their own bodies, `/dav` is still mounted, `/api/suite/drive/` was added
  without removing the method prefix, and `drive_content_types` is still empty.

### Required site gate, before this ticket closes

Serialized, one command at a time, on `slides.localhost`. This bench has no RQ
worker and the short queue saturates, so parallel runs are not reliable here.

```
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shims
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
bench --site slides.localhost run-tests --module suite.drive.api.tests.test_files
bench --site slides.localhost run-tests --module suite.drive.api.tests.test_list
bench --site slides.localhost run-tests --module suite.drive.api.tests.test_notifications
bench --site slides.localhost run-tests --module suite.drive.tests.test_sync_permissions
bench --site slides.localhost run-tests --module suite.drive.webdav.tests.test_mkcol_delete
bench --site slides.localhost run-tests --module suite.drive.webdav.tests.test_put_get
bench --site slides.localhost run-tests --module suite.drive.webdav.tests.test_perms
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes
bench --site slides.localhost run-tests --module suite.writer.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.slides.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.writer.api.tests.test_general
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```

Five were added by the review. `test_nodes` carries the new
`readable_child_counts` cases; the two adoption suites cover
`writer.api.docs.create_document` and the presentation `slide_count` path.
`writer.api.tests.test_general` is the only Python caller of
`get_user_access`, whose `type` field the review changed. `tests.test_grants`
pins `access.grant` and `access.grants_for`, and `update_access` now calls
both, to keep an expiry it has no field for.

The `api.tests.*` suites are the ones that will move: they exercise the legacy
names against `File` rows, and those names now answer about `Drive Node`. Their
failures are the real measure of how much of the old contract survived, and
they cannot be read without a database.

## Independent review evidence

Status: reviewed on `review/drive-23-legacy-compatibility`, branched from
`25354709a`. The review did not trust the evidence above; every claim it
repeats was re-derived from the code. Thirty defects were found and fixed
across two passes; two more were rejected on re-derivation and are named below.
The acceptance boxes stay unchecked: they still rest on the serialized site
gate below, which needs `bench` and a database.

Agents produced the independent name inventory, the auth and guest sweep, the
dropped-behavior sweep, and the second pass's correctness, security, caller,
and coverage sweeps. Every finding was re-derived against the code before it
was acted on. The fixes, the regression tests, the mutation runs, and this
section are the review's.

### Review revisions

- `037d067a9` repair the legacy paths ticket 23 broke
- `d5f8d4590` close the leaks and the dropped list decorations
- `f75f0aff1` pin the permanent surface to the tree, not to a phrase
- `be89d402d` stop the S3 entry point confirming an object it refuses
- `29eadd1cd` refuse a legacy share that reaches no rung
- `ec5bd104c` sort the three views the toolbar can still sort
- `3a70a6228` finish the four legacy paths the interrupted review left open
- `45f9296b6` notice a legacy name added outside the eleven modules
- `4a7c5a0ab` repair three legacy features the forwarders answered emptily
- `49b413d7c` bound the listing walks and two refusals that answered a 500
- `2a18f766d` repair the upload path and give a refusal its message back
- `b4b6fde55` four payload defects the forwarders carried
- `f517358f0` close the two blind spots and the check that proved nothing

### What the review confirmed

Re-derived, not read off this file:

- 69 whitelisted names across the 11 modules, at both `e390a4487` and HEAD, by
  AST. 26 guest-callable. The four classes partition at 37/21/3/8. No
  signature and no decorator drifted.
- The three retired names refuse as their first statement. Nothing is written
  and no token is minted on the way there. The `get_file_content` download
  token is refused before the node is read.
- No `$LINK:` principal, ticket, expiry, or MAC is minted anywhere in the shim.
- `remove_or_restore` names no destination. `_core` refuses when the original
  place is gone.
- Only one call site grants role 0, and only when the caller sent `deny`.
- `overrides/file.py` is byte-identical to `e390a4487`. `/dav`,
  `webdav/*`, and `api/product.py` are untouched. `toggle_entity_status` is
  retained and WebDAV still reaches it.
- `suite/hooks.py` is additive: `ALLOWED_WILDCARD_PATHS` gained
  `/api/suite/drive/` and kept `/api/method/suite.drive.api.` and `/dav/`.
  `drive_content_types` is `[]`.

### What the review changed

Thirty fixes over two passes. `legacy-caller-inventory.md`, section "What the
review fixed", lists every one with the caller it breaks. Each carries a
regression test that was run against the pre-fix body and fails there.

The second pass found seven things the first did not:

- **Uploads were broken for every file under 20 MB.** Dropzone sends
  `total_file_size` on a chunked upload only, so the session declared zero
  bytes, refused its own first chunk, and deleted itself. The old body never
  read the field.
- **Refusal messages did not reach any legacy client.** The workflows raise;
  `report_error` copies a message only when `frappe.throw` stamped one on.
  `FileUploader.vue:208` printed "Please contact support." for a full disk and
  `ui/drive/js/resources.js:35` threw inside its own error handler.
- **`list.files` amplified.** It is `allow_guest`, and a `file_kinds` filter
  matching nothing walked the whole folder one row at a time.
- **The same walk paged wrong.** `start` and `limit` counted matching rows on
  the old surface; the cursor counted unfiltered ones.
- **`file_kinds=["Frappe Document"]` selected nothing**, because `frappe_doc`
  is under `Document` first in `MIME_LIST_MAP`.
- **A legacy re-share cleared an expiry** the new surface had set.
- **`get_entity_with_permissions` served a trashed node**, where the old query
  filtered `status: STATUS_ACTIVE`.

Two findings from the sweeps were rejected on re-derivation and nothing was
changed for them: the per-row `share_count` reads local rows only and legacy's
`_get_share_count` did the same, and the `search` walk cannot repeat a row
because each window is a distinct cursor offset.

The one permanent body the review edited is `api.s3.fetch`: its `except` clause
did not name the `_core` refusal classes, so a denied stored URL answered 403
and confirmed the object exists. The permanent-shape test carries that
exception explicitly and asserts the widened clause.

`_core/nodes.py` gained one read, `readable_child_counts`. The count of a
folder's children is a permission answer, so it is decided in `_core` rather
than in the shim.

### Review commands and results

Site-free, run in the review worktree at `f517358f0`:

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<frappe>:<worktree> \
  env/bin/python -m unittest suite.drive.http.tests.test_shims \
  suite.drive.http.tests.test_routes suite.drive.http.tests.test_shapes \
  suite.drive.http.tests.test_translator suite.tests.test_architecture
Ran 337 tests in 2.420s
OK
```

`test_shims` alone: `Ran 164 tests in 1.123s / OK`, up from 88 at
`25354709a`.

**Formatting and lint are unverified.** `ruff` is not installed anywhere
reachable on this machine, in the bench venv or on `PATH`. The earlier claim
of a clean `ruff format` and `ruff check` could not be re-run and is not
repeated here.

`suite.drive.http.tests.test_dispatch` errors in 19 `setUpClass` calls with
`AttributeError: session`. It needs a bound site. Re-run at `f517358f0`:
`Ran 0 tests / FAILED (errors=19)`, the same count as at `25354709a`, so it is
the site gate's and not a regression.

Not run here, and named as unverified: every `_core` suite, `test_dispatch`,
`suite.drive.api.tests.*`, `suite.drive.tests.test_nodes`, the WebDAV suites,
`suite.writer.tests.test_drive_adoption`, and `suite.slides.tests.*`. All of
them need a live site and a database.

### Review tests written

`suite/drive/http/tests/test_shims.py` grew from 88 to 164 cases, no database.
`suite/drive/tests/test_nodes.py` gained 2 cases, which need a site.

Every new case was mutation-tested: the fix was reverted in place, the suite
was run, and the mutation had to fail an assertion. Twenty-five mutations were
run across the review's four fix commits, and every one was killed. The two
that first "killed" by hanging were re-run against a finite stub, so the walk
bounds fail a count rather than the suite.

- **Permanent surface, rewritten.** Each of the 21 permanent names is compared
  with its own structure at `e390a4487`: decorators, signature, and every
  statement, with comments and docstrings excluded. Every legacy name's
  `allow_guest` flag is compared with the same revision. The hook assertions
  import `suite.hooks` and read the real lists. One of them had been passing on
  a file-text match that was not the value the hook holds.
- **Access.** The ladder walk, the `$PUBLIC` READ clamp, both site-wide rows on
  one unshare, and the refusal of a share that reaches no rung.
- **Listings.** The unbounded non-paginated walk, the hundred-row paged
  default, `slide_count` on presentation rows and on no other row.
- **Records.** `move` answers the destination; notifications carry the
  `entity_type` the page routes on, and `None` when the node is gone.
- **Uploads.** `list-add` is published to the uploader and carries a full
  legacy list row.
- **`_core`.** `readable_child_counts` leaves out a denied child, keeps a child
  whose own grant names somebody else, ignores the trash, and answers every
  named folder.

Second pass:

- **Module surface.** No legacy whitelisted name may be added outside the
  eleven modules §11.7 counts. The whole `drive/` package is walked.
- **Listing bounds.** Each of the three walks stops at its own bound, against a
  finite stub, so an unbounded walk fails a count rather than hanging.
- **Filtered paging.** The page counts matches, walks from the top whatever
  offset it is given, and still says there is more when it stopped at a bound.
- **Uploads.** The session declares the bytes in hand when the client declared
  none, keeps the client's number when it sent one, and refuses a direct
  target by name.
- **Refusal messages.** Every shim a legacy module reaches carries the
  boundary, a refusal arrives with its message in `message_log`, and the class
  §11.6 reads the status code off is preserved rather than flattened.
- **Payloads.** The access label follows the rung the bits come from, a family
  filter matches a mime two families share, a re-share keeps an expiry, a
  first share carries none, a page read refuses a non-Active node, and
  `get_root_folder` refuses a site with no Shared root.
- **Blind spots.** `_share_counts` (a link is not a person, role 0 is a deny,
  published beats site-wide) and `_child_named` (the UPLOAD gate before the id
  is read, and the path walk that reuses a folder it finds).
- **Test quality.** The forwarder check walks for a call node. Verified by
  inlining `api.notifications.get_unread_count` with the comment "was a shims.
  forwarder": the old substring check passed it, the new one fails it.

### Unresolved risks the review did not fix

1. **`unshare` on a site-wide principal writes no deny.** `File.unshare` called
   `_insert_deny` when read was still inherited from above. §5.10 makes a deny
   something the client must ask for, and the acceptance criteria forbid
   synthesizing one, so the shim removes rows and stops. A file inside a
   publicly shared folder stays readable after "Restricted", and
   `ShareDialog.vue` says nothing. The frontend ticket owns telling the user.
2. **`update_access` cannot spell `share` without `write`.** MANAGE sits above
   EDIT on the ladder. A legacy row that said "may re-share, may not edit"
   becomes UPLOAD or COMMENT.
3. **`list-add` reaches the uploader only.** The old body broadcast the row to
   every connected session. A second person watching the same folder no longer
   sees the upload appear. Restoring the broadcast would send a node row to
   sessions never authorized for it.
4. **A no-limit listing stops at 200 windows.** It matched the old
   non-paginated branch, which ran with no `LIMIT`, and that made a guest able
   to walk a whole folder one row at a time. The walk is capped now, and a
   folder past 40,000 rows comes back short with `has_next` still true. The
   tree sidebar and the move dialog both call that way.
5. **Uploads fail on a site whose `storage_driver` is `s3`.** The driver
   offers a presigned target, so the session is direct and no chunk can be
   written to it. A legacy caller has already sent its bytes here, and §11.7
   has no way to hand them on: a presigned POST pins the object to one request
   and the whole declared length. Relaying would mean buffering the file
   server-side, which is the temp file §14 removed. Refused by name.
6. **`Administrator` has no personal Drive folder.** §7 refuses to provision
   one, and legacy `get_user_folder()` made one for anybody. Named at `_home`
   rather than handed on as a `None`. This is a §7 question, not a shim one.
7. **A share to an address with no `User` row is refused.** `File.share`
   called `create_invites(user, auto=True)`; `access._validate_principal_target`
   refuses. `TagInput` still offers "Add email".
8. **A new share sends no email.** `Drive Permission.after_insert` enqueued
   `notify_share`. `_core.access` writes a `Drive Notification` row and stops.
9. **One e2e test depends on the old share ceiling.**
   `e2e/drive-backed-apps/specs/drive/sharing.spec.ts:192-221` shares
   `{read: 1, share: 1}` and expects the re-share to be refused with "cannot
   grant". `share` without `write` cannot be spelled, so the first share lands
   at READ and the second is refused by the MANAGE gate with another message.
   Read, not run: this review has no site.
10. **Everything the site gate owns.** See below. Nothing in this review has
    touched a database either.

### Unresolved handoffs

1. **The site gate has run modules 1 to 4 of 17.** See "Site gate evidence"
   and the module 3 and module 4 sections below. Modules 5 to 17 have not been
   run. Every acceptance box waits on them.
2. **Build has not run.** Forwarders and Build ship in one release (plan stage
   4 precedes stage 6). Before Build there is no node for a legacy id, and a
   forwarder answers the workflow's `DriveNotFound`. That is the workflow
   answering, not a fabricated deny, but it means the legacy suites cannot pass
   on this branch alone.
3. **`suite/drive/api/tests/*` are rewritten where the gate has reached.**
   `test_files.py` and `test_list.py` are done; modules 3 and 4 say what broke
   and why. `test_notifications.py` builds `Drive Notification` rows rather
   than `File` rows, so module 5 has no fixture port to do.
4. **Ticket 29 dormancy is preserved.** `drive_content_types = []`, no hook
   activated, no `site_config` change.
5. **Destructive removal stays disabled.** Nothing in Cleanup's list was
   deleted. `legacy-caller-inventory.md` records what may go, and in what
   order.
6. **`ruff` is not on `PATH` or in the bench venv.** It runs through
   `uvx ruff@0.12.3`. The site gate ran both commands; see "Formatting and
   lint" below.
7. **The e2e suites have not run.** Twelve legacy names are called by name from
   `e2e/drive-backed-apps/`; the inventory now lists every call site. They need
   a site and browsers.
8. **`frappe.local.response.errors` is not restored.** The old
   `get_entity_with_permissions` set it to mimic an API v2 error body. Nothing
   in `frontend/src` reads it, and `frappe-ui` is not vendored in this
   worktree, so whether its request layer reads it could not be checked.

## Site gate evidence

Status: module 1 of the 17 passes. Work on `forge/drive-23-site-gate-shims`,
branched from `5c902f025`. Module 3 has its own section below.

### What module 1 reported

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shims`
ran 164 tests and failed three. All three need a terminal. The same command
with its output piped passed 164/164.

| Test | Result | Cause |
|---|---|---|
| `test_a_chunked_upload_that_names_no_session_is_refused` | error | A |
| `test_a_direct_upload_target_is_refused_where_the_reason_is` | error | A |
| `test_create_auth_token_mints_nothing` | failure | B |

**Cause A: the test replaced `frappe.cache` for the whole process.**
`frappe.cache` is one shared object (`frappe/__init__.py:217`), and `frappe._`
reads the merged translation dict off it
(`frappe/translate.py:177`: `frappe.cache.hget(MERGED_TRANSLATION_KEY, ...)`).
With the object replaced by a `MagicMock`, `_()` answered a child mock, so the
two upload refusals called `frappe.throw` with a mock for a message. `msgprint`
runs `msg = strip_html_tags(msg)` when `sys.stdin.isatty()`
(`frappe/utils/messages.py:79-85`), and that regex refuses a mock:
`TypeError: expected string or bytes-like object, got 'MagicMock'`. Piped, the
same call raised `ValidationError` carrying a mock repr, and
`assertRaises(frappe.ValidationError)` accepted it. Not patch leakage: the
patch was scoped correctly and the object it replaced was the wrong one.

**Cause B: a retired message named a route in angle brackets.** The
replacement was `GET /api/suite/drive/nodes/<id>/content`. `msgprint` cleans
the message it logs with `clean_html` unconditionally (`messages.py:77`) and
strips tags off the exception on a terminal (`:79-85`). Both delete
`<id>`, so the assertion read
`Drive signs a download URL at GET /api/suite/drive/nodes//content.` This one
is not a test defect. `message_log` is serialized into `_server_messages`
(`frappe/utils/response.py:202-205`), which is the text a legacy client
renders, so every legacy caller was handed a route it cannot call. The same
message is answered by the `get_file_content` download token, and the `$LINK`
refusal in `update_access` carried
`PUT /api/suite/drive/nodes/<id>/grants/$LINK`.

### The rest of cause B

Cause B is a class, not one message. Every refusal that spells a runtime value
into its text meets the same two cleaners, so the sweep was widened to all 15
files ticket 23 changed. Agents produced the sweep; each finding was re-derived
against the code before it was acted on.

Eight more messages carry a value that can hold an angle bracket, and all eight
are in `shims.py`:

| Site | Value | When it is lost |
|---|---|---|
| `set_favourite`, `remove_or_restore`, `delete_entities`, `move`, `remove_recents` | `type(x)` | always. `str(type([]))` is `<class 'list'>` |
| `update_access` | the `method` argument | whenever the request body holds a bracket |
| `_home` | the user id | a mail address written `<a@example.com>` |
| `_legacy` | the whole `_core` refusal | a node the caller named `a<b>c` |

The five `type(x)` messages told a legacy client `Expected list but got ` and
named neither the type wanted nor the type sent. They were carried in from the
old `api/files.py` bodies, which spelled the same f-string.

`_legacy` is the eighth and the widest. Throwing the refusal again is what
fills a message in for a legacy client (`shims.py:290`), and it is also the
first time a `_core` message meets `clean_html`: before ticket 23 those
refusals reached a legacy client with no text at all. Seven `_core` messages
spell a client-supplied id, kind, doctype, or view name.

### What changed

- **`shims.py`, first pass.** Three messages spell a route placeholder `:id`.
  `_retire`'s docstring says why, so it is not spelled back.
- **`shims.py`, the class.** `_spelled` names a type by `__name__` and takes
  the brackets off any other runtime value; the six messages that spell one use
  it. `_plain` takes them off the `_core` message `_legacy` re-throws. A
  message this module writes itself spells no bracket at all, and a test holds
  that rule, so a constant is corrected rather than sanitized: `_plain` on a
  route would answer `nodes/id/content`, which is still not a route.
- **The seven `_core` sites are not edited.** They predate ticket 23 and
  `routes.py:112` cleans them for the §11.2 surface too. Ticket 23 covers its
  own boundary and records the rest under carried risks.
- **`test_shims.py`.** `ShimCase.stub_cache` installs `_MemoryCache`, which
  answers the three `get_value`/`set_value`/`delete_value` calls `upload_file`
  makes and passes every other attribute to the real cache. Three test bodies
  used the old patch; all three use the stub.
- **Nine cases added, 164 to 173.** The two upload refusals now assert their
  own text, so a mock message fails them whether the run has a terminal or not.
  `TestRefusalText` reads `frappe.local.message_log`, which is what a client
  renders, and asserts every retired refusal reaches it as the words it was
  raised with and that the replacement route arrives whole. Two cases walk
  `shims.py` with `ast`: one asserts no string marked for translation carries
  an HTML tag, the other that none spells an angle bracket at all.
- **The terminal is decided, not inherited.** `_Stdin` replaces `sys.stdin`,
  which is the only thing `msgprint` asks about the caller. Every new case runs
  twice, once each way, and asserts the exact text in both the client's
  `message_log` and the raised exception. A test that reads whichever terminal
  the runner happens to have proves half the path: that is how the three
  original failures passed a piped run.

### Gate commands and results

A terminal is allocated with `script -qec ... /dev/null`, because the failures
do not appear without one.

```
script -qec "bench --site slides.localhost run-tests \
  --module suite.drive.http.tests.test_shims" /dev/null
before: Ran 164 tests in 1.020s / FAILED (failures=1, errors=2)
after:  Ran 173 tests in 1.024s / OK
```

Piped, the same command answers `Ran 173 tests in 1.140s / OK`.

Site-free, on a terminal, `python -m unittest` over `test_shims`, `test_routes`,
`test_shapes`, `test_translator`, and `test_architecture`:
`Ran 346 tests in 2.773s / OK`. `test_shims` alone: `Ran 173 tests in 1.203s`.

Five mutations, each reverted in place and run on a terminal and piped:

| Mutation | Killed by |
|---|---|
| `_spelled(type(x))` back to `type(x)`, all five | `test_a_bad_argument_names_the_type_that_arrived`, 10 subtests |
| `_spelled(method)` back to `method` | `test_a_refusal_echoes_the_method_the_caller_sent` |
| `_spelled(principals.user)` back to `principals.user` | `test_a_missing_root_names_the_user_it_looked_for` |
| `_plain(str(refusal))` back to `str(refusal)` | `test_a_workflow_refusal_keeps_its_words_at_the_legacy_boundary` |
| `:id` spelled back as `<id>` | four cases, including both `ast` walks |

**Formatting and lint.** `uvx ruff@0.12.3 format --diff` answers the same three
hunks on `shims.py` and `test_shims.py` before and after this work, so no drift
was added; those three predate the branch and are left alone. `check` answers
one `B007` on `shims.py:1792`, which also predates the branch.

`bench run-tests` exits 1 on this bench even when every test passes.
`_cleanup_after_tests` calls `enable_scheduler` after the connection is gone
and raises `RuntimeError: object is not bound`. It is the runner's teardown,
not a test result. Read the summary line, not the exit code.

### Mutation runs

Two mutations, both killed, site-free:

- Spell the three placeholders `<id>` again: 6 failures.
- Put `patch.object(frappe, "cache", MagicMock(...))` back in `stub_cache`:
  2 failures, the two upload refusal texts.

### Formatting and lint

`ruff` is reachable after all, through `uvx ruff@0.12.3`. This corrects the
review's handoff 6.

- `ruff format --check` wants to reformat both files. It wants the same three
  hunks at `5c902f025`, and none of them is a line this work touched.
- `ruff check` reports one `B007` at `shims.py:1759`, an unused `window` loop
  variable that predates this branch. Nothing was changed for either.

## Site gate evidence: module 3

Module 3 of 17 is `suite.drive.api.tests.test_files`. Work on
`forge/drive-23-site-gate-api-files`, branched from `db24d2f5f`. Module 2
(`suite.drive.http.tests.test_dispatch`) is reported green at 154 tests by the
gate run before this one; it was not re-run here, so its detail is not
recorded in this section.

### What module 3 reported

`bench --site slides.localhost run-tests --module suite.drive.api.tests.test_files`
ran 49 tests and reported 6 failures and 21 errors. Three causes.

**Cause A: the fixtures build `File` rows, and the names read `Drive Node`.**
Twenty-one errors and one failure. §11.7 forwards every whitelisted name in
`api/files` into a `_core` workflow, and the workflows read nodes. A parent id
that exists only in `tabFile` is a node that was never there, so `upload_file`
answered `DriveNotFound` and both share cases read back `read: 0`. Carried risk
3 in the module 1 evidence predicted this: the suites test the legacy names
against `File` rows. It is a test defect, not a production one. Build has still
not run on this site: 797 `File` rows, 84 `Drive Permission`, 13 `Drive Node`.

**Cause B: `TestDriveSearch` patched targets that no longer run.** Five
failures. The cases patched `SEARCH_SCAN_WINDOW`, `MAX_SEARCH_SCAN_WINDOWS`,
`user_has_permission`, and `frappe.db.sql` in `api/files`. The shim walks
`nodes.views(principals, "search", ...)` windows now, so every one of those
targets is inert and the assertions read an empty list. Also a test defect.

**Cause C: `create_auth_token` is retired.** One error, the retirement
answering §11.7's own decision. The case asserted the old mint.

**A fourth cause was found only by rewriting the fixtures.**
`nodes.readable_child_counts` asked `frappe.get_all` for
`count(name) as total`, and `frappe.db.query` refuses a function spelled as a
string in `fields`. The ticket 23 review added the function; no run on a site
had reached it. Every legacy list row carries `children_count`, and so does the
`list-add` row an upload publishes, so nothing could be uploaded through
`upload_file` at all. This one is a production defect and is fixed.

### What changed

- **`_core/nodes.py`.** The count is a `frappe.db.sql` `GROUP BY` over
  `_sql_values(parents)`, the way the readable-child query below it in the same
  function is already written. Rows, `Active` filter, and the subtraction are
  unchanged.
- **`api/tests/test_files.py` is split by permission store.**
  `TestDriveFileRules` keeps the `File` and `Drive Permission` cases: the
  `has_permission` hooks, the content-link delegation, the retained
  `get_attachments`, `File.share`, and `FileManager`. Ticket 23 did not touch
  those bodies. The two `FileManager` cases stage their bytes on disk, because
  the legacy upload path that used to put them there is gone.
  `TestLegacyFilesAPI`, `TestLegacyRetired`, and `TestLegacySearch` build
  nodes.
- **Each case cleans up after itself.** `IntegrationTestCase` rolls back at
  class cleanup, not per test, so `LegacyNodeCase.tearDown` drops the nodes,
  grants, versions, previews, activity, notifications, recents, favourites,
  comments, and blobs the case added, then calls `quota.recompute_usage` on the
  root it took rows out from under.
- **Four cases were passing for the wrong reason.** `DriveNotFound` subclasses
  `frappe.ValidationError`, so `assertRaises(frappe.ValidationError)` accepted a
  404 that meant "your fixture is not there". Each names its own class now.
- **Uploads need `storage_v2`.** `create_blob_upload` refuses without it. The
  `storage_v2()` context manager moved to `suite/drive/tests/fixtures.py`
  rather than being copied a third time, next to `drop_node_rows`,
  `drop_record_rows`, and `nodes_in_root`. `test_dispatch.py` keeps its private
  copies: it is module 2, it is green, and this run may not re-run it.
- **49 cases to 59.** The new ones: the retired names refuse and write nothing
  (`create_auth_token` mints no `Drive Token`, `get_new_title` renames
  nothing), the dedupe rule still holds where `upload_file` needs it, a
  single-chunk upload mints its own session, a session that is missing or empty
  is refused, an over-quota upload charges nothing, an upload publishes exactly
  one `list-add` to the uploader alone, and the search window walk, scan
  budget, page cap, and blank-query short circuit are each pinned against what
  the shim actually reads.

### Gate commands and results

```
script -qec "bench --site slides.localhost run-tests \
  --module suite.drive.api.tests.test_files" /dev/null
before: Ran 49 tests / FAILED (failures=6, errors=21)
after:  Ran 59 tests in 4.006s / OK
```

Site-free, `python -m unittest` over `test_shims`, `test_routes`,
`test_shapes`, and `test_translator`: `Ran 339 tests in 1.419s / OK`. Module
1's record names a fifth module, `test_architecture`; there is no such module
in the tree on this branch, which is why the count reads 339 and not 346.

One mutation. `readable_child_counts` reverted in place to the
`frappe.get_all` spelling: 7 errors, all on
`SQL functions are not allowed as strings in SELECT`. The seven are the four
upload cases, the publish case, the mime-type case, and the dedupe case.

**Formatting and lint.** `uvx ruff@0.12.3 check --select=I`, `check`, and
`format --check` all pass on the three changed files.

### What the gate still owes

Modules 5 to 17 have not been run.

## Site gate evidence: module 4

Module 4 of 17 is `suite.drive.api.tests.test_list`. Work on
`forge/drive-23-site-gate-api-list`, branched from `ac74ecdbf`.

### What module 4 reported

`bench --site slides.localhost run-tests --module suite.drive.api.tests.test_list`
ran 8 tests and errored on all 8. One cause, and it is carried risk 3 again:
`TestDriveListPagination` built `File` rows with `create_drive_file` and shared
them with `update_access`, so every `files()` call reached `node_core.children`
with a parent that is in no root and met `DriveNotFound`. The module asserted
nothing about the forwarder. It is a test defect.

Two production defects were found only by rewriting the fixtures. Both are one
defect seen twice: a folder page is sorted by a column the row does not
publish.

**A folder page ordered by a value the client never sees.** `_legacy_row`
publishes legacy `modified` as `content_modified or modified`, which is what
the old query published (`utils/__init__.py:160`,
`COALESCE(file_modified, modified)`). `ORDER_COLUMN` mapped the same legacy
name to §11.4's `modified`, so `children` sorted the SQL window by the row's
own mtime. `content.touch` stamps `content_modified` with
`update_modified=False` and `upload_file` stamps it from the client's own
`file_modified`, so the two columns differ on every uploaded and every edited
file: the page came back in an order the dates on it contradict. The four
discovery views did not have this - `_sort_key` already coalesces - so one
legacy argument meant two things depending on which list was open.

**An unknown column fell back past the mapping.** Both call sites read
`ORDER_COLUMN.get(order_by, "modified")`. The default is the legacy name, not
the §11.4 name it maps to, so "Type" and "Owner" - two of the five columns the
toolbar sends - sorted by the wrong column even once the mapping was right.

### What changed

- **`_core/nodes.py`.** `ORDER_TERMS` replaces the column table in
  `_order_column` with one ordering term per §11.4 name, written twice because
  the folder page sorts the inner window and the union around it.
  `content_modified` is now `COALESCE(content_modified, modified)`. A null
  there is not "before every time there is": `_create_empty_node` inserts a
  folder without one, so the raw column clumps every folder at one end of the
  list. The vocabulary is unchanged at four names and no other order moved.
- **`http/shims.py`.** `ORDER_COLUMN` maps legacy `modified` to
  `content_modified`, and `_order_column` maps the fallback the same way.
- **`http/tests/test_shims.py`.** One assertion in
  `test_an_unknown_sort_column_falls_back_instead_of_refusing` reads
  `content_modified`. Module 1 is otherwise untouched and was re-run.
- **`api/tests/test_list.py` is rebuilt on nodes.** `LegacyListCase` hangs one
  folder off the caller's provisioned Personal root, the way `LegacyNodeCase`
  does in module 3, and takes the same before/after root diff in `tearDown`
  plus `quota.recompute_usage`. `drop_node_rows`, `drop_record_rows`, and
  `nodes_in_root` come from `suite/drive/tests/fixtures.py`; `storage_v2` is
  not needed, because nothing here opens an upload session.
- **A fixture cannot name a mime.** `create_file` refuses any mime but the
  blob's (`_validated_blob`, `nodes.py:2095`) and `put_blob` sniffs the bytes
  and never reads the title (`frappe/storage/blob.py:64`). So the `file_kinds`
  cases hand over real PDF and PNG magic bytes, and the payload case asserts
  `file_type: "Application"` for a `.txt` file. See the carried risk below.
- **8 cases to 26.** Eight are the original contract, ported: the paged
  envelope, the bare list, a full page, an exhausted page, and the four denial
  cases that are why the walk exists. The new ones pin what the rewrite of
  `api/list` into `_listing` changed and what module 1 could only assert
  against a mock: an unpaginated call with no limit answers the whole folder
  (105 children) where a paginated one stops at 100, the toolbar's three
  columns reach the folder sort and an unknown one falls back, `file_kinds`
  selects the old families and its `start`/`limit` count matching rows, a
  search leaves the folder for the tree, one row carries the exact 27 legacy
  columns, `child_count` counts what the caller can see, the share marker
  reads -2/-1/1/0 off the node's own grants, and the four views answer, sort,
  and page.

### Gate commands and results

```
script -qec "bench --site slides.localhost run-tests \
  --module suite.drive.api.tests.test_list" /dev/null
before: Ran 8 tests in 1.017s / FAILED (errors=8)
after:  Ran 26 tests in 5.378s / OK
```

Piped, the same command answers `Ran 26 tests in 5.456s / OK`.

Site-free, `python -m unittest` over `test_shims`, `test_routes`, `test_shapes`,
and `test_translator`: `Ran 339 tests in 1.522s / OK`. Module 1 is still green
with its one assertion moved.

Three mutations, each reverted in place:

| Mutation | Killed by |
|---|---|
| `ORDER_COLUMN["modified"]` back to `"modified"` | `test_pages_use_the_modified_value_returned_to_the_client`, `test_an_unknown_column_falls_back_instead_of_refusing` |
| `ORDER_TERMS["content_modified"]` back to the raw column | the same two |
| `_order_column` fallback back to the literal `"modified"` | `test_an_unknown_column_falls_back_instead_of_refusing` |

**Formatting and lint.** `uvx ruff@0.12.3 check --select=I` and `check` pass on
all four changed files. `format --check` reformats `test_list.py`, which was
done. `shims.py` and `test_shims.py` answer the same one and two hunks at
`ac74ecdbf` as after this work, so no drift was added; they predate the branch
and are left alone.

### Carried risks

1. **A node's mime is sniffed, so a text file is `application/octet-stream`.**
   `upload.finish_upload` writes `mime=blob.mime_type` and drops the
   `Content-Type` the caller declared (`_core/upload.py:160,172`). Legacy
   `file_type` reads that mime, so a `.txt` file that used to list as `Text`
   now lists as `Application`, and the `Text`, `Code`, and `Spreadsheet`
   families select nothing a node upload produced. This is `_core.upload`'s
   decision, from ticket 10, not §11.7's mapping: the forwarder reports the
   node's own mime. Recorded, not fixed here.
2. **`kind` is always `native` on a listed row.** `entity_kind` answered
   `readonly` for a row whose `content_doctype` is `File`, which is how §14.4's
   framework attachments were marked. No `_core` verb creates a node with that
   content type, so the case could not be built as a fixture. It is not
   asserted either way.
