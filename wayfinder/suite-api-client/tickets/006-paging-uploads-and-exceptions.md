---
id: 006
title: Pagination, uploads, and exceptional operations
label: wayfinder:grilling
status: closed
assignee: Faris (Codex batched decision session, 2026-10-06)
blocked-by: [002, 004, 005]
---

## Question

How does the shared client convention handle paginated reads, multi-request uploads,
downloads, and composite operations without making ordinary callers assemble infrastructure?

Decide which operations fit generated references directly and which remain named product
workflows. Cover cursor/offset paging, membership, upload progress/resume/cancel,
raw-byte requests, and sequential cleanup after a failed import.
Decide whether exceptional operations require a distinct client kind or an existing one.

Mark long-lived collaboration and media protocols as outside the ordinary query/mutation
client. Specify how callers reach them without replacing those protocols.
Avoid adding an action abstraction solely because Convex has one.

## Inputs

- [Map: Suite API client](../MAP.md)
- [Operation kinds and generated references](002-operation-kinds-and-references.md)
- [Reactive and imperative call semantics](004-call-and-error-semantics.md)
- [Cache effects and product request policies](005-cache-and-product-policies.md)
- `frontend/src/apps/drive/client/uploads.ts`
- `frontend/src/apps/drive/client/nodes.ts`
- `frontend/src/apps/writer/drive.ts`
- `frontend/src/platform/server-state/index.ts`

## Resolution

Faris accepted the batched working defaults on 2026-10-06.

- Keep pagination behind a typed shared composable. The reference carries the declared
  page contract and callers supply domain arguments, without constructing descriptors.
  Cursor/offset metadata comes from the contract or owner configuration, once.
- Upload callers use a typed transfer workflow. The workflow owns create/chunk/finish,
  progress, resume, cancellation, request scope, and cache effects.
  Do not expose the constituent request assembly to ordinary callers.
- Downloads are explicit byte operations. Do not normalize a Blob as an ordinary entity.
- Composite product work remains a named owner workflow. It consumes shared client calls
  and preserves operation-specific failure and partial-success handling.
- Start with query and mutation kinds. Do not add an action kind without an operation
  requiring a different guarantee. Byte and paging capabilities are not new kinds by default.
- Yjs, WebRTC, and long-lived streams stay separate. Existing safe retry/resume rules
  remain operation-specific. A shared convention does not add write idempotency.
- The prototype shows the caller shapes. Existing protocol behavior must be checked
  independently when these operations migrate. Mock progress is not a storage rehearsal.
