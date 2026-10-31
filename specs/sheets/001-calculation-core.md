# Sheets: the calculation core

Status: proposed

Scope: how Sheets calculates. Which engine runs, where it runs, how a change reaches it, and how the grid reads results. Saving, collaboration and the grid itself are in [002](002-saving.md), [003](003-collaboration.md) and [004](004-canvas.md).

The engine choice is recorded in [ADR 0001](../../docs/adr/0001-sheets-ironcalc-calculation-core.md). This spec does not repeat its reasons.

Code (`fe/` means `frontend/src/apps/sheets/`): `fe/core/commands.ts`, `fe/core/workbook.ts`, `fe/core/worker.ts`, `fe/core/client.ts`, `fe/core/display-cache.ts`, `fe/core/cell-provider.ts`, `fe/core/limits.ts`.

## Behaviour

### One engine

IronCalc (`@ironcalc/wasm`, pinned at 0.8.4) is the only engine. It parses input, holds every cell, evaluates formulas and formats values for display.

The old engine is removed: `fe/engine/sheet.js`, `fe/engine/formula.js`, `fe/engine/deps.js`. There is no switch between engines and no import of workbooks saved by the old engine. Existing sheets data is not carried over.

### Where it runs

IronCalc runs in a Web Worker (`fe/core/worker.ts`). The page never waits for a calculation. The main thread holds no copy of the workbook, only what the grid has on screen (see "Reading values").

The worker answers five requests:

| Request | What it does |
| --- | --- |
| `init` | Creates the workbook, empty or from saved bytes (`Model.from_bytes`) |
| `apply` | Applies a list of commands, in order |
| `readViewport` | Returns display values and styles for a rectangle of cells |
| `readCells` | Returns display, input or style for listed cells |
| `toBytes` | Returns the workbook as bytes, for saving |

Every request carries a `reqId`. The client matches each answer to its request by that id.

### Changes are commands

Nothing changes the workbook except a command passed to `client.dispatch()`. A command is a JSON object with `id`, `actor`, `ts`, `type` and `payload`. Rows and columns are 1-based.

| Type | Changes |
| --- | --- |
| `setInput`, `setArrayFormula`, `clearContents` | Cell content |
| `setRangeStyle`, `setColumnsWidth`, `setRowsHeight`, `setFrozen` | Look and layout |
| `insertRows`, `deleteRows`, `insertColumns`, `deleteColumns`, `moveRows`, `moveColumns` | Structure. References in formulas shift |
| `addSheet`, `deleteSheet`, `renameSheet`, `duplicateSheet` | Sheets |
| `setDefinedName`, `deleteDefinedName` | Named ranges |
| `batch` | A list of the above, applied as one change |

`validateCommand()` checks the shape of every command, once in the client and again in the worker. A malformed command is refused before it reaches IronCalc.

### What one dispatch does

1. The client validates the command.
2. For `setInput`, the typed text is shown in the cell at once, before IronCalc answers.
3. The command joins a queue. Commands dispatched in the same task go out together in one `apply`.
4. Only one `apply` is in flight. Commands dispatched meanwhile wait for the next one.
5. The worker applies each command. A failure is reported for that command only; the rest still apply.
6. A `batch` recalculates once, after its last command.
7. A command that makes several IronCalc calls is rolled back as a whole if one of them fails.
8. Every applied `apply` raises the workbook **version** by one. The answer carries the new version.

### Reading values

The grid never asks the engine directly. It asks `fe/core/cell-provider.ts`:

1. `getDisplay(sheet, row, col)` answers from the display cache.
2. On a miss it returns `''` and records the cell.
3. After the paint, all missed cells go to the worker as one `readViewport`, with a margin around them. At most 100,000 cells per read (`MAX_VIEWPORT_CELLS`).
4. The answer fills the cache and the grid repaints.

On every version change the cache is cleared and the grid repaints, which refills the visible area. A read answered for an older version is dropped. The typed text from step 2 of a dispatch stays visible until its command is applied.

### Input parsing

IronCalc decides what typed text means. `1,000` is the number 1000, `$1,000` is currency, `50%` is 0.5, and dates are dates, as in Google Sheets.

## Constraints

- **Whole-workbook recalculation.** IronCalc has no dependency graph: every applied change recalculates every formula. ADR 0001 measured about 90 ms for 100,000 simple cells and about 9 s for heavy sheets. The worker keeps the page responsive; `batch` keeps paste, fill and load to one recalculation. Incremental recalculation is upstream work, not part of this spec.
- **Pinned engine.** An upgrade of `@ironcalc/wasm` must pass `fe/engine/difftest/ironcalc.test.ts` with agreement not below the 0.8.4 baseline.
- **No engine imports outside `fe/core/`.** Features and the grid reach the engine only through `client` and `cell-provider`.

## Acceptance

Each row is a test before it is called done.

| Input | Expected |
| --- | --- |
| `=AVERAGE(A1:A10)`, only A1:A3 filled | Average of the 3 values |
| `="abc"="xyz"` | FALSE |
| `=$A$1+1` | Works |
| `=2^3^2` | 64 |
| `=TODAY()+7` | A date 7 days ahead |
| `=SUM(A:A)` | Column total |
| Insert a row above a referenced cell | The reference shifts |
| Sort rows that contain formulas | Formulas move with their rows |
| Fill `=ATAN2(A1,B1)` down | `=ATAN2(A2,B2)` |
| Type `1,000`, then `=A1*2` | 2000 |
