# 03 — Finish trusted upload sessions without creating a File

**What to build:** Let an authorized internal caller upload a blob while public upload endpoints retain their checks.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** ready-for-agent

**Owner:** Frappe storage

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §13.2, §13.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Provide internal create_blob_upload, upload_blob_chunk, and finish_upload_to_blob through shared session machinery.
- [ ] Make File-versus-blob policy server-owned and immutable. Keep internal functions outside the HTTP whitelist.
- [ ] Public create, chunk, and finish retain permission and MIME checks. Public chunk and finish reject blob-only sessions.
- [ ] Preserve ownership checks, cumulative size limits, content validation, checksums, atomic finish claims, and temporary cleanup.
- [ ] Cover chunked and direct uploads, partial sessions, checksum failure, replay, and concurrent finish.
- [ ] Keep the existing public finish behavior, including File creation. No caller can pass waiver arguments.

## Verification

Run upload/storage tests. Assert no File row for trusted finishes, one winning concurrent finish, and rejected public bypass attempts.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
