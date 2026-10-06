---
id: 003
title: Suite API catalog and product ownership
label: wayfinder:grilling
status: closed
assignee: Faris (Codex decision session, 2026-10-06)
blocked-by: []
---

## Question

How do callers discover and import Suite operation references while preserving product
ownership, platform dependency rules, and lazy loading?

Decide whether there is one namespaced catalog, per-product catalogs with a common
interface, or another concrete arrangement. Decide who assembles it and exports it.
Explain how references remain independent of product UI modules and whether cross-product
calls go through an owning product's public interface.
Decide whether client-facing operation names follow current generated IDs or use declared
names. Avoid changing HTTP resource names merely to improve TypeScript names.

Use Suite people lookup, Drive visit recording from an editor, and Mail inbox summary
as examples. A convenience import must not force every product into the startup bundle.

## Inputs

- [Map: Suite API client](../MAP.md)
- `ARCHITECTURE.md`, `frontend/AGENTS.md`
- `frontend/src/composition/README.md`
- `frontend/src/apps/drive/index.ts`
- `frontend/src/apps/writer/drive.ts`
- `frontend/src/apps/mail/client/inboxSummary.ts`

## Comments

### Shared catalog — 2026-10-06

Faris chose one Suite catalog with product namespaces, such as `api.drive`, `api.mail`,
and `api.suite`. Products retain ownership of contracts and client policies.
The catalog must not force every product's UI into the startup bundle.

Faris requested all remaining questions in one round, with recommended answers.
Naming and assembly details will use stated working defaults unless they reveal a
consequential tradeoff. The final record follows that batched review.

The complete proposed round is [Remaining client decisions](../decision-round.md).

## Resolution

Faris accepted the shared catalog and the batched recommendations on 2026-10-06.

- One Suite caller module exports `api`, composables, and `client`.
  The catalog has product namespaces, including `api.drive`, `api.mail`, and `api.suite`.
- Products own their contracts and policies. Composition assembles registrations.
  The platform engine remains product-neutral and imports no product modules.
- API entries must be lightweight and separate from product UI entry graphs.
  Load owner-specific runtime policies and validators when needed, without an API import
  constructing product UI or private editor sessions. Update import rules during migration
  to recognize the declared API entry, rather than bypassing checks with a baseline entry.
- Use resource-oriented names such as `api.drive.nodes.get` and `api.drive.nodes.rename`.
  Declare the public reference name once and preserve stable operation IDs and HTTP URLs.
  Do not guess public names from HTTP methods. Validate examples before fixing exact paths.
- Cross-product ordinary calls use the owning namespace through the shared catalog.
  Product workflows remain owned by their product and reach other products through
  declared public interfaces. A global catalog is not permission to import UI internals.
- The prototype proves caller typing and illustrates the import. Production bundle cost
  and lazy loading remain migration gates, not guarantees from the mock prototype.
