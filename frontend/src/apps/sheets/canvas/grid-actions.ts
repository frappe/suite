// What the input modules (mouse, keyboard, editor, picker) share: selection
// moves with their side effects (scroll into view, repaint, tell the host),
// and the lookups they all need (merges, hidden rows, data edges, protection,
// the cross-sheet pick name).

import type { ViewModel } from '../core/view-model.js'
import { cellId, parseCellId } from '../utils/cells.js'
import type { Geometry } from './geometry.js'
import { jumpEdge, type Cell, type Selection, type SelRange } from './selection.js'
import type { CellProvider, CellValue, GridHost } from './types.js'
import type { Viewport } from './viewport.js'

export interface GridActionsOptions {
  vm: ViewModel
  geo: Pick<Geometry, 'rh' | 'cw'>
  vp: Pick<Viewport, 'ensureVisible'>
  sel: Selection
  cells: CellProvider
  host: GridHost
  getValue(id: string): CellValue
  cellIds(): string[]
  render(): void
}

export interface GridActions {
  /** The active cell's id, e.g. 'B3'. */
  activeId(): string
  /** Collapse the selection to (r, c), scroll to it, repaint, tell the host. */
  moveSel(r: number, c: number): void
  /** Move the selection's far corner to (r, c). */
  extendSel(r: number, c: number): void
  /** Restore a whole range (the context menu, Ctrl+A). */
  setSelRange(range?: Partial<SelRange>): void
  /** Run `cb` on every moveSel (the picker drops its highlight). */
  onMove(cb: () => void): void

  hasValue(r: number, c: number): boolean
  /** What the editor opens with: a formula's text, not its result. */
  editValue(r: number, c: number): string
  /** The sheet being picked from during a cross-sheet pick, else null. */
  crossSheetName(): string | null
  /** A cell inside a merge resolves to the merge's top-left cell. */
  resolveMaster(r: number, c: number): Cell
  /** Step past hidden rows/columns in direction d (±1), staying on the sheet. */
  skipHiddenRow(r: number, d: number): number
  skipHiddenCol(c: number, d: number): number
  /** Ctrl/Cmd+arrow target: the edge of the current data block. */
  jumpEdge(r: number, c: number, dr: number, dc: number): Cell
  /** Bottom-right of the used area. */
  lastUsedCell(): Cell
  /** False if any cell in the block is protected. */
  rangeEditable(r0: number, c0: number, r1: number, c1: number): boolean
}

export function createGridActions(o: GridActionsOptions): GridActions {
  const { vm, geo, vp, sel: S, cells, host } = o
  const moveListeners: (() => void)[] = []

  const activeId = (): string => cellId(S.anchor.r, S.anchor.c)
  const hasValue = (r: number, c: number): boolean => !!o.getValue(cellId(r, c))

  return {
    activeId,
    hasValue,

    moveSel(r, c) {
      S.moveTo(r, c)
      vp.ensureVisible(S.anchor.r, S.anchor.c)
      for (const cb of moveListeners) cb()
      o.render()
      host.onSelect?.(activeId())
    },

    extendSel(r, c) {
      S.extendTo(r, c)
      // A whole-column selection's head sits on the last row; scrolling to
      // it on Shift+Right would jump to the bottom. Same for rows.
      if (S.mode === 'col') vp.ensureVisible(0, S.head.c)
      else if (S.mode === 'row') vp.ensureVisible(S.head.r, 0)
      else vp.ensureVisible(S.head.r, S.head.c)
      o.render()
      // Re-sent so collaborators' cursors see the extended range.
      host.onSelect?.(activeId())
    },

    setSelRange(range = {}) {
      const { r0, c0, r1, c1, mode } = range
      if (r0 == null || c0 == null || r1 == null || c1 == null) return
      S.set({ r0, c0, r1, c1, mode: mode || 'cell' })
      o.render()
      host.onSelect?.(activeId())
    },

    onMove: (cb) => {
      moveListeners.push(cb)
    },

    editValue(r, c) {
      const id = cellId(r, c)
      const v = cells.getEditValue ? cells.getEditValue(id) : o.getValue(id)
      return v == null ? '' : String(v)
    },

    // A formula on one sheet picking cells on another writes `Sheet2!A1`.
    crossSheetName() {
      const cur = host.getCurrentSheet?.()
      const home = host.getEditingHomeSheet?.()
      return home && cur && cur !== home ? cur : null
    },

    resolveMaster(r, c) {
      const mid = cells.getMasterId?.(cellId(r, c))
      const p = mid ? parseCellId(mid) : null
      return p ? { r: p.row, c: p.col } : { r, c }
    },

    skipHiddenRow(r, d) {
      while (r >= 0 && r < vm.totalRows && geo.rh(r) === 0) r += d
      return Math.max(0, Math.min(vm.totalRows - 1, r))
    },
    skipHiddenCol(c, d) {
      while (c >= 0 && c < vm.totalCols && geo.cw(c) === 0) c += d
      return Math.max(0, Math.min(vm.totalCols - 1, c))
    },

    jumpEdge: (r, c, dr, dc) =>
      jumpEdge({ r, c }, dr, dc, hasValue, vm.totalRows - 1, vm.totalCols - 1),

    lastUsedCell() {
      let r = 0,
        c = 0
      for (const id of o.cellIds()) {
        const p = parseCellId(id)
        if (p) {
          r = Math.max(r, p.row)
          c = Math.max(c, p.col)
        }
      }
      return { r, c }
    },

    rangeEditable(r0, c0, r1, c1) {
      if (!cells.isCellEditable) return true
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) if (!cells.isCellEditable(r, c)) return false
      return true
    },
  }
}
