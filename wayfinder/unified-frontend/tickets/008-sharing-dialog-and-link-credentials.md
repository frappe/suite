---
id: 008
title: Sharing dialog and link credentials
label: wayfinder:grilling
status: open
assignee:
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
