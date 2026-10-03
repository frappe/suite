# 26 — Prepare legacy bytes for an additive Build

**What to build:** Make legacy Drive bytes available as blobs before any tree conversion.

**Blocked by:** [25 — Write and lock files over the same Drive workflows](25-webdav-write.md)

**Status:** done

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.1–14.2 steps 1–3.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement the storage-enabled and S3-configuration gates before mutation.
- [x] Run idempotent framework local backfill. Preserve framework attachments outside reachable Drive trees.
- [x] For legacy S3 URLs, hash once, copy through the specified canonical layout, and link File.blob.
- [x] Use managed multipart copy above 5 GB. Resume from linked blobs without copying complete objects again.
- [x] Record missing-byte and S3-copy results for the final report. Preserve original local bytes and legacy S3 objects.
- [x] Keep Build registration gated on the later integration ticket so an ordinary migrate cannot run a partial patch.

Every box is built, ran on `slides.localhost` after root merged and migrated,
and is audited against the code at HEAD. The audit of each box, and the gate
results behind it, are in
[Root site gate: final run and closeout](#root-site-gate-final-run-and-closeout)
at the end of this ticket. That section supersedes every earlier status claim
here.

## Verification

Run fixture-backed migration tests for disabled storage, invalid S3 configuration, missing files, interrupted copy, and multipart selection.

## Completion evidence

Historical. Written before the root site gate ran, and kept as written. Read
[Root site gate: final run and closeout](#root-site-gate-final-run-and-closeout)
for the current state.

All six acceptance criteria are built and covered by tests that run without
a site. The sixth, managed multipart copy above 5 GB, was blocked by the
framework schema and is now implemented: see **Large objects: the blocker
and its fix** and **Large objects: what was built**. None is ticked: neither
the framework migrate nor the site gate has run. The root orchestrator owns
both runs; the commands are at the end of this section.

Agents audited the framework storage API and the legacy Drive S3 paths, then
reviewed the finished code twice, once against the spec and once against the
test design. The orchestrator wrote the production change, made the calls the
reviews raised, and made the commits.

### Revisions

Base Suite `0aaa3ecda`, the commit that closed ticket 25, on
`implement/drive-26-build-storage-preparation`. Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` on `forge/storage-v2`, read only
and unchanged in this pass. A later pass does change one Frappe core file:
see **Large objects: what was built**. Read that before planning a migrate.

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
| Storage-enabled and S3 gates before mutation | `gate.py:32-85` | `test_gate` (15): storage off, an S3 Drive on a local driver, a driver with no bucket, an unnamed legacy bucket, two buckets, one name at two endpoints, and that a refused gate calls no backfill, commits nothing, and writes no record |
| Idempotent framework local backfill | `legacy_bytes.py:43` | calls `frappe.storage.backfill.run()` unfiltered at the framework's own page size. `test_legacy_bytes.TestIdempotence`; on a site, `test_build_storage.test_a_second_run_links_nothing_new` |
| Attachments outside reachable Drive trees preserved | `SiteFiles.link_blob`, framework `backfill.py:126-146` | the backfill links in place and never rewrites `file_url`. `test_the_legacy_s3_object_and_url_survive_the_copy`, `test_a_framework_attachment_outside_drive_is_left_alone`, and on a site `test_local_bytes_are_linked_in_place_and_left_untouched` |
| Hash once | `s3_copy.py:_read_once` | one `get_object` per row, and `FakeBucket` hands back a single-use forward-only stream, so a second pass cannot pass the test. `test_the_object_is_read_exactly_once`, `test_the_body_is_never_rewound` |
| Canonical-layout copy | `layout.py` | `test_layout` (8) pins the key against `frappe.storage.blob.make_key`, `sanitized_extension`, and `S3Driver.object_key`, not against a literal |
| `File.blob` linked | `SiteFiles.link_blob` | one column, no doc events, no `modified` bump. `test_ports.test_linking_writes_the_blob_column_and_nothing_else` |
| Managed multipart copy above 5 GB | `s3_copy.copy_in_bucket` | the choice is pinned at the boundary by `TestCopyChoice` and `TestMultipartWiring`, and end to end by `TestObjectAboveFiveGB`. A 6 GB object reaches a `File Blob` row once the framework column is migrated. See **Large objects: what was built** |
| Resume without recopying complete objects | `s3_copy.py:_copy_one` | three layers: a linked row leaves the query, a matching blob row skips the copy, a complete object at the destination skips it. `TestResume` (6) and `TestInterruptedRunResumes` (3) |
| Durable missing-byte and S3-copy results | `state.py` | `TestMissingBytes` (5) and `TestDurableRecord` (5), including a record kept aside rather than overwritten |
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

### Large objects: the blocker and its fix

`File Blob.file_size` was declared `Int` with no `length` in
`frappe/core/doctype/file_blob/file_blob.json`. `frappe.database.schema`
promotes an `Int` to a bigint only when `length > 11`, and the MariaDB type
map builds a bare `Int` as `int(11)`. The ceiling was 2,147,483,647 bytes.
`File.file_size` carries `length: 20` and is already a bigint, so the legacy
table held files the blob table could not describe.

Every object above 5 GB is therefore also above that ceiling.
`_validate_length` (`frappe/model/base_document.py:1326`) reads the same
`length > 11` rule the schema does, so `blob.insert()` raised
`CharacterLengthExceededError` before any SQL ran, in either `sql_mode`, and
`migrate` died after earlier batches had committed. The clamp was reachable
only through `db_insert` and `db.set_value`, which skip document validation;
Build uses neither. A clamped `File Blob.file_size` would lie to the §14.2
step 12 `used_bytes` recompute, to `frappe.storage.serve`'s ranged downloads,
and to §13 relocation.

The independent review made `_copy_one` refuse above the ceiling and report
the row. That kept the failure visible and bounded, and left the criterion
unmet. A third pass widened the framework column and removed the refusal:
see **Large objects: what was built**.

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
| High | `File Blob.file_size` is an `int(11)`. Any object above 2 GiB aborted `migrate` | refuse above the ceiling and report the row. Superseded: the column is now a bigint and the refusal is gone |
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
- "Every acceptance box is built and covered by tests." The >5 GB box was not. It is now, on a widened framework column.
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

### Large objects: what was built

A third session resolved the blocked criterion. It widened one framework
field, removed the Suite refusal that stood in for it, and replaced the
ceiling tests with tests for a 6 GB object.

Base Suite `3a96ea244`, the last commit of the independent review, on
`review/drive-26-build-storage-preparation`. Base Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd`, on a new branch
`fix/drive-26-large-file-size` taken from `forge/storage-v2`. This is the
first Frappe change ticket 26 carries.

| Repository | Commit | Subject |
|---|---|---|
| Frappe | `9fb933a4ee` | let a File Blob describe an object above 2 GiB |
| Suite | `82faf8e8c` | let Build copy legacy objects above 5 GB |

Two agents ran bounded read-only audits before any edit: one on the schema
and the migration path, one on every consumer of a blob size. The
orchestrator confirmed each finding against the source, wrote the change,
and made the commits.

#### The framework change

`frappe/core/doctype/file_blob/file_blob.json`, field `file_size`, one line:

```
"length": 20
```

The fieldtype stays `Int`. `frappe/database/schema.py:437` then maps it to
the `Long Int` column type. Measured in the worktree, with no database:

```
mariadb   Int: int(11)  Int length 20: bigint(20)  Long Int: bigint(20)
postgres  Int: int      Int length 20: bigint      Long Int: bigint
```

The `Long Int` fieldtype builds the same column and loses more than it wins:

- `NOT_NULL_TYPES` (`frappe/database/schema.py:182`) and the default branch
  at `:233` name `Int`, not `Long Int`. On MariaDB the column would lose
  `NOT NULL DEFAULT 0`. On Postgres it would keep `NOT NULL` and take
  `DEFAULT NULL`, which then refuses an insert that omits the field.
- `Long Int` is not an option in `DocField.fieldtype`, so `_validate_selects`
  refuses it on any save that is not an import.
- About 25 call sites name `Int` and not `Long Int`: Desk formatting and
  filters, report and list rendering, CSV import coercion,
  `get_valid_dict`'s int coercion, and the `unique` allowlist.
- `File.file_size` already carries `Int` with `length: 20`. The framework's
  own tests cover that mechanism: `test_db_update.test_bigint_conversion`,
  `test_bigint_conversion_with_existing_data`, and
  `test_no_unnecessary_migrates`.

`frappe/storage/SPEC.md` now records the width in its data-model table.

#### What the widening does not change

The audit traced every consumer of a blob size. No Python code casts to 32
bits. `blob.put_blob` accumulates the size as a Python int.
`frappe.storage.serve` hands it to werkzeug's range helpers, which are
exact. `relocate` sums sizes in Python. `gc` never reads a size. The
framework holds no `used_bytes` column and runs no SQL `SUM` over a file
size. The column was the only truncation point.

Two limits stay, and neither belongs to this ticket:

- `frappe.storage.upload.check_declared_size` refuses an upload above
  `System Settings.max_file_size`, 25 MiB by default
  (`frappe/core/api/file.py:82`). It is a policy gate on the upload route.
  Build does not use that route.
- A presigned POST caps one object at 5 GB, so the `direct` upload mode
  cannot deliver a larger object. The chunked mode can.

#### Migration impact

`migrate` emits one statement on MariaDB:

```
ALTER TABLE `tabFile Blob` MODIFY `file_size` bigint(20) NOT NULL DEFAULT 0
```

Nullability and default are the same on both sides, and every `int` value
fits a `bigint`, so no row converts and nothing truncates. InnoDB rebuilds
the table for a width change, which costs time on a large table.

No deployed site pays that cost. `File Blob` is new on `forge/storage-v2`
(`b928dae007`, 2026-09-02) and ships in no release, so a real site creates
the column at `bigint(20)` and never alters it. `slides.localhost` already
holds the table and must run the `ALTER`.

The change is reversible in the schema: dropping `length` regenerates
`int(11)`. It is not reversible in the data. A stored value above
2,147,483,647 would truncate, and `DBTable.validate` guards varchar
narrowing only.

#### The Suite change

`BLOB_SIZE_CEILING` and the refusal in `_copy_one` are gone. Nothing else in
the copy step moved. The choice between `copy_object` and `managed_copy` was
already right.

#### Commands and real results, large objects

Site-free, in both worktrees. No `bench`, `migrate`, `install`, `restart`,
or `push` was run. `slides.localhost`, its queues, and its configuration
were not touched.

```
$ python3 -m compileall -q suite/drive/patches/build suite/drive/tests/test_build_storage.py
COMPILED
$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_storage.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_storage.py
17 files already formatted

$ python3 -m compileall -q frappe/core/doctype/file_blob
COMPILED
$ uvx ruff@0.12.3 check frappe/core/doctype/file_blob
All checks passed!
$ uvx ruff@0.12.3 format --check frappe/core/doctype/file_blob
3 files already formatted

$ cd sites && PYTHONPATH=<frappe worktree>:<suite worktree> ../env/bin/python <runner> \
    suite.drive.patches.build.tests.{test_gate,test_layout,test_s3_copy,\
    test_legacy_bytes,test_ports,test_dormancy} suite.tests.test_architecture
Ran 136 tests in 1.561s
OK
```

`<runner>` is `frappe.init(site="slides.localhost")` with no `connect`, then
`unittest`. Both worktrees are on `PYTHONPATH`, so the run uses the changed
framework. Per module: `test_gate` 15, `test_layout` 7, `test_s3_copy` 40,
`test_legacy_bytes` 34, `test_ports` 26, `test_dormancy` 7, and
`suite.tests.test_architecture` 7. The total is unchanged: three ceiling
tests left and three large-object tests arrived.

`TestObjectAboveFiveGB` declares a 6 GB object. `_read_once` is the only
step that must touch every byte, so it is the one thing stood in for; the
size and the checksum it returns are what a 6 GB object would produce.
Everything after it runs for real: the copy choice, the size verification,
the blob row, and the link. `FakeBucket.copy_object` raises above 5 GB the
way S3 does, so a regression to the single-part call fails there.

Two site-backed modules were **not run**. Both need the migrated column, and
before the `ALTER` they fail. That is the point of them.

- Suite `suite/drive/tests/test_build_storage.py` collects 12 cases, up from
  11. `test_an_object_above_five_gb_becomes_a_blob_that_carries_its_size`
  inserts and links a 6 GB blob through the real `File` and `File Blob`
  tables. The size is declared. No bytes are written.
- Frappe `frappe.core.doctype.file_blob.test_file_blob` collects 8 cases, up
  from 4. `TestFileBlobSize` asserts that the declaration builds the bigint
  column type on the current backend, that 2**31 and 5 GB plus one round
  trip through the database and through the document, and that 2**63 is
  still a validation error.

#### Mutation check, large objects

Three mutations of the Suite production modules, applied to a copy under
`/tmp` and run against the site-free suite. All three fail.

| Mutation | Caught by |
|---|---|
| the copy is never multipart | `test_it_goes_through_the_managed_multipart_copy`, plus 4 errors raised by the fake's own 5 GB refusal |
| the blob is told the old `int(11)` ceiling | `test_the_blob_row_carries_the_whole_size` |
| rows above 2 GiB are refused again | `TestObjectAboveFiveGB`, 2 failures and 1 error |

#### Dormancy, unchanged

No Suite file outside `suite/drive/patches/build/` and its tests changed.
`suite/patches.txt`, `suite/hooks.py`, and the fixtures still name no
`patches.build`. `test_dormancy` (7) passes. Tickets 29 and 30 stay dormant.
The Frappe commit registers no patch and no hook: it is one attribute on one
field, applied by schema sync.

### What root must run for large objects

Serially, and before the site gate above. The framework change has to land
on the bench's own checkout: a site's schema does not come from a worktree.

```
env -C /home/faris/benches/suite-bench/apps/frappe git status --short
env -C /home/faris/benches/suite-bench/apps/frappe git log --oneline -1
env -C /home/faris/benches/suite-bench/apps/frappe git merge --ff-only review/drive-26-large-file-size

env -C /home/faris/benches/suite-bench bench --site slides.localhost migrate

env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost execute frappe.db.describe --args '["File Blob"]'

env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.core.doctype.file_blob.test_file_blob
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.storage.tests.test_blob
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.storage.tests.test_gc_backfill
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.storage.tests.test_relocate
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.storage.tests.test_serve_upload
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.storage.tests.test_file_integration
env -C /home/faris/benches/suite-bench \
  bench --site slides.localhost run-tests --module frappe.tests.test_db_update
```

Read the first two commands before the third. `git merge --ff-only` needs
`apps/frappe` clean and on `forge/storage-v2`. The branch is that commit
plus two, so the merge fast-forwards. It is `review/…`, not `fix/…`: the
final review added a second commit on top. `fix/drive-26-large-file-size`
still exists and is now one commit behind.

`migrate` here applies the column. It still cannot reach a line of
`suite/drive/patches/build/`, because `patches.txt` does not name it.
Migrate is not this ticket's gate and running it ticks no box.

`bench execute frappe.db.describe` is the schema check. It is written from
the source and was not run here. Expect `file_size` as `bigint(20)`.

Then run the site gate above. Its `test_build_storage` needs the migrated
column for its twelfth case.

The multipart criterion stays unticked until root migrates and both
site-backed modules pass. It is no longer blocked: the implementation is
complete.

### Final independent review

A fresh session reviewed both repositories from their bases, trusting none of
the evidence above. Five agents ran bounded audits: the framework schema
change and every consumer of a blob size, multipart copy correctness and
recovery, `File Blob` linking and deduplication, the acceptance criteria and
dormancy, and the tests. The reviewer confirmed each finding against the
source before acting, ran the site-free suite and the lint checks, wrote the
corrections and their tests, and made the commits.

Base Suite `3fe18431f` on `review/drive-26-final`. Base Frappe `9fb933a4ee`
on `review/drive-26-large-file-size`.

| Repository | Commit | Subject |
|---|---|---|
| Frappe | `3357ad1605` | say what a narrow file_size really did |
| Suite | `25797f586` | make Build's conflict recovery survive Postgres |
| Suite | `a507f76c0` | close three gaps the Build storage tests left open |

Two defects were found. Neither loses bytes.

| Severity | Defect | Fix |
|---|---|---|
| Medium | `BlobConflict` promised the run "carries on", and on Postgres it did not. A unique violation aborts the whole transaction there, so `blocked_by` and every later statement in the batch would raise `InFailedSqlTransaction` and the migration would die — the outcome the handler exists to prevent | take a savepoint around the insert and roll back to it before reporting. Two statements against a row that already paid for an S3 copy |
| Low | Three test modules carried `if __name__ == "__main__"` in the middle of the file. `test_s3_copy` hid 16 cases below it, `test_legacy_bytes` 15, `test_ports` 5, including every `TestObjectAboveFiveGB` case | move the guard to the end of each file |

Three test-effectiveness gaps were closed. Each was a surviving mutation.

| Gap | Test added |
|---|---|
| `_place_object` skipped the copy on `== size`, and nothing proved it was not `>=`. A longer object at the destination would have been accepted and a blob linked over bytes whose checksum they do not have | `test_an_oversized_object_at_the_destination_is_copied_again` |
| `FakeBucket` imported `MULTIPART_COPY_THRESHOLD`, so its 5 GiB refusal moved with the constant. A decimal `5 * 1000**3` was caught by one assertion | the fake carries its own literal `5_368_709_120`; `test_the_threshold_is_what_the_fake_bucket_refuses` pins the two against each other |
| `SiteStorage.insert_blob` was only ever handed `size=12`, so a narrowing cast on the one port that writes `File Blob.file_size` was invisible | the existing port test now inserts 6 GB |

`test_dormancy` now derives its module list from the package instead of a
hand-kept tuple, so a new module that ships an `execute` cannot be missed.
`environment` was not in the old tuple.

Recorded claims that did not hold, now corrected above:

- "Under a strict `sql_mode` the insert raises … without strict mode the
  value is clamped." `_validate_length` reads the same `length > 11` rule the
  schema does, so `blob.insert()` raised `CharacterLengthExceededError`
  before any SQL ran, in either mode. The clamp needed `db_insert` or
  `db.set_value`, which Build does not use. The fix was right; the mechanism
  was not.
- "No Frappe core file is touched." True of the first pass only. The large-
  object pass changes `frappe/core/doctype/file_blob/file_blob.json`.
- `test_gate` (10), `TestResume` (4), `TestMissingBytes` (6), `gate.py:26-71`
  and `legacy_bytes.py:32` had all drifted. Corrected.
- The root merge names `review/drive-26-large-file-size` now, not `fix/…`.

Findings confirmed and deliberately left alone:

- **The 5 GiB threshold and the `>` comparison are right.**
  `s3transfer.utils.MAX_SINGLE_UPLOAD_SIZE` is `5 * 1024**3` and S3's
  CopyObject limit is inclusive, so an object of exactly 5 GiB is a legal
  single-part copy.
- **The managed copy cannot exceed 10,000 parts.**
  `s3transfer/copies.py:248` runs `ChunksizeAdjuster` before computing the
  part count, so an 8 MiB default grows to 512 MiB for a 5 TB object. The
  largest workable object is about 47.7 TiB, above S3's own 5 TB maximum.
- **`File.blob` is in GC's reference discovery.** `get_link_fields` finds it,
  and the orphan predicate emits `not exists (select 1 from tabFile …)`, so
  a migrated blob is never collected. Re-verified from the source.
- **The extension case in dedup is correct.** Two rows with one content and
  different extensions link to one blob, because `_copy_one` heads the
  claimed row's own key rather than one recomputed from its own filename.

New risks, none of them resolved here:

- **A permanently unreadable object stops every run, not just this one.**
  `_copy_one` catches `FileNotFoundError` only. An object in GLACIER answers
  `InvalidObjectState`, and a prefix-scoped bucket `Deny` answers
  `AccessDenied`; both propagate, `migrate` rolls back, and the rerun dies on
  the same row. Failing closed is right for a systemic fault — recording
  every row as a missing byte would be worse — but a per-object permanent
  error has no way past. Ticket 29 owns the report; a per-object skip list
  belongs with it.
- **An interrupted backfill loses its counters for good.**
  `frappe.storage.backfill.run` commits every page but returns its totals
  only at the end. A run killed mid-backfill leaves the rows linked and
  `backfill_linked` never incremented, and the rerun's backfill skips those
  rows and reports zero. The S3 step flushes its record per batch and is
  bounded at one batch; the backfill step is bounded at the whole run.
  Deriving the two numbers by query at report time would close it, and that
  is §14.9's, not this ticket's.
- **The gate probes the canonical namespace, not the legacy Drive prefix.**
  `PROBE_KEY` is `private/.drive-build-gate-probe`. A driver credential
  scoped to `private/*` and `public/*` passes the gate and then
  `AccessDenied`s on the first legacy `bucket.open()`, after the backfill has
  committed. A second probe under Drive's own prefix would close it.
- **Pre-rename fetch URLs are recorded as unreachable although their bytes
  are readable.** A row still carrying `drive.api.s3.fetch?path=` — one
  `migrate_s3_url_prefix` never reached — fails the prefix match and lands in
  `missing_bytes`. §14.2 step 3 names the `suite.` prefix, so this follows
  the spec text; the report names the rows, and §14.10 must not run before
  someone reads it.
- **`frappe/storage/SPEC.md` calls `File Blob.key` unique.** It is
  `search_index`; only `(checksum, is_private, driver)` carries a unique
  index. Pre-existing, framework side, outside this ticket.

### Commands and real results, final review

Site-free, in both worktrees. No `bench`, `migrate`, `install`, `restart`, or
`push` was run. `slides.localhost`, its queues, and its configuration were not
touched.

```
$ python3 -m compileall -q suite/drive/patches/build suite/drive/tests/test_build_storage.py
COMPILED
$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_storage.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_storage.py
17 files already formatted

$ python3 -m compileall -q frappe/core/doctype/file_blob
COMPILED
$ uvx ruff@0.12.3 check frappe/core/doctype/file_blob
All checks passed!
$ uvx ruff@0.12.3 format --check frappe/core/doctype/file_blob
3 files already formatted

$ cd sites && PYTHONPATH=<frappe worktree>:<suite worktree> ../env/bin/python <runner> \
    suite.drive.patches.build.tests.{test_gate,test_layout,test_s3_copy,\
    test_legacy_bytes,test_ports,test_dormancy} suite.tests.test_architecture
Ran 140 tests in 1.504s
OK
```

Per module: `test_gate` 15, `test_layout` 8, `test_s3_copy` 41,
`test_legacy_bytes` 34, `test_ports` 28, `test_dormancy` 7, and
`suite.tests.test_architecture` 7. Was 136; the review added 4.

Both site-backed modules still collect and are still **not run**:
`suite/drive/tests/test_build_storage.py` 12 cases,
`frappe.core.doctype.file_blob.test_file_blob` 8.

### Mutation check, final review

Five mutations, applied to a copy under `/tmp` and run against the site-free
suite. All five fail, and each on the test written for it.

| Mutation | Caught by | Was |
|---|---|---|
| `_place_object` accepts an oversized destination object | `test_an_oversized_object_at_the_destination_is_copied_again` | survivor |
| the threshold becomes a decimal `5 * 1000**3` | `test_the_threshold_is_what_the_fake_bucket_refuses`, plus the literal pin | 1 assertion only |
| `insert_blob` masks the size to 32 bits | `test_the_inserted_blob_is_a_ready_private_s3_row` | survivor |
| the conflict path skips the savepoint rollback | `test_a_conflict_rolls_back_to_the_savepoint_before_it_is_reported` | new |
| no savepoint is taken at all | that test plus `test_the_insert_is_wrapped_in_a_savepoint` | new |

### Dormancy, re-proved again

`suite/patches.txt`, `suite/hooks.py`, `suite/modules.txt` and every file
under `suite/fixtures/` name no `patches.build`. `after_migrate` resolves to
`suite.composition.lifecycle.after_migrate`, which calls Mail's hook and
Drive's content-registry check and nothing else. No `.json` exists anywhere
under `suite/drive/patches/`. Nothing outside `suite/drive/tests/test_build_storage.py`
imports the package. `test_dormancy` (7) passes. Tickets 29 and 30 are
unchanged, still `ready-for-agent`, with every box unticked. The Frappe
commits register no patch and no hook.

## Root site gate: final run and closeout

Supersedes every earlier status claim in this ticket. The review sections
above stay as written.

Root merged both branches, migrated `slides.localhost`, and ran the whole gate
serially. This closeout audited the six acceptance criteria against those
results and against the code at HEAD, trusting none of the prose above. Agents
ran three bounded read-only audits: the gates and the backfill; the
hash-copy-link path and the multipart choice; the durable record,
preservation, and dormancy. The auditor confirmed every result against the
source and made this commit.

This closeout ran no `bench`, no `migrate`, no test, and no server. It changed
no production file and no test.

### Revisions at closeout

Suite `ca69ece4b` on `close/drive-26`, the last commit of the final
independent review. Frappe `3357ad1605` on `forge/storage-v2`. Both working
trees clean.

### Migration and the live column

`bench --site slides.localhost migrate` exited 0.

`frappe.db.describe` on `File Blob` reports `file_size` as `bigint(20)`,
`NOT NULL`, default `0`. That is the widened column, live on the site. It
matches the declaration `"length": 20` on an `Int` field
(`frappe/core/doctype/file_blob/file_blob.json:35-39`) and the promotion rule
at `frappe/database/schema.py:437`. The predicted `ALTER` is what ran.

Migrate ticks no box. The package stays unregistered, so migrate reaches no
line of it.

### Frappe modules

Seven modules, one invocation each, serialized. All exited 0 and printed OK.

| Module | Cases |
|---|---|
| `frappe.core.doctype.file_blob.test_file_blob` | 8 |
| `frappe.storage.tests.test_blob` | 26 |
| `frappe.storage.tests.test_gc_backfill` | 30 |
| `frappe.storage.tests.test_relocate` | 9 |
| `frappe.storage.tests.test_serve_upload` | 65 |
| `frappe.storage.tests.test_file_integration` | 32 |
| `frappe.tests.test_db_update` | 17, 2 skipped |
| **Total** | **187** |

The two skips are expected and belong to the framework, not to this ticket.
`test_db_update` carries `@run_only_if(db_type_is.POSTGRES)` twice
(`frappe/tests/test_db_update.py:138`, `:265`), and the site is MariaDB. The
two MariaDB-only cases ran. `test_bigint_conversion` and
`test_bigint_conversion_with_existing_data` carry no condition, so the
mechanism the widening uses ran for real.

### Suite modules

Eight modules, one invocation each, serialized. All exited 0 and printed OK.

| Module | Cases |
|---|---|
| `suite.drive.tests.test_build_storage` | 12 |
| `suite.drive.patches.build.tests.test_s3_copy` | 41 |
| `suite.drive.patches.build.tests.test_legacy_bytes` | 34 |
| `suite.drive.patches.build.tests.test_ports` | 28 |
| `suite.drive.patches.build.tests.test_gate` | 15 |
| `suite.drive.patches.build.tests.test_layout` | 8 |
| `suite.drive.patches.build.tests.test_dormancy` | 7 |
| `suite.tests.test_architecture` | 7 |
| **Total** | **152** |

Every count matches a static count of `def test_` at HEAD, module by module.
No `unittest.skip` and no `expectedFailure` exists in any of them, so the
collected count is the run count. The 140 site-free cases are the same cases
the final review ran; the site added `test_build_storage`'s 12.

`test_build_storage` ran for the first time. It needed both the site and the
migrated column.

### The large object, live

`test_an_object_above_five_gb_becomes_a_blob_that_carries_its_size` passed on
the site. A declared object above 5 GB takes the managed multipart copy and
creates a `File Blob` row carrying the exact full size. No payload was
allocated. That closes the one criterion the framework schema had blocked.

### Acceptance criteria

Each box is audited against the code at HEAD and the gate results above, not
against this ticket's prose.

| # | Criterion | Verdict |
|---|---|---|
| 1 | Storage-enabled and S3 gates before mutation | Passes. `gate.py:34` refuses a site with storage v2 off, first and unconditional, so the S3 branch cannot short-circuit it. The S3 branch adds driver, bucket present, bucket identity, and endpoint identity (`gate.py:43-82`), then heads `private/.drive-build-gate-probe` (`gate.py:84-101`), which turns revoked credentials or a missing bucket into a refusal. `legacy_bytes.py:33` calls the gate before anything else; the backfill is `:43` and the first state write `:50`. Live in `test_gate` (15), including `test_a_bucket_it_cannot_read_refuses_before_the_backfill` and `test_a_refused_gate_mutates_nothing`. |
| 2 | Idempotent local backfill; outside attachments preserved | Passes. `legacy_bytes.py:43` calls `frappe.storage.backfill.run()` unfiltered through `ports.py:124-127`. The framework skips already-linked rows (`frappe/storage/backfill.py:65`), writes only the `blob` column with `update_modified=False` (`:103`), keeps `file_url` as it was, and points the blob back at the legacy path (`:148`). Totals add instead of resetting (`legacy_bytes.py:46-47`). Live in `test_legacy_bytes` (34) and, on the site, `test_build_storage.test_local_bytes_are_linked_in_place_and_left_untouched` and `test_a_second_run_links_nothing_new`. |
| 3 | Hash once, canonical layout, `File.blob` linked | Passes. `s3_copy.py:176-187` is one `bucket.open` per row in a single forward pass, bounded by `READ_CHUNK`, sniffing from a copy of the head, so the body is never rewound. `layout.py:17-22` calls `frappe.storage.blob.make_key` and `sanitized_extension`, and `layout.py:25` matches `S3Driver.object_key`, so the key is pinned to the framework and not to a literal. `ports.py:233` writes the `blob` column alone, no doc events, no `modified` bump. Live in `test_s3_copy` (41), `test_layout` (8), `test_ports` (28). |
| 4 | Managed multipart above 5 GB; resume without recopying | Passes. `layout.py:14` fixes the threshold at `5 * 1024**3` and `layout.py:37` compares with `>`, so an object of exactly 5 GiB stays a legal single-part copy. `s3_copy.py:152-161` dispatches above it to `ports.py:283` `client.copy`, the boto3 managed copy. No size ceiling remains anywhere in either repository. Resume has three layers: `ports.py:198` drops linked rows from the query, `s3_copy.py:102-111` claims a matching blob, and `s3_copy.py:142` skips an object already complete at the destination and re-copies one of the wrong size. Live in `test_s3_copy` and, on the migrated column, `test_build_storage` case 12. |
| 5 | Durable record; original bytes and legacy objects preserved | Passes. `state.py:105-109` writes `<site>/private/drive-build-state.json` through a pid-named temp, `fsync`, `os.replace`, and a directory fsync (`state.py:128-137`). Missing bytes keep a bounded sample and an exact count (`state.py:40`, `:67-75`). Five counters are cumulative (`state.py:27-35`). A corrupt record moves aside and a read error stops the run (`state.py:111-126`). For preservation, the `S3Bucket` seam declares only `open`, `size`, `copy_object`, and `managed_copy` (`ports.py:92-107`), so no rule in the package can reach a delete or an overwrite. The package holds no `delete_object`, `put_object`, `os.remove`, or `shutil` call, and the only boto3 methods it reaches are `get_object`, `head_object`, `copy_object`, and `copy`. Live in `test_legacy_bytes`, `test_ports.test_it_never_writes_or_deletes_through_the_client`, and `test_build_storage`. |
| 6 | Registration gated on ticket 30 | Passes. `suite/patches.txt`, `suite/hooks.py`, `suite/modules.txt`, and every file under `suite/fixtures/` name no `patches.build`. `git diff --name-only 0aaa3ecda..HEAD` lists only the package, its tests, the site-backed test, and this ticket, so no patch, hook, or DocType JSON moved. The package defines no `execute`, ships no JSON, and exposes no whitelisted method or scheduler entry. `after_migrate` resolves to `suite.composition.lifecycle.after_migrate`, whose body calls Mail's hook and Drive's content-registry check and nothing else. Root's `migrate` exited 0 and ran no line of the package. Live in `test_dormancy` (7), whose module list comes from the package directory (`test_dormancy.py:78-79`), so a new module cannot be missed. |

### What this closeout verified for itself

- Every module count above matches a static count of `def test_` at HEAD, in
  both repositories.
- The two Frappe skips are the two Postgres-only cases, named above.
- The merged Frappe commits register no patch and no hook. `9fb933a4ee`
  touches the field JSON, its tests, and `frappe/storage/SPEC.md`;
  `3357ad1605` touches the test docstrings only.
- Tickets 27, 29, and 30 are unchanged. All three read `ready-for-agent` with
  every box unticked, and the git range touches none of them.

### One reported concern, dismissed

The package uses self-referential return annotations with no
`from __future__ import annotations`, so it needs PEP 649 and does not import
below Python 3.14. Both `pyproject.toml` files require `>=3.14,<3.15`, so the
path is unreachable. Recorded, not changed.

### Risks that stand

Every entry in **Known risks** and in the final review's **New risks** stays
open. This closeout resolved none of them and found no new one. Three still
need an owner before Build runs on real data: a per-object permanent read
error has no skip list (ticket 29), `missing_bytes` must be intersected with a
reachability walk before §14.9 prints `blobless_nodes` (ticket 27), and the
bucket needs an `AbortIncompleteMultipartUpload` lifecycle rule before a
multi-GB copy can be interrupted safely.

### Site state after the run

Root's gate is the only thing that touched `slides.localhost`. The Frappe
merge and the `ALTER` on `tabFile Blob` stand. `bench run-tests` rolls back
per class, so no fixture row survives. This closeout touched no site state,
no queue, and no configuration.
