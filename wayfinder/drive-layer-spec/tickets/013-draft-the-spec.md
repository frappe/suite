---
id: 013
title: Draft the spec
label: wayfinder:task
status: open
assignee:
blocked-by: [001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 014]
---

## Question

The destination ticket. Write `drive-layer-spec.md` (and a companion plan
if the storage_v2 pattern is followed): doctypes with frozen schemas and
indexes, the permission engine with its exact queries, the content SDK
(ContentTypeSpec + mixin), HTTP API, WebDAV mapping, framework-side
storage_v2 asks stated precisely, and the migration section. Inputs: every
closed ticket on this map plus the decided architecture in
`drive-file-layer-designs.md`. Blocked by all other tickets.

Handed from [Link sharing semantics](008-link-sharing-semantics.md)
(2026-09-03): the engine's two-pass resolution (own principals with
nearest-wins and tie-break email > group > `$GENERAL`, deny final; else
max with nearest-wins over `$PUBLIC` and `$LINK:*`, ties take the highest
role); the `X-Drive-Links` header grammar (`token` or `token.ticket`,
comma-separated); the unlock ticket
(`exp + "." + HMAC-SHA256(site_secret, token|password_hash|exp)`, 30
days); the per-token unlock rate limit; `via_link` on the activity row;
`expires_on` on every grant and `password_hash` refused off links; the
daily sweep of expired link grants; the collab server re-check interval
(five minutes suggested) and the connection token shape (sid plus link
tokens).

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): the
WebDAV section takes the method-role table, the three mounts and the
Shared-with-me grant-root query with its collision suffix, the export
naming and collision rules for documents, the empty-head no-version rule
(applies to every replace path), the `content_modified` column, and one
framework ask: Range on non-local drivers through the public stream-read.

Handed from [Quota policy](010-quota-policy.md) (2026-09-03): a Quota
section with the charge rule (logical, per reference), what counts (Active
and Trashed nodes, versions, reservations) and what is free (previews,
exports, bodies), `Drive Root.used_bytes` with the conditional admission
UPDATE and the daily recompute, the two-stage browser preflight, the
configuration fields (`quota_bytes` 0 = inherit; `default_personal_quota`,
`shared_quota`), the archived-root rule (pays for itself, admin purge
only), the UI cross-root move rebill, and the DAV quota properties. The
WebDAV section shrinks to one mount, the Personal Root: drop the
three-mount list, the Shared-with-me grant-root query and its collision
suffix, and the cross-root MOVE paragraph (the method-role table stays).
