# 21 — Expose node, upload, and root workflows through HTTP

**What to build:** Let clients create and organize nodes, upload bytes, and administer roots through the new route namespace.

**Blocked by:** [17 — Move Writer lifecycle and history into Drive](17-writer-adoption.md); [19 — Move Sheets lifecycle and collaboration checks into Drive](19-sheets-adoption-and-collab.md); [20 — Load composite references in authorized groups](20-composite-group-contract.md)

**Status:** done

**Owner:** Suite Drive HTTP

**Starting revision:** Suite `501e4cea41971f942782ef06fe45e626eebdeb39`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/drive/http/__init__.py`,
`suite/drive/http/translator.py`, `suite/drive/http/routes.py`,
`suite/drive/http/shapes.py`, `suite/drive/http/tests/*`,
`suite/drive/_core/access.py`, `suite/drive/_core/content.py`,
`suite/drive/_core/nodes.py`, `suite/drive/_core/previews.py`,
`suite/drive/_core/roots.py`, `suite/drive/_core/upload.py`,
`suite/drive/framework.py`, `suite/hooks.py`, `suite/drive/__init__.py`,
`suite/tests/test_architecture.py`, and this ticket. The last two are held
for the claim and are unchanged.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.1–11.3, §11.5–11.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement the translator with PATH_INFO and cached request-path correction. Delegate authentication and response envelopes to Frappe.
- [x] Declare allowed verbs and Guest access per route. Path ids override conflicting request arguments, and cmd cannot redirect dispatch.
- [x] Wire node CRUD, copy, content, media, previews, uploads, and root usage/admin routes to shared workflows.
- [x] Accept parent plus Active state for an explicit restore destination. Return a conflict when user choice is missing.
- [x] Keep list and detail node shapes identical, with effective root id and opt-in access, breadcrumbs, and preview expansions.
- [x] Implement batch outcomes with independent rollback per failed item and one activity per successful mutation.
- [x] Map Drive errors and plain ValidationError to the specified status and v2 envelope. Authorize all byte egress.
- [x] Keep raw blob creation inputs within the caller’s authorized workflow; client metadata cannot bypass byte validation or accounting.

## Verification

Run HTTP tests through actual request dispatch for session/API-key/Guest calls, streamed chunks, restore, mixed batches, and unauthorized egress.

## Completion evidence

Status: implementation written, reviewed by a second agent, fixed, and run
through the serialized site gate. Every command in the gate passes. The
acceptance boxes are checked against real requests, not against a reading of
the code.

### Revisions

- Suite start `501e4cea41971f942782ef06fe45e626eebdeb39`, work through
  `7801dc0052663446650e89bd3a1f6a1ea45c6b2c` on
  `implement/drive-21-http-workflows`.
- Independent review on `review/drive-21-http-workflows`:
  `fcc9232d5` (review fixes) and `165431d8c` (that evidence update).
- Site gate on `main`: `07d0490cc` (fixture repairs) and `bcdc964ad` (the
  media authorization fix and three corrected expectations). The gate ran on
  `bcdc964ad`.
- Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, read only, unchanged.

### Changed behavior

**New: `suite/drive/http/`.**

- `translator.py` mounts `/api/suite/drive/` on the v2 method API from a
  `before_request` hook. It writes `request.environ["PATH_INFO"]` for
  `API_URL_MAP.bind_to_environ` and `request.path` for `get_api_version`,
  drops the cached `full_path`, `url`, and `base_url`, and keeps the client's
  path in the environ. Path segments go into `form_dict` with `update`, after
  `make_form_dict` parsed the body, so the id in the URL is the id that acts.
  `cmd` is popped, so a client cannot replace the addressed route with a
  method of its own choosing. `OPTIONS` is left alone.
- `routes.py` holds one whitelisted handler per §11.2 row. Each declares its
  verbs and whether a Guest may be heard, builds principals once from the
  session and this request's `X-Drive-Links` header, calls one `_core`
  workflow, and shapes the answer. Authentication, argument binding, and both
  envelopes stay with Frappe.
- `shapes.py` publishes §11.3's sixteen fields for a list row and a detail
  fetch alike, and withholds `path`, `trash_root`, `trashed_at`, `blob`, and
  `modified_by`. It coerces every argument, raising `ValidationError`.
- Batch runs each node in its own savepoint, so one refusal rolls back that
  node and its activity row and leaves the others written.

**Changed: `_core`.** The HTTP layer re-derives nothing.

- `access.describe`, `access.describe_page`, `access.chain_roles`: the §11.3
  `access` expansion out of the same nearest-wins resolution `require` runs.
  A folder page with `?expand=access` stays at three queries.
- `nodes.get`, `nodes.stored`, `nodes.create`, `nodes.breadcrumbs`,
  `nodes.content_url`, and `with_access` on `nodes.children`.
- `content.export_document` streams one document in a declared format.
- `roots.usage_for` answers a root's counters to its user, its managers, or an
  admin.

**Changed: two bounds.**

- `previews.MAX_PUSHED_PREVIEW_PIXELS = 25_000_000`, refused on the declared
  dimensions before any decode. This is ticket 18's handoff, not ticket 19's.
- `upload.MAX_CHUNK_BYTES = 16 MiB`. The chunk path is a
  `streaming_request_paths` entry, which clears the framework's
  `max_content_length`, so nothing else bounds one PUT.

**Changed: `suite/hooks.py`.** `before_request` becomes a two-entry list. The
translator is reached through `suite.drive.framework.handle_http_request`,
which is where ARCHITECTURE.md puts a dotted Frappe target entering Drive.

### Acceptance criteria against the code

1. Translator with both writes, authentication and envelopes delegated:
   `translator.py:62-107`, proved by `test_translator.py`.
2. Verbs and Guest per route, path ids override arguments, `cmd` cannot
   redirect: `routes.py` decorators plus `translator._dispatch`, proved by
   `TestRouteTable` and `TestAddressing`.
3. Every §11.2 node, upload, and root row wired to a shared workflow:
   `routes.py`. No route reimplements a check.
4. Restore takes `parent` plus `state: "Active"`, and `_restore` answers
   `DriveConflict` when the choice is missing: `TestRestore`.
5. One serialiser for a list row and a detail row, effective root id, three
   opt-in expansions: `shapes.node_shape`, `TestNodeShape`.
6. Per-item savepoints and one activity row per successful mutation:
   `routes.node_batch`, `TestBatchIsolation`, `TestBatch`.
7. Exact §11.6 mapping including plain `ValidationError` at 400:
   `routes._route`, `TestRefusalMapping`, `TestErrorEnvelope`.
8. Raw blob inputs stay inside the authorized workflow: `POST /nodes` is
   the one route that accepts §11.2's declared `blob`, `size`, and `mime`,
   and hands them to `create_file`. `_validated_blob` refuses unless the
   declared pair matches the stored blob row, the node is written from the
   stored values, and `admit` charges the stored size. Client metadata can
   fail the create; it cannot change what is written or billed. Review
   removed the same three arguments from `PATCH /nodes/<id>`: §11.2 does not
   declare them there.

### Commands and real results

Run from `/home/faris/benches/suite-bench/sites`, with
`PYTHONPATH=<worktree>:<frappe>` and the bench venv Python.

| Command | Result |
|---|---|
| `ruff check suite/drive/ suite/hooks.py` (0.14.10, cached pre-commit copy) | pass, except the pre-existing `E722` in `suite/drive/patches/team_restructure.py`, which this ticket did not touch |
| `ruff format` on every changed file | clean |
| `python -m unittest suite.tests.test_architecture` | `Ran 7 tests ... OK`. No new violation from `suite/drive/http/` or from the new `before_request` entry, and no `BASELINE_DEBT` change |
| `python -m unittest discover -s suite/drive/http/tests` | `Ran 55 tests in 0.175s ... OK` |
| import check of `suite.drive.http.tests.test_dispatch` | imports site-free; 91 test methods collected |

Re-run after the review fixes, same environment:

| Command | Result |
|---|---|
| `ruff check suite/drive/ suite/hooks.py` (0.12.3) | pass, except the same pre-existing `E722` in `suite/drive/patches/team_restructure.py` |
| `ruff format --check suite/drive/http/ suite/drive/_core/` | `23 files already formatted` |
| `python -m unittest suite.tests.test_architecture` | `Ran 7 tests in 1.063s ... OK` |
| `python -m unittest ...test_translator ...test_shapes ...test_routes` | `Ran 71 tests in 0.168s ... OK` |
| import check of `suite.drive.http.tests.test_dispatch` | imports site-free; 96 test methods collected |

### The site gate, run

Run on `slides.localhost`, serially, nothing else touching the site. Suite at
`bcdc964ad`; Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, read only,
unchanged. Every command below passed on that revision.

| Command (`bench --site slides.localhost run-tests ...`) | Result |
|---|---|
| `--module suite.drive.http.tests.test_dispatch` | `Ran 97 tests in 3.941s ... OK`, and again at 3.660s |
| `--module suite.drive.http.tests.test_translator` | `Ran 25 tests ... OK` |
| `--module suite.drive.http.tests.test_shapes` | `Ran 15 tests ... OK` |
| `--module suite.drive.http.tests.test_routes` | `Ran 31 tests ... OK` |
| `--app suite --module suite.drive.tests.test_nodes` | 13 unit `OK`, 23 integration `OK` |
| `--app suite --module suite.drive.tests.test_upload` | 8 unit `OK`, 26 integration `OK` |
| `--app suite --module suite.drive.tests.test_content` | 53 unit `OK`, 49 integration `OK`, 3 uncategorized `OK` |
| `--app suite --module suite.drive.tests.test_roots` | 2 unit `OK`, 24 integration `OK` |
| `--app suite --module suite.drive.tests.test_access` | `Ran 12 tests ... OK` |
| `--app suite --module suite.drive.tests.test_previews` | 14 unit `OK`, 13 integration `OK` |
| `--module suite.drive.webdav.tests.test_dispatch` | `Ran 11 tests ... OK` |
| `--module suite.tests.test_architecture` | `Ran 7 tests ... OK` |
| `ruff check suite/drive/http/ suite/drive/_core/content.py` (0.12.3) | `All checks passed!` |
| `ruff format --check` on the same paths | `10 files already formatted` |

The dispatch suite is 97 tests, not 96: the gate added one.

**What the first run found.** 8 failures and 41 errors, almost all cascades
from two fixture faults.

1. `session_for` restored an absent name through `frappe.local.__dict__`.
   `frappe.local` is a contextvar store with no `__dict__`, so the restore
   raised on its first entry, `request`, and never reached `session`. The
   alphabetically first test of every class errored in `setUp`, and every
   later test in that class then ran as the owner instead of Administrator.
   That is why `generate_keys` answered `PermissionError` on the two API-key
   tests. Restored with `delattr` in a `try`.
2. Every teardown deleted `Drive Notification` by `node`. That table has no
   `node` column; it points at `Drive Activity`. Each teardown raised, left
   its tree behind, and the next `setUp` hit `DriveConflict` on the title.
   One `drop_node_rows` helper now reads the activity ids first, which is
   what `drive/tests/fixtures.py` already did.
3. `TestBatch` tried to hide a node from its caller by rewriting the node's
   `owner` and deleting its grant, while the node stayed under the caller's
   own root. §5.1's root anchor grant reaches every descendant, so the node
   was always visible. The fixture now uses a second Personal root.
4. `TestUploads` needs File Storage v2. `create_blob_upload` reads
   `frappe.conf`, and each request rebuilds `frappe.conf` from the site
   config on its own thread, so a conf write in the test thread cannot reach
   it. `storage_v2_on` patches `frappe.storage.enabled` for the block. The
   site config is untouched, so dormant activation stays ticket 29's work.

**One implementation defect.** `content.list_media` called `_document_node`
before it authorized, so a caller with no grant got 409 `DriveConflict`
"That Drive node is not a content document". That discloses both that the
node exists and what kind it is. §5.2 hides an unreadable node behind
`DriveNotFound` on every surface, and §11.2's media row declares 403 as its
only extra error, unlike the children row two above it, which declares 409 on
a document node. `_document_node` now takes the caller and runs the point
check between the not-found branch and the kind branch. Still one point check,
as §6.8 budgets. `export_document` keeps the old order deliberately: its only
route authorizes first through `nodes.get`, so a second check would be waste.

**Three test expectations were wrong, not the code.**

- An Active root refuses a purge with 403 `DriveForbidden`. §11.2's roots
  table declares no extra error for `DELETE /roots/<id>`, and its prose makes
  Archived a condition on the right to call, next to Suite Admin.
  `test_root_admin.py:170` already pinned `DriveForbidden`. The dispatch test
  had asked for 409.
- A pushed preview was aimed at a plain file. §9.2 accepts one only on an
  active content document, so the byte check was unreachable. The fixture
  tree now holds a document, inserted directly the way `test_previews` does,
  because `drive_content_types` stays empty until ticket 29 and
  `create_document` therefore cannot mint one. A new test,
  `test_a_preview_push_is_refused_on_a_node_that_is_not_a_document`, pins the
  403 the old test had been getting by accident.
- §5.10 row 9 caps a share link at EDIT, so `grant(..., "$LINK", MANAGE, ...)`
  can never succeed and "a link above an EDIT grant" cannot exist. The own
  grant drops to READ and the link takes EDIT.

**Bench note.** `suite-bench` runs no RQ worker, so each test run leaves its
background jobs queued and the `short` queue reaches `frappe.QueueOverloaded`.
The `short` and `default` queues were emptied between runs. They hold test
residue only.

### The gate commands

Run on `slides.localhost`, serially, nothing else touching the site:

```
cd /home/faris/benches/suite-bench
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_translator
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shapes
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_routes
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_nodes
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_upload
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_roots
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --app suite --module suite.drive.tests.test_previews
bench --site slides.localhost run-tests --app suite --module suite.drive.webdav.tests.test_dispatch
```

The last seven are regression cover: this ticket changed `_core/nodes.py`,
`_core/access.py`, `_core/content.py`, `_core/roots.py`, `_core/upload.py`,
`_core/previews.py`, and `before_request`. The review changed the winner sort
in `access.py` and the decode guard in `previews.py`, so those two modules
joined the list.

A background worker must be running, or the queue must be emptied between
runs, or Drive tests fail with `QueueOverloaded` on this bench.

### Independent review

A second agent reviewed the branch against §11.1-11.6 without trusting this
report, and fixed what it found. Commit `fcc9232d5`.

**Fixed, highest severity first.**

1. **The declared `{content_modified}` PATCH body always failed.** `update`
   folded `content_modified` into the file-replacement branch, so §11.2's
   fifth body answered `A file replacement requires blob, size, and MIME
   type`. Proved site-free against a stub database before the fix.
   `_stamp_content_time` now writes it alone. `POST /nodes/batch` takes the
   same field, because §11.5 ties `patch` to the same set.
2. **`PATCH /nodes/<id>` took bytes §11.2 does not declare.** `blob`, `size`,
   and `mime` are gone from the route and from the batch `patch` allow-list.
   A test pinned the old behaviour; that test pinned an error.
3. **A non-ASCII document title killed the download.** A WSGI header is
   latin-1 and `Headers.set` quotes a filename but never encodes one, so a
   Cyrillic or Chinese title broke the response after the status line, and a
   title holding a newline raised `ValueError` outside the boundary that maps
   refusals. `_disposition_names` now writes RFC 5987.
4. **A title holding `/` broke its own signed URL.** `signed_url_for_blob`
   signs the filename into the path, so a slash split it and the byte fetch
   answered 403. `content.download_filename` cleans the name where it is
   minted, for both `/nodes/<id>/content` and `/nodes/<id>/media`.
5. **`frappe.DoesNotExistError` escaped the §11.6 mapping** and left the
   namespace as a 500. It maps to `DriveNotFound`.
6. **`PUT /uploads/<id>` read the body before it authorized the session.**
   Python evaluates arguments first, so an unknown session cost a whole
   16 MiB chunk of memory. `upload.authorize_chunk` runs first.
7. **An over-size upload session answered 400, not 413.**
   `create_blob_upload` refuses above the site's `max_file_size` with a plain
   `ValidationError`. §11.2 says over quota is never anything else, so the
   bound is read first and reported as `DriveOverQuota`.
8. **A nearest-wins tie named the wrong source.** When an own grant and an
   open link tie at the same depth, §5.1 makes the own row the answer and
   `_authorizing_link` reports no link. The winner sort ordered on depth
   alone, so the same payload could name a link as `source` while `via_link`
   was false.
9. **The byte path and the breadcrumb path each spent a second point check.**
   §2.3 budgets one. `nodes.signed_content_url` mints from the row `get`
   already read; `children` returns its authorized parent row, so
   `?expand=breadcrumbs` no longer re-reads the folder. The re-read also let
   a grant revoked mid-request 404 a page the plain listing had answered.
10. **A truncated preview image answered 500.** Pillow raises `OSError` on a
    body that parsed as a header and then ran out. It maps to 400.
11. **A negative integer in a JSON body was accepted** where `?limit=-1` was
    already refused. `shapes.whole` refuses both.
12. **`?cursor=` empty string** reached the pager as a cursor. It is `None`.

**Tests added.** 16 site-free tests across `test_routes.py` and
`test_translator.py`, and 5 in `test_dispatch.py`: the patch body alternatives,
the batch savepoint name, the three expansions, the page envelope, the content
answer, chunk ordering, and the two link-source ties.

**Reviewed and found correct.** Route inventory against §11.2, `cmd` removal
and path precedence, the verb and Guest matrix against the table, savepoint
naming and one activity per successful mutation, restore with an explicit
parent, list and detail shape parity, the sixteen published fields and the
five withheld ones, and the ticket 19 and 20 handoffs.

### Deviations and open questions

1. **An unclaimed address answers JSON 404, not `werkzeug.NotFound`.** §11.1's
   sketch raises `NotFound`, which `frappe/app.py:164` turns into HTML. A
   `routes.unknown` handler raising `DriveNotFound` keeps one envelope for the
   namespace, and a verb mismatch cannot confirm that a path exists. Behaviour
   is the same status; the body differs from the sketch.
2. **`nodes.get` has no `expand` argument.** §8.1 sketches
   `get(p, node, *, expand=())`. Expansions live in `routes`, so `_core.nodes`
   does not import `previews` or `access.describe` for a read.
3. **An unparseable JSON body never reaches the translator.**
   `make_form_dict` runs before every `before_request` hook, so a malformed
   body is refused against the client's own path, and `get_api_version` scores
   it v1. That request answers the v1 error envelope, not §11.6's. No hook
   runs early enough to change it. Needs a product decision, or a Frappe
   change.
4. **A Guest call is HTML-sanitized by the framework.** `frappe.whitelist`
   applies `sanitize_html` to every string in `form_dict` for a guest-allowed
   method that is not `xss_safe`. A Guest creating a node titled `a<b` stores
   `a&lt;b`. This is framework behaviour on every guest route in Frappe, not
   Drive's. Left as is; flagged for the backend integration review (30).
5. **A blob id is a bearer capability at create time.** `_validated_blob`
   proves a blob is Ready, private, and matches the declared metadata. It does
   not prove the caller produced it. A caller who learns another root's blob id
   can attach a node to those bytes in their own root. Review found that blob
   ids are not secret: Drive publishes them itself, in the `/f/` redirect from
   `GET /nodes/<id>/content` and in every row of `GET /nodes/<id>/media`. A
   15-minute read of someone else's bytes therefore becomes a permanent owned
   node. §11.2 declares the argument, so it stays. Ticket 30 should decide
   whether `create_file` proves ownership.
6. **The site file cap bounds every Drive upload session.**
   `max_file_size` defaults to 25 MB, and it is checked on the declared size,
   so §11.2's own quota answer is reached only under it. The mapping is now
   413. The cap itself is a site configuration decision, and Frappe is read
   only here.
7. **Three framework behaviours the namespace cannot override.** An oversized
   body on a non-streaming route gets werkzeug's HTML 413 before any hook
   runs. `Accept: text/html` makes `handle_exception` answer an HTML error
   page instead of §11.6's envelope. `HEAD` on a GET row answers through
   `routes.unknown`, so it is a JSON 404. All three need a Frappe change or a
   product decision.
8. **Two Guests holding the same link share one upload session.** The binding
   records the link, not the caller, because a Guest has no identity to
   record. Session ids are unguessable, so this is a property of link
   sharing, not a hole. Recorded for ticket 30.
9. **N+1 blob reads in `preview_expansions` and `list_media`.** Each row costs
   one `frappe.get_doc("File Blob", ...)`. A page of 200 previews is 200
   reads. A batch fix needs a Frappe helper that mints many signed URLs, so it
   is out of this ticket's claimed files.
10. **`roots.usage_for` admits MANAGE holders.** §11.2 says "own root, or
    Suite Admin". A manager of a shared root can read its counters. Narrowing
    it is a product decision.
11. **`is_template` on `POST /nodes` is undeclared in §11.2.** It is accepted
    and it works. Either the spec row or the argument is wrong.
12. **§11.3 says breadcrumbs run "from the root down to the parent".** The
    code starts at the highest ancestor the caller can see, which is what
    §5.2 requires. The spec text disagrees with itself; the code follows
    §5.2.
13. **`content.touch` and `content.adopt_media` still test the node kind
    before they authorize.** They share the shape the media fix corrected, so
    a caller with no grant learns that a node exists and is not a document.
    Neither has an HTTP route in this ticket, and neither has a failing test,
    so fixing them here would be an unproved change to code ticket 21 does not
    expose. Recorded for ticket 30.
14. **The dispatch suite needs a content document, and no `_core` helper can
    make one.** `create_document` reads `drive_content_types`, which stays
    empty until ticket 29, so the fixture inserts the `Drive Node` row
    directly, the way `drive/tests/test_previews.py` already does. When
    ticket 29 registers a content type, the fixture should move to
    `create_document`.
15. **`storage_v2_on` patches a Frappe predicate, not the site.** The upload
    tests need `frappe.storage.enabled()` to answer True inside the request
    thread. The site config stays dormant. If ticket 29 turns
    `storage_v2` on for `slides.localhost`, this fixture becomes redundant
    and should go.

### Unresolved handoffs

- `BASELINE_DEBT` entry
  `suite/meet/api/test/test_recording.py|drive-table-write|Drive Root` names
  this ticket: "Replace with the Suite Admin root-administration route once
  HTTP root workflows land (21)." The route now exists
  (`PATCH`/`DELETE /roots/<id>`, `GET /roots/<id>/usage`). The Meet test was
  not migrated: it is outside this ticket's claimed files, and rewriting a
  fixture to make a live HTTP call needs the site gate. Left for Meet's owner.
- Ticket 20's media-link handoff needed no new minting. `content.list_media`
  already mints signed `/f/` URLs at a 15-minute TTL; the wording "mints none"
  refers to `composite_group`. Ticket 21 supplied only the route,
  `GET /nodes/<id>/media`.
- The pixel-bound handoff came from ticket 18, not ticket 19. It is
  implemented here either way.
- Ticket 22 owns the rest of §11.2: activity, visit, favourite, grants, links,
  views, versions, threads, comments, and notifications. The translator table
  and `routes.unknown` are shaped to take those rows without change.
- Ticket 18's handoff says ticket 21 owns the template route. It is
  superseded: ticket 22 owns every view row, `templates` included.
- A Guest reaching a session-only route gets 403 `PermissionError` from the
  framework, which confirms the path exists. §5.2 hides nodes, not routes, so
  this is left as is.
- Dormant content activation is untouched, as ticket 29 requires.
