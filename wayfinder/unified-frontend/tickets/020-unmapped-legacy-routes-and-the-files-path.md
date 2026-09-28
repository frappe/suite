---
id: 020
title: Unmapped legacy routes and the /files path
label: wayfinder:grilling
status: closed
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014's redirect table misses legacy routes, and some rows resolve
wrongly.

- No row: `/drive/inbox`, `/drive/attachments/:doctype?/:docname?`,
  `/drive/documents`, `/drive/presentations`, `/writer`, `/sheets`,
  `/slides`, `/slides/not-permitted`.
- Wrong match: `/sheets/new` and `/sheets/trash` match
  `/sheets/<docname>`; `/slides/presentation/new` and
  `/slides/presentation/view/<id>` match `/slides/presentation/<docname>`.
- Old routes accept a trailing `/:slug?`; the table does not show it.
- No source says what a lookup row answers when it finds no node.

Also decide the `/files` clash: Frappe serves public uploads under
`/files/`. `IMPLEMENTATION.md` records a workaround (commit `504d6ab10`)
"pending Faris's review".

Route list from the content audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

## Resolution

Resolved on 2026-09-29. A Fable subagent answered the reversible questions
and prepared the rest. Faris answered them. His rename of the area
prefix changes several proposed decisions; ticket 022 applies the result.

In short: every legacy route now has a row or a stated reason to have none.
Rows match exact paths before parameter paths, drop the trailing slug, and
carry the query string. A lookup that finds no node does not redirect; the
request falls through, and after deletion that is a Frappe 404. `/files`
stays, with a narrower dev bypass, a Frappe ask for `bench serve`, and a
guard against the five upload names that could shadow a Files route.

### Every legacy route today

Sources: `frontend/src/router/index.ts`, `frontend/src/apps/drive/legacy/routes.ts`,
`frontend/src/apps/{writer,sheets,slides,mail,meet,calendar}/routes.ts`,
`frontend/src/composition/routes.ts`, `suite/hooks.py`. "Row" is the
section 14.3 row after this ticket. "Wrong today" means the current table
matches the path with a parameter row and looks up the wrong docname.

| Old path | What the page shows today | Row |
|---|---|---|
| `/drive` | `Personal.vue`: My files listing with a Shared tab | `/files` [T014] |
| `/drive/signup` | `Signup.vue`: invitation signup | none; deleted [T014 §14.6] |
| `/drive/inbox` | `Notifications.vue`: Drive notification list, mark as read | `/files` (for Faris, item 2) |
| `/drive/recents` | `Recents.vue` | `/files/recent` [T014] |
| `/drive/favourites` | `Favourites.vue` | `/files/starred` [T014] |
| `/drive/shared` | client redirect to `/drive` | `/files/shared-with-me` [T014] |
| `/drive/attachments/:doctype?/:docname?` | `Attachments.vue`: Frappe attachments as a Doctype > Doc > files tree, or one document's attachments | `/files` (for Faris, item 2) |
| `/drive/documents` | `Documents.vue`: Writer documents only (`file_kinds: ["Frappe Document"]`) | `/files` (for Faris, item 2) |
| `/drive/presentations` | `Slides.vue`: presentations only | `/files` (for Faris, item 2) |
| `/drive/trash` | `Trash.vue` | `/files/trash` [T014] |
| `/drive/g/<id>/` | kind lookup, then `/drive/d/` or `/drive/f/` | by node kind [T014] |
| `/drive/f/<id>/<slug>?` | `File.vue`: file preview | `/d/<id>` [T014] |
| `/drive/d/<id>/<slug>?` | `Folder.vue` | `/files/f/<id>` [T014] |
| `/drive/w/<id>/<slug>?` | client redirect to `/writer/w/<id>` | `/d/<id>` [T014] |
| `/drive/{folder,document,file}/<old>` | translate old name, then the page | by kind through `Drive Legacy Route` [T014, T015] |
| `/drive/t/<team>/<letter>/<id>/<slug>?` | as `/drive/g/<id>` | as `/drive/g/<id>` [T014] |
| `/drive/t/<team>/` | `resolve_legacy_route`, else `/drive` | by kind through `Drive Legacy Route` [T014, T015] |
| `/drive/l/<token>` | `drive_link.py` website route | `/l/<token>` [T011, T014] |
| `/writer` | `Documents.vue`: Writer document list | `/home` (for Faris, item 2) |
| `/writer/w/<id>/<slug>?` | `Document.vue`: Writer editor | `/d/<id>` [T014] |
| `/sheets` | `Home.vue`: sheet list, mine and shared, sort, rename, trash | `/home` (for Faris, item 2) |
| `/sheets/new` | `SheetEditor.vue` with id `new`: creates a sheet, then replaces the URL | `/home` (for Faris, item 2); wrong today |
| `/sheets/trash` | `Trash.vue`: trashed sheets, restore, delete forever | `/files/trash`; wrong today |
| `/sheets/<docname>` | `SheetEditor.vue` | `/d/<node>` (one read of `Sheet.node`) [T014] |
| `/slides` | `Home.vue`: presentation list, create, rename | `/home` (for Faris, item 2) |
| `/slides/presentation/new` | `PresentationEditor.vue` in create mode: theme picker, then replaces the URL | `/home` (for Faris, item 2); wrong today |
| `/slides/presentation/view/<docname>/<slug>?` | client redirect to the editor | `/d/<node>`; wrong today |
| `/slides/presentation/<docname>/<slug>?` | `PresentationEditor.vue` | `/d/<node>` (one read of `Presentation.node`) [T014] |
| `/slides/slideshow/<docname>/<slug>?` | `Slideshow.vue` | `/d/<node>` [T014] |
| `/slides/not-permitted` | `NotPermitted.vue`: static error page the Slides guard sends a user with no access to | `/home` (for Faris, item 2) |
| `/suite` | `LauncherView.vue` | `/home` [T014] |
| `/suite/start` | PWA start: redirects to the last app | `/home` at flip 2 [T014 §14.9] |
| `/suite/setup` | `SetupView.vue`: setup wizard (`setup_wizard_url`) | none; stays |
| `/suite/load-error` | runtime load error | none; stays |
| `/mail/...`, `/calendar/...`, `/meet/...` | their own pages | none; the prefixes stay [T010, T014 §14.11] |
| `/` | `/home` | replacement redirect [T001] |

Other facts the table needs:

- Desk's File form (`suite/public/js/file.js:9`) opens `/drive/g/<name>`.
  The `/drive/g/` row keeps it working. It is client code, so `node_url`
  does not cover it. Stage 15 may rewrite it; the row makes that optional.
- Mail's `website_redirects` in `suite/hooks.py` (`/auth/validate`,
  `/outbound/...`, `/inbound/...`, `/spamd/...`) are Stalwart callbacks,
  not user pages. They stay as they are.
- Sheets' trash becomes Drive trash at Build: `Sheet.trashed` is a frozen
  legacy field and a governed row is trashed through Drive
  (`suite/hooks.py` note above `drive_content_types`). So `/sheets/trash`
  maps to `/files/trash` with no loss.

### Decided (reversible)

1. **Matching order.** Exact rows come before parameter rows, and a
   parameter matches one path segment. That fixes the four wrong matches:
   `/sheets/new`, `/sheets/trash`, `/slides/presentation/new` and
   `/slides/presentation/view/<docname>` each get their own row above the
   parameter row. One ordering rule beats four special cases [T014 §14.3,
   `frontend/src/apps/sheets/routes.ts`, `frontend/src/apps/slides/routes.ts`].
2. **Trailing slug and slash.** Every row accepts an optional trailing
   `/<slug>` and an optional trailing `/`, and drops both. The server sends
   no slug; the router adds the current one without a history entry, the
   same as link redirects. Old routes carry the slug as a decorative
   optional segment today, so nothing in it is authoritative [T001 §2.3,
   T011 §10.1, `legacy/routes.ts:466-480`].
3. **Query string.** A row carries the query string through unchanged. The
   new page ignores keys it does not know. Example: `/slides/presentation/<docname>?slide=3`
   becomes `/d/<node>?slide=3`. Dropping it would lose state for no gain,
   and the Slides surface can read `slide` if it wants [T014].
4. **A lookup that finds no node.** The row does not redirect. The request
   falls through to normal routing. While a flag can turn off, the old page
   mounts and shows its own missing-document state. After deletion the
   answer is Frappe's 404 page, because decision 5 removes the legacy
   website rules. A 404 is not cached, so this stays changeable; a redirect
   to `/files` would hide a dead link as a working one [T014 §14.3, T011 §10.11].
5. **Legacy website rules leave at deletion.** The stage 15 commit removes
   the `/drive`, `/drive/<path>`, `/slides`, `/slides/<path>`, `/sheets`,
   `/sheets/<path>`, `/writer` and `/writer/<path>` rows from
   `website_route_rules`, and `/drive/l/<token>` once ask D24 has shipped.
   `/suite/<path>` stays for `/suite/setup`, `/suite/start` and
   `/suite/load-error`. Without this, an unmatched old URL would render the
   SPA's not-found view with HTTP 200 [`suite/hooks.py:47-75`, T014 §14.8].
6. **A redirect never creates a document.** `/sheets/new` and
   `/slides/presentation/new` redirect to a page (item 2 for Faris). A GET
   that creates a document would spawn one per visit, and a cached 301
   would pin one id forever [T009 §8.9].
7. **Dev bypass narrowed.** `frontend/vite.config.ts` serves the SPA only
   for the paths the Files area owns: `^/files$`,
   `^/files/(organization|recent|starred|shared-with-me|trash)$` and
   `^/files/f/`. Every other `/files/...` request proxies to the bench,
   whatever its `Accept` header. Today's rule keys on `Accept: text/html`,
   so opening a public upload or a `/files/blobs/...` storage blob in a new
   tab shows the SPA instead of the file in dev. Production is not
   affected: nginx serves a real file first [`frontend/vite.config.ts:188-195`,
   `bench/config/templates/nginx.conf:84-89`, `frappe/storage/local_driver.py:16`].
8. **Reserved public upload names.** Suite's `File` override
   (`suite.drive.overrides.file.File`) refuses a public upload whose name
   is exactly `organization`, `recent`, `starred`, `shared-with-me` or
   `trash`. Frappe strips `/` from file names (`frappe/core/doctype/file/file.py:427`),
   so no upload can sit under `/files/f/`, and `/files/blobs/` is Frappe
   storage's own segment. These five names are the whole residual risk
   IMPLEMENTATION.md records, and a five-line check closes it [IMPL,
   `frappe/core/doctype/file/utils.py:252`].
9. **Where the `/files` clash sits today.** Production runs gunicorn on
   `frappe.app:application` with no static middleware; nginx `try_files`
   serves a real upload and proxies everything else to Frappe, where the
   `website_route_rules` rows for `/files` and `/files/<path>` serve the
   SPA. `bench serve` wraps the app in `StaticDataMiddleware`, whose loader
   raises `NotFound` on a miss (`frappe/middlewares.py:39`) where werkzeug
   expects `(None, None)`, so every miss under `/files/` is a 500 on the
   bare dev port, including a missing upload. Dev goes through Vite only
   until Frappe fixes that. Not verified: a cold load of `/files/recent`
   through a real nginx, and Frappe Cloud's nginx template
   [`frappe/app.py:671-678`, `bench/config/templates/supervisor.conf:7`,
   werkzeug 3.1.6 `SharedDataMiddleware.__call__`].

### Faris's answers

1. **The area prefix is `/drive`, not `/files`.** Faris: "i think its
   better to rename it to /drive from /files", and "yes, okay with
   consequences". The consequences he accepted:
   - Until flip 2 the old Drive app owns `/drive`. `suite_flip_files`
     selects which route table mounts under `/drive`. This amends ticket
     013's "no route flag selecting between two implementations" for this
     prefix only.
   - The old `/drive/f/<id>` meant a file; the new one means a folder. The
     folder route resolves by node kind: a non-folder id replace-redirects
     to `/d/<id>`.
   - The rail label changes from "Files" to "Drive".
   - Frappe's `/files/` public upload path no longer clashes, so the
     reserved upload names (proposed decision 8) and the Vite `/files`
     bypass go. The `/files` routes never reached production, so they need
     no redirect rows.
2. **Targets for the orphan old pages: rule (a).** Faris: "take both recs".
   Old Drive listings (`/drive/inbox`, `/drive/documents`,
   `/drive/presentations`, `/drive/attachments/...`) go to `/drive`. Old
   product home and utility pages (`/writer`, `/sheets`, `/sheets/new`,
   `/slides`, `/slides/presentation/new`, `/slides/not-permitted`) go to
   `/home`. Old saved views map onto the new paths under `/drive`.
3. **The Frappe ask.** Faris: "take both recs": file it. The orchestrator
   reproduces the 500 with a traceback first; one bench port answered 500
   and another 404 for a missing upload.

### The questions as they were put

1. **Keep `/files` as the Files area prefix.** The URL prefix ships in
   bookmarks, emails and 301s, so it cannot change later. Frappe serves
   public uploads at `/files/<name>` and storage blobs at
   `/files/blobs/...`. Example: `/files/recent` is a Files saved view; a
   user who uploaded a public file named `recent` with no extension would
   see that file instead, site-wide. Options: (a) keep `/files`. Pro: the
   name Faris chose in ticket 001, memorable, already built, production
   falls through cleanly. Con: dev needs the Vite bypass, the bare bench
   port 500s until Frappe fixes its middleware, and five upload names must
   be reserved (decision 8). (b) rename the prefix, for example `/drive`
   is taken, so something like `/storage` or `/my`. Pro: no clash at all.
   Con: a worse word, one constant plus tests plus every ticket that names
   `/files`, and `/files/f/` is already in the plan and the prototype.
   Recommendation: (a). The clash is small and closed by decisions 7 to 9.
   **Question:** Keep `/files`, with the reserved names and the Vite bypass?
2. **Targets for ten old pages that have no new page.** A 301 pins each
   target in browsers forever. Two rules: an old Drive listing goes to
   `/files`; an old product home or utility page goes to `/home`. So
   `/drive/inbox`, `/drive/documents`, `/drive/presentations` and
   `/drive/attachments/...` go to `/files`; `/writer`, `/sheets`,
   `/sheets/new`, `/slides`, `/slides/presentation/new` and
   `/slides/not-permitted` go to `/home`. Example: a bookmark to `/sheets`
   lands on Home, whose New menu has Spreadsheet and whose Recent shows
   the last sheets. Options: (a) the two rules above. Pro: matches the
   `/drive` to `/files` and `/suite` to `/home` rows, and Home is where a
   product without an area lives. Con: `/drive/documents` loses its
   Writer-only filter, and Files has no kind filter (spec 5.3). (b) all ten
   to `/home`. Pro: one rule. Con: `/drive/inbox` and `/drive/documents`
   are Drive listings and Files is closer. (c) all ten to `/files`. Pro: one
   rule. Con: `/sheets/new` lands on a listing with no Spreadsheet in its
   New menu until Files' New menu is checked. Recommendation: (a).
   **Question:** Do the ten URLs go where rule (a) says?
3. **A Frappe framework ask.** `bench serve` answers 500 for any miss under
   `/files/` because `StaticDataMiddleware.get_directory_loader` raises
   `NotFound` instead of returning `(None, None)` (`frappe/middlewares.py:39`).
   This is a bug on its own: a missing upload 500s in dev today. Example:
   `curl -H 'Accept: text/html' http://localhost:8010/files/recent` on the
   bare bench port 500s; through Vite it serves the SPA. Options: (a) file
   the fix upstream, one line, and until it lands dev uses Vite only. Pro:
   correct for everyone. Con: a commitment on another program, and the
   version bump to pick it up. (b) no ask; dev uses Vite only, forever.
   Pro: nothing to file. Con: e2e and any direct bench-port check of a
   Files route stays a 500. Recommendation: (a). **Question:** File the
   Frappe ask?

### Spec and plan changes

`unified-frontend-spec.md`:

- §2.2 Rules: add "`/files/<name>` that names a real public upload, and
  `/files/blobs/...`, are served before the SPA. The five saved-view and
  root segments are reserved public upload names (section 14.3) [T020]."
- §14.3 Redirect table: replace the table with the one in this ticket's
  "Every legacy route today" (the Row column), with Faris's answers to
  items 1 and 2 applied. Add the rules: matching order (decision 1),
  trailing slug and slash (2), query string (3), no node (4), and "a
  redirect never creates a document" (6). Note that Desk's `file.js`
  reaches `/drive/g/`. Remove the last bullet that points to ticket 020.
- §14.8 Deletion: add "the commit removes the legacy `website_route_rules`
  rows (decision 5); `/suite/<path>` stays" and "an unmatched old URL then
  answers Frappe's 404".
- §15: if Faris says yes to item 3, add ask F1 "`StaticDataMiddleware`
  falls through on a miss" (owner Frappe framework, raised by T020, status
  open, depends nothing). Otherwise no new ask.
- §16.1: remove items 4 and 5.

`unified-frontend-plan.md`:

- Stage 12 Files: add `frontend/vite.config.ts` (decision 7) and the
  `File` override in `suite/drive/overrides/file.py` (decision 8). Work:
  the full row list and the five rules; the redirect test covers the four
  formerly wrong paths, a slug and a query carry-through, and one no-node
  fall-through with the flag on. Depends on: replace "Ticket 020 (missing
  and wrong rows)" with "T020".
- Stage 15: files gain the `website_route_rules` rows named in decision 5.
  Exit gate gains "a cold load of `/drive/<unknown>` answers 404". Depends
  on: replace the ticket 020 line with "T020".
- Open items: remove the "Unmapped legacy routes and `/files`" entry.
- If Faris says yes to item 3: Backend asks by stage gains F1 under a new
  "Frappe framework" heading, blocking nothing (dev only).

`IMPLEMENTATION.md`: the "pending Faris's review" note under "Decisions
made during implementation" closes with item 1's answer. Ticket 022 edits
it.

### Asks

- Frappe framework (needs Faris's yes on item 3): `StaticDataMiddleware`
  in `frappe/middlewares.py` returns `(None, None)` on a miss so the request
  falls through to the app. One line. Dev only.
- No Drive, Meet, Mail, Calendar or Suite ask.
