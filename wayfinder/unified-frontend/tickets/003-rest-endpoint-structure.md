---
id: 003
title: REST endpoint structure beyond Drive
label: wayfinder:grilling
status: closed
assignee: codex (agent, 2026-09-14)
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

## Resolution

- Drive is the reference contract and the first implementation. New routes
  use resource nouns and HTTP verbs under the unversioned
  `/api/suite/<owner>/...` namespace; legacy RPC method names do not leak into
  the paths. Other products converge on this contract incrementally rather
  than preserving their accidental conventions in the new namespace.
- The common transport contract is deliberately smaller than any one product:
  Frappe v2 success and error envelopes, framework authentication, shared HTTP
  status meanings and validation mechanics, and an opaque cursor for a
  collection that is paged. A singleton or bounded window does not pretend to
  have a cursor. Resource shapes and domain error types stay with the owning
  product; Mail does not expose Drive-named errors.
- `suite/composition` owns one before-request dispatcher that selects the
  `<owner>` segment. Suite and each product own typed route tables and handlers
  in their HTTP adapters; resource shapes and domain errors remain with the
  owning module. Composition does not collect product resource routes in one
  central table. Drive's existing translator is adapted into this registration
  shape and remains the behavior reference.
- Product-neutral account, site, user and invitation resources are Suite
  resources. They stay under `suite/api/` with a Suite-owned route table; the
  shell is a caller, not a backend domain owner. Product account details and
  settings remain product-owned, and there is no `/api/suite/shell/...`
  namespace.
- The minimum non-Drive launch surface is:

  | Caller | Route |
  |---|---|
  | boot and session | `GET /api/suite/account` |
  | onboarding and site settings | `GET/PATCH /api/suite/site` |
  | Suite user settings | `GET /api/suite/users` |
  | Suite invitations | `GET/POST /api/suite/invitations` |
  | Mail rail state | `GET /api/suite/mail/inbox-summary` |
  | Home upcoming | `GET /api/suite/calendar/events` |
  | instant or restricted Meet | `POST /api/suite/meet/rooms` |
  | scheduled Meet | `POST /api/suite/meet/scheduled-meetings` |

  Ticket 012 may refine parameters, shapes, limits and which of these the
  launch UI renders; widening this migration surface is a separate decision.
  Drive recents, notifications and document creation use Drive's existing
  table. Palette jump and create use the client route registry and Drive
  creation respectively, so Ticket 003 adds no Suite search or palette route.
- Home queries product resources concurrently through the server-state client.
  Each section keeps its own cache, refresh and failure state. A Suite backend
  aggregate is added only if a later ticket defines a genuine cross-product
  invariant, such as one globally ordered feed; a page-shaped convenience
  response is not enough reason.
- REST adoption is additive during grow-beside. A legacy method and its REST
  handler are thin adapters over one product-owned workflow; behavior,
  authorization and tests are never copied. The product owner removes the
  legacy adapter only after its migration owns a checked zero-caller inventory,
  not merely when the unified shell switches on. Existing mounted product
  internals keep their legacy calls until their own migration.
- Drive's translator tests become an executable conformance kit for every
  registered adapter: method and path routing, v2 envelopes, path identifiers
  winning over conflicting body values, status/error behavior, and opaque
  cursor behavior where applicable. Typed registration plus this kit is the
  handoff contract; written conventions alone are insufficient.
