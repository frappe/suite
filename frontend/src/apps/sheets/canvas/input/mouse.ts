// Mouse input on the grid: what a press, drag, release, double-click, hover
// or wheel does.
//
// A press asks hit-test.ts what is under the pointer and starts one of:
//   a formula pick (when a `=…` input is focused, every click picks),
//   a column/row resize, a fill-handle drag, a column move,
//   a header/corner selection, or a cell selection drag.
// Moves and the release finish whichever one started. Resizes and column
// moves listen on the document, so they keep tracking outside the canvas.
//
// Rows and columns are 0-based. Pixel deltas are divided by zoom before
// they touch widths and heights, which are stored in logical units.

import { cellId, colLabel } from '../../utils/cells.js'
import { checkboxRect } from '../checkbox-geometry.js'
import type { Cell, Selection, SelRange } from '../selection.js'
import type { Editor } from './editor.js'
import type { CanvasRect, HitGeometry, HitTester } from './hit-test.js'
import type { RangePicker } from './range-picker.js'

export interface MouseGeometry extends Pick<
  HitGeometry,
  | 'hitTest'
  | 'hitTestColResize'
  | 'hitTestRowResize'
  | 'hitTestColHeader'
  | 'colX'
  | 'rowY'
  | 'cw'
  | 'rh'
> {
  /** The column a dragged column would be dropped before. */
  colInsertIndex(ex: number, rect: CanvasRect): number
}

export interface CellBlock {
  r0: number
  c0: number
  r1: number
  c1: number
}

/** A data-validation rule; only its type matters here. */
export interface ValidationRule {
  readonly type: string
}

/** Where a list dropdown opens, in page pixels. */
export interface DropdownPos {
  x: number
  y: number
  w: number
}

export interface LinkHover {
  r: number
  c: number
  id: string
  url: string
}

/** A column header press that may become a drag to move columns. */
export interface ColDrag {
  fromCol: number
  count: number
  startX: number
  startY: number
  moved: boolean
  insertCol: number | null
}

/** What the host (SheetEditor) is told. All optional, as in createGrid. */
export interface MouseHost {
  onSelect?(label: string): void
  onHyperlinkClick?(url: string): void
  onCheckboxToggle?(id: string): void
  onDropdownClick?(id: string, rule: ValidationRule, pos: DropdownPos): void
  onFill?(src: CellBlock, total: SelRange, opts: { withModifier: boolean }): void
  /** True when the host turned the double-click into a pivot drill-down. */
  onPivotDrill?(r: number, c: number): boolean | undefined
  onLinkHover?(info: LinkHover | null): void
  onColMove?(fromCol: number, toCol: number, count: number): void
  onResizeEnd?(): void
}

export interface MouseOptions {
  canvas: HTMLCanvasElement
  geo: MouseGeometry
  hits: HitTester
  picker: Pick<
    RangePicker,
    'target' | 'pickColumn' | 'pickRow' | 'pickCell' | 'isDragging' | 'dragTo' | 'endDrag'
  >
  editor: Pick<Editor, 'isOpen' | 'commit' | 'open'>
  sel: Selection
  host: MouseHost
  getZoom(): number
  totalRows(): number
  totalCols(): number
  canEdit(): boolean
  moveSel(r: number, c: number): void
  extendSel(r: number, c: number): void
  /** A plain click ends a Tab run (Enter no longer returns to its column). */
  resetTabAnchor(): void
  /** A merged cell's master, or the cell itself. */
  resolveMaster(r: number, c: number): Cell
  /** The sheet being picked from, when it isn't the formula's own sheet. */
  crossSheetName(): string | null
  /** The text a double-click opens the editor with (formula, not result). */
  editValue(r: number, c: number): string
  hyperlinkAt(r: number, c: number): string | undefined
  validationAt(r: number, c: number): ValidationRule | null | undefined
  hasValue(r: number, c: number): boolean
  colWidth(c: number): number
  rowHeight(r: number): number
  /** Set every listed column to `w` and re-layout. */
  setColWidths(cols: readonly number[], w: number): void
  setRowHeights(rows: readonly number[], h: number): void
  autoFitCol(c: number): void
  autoFitRow(r: number): void
  /** Scroll by a logical delta. */
  scrollBy(dx: number, dy: number): void
  render(): void
}

export interface Mouse {
  /** The column drag in progress, for the renderer; null unless moved. */
  colDrag(): ColDrag | null
  /** The selection as it was before the last press (the context menu restores it). */
  preMousedownSel(): SelRange | null
  /** Remove the document listeners. */
  destroy(): void
}

/** Minimum pointer travel, in px, before a press counts as a drag. */
const FILL_DRAG_THRESHOLD = 4
const COL_DRAG_THRESHOLD = 5
const LIST_CLICK_SLOP = 4
const MIN_COL_W = 30
const MIN_ROW_H = 16

/**
 * Double-clicking the fill handle fills down as far as the neighbouring
 * column's data goes (left neighbour first, then right), Google Sheets'
 * rule. Returns the last row to fill; `src.r1` when there is nothing to follow.
 */
export function autoFillDownExtent(
  src: CellBlock,
  hasValue: (r: number, c: number) => boolean,
  totalRows: number,
  totalCols: number,
): number {
  const filled = (r: number, c: number): boolean =>
    r >= 0 && r < totalRows && c >= 0 && c < totalCols && hasValue(r, c)
  let guide: number | null = null
  if (filled(src.r1 + 1, src.c0 - 1)) guide = src.c0 - 1
  else if (filled(src.r1 + 1, src.c1 + 1)) guide = src.c1 + 1
  if (guide === null) return src.r1
  let r = src.r1 + 1
  while (r < totalRows && filled(r, guide)) r++
  return r - 1
}

// Every column (or row) a resize applies to: the whole sheet, the selected
// block when the dragged edge is inside it, or just the one.
function resizeTargets(
  i: number,
  inBlock: boolean,
  all: boolean,
  lo: number,
  hi: number,
  total: number,
): number[] {
  if (all) return Array.from({ length: total }, (_, k) => k)
  if (inBlock) return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)
  return [i]
}

export function createMouse(o: MouseOptions): Mouse {
  const { canvas, geo, hits, picker, editor, sel: S, host } = o

  let dragging = false
  let resizing: { cols: number[]; startX: number; startW: number } | null = null
  let resizingRow: { rows: number[]; startY: number; startH: number } | null = null
  let filling: { src: CellBlock; startX: number; startY: number; moved: boolean } | null = null
  let colDrag: ColDrag | null = null
  let preSel: SelRange | null = null
  // A plain click in a list-validated cell opens its dropdown on release, so
  // a drag (selection) or a double-click (edit) can still cancel it.
  let pendingListOpen: {
    id: string
    rule: ValidationRule
    r: number
    c: number
    downX: number
    downY: number
    pos: DropdownPos
  } | null = null
  let lastLinkHover: string | null = null // 'r,c' of the linked cell under the pointer

  const rectOf = (): CanvasRect => canvas.getBoundingClientRect()

  function selectWhole(mode: 'all' | 'row', anchor: Cell, head: Cell, label: string): void {
    editor.commit()
    S.mode = mode
    S.anchor = anchor
    S.head = head
    canvas.focus()
    o.render()
    host.onSelect?.(label)
  }

  function onMouseDown(e: MouseEvent): void {
    const rect = rectOf()
    // Snapshot before anything below changes the selection; the context
    // menu restores it when a right-click collapsed a range.
    preSel = S.range()

    // Right-click inside the selection keeps it, so the context menu acts on
    // the whole range. Outside it, the click selects that cell first.
    if (e.button === 2) {
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h && h.r >= preSel.r0 && h.r <= preSel.r1 && h.c >= preSel.c0 && h.c <= preSel.c1) {
        canvas.focus()
        return
      }
    }

    // While a `=…` formula is focused (in-cell or formula bar), every click
    // inserts a reference instead of committing a half-typed formula.
    const pickInput = picker.target()
    if (pickInput) {
      e.preventDefault()
      const hit = hits.at(e.clientX, e.clientY, rect)
      if (hit.kind === 'colHeader') {
        picker.pickColumn(pickInput, hit.col)
        return
      }
      if (hit.kind === 'rowHeader') {
        picker.pickRow(pickInput, hit.row)
        return
      }
      if (hit.kind !== 'cell') return
      // Clicking the cell being edited is a no-op on its own sheet; on
      // another sheet the same cell is a valid cross-sheet reference.
      const a = S.anchor
      if (editor.isOpen() && hit.r === a.r && hit.c === a.c && !o.crossSheetName()) return
      const m = o.resolveMaster(hit.r, hit.c)
      picker.pickCell(pickInput, m.r, m.c, e.shiftKey)
      return
    }

    // Resize edges and the fill handle exist only for editors; for a viewer
    // the press falls through to the header or cell underneath.
    const hit = hits.at(e.clientX, e.clientY, rect, { resize: o.canEdit(), fill: o.canEdit() })
    const range = S.range()

    switch (hit.kind) {
      case 'colResize': {
        e.preventDefault()
        const inBlock = S.mode === 'col' && hit.col >= range.c0 && hit.col <= range.c1
        const cols = resizeTargets(
          hit.col,
          inBlock,
          S.mode === 'all',
          range.c0,
          range.c1,
          o.totalCols(),
        )
        resizing = { cols, startX: e.clientX, startW: o.colWidth(hit.col) }
        return
      }
      case 'rowResize': {
        e.preventDefault()
        const inBlock = S.mode === 'row' && hit.row >= range.r0 && hit.row <= range.r1
        const rows = resizeTargets(
          hit.row,
          inBlock,
          S.mode === 'all',
          range.r0,
          range.r1,
          o.totalRows(),
        )
        resizingRow = { rows, startY: e.clientY, startH: o.rowHeight(hit.row) }
        return
      }
      case 'fillHandle': {
        // Remember where the press started, so sub-pixel jitter during a
        // click (or the first half of a double-click) isn't a fill.
        const { r0, c0, r1, c1 } = range
        filling = { src: { r0, c0, r1, c1 }, startX: e.clientX, startY: e.clientY, moved: false }
        return
      }
      case 'corner':
        selectWhole('all', { r: 0, c: 0 }, { r: o.totalRows() - 1, c: o.totalCols() - 1 }, 'A1')
        return
      case 'colHeader': {
        editor.commit()
        // A press inside a multi-column selection keeps it and arms a block
        // move; otherwise select the one column (and arm a 1-column move).
        const col = hit.col
        const range = S.range()
        const inBlock =
          S.mode === 'col' && range.c1 > range.c0 && col >= range.c0 && col <= range.c1
        if (!inBlock) {
          S.mode = 'col'
          S.anchor = { r: 0, c: col }
          S.head = { r: o.totalRows() - 1, c: col }
          host.onSelect?.(colLabel(col) + ':' + colLabel(col))
        }
        // Moving columns changes data: only with write access.
        if (o.canEdit() && host.onColMove) {
          colDrag = inBlock
            ? {
                fromCol: range.c0,
                count: range.c1 - range.c0 + 1,
                startX: e.clientX,
                startY: e.clientY,
                moved: false,
                insertCol: null,
              }
            : {
                fromCol: col,
                count: 1,
                startX: e.clientX,
                startY: e.clientY,
                moved: false,
                insertCol: null,
              }
        }
        canvas.focus()
        o.render()
        return
      }
      case 'rowHeader': {
        const row = hit.row
        selectWhole(
          'row',
          { r: row, c: 0 },
          { r: row, c: o.totalCols() - 1 },
          `${row + 1}:${row + 1}`,
        )
        return
      }
      case 'none':
        editor.commit()
        return
      case 'cell':
        editor.commit()
        pressCell(e, rect, hit.r, hit.c)
    }
  }

  function pressCell(e: MouseEvent, rect: CanvasRect, r: number, c: number): void {
    canvas.focus()
    const id = cellId(r, c)

    // Ctrl/Cmd+click on a hyperlink opens it instead of selecting.
    const url = o.hyperlinkAt(r, c)
    if ((e.ctrlKey || e.metaKey) && url) {
      host.onHyperlinkClick?.(url)
      return
    }

    const rule = o.validationAt(r, c)
    const z = o.getZoom()

    // A click on a checkbox cell's tickbox toggles it; elsewhere in the
    // cell it's a normal selection.
    if (rule?.type === 'checkbox' && o.canEdit()) {
      const box = checkboxRect(geo.cw(c), geo.rh(r))
      const lx = (e.clientX - rect.left) / z - geo.colX(c)
      const ly = (e.clientY - rect.top) / z - geo.rowY(r)
      if (lx >= box.x && lx <= box.x + box.size && ly >= box.y && ly <= box.y + box.size) {
        e.stopPropagation()
        o.moveSel(r, c)
        host.onCheckboxToggle?.(id)
        return
      }
    }

    // A plain single click in a list cell opens its dropdown on release.
    if (
      rule?.type === 'list' &&
      o.canEdit() &&
      e.detail === 1 &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      pendingListOpen = {
        id,
        rule,
        r,
        c,
        downX: e.clientX,
        downY: e.clientY,
        pos: {
          x: rect.left + geo.colX(c) * z,
          y: rect.top + (geo.rowY(r) + geo.rh(r)) * z,
          w: geo.cw(c) * z,
        },
      }
    }

    dragging = true
    const m = o.resolveMaster(r, c)
    if (e.shiftKey) o.extendSel(m.r, m.c)
    else {
      o.resetTabAnchor()
      o.moveSel(m.r, m.c)
    }
  }

  function onDblClick(e: MouseEvent): void {
    // Viewers: a double-click neither edits, resizes nor fills.
    if (!o.canEdit()) return
    const hit = hits.at(e.clientX, e.clientY, rectOf())
    switch (hit.kind) {
      case 'fillHandle': {
        const src = S.range()
        const end = autoFillDownExtent(src, o.hasValue, o.totalRows(), o.totalCols())
        if (end > src.r1) {
          const { r0, c0, r1, c1 } = src
          host.onFill?.(
            { r0, c0, r1, c1 },
            { ...src, r1: end },
            { withModifier: e.metaKey || e.ctrlKey },
          )
        }
        return
      }
      case 'colResize':
      case 'colHeader':
        o.autoFitCol(hit.col)
        return
      case 'rowResize':
      case 'rowHeader':
        o.autoFitRow(hit.row)
        return
      case 'cell':
        // On a pivot output sheet the host drills down instead of editing.
        if (host.onPivotDrill?.(hit.r, hit.c)) return
        editor.open(o.editValue(hit.r, hit.c), 'edit')
        return
      default:
        return
    }
  }

  function cursorFor(
    e: MouseEvent,
    rect: CanvasRect,
    overFill: boolean,
    overLink: string | undefined,
  ): string {
    const resizeCol = geo.hitTestColResize(e.clientX, e.clientY, rect)
    const resizeRow = resizing ? null : geo.hitTestRowResize(e.clientX, e.clientY, rect)
    // A column header (away from its edge) can be dragged; show it.
    const overColHeader =
      resizeCol === null &&
      !resizing &&
      !resizingRow &&
      o.canEdit() &&
      !!host.onColMove &&
      geo.hitTestColHeader(e.clientX, e.clientY, rect) !== null
    if (colDrag?.moved) return 'grabbing'
    if (resizeCol !== null || resizing) return 'col-resize'
    if (resizeRow !== null || resizingRow) return 'row-resize'
    if (overFill) return 'crosshair'
    if (overColHeader) return 'grab'
    if (overLink) return 'pointer'
    return 'default'
  }

  function onMouseMove(e: MouseEvent): void {
    const rect = rectOf()
    const busy = !!resizing || !!resizingRow || dragging
    const overFill = !busy && hits.onFillHandle(e.clientX, e.clientY, rect)
    const hover = !busy && !overFill ? geo.hitTest(e.clientX, e.clientY, rect) : null
    const overLink = hover ? o.hyperlinkAt(hover.r, hover.c) : undefined
    canvas.style.cursor = cursorFor(e, rect, overFill, overLink)

    // Tell the host once per enter/leave of a linked cell, not per pixel.
    const linkKey = hover && overLink ? `${hover.r},${hover.c}` : null
    if (linkKey !== lastLinkHover) {
      lastLinkHover = linkKey
      host.onLinkHover?.(
        hover && overLink
          ? { r: hover.r, c: hover.c, id: cellId(hover.r, hover.c), url: overLink }
          : null,
      )
    }

    if (filling) {
      if (!filling.moved) {
        if (
          Math.hypot(e.clientX - filling.startX, e.clientY - filling.startY) < FILL_DRAG_THRESHOLD
        )
          return
        filling.moved = true
      }
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) o.extendSel(h.r, h.c)
      return
    }
    if (picker.isDragging()) {
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) picker.dragTo(h.r, h.c)
      return
    }
    if (!dragging) return
    const h = geo.hitTest(e.clientX, e.clientY, rect)
    if (h) o.extendSel(h.r, h.c)
  }

  function onMouseUp(e: MouseEvent): void {
    if (filling) {
      const { src } = filling
      const total = S.range()
      const changed =
        total.r0 !== src.r0 || total.c0 !== src.c0 || total.r1 !== src.r1 || total.c1 !== src.c1
      // Cmd/Ctrl held flips copy vs series, as in Google Sheets.
      if (changed) host.onFill?.(src, total, { withModifier: e.metaKey || e.ctrlKey })
      filling = null
    }
    // Give focus back to whichever input the picker was writing into.
    picker.endDrag()
    if (pendingListOpen) {
      const p = pendingListOpen
      pendingListOpen = null
      // Released where it was pressed: open. Moved: it was a selection drag.
      if (Math.hypot(e.clientX - p.downX, e.clientY - p.downY) <= LIST_CLICK_SLOP) {
        const h = geo.hitTest(e.clientX, e.clientY, rectOf())
        if (h && h.r === p.r && h.c === p.c) host.onDropdownClick?.(p.id, p.rule, p.pos)
      }
    }
    dragging = false
  }

  function onMouseLeave(): void {
    if (lastLinkHover === null) return
    lastLinkHover = null
    host.onLinkHover?.(null)
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    // Wheel deltas are screen pixels; scroll is logical.
    const z = o.getZoom()
    o.scrollBy(e.deltaX / z, e.deltaY / z)
  }

  function onDocMouseMove(e: MouseEvent): void {
    const z = o.getZoom()
    if (colDrag) {
      if (
        colDrag.moved ||
        Math.hypot(e.clientX - colDrag.startX, e.clientY - colDrag.startY) >= COL_DRAG_THRESHOLD
      ) {
        colDrag.moved = true
        colDrag.insertCol = geo.colInsertIndex(e.clientX, rectOf())
        document.body.style.cursor = 'grabbing'
        o.render()
      }
    }
    // Every column in the resize target gets the dragged column's new
    // width (Sheets / Excel).
    if (resizing) {
      o.setColWidths(
        resizing.cols,
        Math.max(MIN_COL_W, resizing.startW + (e.clientX - resizing.startX) / z),
      )
      o.render()
    }
    if (resizingRow) {
      o.setRowHeights(
        resizingRow.rows,
        Math.max(MIN_ROW_H, resizingRow.startH + (e.clientY - resizingRow.startY) / z),
      )
      o.render()
    }
  }

  function onDocMouseUp(): void {
    if (colDrag) {
      const cd = colDrag
      colDrag = null
      document.body.style.cursor = ''
      if (cd.moved && cd.insertCol !== null) host.onColMove?.(cd.fromCol, cd.insertCol, cd.count)
      o.render()
    }
    const didResize = !!resizing || !!resizingRow
    resizing = null
    resizingRow = null
    if (didResize) host.onResizeEnd?.()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('dblclick', onDblClick)
  canvas.addEventListener('mouseleave', onMouseLeave)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('mousemove', onDocMouseMove)
  document.addEventListener('mouseup', onDocMouseUp)

  return {
    colDrag: () => colDrag,
    preMousedownSel: () => preSel,
    destroy() {
      document.removeEventListener('mousemove', onDocMouseMove)
      document.removeEventListener('mouseup', onDocMouseUp)
    },
  }
}
