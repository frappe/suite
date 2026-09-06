# 24 — Browse and download ordinary files over WebDAV

**What to build:** Expose the caller’s Personal Root through existing DAV clients using the new permission engine.

**Blocked by:** [23 — Keep legacy callers working through the new Drive workflows](23-legacy-compatibility.md)

**Status:** in-progress

**Owner:** Suite Drive WebDAV

**Starting revision:** Suite `b5ad65db54d93ee7ba3b95d1f9e3593f312a2c13` on
`implement/drive-24-webdav-read`; Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` on `forge/storage-v2` (read only,
unchanged).

**Claimed files:** `suite/drive/webdav/` — `__init__.py`, `pathmap.py`,
`propfind.py`, `properties.py`, `get.py`, `context.py`, `locks.py`,
`dispatch.py`, `settings.py`, `errors.py`, and `tests/`;
`suite/drive/_core/nodes.py` (added `stream_content` and `blob_checksums`);
`suite/drive/doctype/drive_dav_lock/`; `suite/drive/doctype/drive_dav_property/`;
`suite/drive/tests/test_webdav.py`; and this ticket.

`suite/drive/webdav/perms.py` is claimed but kept. §12.5 lists it for deletion,
and its last readers are the write handlers this ticket gates off rather than
relinks. Ticket 25 deletes both together.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §12.1–12.2, §12.4–12.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

Every box below is built and covered by tests that run without a site. None has
been run against `slides.localhost`. The site gate at the end of this ticket is
what turns "implemented" into "passing".

- [x] Retarget path lookup, locks, and dead properties to Node identity. Keep existing auth, opt-in, method allow-list, and log settings.
- [x] Mount only the caller’s Personal Root. Add no shared, archived, or admin mount.
- [x] Use the batched folder role calculation, plus one lock and one property fetch for Depth 1.
- [x] Hide Writer, Slides, Sheets, and their child-media paths from listing and direct lookup. Return 404.
- [x] Keep ordinary uploaded office files visible according to access, regardless of filename extension.
- [x] Use authorized blob streaming with strong ETags, conditional requests, and ranges.
- [x] Report Personal Root usage and available quota. Omit available quota when unlimited, and never add link principals.

## Verification

Run DAV listing/read tests, direct hidden-path probes, query-count assertions, and local/non-local range checks.

## Completion evidence

Agents wrote the test suites and audited the relink; the orchestrator wrote the
production change, fixed the defects the audit found, and made the commits.

### Revisions

Base Suite `b5ad65db54d93ee7ba3b95d1f9e3593f312a2c13` on
`implement/drive-24-webdav-read`. Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`
on `forge/storage-v2`, read only and unchanged.

| Commit | Subject |
|---|---|
| `0b9a2a682` | claim the ticket |
| `285a2ad9d` | browse and download over WebDAV on Drive Node |
| `aa3f62736` | keep the DAV ETag batch flat and honest |
| `e85ba1d33` | cover the WebDAV read path without a site |
| `ebc43d56d` | tighten three edges on the DAV read path |
| `b9f61b660` | retarget the DAV suites onto Drive Node |

### Changed behaviour

- `pathmap` resolves `Drive Node` rows on the frozen `(parent, state, title)`
  index. There is one mount, the caller's Personal Root, at `/dav/` itself. The
  `Home` and `Everyone` aliases are gone, and nothing outside the caller's own
  root is reachable.
- Content documents, their child media, link nodes, and templates are neither
  listed nor resolvable. A direct path to one answers 404, the same answer as a
  name that was never there.
- An ordinary uploaded file is visible by access alone. `report.docx` and
  `deck.pptx` are files, not documents, and the extension decides nothing.
- PROPFIND Depth 1 spends §5.3's folder page: three queries for the window and
  the two grant sets, one dead-property fetch, one lock fetch, and one blob read
  for the page's validators. The count does not move with the child count. A
  folder wider than one window pages to the end rather than truncating, because
  PROPFIND has no cursor to hand a client.
- GET streams through `frappe.storage.serve.stream_blob`, so Range, 206, 416,
  304, and the strong ETag are the same on the bytes and in `getetag`.
- The ETag is the blob's full SHA-256 checksum, quoted. The legacy scheme
  truncated it to 32 characters, which could never match an `If-Match` against
  what the byte path publishes.
- Quota properties read the Personal Root, and `quota-available-bytes` is
  omitted, not zeroed, when the root is unlimited.
- A DAV session never carries a `$LINK` principal or an unlock ticket, even when
  the request carries `X-Drive-Links`.
- Drive refusals map to their DAV statuses. Every Drive refusal subclasses
  `frappe.ValidationError`, which the mapper answered 409, so an unreadable node
  would have been 409 instead of §12.1's 404.
- Locks and dead properties key on node identity. The subtree lock query uses
  the materialised `path` instead of a recursive walk.
- Auth, the per-user opt-in, the admin method allow-list, and the log settings
  are unchanged in behaviour. The allow-list is now intersected with the
  relinked verbs, so it can narrow the surface but never widen it.

### Commands and real results

All site-free. No `bench`, `migrate`, `install`, or `restart` was run, and
`slides.localhost` was not touched.

```
$ python -m compileall -q suite/drive
COMPILEALL OK

$ uvx ruff@0.12.3 format --check suite/drive/webdav
41 files already formatted
$ uvx ruff@0.12.3 check suite/drive/webdav
All checks passed!

$ cd sites && PYTHONPATH=<worktree>:<frappe> ../env/bin/python \
    -m unittest suite.drive.tests.test_webdav
Ran 69 tests in 0.115s
OK

$ ... frappe.init(site=""); test_xmlutil + test_ifheader + test_conditional
Ran 27 tests in 0.006s
OK

$ ... collection across suite/drive/webdav/tests
TOTAL 258, skipped 115, live 143
```

Four files under `suite/drive` are unformatted and two hold lint errors
(`http/shims.py`, `patches/team_restructure.py`, `doctype/drive_grant/drive_grant.py`,
`tests/benchmark_views.py`). All four predate this ticket and none is touched by
it.

### Defects found by the audit and fixed

1. **The ETag batch was neither flat nor honest.** `compute_etag` fell back to a
   per-row `File Blob` read whenever the batched map held no checksum. A folder
   of ten children whose batched read answered nothing cost eleven blob reads,
   measured, so §12.5's budget stopped being flat. Each fallback also published
   the empty-bytes ETag, telling a client that a file with bytes was empty. Now
   `checksums_for` keys every blob-holding row, `None` included, and a blob
   nobody can read publishes no `getetag` at all. Fixed in `aa3f62736`.
2. **PROPFIND paid for validators nobody asked for.** The blob read ran before
   the request mode was read, so a body naming `getcontentlength` alone still
   paid it. Now gated on `allprop`, `propname`, or a body naming `getetag`.
3. **`pathmap.visible` did not check `state`.** No live bug, because its only
   caller filters to Active first, but the name promised a completeness it did
   not have. Both fixed in `ebc43d56d`.

### Decisions and deviations

- **The write verbs are refused, not relinked.** Once `pathmap` returns nodes,
  `put.py`, `structure.py`, `copy.py`, and `lock.py` would create legacy `File`
  rows whose `folder` names a `Drive Node`: a row in the wrong tree. Relinking
  them is ticket 25's acceptance criteria, so they are gated off instead through
  `webdav/__init__.py:RELINKED_METHODS`, which `dispatch._HANDLERS` and
  `settings.allowed_webdav_methods` both follow. Deleting that tuple re-admits
  them. This leans on the README's rule that a ticket is independently
  verifiable but not necessarily independently deployable: between this ticket
  and ticket 25, `/dav` reads but does not write.
- **`perms.py` is kept, against §12.5's deletion list.** Its last readers are
  the write handlers above. Deleting it now would leave them with a dangling
  import. Ticket 25 deletes both together.
- **Link nodes are hidden.** §12.2 names documents and their media. A link node
  has no bytes of its own, so there is nothing for a DAV client to fetch.
- **The ETag costs one batched read per page.** §12.4 wants the validator to
  match the byte path, and the byte path publishes `File Blob.checksum`, which
  is not on the node row. One read for a whole page is the cheapest honest
  answer.
- **`test_perms.py` is deleted, `perms.py` is not.** The module it covered is off
  every read path, and its harness called a `pathmap` helper that no longer
  exists, so it could not run in any case.
- **`Drive Legacy Route` is untouched.** See the finding below.

### Findings recorded, not fixed

- **`Drive Legacy Route.entity` is still declared `Link → File`,** but ticket 23
  made `http/shims.py:2465` read it as a node id and test `row.kind` and
  `row.state`. Two effects: link validation on insert still points at `tabFile`
  (`patches/remove_teams.py:57`), and the purge cascade at
  `_core/nodes.py:1908` stays dormant, so deleting a node leaves a stale route
  row. That table is §11.7, ticket 23's surface.
- **`propname` does not list the quota property names.** `_render` lists names
  where the value is not None, and quota is only populated when a client names
  it, which `propname` cannot do. RFC 4918 §9.1 wants every defined name.
  Pre-existing and unchanged by this ticket.
- **An allow-list naming only write verbs now collapses to `("OPTIONS",)`.**
  That is the intended narrowing, but an admin who configured such a list before
  this release loses all DAV access with no message.

### Dormant activation

`_delete_if_field(..., require_options="Drive Node")` gates the purge cascade on
the field's declared target (`_core/nodes.py:1994`). Retargeting the two DAV
DocType JSONs activates lock and dead-property purge at `_core/nodes.py:1906-1907`
and `_core/roots.py:418-419`, which is §3.15's intent. `Drive Legacy Route` at
`nodes.py:1908` stays dormant, per the finding above.

### Residual risks

- 111 of the 143 live DAV tests are `IntegrationTestCase` and have not been run.
  They import cleanly, collect, and lint clean. That is all that is proved.
- The Depth-1 budget cases in `test_propfind.py` assert `assertEqual(small, large)`
  and a ceiling rather than a fixed query number, because the raw `frappe.db.sql`
  cost of one `frappe.get_all` was not confirmable without the site. The exact
  count is pinned in the site-free suite instead.
- `_core.nodes.create_file` enqueues a preview render with
  `enqueue_after_commit=True`. This bench has no RQ worker and its short queue
  saturates, so `TestWebDAVContent` may raise `QueueOverloaded` here rather than
  fail on a DAV assertion.
- Real title collation in `pathmap._child`, the BINARY-exact match and its single
  unambiguous case-insensitive fallback, needs MariaDB and is untested.
- litmus cannot pass this release: it exercises the write verbs. The ledger
  records which groups fail and why. No entry was invented.

### Site gate that must run

DocType JSON changed, so migrate first. Then one module per invocation,
serialized, never in parallel.

```
bench --site slides.localhost migrate

script -qec "bench --site slides.localhost run-tests --module <module>" /dev/null
```

Modules, in order:

1. `suite.drive.tests.test_webdav`
2. `suite.drive.webdav.tests.test_pathmap`
3. `suite.drive.webdav.tests.test_propfind`
4. `suite.drive.webdav.tests.test_properties`
5. `suite.drive.webdav.tests.test_put_get`
6. `suite.drive.webdav.tests.test_dispatch`
7. `suite.drive.webdav.tests.test_settings`
8. `suite.drive.webdav.tests.test_auth`
9. `suite.drive.webdav.tests.test_log`
10. `suite.drive.webdav.tests.test_conditional`
11. `suite.drive.webdav.tests.test_ifheader`
12. `suite.drive.webdav.tests.test_xmlutil`
13. `suite.drive.tests.test_nodes`
14. `suite.drive.tests.test_access`
15. `suite.drive.tests.test_quota`
16. `suite.drive.tests.test_roots`
17. `suite.drive.http.tests.test_shims`

Modules 13 to 17 are the regression check: the engine the relink leans on, and
ticket 23's compatibility surface. Modules 2 to 12 are ticket 24's own
verification and have never been executed.

This ticket stays open until that gate runs.

## Independent review

A separate reviewer audited the whole diff from `b5ad65db5` through
`a47013073`, read every referenced normative section, and fixed what it found.
Implementation notes were not taken as evidence: every claim below was checked
against the code. The four commits are on this branch.

| Commit | Subject |
|---|---|
| `75cc52e9d` | make the DAV byte path answer for itself |
| `f66c3f2a0` | keep the DAV namespace one name to one row |
| `03c82c063` | stop advertising and carrying what DAV cannot honour |
| `73a3941fd` | prove the mount boundary and the one validator live |

### Defects found and fixed

**The byte path (`75cc52e9d`).** GET leaves through
`frappe.storage.serve.stream_blob`, which is werkzeug's ground and answers with
werkzeug's own exceptions.

1. An unsatisfiable `Range` was a 500. `send_file` raises
   `RequestedRangeNotSatisfiable`, `map_exception` had no `HTTPException`
   branch, and the dispatcher wrote and committed an Error Log row on every
   client retry. Local is the default driver, so this was the common path; only
   the remote driver had a 416 test. Now 416, with `Content-Range` carried
   through.
2. Bytes missing from the driver were a 500, not 404. Same gap.
3. `If-Range` was ignored. A download resumed after the file was replaced
   spliced an old head onto new bytes. Decided in `stream_content` now, where
   the blob checksum is already in hand.
4. `Last-Modified` was the blob file's mtime, which blob dedupe shares between
   unrelated nodes, while `getlastmodified` published `content_modified`. The
   two surfaces name one time (§8.11, §12.4).
5. An empty head answered a flat 200 that ignored its own validator, and
   carried no `Accept-Ranges`.
6. A 304 carried representation metadata a shared cache would store onto the
   cached response (RFC 7232 §4.1).
7. A download read `File Blob` twice; it reads it once.
8. A 401 raised outside `auth` carried no `WWW-Authenticate`, so a client had
   nothing to retry with.

**The namespace (`f66c3f2a0`).**

9. `pathmap._child` resolved rows the listing drops. `visible` applies the
   naming policy; `_child` applied only its SQL half, so a title holding a
   backslash or a control character 404s in PROPFIND and then downloads by
   hand. One rule now governs both.
10. Two Active siblings may hold one title, and `href_for` quotes the title, so
    both were published at one href: two sizes and two ETags at a URL that
    answers from one row. The listing publishes the row the lookup reaches, the
    oldest, and drops the shadowed one. Titles differing only by case each
    resolve exactly, so both keep their own href.
11. `<D:prop/>` with no children produced a response element with an href and
    no propstat, which RFC 4918 §14.24 does not allow.
12. A quota probe at a file spent `get_storage_usage`'s three queries to
    produce a 404 propstat.

**What the protocol claims about itself (`03c82c063`).**

13. `X-Drive-Links` was stripped from `ctx.principals` and nowhere else. The
    header stayed on the request, so `framework.principals_for` honoured it
    wherever else it is called, the framework permission hook included. Worse,
    a header over `LINK_HEADER_LIMIT` threw inside `parse_link_header`, which
    maps to 409, so a credential §6.9 says to ignore could refuse the whole
    request. The dispatcher now drops it from the environ before anything reads
    it.
14. `dav_compliance` advertised `1, 3` even when the admin's allow-list holds
    no PROPFIND. RFC 4918 §9.1 makes PROPFIND what class 1 means, so that sent
    a client at a request the site answers 405 to. It returns an empty string
    now, and OPTIONS omits the header rather than sending one.
15. `lock.py` called `locks.find_conflicts(..., is_folder=...)` after this
    ticket renamed the keyword to `is_collection`: a `TypeError`. LOCK is off
    the allow-list so nothing reaches it today; ticket 25 would have.
16. `DAV_COMPLIANCE = "1, 2, 3"` in `webdav/__init__.py` was unread and a fixed
    claim the allow-list can contradict. Deleted.

### What the review checked and found correct

- One mount. `pathmap.resolve` starts at `personal_root_for(user)` and there is
  no other entry. A file OWNER really grants STRANGER READ on stays unreachable
  from STRANGER's mount; that is now a live test.
- Unreadable is 404, never 403. `require` and `require_from_rows` both raise
  `DriveNotFound` below READ, `_drive_refusal` recognises it before the
  `frappe.ValidationError` family it belongs to, and `_collect_resources`
  answers an unresolved path the same way as a hidden one.
- The Depth-1 parent is authorized. `nodes.children` runs the point check on
  the parent, so the batched path is not an auth hole.
- Hiding is by kind. `_VISIBLE` and `visible` test `kind`, never the title's
  extension, so `report.docx` is an ordinary file and a Writer document is
  invisible. Child media hang under the document node, so hiding the document
  404s the walk before it reaches them.
- `checksums_for` keys every blob-holding row, `None` included, so the batch
  stays flat and a blob nobody can read publishes no `getetag`.
- Quota reads the Personal Root and omits `quota-available-bytes` when the root
  is unlimited.
- The XML parser is hardened, the path memo cannot bleed across users or
  requests, and no migration, hook, or build file was touched, so ticket 29
  stays dormant.
- The DocType retarget activates the `require_options="Drive Node"` purge
  cascade for locks and dead properties while leaving `Drive Legacy Route`
  dormant, as the ticket states.

### Findings recorded, not fixed

- **The write handlers are legacy-shaped throughout, not just at their entry
  points.** `copy.py` reads `tabFile` directly, and `structure.py`, `put.py`,
  and `lock.py` read `row.is_folder`, which a `Drive Node` row does not carry
  (it reads `None`, silently). This is ticket 25's whole job. Only the
  `find_conflicts` keyword was corrected here, because this ticket introduced
  that mismatch.
- **`_VISIBLE`'s `is_template = 0` clause is unreachable through the
  controller.** `Drive Node._validate_kind_shape` refuses `is_template` on
  every kind except `document`, and `kind IN ('folder','file')` already
  excludes documents. The clause is defence against a raw DB write, which is
  worth keeping; a live test for it would need a row the controller refuses to
  create.
- **`pathmap`'s "one indexed point query per segment" claim was too strong.**
  `title = BINARY %(segment)s` compares a binary collation against a
  `utf8mb4_unicode_ci` column, so only the `(parent, state)` index prefix is
  certain to be used. The docstring now says that, and the site gate carries an
  `EXPLAIN` to settle it.

### Commands run in review, and real results

All site-free, in the review worktree. No `bench`, `migrate`, `install`,
`restart`, `push`, or PR. `slides.localhost` was not touched.

```
$ python -m compileall -q suite/drive
COMPILEALL OK

$ uvx ruff@0.12.3 format --check suite/drive/webdav suite/drive/tests/test_webdav.py
42 files already formatted

$ uvx ruff@0.12.3 check suite/drive/webdav suite/drive/tests/test_webdav.py
All checks passed!

$ cd sites && PYTHONPATH=<worktree>:<frappe> ../env/bin/python \
    -m unittest suite.drive.tests.test_webdav
Ran 90 tests in 0.144s
OK

$ ... frappe.init(site=""); test_xmlutil + test_ifheader + test_conditional
Ran 27 tests in 0.005s
OK

$ ... unittest discovery across suite/drive/webdav/tests
TOTAL 260 live 233 other 27
```

`test_webdav` grew from 69 cases to 90. The 21 new ones cover the byte path
(416, 404-from-driver, `If-Range` in six shapes, the 304, the single blob read,
`Last-Modified`), the namespace (a dropped title not resolving, duplicate
titles publishing one href, case variants keeping separate hrefs, the empty
`<D:prop/>`, the free quota probe), and the advertisement (`X-Drive-Links`
dropped at the dispatcher, an oversized header not refusing the request, no
compliance class without PROPFIND).

Two live cases were added and **not run**: the shared-node mount boundary and
`getetag` against the GET `ETag`, both in `test_propfind.py`. They are in the
gate below.

### Residual risks after review

- The 233 live DAV tests are still unrun. They import, collect, and lint clean.
  That is all that is proved.
- The `If-Range` rule is decided against the blob checksum only. A weak
  validator or an HTTP-date `If-Range` drops the `Range` and serves the whole
  body, which is correct but conservative.
- `_one_row_per_name` picks the oldest of a duplicate pair by `creation`. Two
  rows created inside the same second tie, and the survivor is then whichever
  the window ordered first. Both are readable and neither is wrong; which one a
  client sees is unstable across requests. The real fix is a unique index on
  `(parent, state, title)`, which is not this ticket's schema.
- The earlier risks stand: the Depth-1 budget cases in `test_propfind.py`
  assert a ceiling rather than a count, `create_file` enqueues a preview render
  on a bench with no RQ worker, and litmus cannot pass while the write verbs
  are gated off.

## Revised site gate

Supersedes the gate above. DocType JSON changed, so migrate first. Then one
module per invocation, serialized, never in parallel.

```
bench --site slides.localhost migrate

script -qec "bench --site slides.localhost run-tests --module <module>" /dev/null
```

Modules, in order:

1. `suite.drive.tests.test_webdav`
2. `suite.drive.webdav.tests.test_pathmap`
3. `suite.drive.webdav.tests.test_propfind`
4. `suite.drive.webdav.tests.test_properties`
5. `suite.drive.webdav.tests.test_put_get`
6. `suite.drive.webdav.tests.test_dispatch`
7. `suite.drive.webdav.tests.test_settings`
8. `suite.drive.webdav.tests.test_auth`
9. `suite.drive.webdav.tests.test_log`
10. `suite.drive.webdav.tests.test_conditional`
11. `suite.drive.webdav.tests.test_ifheader`
12. `suite.drive.webdav.tests.test_xmlutil`
13. `suite.drive.tests.test_nodes`
14. `suite.drive.tests.test_access`
15. `suite.drive.tests.test_quota`
16. `suite.drive.tests.test_roots`
17. `suite.drive.http.tests.test_shims`

Modules 13 to 17 are the regression check: the engine the relink leans on, and
ticket 23's compatibility surface. Modules 2 to 12 are ticket 24's own
verification and have never been executed.

Then one step that is not a test. Write the query to a file first: the table
name needs backticks, and a backtick inside a double-quoted shell argument is
command substitution.

```
cat > /tmp/dav-explain.sql <<'SQL'
EXPLAIN SELECT name FROM `tabDrive Node`
WHERE parent = '<folder node id>'
  AND state = 'Active' AND kind IN ('folder', 'file') AND is_template = 0
  AND title = BINARY '<child title>'
ORDER BY creation ASC LIMIT 1\G
SQL

bench --site slides.localhost mariadb < /tmp/dav-explain.sql
```

Replace the two placeholders with a real folder node id on the site and a real
child title under it. Pick them with:

```
bench --site slides.localhost execute frappe.db.get_all --kwargs "{'doctype': 'Drive Node', 'filters': {'kind': 'file', 'state': 'Active'}, 'fields': ['name', 'parent', 'title'], 'limit_page_length': 5}"
```

It passes when `key` names an index whose leading column is `parent` and `rows`
is bounded by that folder's child count. It fails on a full table scan: the
per-segment walk would then be linear in the whole tree, and §12.5's budget
would not hold on a real site however flat the query count is.

This ticket stays open until the gate and the `EXPLAIN` both run.

## Site gate: first run

Modules 1 to 5 passed on `slides.localhost` after `migrate`:
`test_webdav` 91, `test_pathmap` 20, `test_propfind` 22, `test_properties` 16,
`test_put_get` 72 with 58 ticket-25 skips.

Module 6, `test_dispatch`, ran 13 and failed three. All three were suite
defects, not production defects. No production file changed.

| Commit | Subject |
|---|---|
| `e8eab2012` | commit the DAV toggle the dispatcher rolls back |
| `85bd2e345` | give the DAV dispatch and log suites a mount |
| `a6c20c3cc` | stop expecting a class the allow-list cannot claim |

### Defects found and fixed

1. **The global toggle did not survive one test.** `setUp` set
   `webdav_enabled` without committing. Every refusal in `_dispatch` calls
   `db.rollback`, and `clear_document_cache` registers its redis clear on
   `db.after_rollback`, so the rollback both discarded the write and dropped
   the cached Single. The next request read the site as feature-off and raised
   werkzeug `NotFound` from `dispatch.py:56`.
   `test_gated_write_verbs_are_405_with_the_relinked_allow` sends eight verbs
   in one loop and died on the second. The toggle is committed now, in both
   directions, which is what `test_log` already did for this reason.
2. **Neither `test_dispatch` nor `test_log` built a mount.** Both create their
   user, enable the per-user toggle, and then expect 207 from `PROPFIND /dav/`.
   The DAV namespace is the caller's Personal Root and nothing else, so
   `pathmap.resolve` had no root to walk and answered 404. The bench WebDAV log
   records it: `PROPFIND /dav/ -> 404 ... note="Resource not found."`, which is
   `_collect_resources` on an unresolved path, not `require` on an unreadable
   node. `test_log` would have failed the same way at module 9.
3. **The narrowing case expected a class the site cannot claim.** With
   "OPTIONS, GET, LOCK" the allow-list narrows to OPTIONS, GET, HEAD and holds
   no PROPFIND, so `dav_compliance` returns "" and OPTIONS omits the header.
   That is commit `03c82c063` working. The case still expected `DAV: 1, 3`.

### Commands and real results

Site-free, in this worktree. No `bench`, `migrate`, `install`, `restart`,
`push`, or PR.

```
$ python -m compileall -q suite/drive
COMPILEALL OK

$ uvx ruff@0.12.3 format --check suite/drive/webdav
41 files already formatted
$ uvx ruff@0.12.3 check suite/drive/webdav
All checks passed!

$ cd sites && PYTHONPATH=<worktree>:<frappe> ../env/bin/python \
    -m unittest suite.drive.tests.test_webdav
Ran 91 tests in 0.162s
OK

$ ... unittest discovery across suite/drive/webdav/tests
load errors: []
TOTAL 260 live 145 skipped 115

$ ... frappe.init(site=""); options.handle with a stubbed allow-list
OPTIONS, GET, HEAD            -> no DAV header
OPTIONS, GET, HEAD, PROPFIND  -> DAV: 1, 3
```

### Rerun

```
script -qec "bench --site slides.localhost run-tests --module suite.drive.webdav.tests.test_dispatch" /dev/null
```

No DocType JSON changed, so no `migrate`. Modules 7 to 17 and the `EXPLAIN`
are still to run.
