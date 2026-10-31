---
id: 008
title: Link sharing semantics
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [002]
---

## Question

Links are per-token principals (`$LINK:<token>`), decided. The role cap is
decided in [Role ladder semantics](002-role-ladder-semantics.md): a link
may carry READ, COMMENT, UPLOAD, or EDIT, never MANAGE. Pin the rest:
password_hash and expiry on the grant; how a visitor's unlocked links live
in the session; guest rights over the collab websocket (Hocuspocus checks
access out-of-band); link revocation and rotation. The flat `$LINK` bypass
(any unlocked link matches every link-shared node) must be impossible by
construction.

Handed from Role ladder semantics: does the creator grant (EDIT on what
you create when below EDIT) fire for an UPLOAD link's uploads? A grant to
the token means anyone holding the link edits everything uploaded through
it. Likely answer: no row; decide here.

Red-team walkthroughs: scenarios S5 and S10. Blocked by Role ladder
semantics.

Handed from [Publishing capability](007-publishing-capability.md)
(2026-09-03): a `$PUBLIC` principal exists and caps at READ. Every
anonymous right above READ (Writer's shipped anonymous comments, file
requests, anyone-with-link edit) rides on a `$LINK:<token>` grant. Decide
here how a guest's unlocked links combine with `$PUBLIC` in the session
principal list, and whether Writer's anonymous comment author stays
`Guest` or becomes the link token.

## Resolution

Decided with Faris, 2026-09-03. Ten decisions.

Facts checked first: every guest shares the `Guest` sid and frappe stores
no session for it (`frappe/sessions.py:408`). Today's link is the empty
principal `""` with no password and no expiry. Hocuspocus checks access
once at connect with the `sid` cookie and refuses Guest
(`suite/sheets/collab.py:53`). Writer collab is WebRTC. Writer's anonymous
comment author is whatever the client wrote into the Yjs map. Scenarios S5
and S10 are not written out in the design doc; only the red-team summary
survives.

### 1. A link is a grant with a clear token

Principal `$LINK:<token>`, token 22 chars base62 (about 128 bits), stored
in clear in `Drive Grant.principal`. The share dialog must show the URL
again, the engine matches `principal IN (...)`, and the grants table is
already the trust root. Many links per node, one row each: a READ link and
an UPLOAD link on one folder are both legitimate. Rejected: hashed token
(URL shown once), one link per node.

### 2. Transport is stateless

The URL `/drive/l/<token>` seeds the client. The SPA keeps tokens in
localStorage and sends `X-Drive-Links: t1,t2` on every API call. The
server builds the principal list per request from the sid plus every valid
header token. Signed-in users send the header too, so a link a colleague
pasted works without signing out. No cookie: a cookie-held capability rides
forged cross-site requests, and Guest has no CSRF token. Rejected: signed
cookie; a server-side link-session doctype.

### 3. Password links unlock into an HMAC ticket

`password_hash` uses the same passlib context as User passwords. Unlock is
one endpoint: `unlock(token, password)` verifies the hash, counts failures
per token in cache and refuses after a few (login-attempt-tracker style),
and returns

```
ticket = exp + "." + HMAC-SHA256(site_secret, token + "|" + password_hash + "|" + exp)
```

with a 30-day `exp`. The client then sends `<token>.<ticket>` in the
header. Each request costs one HMAC, never a passlib verify. A bare token on
a password grant matches nothing. A password change or a rotation changes
the HMAC input, so every ticket dies at once. No row is written anywhere.
Rejected: password on every request; unlock rows keyed by a visitor cookie.

### 4. A deny on you is final; a link can only raise you

The engine resolves in two passes.

1. Own principals: email, `$GROUP:*`, `$GENERAL`. Nearest wins, same-depth
   tie-break email > group > `$GENERAL`. If the result is a deny, the
   answer is refused. Done.
2. Otherwise resolve `$PUBLIC` and every valid `$LINK:*` together, nearest
   wins, same-depth tie takes the highest role. The answer is the higher of
   pass 1 and pass 2.

Consequences, each walked through with an example:

- Priya holds EDIT on `Reports` and clicks a READ link on a file inside.
  She keeps EDIT. A link never lowers anyone.
- Bob is denied on `Reports` and holds a link on a file inside. Refused. A
  deny naming a person or group beats a link anywhere below it, not only
  on the same node.
- Member Bob holds `$GENERAL UPLOAD` in the Shared Root and receives an
  EDIT link on a file there. He edits. Links work for members.
- A guest opens a COMMENT link on a published document (`$PUBLIC READ`
  above). The guest comments. This is the Writer anonymous-comment path
  that Publishing capability routed here.
- A `$PUBLIC` deny nearer the node (an unpublished file inside a published
  folder) also cuts link holders of the folder. Nearest wins inside pass 2.

Rejected: single-pass nearest-wins over all principals (presenting a link
lowers the visitor; two answers for one file depending on the header);
"links only fill gaps" (links do nothing for members in the Shared Root or
for guests on published content); links for guests only.

### 5. No creator grant for link uploads

An upload through an UPLOAD link writes no EDIT grant. The grant would
name the token, and every holder would edit and trash every upload. The
uploader cannot rename, replace, or trash the file after it lands; MANAGE
holders can. UPLOAD contains READ, so the uploader sees the folder. A blind
drop-box is out of scope: UPLOAD without READ is unrepresentable (Role
ladder semantics).

### 6. Guest identity is Guest plus via_link

`owner` and activity `actor` stay `Guest`. Every activity row gains
`via_link`, set to the link principal when the grant that decided the
right named a link, for guests and signed-in users alike. Comments carry
author `Guest` plus an optional `author_name` the visitor typed. The
server sets the author; the client no longer does. The token is never an
author: it is a secret, and rotation would rename history. Rejected: the
token as author; Guest with nothing else (two links on one folder become
indistinguishable in the log).

### 7. Collab socket re-checks on an interval

The browser sends the sid and its link tokens as the connection token.
`check_collab_access` resolves the node role from the full principal list:
EDIT means write, READ or COMMENT means read-only, no role means refuse.
Guests get a generated display name. The collab server re-asks Frappe for
every connection on a fixed interval, users and links alike, and
disconnects a revoked or expired principal. The spec picks the number;
five minutes suggested. Writer collab is WebRTC and checks on save; not
changed here. Rejected: check at connect only (today's unbounded leak);
Redis push from grant writes (new plumbing for an exact answer nobody
asked for).

### 8. Lifecycle

- `expires_on` is a column on every grant, any principal. "EDIT for Bob
  for two weeks" costs nothing extra. The engine already filters it.
- `password_hash` is valid on `$LINK:*` only. The grant path refuses it on
  any other principal.
- Revoke deletes the row.
- Rotate is one operation: new token, same role, password, and expiry, one
  activity row (old principal to new principal).
- A daily sweep deletes link grants past `expires_on`. Activity rows stay.

### 9. Guardrails

- A link grant naming a Drive Root is invalid for everyone, Suite Admin
  included. Same rule as `$PUBLIC`.
- No link auth over WebDAV. WebDAV clients present user credentials and
  have no place for a token.
- The shared URL is `/drive/l/<token>`. The server looks up the grant,
  redirects to the node route, and seeds the token. The node id never
  appears in a shared URL, and rotation changes the URL.

### 10. Links inherit and can be denied

A link grant on a folder reaches everything below it. A deny naming a link
principal on a child is an ordinary grant row. Nothing special.

### Handed off

- No link auth over WebDAV: WebDAV mapping (009) closed the same day with
  the same answer (auth stays Basic, no link principals). Nothing to hand.
- `user = ""` rows above read become a `$LINK:<token>` grant with a fresh
  token, no password, no expiry -> Migration mapping (011).
- Two-pass resolution, header format, ticket format, `via_link` column,
  sweep, collab re-check interval, unlock rate limit -> Draft the spec
  (013).
- Link create, rotate, unlock, `/drive/l/<token>`, `X-Drive-Links`, the
  "locked" response, `via_link` in activity -> HTTP API surface (014).
- Blind drop-box -> Out of scope on the map.
- Glossary updated: **Share Link**, **Unlock**, Principal line, seven
  relationship lines, one flagged ambiguity (`suite/drive/CONTEXT.md`).
