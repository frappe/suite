---
id: 005
title: Cache effects and product request policies
label: wayfinder:grilling
status: closed
assignee: Faris (Codex batched decision session, 2026-10-06)
blocked-by: [002, 003, 004]
---

## Question

Where are operation defaults, cache effects, and product request policies defined so
every caller gets the correct behavior without assembling it?

Decide ownership for entity identity/version metadata, list membership, touched entities,
invalidation, optimistic updates, and current realtime events.
Decide how product request scope is configured without product branches in the platform.
Separate generated metadata, client policy, and caller-local options.

Use Drive share-link selection, covered nodes for comment/grant requests, access changes,
rename across multiple lists, and a Mail operation with no Drive entities as probes.
Preserve scope outcome handling and challenge/retry behavior as well as headers.
Explain what cache consistency Suite actually promises without database dependency tracking.

## Inputs

- [Map: Suite API client](../MAP.md)
- [Operation kinds and generated references](002-operation-kinds-and-references.md)
- [Suite API catalog and product ownership](003-catalog-and-product-ownership.md)
- [Reactive and imperative call semantics](004-call-and-error-semantics.md)
- `frontend/src/apps/drive/client/operation.ts`
- `frontend/src/apps/drive/client/links.ts`
- `frontend/src/apps/drive/client/nodes.ts`
- `frontend/src/platform/server-state/index.ts`

## Comments

The proposed defaults and open questions are recorded in
[Remaining client decisions](../decision-round.md). Faris accepted them in the resolution below.

## Resolution

Faris accepted required cache-effect declarations and client-owned policies on 2026-10-06.

- The generated contract supplies entity and other response facts. Owning client modules
  supply optimism, touched entities, list membership, invalidation, and request scope.
- Every mutation declares effects or explicitly declares none. A coverage check rejects
  omitted policies. Do not silently refetch every owner query as a fallback.
- Policies refer to generated operations with preserved types and stable identity.
  Cross-product dependencies are explicit. A no-effect declaration does not need a
  separate empty adapter module.
- Composition configures owner policies once. Both reactive and imperative callers obtain
  the same policy automatically. The platform has no Drive-specific branch.
- Drive policies preserve named/covered node scope, share-link outcome handling, access
  changes, and challenge handling. These are more than request headers.
- The client reconciles entities, invalidates affected lists, and integrates existing
  realtime events. It does not discover database dependencies automatically.
- Client/session ownership and access-scope changes must prevent previous identity data
  from being exposed. Verify this through the real client during migration.
- The prototype illustrates policy application and refusal rollback. Coverage of every
  product operation and production races remains an implementation verification gate.
