---
id: 007
title: Cross-product caller examples
label: wayfinder:prototype
status: closed
assignee: Faris (Codex prototype session, 2026-10-06)
blocked-by: [003, 004, 005, 006]
---

## Question

Does the chosen client convention read naturally across Suite and preserve its agreed
behavior in representative reactive and imperative callers?

Create a throwaway TypeScript prototype or concrete call-site comparison for Faris to review.
Use Suite account/people/settings, Drive detail/list/rename/share-link calls, and Mail inbox
summary. Include an outside-component call, a disabled read, pagination, and an upload.
Exercise the chosen error interface and wrong-kind/wrong-argument type failures.

Keep the artifact separate from production code. Link it here. Resolve this ticket only
after Faris reacts to the artifact. Record interface changes or newly exposed decisions
before declaring it accepted. Do not substitute a screenshot for behavior or type evidence.

## Inputs

- [Map: Suite API client](../MAP.md)
- All preceding interface decisions, loaded only where they affect an example
- Current product callers and generated contracts

## Prototype artifact — 2026-10-06

Faris accepted the recommended defaults with “recommendations”. The decisions are
recorded in the preceding tickets and [decision round](../decision-round.md).

The isolated prototype is captured on `prototype/suite-api-client-20261006`, commit
`3b8593f5e`. Production source in the shared checkout was not changed.

- [Open the live demo](http://localhost:8766/demo.html)
- [Single-file artifact](/var/folders/_v/x3nxj3_n0jb0l5v6_h_6b5kr0000gn/T/suite-api-prototype-onuvpwyd/client/frontend/src/platform/server-state/suiteApi.prototype/demo.html)
- [Typed callers](/var/folders/_v/x3nxj3_n0jb0l5v6_h_6b5kr0000gn/T/suite-api-prototype-onuvpwyd/client/frontend/src/platform/server-state/suiteApi.prototype/callers.ts)
- [Run instructions, evidence, and limits](/var/folders/_v/x3nxj3_n0jb0l5v6_h_6b5kr0000gn/T/suite-api-prototype-onuvpwyd/client/frontend/src/platform/server-state/suiteApi.prototype/README.md)

The standalone HTML has caller-code tabs, live state, free-play actions, and guided
walkthroughs. It uses real Vue observers and mock in-memory endpoints. Existing generated
Suite, Drive, and Mail types check the examples, including Drive lists and link unlock.

Browser checks observed rejected writes with error state and rollback, successful rename
with refetch, fresh versus explicitly cached reads, concurrent read deduplication, observer
disable/re-enable/disposal, an imperative write after disposal, cursor exhaustion, and mock
upload progress. Strict compilation rejected all seven deliberately invalid call shapes.

Mock scope traces are not production access-scope evidence. Real link/header handling,
upload protocols, transport validation, races, retry, realtime, complete policy coverage,
and bundle cost remain implementation verification work. Visit/settings no-effect policies
are demo fixtures whose dependent queries are absent, not proposed production policies.

At capture, human review was pending. The resolution below records the later review.

## Resolution — 2026-10-06

Faris reviewed the prototype and said “looks good”. The cross-product caller convention
is accepted, including the shared import, generated references, reactive composables,
imperative calls, paging, and transfer caller shapes.

The prototype's verification limits remain in effect. Acceptance does not establish
production transport, access-scope, upload, concurrency, or bundle guarantees.
Finalize the migration handoff against the accepted decisions. Keep the prototype on its
throwaway branch, rather than copying its mock client into production.
