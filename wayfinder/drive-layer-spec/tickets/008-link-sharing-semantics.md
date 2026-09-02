---
id: 008
title: Link sharing semantics
label: wayfinder:grilling
status: open
assignee:
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
