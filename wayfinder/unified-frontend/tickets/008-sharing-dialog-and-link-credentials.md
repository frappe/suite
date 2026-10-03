---
id: 008
title: Sharing dialog and link credentials
label: wayfinder:grilling
status: closed
assignee: faris (opus, 2026-09-19)
blocked-by: [006]
---

## Question

Specify sharing in the new frontend. Inputs are ticket 33's acceptance
criteria and Drive spec §4 to §6.

- The share dialog: local grants and inherited access shown separately using
  the `explain` response (§5.8); separate remove-grant and deny-access
  actions, including for `$PUBLIC`; refresh of effective access after a
  write; expired grants shown as inactive in management views; the strict
  role ladder in the picker; MANAGE as the only sharer.
- Links: one node, many links; create, rotate, expiry, password; locked and
  expired states; the URL `/drive/l/<token>` (or its successor from ticket
  001).
- Link credentials in the client: remember each token's target node; send
  only relevant codes in `X-Drive-Links` (§4.7); the 20-code cap and the
  explicit error when exceeded; the unlock ticket (§4.8) storage and
  lifetime; the folder link used for descendant browsing; nothing sent on
  unrelated requests.
- The scoped credential selection exported to content pages through the
  Drive client interface, so collab and media loads carry only the document's
  codes.
- Publishing (§6.5) as a `$PUBLIC` grant capped at READ, and how the dialog
  presents it.

Inputs: Drive spec §4.4 to §4.8, §5.8 to §5.11, §6.1 to §6.5; ticket 33.

## Resolution

Resolved 2026-09-19 with Faris (grilling).

### Split with ticket 011

This ticket decides how link codes are stored, selected and sent. Ticket 011
decides the screens: the Guest surface, the unlock screen and what `/l/<token>`
shows while it resolves.

### Link credentials in the client

- The Drive client owns link-code storage and selection. Platform transport
  only sends a header that it is given. The `LinkStore` hook in
  `frontend/src/platform/transport/index.ts` is removed. It cut the set to 20
  without an error, which spec §6.2 forbids. Other products get codes only
  through the document session (ticket 009).
- Folder coverage: when a read or listing returns through a link, the client
  tags each returned node with that link's code. A request for a tagged node
  sends that code. A request for an untagged node sends no codes. A deep URL
  that this browser never reached through the link needs the link again.
- Store: `localStorage`, one keyed map for links
  (`code → {target, ticket?, lastUsed}`) and one for tags (`node → code`).
  An entry is forgotten when:
  - the server returns 404 or 410 for that code (drop the link and its tags);
  - the unlock ticket expires (drop the ticket, keep the bare code);
  - the store is full (least recently used first; limits 50 links and 1000
    tags);
  - the user signs out (clear everything).
- More than 20 codes on one request: reads split into groups of 20 and merge
  the results. Writes (move, trash, star, batch) refuse with an explicit
  message: "These items come from more than 20 share links. Select fewer and
  try again." Batch outcomes (ticket 007) get no partial-result case.
- Link URL: `/l/<token>` everywhere. Links sent before this effort as
  `/drive/l/<token>` redirect to `/l/<token>` (ticket 014 lists it).

### Share dialog

- Share is shown only to users with Manage (ticket 006's action rule). Reading
  grants needs Manage.
- Sections, top to bottom: people picker; **People** (local user and group
  grants); **General access** (everyone at the org, Public on the web);
  **Share links**; a folded **From "<folder>"** part per ancestor that holds
  inherited grants.
- Remove and Deny:
  - A local row's role menu ends with **Remove**. On a folder it also has
    **Remove here and inside** (`?below=1`); the result says how many items
    inside lost the grant.
  - An inherited row has **Deny access here**. The deny row then shows in
    People as "Denied here" with **Allow again**, which deletes the deny row.
  - After Remove, the dialog reads access again. If the person still has
    access, it says why: "Asha still has access through Design team."
  - UI words follow the Drive glossary: Deny, not Block.
- Roles offered:

  | Who | Folder | File or document |
  |---|---|---|
  | Person or group | View, Comment, Upload, Edit, Manage | View, Comment, Edit, Manage |
  | Everyone at the org | Off, View, Comment, Upload, Edit | Off, View, Comment, Edit |
  | Public on the web | Off, View | Off, View |
  | Share link | View, Comment, Upload, Edit | View, Comment, Edit |

  Upload is hidden on files because it gives nothing there (spec §4.2).
  Manage is never offered to everyone at the org.
- General access shows the effective state. Public from a parent shows
  `On · from "<folder>"` with **Deny access here**. It also appears in the
  folded part. On a root, the Public row and the Share links section are
  hidden.
- Share links:
  - **+ New link** makes a View link with no expiry and no password, copies
    the URL, and shows "Link copied".
  - A row shows role, a lock when a password is set, expiry, date made, and
    "sent to <email>" when it was sent. Links have no names.
  - The row menu: Access, Set/Change/Remove password, Set/Change/Remove
    expiry, **Get new URL** (rotate; confirm "The old URL stops working"),
    Delete link.
- People picker searches users and groups. Groups show a member count.
- Outsiders: an email that is not a user shows "Send a link to
  <email>". Each send makes a new link for that one email, with the role
  chosen in the picker. Cutting off one outsider means deleting their link.
  A copied link can go to anyone and is not recorded.
- Expired grants and links stay in the list, greyed, "Expired <date>", with
  Remove.
- Expiry is a date picker. Access ends at the end of that day in the
  sharer's timezone. `expires_on` is a Datetime.
- **Notify by email** box for people added, on by default. Users also get
  today's in-app notification.
- Removing or lowering your own Manage asks first: "You will no longer be
  able to share this item."
- After any write, grants and access are read again (ticket 009's refresh
  rule). A failed write shows an inline error on its row.
- Mobile: the dialog opens as the shell's bottom sheet with the same
  sections.
- Publishing is the `$PUBLIC` View grant, shown as "Public on the web".

### Asks

Drive program:

1. A grant's `url` becomes `/l/<token>`.
2. `GET /api/suite/drive/links/<token>` returns `{node, kind, locked}`, or 404
   or 410. Guests can call it. It needs no code in the header.
3. List inherited grants for a node, each with its source node (for example
   `GET /nodes/<id>/grants?inherited=1`). Today the route returns local rows
   only, and explain works one principal at a time.
4. On grant PUT, an omitted `password` keeps the stored hash and
   `password: null` clears it. Today the PUT replaces the row, so changing a
   password link's expiry would clear its password.
5. `PUT …/grants/$LINK` accepts `send_to: <email>`. It makes the link, sends
   the email and stores the address on the row.
6. Grant PUT accepts `notify: true` and sends a share email to a user.
   Today the new path sends only the in-app notification.
7. Spec fix: §11.2 shows `explain?: [...]` and `{ticket}`. The code and §5.8
   return an object and `{ticket, expires}`.

Suite:

- `GET /api/suite/people?q=` returns users and groups, paged. Callable by
  any Suite user. "Principal" stays a Drive word; Mail and Calendar use it
  for a different thing. Drive's picker maps each result to a principal.

### Handed on

- [Guest and link routes](011-guest-and-link-routes.md): the unlock screen,
  including the 429 wrong-password lockout; what `/l/<token>` shows while it
  calls ask 2; the store and its lifetime are decided here.
- Ticket 009 already decided the content-page side: the document session
  selects scoped codes for REST, collaboration and composite loads.

### Amended 2026-09-28 by ticket 011

- Ask 2 (`GET /links/<token>`) is withdrawn. The server resolves
  `/l/<token>` and redirects with the token in the URL fragment (Drive spec
  §6.2). Unlock is a `401 DriveLocked` state on the node route. See
  [Guest and link routes](011-guest-and-link-routes.md).
