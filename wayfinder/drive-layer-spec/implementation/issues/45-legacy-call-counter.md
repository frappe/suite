# 45 — Count every legacy `suite.drive.api.*` call by name and user agent

**What to build:** A counter on every one of the 69 legacy names in `shims.CLASSIFICATION`, keyed by method name and user agent, durable across deploys and cache flushes, read by one bench command. It is the evidence the unified frontend hold (unified plan stage 14) and Cleanup gate 3 (§14.10) read.

**Asks:** D26 (unified frontend spec §15.1).

**Blocked by:** [23 — Keep legacy callers working through the new Drive workflows](23-legacy-compatibility.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP compatibility

**Execution gate:** Must ship in the Build release, so the counter runs on production for the whole hold. Cleanup ([40](40-cleanup-deletes-every-legacy-name.md)) removes it with the names.

**Raised by:** unified frontend ticket [014 — Rollout, redirects and old-page deletion](../../../unified-frontend/tickets/014-rollout-redirects-and-old-page-deletion.md); the name set and the read schedule come from ticket [017 — Product methods and the zero-call gate](../../../unified-frontend/tickets/017-product-methods-and-the-zero-call-gate.md). Filed by ticket [019 — Branches, backend asks and the release path](../../../unified-frontend/tickets/019-branches-backend-asks-and-release-path.md). Unified plan stages 12 (Drive flip plumbing) and 14 (Hold) wait on it.

**Source:** [Drive spec](../../drive-layer-spec.md), §11.7 (the shim plan; no name is exempt), §14.10 gate 3. Unified frontend spec §14.8.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Every name in `shims.CLASSIFICATION` is counted, whatever its class (forwarder, retained, retired, or the class `PERMANENT` still names) and however it is dispatched: `/api/method/suite.drive.api.*`, `/api/method/suite.drive.overrides.file.get_file_for_doc`, and the three `File` document methods reached through `run_doc_method`. A test proves the key set equals `CLASSIFICATION`'s.
- [ ] The key is `(name, user_agent)`, with the user agent truncated to a fixed length. The stored record holds `count`, `first_seen`, `last_seen`. Storage survives `bench migrate`, a deploy, and a cache flush (a doctype row or a site-private file; Redis alone does not qualify). The write is one upsert off the request's critical path, or a buffered increment flushed by a scheduler job, so a burst costs no request latency.
- [ ] `bench --site <site> drive-legacy-calls` prints every row sorted by `last_seen` descending: name, user agent, count, first seen, last seen, and a final line `total: <n> calls over <m> names`. `--json` prints the same as JSON. There is no reset flag; the hold compares two reads.
- [ ] The Desk file picker (`suite/public/js/FileUploader.vue`) and a WebDAV client show up by their user agent, proved by a test that calls a counted name with a set `User-Agent`.
- [ ] Cleanup (issue 40) drops the storage with the names. Record the drop step in that ticket's acceptance list.
- [ ] Documentation synced in the same change: Drive spec §11.7 (the counter and the command), §14.10 gate 3 (the evidence it reads), and unified plan stage 14's evidence line if the command name differs.

## Verification

`bench --site slides.localhost run-tests --module suite.drive.http.tests.test_shims` and a new `test_legacy_calls`, then run the bench command on `slides.localhost` after one legacy call and paste its output. Record real output.

## Notes

- The hold reads the command at the start, once a week, and at the end of a 14-day window (unified plan stage 14, T017 decision 6). "Zero" means no count rose between two reads, so counts are cumulative and never reset.
- A hit from a browser user agent in the first days after flip 2 is a stale legacy tab; it retires itself on reload. The command output is what proves it did.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
