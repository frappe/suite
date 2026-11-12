# 06 — Implement resumable blob relocation

**What to build:** Provide a framework operation that moves storage locations without changing blob identity.

**Blocked by:** [02 — Keep every referenced blob alive during garbage collection](02-blob-reference-gc.md)

**Status:** done

**Owner:** Codex (`/root`), Frappe storage

**Starting revisions:** Suite `580935039c28f697cfd1497d422c4b0cdf0e0b53`;
Frappe implementation worktree `e329863a23c4a1f056533099610ea195c5af0ad3`.

**Claimed files:** Frappe `frappe/storage/relocate.py` and
`frappe/storage/tests/test_relocate.py`; this ticket in Suite.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §13.6, §14.11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Copy bytes to the configured driver and canonical key. Handle local in-place keys on the same driver too.
- [x] Lock the blob against GC before changing its driver and key. Delete source bytes only after commit.
- [x] Commit in bounded batches and resume after interruption. Skip blobs already at the canonical target.
- [x] Handle an existing target object without duplicate identity. Log per-blob errors and continue.
- [x] Return moved, bytes, skipped, and errors. Keep Drive-specific knowledge out of the operation.
- [x] Implement and test the operation only. Actual dataset relocation belongs to the separate execution ticket.

## Verification

Run relocation tests with temporary driver fixtures, interrupted batches, deduplication, failures, and concurrent GC.

## Completion evidence

Completed 2026-09-05. The isolated implementation commit
`866a4c59a9640e69f4b7e39b2fa41b02de6683f4` was prepared against Frappe
`e329863a23c4a1f056533099610ea195c5af0ad3`, then integrated after ticket 04
on `forge/storage-v2` as `792fefa07cbb98f5f9f27184ff034d5aae3facb2`.

- `frappe.storage.relocate.relocate_blobs()` scans `File Blob` rows in
  keyset-paginated batches of 100 by default and copies each object to the
  configured or named driver under `make_key(checksum)`. It also canonicalizes
  legacy `../` keys when source and target are both local.
- Each copied blob row is locked with `for_update`, rechecked against the
  selected source location, and updated without changing its name. A successful
  batch commits before its callbacks remove source bytes; callbacks retain a
  source object while any blob row still owns that location.
- Canonical target objects are reused, already-canonical rows are skipped, and
  per-row savepoints isolate failures. A failed commit rolls back the batch;
  copied canonical objects remain harmless and reusable on a later run.
- The result reports `moved`, `bytes`, `skipped`, and `errors`. Copy, commit,
  and post-commit cleanup errors are logged without stopping later blobs. The
  merge review extended the cleanup guard so even a failed post-commit database
  ownership check cannot escape and misreport an already-committed batch.
- Tests use isolated memory-driver objects and scoped blob rows. They cover
  configured-driver and same-driver relocation, bounded interruption/resume,
  canonical skips, existing target reuse, per-blob copy failure, guarded
  post-commit cleanup failure, interleaved GC, and invalid batch sizes.

Verification:

- `env PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/frappe-drive-06
  /home/faris/.local/bin/bench --site slides.localhost run-tests --module
  frappe.storage.tests.test_relocate` — 9 integration tests passed in 0.127 s,
  zero failures or errors.
- `git diff --cached --check` in the isolated worktree and `git show --check`
  after integration — passed.
- `/home/faris/benches/suite-bench/env/bin/python -m compileall -q
  frappe/storage/relocate.py frappe/storage/tests/test_relocate.py` — passed
  before and after integration; independent AST parsing passed.

Unresolved gates: no implementation gate remains. Actual dataset relocation
and source deletion remain blocked behind the authorization and prerequisites
of ticket 37; this ticket performed no production relocation.
