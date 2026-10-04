# 44 — List inherited grants, keep a link's password on update, and send share email

**What to build:** The grants route lists inherited grants with their source node; a grant PUT patches the password instead of replacing it; a link PUT can email the link to one address and store it; a user grant PUT can send a share email. One spec fix on the `explain` and unlock shapes.

**Asks:** D19, D20, D21, D22, D23 (unified frontend spec §15.1).

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** done

**Owner:** Suite Drive engine and HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [008 — Sharing dialog and link credentials](../../../unified-frontend/tickets/008-sharing-dialog-and-link-credentials.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 9 (Sharing dialog) waits on D19 to D22. D23 blocks no stage.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.3 (`Drive Grant`), §5.8 (`explain`), §5.9 (grant), §5.12 (the activity row a grant write produces), §6.1, §6.4 (rotate and expiry), §9.5 (notifications), §11.2 "Grants, links, publishing". Unified frontend spec §7.3, §7.7, §7.8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] **D19.** `GET /nodes/<id>/grants?inherited=1` adds `inherited: [{grant, source_node, source_title}]`: every live grant on an ancestor of the node, grouped by ancestor from nearest to root, read with one query over the chain (§5.8's `EXPLAIN_SQL` without the principal filter). MANAGE on the node, as for local grants. A deny on the node itself stays in `grants`, not in `inherited`.
- [x] **D20.** On `PUT /nodes/<id>/grants/<principal>`, an omitted `password` keeps the stored hash, `password: null` clears it, and a non-empty string sets it. Changing a link's expiry alone never clears its password. §5.9 step 3 changes from "upsert all three columns" to "upsert role and expiry; password only when given". `expires_on` keeps its replace semantics; `expires_on: null` clears it.
- [x] **D21.** `PUT /nodes/<id>/grants/$LINK` accepts `send_to: <email>`. The workflow mints the link, stores the address on the row (`Drive Grant.sent_to`, a new Data field), sends one email with the `/l/<token>` URL, and returns the row with `sent_to`. A `send_to` on a principal that is not `$LINK` is refused (400).
- [x] **D22.** A grant PUT for an `<email>` principal accepts `notify: true`. It sends a share email to that user in addition to the §9.5 in-app notification. `notify` is never stored; omitted means no email.
- [x] Emails go through `frappe.sendmail` in a background job, with the sharer's name, the node title, the role, and the link, using `node_url` (issue 43) for a user share and the link URL for a link share. Sending is never on the request path and a mail failure never fails the grant.
- [x] **D23.** Drive spec §11.2 shows `explain?: {role, source, rows}` (an object, as §5.8 and `shapes.explain_shape` return) and the unlock answer `{ticket, expires}`. No code change unless the shape differs.
- [x] Tests cover: inherited listing over three levels with a deny on the middle node; password kept, cleared, and set; `send_to` on a link and refused on a user; `notify` sending exactly one email (queue inspected) and no email when omitted; the `explain` shape.
- [x] Documentation synced in the same change: Drive spec §3.3 (`sent_to`), §5.9 step 3, §11.2 (the grants GET, the PUT body, `explain`), `suite/drive/CONTEXT.md` if a term is new.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_grants`, `test_access`, `test_activity`, then `suite.drive.http.tests.test_http`. Record real output.

## Notes

- The unified share dialog shows each inherited grant under a folded "From <folder>" part with "Deny access here" (unified spec §7.3, §7.4). It needs the source node id and title, not the explain chain.
- Password links on a `$LINK` principal only (§5.9 refusal 10). A `null` password on a user principal is a no-op, not a refusal.
- One outsider email means one link (unified spec §7.8). Two sends to the same address make two rows.

## Completion evidence

Branch `forge/drive-44-grants-passwords-email`, based on `forge/drive-layer`
at `116dfa952`. Changes are uncommitted; the orchestrator commits.

Changed behavior:

- D19. `access.grants_for(..., inherited=True)` adds `inherited`: every live
  grant on an ancestor, nearest first, from one `INHERITED_SQL` read (the
  chain without the node, joined to `Drive Node` for `source_title`).
  `GET /nodes/<id>/grants?inherited=1` publishes
  `[{grant, redacted, source_node, source_title}]`. An ancestor link row
  is `redacted` unless the caller has MANAGE on its source node: its grant
  is then only `{node, principal: "$LINK", role, expires_on, has_password}`
  (review fix 1).
- D20. `access.grant(password=KEEP)` is the default. `KEEP` leaves the
  hash, `None` clears it, a string sets it. The PUT route maps an omitted
  `password` to `KEEP`, and a JSON `null` or `""` to `None`: it reads
  `frappe.form_dict`, because Frappe passes `None` for both.
- D21. New `Drive Grant.sent_to` (Data, Email). `send_to` is accepted on the
  bare `$LINK` only, as exactly one bare address (refusal 13, 400; review
  fix 3). The row stores it, and every grant
  row publishes `sent_to`.
- D22. `notify: true` is accepted on an `<email>` principal only (refusal
  14, 400). It is never stored.
- Email: `activity.queue_share_email` registers its own after-commit
  callback, which calls `frappe.enqueue` and logs any failure to the
  `suite.drive` file logger. A Redis failure after commit no longer turns the
  PUT into a 500 (review fix 2).
  `activity.send_share_email` (the job) calls `frappe.sendmail` with the
  sharer's name, the node title, the role verb, and `get_url` of `/l/<token>`
  or `node_url(node)`. A role 0 write sends no email.
- D23. Spec §11.2 now shows `explain?: {role, source, rows}`. §5.11 now
  shows `{ticket, expires}`, which the code already returned. No code change.
- Docs: Drive spec §3.3, §5.9 (signature, refusals 13 and 14, steps 2 to
  6), §5.11, §9.5 (share email), §11.2. `suite/drive/CONTEXT.md` adds
  **Share Email**.
- The frontend contract does not change: the grant routes declare no
  query, body, or output model. A fresh `contract.export` equals the
  committed `contract.json`.

Site: `bench --site slides.localhost migrate --skip-fixtures` with
`PYTHONPATH=<worktree>` added the `sent_to` column. `test_activity` first
errored 8 times on a stale Personal root for `drive-record-owner@example.com`
(provisioned 2026-09-06). `fixtures.drop_personal_root` removed it.

Commands (`PYTHONPATH=<worktree> bench --site slides.localhost run-tests
--module <m>`), results on 2026-09-30:

| Module | Result |
|---|---|
| `suite.drive.tests.test_grants` | Ran 40, OK |
| `suite.drive.tests.test_access` | Ran 12, OK |
| `suite.drive.tests.test_activity` | Ran 8, OK (after the stale root drop) |
| `suite.drive.http.tests.test_dispatch` | Ran 183, OK |
| `suite.drive.http.tests.test_routes` | Ran 104, OK |
| `suite.drive.http.tests.test_shims` | Ran 267, OK |
| `suite.drive.http.tests.test_translator` | Ran 32, OK |
| `suite.drive.http.tests.test_shapes` | Ran 46, OK |
| `suite.drive.http.tests.test_drive_link` | Ran 7, OK |
| `python -m unittest suite.tests.test_architecture` | Ran 7, OK |

`suite.drive.http.tests.test_http` in Verification names no module. The HTTP
tests are `test_dispatch` (real requests) and `test_routes` (adapter).

Open question: a role 0 write with `send_to` or `notify` sends no email. The
spec does not say what a "share" email for a deny would say.
