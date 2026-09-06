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
ticket.

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
```

The `api.tests.*` suites are the ones that will move: they exercise the legacy
names against `File` rows, and those names now answer about `Drive Node`. Their
failures are the real measure of how much of the old contract survived, and
they cannot be read without a database.

### Unresolved handoffs

1. **The site gate has not run.** Nothing in this ticket has touched a
   database. Every acceptance box waits on it.
2. **Build has not run.** Forwarders and Build ship in one release (plan stage
   4 precedes stage 6). Before Build there is no node for a legacy id, and a
   forwarder answers the workflow's `DriveNotFound`. That is the workflow
   answering, not a fabricated deny, but it means the legacy suites cannot pass
   on this branch alone.
3. **`suite/drive/api/tests/*` are not rewritten.** They test the legacy names
   against `File` rows. Rewriting them before the site gate has said which ones
   actually break would be guessing. Named as owed work, not as done.
4. **Ticket 29 dormancy is preserved.** `drive_content_types = []`, no hook
   activated, no `site_config` change.
5. **Destructive removal stays disabled.** Nothing in Cleanup's list was
   deleted. `legacy-caller-inventory.md` records what may go, and in what
   order.
