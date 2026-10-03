# 12 — Keep and restore versions with bounded automatic history

**What to build:** Retain file and document versions, restore safely, and reclaim only eligible automatic history.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** done

**Owner:** Suite Drive versions

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.4, §9.1.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement take, list, label/pin, delete, and restore through the Drive workflows.
- [x] Preserve bytes and sequence uniqueness under concurrent writers. Only label and pinned fields remain mutable as specified.
- [x] Restore first captures current content. Keep the zero-byte old-head exception and exact quota deltas.
- [x] Use content callbacks for document bytes. File history uses blob references.
- [x] Apply the full age ladder. Named, milestone, and pinned versions survive automatic thinning.
- [x] Register daily thinning through the scheduler adapter, and release each removed version’s charge.

## Verification

Run file and fake-content contract tests with controlled time, concurrent seq allocation, quota rollback, and each ladder boundary.

## Completion evidence

Implemented 2026-09-06 from ticket 11 revision
`228a5c19cc1b7a3d97222aa999d6061449667f02`. Frappe stayed at
`158a173a1c8fb0083f2b352250f8ac4bba1781ba`. Finalized on 2026-09-06 after
merging Drive layer revision `9cad154bf00220b713de2d1c0652fa0c4a242838`, which
adds the corrupt-ancestry refusal. The merge was clean and touched only
`_core/nodes.py`, `tests/test_nodes.py`, and ticket 11.

Changed behavior:

- `suite/drive/_core/versions.py` adds `take_version`, `list_versions`,
  `label_version`, `delete_version`, `restore_version`, and `thin` with the
  roles of §9.1: EDIT to take, label, and restore; READ to list; MANAGE to
  delete.
- A version row is immutable. `DriveNodeVersion.validate` throws if an ORM
  save changes `node`, `seq`, `kind`, `actor`, `owner`, `size`, `blob`, or
  `creation` on an existing row, so `label` and `pinned` are the only
  ORM-mutable fields. That guard covers ORM saves only. Drive's own approved
  mutators deliberately use direct DB operations: `label_version` calls
  `frappe.db.set_value`, and `delete_version`, `_thin_node`, and the purge
  sweep call `frappe.db.delete`. Both skip controller hooks by design. What
  keeps rows immutable in practice is that `_core/versions.py` is the sole
  writer and never updates those eight columns. The controller is the
  defence-in-depth guard for Desk forms and future ORM callers.
- `_insert_version` allocates `MAX(seq) + 1` under the node row lock every
  caller already holds, so concurrent writers get unique sequences without a
  counter field. `nodes._preserve_head` now delegates to
  `versions.preserve_file_head`, so the replace path uses that one allocator.
- Restore captures the current state first. A file node's old head charge
  moves to the captured row and the restored head is admitted separately, so
  the root delta is exactly the target size. A document body is free until it
  is captured, so its captured bytes are admitted. A zero-byte old head
  creates no row and returns 0.
- Document bytes come from `ContentTypeSpec.version_bytes` and go back through
  `restore_version`. File history reuses the head blob. Drive stores no second
  copy and deletes no bytes.
- The ladder keeps everything under 24 h, one per hour to 7 d, one per day to
  30 d, one per week to 90 d, and nothing beyond. `named`, `milestone`, and
  pinned rows are never candidates. `site_config.drive_version_ladder`
  overrides the tiers and is validated for type and ordering.
- `thin` runs one node per transaction and releases each removed size.
  `suite.drive.jobs.thin_versions` registers it as a daily scheduler event.

Review decisions recorded on this ticket:

- **Root refusal.** Every version entry point now calls
  `roots.reject_illegal_root_operation(node, "version")`, and `"version"`
  joined `ILLEGAL_ROOT_OPERATIONS`. §8 lists versions beside move, copy,
  trash, restore, and purge, so they share one guard and one `DriveForbidden`
  message instead of a version-only phrasing.
- **The content callback's MIME.** `version_bytes` returns `(stream, mime)`
  per §10.1. The MIME is validated as a contract shape and then dropped.
  Re-read of the spec: §3.4 lists eight fields for `Drive Node Version`
  (`node`, `seq`, `kind`, `label`, `pinned`, `actor`, `size`, `blob`) and no
  MIME column. §10.1 declares the return type and names no consumer and no
  duty to persist or serve it. §11.2 specifies only "302 to a signed `/f/`
  URL" for `GET /nodes/<id>/versions/<seq>/content`, with no response
  content-type rule. Dropping the MIME therefore conforms to the spec as
  written, and this stays a documentation correction, not a code gap against
  §9.1 or §3.4.

  The earlier "nothing is lost" claim was wrong and is withdrawn. It is
  local-driver-specific. `frappe/storage/serve.py` recovers the type from the
  download filename only on the `/f/` streaming path. On S3 that path never
  runs: `signed_url_for_blob` returns the driver presigned URL, and
  `serve_file` redirects before `stream_blob`. The S3 presigned URL sets
  `ResponseContentDisposition` and no `ResponseContentType`, and the object is
  written with no `ContentType`. A Writer version stored as JSON therefore
  downloads as octet-stream on S3.

  No architecture-consistent fix exists inside this ticket. Persisting the
  MIME needs a §3.4 column. Serving it needs a `put_blob(content_type=)`
  parameter plus S3 `ExtraArgs`, or `ResponseContentType` on the presigned
  URL, which is §13 framework work and is not on the framework ask list.
  Each amends an accepted decision, so nothing was implemented. The
  limitation is recorded as a handoff below and as a `LIMITATION` and
  `HANDOFF` comment above the `put_blob` call in `_version_bytes`
  (`suite/drive/_core/versions.py:383-402`).
- **Thinner transaction scope.** §7.2 makes the `Drive Root` row UPDATE the
  quota lock. One transaction for the whole daily pass would hold that row for
  every visited root until the job ended, blocking admission for every writer
  on the site. `thin` now commits per node, and logs and skips a failing node,
  matching `jobs.purge_trashed_nodes`. `_thin_node` holds the node row lock
  for one node only and treats a node purged mid-pass as no work.
- **Trashed nodes.** The inherited code refused all five workflows on a
  trashed node. §8.8 says a trashed document opens read-only, which binds the
  two calls that write the node's own bytes: `take_version` and
  `restore_version` still refuse. §9.1 gives `label_version` EDIT and
  `delete_version` MANAGE as their one condition, §7.1 makes deleting a
  version the way to free its bytes, and the daily thinner already removes a
  trashed node's auto history. Both now work while a node is trashed, so a
  root over quota is not stranded until purge.
- **The zero-byte head.** §9.1's exception reads "a replaced head of size 0 is
  never kept", so it binds the two old-head captures. `preserve_file_head` and
  restore enforce it. An explicit `take_version` of an empty file still writes
  a size-0 row, which costs no bytes and is thinned as ordinary auto history.
  A comment records the reading.

An independent spec review of this implementation raised nine items. Four
changed the code: the trashed-node split above, `owner` added to the
controller's immutable field list, the lock precondition of
`preserve_file_head` moved from a comment into its docstring, and four new
unit tests (scheduler registration, node-kind refusals, ladder override
validation, and the corrected trashed-node behavior). The rest are recorded
here as deliberate readings or as handoffs below.

Verification actually run in this worktree, without the bench and without the
shared site:

```text
FILES=(suite/drive/_core/versions.py suite/drive/_core/roots.py suite/drive/_core/nodes.py suite/drive/jobs.py suite/drive/tests/test_versions.py suite/drive/tests/test_nodes.py suite/drive/doctype/drive_node_version/drive_node_version.py suite/hooks.py)
uvx ruff@0.12.3 check "${FILES[@]}"
uvx ruff@0.12.3 format --check "${FILES[@]}"
/home/faris/benches/suite-bench/env/bin/python -m compileall -q "${FILES[@]}"
git diff --check
```

All passed. Two no-database harnesses ran this worktree's own module under
`PYTHONPATH` with `frappe.init()` and no `connect()`:

- Every ladder boundary in the §9.1 table returned its decided tier, and
  `_pick_deletions` kept the newest row per bucket.
- `_require_version_node` refused a root with `DriveForbidden` ("The version
  operation does not apply to a Drive root") and a folder and a link with
  `DriveConflict`, and passed a file and a document.
- `_require_content_version_node` refused a trashed file as read-only while
  `_require_version_node` passed it, which is the label and delete split.
- `thin` committed once per successful node, then rolled back, logged, and
  continued past one failing node, returning `failed: 1`.
- `_normalized_ladder` refused unknown tiers, negative hours, boolean hours,
  unordered bounds, and a non-mapping, and read an override from
  `frappe.conf`.
- `suite.drive.jobs.thin_versions` is registered exactly once, under `daily`.
- Every touched module imported cleanly from the worktree, proving no import
  cycle through `nodes` -> `versions` -> `roots`, and
  `suite.drive.jobs.thin_versions` resolved as a dotted hook target.

### Site test results

Run on the authorized bench site against this branch. All three modules
passed:

```text
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions   # 17/17
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes      # 36/36
bench --site slides.localhost run-tests --module suite.drive.tests.test_upload     # 34/34
```

`test_versions` is 7 unit tests in `TestVersionLadder` plus 10 integration
tests in `TestVersionWorkflows`. `test_nodes` and `test_upload` are regression
runs, because `_preserve_head` and the replace path now go through
`versions.preserve_file_head`.

Every acceptance criterion above is now covered by a named test:

| Criterion | Tests |
|---|---|
| Five workflows and their roles | `test_take_list_label_pin_delete_and_immutable_bytes`, `test_edit_can_take_and_label_but_only_manage_can_delete`, `test_every_root_version_workflow_is_refused`, `test_only_files_and_documents_have_versions` |
| Bytes and sequence uniqueness | `test_concurrent_take_allocates_unique_monotonic_sequences`, `test_upload.test_concurrent_replace_preserves_the_intermediate_head_with_unique_sequences`, `test_upload.test_version_identity_and_bytes_are_immutable_but_label_and_pin_are_editable` |
| Restore capture, zero-byte head, quota deltas | `test_file_restore_captures_current_head_and_admits_only_restored_head`, `test_zero_byte_file_restore_skips_old_head_version`, `test_restore_quota_refusal_rolls_back_capture_and_head` |
| Content callbacks and blob references | `test_content_callbacks_round_trip_bytes_and_charge_captures` |
| Age ladder and protected versions | `test_every_default_boundary_uses_the_decided_tier`, `test_newest_row_survives_each_density_bucket`, `test_configured_ladder_overrides_are_validated`, `test_thin_keeps_protected_versions_and_releases_removed_sizes` |
| Daily thinner and released charge | `test_scheduler_adapter_delegates_to_core_thinner`, `test_thinner_is_registered_once_as_a_daily_scheduler_event`, `test_thin_commits_each_node_and_isolates_one_failure`, `test_thin_keeps_protected_versions_and_releases_removed_sizes` |

### Ticket 13 handoff, closed

The earlier handoff said `restore_version` makes no preview call because
`_core/previews.py` and the `Drive Node Preview` doctype did not exist. Both
exist now. Ticket 13 covered the restore path: `restore_version` deletes the
`Drive Node Preview` row and enqueues a render when the restore moves the head
blob, and keeps the preview when the target blob equals the current one
(`suite/drive/_core/versions.py:218-224`). The `HANDOFF, ticket 13` comment is
gone. Proved by `test_previews.test_version_restore_invalidates_only_when_the_head_blob_moves`
(unit), `test_version_restore_invalidates_the_preview_and_queues_one_render`,
and `test_version_restore_onto_the_same_blob_keeps_the_preview`.

Handoff to ticket 22, the version HTTP routes:

`list_versions` returns every row. §9.1 gives it no signature, and §11.2
requires `GET /nodes/<id>/versions` to return a cursor page under the §11.4
grammar. Ticket 22 owns the cursor and the limit, and a docstring marks the
line. A node with thousands of versions is unbounded until then.

Handoff to ticket 16 and ticket 22, the version MIME:

§10.1 declares `version_bytes` as `(stream, mime)` but no section consumes
the second element. Ticket 16 owns §10.1 and must decide whether that MIME
has a consumer or is dead weight in the contract. Ticket 22 owns the §11.2
version content route and is where the served type becomes observable. If
either decides the declared MIME must reach the client, the fix is a §3.4
MIME column plus a framework content-type override on `put_blob` and the S3
presigned URL. Drive cannot deliver it today on the S3 driver.

Handoff to ticket 16, the content contract:

`_content_spec` reads the `drive_content_types` hook directly and refuses a
missing, duplicate, or incapable registration. When ticket 16 lands
`_core/content.py` with a cached `spec_for(doctype)`, `_content_spec` should
delegate to it and keep those refusals. A comment marks the line. No
`drive_content_types` hook key exists yet, so every document version path
raises `DriveConflict` outside the test's registered fake.

No schema, patch, or migration changed. The scheduler hook is an additive code
registration. No migration, remigration, push, PR, install, or restart was
performed.
