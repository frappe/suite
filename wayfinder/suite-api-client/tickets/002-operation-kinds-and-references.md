---
id: 002
title: Operation kinds and generated references
label: wayfinder:grilling
status: closed
assignee: Faris (Codex decision session, 2026-10-06)
blocked-by: [001]
---

## Question

What must a generated operation reference describe so callers can use it directly,
and where is each piece of information declared?

Decide how reads, writes, side effects, and byte operations are classified.
Decide whether kind is explicit route metadata, derived from HTTP methods, or declared
elsewhere. Identify what wrong combinations TypeScript must reject.
Decide how input, output, error, entity, and paging metadata reach the reference.
Separate server facts from client policy and local UI choices.

Probe a node read, rename, visit record, people lookup, Mail operation, and download.
Do not assume that a POST is always a cache mutation or that a GET is subscribable.
Naming the kinds does not give Suite Convex's transaction or retry guarantees.

## Inputs

- [Map: Suite API client](../MAP.md)
- `suite/composition/http.py`
- `suite/composition/contract.py`
- `frontend/scripts/generate-contract.mjs`
- `frontend/src/platform/transport/index.ts`
- Product route tables and generated contracts, opened only as needed

## Comments

### Operation kind declaration — 2026-10-06

Faris chose an explicit operation kind on the backend route, carried into the generated
TypeScript reference. Do not infer kind from the HTTP method. The client must reject
a mutation reference passed to a query API at typecheck time.

The initial distinction is `query` versus `mutation`. A node read is a query.
A rename or visit record is a mutation. These names do not add transaction, retry,
or realtime guarantees. Exceptional operation handling remains a separate decision.

### Client policy ownership — 2026-10-06

Faris chose client-owned policies. The backend supplies the operation contract and
response metadata. Client modules declare cache effects, optimistic behavior, and
product request handling. Those policies are attached once, without caller assembly.

## Resolution

Resolved with Faris on 2026-10-06 through the two choices above.

- Backend route metadata explicitly declares operation kind. Start with `query` and
  `mutation`. HTTP method controls transport and does not determine kind.
- Generated references preserve operation identity, owner, kind, request/response types,
  declared errors, validation, and response metadata supplied by the backend contract.
  Query APIs reject mutation references. Arguments and results retain generated types.
- Client modules own cache effects, optimistic updates, and product request policies.
  Do not introduce a backend language for those behaviors. Callers consume the reference
  directly without importing policies, wrapping operations, or redeclaring types.
- Local UI choices, such as displaying an error inline, remain caller options.
  Their exact interface belongs to
  [Reactive and imperative call semantics](004-call-and-error-semantics.md).
- A reference is sufficient to identify the contract and obtain configured behavior.
  Catalog assembly belongs to
  [Suite API catalog and product ownership](003-catalog-and-product-ownership.md).
  Registration and cache guarantees belong to
  [Cache effects and product request policies](005-cache-and-product-policies.md).
- Paging and byte metadata follow the server contract when present. Their exact forms,
  composite operations, and any additional kind belong to
  [Pagination, uploads, and exceptional operations](006-paging-uploads-and-exceptions.md).
  Kind alone does not promise automatic subscriptions, transactions, or safe write retries.
