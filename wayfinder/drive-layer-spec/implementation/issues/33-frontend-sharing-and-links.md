# 33 — Make sharing actions and relevant link credentials explicit

**What to build:** Let users distinguish grant removal from denial and send only link codes needed for the current operation.

**Blocked by:** [32 — Adopt Drive routes and explicit restore selection in the SPA](32-frontend-drive-adoption.md)

**Status:** superseded

Superseded 2026-09-09. Faris decided the Drive frontend is rebuilt from scratch inside a unified suite frontend, starting from route design. That effort gets its own wayfinder map. This ticket's acceptance criteria are input for that map, not work in this backlog.

**Owner:** Suite frontend Drive sharing

**Execution gate:** Part of the separate frontend adoption effort; execute after that scope is authorized.

**Source:** [Drive spec](../../drive-layer-spec.md), §5.10, §6.2–6.4; accepted decisions 5 and 7.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Present local grants and inherited access separately with the authorized explanation response.
- [ ] Provide separate remove-grant and deny-access actions, including public access. Never promise removal ended inherited access.
- [ ] After a write, refresh effective access and its source. Retain expired grants in management views as inactive.
- [ ] Remember each link’s target association. Use the active folder link for descendant browsing and omit codes from unrelated requests.
- [ ] Support password unlock, rotation, and distinct locked/expired states. Never silently trim an oversized credential set.
- [ ] Provide scoped credential selection to the content frontend through the declared interface.

## Verification

Run browser tests for inherited access after removal, explicit Alex deny, PUBLIC inheritance, unrelated requests, folder navigation, and the 20-item boundary.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
