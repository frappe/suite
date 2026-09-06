# 21 — Expose node, upload, and root workflows through HTTP

**What to build:** Let clients create and organize nodes, upload bytes, and administer roots through the new route namespace.

**Blocked by:** [17 — Move Writer lifecycle and history into Drive](17-writer-adoption.md); [19 — Move Sheets lifecycle and collaboration checks into Drive](19-sheets-adoption-and-collab.md); [20 — Load composite references in authorized groups](20-composite-group-contract.md)

**Status:** in-progress

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

- [ ] Implement the translator with PATH_INFO and cached request-path correction. Delegate authentication and response envelopes to Frappe.
- [ ] Declare allowed verbs and Guest access per route. Path ids override conflicting request arguments, and cmd cannot redirect dispatch.
- [ ] Wire node CRUD, copy, content, media, previews, uploads, and root usage/admin routes to shared workflows.
- [ ] Accept parent plus Active state for an explicit restore destination. Return a conflict when user choice is missing.
- [ ] Keep list and detail node shapes identical, with effective root id and opt-in access, breadcrumbs, and preview expansions.
- [ ] Implement batch outcomes with independent rollback per failed item and one activity per successful mutation.
- [ ] Map Drive errors and plain ValidationError to the specified status and v2 envelope. Authorize all byte egress.
- [ ] Keep raw blob creation inputs within the caller’s authorized workflow; client metadata cannot bypass byte validation or accounting.

## Verification

Run HTTP tests through actual request dispatch for session/API-key/Guest calls, streamed chunks, restore, mixed batches, and unauthorized egress.

## Completion evidence

Status: implementation and tests written. Acceptance boxes stay unchecked
because the dispatch suite has not run. It needs the shared site.

### Revisions

- Suite start `501e4cea41971f942782ef06fe45e626eebdeb39`, work through
  `7801dc0052663446650e89bd3a1f6a1ea45c6b2c` on
  `implement/drive-21-http-workflows`.
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
8. Raw blob inputs stay inside the authorized workflow: `POST /nodes` and
   `PATCH /nodes/<id>` accept §11.2's declared `blob`, `size`, and `mime` and
   hand them to `create_file` / `_replace_file`. `_validated_blob` refuses
   unless the declared pair matches the stored blob row, the node is written
   from the stored values, and `admit` charges the stored size. Client
   metadata can fail the create; it cannot change what is written or billed.

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

### Not verified

`suite/drive/http/tests/test_dispatch.py` has not run. 91 tests, all needing
the shared site. This worktree may not run bench, migrate, install, or restart
services, so the whole dispatch suite is unverified, including every claim
about real status codes, real envelopes, and real accounting.

### Required serialized site gate

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
bench --site slides.localhost run-tests --app suite --module suite.drive.webdav.tests.test_dispatch
```

The last five are regression cover: this ticket changed `_core/nodes.py`,
`_core/access.py`, `_core/content.py`, `_core/roots.py`, `_core/upload.py`,
`_core/previews.py`, and `before_request`.

A background worker must be running, or Drive tests fail with
`QueueOverloaded` on this bench.

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
   can attach a node to those bytes in their own root. §11.2 declares the
   argument, so it stays. Recommend a Drive-side ownership check on
   `create_file` be considered by ticket 30.

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
- Dormant content activation is untouched, as ticket 29 requires.
