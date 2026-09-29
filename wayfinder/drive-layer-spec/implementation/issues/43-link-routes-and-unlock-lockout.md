# 43 — Serve share links at `/l/<token>`, redirect by node kind, and answer lockouts with `Retry-After`

**What to build:** The share link URL becomes `/l/<token>`. The website route resolves the token and redirects by node kind to the unified frontend's folder or document route with the token in the fragment. The unlock lockout answers 429 with `Retry-After` from the failure that sets it. One helper, `node_url`, on the Drive Python interface builds every node link the server sends.

**Asks:** D17, D24, D25 (unified frontend spec §15.1).

**Blocked by:** [08 — Manage grants and share links with explicit denial](08-grant-and-link-workflows.md); [22 — Expose sharing, views, history, and comments through HTTP](22-http-sharing-and-records.md)

**Status:** done

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Raised by:** unified frontend tickets [008 — Sharing dialog and link credentials](../../../unified-frontend/tickets/008-sharing-dialog-and-link-credentials.md) (D17) and [011 — Guest and link routes](../../../unified-frontend/tickets/011-guest-and-link-routes.md) (D24, D25). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). The route prefix follows ticket [020 — Unmapped legacy routes and the /files path](../../../unified-frontend/tickets/020-unmapped-legacy-routes-and-the-files-path.md): the area prefix is `/drive`. Unified plan stages 8 (guest and link routes; D24, D25), 9 (sharing dialog; D17), 12 (`node_url` callers) and 13 (flip 2 gate: the `/l/<token>` rule exists) wait on it.

**Source:** [Drive spec](../../drive-layer-spec.md), §4.8 (unlock ticket), §5.9 step 5 (the URL a grant returns), §6.2 (transport is stateless), §6.3 (password unlock and the lockout), §11.2 "Grants, links, publishing" and the `GET /drive/l/<token>` paragraph, §11.6. Unified frontend spec §2.1, §10.1, §10.2, §14.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] **D17.** `PUT /nodes/<id>/grants/$LINK`, `POST /grants/<id>/rotate`, and every listed link grant return `url = "/l/<token>"`. No Drive code builds `/drive/l/`.
- [x] **D24.** `/l/<token>` is a Frappe website route served by `suite/www/drive_link.py` (renamed or aliased; one `website_route_rules` entry in `suite/hooks.py`). It resolves the grant and answers 302 to `node_url(node)` with `#link=<token>` appended. No slug is sent. Refusals keep today's page: 404 for an unknown token, 410 for an expired one.
- [x] `node_url(node)` lives on the Drive Python interface (`suite/drive/__init__.py`, per `ARCHITECTURE.md` rules 2.1 and 2.2). It reads `suite_flip_files` from `frappe.conf`. Key on: a folder or root node gives `/drive/f/<id>`; for a root the router replaces it with `/drive` or `/drive/organization` (unified §2.2). Every other kind gives `/d/<id>`. Key off: `/drive/g/<id>`, today's legacy address. No other server code builds a node path string; the unified plan stage 12 replaces the remaining callers.
- [x] The old `/drive/l/<token>` website rule keeps answering until the composition redirect table (unified plan stage 12) sends it to `/l/<token>`. It calls the same resolver.
- [x] **D25.** The failure that sets the lockout answers 429, not 401. Every 429 carries `Retry-After: <seconds left in the lockout>`. A wrong password before the limit still answers 401 `DriveLocked`.
- [x] Tests cover: the URL on create, rotate, and list; the website route for a folder and a file with the key on and off; an expired and an unknown token; `node_url` per kind and key; the fifth failure answering 429 with `Retry-After`, and the header's value shrinking on the next call.
- [x] Documentation synced in the same change: Drive spec §5.9 step 5, §6.2, §11.2 (the `url` value and the website-route paragraph), and `suite/www/drive_link.py`'s module docstring.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.tests.test_grants`, `test_principals`, then `suite.drive.http.tests.test_http`, `test_translator`, and a website-route test module for `drive_link`. Record real output.

## Notes

- The fragment carries the token so it never reaches a server log or a `Referer` (unified spec §10.1). Keep `TOKEN_PARAM = "link"`.
- Unified spec §14.3: `/drive/l/<token>` redirects to `/l/<token>` through the composition table, not through Drive. Drive keeps the old rule only until that table exists.
- `frappe.RateLimitExceededError` already passes through the route boundary as 429 (`suite/drive/http/routes.py`). The header is what is missing.

## Completion evidence

Worktree `suite-drive-43`, branch `forge/drive-43-link-routes-unlock`, based on
`forge/drive-layer` at `bcb7bb1d1`. Uncommitted; the orchestrator commits.
Agents wrote the code and ran the checks below on 2026-09-29.

### Changed behavior

- **D17.** `_grant_result` in `suite/drive/_core/access.py` spells every link
  grant's `url` as `LINK_ROUTE + token`, with `LINK_ROUTE = "/l/"`. Create,
  rotate, and the grant list all read it. No Drive code builds `/drive/l/`.
- **`node_url(node)`** on the Drive interface (`suite/drive/__init__.py`,
  added to `__all__`), implemented in `suite/drive/_core/nodes.py`. It reads
  `suite_flip_files` from `frappe.conf`. Key on: `root` or `folder` gives
  `/drive/f/<id>`, every other kind `/d/<id>`, an unknown node
  `DriveNotFound`. Key off: `/drive/g/<id>` with no row read. No role check.
  This ticket replaces two callers only: the grant share URL and
  `drive_link.py`'s `NODE_ROUTE`. The remaining callers are deferred to
  unified plan stage 12, as the criterion says.
- **D24.** `suite/hooks.py` gains `{"from_route": "/l/<token>", "to_route":
  "drive_link"}`. The `/drive/l/<token>` rule stays and reaches the same page.
  `suite/www/drive_link.py` answers 302 to `drive.node_url(node)` +
  `#link=<token>`, and drops `NODE_ROUTE`. Refusals are unchanged: 404 for an
  unknown token, 410 for an expired one.
- **D25.** `_verify_link_password` answers `"locked"` for the failure that
  reaches `UNLOCK_FAILURE_LIMIT`, not only for a bucket that was already
  locked. `_verify_link_password` returns an `UnlockOutcome`; a lockout
  carries the bucket's redis TTL (at least 1), read inside the same per-token
  lock that decided the lockout. `unlock_link` raises
  `frappe.RateLimitExceededError` with that value as `retry_after`. The
  `_route` boundary in `suite/drive/http/routes.py` copies it into
  `Retry-After`. Failures 1 to 4 still answer 401 `DriveLocked`.
- Docs: Drive spec §3 index row, §5.9 step 5, §6.2, §6.3, §11.2 (`url`, the
  unlock bullet, the website-route paragraph); `drive_link.py` module
  docstring; `suite.drive` docstring (errors row, performance row).
- Contract: `bench execute suite.composition.contract.write_all` wrote into
  the worktree and changed nothing. No route shape changed, so
  `yarn generate:contract` was not needed.

### Tests

- New module `suite/drive/http/tests/test_drive_link.py` (7 cases). It lives
  under Drive because `suite/www/` may not import Drive fixtures (the
  architecture check refused it there). `node_url` per kind (root, folder,
  file, document, link) with the key on and off, and an unknown node. The
  website route through Frappe's WSGI app: a folder and a file link with the
  key on and off, the old `/drive/l/` address, an unknown token (404) and an
  expired one (410), both on the page. The request thread rebuilds
  `frappe.conf`, so the key is set by wrapping `frappe.config.get_site_config`.
- `test_dispatch`: the mint/rotate case now checks `/l/<token>` on create,
  rotate, and the grant list. New case
  `test_the_failure_that_sets_the_lockout_answers_429_with_the_seconds_left`:
  four 401s, the fifth 429 with `Retry-After` 899 to 900; after the bucket TTL
  is cut to 300, the right password answers 429 with 299 to 300.
- `test_grants`: the fifth failure now raises `RateLimitExceededError`. The two
  concurrency cases changed with the rule: 12 parallel failures give 4
  `failed` and 8 `locked` (was 5 and 7); the interleaved fifth failure answers
  `locked` (was `failed`). `verify` still runs 5 times.
- Review fixes: `test_grants` case
  `test_the_lockout_seconds_describe_the_bucket_that_refused` replaces the
  bucket with a fresh counter as the per-token lock is released. It failed
  first (`900 not found in range(299, 301)`), then passed. `test_routes`
  `TestShareLinkPage` stubs `drive.node_url`, so it reads neither the site's
  `suite_flip_files` nor a node row. With the flag forced on, the old version
  errored twice (`'NoneType' object has no attribute 'http_status_code'`).
- `test_architecture` lists `node_url` in the interface. `test_routes`,
  `test_shapes`, `test_shims`: fixture strings and comments say `/l/`.
- Red first: the mint/rotate case failed with
  `'/drive/l/GmAN...' != '/l/GmAN...'`; `test_drive_link` failed with
  `module 'suite.drive' has no attribute 'node_url'`, then with 404 for `/l/`;
  the lockout cases failed with `401 != 429` and `5 != 4`.

### Commands and results

All with `env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree>`,
under `flock /tmp/suite-uf-site.lock`, on `slides.localhost`.

| Command | Result |
|---|---|
| `run-tests --module suite.drive.tests.test_grants` | 32, OK |
| `run-tests --module suite.drive.tests.test_principals` | 10, OK |
| `run-tests --module suite.drive.http.tests.test_dispatch` | 170, OK |
| `run-tests --module suite.drive.http.tests.test_routes` | 102, OK |
| `run-tests --module suite.drive.http.tests.test_translator` | 32, OK |
| `run-tests --module suite.drive.http.tests.test_shapes` | 46, OK |
| `run-tests --module suite.drive.http.tests.test_shims` | 267, OK |
| `run-tests --module suite.drive.http.tests.test_drive_link` | 7, OK |
| `run-tests --module suite.tests.test_architecture` | 7, OK |
| `yarn test:unified` | 32 files, 105 tests passed |
| `yarn test:legacy` | matched the failure manifest (0 expected failures) |
| `yarn check:import-boundaries` | passed |
| `yarn typecheck` | 0 errors in scope |
| `yarn check:bundle-budget` | 148.12 KiB of 200 KiB (the first run hit the tool timeout; the rerun passed) |
| `uvx ruff@0.12.3 check` / `format --check` on changed files | two findings, both present on the base: B007 at `shims.py:2684`, format of `test_shims.py` |

The verification line names `suite.drive.http.tests.test_http`. No such
module exists; `test_dispatch` (whole requests) and `test_routes` (handlers)
are the HTTP modules, and both ran.

### Live HTTP check

Two `bench serve --noreload` processes on the worktree: port 8031 with the
site config as is (key off), port 8032 with `get_site_config` wrapped to set
the key. Fixtures from a scratch module in `/tmp`, dropped afterwards.

| Request | Key off (8031) | Key on (8032) |
|---|---|---|
| `GET /l/<folder token>` | 302 `/drive/g/<folder>#link=<token>` | 302 `/drive/f/<folder>#link=<token>` |
| `GET /l/<file token>` | 302 `/drive/g/<file>#link=<token>` | 302 `/d/<file>#link=<token>` |
| `GET /drive/l/<file token>` | 302 `/drive/g/<file>#link=<token>` | 302 `/d/<file>#link=<token>` |
| `GET /l/<expired token>` | 410, "Link unavailable" page | 410, same |
| `GET /l/aaaaaaaaaaaaaaaaaaaaaa` | 404, "Link unavailable" page | 404, same |

`POST /api/suite/drive/links/<token>/unlock` on 8031 with a wrong password:
attempts 1 to 4 answered 401 `DriveLocked`; attempt 5 answered 429
`RateLimitExceededError` with `Retry-After: 900`; attempt 6 the same; the
right password 3 seconds later answered 429 with `Retry-After: 897`. Both
servers were stopped by pid and the lockout key deleted.

### Not done

- The other `node_url` callers (notifications, shims `/drive/w` and
  `/drive/g`, Writer wikilink, Meet email, WebDAV HTML) belong to unified
  plan stage 12.
- `frontend/src/composition/routes.ts` still declares an SPA `/l/:token`
  placeholder; unified spec §10.1 says the SPA has no `/l/` route. A full
  page load reaches the server rule. That file belongs to stage 8.
- Unified spec §15.1 still lists D17, D24, and D25 as "filed". The
  orchestrator owns that table.
