# 21 — Expose node, upload, and root workflows through HTTP

**What to build:** Let clients create and organize nodes, upload bytes, and administer roots through the new route namespace.

**Blocked by:** [17 — Move Writer lifecycle and history into Drive](17-writer-adoption.md); [19 — Move Sheets lifecycle and collaboration checks into Drive](19-sheets-adoption-and-collab.md); [20 — Load composite references in authorized groups](20-composite-group-contract.md)

**Status:** ready-for-agent

**Owner:** Suite Drive HTTP

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../../wayfinder/drive-layer-spec/drive-layer-spec.md), §11.1–11.3, §11.5–11.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Implement the translator with PATH_INFO and cached request-path correction. Delegate authentication and response envelopes to Frappe.
- [ ] Declare allowed verbs and Guest access per route. Path ids override conflicting request arguments, and cmd cannot redirect dispatch.
- [ ] Wire node CRUD, copy, content, media, previews, uploads, and root usage/admin routes to shared workflows.
- [ ] Accept parent plus Active state for an explicit restore destination. Return a conflict when user choice is missing.
- [ ] Keep list and detail node shapes identical, with effective root id and opt-in access, breadcrumbs, and preview expansions.
- [ ] Implement batch outcomes with independent rollback per failed item and one activity per successful mutation.
- [ ] Map Drive errors and plain ValidationError to the specified status and v2 envelope. Authorize all byte egress.
- [ ] Keep raw blob creation inputs within the caller’s authorized workflow; client metadata cannot bypass byte validation or accounting.

## Verification

Run HTTP tests through actual request dispatch for session/API-key/Guest calls, streamed chunks, restore, mixed batches, and unauthorized egress.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
