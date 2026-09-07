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

Five of the six acceptance criteria are built and covered by tests that run
without a site. The sixth, managed multipart copy above 5 GB, cannot pass on
this framework build: see **Blocked criterion** below. None is ticked: the
site gate has not run. The root orchestrator owns that run; the commands are
at the end of this section.

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
| Attachments outside reachable Drive trees preserved | `SiteFiles.link_blob`, framework `backfill.py:126-146` | the backfill links in place and never rewrites `file_url`. `test_the_legacy_s3_object_and_url_survive_the_copy`, `test_a_framework_attachment_outside_drive_is_left_alone`, and on a site `test_local_bytes_are_linked_in_place_and_left_untouched` |
| Hash once | `s3_copy.py:_read_once` | one `get_object` per row, and `FakeBucket` hands back a single-use forward-only stream, so a second pass cannot pass the test. `test_the_object_is_read_exactly_once`, `test_the_body_is_never_rewound` |
| Canonical-layout copy | `layout.py` | `test_layout` (7) pins the key against `frappe.storage.blob.make_key`, `sanitized_extension`, and `S3Driver.object_key`, not against a literal |
| `File.blob` linked | `SiteFiles.link_blob` | one column, no doc events, no `modified` bump. `test_ports.test_linking_writes_the_blob_column_and_nothing_else` |
| Managed multipart copy above 5 GB | `s3_copy.copy_in_bucket` | **Blocked.** The choice is right and pinned at the boundary by `TestCopyChoice` and `TestMultipartWiring`, but no object above 5 GB can reach a `File Blob` row. See **Blocked criterion** |
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
  the filter is possible: `status` can be selected and compared in Python,
  where `None` behaves. It is left out on the spec text, not on a SQL NULL
  argument, and nothing is lost either way: Cleanup deletes the row, the blob
  orphans, and GC reclaims it. Ticket 27 owns the Removed rule.
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
  destination-complete check. Nothing sweeps such an object: §14.10 deletes
  Drive's legacy prefix, not `private/<ab>/<cd>/`. The cost is stray bytes,
  bounded by the size of one interrupted batch.
- **A killed managed copy leaves multipart parts behind.** `client.copy`
  aborts its own upload on a Python exception, not on a SIGKILL. The bucket
  needs an `AbortIncompleteMultipartUpload` lifecycle rule, or the parts of
  an interrupted multi-GB copy are billed indefinitely.
- **The copy totals can under-report by one batch.** The database commits
  first, then the record is written. A kill between the two loses that
  batch's counts, never a copy that did not commit. The reverse order would
  over-report.
- **A transient read error stops the run.** `_read_once` does not retry, and
  botocore cannot resume a partly consumed body. A `ReadTimeoutError` on a
  multi-GB read discards the uncommitted batch and stops `migrate`. The rerun
  resumes correctly, so this costs time, not bytes.
- **Two Builds at once lose each other's totals.** The record is a
  read-modify-write with no lock. `migrate` is serial and runs in maintenance
  mode, so this needs someone to start a second run by hand.
- **The record is outside `bench backup`.** `OnlineBackup.backup_files` tars
  `public/files` and `private/files`. `<site>/private/drive-build-state.json`
  is in neither, so a restore loses the cumulative totals. The migration
  itself is unaffected: they are counts, not state the copy depends on.
- **Thumbnail sidecars are not copied.** `<key>.thumbnail` objects have no
  `File` row, so no query reaches them and §14.10 would delete them. Ticket
  13 owns previews; Cleanup must not sweep them before that is settled.
- **`StorageClass` is not preserved.** Neither `copy_object` nor the managed
  copy carries it, so an object in STANDARD_IA lands in STANDARD. Cost only.
- **Frappe Cloud must allowlist `storage_driver` and `storage_driver_config`**
  before `suite.frappe.io` migrates. Outside this spec (§14.1).

### Blocked criterion: multipart copy above 5 GB

`File Blob.file_size` is declared `Int` with no `length` in
`frappe/core/doctype/file_blob/file_blob.json`. `frappe.database.schema` only
promotes to `bigint` when `length > 11`, and the MariaDB type map builds
`Int` as `int(11)`. The ceiling is 2,147,483,647 bytes. `File.file_size`
carries `length: 20` and is a bigint, so the legacy table holds files the
blob table cannot describe.

Every object above 5 GB is therefore also above the blob column's ceiling.
Under strict `sql_mode` the insert raises and `migrate` dies after earlier
batches have committed. Without strict mode the value is clamped, and
`File Blob.file_size` then lies to the §14.2 step 12 `used_bytes` recompute,
to `frappe.storage.serve`'s ranged downloads, and to §13 relocation.

`_copy_one` now refuses above the ceiling and reports the row, so the failure
is visible and bounded. The criterion stays unticked. It needs one framework
change on `forge/storage-v2`, outside this ticket's scope:

```
"fieldname": "file_size", "fieldtype": "Int", "length": 20
```

Root should decide whether that change belongs to ticket 06 or to a new
framework ticket. Until it lands, a Drive holding any file above 2 GiB
migrates with those rows reported as missing bytes.

### Independent review

A separate session reviewed this ticket against the spec, the framework, and
the tests, trusting none of the evidence above. Five agents ran bounded
audits: spec compliance, Frappe storage wiring, S3 semantics and legacy URL
shapes, data preservation and resumability, and test effectiveness. The
reviewer confirmed each finding against the source before acting on it, wrote
the corrections and their tests, and made the commits. No Frappe file was
changed. Nothing ran against `slides.localhost`.

Nine defects were found and fixed. Four of them lose bytes silently.

Base `1ec96f8a6`, the last commit of the work above, on
`review/drive-26-build-storage-preparation`. Frappe unchanged, still
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` on `forge/storage-v2`.

| Commit | Subject |
|---|---|
| `2197e5368` | read the bucket before Build mutates the site |
| `416c855e0` | stop the copy step linking bytes that are not there |
| `8673bd56f` | record the legacy rows Build cannot reach |
| `5bc982e00` | keep the site gate off rows it did not create |

Each was verified against its own `git archive` snapshot, not the working
tree, so no commit in the chain is red.

| Severity | Defect | Fix |
|---|---|---|
| High | A claimed blob was linked without heading its object. `frappe.storage.gc` deletes a blob's bytes first and its row second, and keeps the row when the delete raises; a bucket swap leaves every older blob the same way. The copy path verified twice, the reuse path not at all, so Cleanup would delete the legacy object and leave the `File` pointing at nothing | head the object at the claimed blob's own key and copy it there when it is gone |
| High | Rows Build cannot reach were recorded nowhere. A bare bucket key, a fetch URL left by a prefix rename that never ran, and every fetch URL on a site whose Drive Disk Settings are off all got no blob, no counter, and no `missing_bytes` entry. §14.10 then deletes Drive's legacy prefix | a third read-only pass lists them, with rows that never had bytes left out |
| High | `File Blob.file_size` is an `int(11)`. Any object above 2 GiB either aborted `migrate` or was silently clamped | refuse above the ceiling and report the row. See **Blocked criterion** |
| High | The gate proved only that two strings agreed. The first bucket call happened in step 3, after the backfill had committed. Revoked credentials, a missing bucket, or a role without `s3:ListBucket` left a half-migrated site | head one key that cannot exist, before any mutation |
| Medium | `begin_run` cleared `backfill_linked` and `backfill_blobs_created`, which the framework backfill cannot recompute. Every resumed run reported zero local rows linked | make both cumulative and add to them |
| Medium | The unique index on `(checksum, is_private, driver)` carries no `status`, so a `Pending` row for the same content made `claim_blob` refuse and `insert_blob` raise. That aborted the run, and aborted it again on every rerun | report the conflict and carry on |
| Medium | `BuildState.load` quarantined the record on any `OSError`. A transient `EIO` would reset the cumulative totals to zero | quarantine unreadable content only; let a read error stop the run |
| Medium | `missing_bytes` was unbounded and rewritten whole after every batch. 200k misses cost about 7 GB of writes across 200 batches | keep a bounded sample, count every miss exactly |
| Medium | The site-backed test ran two production queries unscoped against `slides.localhost`, and still selected `File Blob` by checksum with `force=1` | narrow both queries through a `SiteFiles` filter; name the blob through its own `File` row |

Two smaller corrections: the state file's temp name now carries the process
id, so two runs cannot promote each other's half-written file; and the
residue loop carries the same stalled-cursor guard the copy loop has.

Recorded claims that did not hold, now corrected above:

- "Cleanup's bucket sweep is where such an object goes." §14.10 deletes
  Drive's legacy prefix. It never touches `private/<ab>/<cd>/`.
- "Every acceptance box is built and covered by tests." The >5 GB box is not.
- "Adding `status != "Removed"` is not safe here" because SQL drops NULLs.
  True of a SQL filter, but `status` can be selected and compared in Python.
  The outcome is still right; the reason was not.
- The cursor-stall guard was described as closing a real nontermination path.
  Keyset paging already ruled that path out. The guard is insurance against a
  `LegacyFiles` that ignores `after`, and it now has a test that fires it.
- `unreadable_local_rows`' prefix filter was described as excluding fetch URLs
  and Link nodes. The framework backfill never selects those rows, so the
  filter excludes nothing. It stays as a guard, with an honest comment.
- `missing_bytes` was said to hold rows that become nodes with no blob. It
  holds every blobless local row on the site, framework attachments included.
  Ticket 27 must intersect it with its own reachability walk before §14.9
  prints `blobless_nodes`.

Findings judged acceptable and left alone: `Removed` rows are copied; the
copy is verified by size and not by content; a rolled-back batch leaks an
object at the canonical key. All three are in **Known risks** with their
reasoning corrected. One inherited framework hole is recorded and not fixed
here: `gc.delete_blob` deletes bytes before the row, so a failed row delete
leaves a Ready blob with no object. `put_blob` has the same hole. The reuse
verification above is what protects Build from it.

### Commands and real results, independent review

Same runner, same worktree, no `bench` and no site.

```
$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_storage.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_storage.py
17 files already formatted

$ cd sites && PYTHONPATH=<worktree> ../env/bin/python <runner> \
    suite.drive.patches.build.tests.{test_gate,test_layout,test_s3_copy,\
    test_legacy_bytes,test_ports,test_dormancy} suite.tests.test_architecture
Ran 136 tests in 1.339s
OK
```

Per module: `test_gate` 15, `test_layout` 7, `test_s3_copy` 40,
`test_legacy_bytes` 34, `test_ports` 26, `test_dormancy` 7, and
`suite.tests.test_architecture` 7. Was 92; the review added 44.

`suite/drive/tests/test_build_storage.py` collects 11 cases, up from 9, and
was still **not run**: it is an `IntegrationTestCase` and needs the site.

### Mutation check, independent review

Twenty-nine mutations, all of the review's own, applied to a copy under
`/tmp` and run against the site-free suite. All twenty-nine fail. Eleven of
them survived before the review's test additions.

| Mutation | Was |
|---|---|
| the reuse path links without heading the object | survivor |
| the reuse path heals our key, not the claimed blob's | survivor |
| the blob size ceiling is not checked | survivor |
| the ceiling is off by one | survivor |
| a blocking blob aborts the run | survivor |
| unreachable rows are never recorded | survivor |
| a fetch URL counts as handled with S3 off | survivor |
| the residue cursor never advances | survivor |
| every residue row counts, Link nodes included | survivor |
| backfill totals are overwritten, not added | survivor |
| backfill totals are not cumulative | survivor |
| the gate checks legacy S3 before storage v2 | survivor |
| `READ_CHUNK` becomes an unbounded read | survivor |
| the sniff head buffers the whole object | survivor |
| the sniff window shrinks to 16 bytes | survivor |
| the S3 body is never closed | survivor |
| the batch commits before its rows are copied | survivor |
| reused bytes are counted as copied | survivor |
| `state.save` writes straight to the target | survivor |
| the S3 stall guard is removed | survivor |
| `put_storage` overwrites the whole record | survivor |
| the record is written without its version | survivor |
| the capped list stops counting too | new |
| a read error quarantines the record again | new |
| the temp file is shared between processes | new |
| the gate never reads the bucket | new |
| the gate probes after the copy would start | new |
| the post-copy verification is dropped | already caught |
| a complete object is copied again anyway | already caught |

The fake S3 body now honours `read(size)` the way botocore does, so an
unbounded read no longer passes, and `FakeStorage` models the unique index.

### Dormancy, re-proved

`suite/patches.txt` and `suite/hooks.py` name no `patches.build`. The package
exports no `execute`, ships no JSON, exposes no whitelisted method and no
scheduler entry, and parsing every module shows nothing runs at import time.
`test_dormancy` (7) pins all of it. `bench migrate` cannot reach a line of
this package, so it proves nothing about this ticket and must not be its gate.
Registration is ticket 30's. Ticket 29 composes the entry point.

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
