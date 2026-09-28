# 44 — List inherited grants, keep a link's password on update, and send share email

**What to build:** The grants route lists inherited grants with their source node; a grant PUT patches the password instead of replacing it; a link PUT can email the link to one address and store it; a user grant PUT can send a share email. One spec fix on the `explain` and unlock shapes.

**Asks:** D19, D20, D21, D22, D23 (unified frontend spec §15.1).

**Blocked by:** [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** ready-for-agent

**Owner:** Suite Drive engine and HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend ticket [008 — Sharing dialog and link credentials](../../../unified-frontend/tickets/008-sharing-dialog-and-link-credentials.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stage 9 (Sharing dialog) waits on D19 to D22. D23 blocks no stage.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.3 (`Drive Grant`), §5.8 (`explain`), §5.9 (grant), §5.12 (the activity row a grant write produces), §6.1, §6.4 (rotate and expiry), §9.5 (notifications), §11.2 "Grants, links, publishing". Unified frontend spec §7.3, §7.7, §7.8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] **D19.** `GET /nodes/<id>/grants?inherited=1` adds `inherited: [{grant, source_node, source_title}]`: every live grant on an ancestor of the node, grouped by ancestor from nearest to root, read with one query over the chain (§5.8's `EXPLAIN_SQL` without the principal filter). MANAGE on the node, as for local grants. A deny on the node itself stays in `grants`, not in `inherited`.
- [ ] **D20.** On `PUT /nodes/<id>/grants/<principal>`, an omitted `password` keeps the stored hash, `password: null` clears it, and a non-empty string sets it. Changing a link's expiry alone never clears its password. §5.9 step 3 changes from "upsert all three columns" to "upsert role and expiry; password only when given". `expires_on` keeps its replace semantics; `expires_on: null` clears it.
- [ ] **D21.** `PUT /nodes/<id>/grants/$LINK` accepts `send_to: <email>`. The workflow mints the link, stores the address on the row (`Drive Grant.sent_to`, a new Data field), sends one email with the `/l/<token>` URL, and returns the row with `sent_to`. A `send_to` on a principal that is not `$LINK` is refused (400).
- [ ] **D22.** A grant PUT for an `<email>` principal accepts `notify: true`. It sends a share email to that user in addition to the §9.5 in-app notification. `notify` is never stored; omitted means no email.
- [ ] Emails go through `frappe.sendmail` in a background job, with the sharer's name, the node title, the role, and the link, using `node_url` (issue 43) for a user share and the link URL for a link share. Sending is never on the request path and a mail failure never fails the grant.
- [ ] **D23.** Drive spec §11.2 shows `explain?: {role, source, rows}` (an object, as §5.8 and `shapes.explain_shape` return) and the unlock answer `{ticket, expires}`. No code change unless the shape differs.
- [ ] Tests cover: inherited listing over three levels with a deny on the middle node; password kept, cleared, and set; `send_to` on a link and refused on a user; `notify` sending exactly one email (queue inspected) and no email when omitted; the `explain` shape.
- [ ] Documentation synced in the same change: Drive spec §3.3 (`sent_to`), §5.9 step 3, §11.2 (the grants GET, the PUT body, `explain`), `suite/drive/CONTEXT.md` if a term is new.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_grants`, `test_access`, `test_activity`, then `suite.drive.http.tests.test_http`. Record real output.

## Notes

- The unified share dialog shows each inherited grant under a folded "From <folder>" part with "Deny access here" (unified spec §7.3, §7.4). It needs the source node id and title, not the explain chain.
- Password links on a `$LINK` principal only (§5.9 refusal 10). A `null` password on a user principal is a no-op, not a refusal.
- One outsider email means one link (unified spec §7.8). Two sends to the same address make two rows.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
