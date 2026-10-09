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
 * Previews are written to the cells as they are picked, so the user sees the
 * real result. The original inputs are read once (and widened when a later
 * separator overflows further right); each preview is the original with the
 * split tokens on top, written as one edit.
 *
 * @param {{
 *   readInputs:     (rect: object, sheetName: string) => Promise<Record<string, string>>,
 *   writeInputs:    (sheetName: string, map: Record<string, string>) => void,
 *   getGrid:        () => object | null,
 *   getGridWrap:    () => HTMLElement | null,
 *   contextMenu:    { open: boolean },
 *   currentSheet:   import('vue').Ref<string>,
 *   pushEditOp:     (sheetName: string, before: object, after: object, summary: string) => void,
 *   blockProtected: (rect: object, sheetName: string) => boolean,
 * }} deps
 */
export function useSplitText({
  readInputs,
  writeInputs,
  getGrid,
  getGridWrap,
  contextMenu,
  currentSheet,
  pushEditOp,
  blockProtected, // (rect, sheet) => boolean — true (and flashes) if protected
}) {
  // Reactive state consumed by SplitTextPopover.vue
  const splitText = reactive({
    open: false,
    anchor: null, // { x, y } pixel position for the popover
    range: null, // { r0, c0, r1, c1 } — user's selection
    choice: 'auto', // active separator choice
    original: null, // { id → input } before the first preview
    writeRect: null, // widest rect any preview has written — needed for cancel
    current: null, // { id → input } the preview now in the cells
  })
  // Only the newest preview may write; picking separators fast fires several.
  let _previewSeq = 0

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
    splitText.current = null

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
    _preview('auto')
  }

  // ── separator-picker callbacks ──────────────────────────────────────────────

  function onSplitChoose(choice) {
    splitText.choice = typeof choice === 'string' ? choice : 'custom'
    _preview(choice)
  }

  // ── commit / cancel ─────────────────────────────────────────────────────────

  function onSplitApply() {
    // A preview still reading has not written anything yet: nothing to keep.
    _previewSeq++
    if (splitText.open && splitText.original && splitText.current) {
      const n = Object.keys(splitText.current).filter(
        (id) => splitText.current[id] !== (splitText.original[id] ?? ''),
      ).length
      pushEditOp(
        currentSheet.value,
        { ...splitText.original },
        { ...splitText.current },
        `Split text into ${n} cell${n === 1 ? '' : 's'}`,
      )
    }
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
    splitText.current = null
  }

  /**
   * Revert the live preview by writing the original inputs back.
   * No op log, no history push — the user never committed to anything.
   */
  function _revertSplitPreview() {
    _previewSeq++
    if (!splitText.original || !splitText.current) return
    writeInputs(currentSheet.value, { ...splitText.original })
    splitText.current = null
  }

  function _preview(choice) {
    _previewSplit(choice).catch((e) => console.error('[sheets] split preview failed', e))
  }

  /**
   * Render a live (non-committed) split preview using `choice` as the
   * separator hint. Always parses the original inputs, never a previous
   * preview's output.
   */
  async function _previewSplit(choice) {
    if (!splitText.range) return
    const mine = ++_previewSeq
    const subSheetName = currentSheet.value
    const selectionRange = splitText.range

    if (!splitText.original) {
      const original = await readInputs(selectionRange, subSheetName)
      if (mine !== _previewSeq) return
      splitText.original = original
      splitText.writeRect = { ...selectionRange }
    }

    // Collect source values for every cell in the selection, skipping formulas.
    const sourceCells = []
    for (let row = selectionRange.r0; row <= selectionRange.r1; row++) {
      for (let col = selectionRange.c0; col <= selectionRange.c1; col++) {
        const raw = splitText.original[cellId(row, col)] ?? ''
        sourceCells.push({ row, col, value: raw.startsWith('=') ? null : raw })
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

    // A wider split than any before: read the extra columns' originals. No
    // preview has written there yet, so the cells still hold them.
    if (newRect.c1 > splitText.writeRect.c1) {
      const extra = await readInputs(
        { r0: newRect.r0, r1: newRect.r1, c0: splitText.writeRect.c1 + 1, c1: newRect.c1 },
        subSheetName,
      )
      if (mine !== _previewSeq) return
      Object.assign(splitText.original, extra)
      splitText.writeRect.c1 = newRect.c1
    }

    // The original everywhere any preview wrote, so a narrower split clears a
    // wider one's tail, then the tokens left to right. When two selected cells
    // in the same row collide (cell A's overflow lands on cell B's column),
    // cell B's first token wins because it is processed second — same as
    // Google Sheets.
    const next = { ...splitText.original }
    for (const split of splits) {
      if (split.tokens == null) continue
      split.tokens.forEach((token, i) => {
        next[cellId(split.row, split.col + i)] = token != null ? String(token) : ''
      })
    }
    writeInputs(subSheetName, next)
    splitText.current = next
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
