# 22 — Expose sharing, views, history, and comments through HTTP

**What to build:** Complete the new API surface for sharing and node-associated records.

**Blocked by:** [21 — Expose node, upload, and root workflows through HTTP](21-http-node-workflows.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §11.2–11.4, §11.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Wire grant listing, write, revoke, revoke-below, rotation, password unlock, and website link resolution.
- [ ] Expose explanations through GET node grants with principal=. Require MANAGE on the target before evaluating another principal.
- [ ] Freeze explanation response shape in adapter tests and client fixtures. Preserve resolver provenance and expired-row semantics.
- [ ] DELETE removes the local grant only; PUT role 0 explicitly denies. Invalid grant arguments return HTTP 400 without mutation.
- [ ] Wire all specified views, version operations, threads/comments, activity, visits, favourites, and notifications.
- [ ] Keep pagination and expansion semantics consistent across endpoints. Notification and personal-list actions remain caller-scoped.
- [ ] Exercise every route-table entry and all specified error classes, including locked versus expired links.

## Verification

Run route-table coverage and response-shape tests, with negative authorization cases for explanation, versions, comments, and notifications.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
