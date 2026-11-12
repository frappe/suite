---
id: 001
title: Convex client guarantees we can adopt
label: wayfinder:research
status: closed
assignee: Faris (GPT-6-Sol research agent, 2026-10-06)
blocked-by: []
---

## Question

Which Convex client behaviors can Suite reproduce over its current HTTP and realtime
interfaces, and which require Convex's database or transactional subscription machinery?

Use current official documentation and source code. Cover typed function references,
operation kinds, reactive versus one-shot reads, cache reuse, mutation completion,
errors, retries after network failures, optimistic updates, and actions.
Separate confirmed behavior from proposed Suite behavior.

Produce one cited research note on an isolated research branch. Compare the findings
with Suite's transport and server-state implementation without changing source code.
State which decisions the facts constrain and which remain human choices.

The earlier discussion established generated references and automatic dependency tracking
as concepts. This research checks the execution guarantees behind those concepts.

## Inputs

- [Map: Suite API client](../MAP.md)
- [Convex React](https://docs.convex.dev/client/react/overview)
- [Convex JavaScript clients](https://docs.convex.dev/client/javascript/overview)
- [Convex overview](https://docs.convex.dev/understanding/overview)
- `frontend/src/platform/transport/index.ts`
- `frontend/src/platform/server-state/index.ts`
- [Server-state client guideline](../../unified-frontend/references/server-state-client.md)

## Research context

- Research branch: `research/suite-api-convex-20261006`.
- Research worktree:
  `/var/folders/_v/x3nxj3_n0jb0l5v6_h_6b5kr0000gn/T/suite-api-research-4a3busme/convex`.
- Research asset: `wayfinder/suite-api-client/references/convex-client-guarantees.md`
  on that branch. The agent copies the completed note into this map's `references/`
  directory and records its commit when resolving this ticket.
- Agent: GPT-6-Sol, delegated by the charting session after this claim.

## Resolution

[Convex client guarantees and the Suite boundary](../references/convex-client-guarantees.md) records the primary-source findings and compares them with Suite's current client. Typed references, read modes, cache reuse rules, error surfaces, optional optimism, and action kinds are client design choices. Automatic read-dependency tracking, synchronized query views, and safe retries of a write after a lost response need backend support. No Suite client policy was selected.

Research commit: `15a570fd1` on `research/suite-api-convex-20261006`.
