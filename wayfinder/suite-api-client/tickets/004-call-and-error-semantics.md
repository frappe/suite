---
id: 004
title: Reactive and imperative call semantics
label: wayfinder:grilling
status: closed
assignee: Faris (Codex batched decision session, 2026-10-06)
blocked-by: [001, 002]
---

## Question

What observable behavior do Vue composables and imperative calls provide when consuming
the same generated reference?

Settle signatures and return shapes for reactive reads, reactive writes, one-shot reads,
and imperative writes. Cover reactive arguments, disabled reads, Vue scope disposal,
cache reuse versus fresh reads, in-flight deduplication, cancellation, and mutation completion.
Decide whether mutation results are callable, expose `run`, or use another small interface.

Settle failure behavior for each form: rejecting promises, result values, reactive error
state, and default feedback. Distinguish validation bugs from expected server refusals.
An imperative write must not accidentally bypass the behavior promised by its reactive form.
Choose Suite guarantees explicitly where Convex relies on backend guarantees we lack.

## Inputs

- [Map: Suite API client](../MAP.md)
- [Convex client guarantees we can adopt](001-convex-client-guarantees.md)
- [Operation kinds and generated references](002-operation-kinds-and-references.md)
- `frontend/src/platform/server-state/index.ts`
- `frontend/src/platform/transport/index.ts`
- [Server-state client guideline](../../unified-frontend/references/server-state-client.md)

## Comments

The proposed defaults and open questions are recorded in
[Remaining client decisions](../decision-round.md). Faris accepted them in the resolution below.

## Resolution

Faris accepted the batched recommendations on 2026-10-06.

- Reactive queries accept a generated reference plus typed reactive arguments or a getter.
  Queries expose data, fetching/loading state, and errors. A disabled state waits for
  prerequisites. Scope disposal removes the caller's observer.
- Reactive mutations return an object with `run`, `isPending`, and `error`.
  Do not make a callable function also carry reactive state.
- Awaited mutations reject on failure. The observer also exposes the error. Expected
  server refusals remain distinguishable from validation/configuration bugs. Remove
  the old behavior where a failed mutation resolves `undefined`.
- Reactive query errors are state. Awaited read or refetch calls reject on failure.
  Caller-local feedback can suppress the default mutation toast for an inline refusal.
  Feedback does not turn a failed request into a successful result.
- `client.query` obtains a server result by default. Cache reuse requires an explicit
  option. Reactive reads can display cached data immediately and revalidate as needed.
- Reactive and imperative forms share cache, in-flight coordination, and policies.
  Imperative mutations execute the same normalization, optimism, rollback, and effects.
- Successful mutation completion reconciles returned data and schedules affected refetches.
  It does not wait for every list request or promise a shared database snapshot.
- Preserve cancellation, existing challenge handling, and safe read retries. Do not add
  automatic write retries without backend idempotency support.
- Demonstrate signatures and reactive disposal in the caller prototype. Production
  race/cancellation behavior belongs in the migration's broad behavioral checks.
