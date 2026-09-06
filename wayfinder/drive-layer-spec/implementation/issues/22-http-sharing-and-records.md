# 22 — Expose sharing, views, history, and comments through HTTP

**What to build:** Complete the new API surface for sharing and node-associated records.

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** in-progress

**Owner:** Suite Drive HTTP

**Starting revision:** Suite `d1f78cc2c76e5d34777bb81ad2496e068ff61899` on
`implement/drive-22-http-sharing-records`; Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/drive/http/translator.py`,
`suite/drive/http/routes.py`, `suite/drive/http/shapes.py`,
`suite/drive/http/tests/*`, `suite/drive/_core/access.py`,
`suite/drive/_core/activity.py`, `suite/drive/_core/comments.py`,
`suite/drive/_core/nodes.py`, `suite/drive/_core/versions.py`,
`suite/drive/framework.py`, `suite/hooks.py`, `suite/www/*` for the website
link route, `suite/tests/test_architecture.py`, and this ticket.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.2–11.4, §11.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Wire grant listing, write, revoke, revoke-below, rotation, password unlock, and website link resolution.
- [ ] Expose explanations through GET node grants with principal=. Require MANAGE on the target before evaluating another principal.
- [ ] Freeze explanation response shape in adapter tests and client fixtures. Preserve resolver provenance and expired-row semantics.
- [ ] DELETE removes the local grant only; PUT role 0 explicitly denies. Invalid grant arguments return HTTP 400 without mutation.
- [ ] Wire all specified views, version operations, threads/comments, activity, visits, favourites, and notifications.
- [ ] Keep pagination and expansion semantics consistent across endpoints. Notification and personal-list actions remain caller-scoped.
- [ ] Exercise every route-table entry and all specified error classes, including locked versus expired links.

## Verification

Run route-table coverage and response-shape tests, with negative authorization cases for explanation, versions, comments, and notifications.

## Completion evidence

Status: implementation and tests written. Not reviewed. Not run through the
site gate. The acceptance boxes stay unchecked until both happen.

### Revisions

- Suite start `d1f78cc2c76e5d34777bb81ad2496e068ff61899`, work on
  `implement/drive-22-http-sharing-records`.
- Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, read only, unchanged.

### Changed behavior

**New: 25 rows in the §11.2 route table.** `translator.py` now holds 42 rows,
which is every row §11.2 declares. The new ones are grants (4), rotate,
unlock, views (2), versions (6), threads and comments (6), activity, visit,
favourite (2), and notifications (2).

**New: handlers in `routes.py`.** Each one calls a `_core` workflow and adds no
rule of its own. Notable boundary decisions:

- `node_grants` checks MANAGE on the caller before it resolves `?principal=`.
  Whether the named person can reach the node is the question, never a
  condition on the right to ask it.
- `node_put_grant` refuses a missing `role` before it calls the workflow, and
  pre-checks nothing else. A pre-check would answer ahead of the MANAGE gate
  and tell a caller without it which rule they broke.
- `node_delete_grant` never calls `access.grant`, so a delete cannot write a
  deny. `?below=1` selects `revoke_below`.
- `grant_rotate` addresses the `Drive Grant` id, not the token, so the secret
  being replaced never enters an access log.
- `_route` re-raises `frappe.RateLimitExceededError` before its catch-all. A
  locked-out link keeps its 429 instead of flattening to 400.
- `view_list` passes each view only the filters §11.2 declares for it, so
  `?term=` cannot reach `trash` and be silently ignored.

**New: workflow support in `_core`.**

- `nodes.page_of` and `nodes.page_limit` are public. `activity` and `versions`
  page through them, so every list route shares §11.4's cursor rule.
- `access.grants_for` reads the node once and checks MANAGE once.
- `access.explain` gates on the caller and computes against a separate
  `subject`. Before this change, asking about another principal checked that
  principal's role, not the caller's. That was a real defect on an unreleased
  function; no route had reached it yet.
- `access.resolve_link` answers a token with its node.
- `versions.version_content_url` mints a version's signed `/f/` URL.
- `comments.create_thread` answers `{thread, comment}`.
- `framework.principals_for_principal` turns one principal spelling into an
  identity. The subject never inherits this request's `X-Drive-Links` header
  and never carries an unlock ticket, so a password link explains as locked.

**New: `GET /drive/l/<token>`.** A website route, not an API route. It resolves
the token, redirects to the SPA's kind-agnostic `/drive/g/<node>`, and carries
the token in `?link=`. No role is checked: resolution answers which node, never
whether. An unknown token renders 404 and an expired one renders 410.
`suite.www` may import only `suite.drive`, so `resolve_share_link` joined the
public interface and the frozen list in `test_architecture`.

**Changed: one grant reading.** `has_password` tested the column against
`None`, while `_grant_is_unlocked` tests it for truth. An empty string would
have read as locked on the listing and open in the resolver. Both now use
truthiness.

### Decisions

1. **Explanation shape.** §11.2's table writes `explain?: [...]`, a list. The
   accepted decision cites "§5.8, §11.2" for the shape. The code publishes
   §5.8's object: `{role, source, rows}`. A bare list drops `source`, and
   `source` is the only way the site-admin case is expressible at all
   (`rows: []`, `source: "site admin"`). Provenance is an acceptance
   criterion, so the object wins.
2. **Expired rows.** `grants_for` lists expired rows, because §6.4 retains
   them and hiding one would invite a duplicate write. `explain` excludes
   them, because `EXPLAIN_SQL` filters them and an inert row is not a
   candidate.
3. **Guest access.** Grants, views, personal marks, notifications, and version
   delete are session only. A link caps at EDIT and `$PUBLIC` at READ, so no
   principal a guest can present reaches MANAGE. Personal records key on
   `principals.user`, so a `Guest` recents list would be one list for every
   anonymous visitor. Unlock, versions, threads, comments, and activity stay
   guest reachable.
4. **Expansion on a view.** Only `expand=preview`. The page's ids are already
   permission filtered, so previews cost one query for the whole page.
   `access` and `breadcrumbs` are refused with 400 rather than faked.
5. **Client fixtures.** This repo has no separate client fixture directory for
   Drive HTTP, and the ticket does not claim the frontend. The frozen shapes
   live as explicit key lists in `test_shapes.py` and `test_dispatch.py`.

### Commands and results

Site-free, run in this worktree:

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<worktree>:<frappe> \
  env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.tests.test_architecture
Ran 149 tests in 1.260s
OK
```

```
env/bin/python -m compileall -q suite/drive suite/www suite/tests
(no output, exit 0)
```

```
ruff 0.12.3 format --check suite/drive suite/www suite/tests
2 files would be reformatted, 202 files already formatted
ruff 0.12.3 check suite/drive suite/www suite/tests
Found 1 error.  (E722, suite/drive/patches/team_restructure.py:56)
```

Both remaining format complaints and the one lint error are pre-existing and
untouched by this ticket: `suite/drive/doctype/drive_grant/drive_grant.py`,
`suite/drive/tests/benchmark_views.py`, and the bare `except` in
`suite/drive/patches/team_restructure.py`.

Not run: `test_dispatch.py` and the `_core` suites. Both need a live site and
a database.

### Tests written

| File | Added | Total | Run here |
|---|---|---|---|
| `http/tests/test_shapes.py` | 29 | 42 | yes |
| `http/tests/test_routes.py` | 44 | 75 | yes |
| `http/tests/test_dispatch.py` | 52 | 149 | no, needs a site |

`test_dispatch.py` adds `TestGrantRoutes`, `TestShareLinkRoutes`,
`TestViewRoutes`, `TestVersionRoutes`, `TestThreadRoutes`, `TestRecordRoutes`,
and `TestNotificationRoutes`. One existing case moved:
`test_an_unclaimed_path_answers_json_not_html` sent `/grants`, which this
ticket claims, so it now sends `/history`.

Agents wrote the three test files. The evidence and the route table are mine.

### What a database run could still contradict

The dispatch cases were never executed. These assumptions are the ones a gate
run would break first:

- `revoke_below` is asserted to report exactly `rows: 2`, which trusts
  `rowcount` on a multi-table `DELETE ... JOIN`.
- A restore is asserted to answer `{"seq": 2}`, which holds only while the
  fixture file's head is non-empty.
- `{"cleared": 1}` on `DELETE /views/recents` assumes the owner's `Drive
  Recent` table starts empty for that case.
- `expand=preview` is asserted to yield `preview: null`, which a stray `Drive
  Node Preview` row would change.
- A version take assumes the gate site's default personal quota is 0.

### Required site gate

Serialized, on `slides.localhost`, one command at a time:

```
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_comments
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```

`test_activity`, `test_versions`, and `test_comments` were edited for the new
page and return shapes, so they are part of the gate even though the ticket did
not change their subject.

### Unresolved handoffs

- A version blob carries no MIME column, so a version download is served as
  `application/octet-stream` on S3. The node's own `mime` is not copied onto
  the version row. Fixing that is a storage change, not an HTTP change.
- `PUT /nodes/<id>/grants/$LINK:<token>` accepts a caller-supplied token
  verbatim. `access.grant` mints one only for the bare `$LINK` spelling. A
  caller with MANAGE can therefore write a token of their choosing, and
  nothing checks it for uniqueness or entropy.
- `set_favourite` skips the READ check when it clears a mark. That is
  deliberate, so a star on a node the caller lost access to stays removable,
  but it means the route confirms a node id the caller cannot read.
- Ticket 29 dormancy is preserved. No `drive_content_types` entry, no hook
  activation, no `site_config` change.
