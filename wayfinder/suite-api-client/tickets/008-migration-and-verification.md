---
id: 008
title: Migration and verification contract
label: wayfinder:grilling
status: closed
assignee: Faris (Codex handoff session, 2026-10-06)
blocked-by: [007]
---

## Question

What migration and verification rules make the accepted client design implementable
without leaving multiple permanent ways to call Suite APIs?

Decide the adoption sequence, temporary compatibility interfaces, their removal conditions,
and the evidence needed before retiring descriptors or direct transport calls.
Account for generated and legacy callers, outside-component sessions, and cross-product use.
Decide what changes to existing standards and import checks follow the accepted design.

Define broad behavioral gates through the real client interface: typed references,
reactive arguments/disposal, cache changes, errors, cancellation, scope, and upload behavior.
Include contract drift, import boundaries, and startup bundle size where relevant.
Do not invent tests by copying implementation logic.

The resolution specifies a migration plan and handoff requirements. It does not execute
the migration or create a production implementation backlog during charting.

## Inputs

- [Map: Suite API client](../MAP.md)
- [Cross-product caller examples](007-cross-product-caller-prototype.md)
- `frontend/AGENTS.md`, `STANDARDS.md`, `ARCHITECTURE.md`
- Existing contract checks, import-boundary checks, and relevant tests

## Comments

Faris accepted staged migration with explicit old-interface removal gates on 2026-10-06.
Begin with generated Suite, Drive, and Mail callers. Legacy calls follow as they gain
contracts. Contract drift, import rules, bundle size, and broad client behavior are gates.
Finalize the migration handoff after [Cross-product caller examples](007-cross-product-caller-prototype.md)
is accepted. That prerequisite was met when Faris said “looks good”.

## Resolution — 2026-10-06

Faris accepted staged migration and explicit removal gates in the batched decision round.
He then accepted the caller prototype. The following rules complete that migration handoff.
They specify implementation order and evidence, rather than authorize production changes.

### Accepted implementation inputs

Use the closed decisions in [Map: Suite API client](../MAP.md) as the design authority.
Use the prototype for caller shape and observed behavior, not as production runtime code.
Its fixture policies do not describe real visit, settings, link, or upload behavior.

At implementation start, inventory callers and policies at the actual checkout revision.
Include generated operations, descriptor factories, direct transport calls, legacy resources,
editor sessions, owner workflows, and non-JSON operations. Record each operation's owner,
kind, public name, effects, request scope, and consumers. Do not guess kind from HTTP method.

Preserve HTTP URLs, stable operation IDs, backend permissions, and existing product workflows.
The Suite architecture owner owns the engine, generator, composition, and enforcement.
Each product owner owns its policies, workflow callers, and product verification.

### Adoption sequence

1. Extend route metadata and generation with explicit kinds and public reference names.
   Keep server facts in the contract and client policies with their owners.
   Generate Python-derived JSON and TypeScript together. Reject duplicate names and missing metadata.
2. Build the product-neutral engine and lightweight owner API entries.
   Expose `api`, `client`, and composables through `@/api`, assembled by composition.
   Register policies once. Both caller forms use one cache and policy pipeline.
   Validate a real Suite account/people read, Mail inbox read, and Drive read/rename before wider conversion.
3. Convert generated Suite, Drive, and Mail callers in coherent groups.
   Convert error handling with each group because failed awaited mutations now reject.
   Include outside-component callers, editor Drive calls, share links, lists, paging, and transfers.
   Replace direct requests for ordinary operations with `client.query` or `client.mutation`.
4. Add contracts for remaining legacy Suite APIs, then convert their callers through the same client.
   Preserve named owner workflows for composite work and separate collaboration/media protocols.
   Keep any uncovered legacy paths in a precise inventory with an owner and removal condition.
5. Remove compatibility interfaces as their consumers reach zero.
   Update examples and enforcement in the same changes. Finish when callers use the accepted convention
   and the checks below pass, with remaining protocol exceptions explicitly documented.

### Temporary compatibility and removal gates

| Temporary interface | Allowed scope | Removal condition |
| --- | --- | --- |
| Old descriptor factories and query/mutation builders | Unconverted generated callers only, backed by the shared engine | No production imports or invocations remain, and replacement behavior checks pass |
| Old non-throwing mutation behavior | A clearly named adapter for unconverted consumers | All consumers handle rejected writes, with success paths checked after refusals |
| Caller-level `driveOperation` wrapping | Existing callers pending Drive policy registration | Real scope/challenge checks pass and no ordinary callers construct the wrapper |
| Direct `transport.request` | Transport internals, owner protocol implementations, and inventoried legacy callers | Ordinary generated callers reach zero first, then contracted legacy callers reach zero |
| Legacy `createResource` API calls | Existing inventoried consumers only | Their endpoints have contracts, consumers migrate, and obsolete dependencies are removed |

Do not create a second cache, duplicate request coordination, or duplicate feedback behind adapters.
The new API never adopts non-throwing write semantics to accommodate an old consumer.
Do not add new ordinary callers to legacy paths. A new unsupported API gains a contract first.
Internal transport use for byte transfers is not a permanent alternate caller API.

### Broad behavior gates

Use the public client interface and observable UI outcomes.
Stub the network for deterministic client scenarios, not the client's own cache or policy methods.
Use real site flows for permission, scope, and protocol claims.

| Scenario | Independent expectation |
| --- | --- |
| Cross-product typing | Query/mutation kinds, required inputs, output fields, paging, and transfer capabilities accept valid callers and reject invalid ones |
| Reactive arguments and lifetime | Changed arguments show the matching result. Disabled/disposed callers stop observing. Late replies cannot replace the current selection |
| Shared reads and freshness | Concurrent equivalent reads share work. Default imperative reads fetch. Explicit cache reuse can return an older result. Reactive reads display cache and revalidate |
| Mutation effects and refusal | Reactive and imperative writes reconcile the same detail/list data. A refusal rejects, records error state where applicable, rolls back optimism, and skips success behavior |
| Concurrent writes and refetch | An older reply or failed optimistic write cannot erase a newer successful change. Completion reconciles data and schedules refetch without awaiting every list |
| Scope and identity changes | Named and covered Drive nodes select the correct scope. Challenges and final outcomes retain existing behavior. Identity or access changes cannot expose previous-scope cache data |
| Cancellation and retries | Stopping one observer cannot corrupt another consumer's result. Canceled or superseded work cannot publish stale data. Read retry remains safe. Writes are not automatically retried without idempotency |
| Paging and bytes | Cursor exhaustion, argument changes, list effects, transfer progress/resume/cancel/failure, and byte downloads preserve existing product behavior |
| Realtime and owner effects | Existing realtime events update the appropriate data. Each mutation declares effects or none. A write does not silently refetch every owner query |

Keep these as a small set of scenario tests and representative browser flows.
Do not copy policy declarations into assertions and call that independent evidence.
Check visit effects on Recent, settings effects on their readers, and link changes on access.
The prototype's no-effect fixtures cannot substitute for these checks.

### Contract, architecture, and build gates

Update `STANDARDS.md` and `ARCHITECTURE.md` with the new calling and import rules when implementing them.
Replace the old descriptor, direct-request, and non-throwing examples in active guidance.
Mark the older server-state guideline as superseded and link this map, preserving its history.
Update affected frontend guidance and composition documentation in the same changes.

Extend import checks to recognize the lightweight `@/api` catalog and declared owner API entries.
The engine imports no products. Catalog imports must not pull in UI, editor, or private session modules.
Keep typed workflows at their owner's interface. Do not bypass enforcement with new baseline entries.
Add coverage checks for reference metadata and every mutation's effects declaration.

Run the backend contract exporter and confirm committed JSON matches the route declarations.
Run frontend `yarn check:contract` and confirm generated TypeScript matches the JSON.
Commit route declarations, JSON, and generated TypeScript together.
Current CI already checks both drift directions, so extend those checks rather than replace them.

Run the relevant backend tests and frontend behavioral tests, then the required frontend checks:
format, lint, untranslated text, typecheck, import boundaries, bundle budget, and build.
Inspect the startup graph to confirm lazy policies and validators do not import product UI.
Meet the existing startup bundle budget. Do not increase it to conceal catalog cost.
Shrink debt baselines when conversion removes entries. Never add entries for this migration.

### Completion and handoff evidence

The implementation handoff names its checkout revision, converted callers, removed adapters,
remaining protocol exceptions, and verification results. Report generated changes separately.
Reference real browser flows on the configured site, including refusal and access-scope cases.
Do not claim production behavior from the mock prototype or claim checks passed without running them.

Migration is complete when ordinary Suite API callers need only a reference and the appropriate
client/composable call. They do not assemble descriptors, scope wrappers, or transport requests.
No temporary adapters remain without an explicit legacy owner and removal condition.
No remaining design decision blocks implementation. Production execution is the next effort.
