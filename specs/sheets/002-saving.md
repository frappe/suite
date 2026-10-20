# Sheets: when a sheet is saved

Status: proposed

Scope: what Sheets stores, when it saves, what happens to edits that have not been saved, and how versions work. It assumes the calculation core in [001](001-calculation-core.md). Saving while several people edit at once is in [003](003-collaboration.md).

Terms such as Content Document and Version are defined in [`suite/drive/CONTEXT.md`](../../suite/drive/CONTEXT.md).

Code: `suite/sheets/versioning/save.py` (`save_sheet`), `suite/sheets/doctype/sheet/storage.py` (encoding), `suite/sheets/drive.py` (Drive callbacks), `frontend/src/apps/sheets/components/SheetEditor/usePersistence.js` (the client side).

## Today (on `forge/drive-layer`)

- The client sends the whole workbook, plus the ops since the last save, about 2 seconds after the last edit.
- `save_sheet` appends the ops to `Sheet Op Log` (numbered by `Sheet Seq`), then overwrites `Sheet.sheets_data` with the whole workbook and sets `head_seq`.
- Every save may also take a Drive version, at most one per 30 seconds (`AUTO_VERSION_SECS`).
- Each save names the `head_seq` it built on as `base_seq`. The server refuses any other head with `TimestampMismatchError`. The server never merges: this refusal is the safety net.
- A save publishes `sheet_saved { sheet, head_seq }` to the sheet's room. An editor with nothing unsaved loads the new body in place, so others see a save about 2 seconds after the last keystroke. "Nothing unsaved" means no unsent commands and no save still settling: a save in flight decides first, and the editor follows the new head once it has landed or been refused.
- One load at a time replaces the workbook (`loadSheet` queues a second load behind the first). A rebase that cannot load the stored copy keeps the workbook and its unsent edits, shows "Not saved", and tries again, at most 3 times; it never shows the page-level "Couldn't open this sheet".
- The editor keeps every command it dispatched that no landed save carries yet (`components/SheetEditor/unsentCommands.ts`). When another editor's `sheet_saved` arrives while it has unsaved edits, or when its save is refused, it **rebases** (`rebase()` in `usePersistence.js`): it loads the stored copy, dispatches its unsent commands again, writes the formats it changed per cell, column and row, replaces a feature store (merges, validation, charts, …) it changed, and saves on the new head. Per cell, and per feature store, the last writer wins. A save refused again right after rebases again, at most 3 times in a row; then the editor stops as below.
- Commands that move cells or sheets (row or column insert, delete or move; sheet add, delete, rename, duplicate or move) and an undo that restores older bytes cannot be dispatched again safely. If any is unsent, the editor does not rebase. It turns read only, shows "Changed elsewhere", keeps its workbook as the local recovery copy (`surface/recovery.ts`, "Download my changes") and lists the unsent edits. Its Reload button says how many edits it discards.
- A command for a sheet the stored copy no longer has is not dispatched. It is listed, and the workbook from before the rebase is kept as the recovery copy until it is downloaded.
- The unsent cell and format edits are also kept in the tab's `sessionStorage` (the local draft), on every edit and when the page goes away. A reload inside the autosave delay puts them back on top of the stored copy and saves them. Edits that move cells or sheets are not kept in the draft; the leave prompt still covers them.

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
| Another tab or person saved first (`base_seq` refused, or their `sheet_saved` arrives) | The unsent commands are applied again on top of the stored copy and saved; per cell the last writer wins. If a command moved cells or sheets, the sheet becomes read only and asks the user to reload. Their unsent commands are listed so they can be re-entered, and the workbook is kept on the device |
| Page reloaded before the save went out | The unsent cell and format edits are read from the tab's local draft and saved |
| Edit access removed | Saving stops. The sheet becomes read only |

### Versions

Drive owns versions. Sheets answers Drive through the callbacks in `suite/sheets/drive.py`:

| Callback | Does |
| --- | --- |
| `version_bytes` | Returns the current snapshot envelope. A snapshot is written first if the log has moved past `snapshot_seq` |
| `restore_version` | Writes the version's envelope back to `sheets_data`, sets `snapshot_seq` to the new head, and writes a `restore` op |
| `used_nodes` | Reports media named in the body (A) or in `features` only (B: engine bytes are not scanned). Sheets has no media today |
| `import_from_file` | Makes a sheet from an uploaded .xlsx (every worksheet) or .csv (one sheet of its values). Drive's file menu and the "No preview" page offer it as "Open as spreadsheet". The editor converts the body on first open and saves it, with no upgrade notice and no "Before upgrade" version: the file stays in Drive |

## Constraints

- A snapshot always matches one `seq` exactly. Bytes and `snapshot_seq` are written together or not at all.
- With B, engine bytes are only read by the same or a newer IronCalc version. An upgrade must load bytes written by the previous pinned version (a test with a stored fixture).
- With A, loading a body and exporting it again gives the same JSON (a round-trip test).
- Browsers never write the body while collaboration is active ([003](003-collaboration.md)); the collab server does.
