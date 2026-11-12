# 05 — Preserve File adoption hooks on storage v2 uploads

**What to build:** Keep non-Drive apps receiving the existing after_file_upload contract when a File is created through storage v2.

**Blocked by:** [03 — Finish trusted upload sessions without creating a File](03-trusted-blob-upload.md)

**Status:** done

**Owner:** Codex (`/root`), Frappe storage

**Starting revisions:** Suite `7f7a0b6d67d8e0c9d2e24150736511eae54389d4`;
Frappe implementation worktree `0cdd27c77168a23892826c18dd5df75a3c178eba`.

**Claimed files:** Frappe `frappe/core/doctype/file/file_v2.py` and
`frappe/storage/tests/test_serve_upload.py`; this ticket in Suite.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.4.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Run registered hooks with doc= before inserting the new File from a blob.
- [x] Persist hook mutations and propagate hook failures with transaction rollback.
- [x] Preserve the legacy upload_file path without double invocation.
- [x] Trusted blob-only completion creates no File and performs no File adoption hook.

## Verification

Run File upload regression tests for hook order, mutation, failure, and invocation count.

## Completion evidence

Completed 2026-09-05. The isolated implementation commit
`a3d34da96f28d21c80f6823f5aee63dad8886fe8` was prepared against Frappe
`0cdd27c77168a23892826c18dd5df75a3c178eba`, then integrated after ticket 06
on `forge/storage-v2` as `d7948050b321a7f28b546a461554e9b2d14a0a33`.

- `create_file_from_blob()` now applies every registered
  `after_file_upload` hook to the new File with the established `doc=` call
  contract. Each returned document is passed to the next hook, and insertion
  occurs only after the hook chain completes.
- Hook mutations are persisted by the subsequent File insert. A hook exception
  propagates before insertion, allowing the request transaction to roll back
  both hook-side database writes and the upload operation.
- The legacy `frappe.handler.upload_file` entry point retains its existing hook
  loop and calls the hook exactly once under storage v2; it does not pass
  through `create_file_from_blob()`.
- Trusted `finish_upload_to_blob()` still returns only a File Blob. It neither
  creates a File nor invokes File adoption hooks.
- The integration auto-merged the shared serve/upload test module and retained
  all ticket 03 trusted-upload/concurrency cases and ticket 04 egress cases
  alongside the four ticket 05 assertions.

Verification:

- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_serve_upload` — 54 tests passed, zero failures or
  errors. One pre-existing Frappe V17 deprecation warning was emitted.
- Independent review passed `git diff --check`, Python compilation, and AST
  parsing for both changed files. After integration, `git show --check`, Python
  compilation, and AST parsing passed again.
- The reviewed code did not change during integration, so the serialized site
  suite was not repeated. Test-name inspection after the clean three-way merge
  confirmed that tickets 03, 04, and 05 remain present together.

Unresolved gates: none for this ticket.
