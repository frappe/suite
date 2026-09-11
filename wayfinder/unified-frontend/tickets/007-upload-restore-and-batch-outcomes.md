---
id: 007
title: Upload, restore and batch outcomes
label: wayfinder:grilling
status: open
assignee:
blocked-by: [006]
---

## Question

Specify the three flows ticket 32 named as frontend dependencies.

- Upload client: create and replace flows through
  `/api/suite/drive/uploads/` (spec §8.4, §13.7), preflight of declared size
  against quota (§7.3), chunking, progress, cancel, and the distinct failure
  states: validation, access, conflict, quota. The empty-head rule on replace
  (§8.5). Drag-and-drop targets in list and grid.
- Restore destination picker: when the original parent chain is not Active
  the user picks an eligible same-root destination and submits parent plus
  Active state (§8.8). Cancel leaves the item trashed. Access changes before
  submit show an explicit error.
- Batch outcomes: how the UI shows mixed ok/failed results from the batch
  route (§11.5) for trash, restore, move and delete, and what is retried.

Decide what the upload client is: the existing Dropzone-based uploader
rewritten, or a platform-level uploader other areas (Mail attachments, Meet
recordings) can reuse later.

Inputs: Drive spec §7.3, §8.4, §8.5, §8.8, §11.5, §13.7; ticket 32
acceptance criteria; `frontend/src/apps/drive/components/FileUploader*`.
