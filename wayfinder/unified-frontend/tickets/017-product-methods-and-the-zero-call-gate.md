---
id: 017
title: Product methods and the zero-call gate
label: wayfinder:grilling
status: open
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

Ticket 014 gates flip 2 on "zero legacy `suite.drive.api.*` calls" in new
code, and gates deletion on a legacy-call counter at zero. Drive §11.7 keeps
the 19 `suite.drive.api.product` methods on `/api/method/` by design. The
Files settings tabs from ticket 016 call some of them today
(`webdav_config`, `set_webdav_enabled`, `disk_settings`, `is_site_admin`),
and Statistics calls `storage.storage_breakdown`. Read literally, the
counter never reaches zero and deletion never happens. Drive §14.10 adds a
conflict: it deletes "the 69 API forwarders except the three permanent
names", and the 69 include the product methods.

Decide:

- Which names the boundary check bans in new code, and which names the
  counter (ask D26) must show at zero. Likely: only the names Drive §11.7
  maps to a REST route; the product methods and the three permanent names
  are exempt.
- Whether the Files settings tabs call product methods at launch or wait for
  `/api/suite/drive/` routes. That would be a new Drive ask.
- The Drive §11.7 against §14.10 conflict: an ask on the Drive program.
- The hold clock: if the counter shows a call during the hold, does the
  14-day period restart? Ticket 014 does not say.

Raised by the spec and plan audits of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

## Proposed resolution

Proposed on 2026-09-29 by a Fable subagent. Pending Faris's answers to the
irreversible decisions below.

In short: the gate counts only the names Drive Cleanup deletes. The 21
permanent names (the 19 product methods, `s3.fetch` and
`get_file_for_doc`) are exempt from the ban and from the zero read. The
Files settings tabs call three product methods at launch. The Storage tab
does not ship, because its whole content dies with Drive Build. The §11.7
against §14.10 conflict is one wording ask on the Drive program, for Faris.

### Facts checked against the code

- `suite/drive/http/shims.py` `CLASSIFICATION` holds all 69 legacy names:
  37 forwarder, 8 retained, 3 retired, 21 permanent. The permanent class is
  the 19 `api.product.*` names plus `api.s3.fetch` and
  `overrides.file.get_file_for_doc`. Drive plan line 211 keeps
  `api/product.py` ("19 methods, none touches a node"). So the Drive code
  and plan already treat the product methods as permanent. Only Drive
  §14.10's sentence ("the 69 API forwarders except the three permanent
  names") says otherwise. Read literally it deletes 67 names.
- Drive §11.7 also says Cleanup removes `/api/method/suite.drive.api.` from
  `ALLOWED_WILDCARD_PATHS` (`suite/hooks.py:577`). The product methods live
  under that prefix. Nothing reads `DENIED_WILDCARD_PATHS` today, so this is
  a second wording conflict, not a live break.
- No counter exists. Ask D26 is open.
- The legacy Files tabs
  (`frontend/src/apps/drive/legacy/components/Settings/`) call:
  - Dialog conditions: `product.is_site_admin`, `product.webdav_config`.
  - Statistics: `storage.storage_breakdown` (forwarder).
  - External access: `product.webdav_config`, `product.set_webdav_enabled`
    (admin site switch), `product.set_settings` (per-user `webdav_enabled`),
    and `suite.utils.user.generate_user_keys` (a Suite method, not Drive).
    `webdav_config` already returns `is_admin`.
  - Storage: `product.disk_settings` GET and PUT (root folder, disk or S3,
    the five S3 fields) and a Sync button over `scripts.sync_preview`
    (retained) and `scripts.sync_from_disk` (retired, answers 410).
- Drive §3.13 drops `root_folder` and the six S3 fields in Cleanup.
  Storage configuration moves to `site_config` at Build. So every control
  on the Storage tab is dead after Build, and the ticket's list of four
  names is one short: `set_settings` is the fifth.
- New (non-legacy) files that call legacy names today: `apps/drive/runtime.ts`,
  `apps/writer/runtime.ts` and `apps/writer/routes.ts` (`get_translations`),
  six Writer components, Sheets `usePersistence.js` and Slides
  `stores/presentation.js` (`track_visit`).
- Suite resources already shipped: `GET /api/suite/users`,
  `GET/POST /api/suite/invitations`, `GET /api/suite/account` with
  `roles.system_manager` (`suite/api/routes.py`).

### Decided (reversible)

1. **The ban list.** `check-import-boundaries.mjs` fails on any
   `suite.drive.api.` string outside `apps/drive/legacy`, with two lists.
   An exact allowlist of permanent names new code may call, each entry
   with an owner, a reason and a review condition (ticket 013's baseline
   shape). And the shrinking baseline for today's callers outside
   `legacy/`, listed above; the Writer and Drive entries go at stage 15,
   and the Sheets and Slides `track_visit` entries go at stage 11 when the
   session's `POST /nodes/<id>/visit` replaces them. Reason: a permanent
   name is not legacy debt, and a lint rule is one commit to change
   [shims `CLASSIFICATION`, T013, Drive plan line 211].
2. **The initial allowlist is three names.** `product.webdav_config`,
   `product.set_webdav_enabled` and `product.set_settings`, owned by the
   Files settings module. The other 16 permanent names are banned in new
   code because each has a decided replacement or no caller:
   `get_users`, `get_my_invites`, `get_pending_invites`, `invite_users`,
   `accept_invite`, `reject_invite` are Suite resources [T003];
   `get_translations` is platform translation [spec §3.14]; `signup`,
   `send_otp`, `verify_otp`, `oauth_providers`, `signup_disabled` go with
   `/drive/signup` [T014 decision 6]; `is_site_admin` is carried by
   `webdav_config.is_admin`; `disk_settings` has no tab (decision 5);
   `get_settings` and `get_user_groups` have no new caller. Adding a name
   later is one allowlist line with a reason. `s3.fetch` and
   `get_file_for_doc` never appear in frontend source [T005].
3. **The counter and the zero read.** D26 does not change: it counts every
   legacy name, keyed by name and user agent. The gate reads zero over the
   48 non-permanent names, `names_of(FORWARDER) + names_of(RETAINED) +
   names_of(RETIRED)`. The 21 permanent names may show hits during the
   hold; they are reported, not blocking. Reason: the gate exists to prove
   the forwarders can go, and the permanent names do not go
   [T014 decision 8, Drive §14.10 gate 3].
4. **Files tabs at launch.** Statistics and External access ship. The
   Files settings module calls the three allowlisted product methods and
   `suite.utils.user.generate_user_keys` through the platform transport on
   `/api/method/`. No new Drive route. Reason: Drive §11.7 puts these
   names outside its route namespace, and three calls do not justify
   overturning that [Drive §11.7, T003, T016]. The External access
   condition is one `webdav_config` read when the dialog opens; it pulls
   in no store [T016 decision 3]. Statistics uses `GET /roots/<id>/usage`
   until D10, as stage 4 already says.
5. **The Storage tab does not ship.** Amends ticket 016 decision 2 ("Storage
   for admins"). Every control on it (root folder, disk or S3, the S3
   fields, Sync) is dead after Drive Build and dropped in Cleanup, and
   Sync already answers 410. Reason: porting a form Build makes vestigial
   is waste, and no method writes the settings that survive (quotas,
   preview size) [Drive §3.13, shims `RETIRED`]. Files has two tabs at
   launch. A site storage surface for admins is a later Drive-program
   need, not an ask now. Assumption: Drive Build reaches production before
   flip 2, as plan stage 13 states (ticket 019 owns the order).
6. **The hold clock.** The hold needs 14 consecutive days at zero plus one
   full release. "Zero" means no non-permanent count rose between two
   reads. Reads happen at the start, once a week, and at the end, by
   whoever runs the flip's `bench set-config` (ticket 019). A non-zero read
   ends the streak. After the client is fixed or retired, the 14 days start
   again at the next zero read. The release clock restarts only if the fix
   itself needs a release. A hit from a browser user agent in the first
   days is a stale legacy tab; it retires itself on reload, so wait for the
   next zero read. Reason: the gate is evidence of no callers, and a
   14-day window with a hit in it is not that evidence [T014 decision 8].

### For Faris (irreversible)

1. **Whether the 19 product methods are permanent, and the Drive wording
   ask.** Drive keeps the product methods on `/api/method/` (§11.7, its
   plan, its code), but §14.10 says Cleanup deletes "the 69 forwarders
   except the three permanent names", and §11.7's hardening line drops the
   whole `suite.drive.api.` prefix from the allowlist. Example: after
   Cleanup, the new External access tab calls
   `suite.drive.api.product.webdav_config`; under §14.10 as written that
   name is gone and the tab breaks. Options:
   - A. Treat the 19 as permanent. File one Drive ask: §14.10 deletes the
     48 non-permanent names, gate 3 reads "the 48", and Cleanup keeps
     `/api/method/suite.drive.api.product.` and `.s3.fetch` in the
     allowlist. Pro: matches Drive's own code and plan; no new routes; a
     wording fix like D23. Con: three RPC names live in new code for good.
   - B. Treat the 19 as legacy. File a Drive ask for settings routes
     (`GET/PATCH /api/suite/drive/settings` and a site-settings route).
     Pro: new code calls REST only. Con: overturns a Drive decision the
     Drive spec owns, adds routes for three calls, and blocks stage 4 on a
     new ask.
   - C. Treat the 19 as permanent and file nothing. Pro: no ask. Con: the
     conflict stays in the document that wins for Drive behavior, and the
     issue 36 evidence ("moved off the 69") does not match what we hand over.
   Recommendation: A. Decisions 1 to 4 above assume it. Under B they flip:
   the allowlist is empty and stage 4's External access tab waits on the
   routes. **Question:** may I file the §14.10 and §11.7 wording ask on the
   Drive program, so the 19 product methods are permanent?

### Spec and plan changes

Spec (`unified-frontend-spec.md`):

- §4.4, last bullet: replace "Whether they are exempt ... (section 16)"
  with: the 21 permanent names in `shims.CLASSIFICATION` are exempt from
  the no-legacy-call rule; new code may call only the allowlisted three
  (`webdav_config`, `set_webdav_enabled`, `set_settings`), with a reason
  per entry in the boundary check.
- §12.2 Files row: tabs "Statistics; External access", condition "External
  access when WebDAV is on or the user is an admin". Add a bullet: the
  legacy Storage tab does not ship; its controls die with Drive Build
  [Drive §3.13, T017].
- §13.3, second bullet: replace "Ticket 017 settles which names the ban
  covers" with the two-list rule (permanent allowlist with reasons,
  shrinking baseline for today's callers).
- §14.7 flip 2 gate: "New code calls none of the 48 non-permanent legacy
  names, checked by the boundary check. The three allowlisted permanent
  names are not legacy calls."
- §14.8, first bullet: add "at zero over the 48 non-permanent names".
  Add the hold clock rule (decision 6) as a bullet.
- §15.1 D26 row status: "open. Counts every name; the gate reads the 48
  non-permanent names [T017]". Add the wording ask as a new row (D30, if
  Faris says yes to A): "Drive §14.10 deletes the 48 non-permanent names;
  gate 3 says 48; the allowlist keeps the product and `s3.fetch` prefixes".
- §16.1 item 1: closed by T017. §16.2 item 16: unchanged.

Plan (`unified-frontend-plan.md`):

- Stage 4: drop "The Files tabs that call Drive product methods wait on
  ticket 017". Add: Files ships Statistics and External access; the
  settings module calls `webdav_config`, `set_webdav_enabled`,
  `set_settings` and `suite.utils.user.generate_user_keys`; no Storage tab.
- Stage 11: the boundary-check bullet becomes the two-list rule; the
  Sheets and Slides `track_visit` baseline entries go in this stage.
  Remove "The boundary rule's name list waits on ticket 017".
- Stage 12: the counter line adds "reads at start, weekly and end".
  Remove "Ticket 017 (which names the counter counts)".
- Stage 13 gate: "zero of the 48 non-permanent names". Remove "Ticket 017
  (which names read zero)".
- Stage 14: replace "Ticket 017 decides whether the clock restarts" with
  decision 6. Remove the ticket 017 dependency.
- Stage 15 exit gate: "`grep -rn "suite.drive.api" frontend/src` returns
  only the three allowlisted permanent names". Remove "Ticket 017 (exempt
  names)".
- Backend asks D26 row: as the spec row. Add the D30 row.
- Handoff to Drive Cleanup: the evidence says "48 non-permanent names",
  and lists the 21 permanent names by class from `shims.CLASSIFICATION`.
- Open items: delete the ticket 017 entry.

### Asks

- Drive program, pending Faris (irreversible item 1, option A): fix §14.10
  and §11.7 wording so Cleanup deletes the 48 non-permanent names, gate 3
  reads "48", and `ALLOWED_WILDCARD_PATHS` keeps
  `/api/method/suite.drive.api.product.` and `/api/method/suite.drive.api.s3.`.
- None on Meet, Mail, Calendar or Suite.
