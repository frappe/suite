# Sheets: when a sheet is saved

Status: proposed

Scope: what Sheets stores, when it saves, what happens to edits that have not been saved, and how versions work. It assumes the calculation core in [001](001-calculation-core.md). Saving while several people edit at once is in [003](003-collaboration.md).

Terms such as Content Document and Version are defined in [`suite/drive/CONTEXT.md`](../../suite/drive/CONTEXT.md).

Code: `suite/sheets/versioning/save.py` (`save_sheet`), `suite/sheets/doctype/sheet/storage.py` (encoding), `suite/sheets/drive.py` (Drive callbacks), `frontend/src/apps/sheets/components/SheetEditor/usePersistence.js` (the client side).

## Today (on `forge/drive-layer`)

- The client sends the whole workbook, plus the ops since the last save, about 2 seconds after the last edit.
- `save_sheet` appends the ops to `Sheet Op Log` (numbered by `Sheet Seq`), then overwrites `Sheet.sheets_data` with the whole workbook and sets `head_seq`.
- Every save may also take a Drive version, at most one per 30 seconds (`AUTO_VERSION_SECS`).
- The client does not say which `head_seq` it built on. Two tabs that both save keep both sets of ops in the log, but the body keeps only the last save. The other tab's edits disappear from the sheet.

## Behaviour

### What is stored

| Where | What | Owner |
| --- | --- | --- |
| `Sheet Op Log` | One row per command (type, full JSON, actor, sheet, affected range), in `seq` order | Sheets |
| `Sheet.sheets_data` | The body at one `seq`, plus feature data (format: see below) | Sheets |
| `Drive Node Version` | Named and automatic versions of the snapshot | Drive |

An edit sends one command, never computed values and never the whole workbook. Every IronCalc (browsers and server) applies the same commands in the same order and computes the same results.

`sheets_data` keeps the existing gzip + base64 envelope (`{"_z": "gzip", "data": "..."}`). It holds the body at one `seq` (`snapshot_seq`), plus `features`: what IronCalc does not model (conditional formats, validation, charts, filters, comment anchors, view state). `MAX_SHEETS_DATA_BYTES` (75 MB uncompressed) still applies.

**Open: what the body is.**

| | A. JSON | B. IronCalc bytes |
| --- | --- | --- |
| Body | cells (input + style), column widths, row heights, merges, frozen panes, defined names, sheet order | `engine`: base64 of `workbook.toBytes()`, with `engine_version` |
| Server can read and modify it | Yes | Only through IronCalc |
| Opening | A loader turns the JSON into one `batch` of commands; IronCalc recalculates everything | `Model.from_bytes`; no recalculation |

With A, the server never edits the JSON itself. Row and column changes, sort and fill rewrite formula references, so the collab server applies each command with IronCalc (`@ironcalc/nodejs`) and exports the JSON from it.

### Opening a sheet

1. The server returns `sheets_data` and the ops after `snapshot_seq`.
2. The worker builds the workbook from the body (A: the loader's `batch`; B: `Model.from_bytes`), then applies the later ops as one `batch`.
3. A new sheet has no body yet. It starts as an empty workbook.

### When a save starts

About 2 seconds after the last edit, as today. Also on leaving the editor and on unmount, with `keepalive` so the request survives the page closing.

### What one save does

- The client sends the commands since its last confirmed save, with `base_seq`: the `head_seq` it built on.
- The server refuses the save if `base_seq` is not the current `head_seq`. It never merges. This is the rule Slides uses with `base_modified` ([slides/001](../slides/001-saving.md)).
- Otherwise it appends the commands to `Sheet Op Log` and advances `head_seq`, as one transaction.
- A large paste or fill is one `batch` command, so it is one op row. A save carries at most 500 commands (`MAX_OPS_PER_SAVE`).
- A repeated request with the same `request_id` returns the `seq` it already landed at and writes nothing.
- Every N commands (default 500), a new body is written to `sheets_data` with its `snapshot_seq`: the client's `toBytes()` (B), or the body exported after the last command in that save (A).

### Unsaved edits

| Situation | Result |
| --- | --- |
| Edit made while a save is in flight | Queued. It goes out in the next save |
| Network drops | Commands stay queued in memory; the save retries when the network returns |
| Server error | Retries with a delay that doubles, up to 30 seconds. The header shows "Not saved" |
| Another tab or person saved first (`base_seq` refused) | The sheet becomes read only and asks the user to reload. Their unsent commands are listed so they can be re-entered |
| Edit access removed | Saving stops. The sheet becomes read only |

### Versions

Drive owns versions. Sheets answers Drive through the callbacks in `suite/sheets/drive.py`:

| Callback | Does |
| --- | --- |
| `version_bytes` | Returns the current snapshot envelope. A snapshot is written first if the log has moved past `snapshot_seq` |
| `restore_version` | Writes the version's envelope back to `sheets_data`, sets `snapshot_seq` to the new head, and writes a `restore` op |
| `used_nodes` | Reports media named in the body (A) or in `features` only (B: engine bytes are not scanned). Sheets has no media today |
| `import_from_file` | Out of scope here. xlsx import is a separate spec |

## Constraints

- A snapshot always matches one `seq` exactly. Bytes and `snapshot_seq` are written together or not at all.
- With B, engine bytes are only read by the same or a newer IronCalc version. An upgrade must load bytes written by the previous pinned version (a test with a stored fixture).
- With A, loading a body and exporting it again gives the same JSON (a round-trip test).
- Browsers never write the body while collaboration is active ([003](003-collaboration.md)); the collab server does.
