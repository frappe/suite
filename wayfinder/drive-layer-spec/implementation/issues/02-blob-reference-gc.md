# 02 — Keep every referenced blob alive during garbage collection

**What to build:** Allow Drive and other apps to retain blobs through ordinary File Blob Link fields.

**Blocked by:** None — can start immediately after execution is authorized.

**Status:** done

**Owner:** Codex (`/root`), Frappe storage

**Starting revisions:** Suite `6c15e8057e2d35561044ee33d7ee05b147dba5b1`;
Frappe `89c2aec20e15815def20b74931f5c72d6adb1de0`.

**Claimed files:** Frappe `frappe/storage/gc.py` and
`frappe/storage/tests/test_gc_backfill.py`; this ticket in Suite.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.17, §13.1.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Discover standard, child-table, Custom Field, Property Setter, and Single references. Skip virtual doctypes.
- [x] Use the same discovered predicate for candidate selection and the recheck under the blob lock.
- [x] Include unindexed references and warn once per column per run.
- [x] If discovery or a referenced table fails, delete no blobs. Continue upload-session expiry.
- [x] Preserve the 24-hour orphan age and bounded candidate batches. Add no registration hook.

## Verification

Run storage GC/backfill tests. Prove non-File and Single references survive, and discovery failure yields zero deletions.

## Completion evidence

Completed 2026-09-05 against Suite
`6c15e8057e2d35561044ee33d7ee05b147dba5b1` and Frappe
`89c2aec20e15815def20b74931f5c72d6adb1de0`. The verified Frappe change is
committed as `e329863a23c4a1f056533099610ea195c5af0ad3`.

- `frappe.storage.gc.blob_reference_columns()` now normalizes and deduplicates
  the standard, child-table, Custom Field, Property Setter, and Single Link
  fields returned by framework meta discovery. Virtual doctypes remain excluded
  by that discovery path.
- `orphan_predicate()` emits a `NOT EXISTS` probe for every discovered column,
  including `tabSingles` probes. `collect_garbage()` builds it once and passes
  the identical predicate to candidate selection and each lock-time recheck.
- GC checks real single-column indexes and logs one warning for each
  unindexed reference. Missing metadata or reference tables fail closed before
  byte deletion, while upload-session expiry still runs.
- The existing 24-hour cutoff and default 500-row batch remain unchanged. No
  hook or registration surface was added.
- Failure evidence covers both metadata-discovery failure and a discovered
  missing table: each reports zero blob deletions, preserves the blob row and
  bytes, and continues upload-session expiry. Tests also prove that non-File
  and Single references preserve old blobs.

Verification:

- `git diff --check` in `apps/frappe` — passed.
- `/home/faris/benches/suite-bench/env/bin/python -m compileall -q
  frappe/storage/gc.py frappe/storage/tests/test_gc_backfill.py` — passed.
- Independent merge review repeated `git diff --check`, Python compilation,
  and AST parsing before commit — passed. Ruff was not installed in the bench
  environment.
- `bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_gc_backfill` — 30 tests passed in 0.323 s, zero
  failures or errors (22 baseline tests plus eight ticket tests).

Unresolved gates: none for this ticket.
