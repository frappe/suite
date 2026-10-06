# Remaining client decisions

Accepted by Faris on 2026-10-06 with the response "recommendations".
The working defaults and three recommended answers below are the chosen direction.
The caller prototype still requires Faris's review before its ticket can close.

## Settled direction

- One Suite catalog with product namespaces.
- Backend-declared operation kinds and generated request/response contracts.
- Client-owned policies, attached once without caller assembly.

## Working defaults

- One public caller module exports `api`, Vue composables, and the imperative client.
  The execution engine remains product-neutral. Composition assembles product registrations.
- Use readable resource names, such as `api.drive.nodes.get` and `api.drive.nodes.rename`.
  Preserve HTTP URLs and stable operation identity. Exact catalog naming is validated in
  the cross-product prototype before the interface is fixed.
- Preserve explicit mutation state and `run`, rather than making a callable function
  also carry reactive state. Queries expose data, loading/fetching state, and errors.
- Query arguments accept reactive values or getters. An explicit disabled state waits
  for prerequisites. Vue scope disposal removes observers automatically.
- Share cache and in-flight coordination between reactive and imperative calls.
  Both mutation forms run the same policy, normalization, invalidation, and rollback logic.
  Mutation completion applies local reconciliation and schedules affected refetches.
  It does not wait for every list to refetch or promise a common database snapshot.
- The returned state is local to each observer. The shared cache remains client/session
  owned. A catalog import does not instantiate every product UI or private session.
- Client policies own optimism, list membership, request scope, and existing challenge
  handling. Cache reset and scope changes must not expose data from a previous identity.
- Keep paging metadata and upload orchestration behind shared, typed entry points.
  Transfer workflows own create/chunk/finish, progress, resume, and cancellation.
  Downloads remain explicit byte operations. Do not add a Convex action kind without
  a concrete operation that needs a different guarantee.
- Keep current safe read retries. Do not add automatic write retries without server
  idempotency support. Keep collaboration, media, and long-lived streams separate.
- Migrate in stages with explicit adapter removal gates. Begin with generated Suite,
  Drive, and Mail callers, then convert legacy product calls as they gain contracts.
  Use behavioral, type, contract-drift, import, and bundle checks before removing old paths.

## Questions for Faris

### Failed mutation calls

Should an awaited mutation reject on failure, or resolve a typed result that requires
an explicit success check? Recommend rejection, while reactive observers also expose
the error. Avoid resolving `undefined` for a failed write. Expected server refusals
and programmer errors remain distinguishable. Local feedback can suppress a toast.

### One-shot read freshness

Should `client.query` request a fresh server result by default, or reuse cached results
when available? Recommend a fresh server result. Reactive queries use the cache for
immediate display and refetch when needed. Offer explicit cache reuse for imperative reads.

### Missing mutation cache policies

Should every mutation declare its cache effects (or explicitly declare none), or should
the runtime refresh every query for that product when no policy is present?
Recommend required declarations, enforced by a coverage check. This catches omissions
without broad refetches. Cross-product dependencies are explicit effects in the policy.
An operation with no local cache effects can say so without an empty adapter module.

## Related tickets

- [Suite API catalog and product ownership](tickets/003-catalog-and-product-ownership.md)
- [Reactive and imperative call semantics](tickets/004-call-and-error-semantics.md)
- [Cache effects and product request policies](tickets/005-cache-and-product-policies.md)
- [Pagination, uploads, and exceptional operations](tickets/006-paging-uploads-and-exceptions.md)
- [Cross-product caller examples](tickets/007-cross-product-caller-prototype.md)
- [Migration and verification contract](tickets/008-migration-and-verification.md)
