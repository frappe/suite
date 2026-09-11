---
id: 003
title: REST endpoint structure beyond Drive
label: wayfinder:grilling
status: open
assignee:
blocked-by: []
---

## Question

The new frontend calls REST endpoints under one structure. Drive's
`/api/suite/drive/...` table exists (spec §11, `suite/drive/http/`). Decide
the structure for everything else the new frontend calls now, and the
copy-or-move policy.

Settle:

- The path convention for other apps: `/api/suite/<app>/...` with the same
  translator, envelope, error classes and cursor as Drive, or a lighter rule.
- Which non-Drive endpoints the new frontend needs at launch: Home recents
  (Drive Recent covers content nodes; do Mail threads or Calendar events join
  it?), Home upcoming (Calendar events, Meet rooms and join), the Mail
  unread badge, palette jump and create, account and settings.
- Copy versus move: does a copied endpoint keep the legacy method alive for
  the old pages during grow-beside, and who deletes it at the switch.
- Whether the shell's own endpoints live under `suite/api/` (today only
  `account.py`) or under each product with a translator entry.
- How this hands off to each app's later migration without redoing it.

Inputs: Drive spec §11.1 (translator), §11.3 to §11.6 (shapes, cursor,
batch, errors), `suite/hooks.py` translator registration (lines 427 to
455 and 555), `suite/api/account.py`, `suite/calendar`, `suite/mail/api`,
`suite/meet` public methods.
