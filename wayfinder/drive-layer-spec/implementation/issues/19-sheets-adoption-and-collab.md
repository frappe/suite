# 19 — Move Sheets lifecycle and collaboration checks into Drive

**What to build:** Use Drive permissions for Sheets documents, operation records, and live collaboration.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** in-progress

**Owner:** Suite Sheets

**Starting revision:** Suite `d7bf210b071e7d4ffb32b75b5ed0802b4f7f053b`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/sheets/drive.py`, `suite/sheets/collab.py`,
`suite/sheets/permissions.py`, `suite/sheets/trash.py`, `suite/sheets/api.py`,
`suite/sheets/doctype/sheet/sheet.py`, `suite/sheets/doctype/sheet/sheet.json`,
`suite/sheets/tests/test_drive_adoption.py`,
`suite/sheets/tests/test_collab_access.py`,
`suite/sheets/collab-server/*`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, and this ticket.

This ticket also changes ticket 16's files: `suite/drive/_core/nodes.py` and
`suite/drive/__init__.py`. Recorded as a deviation from the plan's file
ownership, not hidden. Reason: §10.1 declares `import_from_file` and no Drive
workflow calls it. An app cannot implement "an xlsx becoming a sheet" against a
callback nobody invokes, and an app may not read a `Drive Node` blob itself
(ARCHITECTURE.md rule 2.2). Ticket 18 amended the same three files for the same
reason with `adopt_media`.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.7, §10.7 Sheet; §14.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Scope: this is the expand phase

The README stages registry activation and permission-hook changes until the node
links exist. Ticket 29 makes those changes, after Build. So this ticket ships
everything Sheets needs and activates none of it:

| Ships here | Waits |
|---|---|
| `suite/sheets/drive.py`: `SPEC` and every callback | — |
| The `node` Link on `Sheet`, and the `DriveContent` mixin | — |
| Drive-native create, copy, xlsx import, version bytes, restore, purge, media discovery | — |
| `drive.import_document` and `drive.read_file` | — |
| Link credentials, the 20-item limit, and the five-minute recheck in collab | — |
| Server-controlled Guest identity | — |
| `drive_content_types = ["suite.sheets.drive.SPEC"]` | 29 |
| Both `Sheet` permission hooks pointing at `suite.drive.framework` | 29 |
| The `Sheet Op Log` and `Sheet Collab State` satellite hooks | 29 |
| Legacy `File` backing, the DocShare endpoints, the Sheets trash | 23, 34 |
| Dropping `title`, `trashed`, `trashed_on`, `trashed_by`, `head_snapshot` | Cleanup, §14.10 |
| Dropping `Sheet Snapshot` and `suite/sheets/trash.py` | Cleanup, §14.10 |

## Acceptance criteria

- [ ] Declare Sheet, Sheet Op Log, and Sheet Collab State through the content contract.
- [ ] Implement create, copy, xlsx import, version bytes, restore, purge, and media discovery.
- [ ] Replace separate share/trash enforcement and retain migration source snapshots and fields until Cleanup.
- [ ] Keep default_export=None. Sheet bodies remain free; version blobs and media remain charged.
- [ ] Update both Frappe access checks and the repository-owned collaboration server to carry relevant link credentials.
- [ ] Reject more than 20 supplied credentials. EDIT permits writing; READ/COMMENT permits read-only; below READ refuses.
- [ ] Recheck each live connection every five minutes. Disconnect revoked or expired access, and enforce downgrades.
- [ ] Use server-controlled Guest identity. Do not restart collaboration services as part of implementation.

## Verification

Run Sheets and collaboration-server tests with fake time, revocation, expiry, downgrade, Guest tokens, Satellite queries, and version restoration.

## Completion evidence

Claimed 2026-09-06. Implementation in progress. No acceptance criterion is
proved until the shared site gate runs on `slides.localhost`.
