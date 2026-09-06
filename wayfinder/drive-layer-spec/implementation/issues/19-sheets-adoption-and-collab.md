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
`suite/sheets/tests/*`, `suite/sheets/collab-server/*`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, and this ticket.

Four existing Sheets test modules were updated, not replaced:
`test_permissions.py`, `test_collab.py`, `test_api_security.py`, and
`test_share_notify.py`. Every guard and endpoint now reads the node column
first, so each of those tests had to say which side it exercises.

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

Claimed 2026-09-06. Implementation complete, verification partial. No acceptance
box is checked: the two `IntegrationTestCase` classes have not run, and they are
what prove the Drive lifecycle.

### Commits

| Commit | What |
|---|---|
| `6aa145536` | Claim the ticket and stage its scope |
| `f57b3a8cd` | `drive.import_document` and `drive.read_file` |
| `b9d4505db` | The Sheets declaration, the `node` Link, and the mixin |
| `255fa572b` | Staged `Sheet` guards and the legacy-path refusals |
| `0895495bf` | Collab access from Drive, and the five-minute recheck |
| `e05ad41cb` | The three new test suites and the debt baseline |

### What changed

**The declaration** (`suite/sheets/drive.py`). One `ContentTypeSpec`:
`create_empty`, `duplicate`, `import_from_file`, `version_bytes`,
`restore_version`, `on_purge`, and `used_nodes`. `default_export=None` and
`export=None`, so Sheets stays hidden over WebDAV this release.
`pushes_preview=False`. Two satellites, `Sheet Op Log` and
`Sheet Collab State`. `legacy_fields=("title", "trashed", "trashed_on",
"trashed_by")`.

Every Drive workflow that changes a body writes one op at a fresh `Sheet Seq`
allocation, so the history panel does not skip what Drive did: `create` for a
new or copied sheet, `import` for an xlsx, `restore` for a version. None of them
goes through `versioning.save`, which gates on `frappe.has_permission("Sheet")`
after Drive has already answered against `Drive Grant`.

**The doctype.** `Sheet` gains a read-only `node` Link with a search index.
`title` loses `reqd` and gains the §14.10 description. The `All` DocPerm loses
`if_owner` for the open baseline §10.4 needs at activation, and a `Guest` read
row is added for link grants. The controller carries `drive.DriveContent`: a
linked row requires no title, gets no backing `File`, and touches its node on
every save.

**The guards** (`suite/sheets/permissions.py`). `sheet_has_permission` and
`sheet_query_conditions` are new. They put the `if_owner` rule back where it can
also read the node column, and refuse a linked row through
`drive.refuse_shared_row` / `drive.refuse_shared_linked_rows` rather than
answering `False`, because Frappe widens a denied row check
(`frappe/permissions.py:214-216`) and ORs shared names around a list predicate
(`frappe/database/query.py:1739-1742`). The two child guards get the same split
plus `_refuse_shared_linked_children`, which closes the one hole no node column
can scope: a `DocShare` on an op-log or snapshot row of a linked sheet.

**The legacy paths.** `share_sheet`, `unshare_sheet`, `get_sheet_shares`,
`delete_sheet`, `restore_sheet`, `delete_sheet_permanent`, `rename_sheet`, and
`duplicate_sheet` refuse a linked sheet. `list_trash` filters linked rows out.
`trash.hard_delete_sheet` refuses one and `purge_trashed_sheets` skips one. Every
path still works unchanged on a row Build has not linked.

**Collaboration** (`suite/sheets/collab.py`, `suite/sheets/collab-server/`).
`check_collab_access` answers a linked sheet from `Drive Grant`: EDIT and above
writes, READ or COMMENT connects read-only, UPLOAD connects read-only because it
places nodes rather than cells, anything lower is refused. Link credentials
travel in `X-Drive-Links`, which the collab server forwards from the browser, so
`suite.drive` builds the same principals it builds for any other request and the
20-item limit stays in `parse_link_header`. A Guest gets a server-controlled
identity, and the collab server tells two apart by a `randomUUID()` it generates.

Every answer carries `recheckSeconds`. `access-recheck.js` re-asks on that
cadence: revoked or expired closes the socket, a downgrade across the EDIT line
turns the connection read-only, an upgrade releases writes again.

### Deviations and decisions, recorded

1. **`drive.import_document` and `drive.read_file` were added.** §10.1 declares
   `import_from_file` and no Drive workflow called it. An app cannot implement
   "an xlsx becoming a sheet" against a callback nobody invokes, and an app may
   not read a `Drive Node` blob itself (ARCHITECTURE.md rule 2.2). Ticket 18
   amended the same files for the same reason with `adopt_media`.

2. **`DriveError` joined the facade.** `suite/drive/__init__.py` already
   documented "caught by type, not by message" without exporting the type. The
   collab endpoint needs one `except` for every refusal, and importing
   `suite.drive._core.errors` is an architecture violation.

3. **`remap_media` is deliberately not declared.** A Sheets body names no media
   today, so there is no reference to rewrite. A no-op declaration would let a
   copy carry media nothing names, charge the destination root, and have the
   §10.6 sweep trash it in seven days. **Handoff:** the ticket that adds an image
   cell declares `remap_media` and narrows `used_nodes` with it.

4. **`used_nodes` over-reports.** It walks every string in the decoded body at
   every depth and reports every whole id-shaped token. §10.6 trashes what the
   app does not report, so over-reporting only keeps media alive.

5. **`Sheet Snapshot` is not a satellite.** §14.6 turns its rows into
   `Drive Node Version` rows, so it stays a Build source with its own guards
   until Cleanup drops the doctype (§14.10). A satellite declaration would freeze
   rows Build still has to read.

6. **The recheck fails closed after three consecutive unreachable answers, not
   one.** One Frappe blip must not drop every editor on the site; three whole
   periods with no confirmed answer is long enough that only Drive may say yes
   (§1). The number is `MAX_CONSECUTIVE_FAILURES` in `access-recheck.js`.

7. **The xlsx import drops workbook-level decoration.** openpyxl read-only gives
   values, formulas, and number formats, not the style sheet, so borders, fills,
   and fonts are lost. Every formula and every merge comes across. Losing
   decoration is recoverable; losing a formula is not.

### Checks run

| Check | Result |
|---|---|
| `python -m compileall` on every changed module | clean |
| `uvx ruff@0.12.3 check` on every changed file | All checks passed |
| `python -m unittest suite.tests.test_architecture` | 7 tests, OK |
| `python -m unittest` on 10 database-free Sheets modules | 135 tests, 1 error |
| `npm test` in `suite/sheets/collab-server` | 33 tests, 33 pass, 0 fail |
| xlsx importer against a generated workbook, in a bench python | values, formula, date, percent format, and merges across two worksheets all correct |

The one error is
`TestSheetsDeclaration.test_activation_registers_exactly_this_declaration`:
`_build_registry` reads `frappe.local.flags`, which no site is bound to outside
a request. It runs at the gate.

Every Python check ran under
`PYTHONPATH=apps/frappe:<worktree> python -m unittest` from
`/home/faris/benches/suite-bench/sites`, with no site connected and no bench
command. No migration, no install, and no service restart.

### Not verified

- `TestSheetsBeforeActivation` and `TestSheetsInDrive`. They need real rows.
  They are the only proof of create, copy, import, version, restore, purge,
  media discovery, satellite queries, and the legacy refusals against a
  database.
- The `Sheet` doctype JSON change. It needs `bench migrate` to reach a site.
- `index.js` binding the recheck to hocuspocus. `@hocuspocus/server` is not
  installed in this worktree and installing it or restarting the collab server
  is outside this run. `connection.readOnly` mid-session and `onDisconnect({
  context })` carrying the watcher are read from the library's documented shape,
  not observed. The policy itself is tested with injected time and passes.

### The site gate

Run serially on `slides.localhost`, from the bench root, after this branch is
integrated:

```sh
cd /home/faris/benches/suite-bench
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.sheets.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.sheets.tests.test_collab_access
bench --site slides.localhost run-tests --module suite.sheets.tests.test_collab
bench --site slides.localhost run-tests --module suite.sheets.tests.test_permissions
bench --site slides.localhost run-tests --module suite.sheets.tests.test_api_security
bench --site slides.localhost run-tests --module suite.tests.test_architecture
bench --site slides.localhost run-tests --app suite
cd apps/suite/suite/sheets/collab-server && npm test
```

### Handoffs

| To | What |
|---|---|
| 29 | Register `suite.sheets.drive.SPEC`; move both `Sheet` hooks to `suite.drive.framework.doc_*`; add `satellite_*` for `Sheet Op Log` and `Sheet Collab State`; leave `Sheet Snapshot` on its own guard |
| 34 | The browser sends a bare `sid` as the collab token today. Send `{"sid":..., "links":[...]}` so a Guest with a link can connect; the collab server already reads both shapes |
| 34 | The Sheets client still calls the legacy endpoints, which refuse a linked sheet. It needs the Drive equivalents before Build |
| 23 | The legacy `File` backing, the DocShare endpoints, and `suite/sheets/trash.py` |
| Cleanup (§14.10) | Drop `title`, `trashed`, `trashed_on`, `trashed_by`, `head_snapshot`, `Sheet Snapshot`, `Sheet Cell`, and `suite/sheets/trash.py` |
| A later Sheets ticket | An image cell needs `remap_media` and a narrowed `used_nodes` |
| 21 and 22 | The new test module reaches `suite.drive._core` for roots, media, and version restore. Recorded in the architecture debt baseline |
