# 14 — Keep comments, history, and personal lists on nodes

**What to build:** Keep discussions and personal navigation attached to the same node identity.

**Blocked by:** [11 — Move, copy, trash, and explicitly restore node trees](11-node-lifecycle.md)

**Status:** ready-for-agent

**Owner:** Suite Drive record workflows

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §3.6–3.11, §9.3–9.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement opaque comment anchors, replies, resolution, and EDIT-or-author modification checks.
- [ ] Set comment author server-side. Store optional Guest display names and preserve via_link attribution.
- [ ] Refuse writes on trashed content. Apply access checks before returning threads or activity.
- [ ] Implement recents, favourites, notifications, unread count, and mark-read with caller isolation.
- [ ] Visits update Recent without Activity. Clearing recents preserves favourites.
- [ ] Grant and mention notifications point at Activity. Maintain one row per target user and activity.
- [ ] Purge notifications before activity and remove other dependent records. No expiration-based grant cleanup.

## Verification

Run role, author, Guest, mention, isolation, visit, and purge-cascade tests against observable workflows.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
