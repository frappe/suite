# 10 — Upload and replace files under Drive authority and quota

**What to build:** Upload private files through Drive grants, charge the destination root, and preserve replaced bytes.

**Blocked by:** [09 — Browse permission-filtered trees and measure indexes](09-listings-and-index-measurement.md)

**Status:** done

**Owner:** Suite Drive node workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §7.1–7.4, §8.2–8.5, §13.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Bind upload ids to authorized destinations server-side. Reauthorize create, every chunk, and finish.
- [x] Guest identity alone cannot claim another visitor’s session. Refuse forged destinations, revoked access, and replayed finishes.
- [x] Support trusted chunked and direct storage paths. Stream chunk bodies and keep framework validation intact.
- [x] Preflight declared bytes, then admit actual bytes with one conditional root counter update in the write transaction.
- [x] Replace keeps a nonempty old head as one auto version. Charge it exactly once; a zero-byte head creates no version.
- [x] Enforce create-versus-replace arguments, content time, creator grant exceptions for links, and activity attribution.
- [x] On failure, roll back node, counter, grant, and activity changes. Unreferenced blobs remain eligible for framework GC.

## Verification

Run upload and quota tests, including website ZIP uploads, Guest links, size races, direct cleanup, replacement accounting, and concurrent finish.

## Completion evidence

Completed 2026-09-06 from ticket 09 revision
`16cfd0187672ab60d1176853683dc2b0bc6f0f56`.

Suite implementation revision: `13e0d61bac108f13603c0743315150534615bb77`
(isolated branch and fast-forward integration onto `forge/drive-layer`). The adjacent
Frappe streaming change was developed at
`9f17f3ff416205ec127e05b19b24aa7232071bb0` and integrated as
`158a173a1c8fb0083f2b352250f8ac4bba1781ba`.

Changed behavior:

- Upload sessions are bound server-side to the exact actor, original parent, and
  deciding link. Create finishes in that parent; replace additionally requires the
  target to still be in that parent and pass a fresh full-principals `EDIT` check.
- Create, chunk, and finish reauthorize. Guest/link attribution and creator-grant
  exceptions are preserved, while revoked, expired, forged, and replayed requests
  are refused.
- Direct and chunked uploads adopt only trusted private Ready File Blobs without
  creating a File row or invoking File hooks. PUT request streaming is limited to
  the registered Drive prefix while normal framework request parsing and caps remain
  intact for other methods and paths.
- Declared bytes are preflighted; actual bytes are admitted with one conditional
  root-counter update. Replacement preserves each nonempty old head once, charges
  the new head even when its blob is reused, and skips versions for empty heads.
- Node, grant, activity, version, and root-counter changes share one transaction.
  Failure rolls them back, leaving unreferenced blobs available for framework GC.

Migration effects: `bench --site slides.localhost migrate` completed successfully.
The additive schema change created Drive Node Version with its node/sequence and
thinning indexes, added its blob lookup index, and added nonnegative personal/shared
quota settings. Existing Drive data and legacy fields were preserved; no destructive
patch was introduced.

Suite verification used:

```text
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost migrate
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_quota
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_upload
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_access
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.drive.tests.test_roots
cd /home/faris/benches/suite-bench && PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-10:/home/faris/benches/suite-bench/apps/frappe bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

Results: quota 8/8, upload 34/34, access 12/12, roots 26/26, and
architecture 5/5 (85/85 total). The concurrency suite's exact committed-fixture
cleanup assertions passed with no root or node residue. `git diff --check`, Ruff
check and format check over the nine changed Drive Python files, and Python compile
checks over the changed modules also passed.

Frappe verification used its isolated worktree on `PYTHONPATH`:

```text
bench --site slides.localhost run-tests --module frappe.tests.test_streaming_request_paths
```

Result: 5/5.

Deferred by the frozen plan: node lifecycle is ticket 11; version history/thinning
is ticket 12; preview enqueue/lifecycle is ticket 13; reservations, Meet policy,
root administration, and daily quota recompute are ticket 15; HTTP delivery is
ticket 21; and DAV is ticket 25. No push, PR, install, restart, or post-verification
remigration was performed.
