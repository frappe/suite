# 45 — Count every legacy `suite.drive.api.*` call by name and user agent

**What to build:** A counter on every one of the 69 legacy names in `shims.CLASSIFICATION`, keyed by method name and user agent, stored in a doctype that a System Manager reads in Desk, and also read by one bench command. It is the evidence the unified frontend hold (unified plan stage 14) and Cleanup gate 3 (§14.10) read.

**Asks:** D26 (unified frontend spec §15.1).

**Blocked by:** [23 — Keep legacy callers working through the new Drive workflows](23-legacy-compatibility.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP compatibility

**Execution gate:** Must ship in the Build release, so the counter runs on production for the whole hold. That release is the one `develop` release that carries Drive Build and unified plan stages 0 to 12; unified plan stage 7 lists this issue in its release gates [Faris, 2026-09-29]. Cleanup ([40](40-cleanup-deletes-every-legacy-name.md)) removes it with the names.

**Raised by:** unified frontend ticket [014 — Rollout, redirects and old-page deletion](../../../unified-frontend/tickets/014-rollout-redirects-and-old-page-deletion.md); the name set and the read schedule come from ticket [017 — Product methods and the zero-call gate](../../../unified-frontend/tickets/017-product-methods-and-the-zero-call-gate.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stages 12 (Drive flip plumbing) and 14 (Hold) wait on it.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.7 (the shim plan; no name is exempt), §14.10 gate 3. Unified frontend spec §14.8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Every name in `shims.CLASSIFICATION` is counted, whatever its class (forwarder, retained, retired, or the class `PERMANENT` still names) and however it is dispatched: `/api/method/suite.drive.api.*`, `/api/method/suite.drive.overrides.file.get_file_for_doc`, and the three `File` document methods reached through `run_doc_method`. A test proves the key set equals `CLASSIFICATION`'s.
- [x] The key is `(name, user_agent)`, with the user agent truncated to a fixed length. The stored record holds `count`, `first_seen`, `last_seen`. Storage is a doctype row, so it survives `bench migrate`, a deploy, and a cache flush. A site-private file or Redis does not qualify [Faris, 2026-09-29, orchestrator].
- [x] A System Manager reads the counter in Desk without bench shell: a read-only list of the doctype, sorted by `last_seen` descending, showing name, user agent, count, first seen and last seen. Only System Managers can read it; nobody can edit or delete a row by hand. The write is one upsert off the request's critical path, or a buffered increment flushed by a scheduler job, so a burst costs no request latency.
- [x] The bench command stays. `bench --site <site> drive-legacy-calls` prints every row sorted by `last_seen` descending: name, user agent, count, first seen, last seen, and a final line `total: <n> calls over <m> names`. `--json` prints the same as JSON. There is no reset flag; the hold compares two reads.
- [x] The Desk file picker (`suite/public/js/FileUploader.vue`) and a WebDAV client show up by their user agent, proved by a test that calls a counted name with a set `User-Agent`.
- [x] Cleanup (issue 40) drops the storage with the names. Record the drop step in that ticket's acceptance list.
- [x] Tests cover the doctype's permissions: a System Manager reads, any other user gets no access, and no role can write through Desk.
- [x] Documentation synced in the same change: Drive spec §11.7 (the counter, its doctype and the command), §14.10 gate 3 (the evidence it reads), and unified plan stage 14's evidence line if the command name differs.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shims` and a new `test_legacy_calls`, then run the bench command on `slides.localhost` after one legacy call and paste its output. Open the Desk list as a System Manager and record that it shows the same row. Record real output.

## Notes

- The hold reads the counter, in Desk or by the command, at the start, once a week, and at the end of a 14-day window (unified plan stage 14, T017 decision 6). Every suite site that Cleanup will run on must read zero, not only `frappemail.frappe.cloud` [Faris, 2026-09-29, orchestrator]. "Zero" means no count rose between two reads, so counts are cumulative and never reset.
- A hit from a browser user agent in the first days after flip 2 is a stale legacy tab; it retires itself on reload. The command output is what proves it did.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass.

**2026-09-30, branch `forge/drive-45-legacy-call-counter`, based on `forge/drive-layer` at `740cd8cca`.** Agents implemented it; the orchestrator records the commit.

Changed behavior:

- `suite/drive/http/legacy_calls.py` recognises a legacy name from the request path and `form_dict` (any API version, the `cmd` form, and the three `File` methods through `run_doc_method`, `/api/resource/File`, `/api/v2/document/File`). A request buffers the call in three Redis hashes in one pipelined round trip. `flush()` adds each tally to its `Drive Legacy Call` row and commits (hand-off revised by the review fixes below).
- Hooks: `before_request` runs `suite.drive.framework.count_legacy_call` first; `scheduler_events["all"]` runs `suite.drive.jobs.flush_legacy_calls`.
- `Drive Legacy Call` (module Drive): `legacy_name`, `user_agent` (255), `count`, `first_seen`, `last_seen`; one row per name and user agent (sha1 of the pair). Sorted by `last_seen` DESC. One permission row: System Manager, read only. `in_create` is set.
- `bench --site <site> drive-legacy-calls [--json]`: `suite/composition/commands.py`, handed to bench by `suite/commands.py`. It flushes first, then reads.

Verification (site `slides.localhost`, `PYTHONPATH` = the worktree, after `bench --site slides.localhost migrate --skip-fixtures`):

```text
run-tests --module suite.drive.http.tests.test_legacy_calls   Ran 9 tests   OK
run-tests --module suite.drive.http.tests.test_shims          Ran 267 tests OK
run-tests --module suite.drive.http.tests.test_dispatch       Ran 183 tests OK
run-tests --module suite.drive.http.tests.test_routes         Ran 104 tests OK
run-tests --module suite.drive.http.tests.test_translator     Ran 32 tests  OK
run-tests --module suite.drive.webdav.tests.test_dispatch     Ran 10 + 15   OK
run-tests --module suite.tests.test_scheduler_events          Ran 3 tests   OK
python -m unittest suite.tests.test_architecture              Ran 7 tests   OK
```

With `record()` short-circuited, `test_legacy_calls` fails 8 of 9 (the command-registration case is the one that stays green).

One legacy call through a worktree `bench serve` on port 8047, as Guest (answered 403, still counted):

```text
$ curl -A "drive45-verify Microsoft-WebDAV-MiniRedir/10.0.19045" .../api/method/suite.drive.api.files.get_root_folder
403
$ bench --site slides.localhost drive-legacy-calls
name	user agent	count	first seen	last seen
api.files.get_root_folder	drive45-verify Microsoft-WebDAV-MiniRedir/10.0.19045	1	2026-09-30 00:44:29.839322	2026-09-30 00:44:29.839322
total: 1 calls over 1 names
```

`--json` printed the same row under `rows` and `"total": {"calls": 1, "names": 1}`.

Desk, as Administrator on the same server: `/app/drive-legacy-call` answers 301 to `/desk/drive-legacy-call`, which answers 200. The list API (`frappe.desk.reportview.get`, `order_by=last_seen desc`) returned the same single row. `getdoctype` reported `sort_field last_seen DESC`, `in_create 1`, permissions `[System Manager: read 1, write 0, create 0, delete 0]`, and the five fields in the list view. A browser view followed in the review fixes below.

Not covered here: gate 3's code (`gate.py`) does not read the counter; issue 40 owns that. Unified plan stage 14 needs no edit: it names no command.

**2026-09-30, review fixes (Codex review: fix-needed).** The rule: the counter never shows a false zero. An overcount is tolerable; an undercount is not.

- Durable hand-off: a Redis script renames the buffer to in-flight keys atomically. The flush stores the rows, commits, and only then deletes the in-flight keys. The next flush stores a leftover in-flight batch first. The Redis-loss risk (eviction, full cache flush) is stated in spec §11.7.
- One Redis lock (300 s timeout) covers every flush. `rows()`, and so the command, flushes and reads under it.
- At most 50 user agents per name. Later ones count into one `(other)` row. Redis enforces the cap with a per-name set; the table enforces it again at flush.
- `/api/resource/File`, `/api/v2/document/File` and v2 `run_doc_method` count only GET, HEAD, POST and QUERY. OPTIONS never counts.
- The controller refuses insert, save and delete unless the flush flag is set, Administrator included. The Cleanup DocType drop (`frappe.delete_doc("DocType", ...)`) deletes no row one by one, so the refusal does not block it. Checked by reading `frappe/model/delete_doc.py`; the drop was not run.
- A failing error logger no longer fails the request.
- A path with no legacy marker returns before `shims` is imported.

`test_legacy_calls` now has 15 tests. Each fix was checked by breaking it on purpose: hand-off, lock, table cap, verbs, controller, logger guard and prefilter each turned at least one test red.

```text
run-tests test_legacy_calls             Ran 15 tests  OK
run-tests test_shims                    Ran 267 tests OK
run-tests test_dispatch                 Ran 183 tests OK
run-tests test_routes                   Ran 104 tests OK
run-tests test_scheduler_events         Ran 3 tests   OK
unittest suite.tests.test_architecture  Ran 7 tests   OK
```

One more call through a worktree `bench serve` (Guest, answered 417, still counted), then the command:

```text
name	user agent	count	first seen	last seen
api.list.files	drive45-verify-2 Microsoft-WebDAV-MiniRedir/10.0.19045	1	2026-09-30 01:09:18.914134	2026-09-30 01:09:18.914134
api.files.get_root_folder	drive45-verify Microsoft-WebDAV-MiniRedir/10.0.19045	1	2026-09-30 00:44:29.839322	2026-09-30 00:44:29.839322
total: 2 calls over 2 names
```

Desk, in headless Chrome 154 as `drive-legacy-sm@example.com` (System Manager, not Administrator): `/desk/drive-legacy-call` shows "Drive Legacy Call", 2 of 2 rows, with the columns Legacy Name, User Agent, Count, First Seen, Last Seen. The rows match the command output and are sorted by Last Seen, newest first. There is no Add button. Screenshot: `/tmp/drive45-desk-list-sm.png` (outside the repo).
