// The spreadsheet grid on a <canvas>: creates every canvas module, wires them
// together, and returns the API SheetEditor drives (types.ts).
//
// What lives where:
//   geometry.js      cell ↔ pixel maths        viewport.ts   scroll, canvas size
//   renderer.js      painting                  render-loop.ts  when to paint
//   selection.ts     the selected range        marching-ants.ts  cut/copy border
//   autofit.ts       fit-to-content sizes      overlay.js    the editor textarea
//   input/           hit testing, mouse, keyboard, in-cell editor,
//                    formula range picking and autocomplete
// This file owns the state they share: values (eager mode), column widths,
// row heights, freeze, hidden rows/columns, sheet size and zoom.

import { cellId, colLabel, parseCellId } from '../utils/cells.js'
import { createAutofit } from './autofit.js'
import {
  COL_HEADER_H,
  DEFAULT_ROW_H,
  DEFAULT_TOTAL_COLS,
  DEFAULT_TOTAL_ROWS,
  ROW_HEADER_W,
  setTotalCols,
  setTotalRows,
  TOTAL_COLS,
  TOTAL_ROWS,
} from './constants.js'
import { createGeometry } from './geometry.js'
import { createAutocomplete } from './input/autocomplete.js'
import { createEditor } from './input/editor.js'
import { createHitTester } from './input/hit-test.js'
import { createKeyboard, type Keyboard } from './input/keyboard.js'
import { createMouse, type Mouse } from './input/mouse.js'
import { createRangePicker } from './input/range-picker.js'
import { createMarchingAnts } from './marching-ants.js'
import { createOverlay } from './overlay.js'
import { createRenderLoop } from './render-loop.js'
import { createRenderer } from './renderer.js'
import { createScrollbars } from './scrollbars.js'
import { createSelection, jumpEdge, type Cell, type SelRange } from './selection.js'
import type { CellValue, Grid, GridOptions, IndexMap, ViewSnapshot } from './types.js'
import { createViewport, watchPixelRatio } from './viewport.js'

export type * from './types.js'

const DEFAULT_COL_WIDTH = 100
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5

const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
const isEmpty = (v: CellValue): boolean => !v && v !== 0

export function createGrid(canvas: HTMLCanvasElement, opts: GridOptions = {}): Grid {
  const {
    getFormat,
    getDisplay,
    getCellIds,
    getEditValue,
    isCellEditable,
    getMergeInfo,
    getMasterId,
  } = opts
  const canEdit = opts.canEdit ?? ((): boolean => true)
  const ctx = canvas.getContext('2d')
  // A <canvas> only takes focus with a tabindex. Without it canvas.focus() is
  // a no-op and the grid's keydown handler (typing, Delete, arrows) never runs.
  canvas.setAttribute('tabindex', '0')
  const parent = canvas.parentElement
  if (!ctx || !parent)
    throw new Error('createGrid: the canvas needs a 2d context and a parent element')

  // ── Values ───────────────────────────────────────────────────────────────
  // Eager mode reads the grid's own `data` cache, filled by the host. Lazy
  // mode asks the host (`getDisplay`) per visible cell, so load cost doesn't
  // grow with the sheet. Everything reads through these three.
  const data: { [id: string]: CellValue } = {}
  let lazy = !!opts.lazyValues && typeof getDisplay === 'function'
  const getValue = (id: string): CellValue => (lazy && getDisplay ? getDisplay(id) : data[id])
  const hasVal = (id: string): boolean => !!getValue(id)
  const cellIds = (): string[] => (lazy ? (getCellIds ? getCellIds() : []) : Object.keys(data))
  // The editor opens with a formula's text, not its result; committing the
  // result back would overwrite the formula.
  const editValue = (id: string): string => {
    const v = getEditValue ? getEditValue(id) : getValue(id)
    return v == null ? '' : String(v)
  }
  function setLazyValues(on: boolean): void {
    lazy = !!on && typeof getDisplay === 'function'
    render()
  }

  // ── Layout state (shared with geometry and viewport, read live) ─────────
  const colW: { [col: number]: number } = {}
  const rowH: { [row: number]: number } = {}
  const scroll = { x: 0, y: 0 }
  const freeze = { rows: 0, cols: 0 }
  const hiddenRows = new Set<number>()
  const hiddenCols = new Set<number>()
  // The hidden rows that come from a filter, not a manual hide: painted as a
  // plain gridline, and never saved in the view.
  const filterHiddenRows = new Set<number>()
  let zoom = 1

  const geo = createGeometry(
    colW,
    rowH,
    scroll,
    freeze,
    hiddenRows,
    hiddenCols,
    () => zoom,
    filterHiddenRows,
  )
  const vp = createViewport({
    scroll,
    geo,
    totalCols: () => TOTAL_COLS,
    totalRows: () => TOTAL_ROWS,
    getZoom: () => zoom,
    getFreeze: () => freeze,
    rowHeaderW: ROW_HEADER_W,
    colHeaderH: COL_HEADER_H,
  })
  const S = createSelection({
    clamp: (r, c) => geo.clamp(r, c),
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
  })

  // Re-size the backing store when the pixel ratio changes (moving to
  // another monitor, browser zoom), or the grid paints blurry.
  const stopWatchingRatio = watchPixelRatio(() => {
    applyCanvasSize()
    render()
  })
  const renderer = createRenderer(ctx, geo)
  const overlay = createOverlay(parent)
  const scrollbars = createScrollbars(parent, { getModel: () => vp.scrollModel(), scrollTo })
  const ants = createMarchingAnts(() => render())
  const fit = createAutofit(
    {
      ctx,
      colWidth: (c) => geo.cw(c),
      cellIds,
      valueAt: getValue,
      formatAt: (id) => getFormat?.(id) || {},
    },
    DEFAULT_ROW_H,
  )

  // ── Input ────────────────────────────────────────────────────────────────
  // Created later (they need the editor), but referenced by it.
  let mouse: Mouse | null = null
  let keys: Keyboard | null = null

  const pick = createRangePicker({
    activeElement: () => document.activeElement,
    editorElement: overlay.el,
    editingCell: () => S.anchor,
    crossSheetName,
    colLabel,
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    skipHiddenRow,
    skipHiddenCol,
    resolveMaster,
    jumpEdge: jumpToEdge,
    scrollIntoView,
    render: () => render(),
  })
  const ac = createAutocomplete({
    parent,
    input: overlay.el,
    picker: pick,
    activeCell: () => S.anchor,
    displayAt: (r, c) => display(cellId(r, c)),
    sheetNames: () => opts.getSheetNames?.() || [],
    crossSheetName,
    onInput: (v) => opts.onInput?.(activeId(), v),
    render: () => render(),
  })
  const editor = createEditor({
    overlay,
    picker: pick,
    autocomplete: ac,
    activeCell: () => S.anchor,
    cellRect: (r, c) => ({ x: geo.colX(c), y: geo.rowY(r), w: geo.cw(c), h: geo.rh(r) }),
    formatAt: (r, c) => getFormat?.(cellId(r, c)) || {},
    getZoom: () => zoom,
    canEdit,
    isCellEditable: (r, c) => !isCellEditable || isCellEditable(r, c),
    onBlockedEdit: () => opts.onBlockedEdit?.(),
    collapseSelection: () => {
      S.head = { r: S.anchor.r, c: S.anchor.c }
    },
    ensureVisible: (r, c) => vp.ensureVisible(r, c),
    onInput: (v) => opts.onInput?.(activeId(), v),
    onCommit: (v) => opts.onCommit?.(activeId(), v),
    onCancel: () => opts.onCancel?.(activeId()),
    leave: (move) => keys?.afterEdit(move),
    focusGrid: () => canvas.focus(),
    render: () => render(),
  })
  const hits = createHitTester({
    geo,
    getZoom: () => zoom,
    // The fill handle sits on the selection's far corner, widened to a
    // merge so it matches where the painter draws the dot. None while editing.
    fillCorner: () => {
      if (editor.isOpen()) return null
      let { r1, c1 } = S.range()
      const m = getMergeInfo?.(cellId(r1, c1))
      if (m) {
        r1 += m.rowSpan - 1
        c1 += m.colSpan - 1
      }
      return { r: r1, c: c1 }
    },
  })

  // ── Paint ────────────────────────────────────────────────────────────────
  const loop = createRenderLoop(() => {
    const drag = mouse?.colDrag()
    renderer.render({
      cssW: vp.cssW,
      cssH: vp.cssH,
      getValue,
      sel: S.anchor,
      selEnd: S.head,
      selMode: S.mode,
      editing: editor.isOpen(),
      getFormat,
      freeze,
      getMergeInfo,
      isSlave: opts.isSlave,
      getComment: opts.getComment,
      getValidation: opts.getValidation,
      getCondFormat: opts.getCondFormat,
      getSparkline: opts.getSparkline,
      getRightInset: opts.getRightInset,
      getDiffFor: diffCells ? diffFor : null,
      marchAnts: ants.rect,
      marchPhase: ants.phase,
      pickerRect: pick.rect,
      colDrag: drag && drag.moved ? drag : null,
      zoom,
    })
    scrollbars.layout()
  })
  // Declarations, so code above can call them before this line runs.
  function render(): void {
    loop.render()
  }
  function scheduleRender(): void {
    loop.scheduleRender()
  }

  // Version preview: cells changed in the previewed version, by sheet.
  let diffCells: { [sheet: string]: { [id: string]: boolean } } | null = null
  let diffSheet: string | null = null
  function diffFor(id: string): boolean {
    return !!(diffCells && diffSheet && diffCells[diffSheet]?.[id])
  }

  // ── Helpers shared by the input modules ─────────────────────────────────
  function activeId(): string {
    return cellId(S.anchor.r, S.anchor.c)
  }
  function display(id: string): string | undefined {
    const v = getValue(id)
    return v == null ? undefined : String(v)
  }

  // When a formula on one sheet picks cells on another, refs carry that
  // sheet's name (`Sheet2!A1`). The name, or null on the formula's own sheet.
  function crossSheetName(): string | null {
    const cur = opts.getCurrentSheet?.()
    const home = opts.getEditingHomeSheet?.()
    return home && cur && cur !== home ? cur : null
  }

  // A click or key landing inside a merge goes to its top-left (master) cell.
  function resolveMaster(r: number, c: number): Cell {
    const mid = getMasterId?.(cellId(r, c))
    const p = mid ? parseCellId(mid) : null
    return p ? { r: p.row, c: p.col } : { r, c }
  }

  // Step past hidden rows/columns in direction d (±1), staying on the sheet.
  function skipHiddenRow(r: number, d: number): number {
    while (r >= 0 && r < TOTAL_ROWS && geo.rh(r) === 0) r += d
    return Math.max(0, Math.min(TOTAL_ROWS - 1, r))
  }
  function skipHiddenCol(c: number, d: number): number {
    while (c >= 0 && c < TOTAL_COLS && geo.cw(c) === 0) c += d
    return Math.max(0, Math.min(TOTAL_COLS - 1, c))
  }

  // Ctrl/Cmd+arrow target: the edge of the current data block.
  function jumpToEdge(r: number, c: number, dr: number, dc: number): Cell {
    return jumpEdge(
      { r, c },
      dr,
      dc,
      (rr, cc) => hasVal(cellId(rr, cc)),
      TOTAL_ROWS - 1,
      TOTAL_COLS - 1,
    )
  }

  function lastUsedCell(): Cell {
    let r = 0,
      c = 0
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (p) {
        r = Math.max(r, p.row)
        c = Math.max(c, p.col)
      }
    }
    return { r, c }
  }

  // Picking scrolls to the picked cell while the editor stays on the
  // formula's cell, so re-pin the editor.
  function scrollIntoView(r: number, c: number): void {
    vp.ensureVisible(r, c)
    editor.reposition()
  }

  // False if any cell in the block is protected. Guards the grid's own
  // write paths (opening the editor, Delete-clear).
  function rangeEditable(r0: number, c0: number, r1: number, c1: number): boolean {
    if (!isCellEditable) return true
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (!isCellEditable(r, c)) return false
    return true
  }

  // ── Selection with its side effects (scroll, repaint, tell the host) ────
  function moveSel(r: number, c: number): void {
    S.moveTo(r, c)
    vp.ensureVisible(S.anchor.r, S.anchor.c)
    // Any ordinary move drops a leftover pick highlight.
    pick.dismissHighlight()
    render()
    opts.onSelect?.(activeId())
  }

  function extendSel(r: number, c: number): void {
    S.extendTo(r, c)
    // A whole-column selection's head sits on the last row; scrolling to it
    // on Shift+Right would jump to the bottom. Same for rows.
    if (S.mode === 'col') vp.ensureVisible(0, S.head.c)
    else if (S.mode === 'row') vp.ensureVisible(S.head.r, 0)
    else vp.ensureVisible(S.head.r, S.head.c)
    render()
    // Re-sent so collaborators' cursors see the extended range.
    opts.onSelect?.(activeId())
  }

  function setSelRange(range: Partial<SelRange> = {}): void {
    const { r0, c0, r1, c1, mode } = range
    if (r0 == null || c0 == null || r1 == null || c1 == null) return
    S.set({ r0, c0, r1, c1, mode: mode || 'cell' })
    render()
    opts.onSelect?.(activeId())
  }

  // The one way scroll changes (wheel, scrollbars): clamp, re-pin the
  // editor, repaint.
  function scrollTo(x: number, y: number): void {
    vp.scrollTo(x, y)
    editor.reposition()
    render()
  }

  // Every size change (viewport, zoom, widths, heights, freeze, hides, pixel
  // ratio) ends here. It can re-clamp scroll and move every cell, so the
  // open editor is re-pinned too.
  function applyCanvasSize(): void {
    const size = vp.layout()
    canvas.width = size.backingW
    canvas.height = size.backingH
    canvas.style.width = size.styleW + 'px'
    canvas.style.height = size.styleH + 'px'
    editor.reposition()
  }

  // ── Mouse and keyboard ───────────────────────────────────────────────────
  mouse = createMouse({
    canvas,
    geo,
    hits,
    picker: pick,
    editor,
    sel: S,
    host: opts,
    getZoom: () => zoom,
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    canEdit,
    moveSel,
    extendSel,
    resetTabAnchor: () => keys?.resetTabAnchor(),
    resolveMaster,
    crossSheetName,
    editValue: (r, c) => editValue(cellId(r, c)),
    hyperlinkAt: (r, c) => getFormat?.(cellId(r, c))?.hyperlink,
    validationAt: (r, c) => opts.getValidation?.(cellId(r, c)),
    hasValue: (r, c) => hasVal(cellId(r, c)),
    colWidth: getColWidth,
    rowHeight: getRowHeight,
    setColWidths: (cols, w) => {
      for (const c of cols) colW[c] = w
      applyCanvasSize()
    },
    setRowHeights: (rows, h) => {
      for (const r of rows) rowH[r] = h
      applyCanvasSize()
    },
    autoFitCol,
    autoFitRow,
    scrollBy: (dx, dy) => scrollTo(scroll.x + dx, scroll.y + dy),
    render: () => render(),
  })

  keys = createKeyboard({
    canvas,
    editorElement: overlay.el,
    picker: pick,
    editor,
    sel: S,
    host: opts,
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    canEdit,
    rangeEditable,
    moveSel,
    extendSel,
    setSelRange,
    jumpEdge: jumpToEdge,
    lastUsedCell,
    hasValue: (r, c) => hasVal(cellId(r, c)),
    skipHiddenRow,
    skipHiddenCol,
    pageRows: () => {
      const top = geo.firstVisRow()
      return Math.max(1, geo.lastVisRow(top, vp.cssH) - top)
    },
    editValue: (r, c) => editValue(cellId(r, c)),
    forgetCells: (ids) => {
      for (const id of ids) delete data[id]
    },
    render: () => render(),
  })

  // ── Public API ───────────────────────────────────────────────────────────

  function resize(w: number, h: number): void {
    // The canvas is capped to the sheet's extent; past the last row/column
    // the wrapper's own background shows (as in Google Sheets).
    vp.setViewportSize(w, h)
    applyCanvasSize()
    render()
  }

  // Lazy mode: the host already updated the engine, so just repaint.
  // Eager mode: keep the `data` cache current.
  function setCell(id: string, value: CellValue): void {
    if (!lazy) {
      if (isEmpty(value)) delete data[id]
      else data[id] = value
    }
    scheduleRender()
  }

  function batchSetCells(map: { [id: string]: CellValue }): void {
    if (!lazy) {
      for (const [id, value] of Object.entries(map)) {
        if (isEmpty(value)) delete data[id]
        else data[id] = value
      }
    }
    scheduleRender()
  }

  function clearAll(): void {
    for (const k of Object.keys(data)) delete data[k]
    render()
  }

  function destroy(): void {
    overlay.remove()
    scrollbars.destroy()
    ac.remove()
    loop.cancel()
    stopWatchingRatio()
    ants.cancel()
    mouse?.destroy()
    keys?.destroy()
  }

  function getColWidth(c: number): number {
    return colW[c] ?? DEFAULT_COL_WIDTH
  }
  function setColWidth(c: number, w: number): void {
    geo.setColWidth(c, w)
    applyCanvasSize()
    scheduleRender()
  }
  function getRowHeight(r: number): number {
    return rowH[r] ?? DEFAULT_ROW_H
  }
  function setRowHeight(r: number, h: number): void {
    geo.setRowHeight(r, h)
    applyCanvasSize()
    scheduleRender()
  }

  function autoFitCol(c: number): void {
    colW[c] = fit.fitColWidth(c)
    applyCanvasSize()
    render()
  }

  function autoFitRow(r: number): void {
    rowH[r] = fit.fitRowHeight(r)
    applyCanvasSize()
    render()
  }

  // Called by the host on commit. The height change rides the undo op.
  function autoGrowRowFor(
    r: number,
    c: number,
    value: CellValue,
  ): { before: number; after: number } | null {
    const before = getRowHeight(r)
    const after = fit.grownRowHeight(r, c, value, before)
    if (after === null) return null
    rowH[r] = after
    applyCanvasSize()
    return { before, after }
  }

  // Move every size at or after `at` by `delta` (insert/delete rows or
  // columns). Walk away from the gap so no entry overwrites another.
  function shiftSizes(sizes: { [i: number]: number }, at: number, delta: number): void {
    const pairs = Object.entries(sizes)
      .map(([k, v]): [number, number] => [Number(k), v])
      .filter(([i]) => i >= at)
      .sort((a, b) => (delta > 0 ? b[0] - a[0] : a[0] - b[0]))
    for (const [i, v] of pairs) {
      delete sizes[i]
      if (i + delta >= 0) sizes[i + delta] = v
    }
    applyCanvasSize()
  }

  // The view half of a structural op (move, sort): send sizes and hides
  // through the same index map the engine uses.
  function remapMeta(sizes: { [i: number]: number }, hidden: Set<number>, map: IndexMap): void {
    const pairs = Object.entries(sizes).map(([k, v]): [number, number] => [Number(k), v])
    for (const [i] of pairs) delete sizes[i]
    for (const [i, v] of pairs) {
      const n = map(i)
      if (n != null && n >= 0) sizes[n] = v
    }
    const old = [...hidden]
    hidden.clear()
    for (const i of old) {
      const n = map(i)
      if (n != null && n >= 0) hidden.add(n)
    }
    applyCanvasSize()
  }

  function setFreeze(rows: number, cols: number): void {
    freeze.rows = rows || 0
    freeze.cols = cols || 0
    // Reset scroll so the first unfrozen row/column sits right at the
    // frozen edge; freezing while scrolled would hide some under it.
    scroll.x = 0
    scroll.y = 0
    vp.clampScroll()
    editor.reposition()
    render()
  }

  function replaceSet(set: Set<number>, items: Iterable<number>): void {
    set.clear()
    for (const i of items) set.add(i)
  }

  function setTotal(setter: (n: number) => void, n: number): void {
    setter(n)
    applyCanvasSize()
    render()
  }

  function setZoom(z: number): void {
    zoom = clampZoom(z)
    applyCanvasSize()
    render()
  }

  // Close enough to the last row that "add more rows" is worth showing.
  function isNearBottom(threshold = 10): boolean {
    const r0 = geo.firstVisRow()
    return geo.lastVisRow(r0, vp.cssH) >= TOTAL_ROWS - 1 - threshold
  }

  // Saved with the sheet so it reopens with the same widths, heights,
  // freeze, hides, size and zoom.
  function viewSnapshot(): ViewSnapshot {
    return {
      colW: { ...colW },
      rowH: { ...rowH },
      freezeRows: freeze.rows || 0,
      freezeCols: freeze.cols || 0,
      // Manual hides only: filter hides are re-derived per sheet, and
      // saving them leaked one sheet's filter onto the others.
      hiddenRows: [...hiddenRows].filter((r) => !filterHiddenRows.has(r)),
      hiddenCols: [...hiddenCols],
      totalRows: TOTAL_ROWS,
      totalCols: TOTAL_COLS,
      zoom,
    }
  }

  function viewRestore(snap: Partial<ViewSnapshot> | null | undefined): void {
    if (!snap) return
    for (const k of Object.keys(colW)) delete colW[Number(k)]
    for (const k of Object.keys(rowH)) delete rowH[Number(k)]
    Object.assign(colW, snap.colW || {})
    Object.assign(rowH, snap.rowH || {})
    freeze.rows = snap.freezeRows || 0
    freeze.cols = snap.freezeCols || 0
    replaceSet(hiddenRows, snap.hiddenRows || [])
    // A previous sheet's filter tags must not carry over.
    filterHiddenRows.clear()
    replaceSet(hiddenCols, snap.hiddenCols || [])
    // No saved size (new, pivot, drill-down sheets): back to the default,
    // not whatever a big sheet grew it to. The host grows it to fit data.
    setTotalRows(typeof snap.totalRows === 'number' ? snap.totalRows : DEFAULT_TOTAL_ROWS)
    setTotalCols(typeof snap.totalCols === 'number' ? snap.totalCols : DEFAULT_TOTAL_COLS)
    if (typeof snap.zoom === 'number') zoom = clampZoom(snap.zoom)
    applyCanvasSize()
    render()
  }

  return {
    resize,
    render,
    setCell,
    batchSetCells,
    clearAll,
    getCell: (id) => getValue(id) ?? '',
    getActiveCell: activeId,
    isEditingFormula: () => editor.isOpen() && editor.value().startsWith('='),
    isEditing: () => editor.isOpen(),
    getSelection: () => S.range(),
    setSelection: setSelRange,
    getPreMousedownSel: () => mouse?.preMousedownSel() ?? null,
    moveTo: moveSel,

    getColWidth,
    setColWidth,
    getRowHeight,
    setRowHeight,
    shiftRowHeights: (at, delta) => shiftSizes(rowH, at, delta),
    shiftColWidths: (at, delta) => shiftSizes(colW, at, delta),
    remapColsMeta: (map) => remapMeta(colW, hiddenCols, map),
    remapRowsMeta: (map) => remapMeta(rowH, hiddenRows, map),
    getHitRegion(ex, ey) {
      const rect = canvas.getBoundingClientRect()
      return {
        headerCol: geo.hitTestColHeader(ex, ey, rect),
        headerRow: geo.hitTestRowHeader(ex, ey, rect),
        cell: geo.hitTest(ex, ey, rect),
      }
    },

    setFreeze,
    setHiddenRows: (rows) => {
      replaceSet(hiddenRows, rows)
      applyCanvasSize()
      render()
    },
    setHiddenCols: (cols) => {
      replaceSet(hiddenCols, cols)
      applyCanvasSize()
      render()
    },
    // Tags which of the hidden rows are filter hides; call setHiddenRows
    // with the union first.
    setFilterHiddenRows: (rows) => {
      replaceSet(filterHiddenRows, rows)
      render()
    },
    getHiddenRows: () => new Set(hiddenRows),
    getHiddenCols: () => new Set(hiddenCols),

    // Rects for DOM overlays (filter chevrons, pivot button, popovers,
    // remote cursors): canvas-local CSS px, zoom applied. Callers must not
    // multiply by zoom again.
    getColumnHeaderRects() {
      const rects: { c: number; x: number; width: number }[] = []
      const add = (c: number): void => {
        rects.push({ c, x: geo.colX(c) * zoom, width: geo.cw(c) * zoom })
      }
      for (let c = 0; c < (freeze.cols || 0); c++) add(c)
      const c0 = geo.firstVisCol()
      const c1 = geo.lastVisCol(c0, vp.cssW)
      for (let c = c0; c <= c1; c++) add(c)
      return rects
    },
    getRow0Rect: () => ({ y: geo.rowY(0) * zoom, height: geo.rh(0) * zoom }),
    getRowRect: (r) => ({ y: geo.rowY(r) * zoom, height: geo.rh(r) * zoom }),
    getCellRect: (r, c) => ({
      x: geo.colX(c) * zoom,
      y: geo.rowY(r) * zoom,
      width: geo.cw(c) * zoom,
      height: geo.rh(r) * zoom,
    }),
    // Cached by the last layout, so reading it doesn't force a reflow.
    getViewportSize: () => ({ w: vp.viewportW, h: vp.viewportH }),
    onRender: loop.onRender,

    setMarchingAnts: (rect) => ants.set(rect),
    setDiffOverlay(bySheet) {
      diffCells = bySheet || null
      scheduleRender()
    },
    setActiveDiffSheet(sheet) {
      diffSheet = sheet
      scheduleRender()
    },

    autoFitCol,
    autoFitRow,
    autoGrowRowFor,
    expandRows: (by = 1000) => setTotal(setTotalRows, TOTAL_ROWS + by),
    expandCols: (by = 1) => setTotal(setTotalCols, TOTAL_COLS + by),
    getTotalRows: () => TOTAL_ROWS,
    getTotalCols: () => TOTAL_COLS,
    isNearBottom,
    setZoom,
    getZoom: () => zoom,

    viewSnapshot,
    viewRestore,
    setLazyValues,
    isLazyValues: () => lazy,
    destroy,
  }
}
