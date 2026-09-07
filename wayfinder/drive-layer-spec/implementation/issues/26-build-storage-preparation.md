# 26 — Prepare legacy bytes for an additive Build

**What to build:** Make legacy Drive bytes available as blobs before any tree conversion.

**Blocked by:** [25 — Write and lock files over the same Drive workflows](25-webdav-write.md)

**Status:** ready-for-agent

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.1–14.2 steps 1–3.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement the storage-enabled and S3-configuration gates before mutation.
- [ ] Run idempotent framework local backfill. Preserve framework attachments outside reachable Drive trees.
- [ ] For legacy S3 URLs, hash once, copy through the specified canonical layout, and link File.blob.
- [ ] Use managed multipart copy above 5 GB. Resume from linked blobs without copying complete objects again.
- [ ] Record missing-byte and S3-copy results for the final report. Preserve original local bytes and legacy S3 objects.
- [ ] Keep Build registration gated on the later integration ticket so an ordinary migrate cannot run a partial patch.

## Verification

Run fixture-backed migration tests for disabled storage, invalid S3 configuration, missing files, interrupted copy, and multipart selection.

## Completion evidence

Every acceptance box is built and covered by tests that run without a site.
None is ticked: the site gate has not run. The root orchestrator owns that
run; the commands are at the end of this section.

Agents audited the framework storage API and the legacy Drive S3 paths, then
reviewed the finished code twice, once against the spec and once against the
test design. The orchestrator wrote the production change, made the calls the
reviews raised, and made the commits.

### Revisions

Base Suite `0aaa3ecda`, the commit that closed ticket 25, on
`implement/drive-26-build-storage-preparation`. Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` on `forge/storage-v2`, read only
and unchanged. No Frappe core file is touched.

| Commit | Subject |
|---|---|
| `e3caff8a1` | make legacy Drive bytes reachable as blobs |
| `3317a556c` | pin Build's storage step without a site |
| `8a670d391` | run the Build storage step against the File table |
| `c3e55b97b` | close the defects two reviews found in Build's storage step |

### What was built

A new package `suite/drive/patches/build/`, not the plan's single
`patches/build.py`. The import path is the same, so ticket 30 still registers
`suite.drive.patches.build`; tickets 27 to 29 add ten more steps and one file
would not hold them. Modules:

| Module | Holds |
|---|---|
| `gate.py` | the refusals Build makes before it mutates (§14.1) |
| `layout.py` | `private/<ab>/<cd>/<sha256>[.ext]` and the 5 GB threshold |
| `s3_copy.py` | §14.2 step 3, resumable, committed per batch |
| `legacy_bytes.py` | steps 1 to 3 as one call, with the durable record |
| `state.py` | `<site>/private/drive-build-state.json` |
| `ports.py` | the three seams, and the only code that reaches frappe or boto3 |
| `environment.py` | the wiring, real for a site and fake for a test |

`StorageGateway`, `LegacyFiles`, and `S3Bucket` are the seams. Nothing else
in the package imports `frappe.db`, `frappe.conf`, or boto3, so every rule
runs against `tests/fakes.py` with no site, no bucket, and no database.

### Acceptance criteria

| Criterion | Where | Proof |
|---|---|---|
| Storage-enabled and S3 gates before mutation | `gate.py:26-71` | `test_gate` (10): storage off, an S3 Drive on a local driver, a driver with no bucket, an unnamed legacy bucket, two buckets, one name at two endpoints, and that a refused gate calls no backfill, commits nothing, and writes no record |
| Idempotent framework local backfill | `legacy_bytes.py:32` | calls `frappe.storage.backfill.run()` unfiltered at the framework's own page size. `test_legacy_bytes.TestIdempotence`; on a site, `test_build_storage.test_a_second_run_links_nothing_new` |
| Attachments outside reachable Drive trees preserved | `ports.py:154`, framework `backfill.py:126-146` | the backfill links in place and never rewrites `file_url`. `test_the_legacy_s3_object_and_url_survive_the_copy`, `test_a_framework_attachment_outside_drive_is_left_alone`, and on a site `test_local_bytes_are_linked_in_place_and_left_untouched` |
| Hash once | `s3_copy.py:_read_once` | one `get_object` per row, and `FakeBucket` hands back a single-use forward-only stream, so a second pass cannot pass the test. `test_the_object_is_read_exactly_once`, `test_the_body_is_never_rewound` |
| Canonical-layout copy | `layout.py` | `test_layout` (7) pins the key against `frappe.storage.blob.make_key`, `sanitized_extension`, and `S3Driver.object_key`, not against a literal |
| `File.blob` linked | `ports.py:154` | one column, no doc events, no `modified` bump. `test_ports.test_linking_writes_the_blob_column_and_nothing_else` |
| Managed multipart copy above 5 GB | `s3_copy.copy_in_bucket` | `TestCopyChoice` at the boundary on declared sizes, and `TestMultipartWiring` through the whole copy path with the threshold lowered |
| Resume without recopying complete objects | `s3_copy.py:_copy_one` | three layers: a linked row leaves the query, a matching blob row skips the copy, a complete object at the destination skips it. `TestResume` (4) and `TestInterruptedRunResumes` (3) |
| Durable missing-byte and S3-copy results | `state.py` | `TestMissingBytes` (6) and `TestDurableRecord` (5), including a record kept aside rather than overwritten |
| Original local bytes and legacy S3 objects preserved | — | nothing in the package deletes, moves, or truncates. The `S3Bucket` seam has no delete, and `test_ports.test_it_never_writes_or_deletes_through_the_client` proves `BotoBucket` issues no write or delete against the client |
| Build registration gated on ticket 30 | — | `test_dormancy` (7): `patches.txt`, `hooks.py`, and the fixtures name no `patches.build`; the package exports no `execute`; it ships no JSON; and parsing every module shows nothing runs at import time |

### Two refusals beyond the spec's table

§14.1 lists two checks. The gate makes four more, all in the S3 branch, all
read-only, all before any mutation. §14.2 step 3 says the copy is server-side
"in the same bucket"; a server-side copy needs both keys reachable from one
client, and nothing else in the step can check that. Without them a
mismatched site does not fail. It succeeds, copies nothing, and reports every
Drive file as a file with no bytes.

- `Drive Disk Settings.bucket` must be set.
- It must equal `storage_driver_config["bucket"]`.
- The two endpoints must match, ignoring a trailing slash. One bucket name
  can exist at both MinIO and AWS.

### Commands and real results

All site-free, in the worktree. No `bench`, `migrate`, `install`, `restart`,
or `push` was run. `slides.localhost`, its queues, and its configuration were
not touched.

```
$ python3 -m compileall -q suite/drive/patches/build
COMPILED

$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_storage.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_storage.py
17 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python <runner> \
    suite.drive.patches.build.tests.{test_gate,test_layout,test_s3_copy,\
    test_legacy_bytes,test_ports,test_dormancy} suite.tests.test_architecture
Ran 92 tests in 1.291s
OK
```

`<runner>` is `frappe.init(site="slides.localhost")` with no `connect`, then
`unittest`. Per module: `test_gate` 10, `test_layout` 7, `test_s3_copy` 24,
`test_legacy_bytes` 19, `test_ports` 18, `test_dormancy` 7, and
`suite.tests.test_architecture` 7.

`suite/drive/tests/test_build_storage.py` collects 9 cases and was **not
run**: it is an `IntegrationTestCase` and needs the site.

### Mutation check

Ten mutations of the production modules were applied to a copy under `/tmp`
and the site-free suite run against each. All ten fail; each was a survivor
before the review fixes.

| Mutation | Caught by |
|---|---|
| the copy loop's cursor never advances | `test_rows_that_can_never_be_linked_do_not_stall_the_cursor` |
| the copy is always told size 0 | `TestMultipartWiring` |
| `size = len(chunk)` instead of `+=` | the copy verification, 20 cases |
| the sniff head is the last chunk | `test_the_head_is_the_first_bytes_and_the_size_is_all_of_them` |
| `SiteFiles.commit` does nothing | `test_a_batch_commits_only_outside_a_test_run` |
| missing bytes are not narrowed to local rows | `test_rows_that_never_named_local_bytes_are_not_missing_bytes` |
| the state write is not atomic | `test_the_write_leaves_no_half_written_file_behind` |
| `claim_blob` drops the `status` filter | `test_a_blob_still_uploading_is_not_claimed` |
| the state loader drops its shape guard | `test_an_unreadable_record_is_kept_aside_not_overwritten` |
| `begin_run` keeps every field | `test_bytes_that_came_back_stop_being_reported` |

### Defects the reviews found and fixed

1. **`missing_bytes` listed every blobless `File` row on the site.** §14.1
   scopes it to a local row whose bytes are missing. A Link node carries an
   external URL in `file_url` (§14.4) and never had bytes; so does every
   remote row. On a site with a few thousand documents the report would have
   been wrong by orders of magnitude, and the list is held whole in memory
   and written to one JSON file. It now comes from the backfill's own skipped
   list narrowed to `/files/` and `/private/files/`, plus the S3 step's own
   misses.
2. **`claim_blob` did not filter on `status`.** A `Pending` blob is an upload
   in flight. Linking a `File` to one and skipping the copy would leave the
   row pointing at nothing after Cleanup deletes Drive's legacy prefix.
3. **The gate compared bucket names but not endpoints,** and skipped the
   comparison when `Drive Disk Settings.bucket` was empty. See above.
4. **The copy loop could not end if the cursor stopped moving.** Two
   identical pages now raise.
5. **An unreadable state file was silently replaced.** The cumulative copy
   totals live only there, so a truncated file would have made the report say
   zero for a migration that copied everything. It is moved aside instead.
6. **The site-backed test deleted `File Blob` rows selected by checksum with
   `force=1`,** which on a shared site could match a row it did not create.
   It names the blob through its own `File` row now.

### Known risks, none of them resolved here

- **`Removed` rows are copied.** §14.2 step 3 says "each Drive `File` row
  whose `file_url` is a … URL and which has no blob", with no status
  qualifier, while §14.4 says Removed rows are not migrated. A site with a
  large trash pays to copy bytes no node will reference until Cleanup. Adding
  `status != "Removed"` is not safe here: `status` is a Drive custom field
  and the comparison drops every row where it is NULL. Ticket 27 owns the
  Removed rule and should settle it.
- **A bare bucket key in `file_url` is out of scope.** §14.2 step 3 names
  fetch URLs. On an S3 site a row can also carry a bare key
  (`suite/drive/utils/files.py:51-54`, `suite/meet/recording/ingest.py:223`).
  Such a row gets no blob and is not listed as a missing byte either, because
  the backfill never looked at it. Ticket 27 will meet it as a file node with
  no blob.
- **The copy is verified by size, not by content.** This matches
  `remove_teams._copy`. If the legacy object were replaced between the hash
  and the copy with different bytes of the same length, a Ready blob would
  claim a checksum its object does not have. `bench migrate` runs with the
  site in maintenance mode, which closes the window. Passing
  `CopySourceIfMatch` with the source ETag would close it fully and needs the
  `S3Bucket` seam to carry an ETag.
- **A rolled-back batch orphans an object at the canonical key.**
  `frappe.storage.blob.put_blob` deletes its bytes on rollback because GC can
  only see `File Blob` rows. This step deliberately does not: the seam has no
  delete, and the next run reclaims the object through the
  destination-complete check. Cleanup's bucket sweep is where such an object
  goes.
- **The copy totals can under-report by one batch.** The database commits
  first, then the record is written. A kill between the two loses that
  batch's counts, never a copy that did not commit. The reverse order would
  over-report.
- **Frappe Cloud must allowlist `storage_driver` and `storage_driver_config`**
  before `suite.frappe.io` migrates. Outside this spec (§14.1).

### What the site gate must run

Nothing here has run against a database. On `slides.localhost`, serially:

```
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.tests.test_build_storage

env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_s3_copy
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_legacy_bytes
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_ports
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_gate
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_layout
env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_dormancy

env -C /home/faris/benches/suite-bench PYTHONPATH=<worktree> \
  bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

`bench run-tests` exits 1 on this bench even when every test passes; read the
`OK` or `FAILED` line, not the exit code. Read a failure block with
`sed -e 's/\x1b\[[0-9;]*m//g'`.

`test_build_storage` writes real `File`, `File Blob`, and disk-file fixtures
under a per-run prefix, cleaned up in `tearDown` and `addCleanup`. It enqueues
no job: rows go in through `db_insert`, and `File Blob` has no doc events.
`IntegrationTestCase` rolls back once per class, and `frappe.flags.in_test`
keeps both the backfill and `SiteFiles.commit` from committing.

**A `bench migrate` proves nothing about this ticket and must not be used as
its gate.** The package is dormant by design: `patches.txt` does not name it
and it exports no `execute`, so `migrate` will not reach a line of it. That
is the point of the last acceptance box. Registration is ticket 30's.
