# 25 — Write and lock files over the same Drive workflows

**What to build:** Keep DAV PUT, MOVE, COPY, DELETE, and LOCK consistent with the web API.

**Blocked by:** [24 — Browse and download ordinary files over WebDAV](24-webdav-read.md)

**Status:** in-review, awaiting the site gate

**Owner:** Suite Drive WebDAV

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §12.1, §12.3–12.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] PUT spools once into private blob storage. Preflight Content-Length or bound the spool by remaining quota.
- [ ] Replace keeps one nonempty previous version. Remove duplicate staging, compensation, generation, and owner-lock mechanisms.
- [ ] MOVE/COPY/MKCOL/DELETE call shared workflows with the method-role table. Reject cross-root DAV moves.
- [ ] LOCK on an unmapped path creates an empty node under UPLOAD. Expired unused locks leave that node intact.
- [ ] Preserve lock ownership, overwrite checks, dead-property cloning, conditional headers, and client content times.
- [ ] Record the authenticated actor and User-Agent once. Hidden content documents remain inaccessible to write methods.

Every box is implemented and covered by tests. None is ticked: 255 of the 281
DAV cases have never run, and litmus has never run at all. See
[Residual risks](#residual-risks) and [Site gate that must run](#site-gate-that-must-run).

## Verification

Run existing DAV protocol tests plus litmus against /dav/ on the authorized bench. Include quota races, zero-byte LOCK replacement, and conditional writes.

## Completion evidence

Agents migrated the four parked suites and audited every assertion against
production; a separate agent reviewed the whole diff adversarially. The
orchestrator wrote the production change, fixed the defects both found, and
made the commits.

### Revisions

Base Suite `bc461122af2ec9cb9a7161ec1549a88b2da239c6` on
`implement/drive-25-webdav-write`, the commit that closed ticket 24. Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` on `forge/storage-v2`, read only and
unchanged.

| Commit | Subject |
|---|---|
| `29b7a2f19` | write and lock over the Drive Node workflows |
| `1122f3aea` | only claim an mtime the PUT actually stored |
| `0715e840f` | put the write verbs back on the wire |
| `ff375deb0` | name what a refused URL does take on a 405 |
| `136c0aa9a` | unpark the DAV lock suite on node fixtures |
| `d63fc9f7b` | unpark the DAV move and copy suite on node fixtures |
| `900849fba` | delete the legacy File fixture the parked suites needed |
| `5cc2d3bf0` | close two refusal defects the migrated suites found |
| `a06a925ed` | retire the litmus notes the write gate wrote |
| `2769899a3` | honour the site's absolute PUT ceiling again |
| `584261842` | stop the WebDAV README naming a module that is gone |
| `72d1717de` | close the refusals a URL could be read through |

30 files changed, 3008 insertions, 4195 deletions.

### Changed behaviour

- **PUT** spools the body once into `frappe.storage.blob.put_blob`, which
  dedupes on the content checksum and arms its own rollback. The staging file,
  the generation key, the owner lock, the compensation queue, and the drift
  repair are gone: the node write and the blob reference commit or roll back
  together. `put.py` fell from 1200 lines to 230.
- Quota is preflighted from `Content-Length` and the same figure bounds the
  spool when no length is declared (§7.3). The site's
  `drive_webdav_max_upload_size` is a second, separate ceiling and answers 413
  rather than 507.
- A replace writes at the same node, so the URL, the id, and the grants
  survive. `_core.nodes` keeps one nonempty previous version (§8.5); an empty
  head is never versioned.
- The PUT response ETag is the blob's full checksum, quoted, the same value
  `getetag` and GET publish. The legacy `sha256-`-prefixed 32-character form
  could never match an `If-Match` built from it.
- `X-OC-Mtime: accepted` is echoed only when a time was really stamped. An
  out-of-range epoch is dropped and not claimed.
- **MKCOL, DELETE, MOVE, COPY** are one call each into a §8 workflow with
  §12.1's role in front. Collision, depth, cycle, and quota belong to the
  workflow and are enforced under its row lock. DELETE trashes; the bytes stay
  charged until a purge.
- MOVE overwrites by trashing the destination first, so the workflow's
  collision refusal never fires on a title the client is entitled to take. A
  move that changes both parent and title is two writes inside one savepoint,
  and a collision retries in the other order or leaves nothing behind.
- No DAV move or copy crosses roots. One mount makes it unreachable from a URL,
  and `resolve_destination` checks it rather than assuming it.
- COPY clones dead properties across the whole subtree the workflow walks
  (RFC 4918 §9.8.2), in one query for the tree.
- **LOCK** on an unmapped URL creates an empty file node under UPLOAD (RFC 4918
  §7.3's replacement for lock-null resources). No blob is stored, so nothing is
  charged, and an expired unused lock leaves the node intact.
- Lock ownership, the `If` header, the RFC 7232 conditionals, and the
  non-owner redaction of `lockdiscovery` are unchanged in behaviour and now key
  on node identity.
- **Every write verb is on the wire again.** `RELINKED_METHODS` is deleted, so
  `ALLOWED_METHODS` is the whole surface, OPTIONS advertises `DAV: 1, 2, 3`,
  and the admin allow-list narrows that surface without being able to widen it.
- A resource-level 405 carries `Allow` (RFC 7231 §6.5.5). Without it Windows
  retries the same verb.
- Every DAV write records the authenticated actor and the User-Agent once.
  `dispatch` binds the client before any handler runs; `_core.nodes` stamps it
  into `Drive Activity.client`.
- `perms.py` is deleted, `webdav/__init__.py:RELINKED_METHODS` is deleted, and
  `pathmap.ResolvedPath.entity` is deleted. Nothing in the adapter carries a
  pre-relink name any more.
- Auth, the per-user opt-in, the Personal Root namespace, the hiding of content
  documents, and the log settings are unchanged.

### Commands and real results

All site-free, in the worktree. No `bench`, `migrate`, `install`, `restart`, or
`push` was run, and `slides.localhost` was not touched.

```
$ python3 -m compileall -q suite/drive
COMPILED

$ uvx ruff@0.12.3 check suite/drive/webdav/
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/webdav/
40 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture
Ran 99 tests in 1.542s
OK

$ ... collection across every module in suite/drive/webdav/tests
test_auth 17   test_conditional 7    test_dispatch 13   test_ifheader 11
test_locks 32  test_log 7            test_mkcol_delete 19  test_movecopy 37
test_pathmap 20  test_properties 16  test_propfind 22   test_proppatch 15
test_put_get 47  test_settings 9     test_xmlutil 9
TOTAL 281, ERRORS []

$ grep -rn 'unittest.skip' suite/drive/webdav/tests suite/drive/tests/test_webdav.py
(no matches)
```

Whole-app lint leaves 2 errors and 4 unformatted files: `http/shims.py`,
`patches/team_restructure.py`, `doctype/drive_grant/drive_grant.py`,
`http/tests/test_shims.py`, `tests/benchmark_views.py`. All predate this ticket
and none is touched by it.

### Defects found by the audits and fixed

1. **`X-OC-Mtime: accepted` was claimed for a value that was dropped.** An
   out-of-range epoch is discarded, and the header still told rclone the time
   had been stored, so the client never re-synced a time it can never read
   back. Fixed in `1122f3aea`.
2. **Resource-level 405s carried no `Allow`.** RFC 7231 §6.5.5 makes it
   mandatory. PUT at a collection and MKCOL on an existing resource both
   omitted it, and Windows retries the same verb. Fixed in `ff375deb0`.
3. **`_relocate`'s fallback was not covered by its own savepoint.** A move and
   rename refused in both orders left the source renamed where it stood: half
   of a request the client was told had failed. Fixed in `5cc2d3bf0`.
4. **`Overwrite: F` answered 412 ahead of the read gate,** in MOVE and in COPY.
   A destination the caller cannot see was confirmed by the 412 instead of
   answering 404 (§12.1). Fixed in `5cc2d3bf0`.
5. **`drive_webdav_max_upload_size` silently stopped working.** The pre-relink
   `put.py` took the lower of the quota bound and this documented site cap; the
   relinked one read only the quota. A chunked PUT into a root with no quota
   therefore had no bound at all and spooled until the client stopped sending.
   Fixed in `2769899a3`.
6. **PUT at an unreadable collection answered 405, before the read gate.**
   `pathmap` resolves without asking permission, so a folder the caller had
   been shut out of answered "cannot PUT to a collection" while a free name
   answered 201. The pair names every node taken away from a caller inside
   their own root. MKCOL's "already exists" 405 had the same shape. Both fixed
   in `72d1717de`.
7. **The site upload cap answered 507.** That status means an exhausted quota,
   and rclone abandons a whole sync on it; a server body limit is 413 (RFC 7231
   §6.5.11) and it skips one file. The two ceilings are now separate values
   with separate statuses. Fixed in `72d1717de`.
8. **A non-numeric `drive_webdav_max_upload_size` made every PUT a 500.**
   `int("5GB")` raised `ValueError` out of the ceiling read on every upload the
   site took. `cint` makes an unparsable cap no cap. Fixed in `72d1717de`.
9. **MOVE read no `Depth` header.** RFC 4918 §9.9.3 admits infinity only, so
   `Depth: 0` on a collection silently moved the whole subtree. DELETE had the
   same gap for collections (§9.6.1). COPY already checked. Fixed in
   `72d1717de`.
10. **`_dispatch` committed from the `else:` clause.** A commit that failed
    escaped both exception handlers and reached the client as framework HTML
    instead of a DAV response. Fixed in `72d1717de`.
11. **`_copy_dav_properties` ran per copied node,** costing a readiness check
    (two `exists` calls and a `get_meta`) plus a query for every node, on a
    table almost every site leaves empty. It now takes the whole source-to-copy
    map and reads once. Fixed in `72d1717de`.

Fixture defects fixed in the same commit: `drop_personal_root` left versions,
previews, locks, and dead properties dangling on the site, and ticket 25's
suites are the first to write them; `frappe.local.request` and
`frappe.local.drive_activity_client` outlived the case that set them, so one
dispatched test stamped its User-Agent on every activity row the rest of the
process wrote; three test classes read the admin method list without
establishing it; one left a user opted in; `test_dispatch` committed two users
and two roots it never dropped.

### Tests

The four parked suites are unparked and rebuilt on `Drive Node` fixtures. The
invalid Personal Root owner-deny fixtures ticket 24 called out are gone: §11.2
refuses a deny naming a Personal Root's own owner, so every refusal case now
grants `$GENERAL` on a folder below the mount, where §5.1's nearest-wins makes
the deeper row the answer while the mount itself is unchanged.

| Module | Cases | Was |
|---|---|---|
| `test_put_get` | 47 | 15 read-only, PUT parked |
| `test_movecopy` | 37 | parked |
| `test_locks` | 32 | parked |
| `test_mkcol_delete` | 19 | parked |
| `test_proppatch` | 15 | parked |
| `test_dispatch` | 13 | 11 |
| `test_settings` | 9 | 9 |

No `unittest.skip` remains anywhere in the DAV suites. `legacy_file_fixture` is
deleted.

### Decisions and deviations

- **The site upload cap is 413, the quota is 507.** The pre-relink code
  collapsed both into 507. Restoring that exactly would have kept a status that
  makes rclone abandon a whole sync because one file was oversized.
- **`deadprops.copy_props` keeps no `_dav_property_table_ready()` guard,**
  while `_core.nodes._copy_dav_properties` has one. `_core` runs on sites with
  no DAV at all: its purge cascade and its copy primitive are reached from the
  web UI. The adapter only ever runs under `/dav`. Guarding one adapter
  function would suggest the rest of the module is guarded, and it is not.
- **A DAV MOVE and rename is two writes, not one.** `_core.nodes.update`
  refuses a combined move and rename. Adding a combined form for one caller
  would put a second move rule beside the one every other caller uses.
- **COPY Depth 0 on a collection is a create.** §8.9's primitive has no
  members-excluded form. The handler creates an empty folder and clones the
  source's dead properties onto it, which is what RFC 4918 §9.8.3 describes.
- **The cross-root refusal is unreachable from a URL.** There is one mount. It
  is checked rather than assumed, and the test provokes it by stamping a second
  `root` column directly.

### Findings recorded, not fixed

- **404-vs-409 tells an unreadable intermediate from an absent one.**
  `PUT /dav/<denied folder>/x.txt` is 404 through the parent's read gate;
  `PUT /dav/<absent>/x.txt` is 409 per RFC 4918 §9.7.1. Each answer is right
  under its own rule and the pair is distinguishable. Making them agree would
  break one normative requirement to satisfy the other, inside the caller's own
  Personal Root.
- **`proppatch._validate` counts a `set` as an addition.** A client at the
  200-property cap gets a spurious 507 when overwriting a property it already
  owns. Pre-existing and unchanged by this ticket.
- **LOCK Depth infinity locks a whole subtree on EDIT of its root alone,** with
  no RFC 4918 §9.10.4 207 for members that could not be locked.
- **`propname` does not list the quota property names.** Carried from ticket
  24, unchanged.
- **`Drive Legacy Route.entity` is still declared `Link → File`.** Ticket 23's
  surface, carried from ticket 24.
- **`test_movecopy`'s `test_copy_refuses_a_title_the_workflow_would_deduplicate`
  leaves a node behind.** `node_core.copy` releases its savepoint before the
  handler refuses, and the case bypasses the dispatcher, which is what rolls
  the request back on the wire. The assertion is still correct; only the
  fixture is untidy, and the class rollback reaps it.

### Ticket 29 stays dormant

`git log bc461122a..HEAD --name-only -- suite/patches.txt suite/hooks.py
'suite/**/*.json' suite/drive/patches` returns nothing. No DocType JSON, patch,
hook, or migration file changed. The `require_options="Drive Node"` gate that
ticket 24 installed is untouched.

### Residual risks

- **255 of the 281 DAV cases have never been executed.** They import, collect,
  and lint clean. That is all that is proved. The four migrated suites were
  read assertion by assertion against production source by separate agents and
  no assertion was found that must fail, but reading is not running.
- **litmus has never been run on this branch.** Every method it needs is now on
  the wire and the ledger says so, but no entry was added on expectation. The
  ledger may only grow from a real run.
- `_core.nodes.create_file` enqueues a preview render. This bench has no RQ
  worker and its short queue saturates, so the write suites may raise
  `QueueOverloaded` in `setUp` rather than fail on a DAV assertion.
- Real title collation in `pathmap._child` needs MariaDB and is untested.
- The 413-vs-507 split is new behaviour for any site that had
  `drive_webdav_max_upload_size` set. A client that had learned to treat the
  refusal as quota exhaustion will now see 413.
- `test_dispatch` and `test_locks` commit their fixtures and drop them
  explicitly. A run killed part way leaves users and roots on the site.

### Site gate that must run

No DocType JSON changed, so the migrate is a no-op for this ticket. It runs
anyway, because the gate must start from a migrated site.

```
bench --site slides.localhost migrate

script -qec "bench --site slides.localhost run-tests --module <module>" /dev/null
```

One module per invocation, serialized, never in parallel, in this order:

1. `suite.drive.tests.test_webdav`
2. `suite.drive.webdav.tests.test_pathmap`
3. `suite.drive.webdav.tests.test_propfind`
4. `suite.drive.webdav.tests.test_properties`
5. `suite.drive.webdav.tests.test_put_get`
6. `suite.drive.webdav.tests.test_mkcol_delete`
7. `suite.drive.webdav.tests.test_movecopy`
8. `suite.drive.webdav.tests.test_locks`
9. `suite.drive.webdav.tests.test_proppatch`
10. `suite.drive.webdav.tests.test_dispatch`
11. `suite.drive.webdav.tests.test_settings`
12. `suite.drive.webdav.tests.test_auth`
13. `suite.drive.webdav.tests.test_log`
14. `suite.drive.webdav.tests.test_conditional`
15. `suite.drive.webdav.tests.test_ifheader`
16. `suite.drive.webdav.tests.test_xmlutil`
17. `suite.drive.tests.test_nodes`
18. `suite.drive.tests.test_access`
19. `suite.drive.tests.test_quota`
20. `suite.drive.tests.test_roots`
21. `suite.drive.tests.test_versions`
22. `suite.drive.http.tests.test_shims`
23. `suite.tests.test_architecture`

Modules 5 to 11 are this ticket's own verification and have never been
executed. Modules 17 to 23 are the regression check: the workflows the relink
calls, the quota and version engines PUT leans on, and ticket 23's
compatibility surface.

Then litmus, once the site is served:

```
bench --site slides.localhost serve --port 8010     # in another shell
suite/drive/webdav/tests/run_litmus.sh slides.localhost
```

All five groups (http, basic, copymove, props, locks) must be attempted.
Ledger what really fails; add nothing on expectation.

This ticket stays open until that gate runs.
