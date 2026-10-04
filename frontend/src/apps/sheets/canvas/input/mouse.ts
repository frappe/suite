// Mouse input on the grid: what a press, drag, release, double-click, hover
// or wheel does.
//
// A press asks hit-test.ts what is under the pointer and starts one of:
//   a formula pick (when a `=…` input is focused, every click picks),
//   a column/row resize or column move (drag.ts), a fill (fill-handle.ts),
//   a header/corner selection, or a cell selection drag.
// Moves and the release finish whichever one started. Resizes and column
// moves are handed to drag.ts, which follows them across the whole page.
//
// Rows and columns are 0-based.

import { cellId, colLabel } from '../../utils/cells.js'
import { checkboxRect } from '../checkbox-geometry.js'
import type { Cell, Selection, SelRange } from '../selection.js'
import type { DropdownPos, GridHost, ValidationRule } from '../types.js'
import { createDrags, resizeTargets, type ColDrag } from './drag.js'
import type { Editor } from './editor.js'
import { createFillHandle } from './fill-handle.js'
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

/** The host events a mouse can cause. */
export type MouseHost = Pick<
  GridHost,
  | 'onSelect'
  | 'onHyperlinkClick'
  | 'onCheckboxToggle'
  | 'onDropdownClick'
  | 'onFill'
  | 'onPivotDrill'
  | 'onLinkHover'
  | 'onColMove'
  | 'onResizeEnd'
>

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
  /** The column drag, armed or moving (the renderer draws it once moved). */
  colDrag(): ColDrag | null
  /** The selection as it was before the last press (the context menu restores it). */
  preMousedownSel(): SelRange | null
  /** Remove the document listeners. */
  destroy(): void
}

/** A list-cell click still opens its dropdown if the pointer moved at most this far. */
const LIST_CLICK_SLOP = 4

export function createMouse(o: MouseOptions): Mouse {
  const { canvas, geo, hits, picker, editor, sel: S, host } = o

  let dragging = false
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
  const drags = createDrags({
    canvasRect: rectOf,
    colInsertIndex: (ex, rect) => geo.colInsertIndex(ex, rect),
    getZoom: o.getZoom,
    setColWidths: o.setColWidths,
    setRowHeights: o.setRowHeights,
    onColMove: (from, to, count) => host.onColMove?.(from, to, count),
    onResizeEnd: () => host.onResizeEnd?.(),
    render: o.render,
  })
  const fill = createFillHandle({
    range: () => S.range(),
    extendSel: o.extendSel,
    hasValue: o.hasValue,
    totalRows: o.totalRows,
    totalCols: o.totalCols,
    onFill: host.onFill,
  })

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
        drags.startColResize(cols, e.clientX, o.colWidth(hit.col))
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
        drags.startRowResize(rows, e.clientY, o.rowHeight(hit.row))
        return
      }
      case 'fillHandle':
        fill.start(e.clientX, e.clientY)
        return
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
          if (inBlock) drags.armColMove(range.c0, range.c1 - range.c0 + 1, e.clientX, e.clientY)
          else drags.armColMove(col, 1, e.clientX, e.clientY)
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
      case 'fillHandle':
        fill.fillDown(e.metaKey || e.ctrlKey)
        return
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
    const resizing = drags.resizing()
    const resizeRow = resizing === 'col' ? null : geo.hitTestRowResize(e.clientX, e.clientY, rect)
    // A column header (away from its edge) can be dragged; show it.
    const overColHeader =
      resizeCol === null &&
      !resizing &&
      o.canEdit() &&
      !!host.onColMove &&
      geo.hitTestColHeader(e.clientX, e.clientY, rect) !== null
    if (drags.colDrag()?.moved) return 'grabbing'
    if (resizeCol !== null || resizing === 'col') return 'col-resize'
    if (resizeRow !== null || resizing === 'row') return 'row-resize'
    if (overFill) return 'crosshair'
    if (overColHeader) return 'grab'
    if (overLink) return 'pointer'
    return 'default'
  }

  function onMouseMove(e: MouseEvent): void {
    const rect = rectOf()
    const busy = drags.resizing() !== null || dragging
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

    if (fill.active()) {
      fill.move(e.clientX, e.clientY, geo.hitTest(e.clientX, e.clientY, rect))
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
    fill.end(e.metaKey || e.ctrlKey)
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

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('dblclick', onDblClick)
  canvas.addEventListener('mouseleave', onMouseLeave)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return {
    colDrag: () => drags.colDrag(),
    preMousedownSel: () => preSel,
    destroy: () => drags.destroy(),
  }
}
