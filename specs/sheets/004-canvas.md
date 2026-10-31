# Sheets: the grid

Status: proposed

Scope: how the grid is built and how it responds to mouse and keyboard. The target for every interaction is Google Sheets' behaviour. Values come from the calculation core in [001](001-calculation-core.md).

Code: `frontend/src/apps/sheets/canvas/` and `frontend/src/apps/sheets/core/view-model.ts`.

## Structure

The grid is one `<canvas>`. Only visible cells are drawn. A real `<textarea>` is placed over a cell while it is being edited.

`canvas/index.ts` (`createGrid`) creates the modules below, connects them, and returns the API the editor uses (`canvas/types.ts`).

| Module | Job |
| --- | --- |
| `viewport.ts` | Visible area, scroll position, canvas pixel size |
| `render-loop.ts` | Collapses repaint requests into one paint per frame |
| `renderer.ts`, `painters/` | Draw cells, grid lines, headers, selection |
| `geometry.ts` | Cell ↔ pixel |
| `selection.ts` | Which cells are selected and how the selection moves |
| `grid-actions.ts` | Moves shared by the input modules: move, scroll into view, repaint, tell the host |
| `input/mouse.ts`, `input/keyboard.ts` | Pointer and keys on the grid |
| `input/editor.ts` | The in-cell editor: open, commit, cancel |
| `input/range-picker.ts` | Cell references while a formula is typed |
| `input/autocomplete.ts` | Function suggestions while a formula is typed |
| `input/fill-handle.ts`, `input/drag.ts` | Fill handle; column and row resize and move |
| `overlay.ts`, `scrollbars.ts`, `marching-ants.ts`, `autofit.ts` | Editor placement, scrollbars, copy border, fit to contents |
| `core/view-model.ts` | View state of a sheet: widths, heights, scroll, freeze, hidden rows, zoom, selection |

Rules:
- The grid reads cells only through the `CellProvider` and asks the editor for everything else through `GridHost` (`types.ts`).
- Every module is strict TypeScript and under 400 lines, with a test next to it.

## Behaviour

### Selecting and typing

| Action | Result |
| --- | --- |
| Click a cell | Selects it. The grid has keyboard focus |
| Type after one click | Replaces the cell's content |
| Backspace or Delete | Clears the selected cells |
| Arrow keys | Move the selection. In a frozen column, the view scrolls with it |
| Shift + arrow or Shift + click | Extends the selection |

### Editing a cell

| Action | Result |
| --- | --- |
| Double-click, F2, or Enter on a filled cell | Opens the editor with the cell's **input**: a formula shows its `=…` text, not its result |
| Click away or Enter | Commits |
| Escape | Cancels; the cell keeps its old content |

The editor has two modes:

| Mode | Entered by | Arrow keys |
| --- | --- | --- |
| Enter | Typing into a cell | Pick a cell reference where one can go, otherwise commit and move |
| Edit | Double-click, F2, Enter | Move the caret in the text |

F2 while editing switches between the two modes, and a click inside the editor's text switches to Edit mode.

### Formula references

While a formula is typed, a click or arrow key inserts a reference **only where one can go**: right after `=`, `(`, `,`, `;`, an operator (`+ - * / ^ & < >`) or `{`. Anywhere else, a click commits the formula and selects the clicked cell.

| Action | Result |
| --- | --- |
| Click a cell | Inserts its reference (`A1`), or replaces the reference just inserted |
| Click another cell | Replaces that reference (`A3`, not `A1:A3`) |
| Shift + click, or drag | Inserts a range (`A1:A3`) |
| Click a cell on another sheet | Inserts `Sheet2!A1` (`'My Sheet'!A1` when the name needs quotes) |

### Clipboard

| Focus | Ctrl+C / Ctrl+X / Ctrl+V |
| --- | --- |
| Grid | Copy, cut or paste cells |
| In-cell editor or formula bar | Copy, cut or paste text in that field |

### Display

- Browser zoom or moving to a monitor with a different pixel ratio redraws the grid at the correct scale.

## Constraints

- The grid must accept keyboard focus (`tabindex` on the canvas). A test focuses it the way a browser does, not only by dispatching events.
- Input behaviour that differs from Google Sheets is a bug unless this spec says otherwise.
