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

## Independent review

Reviewed on `review/drive-22-http-sharing-records`, a separate worktree, over
`d1f78cc2c..9fb39f793`. The implementation report above was not trusted. Every
acceptance criterion, every new route, and every documented concern was checked
against the code and against §11.2–§11.4, §11.6, and the resolver, grant,
sharing, record, pagination, security, and architecture sections they cite.

The status stays `in-progress` and the boxes stay unchecked. The site gate has
not run.

Agents audited grants and links, record authorization, and route and test
completeness. The fixes, the refutations, and this section are mine.

### Defects found and fixed

Ordered by severity.

1. **A caller with MANAGE could steal or brick another node's share link.**
   `PUT /nodes/<id>/grants/$LINK:<token>` wrote a caller-supplied token
   verbatim. Two grants could then carry one token. `resolve_share_link` would
   answer the attacker's node, and `unlock_link` would see "ambiguous password
   grants" and refuse the victim's link with 403 forever. `access.grant` now
   refuses a `$LINK:<token>` principal that names no grant at all, and refuses
   one whose live grants sit on another node. The bare `$LINK` spelling, which
   mints a server token, is unchanged, and so is updating or denying a token
   the node already holds. This closes the ticket's own second handoff note.
   (`_core/access.py`)
2. **`?principal=` was a site-wide user oracle.** `node_grants` resolved the
   named principal, which reads `User`, before `grants_for` checked MANAGE. A
   caller with no role on the node learned whether any address exists.
   Acceptance criterion 2 and the handler's own docstring both say the gate
   comes first. `grants_for` now takes the subject as a callable and invokes it
   after `require(node, MANAGE, ...)`. (`_core/access.py`, `http/routes.py`)
3. **Activity leaked link tokens to every reader.** `activity_shape` published
   `via_link` and `detail.principal` verbatim, so a `share_add` row handed any
   READ holder, guest included, a live EDIT-grade token. Both are now masked to
   `$LINK`. The source row is not mutated. (`http/shapes.py`)
4. **The share token rode the redirect query string.** `/drive/l/<token>` sent
   the browser to `/drive/g/<node>?link=<token>`, which lands in the reverse
   proxy log, Frappe's log, and the `Referer` of every outbound link and
   third-party subresource the SPA loads. It is a bearer capability. It now
   rides the URL fragment, which is never sent to a server. (`www/drive_link.py`)
5. **Six guest-reachable routes ran their strings through `sanitize_html`.**
   `is_whitelisted` sanitizes every Guest `form_dict` string unless
   `xss_safe=True`. A guest comment, a thread anchor, a version label, and a
   link password were all rewritten in transit. Each mangled password still
   burned one of the five unlock tries. The six handlers now declare
   `xss_safe=True`. Escaping belongs at render, not at the boundary.
   (`http/routes.py`)
6. **`PATCH .../versions/<seq>` cleared the field the caller did not name.**
   Sending `{"label": "Release"}` unpinned the version, destroying §9.1
   retention. `label_version` now takes a `KEEP` sentinel per field, refuses a
   call that names neither, and returns the resulting state.
   (`_core/versions.py`, `http/routes.py`)
7. **`recents` and `favourites` ignored the three §11.2 view exclusions.**
   A starred root, a starred template, or a starred child of a document node
   appeared in a personal list. `_personal_view` now filters all three.
   (`_core/nodes.py`)
8. **Three views published an incomplete node shape.** `SHARED_SQL`,
   `TRASH_SQL`, and `TEMPLATES_SQL` selected a partial column list, so
   `url`, `content_modified`, and the content columns were missing from rows
   §11.3 declares whole. All four view queries now project `NODE_FIELDS_N`.
   (`_core/nodes.py`)
9. **`role=""` became an explicit deny.** An empty string coerced to 0, which
   is `NONE`, so a malformed write silently denied a principal. `node_put_grant`
   now refuses a blank role with 400 before the workflow. (`http/routes.py`)
10. **A subject's explanation understated its access.** `principals_for_principal`
    gave no `$PUBLIC` to a `$GENERAL`, `$GROUP:`, or `$LINK:` subject, so
    `explain` reported less than the principal actually holds (§6.5). It also
    accepted any string Frappe happened to have a `User` for, including
    `Administrator` and `Guest`, which are not §4.4 spellings. Both fixed.
    (`framework.py`)
11. **The subject inherited the caller's link header.** When `?principal=`
    named the caller, `principals_for` returned the request's own
    `X-Drive-Links` tokens and unlock tickets, so a password link explained as
    unlocked. The subject is now stripped of both in every case. (`framework.py`)
12. **`password: ""` was hashed and stored.** A blank password produced a link
    that `_grant_is_unlocked` reads as locked and that no password opens.
    `node_put_grant` now coerces a blank password to `None`. (`http/routes.py`)
13. **`unlock_link` and `resolve_link` disagreed on a deny-only token.**
    One answered 403, the other 404, for the same token. Both now answer 404.
    (`_core/access.py`)
14. **An unbounded cursor offset reached the database.** A crafted cursor
    decoding to a huge offset produced a MariaDB error and a 500 with a
    traceback instead of §11.6's 400. `decode_cursor` now bounds the offset and
    rejects a non-canonical integer. (`_core/nodes.py`)

### Documented concerns, investigated

- **Missing version MIME.** Overstated. A file node's version reuses the
  node's head blob, which carries `mime_type`, so a version download is served
  with the same type as the node itself. No change made.
- **Caller-supplied link token uniqueness and entropy.** Real. Fixed as
  defect 1. Entropy is now moot for a fresh token, because only the bare
  `$LINK` spelling mints one, and that path uses the server's generator.
- **Favourite clearing as an id oracle.** Refuted. `set_favourite` answers
  `{}` for any node id, whether or not the row exists and whether or not the
  node exists. It confirms nothing. The handoff note is inaccurate.
- **Database-sensitive dispatch assumptions.** Confirmed as a real gate risk
  and left as written, because they can only be settled by running them. The
  `rowcount` assumption behind `rows: 2`, the empty-`Drive Recent` assumption
  behind `{"cleared": 1}`, and the `preview: null` assumption are all
  site-state dependent. Two more of the same kind were found: an unfiltered
  site-wide `Drive Activity` count in `TestBatch`, and an `explain` lookup that
  raises `StopIteration` if the fixture user picks up `Suite Admin` from
  another module.

### Reported, not fixed

Out of this ticket's scope, or a spec question rather than a defect.

- The SPA route `/drive/g/<node>` the link page redirects to is the legacy
  `File`-based page. It reads no `?link` and no fragment. Until tickets 32–33
  rebuild it, a shared link resolves and then lands on a page that cannot use
  the token. This is the largest remaining gap in the feature as a whole.
- `explain`'s shape is §5.8's object; §11.2's table cell writes a list. The
  implementation decision to follow §5.8 is right, and the spec cell should be
  corrected.
- `rotate_link` reads the grant row before it checks MANAGE, so it separates
  "no such grant" from "not yours" for a caller with neither.
- Grant writes answer 403 where grant reads answer 404 for the same unreachable
  node.
- `revoke_below` writes an activity row for zero deletions and reads
  `frappe.db._cursor.rowcount`, a private attribute.
- `POST /notifications/read` with `{"all": true}` is an unbounded N+1.
- The guest mention list is a user-address oracle.
- `HEAD` on a GET route answers 404, because the route table matches on the
  literal method.
- `view_clear_recents` accepts an undeclared `nodes` list, and `node_create`
  accepts an undeclared `is_template`.
- `test_translator.py:291` asserts the opposite of what its name says, and two
  ordering comments in `translator.py` describe a rule the code does not apply.

### Tests added by this review

| File | Added | Total | Run here |
|---|---|---|---|
| `http/tests/test_shapes.py` | 4 | 46 | yes |
| `http/tests/test_routes.py` | 20 | 95 | yes |
| `http/tests/test_dispatch.py` | 5 | 154 | no, needs a site |
| `tests/test_grants.py` | 5 | 31 | no, needs a site |
| `tests/test_views.py` | 2 | 22 | no, needs a site |
| `tests/test_versions.py` | 0 | 17 | no, needs a site |

The five new `test_dispatch.py` cases send `PUT /nodes/<id>/content`, the one
§11.2 route-table entry that no request reached. The existing version-label
test was extended rather than duplicated.

### Commands and results, this review

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<worktree>:<frappe> \
  env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.tests.test_architecture
Ran 173 tests in 1.268s
OK
```

```
env/bin/python -m compileall -q suite/drive suite/www suite/tests
(no output, exit 0)
```

```
ruff 0.12.3 format --check <22 changed files>
22 files already formatted
ruff 0.12.3 check <22 changed files>
All checks passed!
```

Not run: `test_dispatch.py` and the `_core` suites. They need a live site.

### Required site gate, after this review

Unchanged from the list above. Every module this review edited is already on
it. Serialized, on `slides.localhost`, one command at a time:

```
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_comments
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```
