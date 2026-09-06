# 13 — Show reusable previews without charging users

**What to build:** Render uploaded-file previews and accept app-supplied images with predictable lifecycle behavior.

**Blocked by:** [10 — Upload and replace files under Drive authority and quota](10-upload-and-quota.md)

**Status:** in-progress — one render branch unproved

Six of the seven acceptance criteria are implemented and covered by named
tests. The first stays unchecked: the video and PDF render branches have no
test. See [Open gap](#open-gap).

**Owner:** Suite Drive previews

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.5, §6.8, §9.2.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Generate a 512-pixel longest-side WebP for supported file MIME types, using existing render dependencies.
- [x] Reuse by immutable source_blob before rendering. Unsupported MIME types create no preview.
- [x] Accept document preview pushes under EDIT without touching content time or writing activity.
- [x] Invalidate on replace, retain on trash, copy references on copy, and remove on purge.
- [x] Protect against stale jobs publishing a preview for a replaced head.
- [x] Mint 15-minute URLs only for requested preview expansion. Previews never affect quota.
- [x] Add the daily missing-preview sweep for files only.

## Verification

Run preview tests with source reuse, replacement races, push authorization, lifecycle transitions, and signed URL expiry.

## Completion evidence

Implemented 2026-09-06 on this branch. Suite revisions:
`823076476f6048c6697e3e3e4788857c710ef112` (the lifecycle),
`eb7a38fde764fa54fa5e16b083a2c3146cbe0a86` (version restore invalidates the
preview), and `502e51f821e2c1e884751b77bbfa455fd43ce44e` (every enqueue goes
through the previews module). Reconciled at HEAD
`0ac59e257f7046a9f7e35e0f971eaf409f4ec99b`. No later commit changes
`_core/previews.py` or `tests/test_previews.py`.

Changed behavior:

- New `Drive Node Preview` doctype. One row per node, `node` unique.
  `source_blob` and `blob` are both `File Blob` links, so both count as GC
  references. The controller refuses a preview blob that is not a Ready,
  private WebP, and refuses a rendered row whose `source_blob` is not the
  node's current head.
- `render` looks for an existing preview with the same `source_blob` before it
  touches the driver. On a miss it renders a 512-pixel longest-side WebP and
  stores it as a private blob. `PREVIEW_LONGEST_SIDE` is 512. Pillow handles
  images, PyAV video, and pymupdf PDF, the same dependencies the legacy
  renderer uses.
- `RENDERABLE_MIMES` is an explicit set. An unsupported MIME writes no preview
  row at all.
- `_publish_rendered` re-reads the node under `for_update` and writes only
  while `Drive Node.blob` still equals the `source_blob` it rendered from, so a
  stale job cannot publish a preview for a replaced head. `render` repeats the
  check after a failed reuse publish and returns instead of rendering.
- `push_preview` accepts an app-supplied image for a content document under
  EDIT. It writes no node field, so `modified` and `content_modified` do not
  move, it writes no activity row, and it charges no bytes. A root refuses a
  pushed preview: `"preview"` joined `ILLEGAL_ROOT_OPERATIONS`.
- Lifecycle. Replace deletes the row and enqueues a render. Trash keeps the
  row. Copy copies the reference to the same preview blob after reviving it.
  Purge deletes the row, from node purge and from root purge. A version restore
  invalidates only when the restored blob differs from the current head; a
  restore onto the same blob keeps the preview.
- `preview_expansions` mints 15-minute signed `/f/` URLs, batched in one read,
  de-duplicated, and only for the nodes asked for. It returns `{}` for an empty
  list. `PREVIEW_TTL_SECONDS` is `15 * 60`.
- Previews never affect quota. No preview path calls `admit`, and
  `recompute_usage` sums nodes, versions, and reservations only.
- `suite.drive.jobs.sweep_missing_previews` runs daily. Its query matches
  Active files only, with a renderable MIME and a head blob, and skips
  documents. It also matches `pv.source_blob != n.blob`, so a row left behind
  by a writer that forgot the delete is repaired instead of staying invisible
  to the §9.2 `pv.name IS NULL` filter. It takes one bounded page of 500 with a
  cursor in cache.
- Every writer reaches the queue through `previews.enqueue_render`, never a
  `from ... import` alias, so one patch point covers all of them.

### Site test results

Run on the authorized bench site against this branch. All four modules passed:

```text
bench --site slides.localhost run-tests --module suite.drive.tests.test_previews   # 21/21
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes      # 36/36
bench --site slides.localhost run-tests --module suite.drive.tests.test_versions   # 17/17
bench --site slides.localhost run-tests --module suite.drive.tests.test_upload     # 34/34
```

`test_previews` is 8 unit tests in `TestPreviewContract` plus 13 integration
tests in `TestPreviews`. The other three are regression runs, because replace,
copy, purge, and version restore now call the previews module.

| Criterion | Tests |
|---|---|
| 512-pixel WebP | `test_render_makes_a_free_512_longest_side_webp` (image only), `test_renderable_mimes_are_an_explicit_sweep_safe_set` |
| Source reuse, unsupported MIME | `test_duplicate_source_reuses_the_preview_blob_without_rendering`, `test_unsupported_mime_writes_no_preview`, `test_a_lost_reuse_blob_renders_again_but_a_moved_head_does_not` |
| Push under EDIT | `test_push_needs_edit_and_does_not_touch_content_time_or_activity`, `test_a_root_refuses_a_pushed_preview` |
| Lifecycle transitions | `test_trash_retains_copy_shares_and_purge_removes_preview_reference`, `test_replacement_invalidates_and_a_stale_publish_cannot_restore_the_old_preview`, `test_version_restore_invalidates_the_preview_and_queues_one_render`, `test_version_restore_onto_the_same_blob_keeps_the_preview`, `test_version_restore_invalidates_only_when_the_head_blob_moves`, `test_file_creation_requests_render_after_its_writes` |
| Stale-job guard | `test_replacement_invalidates_and_a_stale_publish_cannot_restore_the_old_preview`, `test_a_lost_reuse_blob_renders_again_but_a_moved_head_does_not` |
| 15-minute URLs, no quota | `test_preview_expansion_is_explicit_batched_and_fifteen_minutes`, plus the unchanged `used_bytes` assertions in the render, push, and copy tests |
| Daily sweep, files only | `test_sweep_is_registered_once_as_a_daily_scheduler_event`, `test_the_sweep_query_repairs_stale_rows_and_skips_documents`, `test_gap_sweep_queues_only_active_supported_files_without_rows`, `test_the_sweep_repairs_a_row_left_behind_by_a_head_change` |

`test_schema_is_one_row_per_node_and_both_blobs_are_gc_references` and
`test_both_preview_blob_columns_are_gc_references` cover the §3.5 schema.

### Open gap

The first criterion stays unchecked. `_render_webp` branches three ways on
MIME: Pillow for images, PyAV for video, pymupdf for PDF. Only the Pillow
branch is rendered by a test. `video/mp4` and `application/pdf` appear in
`test_renderable_mimes_are_an_explicit_sweep_safe_set` as set membership, which
proves the sweep and the gate accept them, not that either produces a
512-pixel WebP. Closing this needs a fixture video and a fixture PDF through
`render`.

Smaller untested paths, recorded but not blocking a criterion:

- Sweep pagination. No test asserts the cursor advance, the wrapped flag, or
  the 500-row batch.
- `copy_preview` returning False when the preview blob is no longer revivable.
  `nodes.copy` ignores the return value, so such a copy silently gets no
  preview until the daily sweep repairs it.
- The root-purge delete site in `_core/roots.py` is covered by ticket 15's
  `test_archived_purge_removes_descendants_references_and_pair`, not by
  `test_previews.py`.
- The integration tests hardcode the sweep cursor cache key for
  `slides.localhost`, so they clean up on that site only.

### Deferred to other tickets

- `preview_expansions` has no production caller. The `?expand=preview` query
  wiring is ticket 21.
- `push_preview` is not in `suite/drive/__init__.py`. The facade exports
  reservation and root workflows only; node workflows are exported when their
  HTTP tickets land.

Schema changed: the `Drive Node Preview` doctype is new, so a site needs
`bench --site <site> migrate`. No patch and no data migration. The scheduler
hook is an additive code registration. No push, PR, install, or restart was
performed.
