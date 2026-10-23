// Keyboard input on the grid (no editor open): moving and extending the
// selection, starting an edit, clearing cells. Also arrow-key reference
// picking for the formula bar.
//
// Keys, matching Google Sheets:
//   arrows move (Shift extends, Ctrl/Cmd jumps to the data edge),
//   Tab / Enter move along a row and back to its first column,
//   PageUp / PageDown move a screenful, Ctrl/Cmd+Home / End go to the corners,
//   Ctrl/Cmd+A selects the data, then everything,
//   Shift / Ctrl+Space select rows / columns,
//   Enter or F2 edits the cell, a printable key starts typing into it,
//   Delete / Backspace clears the selection.
//
// The in-cell editor handles its own keys (editor.ts); this module also owns
// the "Tab run" column that Enter returns to, for both.

import { cellId, colLabel } from '../../utils/cells.js'
import type { Cell, Selection, SelRange } from '../selection.js'
import type { Editor, LeaveMove } from './editor.js'
import type { RangePicker } from './range-picker.js'

export interface KeyboardHost {
  onSelect?(label: string): void
  onCommit?(id: string, value: string): void
  onBatchCommit?(cells: { id: string; value: string }[]): void
  onBlockedEdit?(): void
}

export interface KeyboardOptions {
  canvas: HTMLElement
  /** The in-cell editor's textarea; its keys are its own. */
  editorElement: HTMLElement
  picker: Pick<
    RangePicker,
    'target' | 'isKeyPicking' | 'keyStart' | 'keyMove' | 'keyCommit' | 'keyCancel'
  >
  editor: Pick<Editor, 'open'>
  sel: Selection
  host: KeyboardHost
  totalRows(): number
  totalCols(): number
  canEdit(): boolean
  /** False if any cell in the block is protected. */
  rangeEditable(r0: number, c0: number, r1: number, c1: number): boolean
  moveSel(r: number, c: number): void
  extendSel(r: number, c: number): void
  setSelRange(range: SelRange): void
  /** Ctrl/Cmd+arrow target: the edge of the data block. */
  jumpEdge(r: number, c: number, dr: number, dc: number): Cell
  /** Bottom-right of the used area. */
  lastUsedCell(): Cell
  hasValue(r: number, c: number): boolean
  skipHiddenRow(r: number, dr: number): number
  skipHiddenCol(c: number, dc: number): number
  /** Rows in one screenful, for PageUp / PageDown. */
  pageRows(): number
  /** The text an edit opens with (formula, not result). */
  editValue(r: number, c: number): string
  /** Drop cleared cells from the grid's local value cache. */
  forgetCells(ids: readonly string[]): void
  render(): void
}

export interface Keyboard {
  /** The editor committed with Enter / Tab / an arrow: move the selection. */
  afterEdit(move: LeaveMove): void
  /** End the Tab run (a click or any other move). */
  resetTabAnchor(): void
  destroy(): void
}

const ARROWS: { readonly [key: string]: readonly [number, number] } = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

export function createKeyboard(o: KeyboardOptions): Keyboard {
  const { canvas, picker, sel: S, host } = o
  // Column where the current run of Tabs started; Enter returns to it.
  let tabAnchorCol: number | null = null

  function afterEdit(move: LeaveMove): void {
    const { r, c } = S.anchor
    if (move.kind === 'arrow') {
      o.moveSel(r + move.dr, c + move.dc)
    } else if (move.kind === 'enter') {
      const col = tabAnchorCol ?? c
      tabAnchorCol = null
      o.moveSel(r + 1, col)
    } else {
      if (tabAnchorCol === null) tabAnchorCol = c
      o.moveSel(r, move.back ? c - 1 : c + 1)
    }
  }

  // Ctrl/Cmd+A: the data block (A1 to the last used cell) first, the whole
  // sheet on a second press or when the sheet is empty.
  function selectAll(): void {
    const last = o.lastUsedCell()
    const hasData = last.r > 0 || last.c > 0 || o.hasValue(0, 0)
    const cur = S.range()
    const onData = hasData && cur.r0 === 0 && cur.c0 === 0 && cur.r1 === last.r && cur.c1 === last.c
    if (!hasData || onData)
      o.setSelRange({ r0: 0, c0: 0, r1: o.totalRows() - 1, c1: o.totalCols() - 1, mode: 'all' })
    else o.setSelRange({ r0: 0, c0: 0, r1: last.r, c1: last.c, mode: 'cell' })
  }

  function clearSelection(): void {
    if (!o.canEdit()) return
    const { r0, c0, r1, c1 } = S.range()
    // Check before touching the local cache, or a blocked clear would leave
    // the grid showing empty cells the engine still holds.
    if (!o.rangeEditable(r0, c0, r1, c1)) {
      host.onBlockedEdit?.()
      return
    }
    if (r0 === r1 && c0 === c1) {
      host.onCommit?.(cellId(S.anchor.r, S.anchor.c), '')
      return
    }
    const cells: { id: string; value: string }[] = []
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) cells.push({ id: cellId(r, c), value: '' })
    host.onBatchCommit?.(cells)
    o.forgetCells(cells.map((x) => x.id))
    o.render()
  }

  // Shift+Space: rows; Ctrl/Cmd+Space: columns; both: the sheet. The anchor
  // stays on the active cell so arrows and typing carry on from there.
  function selectLines(e: KeyboardEvent, mod: boolean): boolean {
    const { r, c } = S.anchor
    const { r: er, c: ec } = S.head
    if (mod && e.shiftKey) {
      S.mode = 'all'
      S.anchor = { r: 0, c: 0 }
      S.head = { r: o.totalRows() - 1, c: o.totalCols() - 1 }
      o.render()
      host.onSelect?.('A1')
    } else if (mod) {
      S.mode = 'col'
      S.anchor = { r, c }
      S.head = { r, c: ec }
      o.render()
      host.onSelect?.(colLabel(Math.min(c, ec)) + ':' + colLabel(Math.max(c, ec)))
    } else if (e.shiftKey) {
      S.mode = 'row'
      S.anchor = { r, c }
      S.head = { r: er, c }
      o.render()
      host.onSelect?.(`${Math.min(r, er) + 1}:${Math.max(r, er) + 1}`)
    } else {
      return false
    }
    e.preventDefault()
    return true
  }

  function onGridKey(e: KeyboardEvent): void {
    const { r, c } = S.anchor
    const { r: er, c: ec } = S.head
    const mod = e.ctrlKey || e.metaKey
    const arrow = ARROWS[e.key]

    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      selectAll()
      return
    }

    if (mod && arrow) {
      e.preventDefault()
      tabAnchorCol = null
      const [dr, dc] = arrow
      if (e.shiftKey) {
        const t = o.jumpEdge(er, ec, dr, dc)
        o.extendSel(t.r, t.c)
      } else {
        const t = o.jumpEdge(r, c, dr, dc)
        o.moveSel(t.r, t.c)
      }
      return
    }

    if (mod && e.key === 'Home') {
      e.preventDefault()
      if (e.shiftKey) o.extendSel(0, 0)
      else o.moveSel(0, 0)
      return
    }
    if (mod && e.key === 'End') {
      e.preventDefault()
      const last = o.lastUsedCell()
      if (e.shiftKey) o.extendSel(last.r, last.c)
      else o.moveSel(last.r, last.c)
      return
    }

    if (e.shiftKey && !mod && arrow) {
      e.preventDefault()
      tabAnchorCol = null
      o.extendSel(er + arrow[0], ec + arrow[1])
      return
    }

    if (e.key === 'F2') {
      e.preventDefault()
      o.editor.open(o.editValue(r, c), 'edit')
      return
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault()
      clearSelection()
      return
    }

    // Before the printable-key check, so Space isn't typed into the cell.
    if ((e.code === 'Space' || e.key === ' ') && selectLines(e, mod)) return

    // One screenful (the rows visible now, so it tracks zoom and heights).
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      tabAnchorCol = null
      const dir = e.key === 'PageDown' ? 1 : -1
      const target = o.skipHiddenRow((e.shiftKey ? er : r) + dir * o.pageRows(), dir)
      if (e.shiftKey) o.extendSel(target, ec)
      else o.moveSel(target, c)
      return
    }

    if (e.key.length === 1 && !mod) {
      e.preventDefault()
      o.editor.open(e.key)
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (tabAnchorCol === null) tabAnchorCol = c
      const dc = e.shiftKey ? -1 : 1
      o.moveSel(r, o.skipHiddenCol(c + dc, dc))
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      // A plain Enter on one cell edits it (the second Enter, inside the
      // editor, moves down). Shift/modified Enter, a range or a viewer
      // keep Enter as navigation, so moving never depends on write access.
      const { r0, c0, r1, c1 } = S.range()
      if (r0 === r1 && c0 === c1 && !e.shiftKey && !mod && !e.altKey && o.canEdit()) {
        o.editor.open(o.editValue(r, c), 'edit')
        return
      }
      const col = tabAnchorCol ?? c
      tabAnchorCol = null
      const dr = e.shiftKey ? -1 : 1
      o.moveSel(o.skipHiddenRow(r + dr, dr), col)
      return
    }

    if (arrow) {
      e.preventDefault()
      tabAnchorCol = null
      const [dr, dc] = arrow
      // Step over hidden rows/columns (e.g. a filter gap) to the next visible one.
      const tr = dr !== 0 ? o.skipHiddenRow(r + dr, dr) : r
      const tc = dc !== 0 ? o.skipHiddenCol(c + dc, dc) : c
      o.moveSel(tr, tc)
    }
  }

  // Arrow-key picking for the formula bar. The in-cell editor does its own
  // (editor.ts), so its keys are skipped. Runs in the capture phase, ahead of
  // the input's own handlers.
  function onFormulaBarKey(e: KeyboardEvent): void {
    if (e.target === o.editorElement) return
    const target = picker.target()
    if (!target) return
    // Home/End always move the text caret.
    if (e.key === 'Home' || e.key === 'End') return
    const arrow = ARROWS[e.key]

    if (picker.isKeyPicking(target)) {
      if (arrow) {
        e.preventDefault()
        e.stopPropagation()
        picker.keyMove(arrow[0], arrow[1], e.shiftKey, e.ctrlKey || e.metaKey)
        return
      }
      if (e.key === 'Escape') {
        // Cancel the pick; editing carries on.
        e.preventDefault()
        e.stopPropagation()
        picker.keyCancel()
        return
      }
      // Any other key ends the pick and reaches the input as usual
      // (Enter / Tab then commit the formula).
      picker.keyCommit()
      return
    }

    // In a `=…` input every arrow picks; keyStart decides replace vs insert.
    if (arrow) {
      e.preventDefault()
      e.stopPropagation()
      picker.keyStart(target, arrow[0], arrow[1], e.shiftKey)
    }
  }

  canvas.addEventListener('keydown', onGridKey)
  document.addEventListener('keydown', onFormulaBarKey, true)

  return {
    afterEdit,
    resetTabAnchor: () => {
      tabAnchorCol = null
    },
    destroy: () => document.removeEventListener('keydown', onFormulaBarKey, true),
  }
}
