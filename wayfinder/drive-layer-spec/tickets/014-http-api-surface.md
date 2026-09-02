---
id: 014
title: HTTP API surface
label: wayfinder:grilling
status: open
assignee:
blocked-by: [007, 008]
---

## Question

Define the HTTP API of the Drive layer: endpoint list, request and response
shapes, error codes, and paging. Inputs: the ten-entry-point shape from the
design doc (`drive-file-layer-designs.md`, design C), the role ladder, the
Drive Root model (archived-roots view), and the content app contract
(create/copy/touch/version/comment calls, satellite hooks). Blocked by
Publishing capability and Link sharing semantics because publish and link
endpoints are part of the surface.

Graduated from Not yet specified on 2026-09-03 after
[Content app contract](005-content-app-contract.md) closed.
