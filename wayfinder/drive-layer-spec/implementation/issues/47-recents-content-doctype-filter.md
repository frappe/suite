# 47 — Filter the recents view by content doctype

**What to build:** `GET /api/suite/drive/views/recents` accepts `?content_doctype=` and returns only the caller's recent document nodes of that type. The unified frontend's Recent view uses it for its `type` filter, which replaces the old per-type lists at `/writer`, `/sheets`, `/slides`, `/drive/documents` and `/drive/presentations`.

**Asks:** D31 (unified frontend spec §15.1).

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** the critical decisions review of 2026-09-29, recorded in unified frontend ticket [022 — Fold decisions into the spec and plan](../../../unified-frontend/tickets/022-fold-decisions-into-the-spec-and-plan.md). Faris chose per-type redirects to a filtered Recent view. Unified plan stage 11 (Document surfaces complete, Drive sub-lane) waits on it for the Recent type filter.

**Source:** [Drive spec](../../drive-layer-spec.md), §9.5 (`Drive Recent`), §11.2 "Views" (`recents`, and `templates` for the existing `?content_doctype=` filter), §11.4 (cursor). Unified frontend spec §5.1 (Recent `type` filter), §14.3 (redirect rows).
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] `GET /views/recents?content_doctype=<doctype>` returns only rows whose node is a `document` with that `content_doctype`. Without the argument the answer is unchanged.
- [ ] The filter runs in the query, not on the fetched window. A page never comes back short or empty because rows of other types filled the window, and the cursor stays opaque and correct across pages.
- [ ] Newest `opened_at` first, `opened_at` on each row, and the `access` and `preview` expansions work as today.
- [ ] `_view_filters` in `suite/drive/http/routes.py` passes `content_doctype` to `recents` only, the same way it does for `templates`. `suite.drive._core.activity.recents` takes the filter.
- [ ] An unknown doctype returns an empty page, not an error.
- [ ] Typed shapes stay in `suite/drive/http/shapes.py`; one `Route` row change in `suite/drive/http/translator.py` if the query string needs it.
- [ ] Tests cover: the filter for each of the three document doctypes; a mixed history where the first unfiltered window holds no match and the filtered page is still full; cursor paging over two pages; an unknown doctype; no argument.
- [ ] Documentation synced in the same change: Drive spec §11.2 "Views" (the `recents` row).

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_http`, `test_translator`, and `suite.drive.tests.test_activity`. Record real output.

## Notes

- `activity.recents` pages `Drive Recent` by offset and drops unreadable rows after the query (`_visible_personal_rows`). The type filter needs a join on `Drive Node` inside the query.
- The frontend maps `type=writer|sheets|slides` to a content doctype through its document registry. The server sees only `content_doctype`.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
