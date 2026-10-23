# 03 — Finish trusted upload sessions without creating a File

**What to build:** Let an authorized internal caller upload a blob while public upload endpoints retain their checks.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** done

**Owner:** Codex (`/root`), Frappe storage

**Starting revisions:** Suite `f7e373e392cd7d71afe37f4fafe153ac2a2d55b6`;
Frappe implementation worktree `89c2aec20e15815def20b74931f5c72d6adb1de0`.

**Claimed files:** Frappe `frappe/storage/upload.py` and
`frappe/storage/tests/test_serve_upload.py`; this ticket in Suite.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.2, §13.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Provide internal create_blob_upload, upload_blob_chunk, and finish_upload_to_blob through shared session machinery.
- [x] Make File-versus-blob policy server-owned and immutable. Keep internal functions outside the HTTP whitelist.
- [x] Public create, chunk, and finish retain permission and MIME checks. Public chunk and finish reject blob-only sessions.
- [x] Preserve ownership checks, cumulative size limits, content validation, checksums, atomic finish claims, and temporary cleanup.
- [x] Cover chunked and direct uploads, partial sessions, checksum failure, replay, and concurrent finish.
- [x] Keep the existing public finish behavior, including File creation. No caller can pass waiver arguments.

## Verification

Run upload/storage tests. Assert no File row for trusted finishes, one winning concurrent finish, and rejected public bypass attempts.

## Completion evidence

Completed 2026-09-05. The isolated implementation commit
`0e18b027b06939025574a13e13176c1e97056b96` was prepared against Frappe
`89c2aec20e15815def20b74931f5c72d6adb1de0`, then integrated after ticket 02
on `forge/storage-v2` as `0cdd27c77168a23892826c18dd5df75a3c178eba`.

- `create_blob_upload()`, `upload_blob_chunk()`, and
  `finish_upload_to_blob()` are ordinary Python interfaces over the same
  create, chunk-write, claim, validation, and cleanup machinery used by the
  public File upload endpoints. Trusted finish returns a `File Blob` without
  creating a `File` row.
- Session metadata now carries an immutable server-selected `file` or `blob`
  policy. Older in-flight sessions default to `file`. Public chunk and finish
  reject blob-only sessions, while trusted chunk and finish reject File
  sessions; none of the trusted functions is HTTP-whitelisted.
- Public create, per-chunk permission rechecks, finish permission checks, and
  filename MIME restrictions remain in their public wrappers. Their signatures
  expose no policy or check-waiver arguments, and public finish still creates a
  `File` through `create_file_from_blob()`.
- The shared finalizer retains owner binding, declared and cumulative size
  limits, checksum and content validation, the atomic filesystem claim, and
  cleanup of chunked or driver-native temporary upload data. Empty sessions
  fail before the claim and remain retryable.
- Tests cover chunked and direct trusted finishes without File rows, partial
  and empty sessions, oversize and checksum failures, content validation,
  ownership, policy-crossing refusals, public bypass attempts, replay, and a
  simultaneous two-way claim with one winner.

Verification:

- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_serve_upload` — 51 tests passed, zero failures or
  errors in the serialized implementation run.
- `git diff --check` and `git show --check` in the implementation worktree and
  integrated Frappe checkout — passed.
- `/home/faris/benches/suite-bench/env/bin/python -m compileall -q
  frappe/storage/upload.py frappe/storage/tests/test_serve_upload.py` — passed
  before and after integration; independent AST parsing passed.

Unresolved gates: none for this ticket.
