# 47 — Filter the recents view by content doctype

**What to build:** `GET /api/suite/drive/views/recents` accepts `?content_doctype=` and returns only the caller's recent document nodes of that type. The unified frontend's Recent view uses it for its `type` filter, which replaces the old per-type lists at `/writer`, `/sheets`, `/slides`, `/drive/documents` and `/drive/presentations`.

**Asks:** D31 (unified frontend spec §15.1).

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** done

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** the critical decisions review of 2026-09-29, recorded in unified frontend ticket [022 — Fold decisions into the spec and plan](../../../unified-frontend/tickets/022-fold-decisions-into-the-spec-and-plan.md). Faris chose per-type redirects to a filtered Recent view. Unified plan stage 11 (Document surfaces complete, Drive sub-lane) waits on it for the Recent type filter.

**Source:** [Drive spec](../../drive-layer-spec.md), §9.5 (`Drive Recent`), §11.2 "Views" (`recents`, and `templates` for the existing `?content_doctype=` filter), §11.4 (cursor). Unified frontend spec §5.1 (Recent `type` filter), §14.3 (redirect rows).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] `GET /views/recents?content_doctype=<doctype>` returns only rows whose node is a `document` with that `content_doctype`. Without the argument the answer is unchanged.
- [x] The filter runs in the query, not on the fetched window. A page never comes back short or empty because rows of other types filled the window, and the cursor stays opaque and correct across pages.
- [x] Newest `opened_at` first, `opened_at` on each row, and the `access` and `preview` expansions work as today.
- [x] `_view_filters` in `suite/drive/http/routes.py` passes `content_doctype` to `recents` only, the same way it does for `templates`. `suite.drive._core.activity.recents` takes the filter.
- [x] An unknown doctype returns an empty page, not an error.
- [x] Typed shapes stay in `suite/drive/http/shapes.py`; one `Route` row change in `suite/drive/http/translator.py` if the query string needs it.
- [x] Tests cover: the filter for each of the three document doctypes; a mixed history where the first unfiltered window holds no match and the filtered page is still full; cursor paging over two pages; an unknown doctype; no argument.
- [x] Documentation synced in the same change: Drive spec §11.2 "Views" (the `recents` row).

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_http`, `test_translator`, and `suite.drive.tests.test_activity`. Record real output.

## Notes

- `activity.recents` pages `Drive Recent` by offset and drops unreadable rows after the query (`_visible_personal_rows`). The type filter needs a join on `Drive Node` inside the query.
- The frontend maps `type=writer|sheets|slides` to a content doctype through its document registry. The server sees only `content_doctype`.

## Completion evidence

Uncommitted work on `forge/drive-47-recents-doctype-filter`, based on `forge/drive-layer` at `4d879dff0`. Recorded 2026-09-30.

**Changed behavior**

- `activity.recents` takes `content_doctype`. When set, the query keeps only `kind = 'document'` nodes of that type, before `LIMIT`/`OFFSET`.
- Both the filtered and the unfiltered recents now:
  - order by `opened_at DESC, name DESC`, so visits with the same timestamp page once each;
  - keep only `state = 'Active'` nodes, so a trashed node leaves recents;
  - read further windows, at most `MAX_RECENT_WINDOWS` (5), while unreadable rows leave the page short. The cursor points past the last row read.
- `nodes.views` passes `content_doctype` through `_personal_view` to `recents` only. `_view_filters` in `routes.py` passes it to `templates` and `recents`.
- No translator row or shape change. `ViewQuery` already declared `content_doctype`, so the generated frontend contract is unchanged.
- Drive spec §11.2 "Views": the `recents` row names the filter and the Active rule.

**EXPLAIN** on `slides.localhost`, with 5,000 temporary Recent rows for 50 users (since deleted):

| Query | First table | Key | key_len | Then |
|---|---|---|---|---|
| Before (no join hint) | `tabDrive Node` | `node_content` | 563 | `tabDrive Recent` on `recent_user_node`, 1126; temporary and filesort |
| After (`STRAIGHT_JOIN`), filtered or not | `tabDrive Recent` | `recent_user_opened` | 563 | `tabDrive Node` on `PRIMARY`, 562; no filesort |

**Commands** (from `/home/faris/benches/suite-bench`, `PYTHONPATH=<worktree>`, site lock held): 

| Module | Result |
|---|---|
| `suite.drive.tests.test_activity` | Ran 13, OK |
| `suite.drive.http.tests.test_dispatch` | Ran 184, OK |
| `suite.drive.http.tests.test_routes` | Ran 104, OK |
| `suite.drive.tests.test_views` | Ran 12 and 17 (two categories), OK |
| `suite.drive.http.tests.test_translator` | Ran 32, OK (first pass; untouched since) |
| `suite.drive.http.tests.test_shapes` | Ran 46, OK (first pass; untouched since) |
| `suite.tests.test_architecture` | Ran 7, OK |

`suite.drive.http.tests.test_http` does not exist; the HTTP tests are `test_dispatch` and `test_routes`.
