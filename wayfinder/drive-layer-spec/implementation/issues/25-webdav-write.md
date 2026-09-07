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

Every box is implemented and covered by tests. None is ticked: 276 of the 302
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

31 files changed, 3325 insertions, 4198 deletions.

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

Lint over `suite/drive` leaves 2 errors and 4 unformatted files: `http/shims.py`,
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

- **276 of the 302 DAV cases have never been executed.** They import, collect,
  and lint clean. That is all that is proved. The four migrated suites were
  read assertion by assertion against production source by separate agents and
  no assertion was found that must fail, but reading is not running.
- **litmus has never been run on this branch.** Every method it needs is now on
  the wire and the ledger says so, but no entry was added on expectation. The
  ledger may only grow from a real run.
- ~~`_core.nodes.create_file` enqueues a preview render. This bench has no RQ
  worker and its short queue saturates, so the write suites may raise
  `QueueOverloaded` in `setUp` rather than fail on a DAV assertion.~~ Happened
  on gate run 3. It was a production defect, and it is fixed. See
  [Gate run 3](#gate-run-3-a-full-job-queue-discarded-the-upload).
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

### Gate run 1: the site quota defaults were text

`bench --site slides.localhost migrate` succeeded. Module 1
(`suite.drive.tests.test_webdav`) passed 92. Module 2
(`suite.drive.webdav.tests.test_pathmap`) errored in `setUpClass`, creating a
six-byte file: `Drive site quota must be a nonnegative integer`.

**Cause.** `Drive Disk Settings` is a Single, so every field lives in
`tabSingles.value`, a longtext column. Frappe casts a Single's `Int` and
`Check` fields back to numbers on load, but not its `Long Int` fields:
`cast_fieldtype` has no `Long Int` branch and neither does
`BaseDocument._fix_numeric_types`. `default_personal_quota` and `shared_quota`
are `Long Int`, so `effective_quota` read the installed default `0` as the
string `"0"` and `_nonnegative_bytes` refused it. The root's own
`quota_bytes` is `Long Int` on an ordinary table, where SQL returns an int, so
the override path was never affected.

The schema is right — `Int` is 32-bit and caps a quota at 2.1 GB — and the
fixtures are innocent: no suite writes these fields, so the value refused was
the one the install wrote. The fault was in production normalization, which
assumed a representation the framework does not deliver.

**Fix.** `_core.quota.site_quota_bytes` reads a byte quota that a Single stores
as text. A plain integer string is accepted; `"5GB"`, `"1.5"`, `"0x10"`,
`"1_000"`, a float, a bool and a negative are all still refused, so a malformed
site setting never reads as unlimited. An unset field is still 0, and 0 still
means unlimited. `_nonnegative_bytes` is unchanged: a string reaching `admit`,
`preflight` or a reservation is a caller bug and stays refused.

**Audit.** `Drive Disk Settings` is the only Single in the app with a `Long Int`
field. `preview_size` and `quota` are `Int`, which Frappe does cast.
`drive_webdav_max_upload_size` is site config read through `cint`. The doctype's
own `_validate_drive_quotas` had the same assumption, so
`frappe.get_doc("Drive Disk Settings").save()` threw on a reloaded doc; it now
normalizes through the same helper and stores the integer. The auto-generated
type block claimed `DF.Int` for both quotas and now says `DF.LongInt`.

| Commit | Change |
|---|---|
| `f94ce652b` | read the site quota defaults a Single stores as text |

**Rerun.** `suite.drive.webdav.tests.test_pathmap`, then modules 3 to 23 in
order. No migrate: no DocType JSON, patch, hook, or fixture changed.

**Coverage.** `suite.drive.tests.test_quota` gains 4 unit cases and a
`TestSiteDefaultQuota` integration class of 4. Module 19 of the gate now proves
the stored form end to end: a zero default admits bytes, a real default still
bounds a root with no override, a malformed default refuses the write, and
saving the settings normalizes both quotas.

**Checks run.** Site-free, in the worktree. No `bench`, `migrate`, `install`,
`restart`, `push`, or PR.

```
$ python3 -m compileall -q suite/drive
COMPILED OK

$ uvx ruff@0.12.3 check --select=I <the three changed files>   -> All checks passed!
$ uvx ruff@0.12.3 check <the three changed files>              -> All checks passed!
$ uvx ruff@0.12.3 format --check <the three changed files>     -> 3 files already formatted

$ site-free: test_webdav, test_architecture, test_conditional, test_ifheader,
  test_xmlutil, test_quota.TestQuotaContract
Ran 142 tests -- OK

$ the two new unit cases against the pre-fix quota.py -> 2 errors (red)
$ collection across every module in suite/drive/webdav/tests -> TOTAL 302, ERRORS []
```

Ticket 29 stays dormant: `git log bc461122a..HEAD --name-only -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` still returns nothing.

## Independent review

An independent reviewer read the ticket, §12, RFC 4918, and the whole diff
`bc461122a..7a47ff7d5`, then fixed what it found. Three agents audited the
production code, the migrated suites, and the dispatch wiring in parallel; the
reviewer decided every verdict against the specs, wrote the fixes and the
tests, and made the commits. The implementation's own notes were not taken on
trust. This section is the reviewer's record and does not replace the sections
above.

### The four findings the implementation left open

**1. The 404-vs-409 split on an unreadable intermediate — fixed.** The ticket
called the pair irreconcilable: §12.1 says unreadable is 404, RFC 4918 §9.7.1
says an absent parent is 409. It is reconcilable. §12.1's rule is about the
*target* a verb names. The parent of a create is not the target; it is state
the client asked about indirectly. RFC 4918 fixes that answer at 409 for PUT
(§9.7.1), MKCOL (§9.3.1), MOVE and COPY (§9.9.4), and LOCK (§9.10.6). Answering
409 for an unreadable parent is therefore a reading of §12.1, not a departure
from it, and it is the reading §12.1 exists to enforce: while the two answers
differed, the pair named every folder inside a caller's own root that had been
taken away from them. The message is identical too, or the body restores the
oracle the status code closed. A parent the caller can read but may not write
is unchanged at 403.

**2. PROPPATCH property-cap arithmetic — fixed.** The cap counted every
`DAV:set` in the request, not the ones that would really be stored. Windows
Explorer writes `Win32LastModifiedTime` on every save, so a client at the cap
was refused 507 for overwriting its own property while the stored count never
moved. `deadprops.existing_tags` now removes the tags already held.

**3. LOCK Depth infinity with no multistatus — fixed.** The citation in the
notes is wrong: the requirement is RFC 4918 §9.10.3, not §9.10.4. §9.10.3 says
"Either the entire hierarchy is locked or no resources are locked". §5.1's
nearest-wins lets a deeper grant lower the caller inside their own root, so
EDIT on the collection alone handed out a lock the next PUT would answer 403.
`_unlockable_member` now answers §9.10.3's 207: 403 on the member that refused,
424 on the Request-URI, and no lock row. Only a member holding a `Drive Grant`
of its own can differ from the collection, so an ordinary subtree costs one
indexed query.

**4. Unguarded `deadprops.copy_props` — no change needed.** `Drive DAV
Property.entity` and `Drive DAV Lock.entity` are already declared
`Link → Drive Node` in the committed JSON. `_dav_property_table_ready()` is
therefore always true on a migrated site, and the guard the note asked for
would never fire. Verified by reading the DocType JSON at HEAD, not by
inference.

### Defects the review found on its own

- **A caller with no Active Personal Root got a 500.** `/dav` resolves to no
  node and no parent for `Administrator`, whom `provision_personal_root` skips,
  and for anyone whose root was archived. `require(None)` raised AttributeError
  out of PUT and `segments[-1]` raised IndexError out of MKCOL. Reproduced at
  `7a47ff7d5` from a clean `git archive` extract. Both now answer 409 through
  the same guard as finding 1.
- **MOVE refused a `Depth` header on an ordinary file.** RFC 4918 §9.9.3 is
  written for collections. The check ran before the source was resolved, so
  `Depth: 0` on a file was 400 — a move the client is entitled to make. DELETE
  already scopes the same rule correctly (§9.6.1).
- **A second lock could be minted over a resource the caller already held.**
  The conflict list dropped any lock whose token the caller had submitted.
  §9.10.5: "It is illegal for a principal to request the same lock twice."
  `enforce` then demanded a token from every covering lock, so the holder could
  write with neither until one expired, and UNLOCK of either left the file
  locked.
- **A LOCK refresh ran on READ.** §12.1 gives LOCK on an existing node EDIT,
  and a refresh is that same LOCK. A holder whose grant had been lowered kept
  the write lock alive for as long as it kept asking, and `enforce` refuses
  every non-owner, so the node's own owner stayed locked out by a principal
  that could not write it.
- **A LOCK refresh honoured `Depth`.** RFC 4918 §9.10.2: "A server MUST ignore
  the Depth header on a LOCK refresh." The check ran before the body was read,
  so a client that stamps `Depth: 1` on everything lost the lock it was asking
  to keep.
- **LOCK skipped the If header's conditions.** RFC 4918 §10.4.1: the If header
  is not method-specific. LOCK cannot call `locks.enforce` — its own rule is
  §9.10.5's table, under which a second shared lock is legal where a write is
  423 — and it dropped the conditions along with it.
- **A stale `If-Unmodified-Since` overrode a matched `If-Match`.** RFC 7232 §6
  step 2 evaluates the date only "when If-Match is not present".
- **The test suites turned the site's WebDAV switch off for good.** Four suites
  set `Drive Disk Settings.webdav_enabled` to 1, then committed a hard-coded 0.
  On a site where an admin had WebDAV on, one gate run disabled the feature for
  every real client. `test_log` also leaked the Personal Root it committed and
  never called `super().setUp()`.
- **The README described content documents as read-only exports.** §12.2 hides
  them outright. The line stated the old server's behaviour.

### Coverage the review added

- a lock strictly below the collection a DELETE or MOVE names — the descendant
  direction of the subtree walk (`check_descendants`), which no case reached
  and which RFC 4918 §9.6.1 requires;
- `locks.parse_timeout_header` and `lock._parse_lockinfo`, both read straight
  off the wire, with every refusal branch. Site-free;
- the `Allow` header on MKCOL's 405, which RFC 7231 §6.5.5 makes mandatory and
  which `ff375deb0` added with nothing holding it.

The DAV suites went from 281 collected cases to 302.

### Recorded, not fixed

- **Chunked PUT never drives `StreamingBody`.** The cases substitute
  `context.BufferedBody`, so `_BoundedBody` is exercised but the streaming
  reader that production uses is not. It needs a live server, so litmus and the
  manual client checklist are the only real coverage for it.
- **Most refusals assert an exception class, not a mapped status.** The cases
  call handlers directly, so `errors.map_exception` is bypassed. `test_dispatch`
  covers the mapper itself, and `test_movecopy.assert_refused` maps explicitly,
  but the rest state the exception the handler raised.
- **`test_put_conditionals`' `If-Match` case is a tautology.** It builds the
  header from the ETag it just read.
- **UNLOCK does not evaluate the If header.** Its token comes from
  `Lock-Token`. §10.4 is general, but no client sends it and the litmus locks
  group does not test it. Left alone rather than risk the unlock path.
- **COPY and MOVE disagree on a case-only rename.** A COPY to a case variant of
  a live sibling cannot succeed anyway; the two answer with different statuses.
- **`drop_locks_under` leaves expired descendant rows.** `_locks_over_subtree`
  filters on `expires_at`, and `purge_expired_locks` reaps them lazily on every
  read, so they are never observable.
- **`File Blob` rows written by fixtures are never dropped.** Pre-existing, and
  the blobs dedupe on checksum.

### Review checks that were run

```
$ uvx ruff@0.12.3 check suite/drive/webdav/          -> All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/webdav/ -> 40 files already formatted
$ python -m compileall -q suite/drive/webdav          -> clean

$ per-commit: git archive <commit> suite/drive/webdav | compileall + ruff F821,F811,F401
  12 of 12 commits compile; no new undefined or duplicate name in any of them

$ site-free unit tests, whole app (PYTHONPATH=<worktree>, frappe.init, no connect)
  Ran 776 tests -- 0 failures, 5 errors
  The 5 errors are `RuntimeError: object is not bound` in
  suite.drive.tests.test_access and suite.drive.tests.test_content. They need a
  db handle. Reproduced identically from a `git archive 7a47ff7d5` extract, so
  they predate this review.

$ site-free WebDAV unit tests
  Ran 124 tests -- OK
  (8 test_conditional, 11 test_ifheader, 4 test_locks, 9 test_xmlutil,
   92 suite.drive.tests.test_webdav)

$ collection across every module in suite/drive/webdav/tests
test_auth 17   test_conditional 8    test_dispatch 13   test_ifheader 11
test_locks 43  test_log 7            test_mkcol_delete 20  test_movecopy 39
test_pathmap 20  test_properties 16  test_propfind 22   test_proppatch 19
test_put_get 49  test_settings 9     test_xmlutil 9
TOTAL 302, ERRORS []

$ uvx ruff@0.12.3 check suite/            -> Found 25 errors
$ uvx ruff@0.12.3 format --check suite/   -> 6 files would be reformatted
  None is in suite/drive/webdav and none is in a file this review touched.
  They are in mail, sheets, writer, and drive/http, and all predate the ticket.
```

Not run: bench, migrate, install, restart, litmus, push, PR. The site gate
below is unchanged and still has to run.

### Review commits

| Commit | Change |
|---|---|
| `e4dc29020` | stop the create verbs naming folders taken from the caller |
| `2385edca2` | stop MOVE refusing a Depth header on an ordinary file |
| `a9d8683de` | count only the properties a PROPPATCH would really add |
| `42da275e1` | refuse a second lock over a resource the caller already holds |
| `107ef15ee` | refuse a depth-infinity LOCK it cannot grant on every member |
| `37965a926` | make a LOCK refresh take the EDIT the lock itself took |
| `7e88dc45b` | ignore the Depth header on a LOCK refresh |
| `3f71f9c0a` | evaluate the If header's conditions on LOCK |
| `5c70a1b69` | stop a stale If-Unmodified-Since overriding a matched If-Match |
| `3e0ab785f` | put the site's WebDAV switch back instead of turning it off |
| `373f86756` | cover the lock paths and the 405 header nothing reached |
| `66ffb1e6d` | state that content documents are hidden, not read-only |

19 files changed, 648 insertions, 85 deletions.

Ticket 29 stays dormant after the review: `git log bc461122a..HEAD --name-only
-- suite/patches.txt suite/hooks.py 'suite/**/*.json' suite/drive/patches`
still returns nothing.

The acceptance boxes stay unticked. The site gate has not run.

### Gate run 2: a test quoted an already-quoted ETag

Modules 2 to 7 passed. Module 8
(`suite.drive.webdav.tests.test_locks`) ran 4 unit and 39 integration cases,
and exactly one errored:
`test_a_lock_request_evaluates_the_if_header_conditions`.

**Cause.** The test, not production. `properties.compute_etag` returns the
entity-tag already quoted — `"<checksum>"` — because that is the form
`getetag` publishes and the form a client writes back. The case read that
value and then quoted it a second time, building
`If: (["" <checksum> ""])`. The parser keeps a `[...]` token verbatim, so
`locks._conditional_gate` compared a doubled token to the single-quoted tag
`get_etag` returns, found no match, and answered 412. The gate was right; the
assertion was wrong.

**Fix.** The case interpolates the published tag between the brackets
unchanged. The negative half is untouched: `(["not-the-etag"])` is still a
well-formed tag the server cannot match, so the 412 that proves the gate runs
is unchanged. The positive half now also asserts the lock row exists, which is
what the docstring already claimed and nothing checked.

Neither `ifheader.parse_if_header` nor `IfHeader.evaluate` changed. Nothing in
the conditional gate changed.

**Audit.** An agent read every site in the repo that builds or compares an
`If` entity-tag, `If-Match`, `If-None-Match`, `ETag`, or `getetag`, and
classified each by whether the interpolated value is a raw checksum or an
already-quoted tag. One defect, the one above. Every other site is correct:
raw checksums are quoted once (`f'"{checksum}"'`), and `compute_etag` output
is used bare. No frontend code builds any of these headers.

| Commit | Change |
|---|---|
| `e17c24090` | quote the published ETag once in the LOCK If condition |

**Coverage.** `test_properties` gains one case,
`test_the_published_etag_is_an_if_header_entity_tag_verbatim`: the tag
`compute_etag` publishes parses back out of `([...])` equal to itself, and the
doubled form does not. It pins the contract the failing case broke, beside
`compute_etag` rather than beside one caller. DAV collection is now 303 cases
across 15 modules, no collection errors.

**Rerun.** `suite.drive.webdav.tests.test_locks`, then modules 9 to 23 in
order. Module 4 (`test_properties`) carries the new case and can be rerun with
it or left to the next full pass. No migrate: no DocType JSON, patch, hook, or
fixture changed.

**Checks run.** Site-free, in the worktree. No `bench`, `migrate`, `install`,
`restart`, `push`, or PR.

```
$ python3 -m compileall -q suite/drive
COMPILED
$ uvx ruff@0.12.3 check suite/drive/webdav/
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/webdav/
40 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture \
    suite.drive.webdav.tests.test_ifheader
Ran 110 tests in 1.575s
OK

$ ... collection across every module in suite/drive/webdav/tests
TOTAL 303, ERRORS []
```

Ticket 29 stays dormant: `git diff --name-only bc461122a..HEAD -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` is still empty.

### Gate run 3: a full job queue discarded the upload

Module 8 (`suite.drive.webdav.tests.test_locks`) passed its 4 unit cases and
errored all 39 integration cases in `setUp`. The trace named `PermissionError`
raised while Frappe built the `QueueOverloaded` message, so it read as an
access fault rather than a queue depth.

**Cause.** Production, not the test. `previews.enqueue_render` is the last
statement inside the savepoint in `_core.nodes.create_file` (`:1126`) and
`_core.nodes.update` (`:1271`), and both savepoints re-raise. `frappe.enqueue`
measures the queue depth inline in `_check_queue_size` and raises
`QueueOverloaded` there, before it registers the post-commit callback. A site
whose short queue is at its cap therefore refused every Drive upload and every
replace, and rolled back bytes the caller had already stored and already paid
quota for, to save a thumbnail. `_core.versions.restore_version` (`:307`) and
`previews.sweep_missing`'s own loop (`:233`) had the same exposure through the
same entry point.

The bench queue is at its 550 cap because it runs no RQ worker and every test
run leaves its jobs behind. That is the environment. The refusal reaching the
caller is the defect.

**Fix.** Queuing is best-effort. §9.2 already names the daily gap sweep as the
repair for a failed render, so a node that misses its render gets a preview
within a day; an upload that is refused is gone. `enqueue_render` now logs the
miss to the Error Log and returns, and the byte write stands. The guard sits in
`enqueue_render` alone, which §9.2 names as the one render entry point, so it
covers all four writers. The idiom is the one
`suite/sheets/versioning/save.py:74` and `suite/drive/jobs.py:20` already use.

Nothing else changed. `render`, `push_preview`, `sweep_missing`, the enqueue
arguments, and the `Drive Node Preview` schema are untouched, so ticket 13's
contract still holds and its `test_enqueue_uses_the_post_commit_short_queue`
still passes unchanged.

**Fixtures.** `webdav/tests/utils.file_node` builds every fixture file through
`create_file`. The DAV suites arrange about 140 files in `setUp` alone and
commit, so each run left that many `previews.render` jobs on the site's short
queue: a suite changing the site it measures, and the reason the cap was
reached. The fixture now suppresses the enqueue, the same way
`test_previews._file` and the three `test_drive_adoption` suites already do. It
still writes through `create_file`, so no row and no node field changes and no
DAV assertion reads a different shape. A verb handler under test still enqueues
for real.

**Audit.** An agent inventoried every shared Drive test helper that creates a
file node and every `frappe.enqueue` site under `suite/`.

| Creator | Reaches `create_file` | Suppressed before |
|---|---|---|
| `webdav/tests/utils.py:file_node` | yes | no, now yes |
| `webdav/tests/utils.py:raw_child_node` | no, raw insert | n/a |
| `drive/tests/fixtures.py` | no creators, drops only | n/a |
| `suite/tests/utils.py:ensure_user` | root only | n/a |
| `slides/tests/utils.py:make_private_image` | no Drive Node | n/a |

Per-suite creators with the same shape, all now covered by the production fix
and left as they are: `drive/tests/test_nodes.py:_file`,
`test_versions.py:_file`, 21 `create_file` sites in `test_upload.py`,
`api/tests/test_files.py:make_file`, `api/tests/test_list.py:make_file`,
`http/tests/test_dispatch.py:make_file`. Already suppressed:
`test_previews.py:_file`, `test_content.py:_media`, and the Writer, Slides, and
Sheets adoption suites. No test module anywhere deletes a queued job; cleanup
is DB rows only.

Of the ~30 `frappe.enqueue` sites under `suite/`, none was guarded and no
`QueueOverloaded` reference existed. Only Drive's render entry point is guarded
here; the rest are outside this ticket.

| Commit | Change |
|---|---|
| `d2e0cab50` | let a full job queue cost the preview, not the upload |
| `8f4639861` | stop the DAV file fixture queuing a render per case |

**Coverage.** Three cases, each failing under a mutation of the line it covers.

- `test_previews.TestPreviewContract.test_a_refused_queue_is_logged_and_not_raised`
  — a `QueueOverloaded` from `frappe.enqueue` is logged, not raised.
- `test_previews.TestPreviews.test_a_refused_queue_still_stores_the_file_and_its_bytes`
  — `create_file` still writes the node and its head blob when the queue
  refuses.
- `test_webdav.TestDavFixtureQueueHygiene.test_the_file_fixture_builds_its_node_without_queuing_a_render`
  — the DAV fixture reaches no queue, and the suppression does not outlive it.

**Rerun.** `suite.drive.webdav.tests.test_locks`, then modules 9 to 23 in
order. Modules 17 to 23 now also carry the preview guard, so the regression
half of the gate covers it. Module 4 (`test_properties`) still carries gate run
2's new case. Add `suite.drive.tests.test_previews` after module 23: it owns
the changed function and its 27 cases are the ticket 13 contract. No migrate:
no DocType JSON, patch, hook, or fixture changed.

**Checks run.** Site-free, in the worktree. No `bench`, `migrate`, `install`,
`restart`, queue deletion, `push`, or PR. No external Redis state was touched.

```
$ python3 -m compileall -q suite/drive
COMPILED
$ uvx ruff@0.12.3 check <the four changed files>
All checks passed!
$ uvx ruff@0.12.3 format --check <the four changed files>
4 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture
Ran 100 tests in 1.356s
OK

$ ... TestPreviewContract, the two enqueue cases
Ran 2 tests in 0.004s
OK

$ ... collection across every module in suite/drive/webdav/tests
TOTAL 303, ERRORS []
```

The 39 `test_locks` integration cases are still unrun. Site-free checks cannot
run them.

Ticket 29 stays dormant: `git diff --name-only bc461122a..HEAD -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` is still empty.

### Gate run 4: a full job queue discarded the user

Module 9 (`suite.drive.webdav.tests.test_proppatch`) errored in `setUpClass`,
before any DAV case ran. `ensure_user` could not insert
`webdav-proppatch-owner`.

**Cause.** Production, not the test. The `User` `after_insert` hook reaches
`install.after_user_insert` (`:33`), which calls the legacy
`utils.get_user_folder` (`:301`). That grants the new user their own home
folder through `utils.grant_owner_access` (`:371`), which inserts a `Drive
Permission`. `DrivePermission.after_insert` (`:12`) then calls
`frappe.enqueue(notify_share)`.

`frappe.enqueue` measures the queue depth in `_check_queue_size`
(`background_jobs.py:175`) and raises `QueueOverloaded` there, at
`background_jobs.py:751`. That is before the `enqueue_after_commit` callback is
registered (`:216`), so the flag holds nothing back. The hook runs inside the
insert of the grant row, so the refusal rolled the grant back — and with it the
whole user. On a site whose short queue is at its cap, no user could be created
at all. Same shape as gate run 3's upload defect, one blast radius up.

The queue is at 550 because the bench runs no RQ worker. That is the
environment. The refusal reaching the caller is the defect.

**Fix.** Queuing is best-effort. The miss goes to the Error Log and the grant
stands. Nothing requires it to be strict:

- §9.5 is the whole notification contract and states no delivery guarantee.
- Ticket 23 (`:486`) already records "a new share sends no email" as an
  accepted regression, and §14 (`drive-layer-spec.md:3762`) drops the legacy
  inbox at Build.
- `notify_share` is already best-effort inside its own body: a failed
  notification row is logged and swallowed (`notifications.py:107`) and a
  failed email is swallowed outright (`:136`). Only the enqueue that scheduled
  it was strict.

The asymmetry, stated plainly: unlike a preview, a dropped share notice is
never repaired. There is no §9.2 counterpart for §9.5. The compensation is that
the grant is durable and the recipient has the access either way; only the
announcement is lost.

The enqueue arguments, the queue, the `fdocperm_` dedup job id, the
install/migrate/patch skip and the `$GENERAL`/`$GROUP:` principal filter are
unchanged, so the one existing test on the call shape still passes unchanged.

**The test helper stays as it is.** `suite/tests/utils.ensure_user` was the
caller, not the fault. It reaches the enqueue through production hooks that
33 test modules depend on for personal-root and home-folder provisioning
(`drive/tests/fixtures.py:11`, `webdav/tests/utils.py:199`). Suppressing the
enqueue inside it would hide the production path from every one of them and
would not have made the refusal correct anywhere else. Gate run 3's fixture
change had a different reason: `file_node` queued about 140 render jobs per
run and so filled the cap it then measured. `ensure_user` queues one job per
test user, and once the guard is in the jobs are refused and logged rather than
queued at all.

**Audit.** An agent inventoried every `frappe.enqueue` reachable from the shared
setup of the 23 gate modules.

| Site | Reached from shared setup | State |
|---|---|---|
| `drive_permission.py:20` (`notify_share`) | yes, every `ensure_user` | unguarded, now guarded |
| `_core/previews.py:105` (`render`) | yes, via `file_node` | guarded in gate run 3, and suppressed in the fixture |
| `frappe` `user.py:332` (`create_contact`) | yes, `User.on_update` | safe: `now=frappe.in_test` short-circuits before the depth check |
| `utils/files.py:80,88` (`upload_thumbnail`) | no, legacy `upload_file` only | safe: passes `now=True` |
| `api/files.py:380` (`build_download_archive`) | no, API only | out of scope |
| `patches/remove_teams.py:42` | no, patch only | out of scope |
| `suite/utils/__init__.py:139` (`enqueue_job`) | no, mail only | out of scope |

`provision_personal_root` inserts a `Drive Grant`, not a `Drive Permission`, and
that controller has no `after_insert`. `create_user_settings`, `put_blob`,
`enable_user_webdav`, `set_global_webdav` and all of `drive/tests/fixtures.py`
reach no queue.

So `drive_permission.py:20` was the only unguarded enqueue any gate module's
setup could reach. The remaining ~30 `frappe.enqueue` sites under `suite/` stay
outside this ticket, as gate run 3 recorded.

| Commit | Change |
|---|---|
| `855de7eb4` | let a full job queue cost the share notice, not the grant |

**Coverage.** Three cases in
`suite.drive.doctype.drive_permission.test_drive_permission`.

- `UnitTestDrivePermission.test_a_refused_queue_is_logged_and_not_raised` — a
  `QueueOverloaded` from `frappe.enqueue` is logged, not raised.
- `IntegrationTestDrivePermission.test_a_refused_queue_still_writes_an_ordinary_share`
  — the grant row survives a refused queue.
- `IntegrationTestDrivePermission.test_a_refused_queue_still_creates_the_user_and_their_home_folder`
  — the case that pins this gate stop: `ensure_user` still creates the user,
  their `Drive Settings.user_folder` and its owner grant.

Both integration cases inject the refusal at
`frappe.utils.background_jobs._check_queue_size`, where production raises it,
rather than at `frappe.enqueue`. That keeps `create_contact`'s `now=True`
short-circuit intact, so the harness refuses exactly what a full queue refuses.

**Rerun.** `suite.drive.webdav.tests.test_proppatch`, then modules 10 to 23 in
order. Then `suite.drive.tests.test_previews` (gate run 3) and
`suite.drive.doctype.drive_permission.test_drive_permission`, which is not in
the numbered list and carries this run's three cases. Module 4
(`test_properties`) still carries gate run 2's case. No migrate: no DocType
JSON, patch, hook, or fixture changed.

**Checks run.** Site-free, in the worktree. No `bench`, `migrate`, `install`,
`restart`, queue deletion, `push`, or PR. No external Redis state was touched.
The 550 queued jobs were left alone.

```
$ python3 -m compileall -q suite/drive/doctype/drive_permission/
COMPILED
$ uvx ruff@0.12.3 check suite/drive/doctype/drive_permission/
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/doctype/drive_permission/
3 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.tests.test_architecture
Ran 7 tests in 1.218s
OK

$ ... frappe.init, no connect: DrivePermission.after_insert on a stub
refused queue: swallowed and logged -> Drive: could not queue a share notification
healthy queue: unchanged call shape

$ ... the same stub against `git show HEAD:...drive_permission.py`
pre-fix source raised: QueueOverloaded
```

The three new cases and the 39 `test_locks` integration cases are still unrun:
`DrivePermission(...)` loads its meta from the database, so this module needs a
site. Site-free checks cannot run it.

Ticket 29 stays dormant: `git diff --name-only bc461122a..HEAD -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` is still empty.

### Gate run 5: a full job queue discarded the litmus user

All 23 modules passed, and so did the two regression suites the earlier gate
stops added: `suite.drive.tests.test_previews` and
`suite.drive.doctype.drive_permission.test_drive_permission`. The module gate is
green.

litmus is not. `run_litmus.sh` exits inside `prepare`, before it prints the URL
it points litmus at. `bench --site slides.localhost execute
suite.drive.webdav.tests.litmus_setup.prepare` cannot insert
`litmus@example.com`.

**Cause.** The harness, not production. `User.on_update`
(`frappe/core/doctype/user/user.py:330`) computes
`now = frappe.in_test or frappe.flags.in_install` and enqueues `create_contact`
with it (`:332`). `frappe.enqueue` short-circuits on `now` at
`background_jobs.py:162` and calls the method inline, so under the test runner
the contact is written without a queue ever being measured. That is why every
one of the 23 gate modules provisions users on a site at its cap.

`bench execute` sets neither flag. It calls `frappe.init` and `frappe.connect`
and nothing else (`frappe/commands/execute.py:12`), so `frappe.in_test` keeps
its module default of `False` (`frappe/__init__.py:223`). `frappe.enqueue`
therefore reaches `_check_queue_size` (`background_jobs.py:175`) and raises
`QueueOverloaded` at `:748`, before it registers the `enqueue_after_commit`
callback at `:216`. Same shape as gate runs 3 and 4: the flag holds the refusal
back from nothing. The refusal escaped the `User` insert, the user rolled back,
and prepare died.

Gate run 4's audit recorded this enqueue as "safe: `now=frappe.in_test`
short-circuits before the depth check". That reading was correct for the setup
of the 23 modules, which is all it looked at. It is wrong for the one entry
point that runs outside the test runner.

**Fix.** `litmus_setup.inline_user_jobs` sets `frappe.flags.in_install` for the
`User` insert statement alone and puts back what the flag held, in a `finally`,
so a raising insert restores it too. Inside the block the controller takes the
branch the test runner takes: `create_contact` runs inline and no queue is
measured.

No Frappe file is touched and no enqueue failure is swallowed. The rest of
`prepare` runs on the site's own flags, so the Personal Root, the node tree, the
grants, the password and the per-user opt-in are written the way production
writes them, and the compliance run measures the real DAV surface.

**Why a flag here and a `try`/`except` in gate runs 3 and 4.** Those two were
production paths, where the caller's write had to survive a refused queue and
the queued work is a courtesy: §9.2 repairs a missed preview, and §9.5 promises
no delivery for a share notice. This one is a test harness, and the fix must not
change what production does. A harness may take the branch the test runner
already takes. It may not teach production to ignore a refusal. Setting
`frappe.in_test` instead would reach far past this one insert, and swallowing
the enqueue would leave the user with no `Contact` and no sweep to repair it.

**The flag's one effect on the rows prepare writes** is
`DrivePermission.after_insert` (`drive_permission.py:15`), which skips the share
notice for the home folder `get_user_folder` grants. The grantee is the
throwaway CI user itself. It is the only `in_install` branch anywhere under
`suite/`.

**The flag's one effect outside this process, found by the audit and fixed.**
`frappe.get_meta` caches every `Meta` it builds into `frappe.client_cache`
(`frappe/model/meta.py:84-91`), which is redis-backed and shared with the web
workers, and `Meta.set_custom_permissions` returns early under `in_install`
(`meta.py:650`). A doctype first met inside the block would have been published
to the served site with its `Custom DocPerm` rows missing, and litmus would have
run against it. The block therefore drops the cached metas in the same `finally`
that restores the flag. They rebuild on first use with the site's own
permissions.

`slides.localhost` holds no `Custom DocPerm` row, so on this site the eviction
changes nothing. It is a property of the flag, not of one site, and the harness
is checked in for every site that runs the gate.

**Audit of prepare and teardown.** An agent traced every call that can produce a
background job or measure the queue, on both call graphs, under `bench execute`.

| Site | Reached | State |
|---|---|---|
| `frappe` `user.py:332` (`create_contact`) | yes, the `User` insert | unguarded, now inline under the flag |
| `drive_permission.py:31` (`notify_share`) | yes, via `get_user_folder` | guarded in gate run 4, and skipped under the flag |
| `frappe` `webhook/__init__.py:113` (`enqueue_webhook`) | only if a `Webhook` doc matches; the site has 0 rows | `now=frappe.in_test`, fires from `db.after_commit`, unguarded |
| `frappe` `share.py:289` (`make_notification_logs`) | no, `notify_assignment` returns at `share.py:267` | n/a |
| `utils/files.py:80,92` (`upload_thumbnail`) | no, `upload_file` only, and `get_user_folder` calls `create_folder` | safe anyway: passes `now=True` |
| `_core/previews.py:105` (`render`) | no, the file paths only | guarded in gate run 3 |
| `api/files.py:380` (`build_download_archive`) | no, API only | out of scope |
| `api/notifications.py:125` (`sendmail`) | no, inside the `notify_share` job | out of scope |
| `frappe` `user.py:591` (`send_login_mail`) | no, `send_welcome_email: 0` skips it | n/a |

`update_password`, `provision_personal_root`, `enable_user_webdav`,
`frappe.db.set_single_value` and `clear_document_cache` reach no queue.
`suite/hooks.py:326` registers one `before_insert`, one `after_insert` and four
`on_update` handlers for `User`; none enqueues, and the four mail handlers all
return at their first `doc.flags.in_insert` check. `Contact` and
`frappe/utils/password.py` contain no `frappe.enqueue` and no `frappe.sendmail`.

Ordering note: the guarded `Drive Permission` enqueue runs in `after_insert`
(`document.py:756`), before `on_update` (`:764`). On a full queue it is logged
and swallowed first, and `create_contact` is what actually aborted the insert.

The webhook row is the one conditional site left. It fires from
`frappe.db.after_commit`, so `prepare`'s own commit would carry it, and
`enable_user_webdav` writes outside the flag block. `frappe.db.count("Webhook")`
on `slides.localhost` is 0, so nothing registers a callback and nothing is
queued. It is recorded, not guarded: guarding a framework hook the site does not
use would be production surface this ticket has no reason to add.

`teardown` needs no flag and got none. `drop_personal_root` is `db.delete` only
(`tests/fixtures.py:11`), and `provision_personal_root` writes a `Drive Root`
and one folder node, whose controllers have `validate` and `before_insert` only.
Only the file paths call `previews.enqueue_render`. Teardown therefore behaves
the same on a full queue as on an empty one, which is what the `EXIT` trap in
`run_litmus.sh` depends on.

**Coverage.** Seven site-free cases in
`suite.drive.tests.test_webdav.TestLitmusHarness`, each red under a mutation of
the line it covers.

- `test_the_block_makes_the_user_controller_run_its_job_inline` — with
  `frappe.in_test` patched false, the expression `user.py:330` computes is false
  outside the block and true inside it.
- `test_the_flag_is_put_back_to_what_it_held` — unset, false and true are each
  restored, not overwritten with a hard-coded false.
- `test_the_flag_is_put_back_when_the_block_raises` — a `QueueOverloaded` out of
  the block propagates and the flag is restored.
- `test_prepare_inserts_the_user_inside_the_isolation` — the insert sees the
  flag set, `provision_personal_root` does not, and `prepare` returns the DAV
  URL.
- `test_prepare_puts_the_flag_back_when_the_insert_raises` — a refused insert
  propagates out of `prepare` and leaves the flag as it found it.
- `test_the_block_drops_the_metas_it_may_have_poisoned` — nothing is evicted
  inside the block and the metas are dropped once on the way out.
- `test_the_metas_are_dropped_when_the_block_raises` — the eviction is in the
  same `finally` as the restore.

The class patches the real `clear_meta_cache` out, so no unit case writes the
shared redis cache.

**Rerun.** No module needs rerunning. The 23-module gate and the two regression
suites are green, and these two commits change no production file. Serve the
site and run litmus:

```
bench --site slides.localhost serve --port 8010     # in another shell
suite/drive/webdav/tests/run_litmus.sh slides.localhost
```

`prepare` returns `http://slides.localhost:8010/dav/`: both
`sites/common_site_config.json` and the site config carry `webserver_port` 8010.
All five groups (http, basic, copymove, props, locks) must be attempted. Ledger
what really fails; add nothing on expectation.

No migrate: no DocType JSON, patch, hook, or fixture changed.

**Config restoration.** None is owed. `site_config.json` and
`common_site_config.json` were read and not written. `Drive Disk Settings`, the
`Custom DocPerm` table and the job queue were read and not written. The 550
queued jobs were left where they were, and `litmus@example.com` still does not
exist on the site.

**Recorded, not fixed.** `run_litmus.sh`'s `EXIT` trap runs `bench ... teardown`
and `rm -f "$OUTPUT"` as one `;`-joined command under `set -e`, so a teardown
that fails skips the temp-file removal. Teardown cannot fail on queue depth any
more, and the file is one `mktemp` in `/tmp`.

**Checks run.** Site-free, in the worktree, plus three read-only `SELECT`s
against the site. No `bench`, `migrate`, `install`, `restart`, `serve`, litmus,
queue deletion, `push`, or PR. No external Redis state was touched and nothing
was written to the database.

```
$ python3 -m compileall -q <the two changed files>
COMPILED
$ uvx ruff@0.12.3 check <the two changed files>
All checks passed!
$ uvx ruff@0.12.3 format --check <the two changed files>
2 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture \
    suite.drive.webdav.tests.test_conditional \
    suite.drive.webdav.tests.test_ifheader suite.drive.webdav.tests.test_xmlutil
Ran 135 tests in 1.226s
OK

$ ... TestLitmusHarness against `git show fc7cde2b7~1:...litmus_setup.py`
Ran 5 tests -- FAILED (failures=1, errors=5)
$ ... with the `finally` mutated away
Ran 5 tests -- FAILED (failures=2)
$ ... with `previous` mutated to a hard-coded false
Ran 5 tests -- FAILED (failures=2)
$ ... with `clear_meta_cache()` mutated away
Ran 7 tests -- FAILED (failures=2)
$ ... at HEAD
Ran 7 tests -- OK

$ ... frappe.init, no connect: frappe.enqueue with user.py:332's own arguments,
  _check_queue_size patched to raise as a full queue does
bench execute, flag unset : now = None -> QueueOverloaded
bench execute, inside block: now = True -> no raise, frappe.call ran inline
flag after block: None

$ ... read-only against slides.localhost
Webhook rows: 0
Custom DocPerm rows: 0
litmus user exists: False

$ ... collection across every module in suite/drive/webdav/tests
TOTAL 303, ERRORS []
```

litmus itself is still unrun. It needs the served site.

| Commit | Change |
|---|---|
| `fc7cde2b7` | let the litmus harness provision its user on a full queue |
| `58bc9e7f0` | stop the litmus flag publishing a meta with no custom permissions |

Ticket 29 stays dormant: `git diff --name-only bc461122a..HEAD -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` is still empty.

### Gate run 6: an orphan root row, and a runner that could not tell

The 23 modules and the two regression suites are green. litmus reached the
endpoint for the first time. All five groups then stopped in `begin`:

```
Could not create new collection `/dav/litmus/' for tests: 409 CONFLICT
```

`sites/slides.localhost/logs/suite.drive.webdav.log:186-200` holds the same
triple five times, between 07:19:54,082 and 07:19:54,375:

```
DELETE /dav/litmus/ -> 401  client="litmus/0.13 neon/0.33.0"  note="Authentication required."
DELETE /dav/litmus/ -> 404  user=litmus@example.com           note="Resource not found."
MKCOL  /dav/litmus/ -> 409  user=litmus@example.com           note="Intermediate collections do not exist."
```

litmus creates that one collection below the URL it is given, in every group's
`begin`, before a single case. A 409 there stops the group.

The runner's only complaint was:

```
STALE LEDGER LINE (now passes): basic:delete_fragment:WARNING
```

That report is false. `delete_fragment` never ran.

**Two defects, both in the harness. Production is correct.**

#### 1. `prepare` handed litmus a namespace with no usable mount

The 409 note is `pathmap.MISSING_PARENT`. `structure.handle_mkcol` answers it
when the caller's Personal Root does not resolve, or when §12.1's UPLOAD does
not hold on it.

`provision_personal_root` (`_core/roots.py:65-72`) returns as soon as
`personal_root_for` finds a row. That lookup is a `db.get_value` on
kind/state/user (`:53-57`). It never calls `validate_root_pair` and never reads
`tabDrive Grant`. A `Drive Root` row whose `Drive Node` is gone therefore
survives every provision call untouched, and `prepare` printed the DAV URL
anyway. It proved nothing before it printed.

Reproduced on the live site, in a transaction that was rolled back. The node
half of `litmus@example.com`'s pair was deleted and the root row left:

```
personal_root_for            : skt9hfsrv5
missing_intermediate         : True   parent: None
require_create_parent        : Conflict -> Intermediate collections do not exist.
provision_personal_root      : skt9hfsrv5   (returns the same broken row)
mount_refusal                : the Personal Root pair skt9hfsrv5 is not valid:
                               Drive root node skt9hfsrv5 was not found
mount_refusal after ensure_mount : None
```

The refusal text is the gate's own, word for word.

**What the artifacts prove, and what they do not.** They prove `prepare`
reached its commit: the served worker authenticated `litmus@example.com`, read
`Drive Settings.webdav_enabled` and the `Drive Disk Settings` toggle, and
refused only on the root. All three were written by the same `prepare`
transaction, so the worker was not reading a stale snapshot. They prove both
provision calls returned early, because a `create_root` that ran would have
written a node, a root and an anchor grant, and `create_root` re-raises rather
than swallowing (`roots.py:45-47`).

They do not prove where the orphan row came from. `bench.log:1226-1227` shows
`prepare` at 07:19:52,983 and `teardown` at 07:19:54,489, and `teardown` drops
the whole pair, so the pre-teardown row was deleted before it could be read.
The binlog and the general log are off, and no traceback was written. The three
`prepare` attempts at 07:04:40, 07:05:08 and 07:05:26 rolled back whole. Their
only surviving trace is three `Error Log` rows, which are MyISAM and outlive a
rollback. **The provenance of the row is unverified.** The mechanism from the
row to the 409 is verified, above.

**Fix.** `litmus_setup.mount_refusal` reads the mount back the way the served
site reads it: the root row, `validate_root_pair`, what `/dav/` resolves to,
and UPLOAD on it. It asks with the litmus user's own principals, because `bench
execute` runs as Administrator and `require` answers MANAGE to an admin on any
node, so the caller's identity would pass on a mount litmus cannot use.

`ensure_mount` replaces a root that will not serve. The litmus user is a
throwaway and the root is the mount, so rebuilding it is the whole repair, the
same replacement `teardown` already performs.

`prepare` proves the mount after the commit, because the committed rows are
what the served site reads, and raises `LitmusFixtureError` instead of printing
a URL. Its own class, so a reader of the traceback can tell a harness refusal
from one the product made.

No production file changed. The gate that `handle_mkcol` applies is unchanged
and correct: replayed against the live site, a full dispatched
`MKCOL /dav/litmus/` on a sound mount answers 201.

#### 2. The runner could not tell a dead group from a clean one

`run_litmus.sh`'s stale-ledger loop split each ledger line on `:` into three
fields and read the third whole. The third field is
`WARNING werkzeug strips URI fragments ...`, reason prose included. It then
searched the transcript for that whole sentence, which no litmus line can hold.
**The one ledger entry was reported stale on every run**, including a run where
`delete_fragment` really warns.

The check also ruled on the absence of a non-pass line. "Ran and passed",
"never ran", "group aborted" and "litmus crashed" were one state. It ignored
the group name, so a tolerance ledgered for `http:init:FAIL` excused
`locks:init:FAIL`. Nothing read litmus's own abort message, which carries no
verdict token and matched neither `case` arm, so five dead groups added nothing
to the exit status.

**Fix.** The comparison moved to `litmus_verdict.sh`, because a recorded
transcript is all it needs: no served site and no litmus binary. It records
every verdict, `pass` included, keyed by group, with an anchored match on the
verdict field rather than any word on the line. A ledger line is stale only
when the named test ran and passed. A ledgered test with no verdict gets its
own message. The abort line, a group that never ran, and a group whose `begin`
did not pass each fail the run.

Also in the runner: the `EXIT` trap moved above `prepare`, so a `prepare` that
raises part-way no longer leaves the user, the password, the root and the
opt-in on the site with no teardown. It is a function body, because `set -e`
skips the rest of `;`-joined trap commands, which gate run 5 recorded and did
not fix. litmus's exit status is captured instead of discarded by `|| true`,
and a `prepare` that prints something other than a URL stops the run.

#### The ledger line stays

`basic:delete_fragment:WARNING` is not stale. The `basic` group stopped in
`begin`, so `delete_fragment` never ran and the run says nothing about it. The
runner now says so in those words. Removing it on the strength of an aborted
group would drop a real tolerance.

**Coverage.** 30 site-free cases in `suite.drive.tests.test_webdav`: 18 in
`TestLitmusHarness` and 12 in `TestLitmusVerdict`.

`TestLitmusHarness` adds 11 to gate run 5's seven.

- `test_a_sound_mount_is_not_refused` and the four refusal cases: no root, a
  pair that does not validate, a namespace that resolves to no parent, and a
  root the user cannot write into. Each names its own half.
- `test_the_mount_is_read_as_the_litmus_user_not_as_the_caller` pins the
  principals, the path and the role the check asks with.
- Three `ensure_mount` cases: a root that will not serve is replaced, a sound
  one is left alone, and a user with no root is provisioned without a drop.
- `test_prepare_refuses_to_print_a_url_for_a_mount_that_is_not_there` and
  `test_prepare_proves_the_mount_after_the_commit`.

`TestLitmusVerdict` drives `litmus_verdict.sh` with recorded transcripts,
including gate run 6's own, and asserts the exit status and the message. It
covers the abort report, a ledger that is not called stale by an abort, a group
that never started, an empty transcript, a ledgered WARNING that still warns, a
ledgered test that now passes, one that became a failure, an unledgered
failure, an unledgered WARNING alone, a tolerance that must not cross groups,
and two lines that look like verdicts and are not.

**Rerun.** No production file changed, so no module needs rerunning. Rerun the
site-free suite, then serve and run litmus:

```
cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture

bench --site slides.localhost serve --port 8010     # in another shell
suite/drive/webdav/tests/run_litmus.sh slides.localhost
```

All five groups must be attempted, and `begin` must pass in each. Ledger what
really fails; add nothing on expectation.

No migrate: no DocType JSON, patch, hook, or fixture changed.

**Config restoration.** None is owed. No site config, `Drive Disk Settings`
value, or queued job was written. Every live probe ran inside a transaction
that was rolled back, and each one checked afterwards that nothing persisted:
`litmus@example.com` still holds root `skt9hfsrv5`, its node row is present and
its anchor grant count is 1.

**Checks run.** Site-free in the worktree, plus read-only reads and rolled-back
probes against the site. No `bench`, `migrate`, `serve`, litmus, queue change,
`push`, or PR.

```
$ uvx ruff@0.12.3 check <the changed python files>
All checks passed!
$ uvx ruff@0.12.3 format --check <the changed python files>
2 files already formatted
$ bash -n && shellcheck run_litmus.sh litmus_verdict.sh
(no output)

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python -m unittest \
    suite.drive.tests.test_webdav suite.tests.test_architecture
Ran 130 tests in 1.311s
OK

$ ... TestLitmusHarness against `git show 3a685474b:...litmus_setup.py`
Ran 18 tests -- FAILED (errors=13)
$ ... with `mount_refusal` mutated to return None always
Ran 18 tests -- FAILED (failures=1, errors=4)

$ ... rolled back against slides.localhost: a fresh User inserted inside
  `inline_user_jobs()`
root after insert under in_install : mfrkbe6p3l
mount_refusal                     : None
PERSISTED USER AFTER ROLLBACK     : None

$ ... rolled back against slides.localhost: the orphan-row shape
(the block quoted above)
node row still there : True
anchor grants        : 1
```

litmus itself is still unrun on this fix. It needs the served site.

| Commit | Change |
|---|---|
| `7ac0f987e` | prove the litmus DAV mount before prepare prints its URL |
| `dcc91d422` | make the litmus runner rule on what actually ran |

Ticket 29 stays dormant: `git diff --name-only bc461122a..HEAD -- suite/patches.txt
suite/hooks.py 'suite/**/*.json' suite/drive/patches` is still empty.
