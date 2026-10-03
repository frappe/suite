# 32 — Adopt Drive routes and explicit restore selection in the SPA

**What to build:** Move Drive navigation and file operations to the new API with a clear restore destination choice.

**Blocked by:** [30 — Verify the complete backend before migration rehearsal](30-backend-integration-review.md)

**Status:** superseded

Superseded 2026-09-09. Faris decided the Drive frontend is rebuilt from scratch inside a unified suite frontend, starting from route design. That effort gets its own wayfinder map. This ticket's acceptance criteria are input for that map, not work in this backlog.

**Owner:** Suite frontend Drive

**Execution gate:** Frontend implementation is a separately scoped adoption effort. Confirm its execution scope before an AFK backend runner claims this ticket.

**Source:** [Drive spec](../../drive-layer-spec.md), §1 frontend follow-up; §8.8; §11.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Inventory current Drive callers and replace node, list, upload, content, version, comment, activity, and notification calls.
- [ ] Use opaque cursors correctly, including empty filtered windows. Request only required expansions.
- [ ] Handle create/replace upload flows and display distinct validation, access, conflict, and quota failures.
- [ ] When restore needs another location, present eligible same-root destinations and submit parent plus Active state.
- [ ] Cancel leaves the item trashed. Show an explicit error if access changes before submission.
- [ ] Expose cross-product client workflows through the declared Drive frontend interface.
- [ ] Use the existing Frappe UI patterns and load the applicable UI skill when implementing. Cover empty, loading, error, and focus states.

## Verification

Run frontend tests and browser flows for pagination, upload, mixed batch outcomes, explicit restore, cancellation, and access changes.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
