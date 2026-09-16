# 14 — Keep comments, history, and personal lists on nodes

**What to build:** Keep discussions and personal navigation attached to the same node identity.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** done

All seven acceptance criteria are implemented and covered by named tests that
passed on the authorized test site.

**Owner:** Suite Drive record workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §3.6–3.11, §9.3–9.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Implement opaque comment anchors, replies, resolution, and EDIT-or-author modification checks.
- [x] Set comment author server-side. Store optional Guest display names and preserve via_link attribution.
- [x] Refuse writes on trashed content. Apply access checks before returning threads or activity.
- [x] Implement recents, favourites, notifications, unread count, and mark-read with caller isolation.
- [x] Visits update Recent without Activity. Clearing recents preserves favourites.
- [x] Grant and mention notifications point at Activity. Maintain one row per target user and activity.
- [x] Purge notifications before activity and remove other dependent records. No expiration-based grant cleanup.

## Verification

Run role, author, Guest, mention, isolation, visit, and purge-cascade tests against observable workflows.

## Completion evidence

Implemented 2026-09-06 on this branch. Suite revisions:
`9847e62d111851a5a019fa15a7a013a9ea63bd11` (comment, activity, and personal
record workflows), `cca6ca02407ffd638c250b3e619f417ddf7a9ff6` (comment lock
order and personal record edge cases), and the test corrections
`d186feb56`, `ec1a40371`, `952b4ac10`, `40330feb8`. Test revision
`bff1dde0631aced3b47396e2bde2b8386d37ede0` adds the notification uniqueness
tests and changes no production file. Reconciled at HEAD
`bff1dde0631aced3b47396e2bde2b8386d37ede0`.

Changed behavior:

- Comment threads attach to a content-document node by an opaque anchor of 1
  to 255 characters. Drive stores and returns it byte for byte and never
  interprets it.
- A thread carries replies plus a resolve stamp (`resolved`, `resolved_by`,
  `resolved_at`). The doctype enforces the stamp as all or nothing.
- Commenting needs the COMMENT role. Editing or deleting a comment needs READ
  plus either EDIT on the node or being the attributed author.
- A Guest author is identified by the deciding share link, so one Guest link
  cannot edit another link's comment.
- The comment author is always the server-side session principal. A
  caller-supplied display name is accepted only for `Guest` and is capped at
  140 characters.
- Every comment write records a `Drive Activity` row carrying the deciding
  `via_link`.
- All five comment write paths refuse a trashed node. Reads of a trashed node
  still return its threads.
- `threads` and `history` check current Read access before returning anything.
  `notifications` re-checks each linked node, so revoked access hides history
  retroactively.
- Mentions parse from three syntaxes, de-duplicate, and are filtered to
  existing `User` rows.
- Opening a node upserts a `Drive Recent` row and writes no Activity. Clearing
  recents never touches favourites.
- Adding a favourite needs Read. Clearing your own private mark does not, so an
  unreadable node cannot strand a star.
- Grant, revoke, and mention writes create one `Drive Notification` pointer per
  named user target, pointing at the Activity row. Group, `$PUBLIC`, and
  `$LINK` principals get none.
- `unread_count` and `mark_read` count and mutate only the caller's own
  currently visible pointers.
- Purge and root archive delete notifications before activity, then recents,
  favourites, previews, versions, grants, DAV rows, and legacy routes, then
  content, then nodes.
- Offboarding calls `discard_personal_records` to drop recents, favourites, and
  the inbox, which are keyed by email rather than by root id.
- Expired grants are never deleted by a job. They are retained and treated as
  inert at read time.

Review decisions recorded in the code:

- The node row is locked before the thread or comment row, matching
  `nodes.purge`. The reverse order deadlocks a reply against a concurrent
  purge.
- `recent_user_node` is a unique index, and a row that does not exist cannot be
  locked, so two concurrent opens both reach the insert and the loser adopts
  the winner's row.
- Removing a private favourite deliberately skips the Read check.
- Grants, comments, activity rows, and versions are deliberately kept on
  offboarding (§3.2, §9.5). `discard_personal_records` is idempotent, safe
  before Build creates the tables, and joins the caller's transaction.

### Site test results

Run on the authorized bench site against this branch. All five modules passed:

```text
bench --site slides.localhost run-tests --module suite.drive.tests.test_comments   # 8/8
bench --site slides.localhost run-tests --module suite.drive.tests.test_activity   # 8/8
bench --site slides.localhost run-tests --module suite.drive.tests.test_grants     # 24/24
bench --site slides.localhost run-tests --module suite.drive.tests.test_previews   # 27/27
bench --site slides.localhost run-tests --module suite.drive.tests.test_nodes      # 36/36
```

`test_comments` is 5 integration tests plus 3 unit tests in
`TestCommentLockOrder`. `test_activity` is 8 integration tests, run at this
HEAD. `test_grants`, `test_previews`, and `test_nodes` are regression runs:
grants now write notifications, purge now deletes preview rows, and purge
ordering moved. `test_previews` gained six render tests at this HEAD; see
[ticket 13](13-preview-lifecycle.md).

| Criterion | Tests |
|---|---|
| Anchors, replies, resolution, EDIT-or-author | `test_anchor_replies_resolution_and_server_authorship`, `test_author_can_edit_at_read_but_non_author_cannot`, `test_guest_name_and_link_attribution_distinguish_guest_authors` |
| Server-side author, Guest name, via_link | `test_anchor_replies_resolution_and_server_authorship`, `test_guest_name_and_link_attribution_distinguish_guest_authors` |
| Trashed writes refused, access-checked reads | `test_unreadable_threads_are_hidden_and_trash_refuses_writes`, `test_history_and_notifications_hide_currently_unreadable_nodes` |
| Personal lists and caller isolation | `test_personal_rows_and_mark_read_are_isolated_by_caller`, `test_losing_read_access_still_lets_the_owner_clear_their_own_mark`, `test_history_and_notifications_hide_currently_unreadable_nodes` |
| Visit without Activity, clear preserves favourites | `test_visit_upserts_recent_without_activity_and_clear_preserves_favourite` |
| Notifications point at Activity, one row per pair | `test_grant_write_creates_one_activity_pointer_for_target_user`, `test_mentions_are_deduplicated_and_point_to_activity`, `test_repeating_a_notification_for_the_same_pair_adds_no_second_row`, `test_a_missed_uniqueness_check_still_cannot_duplicate_a_notification` |
| Purge order, no expiry cleanup | `test_purge_orders_notifications_before_activity_callbacks_and_nodes` (unit), `test_purge_removes_notifications_before_activity_and_personal_rows`, `test_purge_removes_references_releases_quota_and_leaves_blob`, `test_expired_positive_deny_and_link_rows_are_retained_but_inert`, `test_expired_link_is_retained_and_returns_expired_not_locked`, `test_expired_unpassworded_link_also_returns_expired` |

The three `TestCommentLockOrder` unit tests pin the node-before-thread and
node-before-comment order and prove the stub restores the database binding.

### Notification uniqueness

`notify_users` enforces one row per activity and target user twice over: a
`frappe.db.exists` pre-check and the `notif_activity_user` unique index on
`(activity, to_user)`. `_insert_unique` swallows the duplicate error a
concurrent writer would raise. Both guards now have a test.
`test_repeating_a_notification_for_the_same_pair_adds_no_second_row` repeats
the pair inside one call and across calls: the pointer keeps its identity and
its read state, so a repeat cannot return a cleared item to the inbox, and a
later activity still notifies the same user.
`test_a_missed_uniqueness_check_still_cannot_duplicate_a_notification` blinds
the pre-check the way a concurrent writer does, which leaves the index as the
only guard.

### Remaining untested paths

None blocks a criterion:

- The EDIT arm of `_require_editor_or_author`. No test has an editor modify
  another person's comment. Both refusal directions are covered: an unreadable
  caller gets `DriveNotFound`, a readable non-author gets `DriveForbidden`.
- Reopening a thread, `resolve` called with the state it already has, and the
  `threads(resolved=...)` filter.
- The trashed-write refusal is asserted for `reply`, `resolve`, and
  `edit_comment`. `create_thread` and `delete_comment` share the same
  `_require_active` helper but are not asserted individually.
- `$GENERAL`, `$PUBLIC`, and `$LINK` grant targets producing no notification.
- `_require_person`, which gives a Guest no personal records.

### Deferred to other tickets

Neither `comments` nor `activity` is exported from `suite/drive/__init__.py`,
and no whitelisted API calls them, so these workflows are reachable only from
inside `suite/drive/`. The HTTP surface is ticket 22.

`Drive Notification` still carries legacy fields (`from_user`, `type`,
`message`, `notif_doctype`, `notif_doctype_name`, `entity_type`) and
`Drive Favourite` still carries a legacy `entity` link to `File`. The new
workflows write none of them, so rows the new path creates leave those columns
empty. Removing them is ticket 35.

Schema changed: `Drive Comment`, `Drive Comment Thread`, and `Drive Recent` are
new doctypes, and `Drive Favourite` and `Drive Notification` changed, so a site
needs `bench --site <site> migrate`. No patch and no data migration. No push,
PR, install, or restart was performed.
