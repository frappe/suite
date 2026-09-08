# 35 — Implement Cleanup with refusal gates and fixture tests

**What to build:** Prepare the later destructive Cleanup so unmet gates cause a complete refusal.

**Blocked by:** [29 — Complete Build records, accounting, and reporting](29-build-records-and-report.md)

**Status:** done

**Owner:** Suite migration (starting revision `6e6906176`, worktree
`integrate/drive-35-cleanup`, claimed files: `suite/drive/patches/cleanup/**`,
`suite/drive/patches/build/tests/test_dormancy.py`)

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

### 2026-09-09 — Cleanup implemented, unregistered, fixture-tested (commit `a6622e4b1`)

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

### 2026-09-09 — noted from Ticket 30's final review pass

`Drive Notification.activity` is `reqd: 1` per §3.11, but is left optional on
the live doctype for the Build release: `suite/drive/api/notifications.py`
and `drive_user_invitation.py` still insert legacy rows with no `activity`.
This gate's "drop the old notification columns" step (§14.10) is what makes
those writers go away; enforcing `reqd: 1` on `activity` belongs in the same
Cleanup change that removes them, not before. Not implemented here; recorded
so Cleanup's ordered-removal work picks it up explicitly instead of
rediscovering it. This does not close this ticket.
