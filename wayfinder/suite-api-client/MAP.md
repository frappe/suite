---
label: wayfinder:map
tracker: local-markdown
status: closed
---

# Map: Suite API client

## Destination

An implementation-ready design and migration plan for one Suite API client.
Generated operation references work directly with Vue composables and imperative calls.
Types, runtime behavior, and product policies are defined once.

Done when calling conventions, contract generation, runtime guarantees, product ownership,
and migration gates are settled. Another session can implement from the recorded decisions.

## Notes

- Scope chosen by Faris on 2026-10-06: redesign the client model, generated contracts,
  and runtime as needed. This effort is broader than a calling-syntax cleanup.
- The direction is Convex-inspired: generic composables and imperative client methods
  consume generated references directly. The caller convention is accepted below.
- The convention applies across Suite. Drive-specific request rules stay with Drive,
  behind the shared calling convention. Existing product behavior must remain correct.
- Planning only. Tickets answer questions. Implementation, production changes, and
  migration execution require a separate effort after this map is complete.
- Read `STANDARDS.md`, `ARCHITECTURE.md`, and `frontend/AGENTS.md` for relevant constraints.
  Use Wayfinder, grilling, and domain-modeling for decisions. Use research for external facts,
  prototype for caller examples, and technical-writing for records.
- Existing guidance is an input, not an automatic decision for this redesign:
  [Server-state client guideline](../unified-frontend/references/server-state-client.md)
  and [Shell and platform interface](../unified-frontend/tickets/002-shell-and-platform-interface.md).
  That guideline uses descriptors, places effects outside Python, and specifies non-throwing
  request results. Record any replacement rule here before updating its implementation.
- Current evidence, inspected at `7a6b419a4` on branch `forge/drive-layer`:
  `suite/composition/http.py` defines route metadata;
  `suite/composition/contract.py` exports per-owner contracts;
  `frontend/scripts/generate-contract.mjs` produces typed operations and validators.
  `frontend/src/platform/transport/index.ts` sends requests.
  `frontend/src/platform/server-state/index.ts` owns cache and mutation behavior.
  `frontend/src/apps/drive/client/operation.ts` adds share-link scope and entity details.
  Recheck these facts before implementation. The checkout already contains unrelated edits.
- Test the candidate convention against Suite account/people/settings calls, Drive
  node/share-link calls, and Mail calls. Treat unconverted products as migration inputs,
  not evidence that one product's behavior fits every product.
- Preserve historical maps. New decisions live in this map's tickets.
- Local tracker conventions match the existing maps: child tickets live in `tickets/`.
  Frontmatter contains `id`, `title`, `label`, `status`, `assignee`, and `blocked-by`.
  A frontier ticket is open, unassigned, and blocked only by closed tickets.
  Claim it for Faris before working. Append a resolution, close it, and index it below.
- Refer to maps and tickets by linked titles. Do not resolve more than one human decision
  ticket per session. Research tickets may run independently.
- Research uses GPT-6-Sol in an isolated `research/<name>` branch and worktree.
  Its asset and branch are linked from the research ticket. Never switch the shared checkout.
- Session preference, set by Faris on 2026-10-06: batch all remaining questions with
  recommended answers. Use working defaults for routine choices and surface consequential
  tradeoffs only. This replaces one-question rounds and the one-human-ticket-per-session
  limit for this effort. Keep dependencies and individual decision records intact.
- The [cross-product caller prototype](tickets/007-cross-product-caller-prototype.md)
  is available for review on `prototype/suite-api-client-20261006` at `3b8593f5e`.
  Its ticket links the live demo, standalone artifact, typed examples, and verification
  limits. Faris accepted the caller convention with “looks good” on 2026-10-06.
- Planning is complete. All decision tickets are closed. The migration handoff below
  defines the next implementation effort and its verification gates.
- Faris requested a spec and implementation plan through a GPT-6 Sol subagent.
  The [specification](suite-api-client-spec.md) consolidates the target caller contract.
  The [implementation plan](suite-api-client-plan.md) defines stages, file ownership, and checks.
  Tickets retain decision rationale. Implementation defaults in the spec are identified explicitly.

## Decisions so far

- [Convex client guarantees we can adopt](tickets/001-convex-client-guarantees.md): [research note](references/convex-client-guarantees.md) recorded. No client policy selected.
- [Operation kinds and generated references](tickets/002-operation-kinds-and-references.md) — explicit backend kinds and generated contracts, with client-owned policies attached once.
- [Suite API catalog and product ownership](tickets/003-catalog-and-product-ownership.md) — one namespaced catalog, lightweight owner API entries, and resource-oriented names.
- [Reactive and imperative call semantics](tickets/004-call-and-error-semantics.md) — awaited failures reject, one-shot reads fetch by default, and both forms share policies.
- [Cache effects and product request policies](tickets/005-cache-and-product-policies.md) — each mutation declares effects or none, with coverage checked and scope applied automatically.
- [Pagination, uploads, and exceptional operations](tickets/006-paging-uploads-and-exceptions.md) — typed paging and transfer helpers hide assembly, without adding an action kind by default.
- [Cross-product caller examples](tickets/007-cross-product-caller-prototype.md) — Faris accepted the prototype's shared references and caller convention; production guarantees still require verification.
- [Migration and verification contract](tickets/008-migration-and-verification.md) — staged conversion, temporary adapter removal gates, and behavioral, contract, import, and bundle checks.

## Not yet specified

None that blocks this design handoff. Inventory remaining editor and legacy API constraints
at implementation start, as required by the migration contract. Reopen a named decision
if real product behavior contradicts the accepted convention.

## Out of scope

- Adopting Convex as Suite's database or backend.
- Automatic database read-dependency tracking and Convex's synchronized query snapshots.
  This effort may change explicit cache policies and the existing realtime integration.
- Replacing Yjs collaboration, WebRTC media, or long-lived streams with ordinary queries.
  Decide how those operations relate to the client, without rebuilding their protocols.
- Redesigning product workflows, permissions, or HTTP resource URLs for unrelated reasons.
- Implementing the new client, migrating callers, deploying, or editing production data.
