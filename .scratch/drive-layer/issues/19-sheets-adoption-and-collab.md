# 19 — Move Sheets lifecycle and collaboration checks into Drive

**What to build:** Use Drive permissions for Sheets documents, operation records, and live collaboration.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** ready-for-agent

**Owner:** Suite Sheets

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §6.7, §10.7 Sheet; §14.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Declare Sheet, Sheet Op Log, and Sheet Collab State through the content contract.
- [ ] Implement create, copy, xlsx import, version bytes, restore, purge, and media discovery.
- [ ] Replace separate share/trash enforcement and retain migration source snapshots and fields until Cleanup.
- [ ] Keep default_export=None. Sheet bodies remain free; version blobs and media remain charged.
- [ ] Update both Frappe access checks and the repository-owned collaboration server to carry relevant link credentials.
- [ ] Reject more than 20 supplied credentials. EDIT permits writing; READ/COMMENT permits read-only; below READ refuses.
- [ ] Recheck each live connection every five minutes. Disconnect revoked or expired access, and enforce downgrades.
- [ ] Use server-controlled Guest identity. Do not restart collaboration services as part of implementation.

## Verification

Run Sheets and collaboration-server tests with fake time, revocation, expiry, downgrade, Guest tokens, Satellite queries, and version restoration.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
