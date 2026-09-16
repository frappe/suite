# 04 — Serve authorized blobs with signed URLs and byte ranges

**What to build:** Allow Drive downloads and WebDAV reads without a framework File row.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** done

**Owner:** Codex (`/root`), Frappe storage

**Starting revisions:** Suite `6c15e8057e2d35561044ee33d7ee05b147dba5b1`;
Frappe implementation worktree `89c2aec20e15815def20b74931f5c72d6adb1de0`.

**Claimed files:** Frappe `frappe/storage/url.py`,
`frappe/storage/driver.py`, `frappe/storage/s3_driver.py`,
`frappe/storage/serve.py`, `frappe/storage/tests/test_signing.py`,
`frappe/storage/tests/test_drivers.py`,
`frappe/storage/tests/test_s3_driver.py`, and
`frappe/storage/tests/test_serve_upload.py`; this ticket in Suite.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.3, §13.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Provide signed_url_for_blob with filename-bound signatures and native driver URL support.
- [x] Keep signed_url(File) behavior through delegation. Reject expired signatures and changed filenames.
- [x] Provide stream_blob for already-authorized callers. Keep serve_file authorization at its existing boundary.
- [x] Support local and non-local Range responses, including open-ended ranges, 206, 416, and conditional 304.
- [x] Use native S3 Range requests and retain a working default for other drivers.
- [x] Streaming adds no Drive permission query or File access-log row. Preserve opt-in DAV native redirects.

## Verification

Run signing, serving, and driver tests. Assert response bytes and headers with local, memory, and S3 driver substitutes.

## Completion evidence

Completed 2026-09-05. The isolated implementation commit
`ae63c83c0fc8231533458d0a0c56be5f3425fe7d` was prepared against Frappe
`89c2aec20e15815def20b74931f5c72d6adb1de0`, then integrated after ticket 03
on `forge/storage-v2` as `ff254328fac9c100ff98fbb0f6166bac78139cdd`.

- `signed_url_for_blob()` accepts a File Blob name or document, prefers the
  driver's native URL, and otherwise signs the blob name, caller-selected
  filename, and expiry into the existing `/f/` route. `signed_url(File)` now
  delegates to it without changing File-row behavior.
- `stream_blob()` serves a caller-authorized blob without invoking File
  permission lookup or creating a File access-log row. `serve_file()` retains
  both operations at its existing boundary before delegating byte delivery.
- Local paths continue through conditional Werkzeug `send_file`. Non-local
  drivers now return bounded or open-ended ranges with correct 206,
  `Content-Range`, `Content-Length`, and `Accept-Ranges` headers; invalid or
  unsatisfiable ranges return 416, and matching checksum ETags return 304
  without reading bytes.
- `StorageDriver.read_range()` provides a read-and-slice fallback for existing
  drivers. `S3Driver.read_range()` delegates bounded and open-ended byte ranges
  to `get_object(Range=...)` and retains missing-key translation.
- The `/f/` route retains native-driver redirects. Direct authorized streaming
  uses them only when `drive_webdav_s3_redirect` is enabled, preserving DAV
  compatibility by default.
- Ticket 04's only overlap with ticket 03 was the shared serve/upload test
  module. The integration auto-merged cleanly and retained ticket 03's trusted
  upload and concurrency coverage alongside all six new egress cases.

Verification:

- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_signing` — 9 tests passed, zero failures or errors.
- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_drivers` — 29 tests passed, zero failures or errors.
- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_s3_driver` — 23 tests passed, zero failures or
  errors.
- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_serve_upload` — 43 tests passed, zero failures or
  errors in the isolated implementation run.
- Independent review passed `git diff --check`, Python compilation of all
  eight changed files, range-parser edge probes, and three-way patch checks
  against ticket 03. After integration, `git show --check` and the same Python
  compilation passed. No post-integration site rerun was needed because the
  reviewed implementation was unchanged and Git retained both test sets in a
  clean three-way merge.

Unresolved gates: none for this ticket.
