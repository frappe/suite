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

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): the
WebDAV section takes the method-role table, the three mounts and the
Shared-with-me grant-root query with its collision suffix, the export
naming and collision rules for documents, the empty-head no-version rule
(applies to every replace path), the `content_modified` column, and one
framework ask: Range on non-local drivers through the public stream-read.
