import { reactive } from 'vue'

import { parseRow, resolveSeparator } from '../../engine/split-text.js'
import { cellId } from '../../utils/cells.js'

/**
 * Manages the Split Text to Columns feature: preview, apply, and cancel.
 *
 * The flow is:
 *   1. `doSplitTextToColumns` opens the popover and runs an immediate preview.
 *   2. `onSplitChoose` re-runs the preview each time the user picks a separator.
 *   3. `onSplitApply` commits the current preview to an op and closes.
 *   4. `onSplitCancel` (or Esc / outside-click) reverts to the original values.
 *
 * @param {{
 *   getSheet:       () => object,
 *   getGrid:        () => object | null,
 *   getGridWrap:    () => HTMLElement | null,
 *   contextMenu:    { open: boolean },
 *   currentSheet:   import('vue').Ref<string>,
 *   queueOp:        (op: object) => void,
 *   markEdited:     () => void,
 *   repopulateGrid: () => void,
 *   syncFlags:      () => void,
 *   captureRange:   (rect: object, sheetName: string) => Record<string, any>,
 *   diffRefs:       (before: object, after: object) => string[],
 * }} deps
 */
export function useSplitText({
  getSheet,
  getGrid,
  getGridWrap,
  contextMenu,
  currentSheet,
  queueOp,
  markEdited,
  repopulateGrid,
  syncFlags,
  captureRange,
  diffRefs,
  blockProtected, // (rect, sheet) => boolean — true (and flashes) if protected
}) {
  // Reactive state consumed by SplitTextPopover.vue
  const splitText = reactive({
    open: false,
    anchor: null, // { x, y } pixel position for the popover
    range: null, // { r0, c0, r1, c1 } — user's selection
    choice: 'auto', // active separator choice
    original: null, // { id → value } snapshot before the first preview
    writeRect: null, // widest rect any preview has written — needed for cancel
  })

  // ── public entry-point ──────────────────────────────────────────────────────

  function doSplitTextToColumns() {
    contextMenu.open = false
    const grid = getGrid()
    if (!grid) return
    const range = grid.getSelection()
    if (!range) return

    splitText.range = { ...range }
    splitText.choice = 'auto'
    splitText.original = null
    splitText.writeRect = null

    const rect = grid.getCellRect?.(range.r0, range.c0)
    if (rect) {
      const POP_W = 248,
        POP_H = 340
      const wrap = getGridWrap?.()
      const wrapW = wrap?.offsetWidth ?? Infinity
      const wrapH = wrap?.offsetHeight ?? Infinity
      const ax = Math.min(rect.x, wrapW - POP_W - 4)
      const ay = rect.y + rect.height + POP_H > wrapH ? rect.y - POP_H : rect.y + rect.height
      splitText.anchor = { x: Math.max(0, ax), y: Math.max(0, ay) }
    } else {
      splitText.anchor = null
    }
    splitText.open = true

    // Show a live preview immediately so the user can compare separators.
    _previewSplit('auto')
  }

  // ── separator-picker callbacks ──────────────────────────────────────────────

  function onSplitChoose(choice) {
    splitText.choice = typeof choice === 'string' ? choice : 'custom'
    _previewSplit(choice)
  }

  // ── commit / cancel ─────────────────────────────────────────────────────────

  function onSplitApply() {
    if (!splitText.open || !splitText.writeRect || !splitText.original) {
      splitText.open = false
      return
    }
    const sheet = getSheet()
    const subSheetName = currentSheet.value
    const after = captureRange(splitText.writeRect, subSheetName)
    const before = splitText.original
    const refs = diffRefs(before, after)

    if (refs.length) {
      queueOp({
        opType: 'edit',
        subSheet: subSheetName,
        cellRefs: refs,
        before,
        after,
        summary: `Split text into ${refs.length} cell${refs.length === 1 ? '' : 's'}`,
      })
    }
    markEdited()
    _closeSplit()
  }

  function onSplitCancel() {
    _revertSplitPreview()
    _closeSplit()
  }

  // ── internal helpers ────────────────────────────────────────────────────────

  function _closeSplit() {
    splitText.open = false
    splitText.range = null
    splitText.original = null
    splitText.writeRect = null
  }

  /**
   * Revert the live preview by writing the captured original snapshot back.
   * No op log, no history push — the user never committed to anything.
   */
  function _revertSplitPreview() {
    if (!splitText.original) return
    const sheet = getSheet()
    const subSheetName = currentSheet.value
    for (const [id, value] of Object.entries(splitText.original)) {
      sheet.setCell(id, value == null ? '' : value, subSheetName)
    }
    repopulateGrid()
    syncFlags()
  }

  /**
   * Render a live (non-committed) split preview using `choice` as the
   * separator hint.  Called on open and every time the user changes the
   * separator radio button.
   *
   * The first call captures `splitText.original` so subsequent calls always
   * parse the user's original cell values — not the previous preview output.
   * If a new separator produces a wider split than the first preview, the
   * snapshot is grown to cover the extra columns so Cancel can restore them.
   */
  function _previewSplit(choice) {
    if (!splitText.range) return
    const sheet = getSheet()
    const subSheetName = currentSheet.value
    const selectionRange = splitText.range

    // Collect source values for every cell in the selection.  When a snapshot
    // exists we always read from it so toggling separators parses the original
    // input, not a previous preview output.
    const sourceCells = []
    for (let row = selectionRange.r0; row <= selectionRange.r1; row++) {
      for (let col = selectionRange.c0; col <= selectionRange.c1; col++) {
        const id = cellId(row, col)
        const raw = splitText.original ? splitText.original[id] : sheet.getCell(id, subSheetName)

        if (typeof raw === 'string' && raw.startsWith('=')) {
          sourceCells.push({ row, col, value: null }) // skip formula cells
        } else {
          sourceCells.push({ row, col, value: raw == null ? '' : String(raw) })
        }
      }
    }

    const separator = resolveSeparator(
      sourceCells.filter((cell) => cell.value != null).map((cell) => cell.value),
      choice,
    )

    // Split each source cell independently — first token replaces the source,
    // remaining tokens overflow rightward.  This matches Google Sheets'
    // multi-column behaviour: every selected cell becomes its own split.
    const splits = sourceCells.map((cell) => ({
      ...cell,
      tokens: cell.value == null ? null : parseRow(cell.value, separator),
    }))

    // The write rect spans the selection plus any rightward overflow from the
    // widest split.
    let maximumColumn = selectionRange.c1
    for (const split of splits) {
      if (split.tokens) {
        maximumColumn = Math.max(maximumColumn, split.col + split.tokens.length - 1)
      }
    }
    const newRect = {
      r0: selectionRange.r0,
      r1: selectionRange.r1,
      c0: selectionRange.c0,
      c1: maximumColumn,
    }

    // Refuse if the split (source + rightward overflow) touches a protected
    // cell. Revert any prior preview and close so nothing is left half-written.
    if (blockProtected?.(newRect, subSheetName)) {
      _revertSplitPreview()
      _closeSplit()
      return
    }

    // Capture original snapshot once; grow it if a later preview overflows
    // further right than the first one.
    if (!splitText.original) {
      splitText.original = captureRange(newRect, subSheetName)
      splitText.writeRect = { ...newRect }
    } else if (newRect.c1 > splitText.writeRect.c1) {
      const extraColumns = captureRange(
        {
          r0: selectionRange.r0,
          r1: selectionRange.r1,
          c0: splitText.writeRect.c1 + 1,
          c1: newRect.c1,
        },
        subSheetName,
      )
      Object.assign(splitText.original, extraColumns)
      splitText.writeRect.c1 = newRect.c1
    }

    // Restore snapshot before writing the new preview so prior (wider) splits
    // don't leave stale tokens at the tail end.
    for (const [id, value] of Object.entries(splitText.original)) {
      sheet.setCell(id, value == null ? '' : value, subSheetName)
    }

    // Write splits left-to-right.  When two selected cells in the same row
    // collide (cell A's overflow lands on cell B's column), cell B's first
    // token wins because it is processed second — same as Google Sheets.
    for (const split of splits) {
      if (split.tokens == null) continue
      for (let tokenIndex = 0; tokenIndex < split.tokens.length; tokenIndex++) {
        const id = cellId(split.row, split.col + tokenIndex)
        const token = split.tokens[tokenIndex]
        sheet.setCell(id, token != null ? token : '', subSheetName)
      }
    }

    // Force canvas refresh — sheet.setCell only pokes the engine; without
    // this, single-column previews can land in the data model but never
    // repaint until the user clicks or scrolls.
    repopulateGrid()
    syncFlags()
  }

  return {
    splitText,
    doSplitTextToColumns,
    onSplitChoose,
    onSplitApply,
    onSplitCancel,
    revertSplitPreview: _revertSplitPreview,
    closeSplit: _closeSplit,
  }
}
