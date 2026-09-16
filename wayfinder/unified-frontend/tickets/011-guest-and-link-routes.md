---
id: 011
title: Guest and link routes
label: wayfinder:grilling
status: open
assignee:
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
  Where the token store lives and how long it holds.
- Guest identity in comments and collab (`author_name`, `via_link`, §6.7).
- Link uploads without a creator grant (§4.5).
- What a signed-in user sees when they open a link to a node they already
  hold a grant on.
- Login and signup surfaces: the Drive signup page, `/login` handoff, and
  the onboarding gate for System Managers.

Inputs: Drive spec §4.6, §6.2, §6.3, §6.7, §11.2; ticket 008's resolution;
`frontend/src/apps/drive/pages/Signup.vue` and the public pages.
