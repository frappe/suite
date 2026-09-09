# 35 — Implement Cleanup with refusal gates and fixture tests

**What to build:** Prepare the later destructive Cleanup so unmet gates cause a complete refusal.

**Blocked by:** [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** done

**Owner:** Suite migration (starting revision `6e6906176`, worktree
`integrate/drive-35-cleanup`, claimed files: `suite/drive/patches/cleanup/**`,
`suite/drive/patches/build/tests/test_dormancy.py`). Reopened on branch
`fix/drive-35-review-findings` (starting revision `5e6130d07`) to repair the
review findings below; same claimed files.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.16, §14.10.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement the three gates: every reachable Drive File migrated, GC discovery available, and legacy SPA callers removed.
- [x] Keep Cleanup unregistered and inactive during the Build release. Do not delete live schema or compatibility code now.
- [x] Implement the ordered removal contract for Drive-owned File rows, custom fields, property setters, obsolete doctypes, and content source fields.
- [x] Preserve framework attachments, in-place local bytes, permanent compatibility entries, and /dav.
- [x] Prepare legacy API removal and S3-prefix deletion for the later activation ticket. Never delete a currently referenced object.
- [x] Test refusal before each destructive phase, rerun behavior, and the required backup-based recovery procedure.
- [x] Account for intentional unmigrated/Removed sources explicitly. Missing reachable nodes must block activation.

## Verification

Run Cleanup against isolated fixtures only. Prove every missing gate leaves data unchanged and valid fixtures retain all referenced bytes.

## Completion evidence

### 2026-09-09 — 11 review findings repaired, verified (branch `fix/drive-35-review-findings`)

This entry supersedes every closeout below it. The 2026-09-09 "Cleanup
implemented" entry described real code and real tests, but review found 11
defects in both (listed in the "review found 11 defects" entry below). All 11
are fixed in production code and tests, on this branch, commits `ba2b2476a`
(reopen) and `220006721` (repair).

**What changed, by finding.**
1. `SiteLegacyFileRows.delete` issues a plain `frappe.db.delete`, never
   `frappe.delete_doc`. Proven by `test_site_ports.
   TestSiteLegacyFileRowsBypassesHooks` (spies on `frappe.delete_doc`,
   asserts it is never called).
2. New `TransactionGateway` port (`SiteTransactionGateway` over
   `frappe.db.commit()`, gated on `frappe.flags.in_test`). `run_cleanup`
   commits each phase before writing its checkpoint. Proven by
   `test_removal_order_and_resume.
   test_each_phase_commits_before_its_checkpoint_is_written` and
   `test_a_commit_failure_leaves_no_checkpoint_for_that_phase` (a failed
   commit leaves the phase not-completed, and idempotently re-runs on the
   next call).
3. `phase_file_rows` persists the name census and a `DiskSettingsSnapshot`
   once, before deleting rows. Phases 7 and 8 read only that snapshot.
   Proven by `test_the_name_census_and_settings_snapshot_are_persisted_
   before_deletion` and, more strongly, by
   `test_never_reads_the_live_disk_settings_port`/`test_reads_the_census_
   and_settings_from_state_not_a_live_rescan`, which assert the live
   `DiskSettingsSnapshot` port's read counter stays at zero.
4. New `ClientCallerEvidence` port (`SiteClientCallerEvidence` scans the
   checked-in SPA source tree for `suite.drive.<name>` literals). Gate 3
   now blocks on that evidence, not on the forwarder classification label
   phase 6 reads to decide what to remove. Proven by
   `test_gate_legacy_callers.
   test_a_forwarder_label_alone_does_not_refuse_once_evidence_clears_it`
   and `test_a_forwarder_still_referenced_by_evidence_refuses`.
5. Gates run once per `run_cleanup` call, not once per phase. Proven by
   `test_gates_run_once_per_call_not_once_per_phase`.
6. New `readiness.run_preflight`, called before the gates, probes every
   port a pending phase needs — including the honestly-`NotImplementedError`
   ones — with a no-op payload. Proven by
   `test_an_unready_port_refuses_before_any_phase_runs` and
   `test_preflight_and_gates_run_before_the_first_mutation`.
7. `SETTINGS_DROPPED_COLUMNS`'s `Drive Disk Settings` entry now lists all
   ten §3.13 fields (`DISK_SETTINGS_FIELDS`); `CONTENT_DROPPED_COLUMNS`'s
   `Sheet` entry adds `trashed_on`/`trashed_by`; `Writer Document.versions`
   drops before `Writer Doc Version`; `SchemaGateway.remove_permission_hooks`
   is a new prepared (not executed) source-edit port for step 3's now-dead
   `suite/hooks.py` entries. `suite/hooks.py` itself is untouched. Proven by
   `test_drops_title_trashed_and_the_settings_columns_only`,
   `test_writer_document_versions_drops_before_writer_doc_version`, and the
   corresponding exhaustive field list in `suite.drive.patches.build.tests.
   test_dormancy.RETAINED_FIELDS`.
8. `SiteContentRows.strip_sheet_comments` decodes the gzip envelope before
   inspecting it, removes only the top-level `comments` key, and pages in
   `batch_size` chunks. Proven directly (not through a fake) by
   `test_site_ports.TestSiteContentRowsCommentStripping` (6 cases: targeted
   key only, gzip round trip, no-op on a sheet with no comments, null-data
   skip, pagination, stall guard).
9. S3 enumeration and deletion stay batch-bounded and dangerous-prefix-
   checked (unchanged from the prior implementation, still covered by
   `test_removal_phases.TestPhaseS3Prefix`); `SiteS3LegacyPrefix.
   enqueue_delete`'s docstring states the re-check-at-execution contract
   for the worker Ticket 36 must write.
10. `require_authorization`'s refusal messages already matched §14.11
    ("the only rollback past this point is a database restore... and
    nothing smaller"); the misleading "Ticket 36 owns the two
    `NotImplementedError` ports" wording is corrected below to name all of
    them.
11. New `test_full_run.py` runs a complete `run_cleanup` chain against one
    fixture and asserts final state directly: rows gone, custom
    fields/property setters/doctypes gone, permission-hook removal planned,
    `Writer Document.versions` dropped first, docshares/ycomments/comments
    cleared, all ten disk-settings fields gone, only forwarder-labeled API
    names and the wildcard prefix removed, only Drive-owned sidecars gone,
    referenced S3 objects untouched. New `test_site_ports.py` exercises the
    real `Site*` classes directly (not fakes) for every port whose
    correctness was not obvious from its contract alone.

**Commands and results (this worktree, `PYTHONPATH` pointed at it, bench's
Python 3.14 interpreter):**
- `python -m unittest discover -s suite/drive/patches/cleanup/tests -t .` →
  **107/107 passed**, no site, fakes and direct port spies only (up from 69;
  +19 in `test_site_ports.py`, +2 in `test_full_run.py`, +16 in the updated
  phase/gate/resume/dormancy files).
- `frappe.init(site="slides.localhost")` (no connect), `frappe.local.db`
  mocked per `verify-suite-backend-without-a-database`'s recipe, then
  `unittest` over every `suite/drive/patches/{build,cleanup}/tests` module
  plus `suite.tests.test_architecture` and
  `suite.drive.tests.test_build_{content,storage,tree}` → **925/925 passed**,
  zero import failures.
- `python -m py_compile` over every new/edited file → clean.
- `ruff check`/`ruff format` (pre-commit's pinned `v0.12.3`) → clean after
  one import-sort autofix and a reformat; re-ran the full Cleanup suite
  after to confirm the reformat changed nothing behaviorally.
- Eight mutations, each applied, confirmed caught by a test failure, then
  reverted: hookful `File` delete (`test_uses_a_plain_delete_never_
  delete_doc` fails, spies show `delete_doc` called); checkpoint written
  before commit (`test_a_commit_failure_leaves_no_checkpoint_for_that_phase`
  fails); gate 3 reverted to classification-only (2 `test_gate_legacy_
  callers` cases fail); phase-1 census write removed (census test errors on
  `None`); `phase_s3_prefix` reverted to a live settings read (5
  `TestPhaseS3Prefix` cases fail); the schema-source-edit preflight probe
  removed (`test_an_unready_port_refuses_before_any_phase_runs` errors
  uncaught); comment stripping reverted to a recursive, non-decoding scrub
  (2 `test_site_ports` cases fail); the S3-backed thumbnail path reverted to
  swallowing `AttributeError` (`test_s3_enabled_raises_honestly_never_
  swallows_the_error` fails).

**Still not live, on purpose (unchanged from the prior closeout — this is
Ticket 36's scope, not a gap in this one).** Nothing here runs against a
real site, `bench migrate` was never invoked, and no live data, schema, or
S3 object was touched. `suite.drive.patches.cleanup.tests.test_dormancy`
still proves the package has no `execute()`, no scheduler entry, and no
`patches.txt`/`hooks.py` reference. Ticket 36 still owns, as source-code
changes with no honest fixture-testable "real" implementation possible
under this ticket: `SiteForwarderRegistry.remove`/`remove_wildcard_prefix`
(editing `suite/drive/http/shims.py`/`suite/hooks.py`),
`SiteSchemaGateway.drop_child_table_field`/`remove_permission_hooks`
(editing shipped doctype JSON/`suite/hooks.py`), and
`SiteS3LegacyPrefix.list_prefix`/`enqueue_delete` plus
`SiteThumbnailStore`'s S3-enabled path (a real bucket client `Drive Disk
Settings` has never had). `readiness.run_preflight` now refuses activation
against any of these before phase 1 runs, on any site where they would
matter (S3-backed ports are only probed when a site's disk settings show
`enabled`).

### 2026-09-09 — Cleanup implemented, unregistered, fixture-tested (commit `a6622e4b1`) — INVALIDATED, see above

**What shipped.** `suite/drive/patches/cleanup/` (`ports.py`, `state.py`,
`environment.py`, `gate.py`, `removal.py`, `patch.py`, `__init__.py`, plus
`tests/`), following `suite/drive/patches/build/`'s ports/environment
architecture. No `execute()` anywhere in the package; `run_cleanup(env)` is
the only entrypoint and nothing in `patches.txt` or `hooks.py` names it
(`suite.drive.patches.cleanup.tests.test_dormancy.TestCleanupIsNotRegistered`,
and `suite.drive.patches.build.tests.test_dormancy.TestCleanupIsNotRegistered.
test_the_package_exists_but_stays_unwired`, which now confirms the package
is real code with no `execute` on any of its modules, replacing the old
"cleanup.py does not exist" assertion that stopped meaning anything once
this ticket started).

**Gates (`gate.py`), all read-only, all fail closed:**
- `check_gate_reachable_nodes` recomputes reachability live via its own
  chain-climb (`climb`/`_settle`/`_advance`/`_finish`), independent of
  `suite.drive.patches.build.state.BuildState` — proven by
  `test_gate_reachable_nodes.test_a_stale_build_report_is_never_consulted`.
  Removed rows and unreachable Home attachments never block
  (`test_a_removed_row_with_no_node_does_not_block`,
  `test_an_unreachable_home_attachment_does_not_block`); a reachable row with
  no node always does (`test_a_reachable_file_with_no_node_refuses`).
- `check_gate_gc_discovery` calls `frappe.storage.gc.blob_reference_columns()`
  and requires all four `(doctype, fieldname)` pairs from §3.17; import/call/
  malformed-row errors fail closed (`test_gate_gc_discovery.py`, 6 cases).
- `check_gate_legacy_callers_removed` requires zero `FORWARDER`-classified
  names in `suite.drive.http.shims.CLASSIFICATION`; `PERMANENT`/`RETAINED`
  never block (`test_gate_legacy_callers.py`, 5 cases).
- `require_authorization` is a fourth, separate refusal
  (`env.authorized` and `env.backup_ref`) that holds even after all three
  gates pass (`test_gates_combined.py`, `test_removal_order_and_resume.
  TestRunCleanupRefusals`).

**Ordered removal contract (`removal.py`), §14.10 steps 1–8, one phase
function each,** wired in order by `patch.PHASES` and run resumably by
`patch.run_cleanup`: file rows → custom fields/property setters → legacy
doctypes + notification columns + `Drive Notification.activity` becomes
`reqd: 1` (closing the addendum recorded above) → content history →
content/settings fields → legacy API forwarders + wildcard prefix →
thumbnail sidecars → S3 legacy-prefix job. Every phase checkpoints via
`CleanupState` (atomic write, corrupt-file quarantine, mirrors
`suite.drive.patches.build.state`) only on completion, and gates are
re-run before every phase, not just once
(`test_removal_order_and_resume.TestRunCleanupOrder.
test_gates_rerun_before_every_phase`).

**Preservation, checked directly, not assumed:**
- Home/framework attachments: never enumerated as Drive-owned
  (`test_removal_phases.TestPhaseFileRows.test_home_attachments_are_never_deleted`).
- Permanent/retained API names and `/dav/`: only `FORWARDER`-classified
  names and the one legacy wildcard prefix are removed; `permanent`,
  `retained`, and `retired` classifications and `/dav/` survive in the same
  assertion (`test_removal_phases.TestPhaseLegacyApi.
  test_only_forwarder_names_are_removed`).
- Referenced S3 objects: `phase_s3_prefix` lists candidates, then re-reads
  `File Blob` references immediately before enqueuing, closing the
  re-reference race explicitly
  (`test_a_reference_created_between_listing_and_the_recheck_survives`).
  Empty, bucket-root, and private/public-parent prefixes are refused before
  any listing (`refuse_dangerous_prefix`, 3 cases).
- In-place local legacy bytes and thumbnail sidecars outside the Drive-owned
  set: untouched by `phase_thumbnails`
  (`test_only_drive_owned_sidecars_are_deleted`); the S3 phase only ever
  enqueues a job for keys already confirmed unreferenced, never deletes
  synchronously.

**Crash-safety.** Phase 1's deletion order only matters for Removed
subtrees (the one case with no `Drive Node` fast path); an earlier
depth-from-`climb()` design was found flawed by manual trace (two rows at
different true depths could memoize to equal values) and replaced with
`_deepest_removed_first`, a dedicated depth-through-Removed-rows-only
function, re-verified by hand against the same fixture
(`removal.py`'s docstring on `collect_drive_owned_names` records the
reasoning). `test_a_crash_partway_leaves_remaining_chains_intact_for_resume`
and `test_removal_order_and_resume.TestRunCleanupResume` cover a mid-phase
crash and resume, a completed-phase no-op rerun, and corrupt-state
quarantine.

**Commands and results (this worktree, `PYTHONPATH` pointed at it and at
`apps/frappe`, bench's Python 3.14 interpreter):**
- `python -m unittest discover -s suite/drive/patches/cleanup/tests -t .` →
  **69/69 passed** (no site, fakes only).
- `frappe.init(site="slides.localhost")` (no connect) then
  `unittest discover` over `suite/drive/patches/build/tests` → **811/811
  passed**, including the strengthened `TestCleanupIsNotRegistered` and the
  unchanged `TestCleanupHasRemovedNothingYet` (proving §14.10's deletion
  list is still whole on the live doctype JSON/fixtures, one release before
  Cleanup may cut it).
- `suite.tests.test_architecture` → **7/7 passed**.
- `python -m py_compile` over every new/edited file → clean.
- `ruff check`/`ruff format` (pre-commit's pinned `v0.12.3`) → clean after
  one import-sort autofix and formatting; re-ran the full cleanup suite
  after to confirm the reformat changed nothing behaviorally.
- Three manual mutations, each applied, confirmed caught by a test failure,
  then reverted byte-identical (diffed against a backup copy before
  restaging): gate 1 short-circuited to never refuse (5 failures + 1 error
  across `test_gate_reachable_nodes`/`test_gates_combined`); Phase 1's
  ordering replaced with unordered `dict` iteration (2 failures in
  `test_removal_phases`, the crash-resume and children-first cases);
  `require_authorization` call deleted from `run_cleanup` (2 failures in
  `test_removal_order_and_resume`).

**No blockers.** Nothing here runs against a real site, `bench migrate` was
never invoked, and no live data, schema, or S3 object was touched. Ticket 36
still owns wiring `run_cleanup` into `patches.txt`/hooks and implementing
the two `NotImplementedError` ports (`SiteForwarderRegistry.remove`/
`remove_wildcard_prefix`, `SiteS3LegacyPrefix.list_prefix`/`enqueue_delete`),
which are source-code changes rather than runtime operations and so have no
honest fixture-testable "real" implementation to write under this ticket.

### 2026-09-09 — review found 11 defects; closeout above is invalidated

A review of commit `a6622e4b1` (recorded in docs commit `5e6130d07`) found 11
defects in production code and tests, not just in the evidence prose above.
The closeout above no longer describes what shipped and must not be trusted
until superseded. Findings, by area:

1. `SiteLegacyFileRows.delete` used `frappe.delete_doc`, which runs
   `File.on_trash`/`after_delete` and would delete linked Writer/
   Presentation/Sheet bodies, local bytes, and satellite rows exactly when
   step 1 must preserve them.
2. No transaction port existed. A checkpoint could be written with no
   guarantee the phase's own writes had committed first.
3. Phase 1 did not persist the Drive-owned name census or the disk-settings
   snapshot before deleting rows; steps 7 and 8 re-queried tables and
   columns already gone by the time they ran.
4. Gate 3 read the same forwarder classification label that phase 6 acts
   on, so it could never find anything left to block once it "passed."
5. Gates re-ran once per phase (up to 10 full `File` scans a run) instead
   of once per call.
6. No preflight step existed for the ports that honestly raise
   `NotImplementedError`; an activation attempt would destroy rows in
   phases 1–5 before failing in phase 6, 7, or 8.
7. `Drive Disk Settings`' dropped-field list named 5 of §3.13's 10 fields;
   Sheet's dropped-column list omitted `trashed_on`/`trashed_by`.
8. Sheet comment stripping recursively deleted any key spelled "comment"
   anywhere in `sheets_data`, and never decoded the gzip envelope first, so
   compressed rows were a silent no-op.
9. The old `SiteThumbnailStore` S3 path caught `AttributeError` from a
   nonexistent `get_s3_connection()` and returned a quiet "not deleted."
10. §14.11's evidence and Ticket 36 hand-off wording needed correcting.
11. No test exercised a full `run_cleanup` chain's end state, and no test
    exercised the real `Site*` ports directly (only fakes).

This branch (`fix/drive-35-review-findings`) repairs all 11 in production
code and tests. See the closeout below for what actually changed, superseding
everything above it.

### 2026-09-09 — noted from Ticket 30's final review pass

`Drive Notification.activity` is `reqd: 1` per §3.11, but is left optional on
the live doctype for the Build release: `suite/drive/api/notifications.py`
and `drive_user_invitation.py` still insert legacy rows with no `activity`.
This gate's "drop the old notification columns" step (§14.10) is what makes
those writers go away; enforcing `reqd: 1` on `activity` belongs in the same
Cleanup change that removes them, not before. Not implemented here; recorded
so Cleanup's ordered-removal work picks it up explicitly instead of
rediscovering it. This does not close this ticket.
