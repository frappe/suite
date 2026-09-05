# 17 — Move Writer lifecycle and history into Drive

**What to build:** Create, edit, copy, version, and purge Writer documents through the Drive contract.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** ready-for-agent

**Owner:** Suite Writer

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §10.7 Writer; §14.6–14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Declare the Writer content adapter and immutable node link. Use package-root Drive workflows.
- [ ] Implement creation, duplicate, version bytes, restoration, purge, and used-node discovery.
- [ ] Keep explicit HTML export available. Set default_export=None so Writer stays hidden over DAV.
- [ ] Replace title/file synchronization, private history, and comment behavior with Drive ownership.
- [ ] Keep legacy columns and source rows until Build copies them and Cleanup permits deletion.
- [ ] Cover ordinary documents and templates. Keep WebRTC collaboration unchanged and authorize saves.

## Verification

Run Writer integration tests and the shared adapter contract, including inherited access, trash read-only behavior, HTML export, and copy/version round trips.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
