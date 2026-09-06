# 22 — Expose sharing, views, history, and comments through HTTP

**What to build:** Complete the new API surface for sharing and node-associated records.

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** done

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

- [x] Wire grant listing, write, revoke, revoke-below, rotation, password unlock, and website link resolution.
- [x] Expose explanations through GET node grants with principal=. Require MANAGE on the target before evaluating another principal.
- [x] Freeze explanation response shape in adapter tests and client fixtures. Preserve resolver provenance and expired-row semantics.
- [x] DELETE removes the local grant only; PUT role 0 explicitly denies. Invalid grant arguments return HTTP 400 without mutation.
- [x] Wire all specified views, version operations, threads/comments, activity, visits, favourites, and notifications.
- [x] Keep pagination and expansion semantics consistent across endpoints. Notification and personal-list actions remain caller-scoped.
- [x] Exercise every route-table entry and all specified error classes, including locked versus expired links.

## Verification

Run route-table coverage and response-shape tests, with negative authorization cases for explanation, versions, comments, and notifications.

## Completion evidence

Status: implementation written, independently reviewed, fixed, and run through
the complete serialized site gate. All seven gate modules pass on
`slides.localhost`. The acceptance boxes are checked against real requests and
real database state, not against a reading of the code. The closeout below
records what each box rests on, and the one deviation inside criterion 3.

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

## Site gate, module 1 of 7

`suite.drive.http.tests.test_dispatch` now passes on `slides.localhost`. The
other six modules are not run yet. Status stays `in-progress` and the boxes
stay unchecked.

### The one failure, and what it was

First run, at commit `27f86ca89`:

```
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
Ran 154 tests
FAILED (failures=1)
TestUploads.test_a_head_replacement_swaps_the_bytes_and_moves_the_charge
AssertionError: 36 != 25
before = 22, first["size"] = 11, len(payload) = 36, after = 58
```

The test was wrong. The accounting was right.

The test asserted that a head replacement moves the charge, so the root gains
`new - old`. The spec says the opposite. §7.3 line 1625: "A replace charges the
new head size; the old head becomes a version and stays charged, unless it was
size 0, which is never kept." §8.2 line 1809 states the same rule as `+new_size`
in the workflow table. §9.1 line 2222 charges every version's size to the node's
root, and frees the bytes only when the version is deleted.

The code already does this. `nodes._replace_file` preserves a nonempty old head
as one auto version (`nodes.py:1021-1023`), then calls `admit(root, new_size)`
once (`nodes.py:1027`). `versions.preserve_file_head` inserts the version row and
calls neither `admit` nor `release` (`versions.py:425-442`), because the old
head's existing charge is now the version's charge. `quota.recompute_usage`
holds the same invariant: `used_bytes = nodes + versions + reserved`. A release
of the old head would show up as drift on the next nightly recompute.

The `_core` suite already pinned the rule.
`test_upload.py:290 test_replace_keeps_one_nonempty_head_and_charges_each_reference_once`
asserts `used_bytes == old.file_size + new.file_size` after a replace. The
dispatch test contradicted a passing test in the same repository.

`before = 22` is the fixture, not residue. `DriveHTTPCase.setUpClass` charges 11
bytes for `report.bin`, and the test's own upload charges 11 more. Each test
class builds its own root.

Agents traced the accounting path and the fixture. The diagnosis, the fix, and
this section are mine.

### Fix

`suite/drive/http/tests/test_dispatch.py`, one test and one helper:

- The test is renamed to `..._keeps_the_old_charge`, because the old name
  asserted the defect.
- The delta expectation is `len(payload)`, the new head in full.
- The retained bytes are now pinned to a row, not left implicit. The test reads
  the `Drive Node Version` that holds the superseded blob and asserts
  `seq = 1`, `kind = "auto"`, and `size = 11`. A silent loss of the version
  fails here, and a wrongly released charge fails on the delta.
- `TestUploads.drop_node` deletes version blobs as well as the head blob.
  `drop_node_rows` removes the version row, so the blob behind a replaced head
  outlived the fixture.
- One dead line is removed. The explicit `File Blob` cleanup ran before
  `drop_node`'s own `rollback()`, so it never deleted anything.

No production file changed. Ticket 29 dormancy is untouched: no
`drive_content_types` entry, no hook activation, no `site_config` change.

### The database-sensitive assumptions, settled

The full module passes, so the five assumptions this ticket flagged all hold on
`slides.localhost`: `revoke_below` reporting `rows: 2`, a restore answering
`{"seq": 2}`, `{"cleared": 1}` on `DELETE /views/recents`, `preview: null` under
`expand=preview`, and a default personal quota of 0 on a version take. The two
the review added hold as well: the `Drive Activity` count in `TestBatch` and the
`explain` lookup that could raise `StopIteration`.

### Commands and results

```
bench --site slides.localhost run-tests --module suite.drive.http.tests.test_dispatch
Ran 154 tests in 6.184s
OK
```

```
ruff 0.14.10 format --check suite/drive/http/tests/test_dispatch.py
1 file already formatted
ruff 0.14.10 check suite/drive/http/tests/test_dispatch.py
All checks passed!
```

Ruff here is 0.14.10, not the 0.12.3 the sections above used.

### Remaining gate

Six modules, serialized, one command at a time:

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_comments
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```

## Site gate, `suite.drive.tests.test_comments`

The module now passes on `slides.localhost`: 3 unit tests and 5 integration
tests, OK. Status stays `in-progress`. `test_activity`, `test_versions`,
`test_access`, `test_views`, and `test_grants` are not claimed here.

### The one error, and what it was

First run, at commit `84db9926f`: 3 unit tests passed, 4 of 5 integration tests
passed, and one errored.

```
TestCommentWorkflows.test_guest_name_and_link_attribution_distinguish_guest_authors
frappe.ValidationError: A Drive share link is created with the principal
$LINK, and its token is minted
```

The counts are the first run as reported. The message is the string
`_refuse_borrowed_link_token` throws.

The fixture was wrong. The refusal was right.

The test minted nothing. It called `grant(document, "$LINK:AAAA...", COMMENT,
admin)` with a token of its own choosing, twice. §5.9 step 1 and §11.2 both put
the token in the server's hands, so `$LINK:<token>` names a link that already
exists. This review's defect 1 added `_refuse_borrowed_link_token`
(`_core/access.py:1046`), which refuses a token that names no row at all. The
fixture's two tokens named no row, so the guard fired on the first line of the
test.

The guard is the anti-hijack invariant, not a bug. Without it a caller with
MANAGE writes `$LINK:aaaaaaaaaaaaaaaaaaaaaa` on their own node and calls the
guessable result a secret, or writes a victim's live token and makes
`/drive/l/<token>` resolve to whichever grant sorts first. `test_grants.py:738`
and `test_grants.py:745` pin both halves. Loosening the guard to let the fixture
through would delete the fix this ticket landed.

### Fix

`suite/drive/tests/test_comments.py`, one test and two dead constants:

- The fixture asks twice for the bare `$LINK` spelling and reads `principal`
  back off each result. That is the same shape `test_grants.py` uses.
- `LINK_A` and `LINK_B`, the two invented tokens, are deleted. Nothing else
  referenced them.
- The two minted principals are asserted distinct, so a mint that returned one
  token twice fails here instead of silently collapsing the guest identities
  the test exists to tell apart.
- Regression, new: the test now reads back the node's `$LINK:` grant rows and
  pins them to exactly the two minted principals. `_refuse_borrowed_link_token`
  looks at other nodes only, so two capability links on one node are legal.
  Tightening it to one link per node would break guest attribution, and the
  assertion says so at the point of failure.

No production file changed. The invariant is untouched.

Agents did not run here. The diagnosis, the fix, and this section are mine.

### Commands and results

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_comments
Ran 3 tests in 0.001s   OK   (unit)
Ran 5 tests in 0.415s   OK   (integration)
```

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<suite>:<frappe> \
  ../env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.tests.test_architecture
Ran 173 tests in 1.459s
OK
```

```
ruff 0.14.10 format --check suite/drive/tests/test_comments.py
1 file already formatted
ruff 0.14.10 check suite/drive/tests/test_comments.py
All checks passed!
```

### Remaining gate

Five modules, serialized, one command at a time:

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```

## Site gate, `suite.drive.tests.test_views`

The module now passes on `slides.localhost`: 10 unit tests and 12 integration
tests, OK. Status stays `in-progress`. `test_activity`, `test_versions`,
`test_access`, and `test_grants` are not claimed here.

### The two failures, and what they were

First run, at commit `35834c957`: 8 of 10 unit tests passed, 2 failed, and all
12 integration tests passed.

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
TestListingContract.test_a_short_fully_hidden_window_has_no_next_cursor
TestListingContract.test_limit_is_capped_and_short_raw_window_ends_paging
AssertionError: expected {'rows': [], 'next_cursor': None}
actual   {'rows': [], 'next_cursor': None,
          'parent': {'name': 'root', 'kind': 'root', 'root': None, 'path': ''}}
```

The tests were stale. The return shape is right.

Both cases assert whole-dict equality on what `_core.nodes.children` returns.
That return grew a third key in ticket 21's review commit `fcc9232d5`:
`page["parent"]` is the listed folder's own row (`nodes.py:2143-2146`). The
breadcrumbs expansion reads it there, so a trail costs no second read and no
second point check on the folder the page just listed, and a grant revoked
mid-request cannot 404 a page the plain listing already answered
(`routes.py:262-268`).

Nothing about §11.4 changed. The response envelope is minted by
`shapes.page`, which copies `rows` and `next_cursor` and nothing else
(`shapes.py:219-221`). `test_routes.TestPageEnvelope` already pins the
published page to those two keys, and its own fixture carries the third key
into the handler. §11.4 constrains the HTTP response. It says nothing about a
`_core` workflow's return, and the two are not the same value.

Dropping `parent` to satisfy the assertions would delete the read that ticket
21's review added and put a second point check back on the breadcrumbs path.
The tests move instead.

### Fix

`suite/drive/tests/test_views.py`, two assertions:

- Each expected dict gains the `parent` row the window's own fixture declares.
- Whole-dict equality is kept, not relaxed to per-key checks, so a fourth key
  appearing on the page still fails here.
- One comment on the first case says why the third key exists, at the point a
  reader meets it.

No production file changed. The sibling case
`test_folder_window_uses_exactly_three_queries_and_advances_past_hidden_rows`
was already written per key and needed nothing.

Agents did not run here. The diagnosis, the fix, and this section are mine.

### Commands and results

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_views
Ran 10 tests in 0.054s   OK   (unit)
Ran 12 tests in 0.953s   OK   (integration)
```

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<suite>:<frappe> \
  ../env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.tests.test_architecture
Ran 173 tests in 1.328s
OK
```

```
ruff 0.16.6 format --check suite/drive/tests/test_views.py
1 file already formatted
ruff 0.16.6 check suite/drive/tests/test_views.py
All checks passed!
```

Ruff here is 0.16.6. The bench venv holds no `ruff` binary; 0.12.3 from the
pre-commit cache reports the same two results.

### Remaining gate

Four modules, serialized, one command at a time:

```
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions
bench --site slides.localhost run-tests --module suite.drive.tests.test_access
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants
```

## Site gate, complete, and closeout

Every command in the required serialized gate ran on `slides.localhost` and
passed. 252 tests across seven modules. The status becomes `done` and all seven
acceptance boxes are checked. Criterion 3 carries one deviation, recorded below.

### Revisions at closeout

- Suite start `d1f78cc2c76e5d34777bb81ad2496e068ff61899` on
  `implement/drive-22-http-sharing-records`.
- Implementation `9fb39f793`. Independent review `27f86ca89`, which carries the
  review fixes in `2494a2b90`.
- Gate branches off `main`: `forge/drive-22-comments-gate` at `35834c957`,
  `forge/drive-22-views-gate` at `684acc1d7`.
- Gate test repairs: `f51537b87` (dispatch), `c01f64475` (comments),
  `2735935c4` (views).
- The gate ran against `684acc1d7`. The last production change is `2494a2b90`.
  Every commit after it touches three test files and this ticket only, so no
  gate result is stale.
- Closeout on `forge/drive-22-closeout`, this commit.
- Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, read only, unchanged.
  Confirmed at closeout: `forge/storage-v2`, working tree clean.

### The gate, run

`bench --site slides.localhost migrate` ran first and passed. Then each module,
serialized, one command at a time, nothing else touching the site.

| Command (`bench --site slides.localhost run-tests --module ...`) | Result |
|---|---|
| `suite.drive.http.tests.test_dispatch` | `Ran 154 tests in 6.184s` OK |
| `suite.drive.tests.test_activity` | 8 integration OK |
| `suite.drive.tests.test_versions` | 7 unit OK, 10 integration OK |
| `suite.drive.tests.test_comments` | 3 unit OK, 5 integration OK |
| `suite.drive.tests.test_access` | 12 unit OK |
| `suite.drive.tests.test_views` | 10 unit OK, 12 integration OK |
| `suite.drive.tests.test_grants` | 31 integration OK |

Each count matches the module. The test methods in the working tree are 154, 8,
17, 8, 12, 22, and 31, and the `UnitTestCase` and `IntegrationTestCase` split of
each file matches the reported categories exactly.

`logs/bench.log` and `logs/frappe.testing.log` hold the invocation record:
migrate at 17:22:13, then dispatch, activity, versions, comments, access, views,
grants, in that order, ending at 17:36:25.

**Three modules needed a rerun. Four passed first time.**

- `test_dispatch` failed once on one accounting expectation, fixed in
  `f51537b87`. Recorded above under "Site gate, module 1 of 7".
- `test_comments` errored once on a fixture that minted its own link token,
  fixed in `c01f64475`. Recorded above.
- `test_views` failed twice on a stale whole-dict assertion, fixed in
  `2735935c4`. Recorded above. The log shows three `test_views` invocations. The
  first failed, the last passed, and the middle one holds no preserved result.
- `test_activity`, `test_versions`, `test_access`, and `test_grants` each ran
  once and passed. No fix was needed for any of them, and no file they cover has
  changed since.

No production file changed anywhere in the gate. All three repairs are test
files. Ticket 29 dormancy is untouched: no `drive_content_types` entry, no hook
activation, no `site_config` change.

### Closeout checks, run at `684acc1d7`

```
cd /home/faris/benches/suite-bench/sites && PYTHONPATH=<suite>:<frappe> \
  ../env/bin/python -m unittest suite.drive.http.tests.test_translator \
  suite.drive.http.tests.test_shapes suite.drive.http.tests.test_routes \
  suite.tests.test_architecture
Ran 173 tests in 1.554s
OK
```

```
ruff 0.14.10 format --check <22 changed .py paths>   22 files already formatted
ruff 0.14.10 check <22 changed .py paths>            All checks passed!
ruff 0.12.3  format --check <same>                   22 files already formatted
ruff 0.12.3  check <same>                            All checks passed!
```

The changed set is `d1f78cc2c..684acc1d7`: 22 Python files, plus `.gitignore`,
`suite/www/drive_link.html`, and this ticket. Neither ruff version reports
anything on any of them.

### What each box rests on

Agents audited the criteria against the code and the spec. The reconciliation
below is mine.

1. **Grant wiring.** All seven pieces have a route row, a handler, and a `_core`
   workflow: list (`translator.py:59`), write (`:65`), revoke and revoke-below
   (`:66`, `?below=1`), rotate (`:67`), unlock (`:68`), and the website link page
   (`hooks.py:53` to `www/drive_link.py:43`). Pinned by `test_dispatch.py:1454`
   to `:1642`, `test_routes.py:357`, and `test_grants.py:775`.
2. **Explanation gating.** `routes.py:566` passes the subject as an unresolved
   callable. `grants_for` calls `require(node, MANAGE, ...)` at `access.py:586`
   and invokes the subject only at `:600`. `test_routes.py:524` proves the
   resolver is never called when the gate refuses.
3. **Explanation shape.** `shapes.explain_shape:151` publishes exactly
   `{role, source, rows}`, frozen by `test_shapes.py:306` and `:309`.
   Provenance keys `node`, `principal`, `pass`, `held`, and `winner` survive.
   Expired rows list on `grants_for` and are absent from `explain`
   (`test_grants.py:360`, `:410`). See the deviation below.
4. **Delete and deny.** Neither delete path reaches `access.grant`
   (`test_routes.py:612`). Role 0 denies through `shapes.whole`
   (`routes.py:611`). A missing or blank role throws at `routes.py:606` before
   the workflow, and no-mutation is pinned at `test_routes.py:565`, `:631`,
   `:655` and `test_grants.py:150`.
5. **Record wiring.** 42 route rows, matching §11.2 row for row: 15 nodes,
   3 uploads, 5 grants and links, 2 views, 12 versions and comments, 5
   notifications and roots. No declared row lacks a route and no route lacks a
   row. Every view name dispatches from `nodes.py:2166`, and an unknown name
   answers 400 at `:2203`.
6. **Pagination and scope.** One cursor implementation, `nodes.encode_cursor`,
   `decode_cursor`, `page_of`, and `page_limit`, used by children, views,
   personal views, versions, activity, and notifications. The HTTP envelope is
   two keys, minted once in `shapes.page:219`. One expansion parser,
   `shapes.expansions:276`, refusing an unknown name with 400. Every handler
   takes identity from `_principals()` alone (`routes.py:115`), and no route
   accepts a user or principal argument for notifications, recents, favourites,
   or visits.
7. **Route and error coverage.** Every one of the 42 rows is reached by a real
   request in `test_dispatch.py`. All seven §11.6 classes are exercised.
   Locked and expired stay distinct: `test_dispatch.py:1659` asserts 401
   `DriveLocked` with `WWW-Authenticate: DriveLink realm="drive"`, and `:1665`
   asserts 410 `DriveLinkExpired` on the same link.

### Deviations

1. **Criterion 3 has no client fixture.** The explanation shape is frozen in
   adapter tests only. The repo holds exactly one client contract fixture,
   `frontend/src/apps/slides/contracts/composite-groups.fixture.json`, from
   ticket 20. No Drive HTTP equivalent exists. The spec never asks for one: the
   accepted decision for `explain` says "Test authorization and response shape",
   and §5.8 fixes the shape. The SPA consumes no Drive route yet, so a fixture
   would pin a contract with no client on the other end. The box is checked on
   the adapter half. The client half is handed to ticket 33, which owns sharing
   in the SPA.
2. **Route-table coverage is asserted at the translator, not at dispatch.**
   `test_translator.py:116` asserts `len(cases) == len(translator.ROUTES)` and
   that each path reaches its handler with its path ids. Nothing asserts that
   every row receives a real request. The one row no request reached,
   `PUT /nodes/<id>/content`, was found by review reading, not by a failing
   test, and is now covered at `test_dispatch.py:1024`. A dispatch-level
   coverage assertion would have caught it. Recorded for ticket 30.
3. **`test_every_declared_status_is_reachable_over_http` covers three classes.**
   `test_dispatch.py:1270` checks 404, 400, and 409. The other four §11.6
   classes are each covered by a separate case, not by that test. The name
   overstates what it asserts.
4. **One negative authorization case lives in `_core`, not over HTTP.** A
   non-author without EDIT patching or deleting a comment is pinned at
   `test_comments.py:96`. No HTTP case sends it. Explanation, versions, and
   notifications all have HTTP negative cases.
5. **`test_activity.py` and `test_versions.py` carry no cursor or limit case.**
   §11.4 for those two domains rests on the shared helper and on the HTTP tests.
6. **The explanation shape follows §5.8, not §11.2's table cell.** Already
   recorded as decision 1. The spec cell should be corrected to an object.

### Handoffs, at closeout

Closed by this ticket:

- The caller-supplied link token handoff is fixed. `access.grant` refuses a
  `$LINK:<token>` principal that names no grant, or one whose live grants sit on
  another node. `test_grants.py:738` and `:745` pin both halves.
- The version MIME handoff was overstated. A file node's version reuses the
  node's head blob, which carries `mime_type`.
- The favourite-clearing oracle was refuted. `set_favourite` answers `{}` for
  any node id.

Open, and not this ticket's work:

- **The SPA cannot use a resolved link.** `/drive/g/<node>` is still the legacy
  `File` page. It reads neither `?link` nor the fragment the resolver now uses.
  A shared link resolves and lands on a page that cannot spend the token. This
  is the largest remaining gap in the feature. Ticket 33 owns it.
- The "Reported, not fixed" list above stands for ticket 30: the grant read
  ordering in `rotate_link`, the 403/404 asymmetry between grant writes and
  reads, `revoke_below` reading `frappe.db._cursor.rowcount`, the unbounded
  `{"all": true}` notification read, the guest mention oracle, `HEAD` answering
  404, and the two undeclared arguments.
- Ticket 29 dormancy is preserved.

### Bench note

`suite-bench` runs no RQ worker. Each run leaves background jobs queued, and the
`short` queue reaches `frappe.QueueOverloaded` if it is not emptied between runs.
