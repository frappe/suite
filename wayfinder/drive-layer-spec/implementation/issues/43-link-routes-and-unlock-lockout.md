# 43 — Serve share links at `/l/<token>`, redirect by node kind, and answer lockouts with `Retry-After`

**What to build:** The share link URL becomes `/l/<token>`. The website route resolves the token and redirects by node kind to the unified frontend's folder or document route with the token in the fragment. The unlock lockout answers 429 with `Retry-After` from the failure that sets it. One helper, `node_url`, on the Drive Python interface builds every node link the server sends.

**Asks:** D17, D24, D25 (unified frontend spec §15.1).

**Blocked by:** [08 — Manage grants and share links with explicit denial](08-grant-and-link-workflows.md); [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend tickets [008 — Sharing dialog and link credentials](../../../unified-frontend/tickets/008-sharing-dialog-and-link-credentials.md) (D17) and [011 — Guest and link routes](../../../unified-frontend/tickets/011-guest-and-link-routes.md) (D24, D25). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). The route prefix follows ticket [020 — Unmapped legacy routes and the /files path](../../../unified-frontend/tickets/020-unmapped-legacy-routes-and-the-files-path.md): the area prefix is `/drive`. Unified plan stages 8 (guest and link routes; D24, D25), 9 (sharing dialog; D17), 12 (`node_url` callers) and 13 (flip 2 gate: the `/l/<token>` rule exists) wait on it.

**Source:** [Drive spec](../../drive-layer-spec.md), §4.8 (unlock ticket), §5.9 step 5 (the URL a grant returns), §6.2 (transport is stateless), §6.3 (password unlock and the lockout), §11.2 "Grants, links, publishing" and the `GET /drive/l/<token>` paragraph, §11.6. Unified frontend spec §2.1, §10.1, §10.2, §14.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] **D17.** `PUT /nodes/<id>/grants/$LINK`, `POST /grants/<id>/rotate`, and every listed link grant return `url = "/l/<token>"`. No Drive code builds `/drive/l/`.
- [ ] **D24.** `/l/<token>` is a Frappe website route served by `suite/www/drive_link.py` (renamed or aliased; one `website_route_rules` entry in `suite/hooks.py`). It resolves the grant and answers 302 to `node_url(node)` with `#link=<token>` appended. No slug is sent. Refusals keep today's page: 404 for an unknown token, 410 for an expired one.
- [ ] `node_url(node)` lives on the Drive Python interface (`suite/drive/__init__.py`, per `ARCHITECTURE.md` rules 2.1 and 2.2). It reads `suite_flip_files` from `frappe.conf`. Key on: a folder or root node gives `/drive/f/<id>`; every other kind gives `/d/<id>`. Key off: `/drive/g/<id>`, today's legacy address. No other server code builds a node path string; the unified plan stage 12 replaces the remaining callers.
- [ ] The old `/drive/l/<token>` website rule keeps answering until the composition redirect table (unified plan stage 12) sends it to `/l/<token>`. It calls the same resolver.
- [ ] **D25.** The failure that sets the lockout answers 429, not 401. Every 429 carries `Retry-After: <seconds left in the lockout>`. A wrong password before the limit still answers 401 `DriveLocked`.
- [ ] Tests cover: the URL on create, rotate, and list; the website route for a folder and a file with the key on and off; an expired and an unknown token; `node_url` per kind and key; the fifth failure answering 429 with `Retry-After`, and the header's value shrinking on the next call.
- [ ] Documentation synced in the same change: Drive spec §5.9 step 5, §6.2, §11.2 (the `url` value and the website-route paragraph), and `suite/www/drive_link.py`'s module docstring.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_grants`, `test_principals`, then `suite.drive.http.tests.test_http`, `test_translator`, and a website-route test module for `drive_link`. Record real output.

## Notes

- The fragment carries the token so it never reaches a server log or a `Referer` (unified spec §10.1). Keep `TOKEN_PARAM = "link"`.
- Unified spec §14.3: `/drive/l/<token>` redirects to `/l/<token>` through the composition table, not through Drive. Drive keeps the old rule only until that table exists.
- `frappe.RateLimitExceededError` already passes through the route boundary as 429 (`suite/drive/http/routes.py`). The header is what is missing.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
