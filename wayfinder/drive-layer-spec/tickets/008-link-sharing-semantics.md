---
id: 008
title: Link sharing semantics
label: wayfinder:grilling
status: open
assignee:
blocked-by: [002]
---

## Question

Links are per-token principals (`$LINK:<token>`), decided. Pin the rest:
password_hash and expiry on the grant; how a visitor's unlocked links live
in the session; which roles a link may carry; guest rights over the collab
websocket (Hocuspocus checks access out-of-band); link revocation and
rotation. The flat `$LINK` bypass (any unlocked link matches every
link-shared node) must be impossible by construction.

Red-team walkthroughs: scenarios S5 and S10. Blocked by Role ladder
semantics.
