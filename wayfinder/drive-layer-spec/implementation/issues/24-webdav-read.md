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
