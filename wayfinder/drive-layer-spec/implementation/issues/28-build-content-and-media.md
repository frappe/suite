# 28 — Migrate content history, comments, templates, and media

**What to build:** Preserve Writer, Slides, and Sheets content around their new Drive nodes.

**Blocked by:** [27 — Migrate root pairs, node trees, and grants](27-build-tree-and-grants.md)

**Status:** done

**Owner:** Suite migration and content adapters

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.2 steps 7–8 and 10, §14.6–14.7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Migrate Writer and Sheet versions with ids, sequence, pinning, labels, and blob bytes. Preserve the specified head-version relationship.
- [x] Migrate Writer and Sheets comments with opaque anchors and authors. Do not erase source content during Build.
- [x] Attach immutable document/node links. Adopt orphan documents into the specified Personal Root and report them.
- [x] Convert Slide media to one node per deck per blob. Rewrite sources, backgrounds, legacy paths, and dictionary posters.
- [x] Convert deck thumbnails to previews and both template types to granted template nodes.
- [x] Preserve resumability for body rewrites and newly created template documents. No duplicate media, comments, or versions after rerun.
- [x] Report state disagreements with File as the accepted source. Keep old fields available through the Build release.

## Verification

Run per-app migration fixtures and a second identical run. Compare document bodies, bytes, links, template grants, and every reported count.

## Completion evidence

All seven acceptance criteria are built and proved. An independent final
review audited the whole delta again, found nine defects, fixed each one with
a regression test, and reran every gate. The site-free Build package passes
675 cases. The serialized site gate on `slides.localhost` passes all listed
modules. Build stays dormant: nothing registers it, nothing calls it, and
nothing runs at import.

Agents wrote the production modules, the Slides media repair, and the test
modules named below. The final reviewer audited the delta, proved each defect
red before fixing it, and ran every gate recorded here.

### Revisions

- Ticket 27 baseline: `fafd87d3867f1f7ac1107accb78868450ec48e08`.
- Implementation tip received for final review: `ecdf3d9ab`.
- Reviewed code tip: `3b67e96b9`, on `review/drive-28-site-final`. This
  closeout is the commit after it.
- The delta is 51 commits, 41 files, +12333 / -143.
- Integration target is `forge/drive-layer`. Nothing was merged or pushed.

### What was built

New Build modules: `content.py` (§14.2 step 10), `history.py` (step 7),
`comments.py`, `slides.py` and `slide_journal.py` (step 8), `templates.py`,
`content_mapping.py`, and the ports and state records behind them. Runtime
hardening landed beside them in `suite/writer/drive.py`,
`suite/writer/overrides/`, `suite/sheets/permissions.py`,
`suite/sheets/versioning/`, and `suite/drive/framework.py`
(`refuse_shared_child_rows`).

### Acceptance criteria and their proof

| Criterion | Proof |
|---|---|
| 1. Versions with ids, sequence, pinning, labels, bytes, head relationship | `test_history` (26 site-free); site `test_writer_ids_labels_and_bytes_survive_an_identical_rerun`, `test_sheet_payload_and_sparse_head_id_survive_an_identical_rerun`, `test_bulk_insert_keeps_every_explicit_source_id`, `test_version_blobs_are_private_ready_and_byte_exact`, `test_the_unique_version_index_refuses_a_second_row_at_one_sequence` |
| 2. Comments with opaque anchors and authors, source not erased | `test_comments` (21 site-free); site `test_writer_comment_authors_mentions_and_stamps_survive`, `test_sheet_comment_anchor_display_name_and_ids_survive`, `test_sources_survive_except_slide_bodies_and_new_links` |
| 3. Immutable links, orphans adopted into Personal Root and reported | `test_content` (42 site-free); site `test_the_content_link_is_reciprocal_and_the_pair_is_immutable`, `test_an_orphan_document_is_adopted_into_its_owner_personal_root` |
| 4. One media node per deck per blob; sources, backgrounds, legacy paths, dictionary posters rewritten | `test_slides` (58 site-free), including the nested `poster` dictionary at `test_slides.py:159`, `test_same_deck_attachment_repairs_only_an_unresolved_local_legacy_url`, `test_a_borrowed_background_resolves_to_the_adopted_node`; site `test_one_media_child_per_deck_and_blob` |
| 5. Thumbnails to previews; both template types to granted template nodes | `test_templates` (30 site-free); site `test_the_deck_preview_is_named_by_its_file_and_unique_per_node`, `test_a_thumbnail_a_slide_uses_is_also_a_media_child`, `test_a_slides_template_becomes_a_granted_node_and_a_reciprocal_link`, `test_templates_list_through_general_and_not_public`, `test_step_10_keeps_both_template_kinds_where_step_8_put_them` |
| 6. Resumability; no duplicate media, comments, or versions after a rerun | `test_slide_journal` (21 site-free); site `test_an_interrupted_version_run_resumes_without_duplicates`, `test_rollback_restores_the_exact_slide_columns`, `test_a_second_run_repeats_every_row_blob_grant_and_counter` |
| 7. State disagreements reported with File as the accepted source; old fields kept | `test_file_sheet_trash_disagreement_is_counted_without_repair`, `test_a_trashed_file_under_an_untrashed_sheet_also_disagrees`; site `test_sources_survive_except_slide_bodies_and_new_links` |

`test_a_second_run_repeats_every_row_blob_grant_and_counter` is this ticket's
Verification line. It compares the target rows, the blobs, every source
column, both document bodies, and every counter across two runs, and it
asserts the snapshot is not empty so neither equality can pass vacuously.

### Defects the final review found and fixed

Each was proved red before the fix and green after.

| Commit | Defect | Red evidence |
|---|---|---|
| `fd837613f` | The ticket 01 architecture gate was red at `ecdf3d9ab` and had not run in any ticket 28 pass. `refuse_shared_child_rows` was missing from the frozen `drive.__all__`, and two new debt entries had no owner or removal condition. | 2 of 7 gate cases failed |
| `21ce9abfd` | A history pass killed partway left a partial `versions_seen` beside the earlier pass's `report_at`. The comparison read "new history arrived", re-minted `report_at` to today, and swept every version written since the frozen census into `versions_to_thin`. | `AssertionError: '2024-04-02 00:00:00' != '2024-04-01 00:00:00'` |
| `3515d11b3` | Step 10 set `links_completed` before `_convert_content_shares`. A kill inside the mapper left a record claiming step 10 finished with no content share mapped, and §14.2 lets a rerun skip a complete record. | `AssertionError: True is not false` |
| `600e4cf08` | A `Writer Template` whose reciprocal link was blank passed step 10 as valid, so `Writer Document.node` stayed unset for good and no rerun revisited it. The Presentation branch already refused the same shape. | `AssertionError: BuildContentError not raised` |
| `1bae7953b` | The content registry fixture patched `frappe.get_hooks` with a shim taking `key`. Frappe's signature is `get_hooks(hook=None, ...)` and three framework call sites pass it by keyword, so any of them inside the block raised `TypeError` instead of reading the hook. | `frappe/utils/safe_exec.py:736`, `frappe/modules/utils.py:355`, `frappe/desk/doctype/global_search_settings/global_search_settings.py:72` |
| `8df74e49f` | Two comments claimed that taking every sheet keeps a migrated sheet's op log bounded. It does not. Behaviour is correct and unchanged; the comments were wrong. | See the retention risk below |
| `3cd60bb2d` | The borrowed media lookup widened its candidate index by `_aliases` but asked it with the raw body string. A site-absolute reference to a relative template `file_url`, and the reverse, adopted nothing and reported nothing. The slide body kept a raw path that stops resolving once the legacy File goes. | `AssertionError: 0 != 1` (three cases) |
| `a3bb6c18d` | A File that is both the deck thumbnail and a slide picture was excluded from media unconditionally. It got a preview only, the body had no node to point at, and the raw path stayed. §14.7 asks for both conversions. | `AssertionError: Lists differ: [] != ['cover']` site-free, and `['bldctacf7736am1'] != ['bldctacf7736am1', 'bldctacf7736am3']` on the site |
| `3b67e96b9` | `media_nodes_created` dropped by one on an identical rerun. Run 1 adopts a borrowed File and writes the node id into the body; run 2 reads the id, adopts nothing, and stopped counting a node that still stands. §14.9 counts the outcome, not the mint. | `AssertionError: 2 != 3` |

### The four post-review commits

All four are semantically correct and hide no production defect.

- `5220abf5d` compares a migrated stamp by its instant. `normalized_stamp`
  returns a non-stamp value unchanged, so a real mismatch still fails.
- `009972249` registers both specs for its own block and drops them again. It
  carried the `key`/`hook` latent bug, fixed at `1bae7953b`.
- `20da876e5` corrects an assertion that could never hold. It does not weaken
  the test: `assertEqual(self.node_row(name), before[name])` compares the whole
  node row across step 10, and `orphan_content_docs_adopted == 0` still detects
  an adoption.
- `ecdf3d9ab` expects `DriveForbidden`, which is what
  `drive.refuse_shared_child_rows` raises, and adds a control assertion that
  the refusal belongs to the share and not to the linked parent.

### Mutation check

Eleven mutants, applied in process with `unittest.mock.patch` so no file
changed. All eleven were killed.

```
history.exact_fields -> no-op                ->  1 of 26 fail
content.exact_fields -> no-op                ->  4 of 42 fail
slides._settled_nodes -> empty               ->  1 of 58 fail
slides._named_by -> always False             ->  1 of 58 fail
slides._named_rows -> exact only             ->  2 of 58 fail
comments._refuse_colliding_ids -> no-op      ->  1 of 21 fail
templates._missing_template_grants -> none   ->  3 of 30 fail
templates._valid_owner -> Administrator      ->  1 of 30 fail
content._validate_template_link -> no-op     ->  2 of 42 fail
content._validate_content_node -> no-op      ->  2 of 42 fail
slides._refuse_unreachable_children -> no-op ->  2 of 58 fail
```

### Commands and real results

Site-free, at `3b67e96b9`, with the bench interpreter and `frappe.init`
without `connect`:

```
test_history 26   test_content 42   test_slides 58   test_comments 21
test_templates 30 test_slide_journal 21 test_content_mapping 13
test_ports 83     test_dormancy 7
whole package discovery: Ran 675 tests ... OK
```

Serialized on `slides.localhost`. Every module printed `OK`.

```
suite.drive.tests.test_build_content                  21
suite.drive.tests.test_build_tree                     34
suite.drive.tests.test_build_storage                  12
suite.drive.tests.test_comments                        6 unit + 5 integration
suite.writer.tests.test_drive_adoption                27 unit + 76 integration
suite.writer.tests.test_ticket28_runtime              20
suite.sheets.tests.test_drive_adoption                70 integration + 59
suite.slides.tests.test_drive_adoption                30 unit + 71 integration
suite.sheets.versioning.tests.test_drive_guards       24
suite.sheets.versioning.tests.test_snapshot_policy     7
suite.sheets.versioning.tests.test_retention           7
suite.sheets.versioning.tests.test_save_snapshot       3
suite.sheets.versioning.tests.test_save_validation    16
suite.sheets.versioning.tests.test_cursor              5
suite.sheets.versioning.tests.test_ops_security        6
suite.drive.patches.build.tests.test_dormancy          7
suite.tests.test_architecture                          7
```

Wider regression modules, also serialized and green: `test_previews`
(15 + 14), `test_nodes` (13 + 25), `suite.drive.tests.test_content`
(53 + 49 + 3), `suite.sheets.tests.test_permissions` (14).

`bench run-tests` exits 1 on this bench even when green, so every result was
read from the `Ran`/`OK`/`FAILED` lines and not from the exit status.

Lint: `ruff 0.12.3 check` is clean over `suite/drive/patches/build`,
`suite/drive/tests/test_build_content.py`, and `suite/sheets/versioning`,
except one pre-existing `F841` at `suite/sheets/versioning/timeline.py:129`
that arrived in `b93dd9468`, before the ticket 27 baseline.
`ruff format --check` reports 59 files already formatted.

### Dormancy proof

Build must not run until tickets 29 and 30. Proved seven ways at `3b67e96b9`:

1. `suite/patches.txt`, `suite/hooks.py`, and `suite/modules.txt` are
   untouched by the whole delta, and none names `patches.build`.
2. No file under `suite/fixtures/` names it.
3. No `def execute` exists anywhere under `suite/drive/patches/build/`.
4. The package contains no `whitelist`, no `scheduler_events`, and no
   `enqueue`.
5. Parsing all 39 non-test modules under `suite/drive/patches/` finds no
   import-time effect: no bare expression, and no module-level call other than
   `frozenset` constants.
6. Importing all 19 Build modules after `frappe.init` without `connect`
   prints `db connected: False` and `frappe.local attrs added: []`.
7. `drive_content_types` is still `[]` in `suite/hooks.py`. No non-test module
   outside the package imports it; the single match is a comment.

`test_dormancy` (7) checks the same contract by globbing the package, so a
new module is covered without a list to maintain. A `bench migrate` proves
nothing about this ticket and must not be used as its gate.

### Decisions taken where the spec leaves a choice

- **No step 8 gate inside step 10.** `slides_completed` is
  `slides_deferred == 0`, and step 10 is what un-defers an orphan deck.
  Requiring step 8 to be complete first would deadlock the pair.
- **A body-named thumbnail keeps one node.** Every row the thumbnail group
  excludes carries the chosen blob, so dropping the whole exclusion still
  yields one media node per deck per blob.
- **The borrowed lookup widens the question, not the answer.** `_url_lookup`
  asks the database for each local path under both schemes and the
  scheme-relative form, because `media_files_by_urls` matches `file_url`
  exactly. A returned row is still matched on its own aliases, and a widened
  set naming two blobs is still refused as ambiguous.
- **A migrated Writer version restores as HTML.** A legacy
  `Writer Version.snapshot` is rendered Tiptap HTML and never parses as a JSON
  object, so the fork is the shape rather than a key spelling.

### Known residual risks

- **A linked sheet's `Sheet Op Log` grows without a bound.**
  `truncate_op_log` clears the backlog below the oldest surviving snapshot
  once, and that seq is frozen for a linked sheet, so later ops are out of its
  reach. Pruning them by the time backstop alone is not available, because
  `ops.between`, `ops.for_cell`, and `timeline` still read a linked sheet's op
  log. Cleanup (36) owns the disposal. Recorded in
  `suite/sheets/versioning/tasks.py`.
- **§4.9's Suite Admin is denied a linked sheet's child rows**, and
  `sheet_query_conditions` still exempts a System Manager from the `Sheet`
  list. Both are recorded in `suite/sheets/permissions.py` and close at ticket
  29, when `suite.drive.framework` answers and `is_drive_admin` is the one
  definition. Neither is reachable in this release: no sheet carries a `node`
  until Build runs.
- **`ContentConversion.begin_run` has no production caller.** It is symmetric
  with the tree and grant records. Ticket 29's entry point is expected to call
  it. Nothing in this release wipes `versions_seen` while keeping `report_at`.
- **Site residue blocks `suite.drive.tests.test_versions`.** An Active
  Personal `Drive Root` for `drive-version-user@example.com` (`avbcn9q7hd`,
  created 2026-09-08 05:35) makes `setUp` raise `DriveConflict`, so 10
  integration cases error. Both `test_versions.py` and `_core/roots.py` are
  unchanged by the whole delta, and no other module uses that address, so the
  row is aborted-run residue rather than a ticket 28 defect. It was left in
  place for its owner to remove.

### Site gate command set (completed)

```
TICKET_WORKTREE=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-28-site-final

env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module <module>
```

Run once per module in the list above, serially, with no other site runner
active. The job queues were emptied first: this bench runs no RQ worker, and
a full `short` queue makes any fixture that inserts a `User` raise
`QueueOverloaded`.
