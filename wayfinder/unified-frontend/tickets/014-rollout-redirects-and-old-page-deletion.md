---
id: 014
title: Rollout, redirects and old-page deletion
label: wayfinder:grilling
status: closed
assignee: faris (opus, 2026-09-29)
blocked-by: [006, 009, 010, 013, 016]
---

## Question

Rollout is grow beside, then switch (decided 2026-09-11). Define the
switch.

- The gates a new area passes before its redirect flips: browser journeys,
  the legacy-call count for that area at zero, the import-boundary check.
- The redirect layer: old prefix to new route, per area, including deep
  links, share links and the Desk app switcher. Who owns it and when it is
  removed.
- Deletion of the old Drive, Writer, Sheets and Slides pages as the last
  stage, and what that unblocks in the Drive program (Cleanup activation,
  ticket 36).
- The release shape: one release for the shell plus Files, or the shell
  first with the old apps inside it.
- Rollback: how to point a prefix back at the old page without a deploy.

Inputs: the resolutions of tickets 006, 009, 010 and 013; the Drive
implementation README's release checkpoints;
`wayfinder/drive-layer-spec/implementation/issues/36-cleanup-later-release.md`.

Handed from [Guest and link routes](011-guest-and-link-routes.md)
(2026-09-28): retire `/drive/signup` and the Drive User Invitation URL
(`drive_user_invitation.py:91`, which points at `/drive/signup`). Redirect
`/drive/l/<token>` to `/l/<token>`.

## Resolution

Resolved on 2026-09-29. Faris answered the number of flips. A Fable
subagent answered the rest on his request. The orchestrator corrected two
of its points, and Faris approved the whole resolution.

In short: the switch happens in two flips. Each flip is one server config
key, so it turns off without a deploy. The server redirects old links
forever. The old pages are deleted after the second flip holds, when a
counter shows no client calls the legacy Drive API.

```text
today    old pages live; new pages grow beside them
flip 1   suite_flip_shell: Mail, Meet, Calendar in the shell
flip 2   suite_flip_files: Home, Files, documents; / -> /home
hold     one full release, at least 14 days, legacy-call counter at zero
delete   one commit; 302s become 301s; Drive Cleanup (issue 36) unblocks
```

1. **Two flips.** Flip 1 is the shell with Mail, Meet and Calendar
   (ticket 010's one change). The rail shows Mail, Calendar and Meet only,
   and `/` goes to `/mail` through the existing last-app fallback. There is
   no Home stub. Flip 2 is Home, Files and documents together, because they
   share the node routes and Home recents open `/d/<id>`. At flip 2 the rail
   gains Home and Files, and `/` goes to `/home`. Three flips was rejected:
   Files would send documents out of the shell to old pages.
2. **Switch.** One `frappe.conf` key per flip: `suite_flip_shell` and
   `suite_flip_files`, set with `bench set-config`. This follows the
   `disable_slides_service_worker` precedent. The server reads the key for
   redirects and sends it to the client in the SPA boot. The client reads
   the flag from boot only. A Suite Settings field was rejected: it is a
   product surface for a short ops switch. The keys are deleted with the old
   pages.
3. **Redirect layer.** One redirect table, owned by composition, runs in
   `before_request`. Cold loads, emails and bookmarks all reach the server.
   It answers 302 while a flag can turn off, and 301 after deletion, because
   browsers cache a 301 and would break rollback. Sheets and Slides URLs
   carry a docname, so the server looks up its `node` field (one read).
   `/drive/g/<id>` looks up the node kind (one read). One client router
   guard reads the same table, exported to the client, for old links clicked
   inside the app, for example an old link in a stored notification. For
   Sheets and Slides the guard does a full page load, so the server does the
   lookup.

   | Old | New |
   |---|---|
   | `/drive/d/<id>` (folder) | `/files/f/<id>` |
   | `/drive/f/<id>` (file), `/drive/w/<id>`, `/writer/w/<id>` | `/d/<id>` |
   | `/drive/g/<id>` | by kind |
   | `/sheets/<docname>`, `/slides/{presentation,slideshow}/<docname>` | `/d/<node>` |
   | `/drive/l/<token>` | `/l/<token>` |
   | `/drive/{recents,favourites,shared,trash}` | saved-view paths (ticket 006) |
   | `/drive`, `/suite` | `/files`, `/home` |

4. **Lifetime.** Redirects stay forever. Sent emails, stored notification
   rows and bookmarks carry old links, and the table is small. Stored rows
   are not rewritten. Two rows are the exception: the pre-migration
   `/drive/{folder,document,file}/<old>` ids and `/drive/t/<team>/...` use
   Drive's translate tables, so they go when Drive Cleanup drops those.
5. **Links the server builds.** One helper, `node_url(node)`, returns the
   URL by node kind and reads `suite_flip_files`, so a rollback also rolls
   back new links. No caller builds a path string. It replaces:
   notifications `get_link`, the share link, `drive_link.py`'s
   `NODE_ROUTE`, `product.py` and OAuth `/drive`, the shims' `/drive/w` and
   `/drive/g`, the Writer wikilink, the Meet recording email, and WebDAV
   HTML links. The share notification's `/sheets?id=` link is broken today
   and is fixed in the same pass.
6. **Invitations.** The server accepts the invitation, creates the user,
   logs them in, and redirects through `node_url`'s flag to `/home` (or
   `/drive/` before flip 2). The user sets a password through Frappe's
   `/update-password`. `/drive/signup` and its page are deleted. If the
   Suite invitation resource (ticket 003) slips past flip 2, `/drive/signup`
   stays as a legacy page until deletion.
7. **Gates.**
   - Flip 1: browser journeys pass for Mail, Meet and Calendar in the
     shell. The four shell fixes from ticket 010 have landed. The Slides
     service worker serves no stale shell. Rollback is rehearsed once on the
     dev site: flag on, flag off, a cold load of each prefix.
   - Flip 2: browser journeys pass for Home, Files and documents. The five
     Drive asks from ticket 006 have shipped. New code makes zero legacy
     `suite.drive.api.*` calls (ticket 013's boundary check). A test hits
     every old path in the redirect table and checks the new path.
     Invitation accept lands on `/home`. The `/l/<token>` server rule exists
     and opens a folder and a file.
   - The legacy Vitest manifest (ticket 013) is not a gate. It shrinks by
     deletion.
8. **Deletion.** After flip 2 holds for one full release on production,
   and at least 14 days, with the legacy-call counter at zero. One commit
   deletes: `apps/drive/legacy`, the old Writer, Sheets and Slides pages
   (the editors stay), both flag keys, `SUITE_APPS` and `lastApp`, and the
   legacy Drive `SettingsDialog` (ticket 016). The Slides service worker is
   unregistered. Redirects become 301. The counter is the evidence issue 36
   asks for.
9. **Service worker and PWA.** At flip 1 the Slides service worker stops
   caching the shell, because Mail lives in the shell from flip 1 and a
   stale shell breaks rollback. At flip 2 the PWA `start_url` path
   `/suite/start` goes to `/home`.
10. **Desk.** The `add_to_apps_screen` entry stays at `/suite`, which
    redirects to `/home`. The Desk workspace link `/drive` reaches `/files`
    through the redirect table, so rollback holds.

Mail's own login, signup and reset pages, `/meet/<code>` and
`/calendar/account/...` are not touched by either flip.

### Asks

1. Drive program: a counter in the legacy `suite.drive.api.*` dispatch,
   keyed by method name and user agent, read by a bench command. A stray
   WebDAV or mobile client then shows up by name.

### Corrections to the subagent's answers

- It said the `/l/<token>` server rule must land before flip 1.
  `/drive/l/<token>` works today through `drive_link.py`, so the rule is a
  flip 2 gate only.
- It raised duplicate realtime handling between an old tab and a new tab.
  Each tab has its own socket today, so this is not a new issue.
