---
id: 011
title: Guest and link routes
label: wayfinder:grilling
status: closed
assignee: faris (opus, 2026-09-21)
blocked-by: [001, 008]
---

## Question

Specify what a visitor without a session sees. Today `meta.allowGuest`
routes bypass the login redirect and Drive serves public files and folders
through its own layout.

Settle:

- The shell-less public view for a link or `$PUBLIC` node: folder browsing
  through the link, file preview and download, a content document in
  read-only, and the password unlock screen (spec §6.3).
- Seeding: `/drive/l/<token>` (or ticket 001's successor) resolves the grant,
  seeds the token into the client, and redirects to the node route (§11.2).
  The store and its lifetime are decided in ticket 008.
- Guest identity in comments and collab (`author_name`, `via_link`, §6.7).
- Link uploads without a creator grant (§4.5).
- What a signed-in user sees when they open a link to a node they already
  hold a grant on.
- Login and signup surfaces: the Drive signup page, `/login` handoff, and
  the onboarding gate for System Managers.

Inputs: Drive spec §4.6, §6.2, §6.3, §6.7, §11.2; ticket 008's resolution;
`frontend/src/apps/drive/pages/Signup.vue` and the public pages.

Handed from [Upload, restore and batch outcomes](007-upload-restore-and-batch-outcomes.md)
(2026-09-19): link uploads use the same Drive upload queue. Decide whether
a Guest surface shows the tracker, and whether resume after reload applies
to link visitors. `create_upload` already requires a bound link for Guest.

Handed from [Sharing dialog and link credentials](008-sharing-dialog-and-link-credentials.md)
(2026-09-19): the link store, tagging and eviction are decided there.
`/l/<token>` calls the new `GET /links/<token>` ask (`{node, kind, locked}`).
Decide the unlock screen, including the 429 wrong-password lockout, and what
`/l/<token>` shows while it resolves.

## Resolution

Resolved 2026-09-28 with Faris. Decisions 1 to 3 came from live grilling.
An agent drafted decisions 4 to 14 from the resolutions of tickets 001 to
010, 012 and 013; the orchestrator checked the code claims, changed
decision 5, and Faris approved the report.

### 1. The server resolves the link

- `/l/<token>` is a Frappe website route, as Drive spec §6.2 and §11.2
  require. It resolves the grant and answers 302 to
  `/files/f/<node>#link=<token>` for a folder, or `/d/<node>#link=<token>`
  for a file or document. The server sends no slug; the router adds it
  (ticket 001).
- The token rides the URL fragment. A fragment never reaches a server log
  or a `Referer`. The 302 keeps `/l/<token>` out of browser history.
- The SPA reads `#link=`, seeds the Drive link store (ticket 008), then
  removes the fragment before the first node request.
- Unlock is a state of the node route, not a route: a `401 DriveLocked`
  on the node shows the unlock screen in place. The same screen covers an
  unlock ticket that expires while someone browses.
- `/drive/l/<token>` redirects to `/l/<token>` (ticket 014 lists it).
- Ticket 008's ask 2 (`GET /links/<token>`) is withdrawn.

### 2. Unlock screen

- Centred, no node title, owner or kind. A locked link must not leak the
  name. Password field, Open button, inline error.
- 401: inline "Wrong password".
- 429: the form disables and shows a live countdown, "Try again in 14:32",
  from `Retry-After` (Drive ask 2 below).
- No attempts-left counter. The server gives none, and a client tally is
  wrong across tabs and devices.
- A signed-in user sees the unlock screen inside the shell; the rail stays.

### 3. Guest is a shell state

- `ShellLayout` gets a guest frame: no rail, no sidebar, one slim header
  with the Suite mark, the upload ring (decision 6) and Sign in.
- The same `FilesPage` and `DocumentHost` render for guests. Actions hide
  through ticket 006's role rule. No second folder list.
- On folder routes the trail is `FilesPage`'s own breadcrumbs through
  `PageHeaderTarget` (ticket 002). The server already clamps the trail to
  readable ancestors (`suite/drive/_core/nodes.py:460`), so a guest's trail
  starts at the shared folder.

### 4. A guest opens a document or file

- Writer, Sheets, Slides and uploaded-file previews render through
  `DocumentHost`. Below EDIT each product is read-only; this already works
  (`WriterSurface.vue:50`, `SheetsSurface.vue:15`, `SlidesSurface.vue:57`).
- READ includes download (spec §4.2), so every guest sees Download or the
  product's export.
- On `/d/` the guest header shows only the Suite mark and Sign in. The
  product's own title bar sits below it (ticket 009).

### 5. Guest names

- Comments: the composer shows guests an optional "Your name" field, 140
  characters, with a warning at the limit and no silent trim. A comment
  shows "Ravi (Acme) · Guest", or "Guest" when the field is empty. The Drive
  client keeps the name in one `localStorage` key and clears it with the
  link store on sign out. It is ignored while signed in.
- Presence and cursors: the collaboration server's generated guest name
  (spec §6.7). The typed name does not reach presence. This keeps
  `suite/sheets/collab.py:179` as it is.
- A `$PUBLIC` visitor sees no composer: `$PUBLIC` caps at READ (spec §6.5).

### 6. Guest uploads through a link

- The progress ring sits in the guest header in a fixed slot and opens
  ticket 007's tracker.
- Resume after reload works for guests on the same code path.
- The upload shows in the listing: UPLOAD (30) includes READ (10), and the
  folder's link covers the new child.
- No creator grant is written (`access.py:381`), so the guest cannot rename
  or trash the upload. The tracker says so once per batch: "Uploaded. Only
  people who manage this folder can remove files."
- Replace is hidden in the collision dialog. Replace needs EDIT.

### 7. A signed-in user opens a link

- Full shell. The code is always stored.
- User already holds a grant: no visible difference.
- Access through the link only: no sidebar location is selected; the trail
  starts at the shared item; the item is not in Shared with me, Recent or
  Starred. Star is hidden and no visit is recorded, because those lists
  send no link codes and could never show the item.
- A server-side record of opened links (option C) was discussed and
  deferred. It is in the map's Not yet specified.

### 8. A signed-out visitor opens a copied URL without the link

- A `$PUBLIC` node renders in the guest frame.
- Otherwise the guest frame shows "Sign in to open this", Sign in, and "If
  someone sent you a share link, open that link." The URL stays. No
  automatic redirect. The screen never says whether the item exists.
- `/home`, `/files` and other area routes keep the `/login` redirect.

### 9. Sign in from the guest header

- Sign in goes to `/login?redirect-to=<current path>` and returns to the
  same item inside the shell.
- The link store survives sign-in; sign out clears it (ticket 008).
- An interrupted guest upload cannot resume after sign-in: its binding
  names `Guest` (`upload.py:228`). The tracker shows it failed with "Upload
  again".

### 10. Login and signup

- Keep Frappe's `/login`. No Suite login page (ticket 010).
- The guest header offers Sign in only. People join through Suite
  invitations.
- Drive's signup page is not ported. `/drive/signup` stays legacy until
  ticket 014 retires it.
- Mail keeps its own login, signup and reset pages (ticket 010).
- The setup gate skips `allowGuest` routes, so a System Manager on a site
  that is not set up can open a shared item. Area routes still go to setup.
- Writer's dead `/drive/login` handoff (`ErrorPage.vue:61`) becomes
  `/login?redirect-to=`.

### 11. Dead-link page

Server-rendered, correct HTTP status, `no_cache`, Suite mark, no node
details, no Sign in.

- 404: "This link doesn't work. It may be mistyped, or its owner turned it
  off."
- 410: "This link has expired. Ask the person who shared it for a new one."
- A signed-in visitor also sees "Go to Home".

### 12. Mobile guest frame

No bottom nav; every tab needs a session. The same slim header. Folders use
the existing mobile Back button, which stays inside the shared folder.

### 13. Files page in the guest frame

No sidebar, no search, no Star: views and roots are session-only
(`suite/drive/http/translator.py`). New and drop targets follow the role.

### 14. New menu through a link

Below EDIT through a link, New hides Document, Spreadsheet and
Presentation. With no creator grant, the person who made one could not
edit it.

### Asks

Drive program:

1. `/l/<token>` redirects by kind to `/files/f/` or `/d/`. Today it goes to
   the legacy `/drive/g/` (`suite/www/drive_link.py:31`).
2. The unlock 429 carries `Retry-After` with the seconds left. The failure
   that sets the lockout also answers 429; today the 5th failure answers
   401 and only the 6th gets 429.
3. Withdrawn: ticket 008's ask 2, `GET /links/<token>`.

Suite:

4. `drive_link.html` gets separate 404 and 410 copy, plus "Go to Home" for
   signed-in visitors.
5. The setup gate skips `allowGuest` routes (`router/index.ts:198`).
6. Writer `ErrorPage.vue:61`: `/drive/login` becomes `/login?redirect-to=`.

### Handed on

- [Rollout, redirects and old-page deletion](014-rollout-redirects-and-old-page-deletion.md):
  retire `/drive/signup` and the Drive invitation URL
  (`drive_user_invitation.py:91`); redirect `/drive/l/<token>`.
- [Draft the spec and plan](015-draft-the-spec-and-plan.md): today
  `/l/:token` and `GuestSurface.vue` are placeholders, nothing reads
  `#link=`, and the default transport sends no `X-Drive-Links`.

### Not verified

- That Recent and Starred drop link-only items (decision 7). It follows
  from spec §6.2; nobody ran it.
