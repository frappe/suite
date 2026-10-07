// The spreadsheet grid on a <canvas>: creates the canvas modules, wires them
// together, and returns the API SheetEditor drives (types.ts).
//
// It reads cells through a CellProvider and reports through a GridHost (the
// two ports in types.ts). View state (sizes, scroll, freeze, hides, zoom,
// selection) lives in the ViewModel (core/view-model.ts).
//
// What lives where:
//   geometry.ts      cell ↔ pixel maths        viewport.ts   scroll, canvas size
//   renderer.ts      painting (painters/)      render-loop.ts  when to paint
//   selection.ts     selection logic           marching-ants.ts  cut/copy border
//   autofit.ts       fit-to-content sizes      overlay.ts    the editor textarea
//   grid-actions.ts  helpers the input modules share
//   input/           hit testing, mouse, drags, fill handle, keyboard,
//                    in-cell editor, formula range picking and autocomplete

import { createViewModel, DEFAULT_ROW_H } from '../core/view-model.js'
import { cellId, colLabel } from '../utils/cells.js'
import { createAutofit } from './autofit.js'
import { COL_HEADER_H, ROW_HEADER_W } from './constants.js'
import { createGeometry } from './geometry.js'
import { createGridActions } from './grid-actions.js'
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
import { createSelection } from './selection.js'
import type { CellValue, Grid, GridOptions } from './types.js'
import { createViewport, watchPixelRatio } from './viewport.js'

export type * from './types.js'

const isEmpty = (v: CellValue): boolean => !v && v !== 0

export function createGrid(canvas: HTMLCanvasElement, opts: GridOptions = {}): Grid {
  const cells = opts.cells ?? {}
  const host = opts.host ?? {}
  const canEdit = (): boolean => (host.canEdit ? host.canEdit() : true)
  const ctx = canvas.getContext('2d')
  // A <canvas> only takes focus with a tabindex. Without it canvas.focus() is
  // a no-op and the grid's keydown handler (typing, Delete, arrows) never runs.
  canvas.setAttribute('tabindex', '0')
  const parent = canvas.parentElement
  if (!ctx || !parent)
    throw new Error('createGrid: the canvas needs a 2d context and a parent element')

  // ── Values ───────────────────────────────────────────────────────────────
  // Eager mode reads the grid's own `data` cache, filled by the host. Lazy
  // mode asks the provider per visible cell, so load cost doesn't grow with
  // the sheet. Everything reads through getValue / cellIds.
  const data: { [id: string]: CellValue } = {}
  let lazy = !!opts.lazyValues && typeof cells.getDisplay === 'function'
  const getValue = (id: string): CellValue =>
    lazy && cells.getDisplay ? cells.getDisplay(id) : data[id]
  const cellIds = (): string[] =>
    lazy ? (cells.getCellIds ? cells.getCellIds() : []) : Object.keys(data)

  // ── View state and the modules over it ───────────────────────────────────
  const vm = createViewModel()
  const geo = createGeometry(vm)
  const vp = createViewport({
    scroll: vm.scroll,
    geo,
    totalCols: () => vm.totalCols,
    totalRows: () => vm.totalRows,
    getZoom: () => vm.zoom,
    getFreeze: () => vm.freeze,
    rowHeaderW: ROW_HEADER_W,
    colHeaderH: COL_HEADER_H,
  })
  const S = createSelection({
    clamp: (r, c) => geo.clamp(r, c),
    totalRows: () => vm.totalRows,
    totalCols: () => vm.totalCols,
    state: vm.sel,
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
      formatAt: (id) => cells.getStyle?.(id) || {},
    },
    DEFAULT_ROW_H,
  )
  const act = createGridActions({
    vm,
    geo,
    vp,
    sel: S,
    cells,
    host,
    getValue,
    cellIds,
    render: () => render(),
  })

  // ── Input ────────────────────────────────────────────────────────────────
  // Created later (they need the editor), but referenced by it.
  let mouse: Mouse | null = null
  let keys: Keyboard | null = null

  const pick = createRangePicker({
    activeElement: () => document.activeElement,
    editorElement: overlay.el,
    editingCell: () => S.anchor,
    crossSheetName: act.crossSheetName,
    colLabel,
    totalRows: () => vm.totalRows,
    totalCols: () => vm.totalCols,
    skipHiddenRow: act.skipHiddenRow,
    skipHiddenCol: act.skipHiddenCol,
    resolveMaster: act.resolveMaster,
    jumpEdge: act.jumpEdge,
    scrollIntoView: (r, c) => {
      vp.ensureVisible(r, c)
      editor.reposition()
    },
    render: () => render(),
  })
  // Every selection move drops a leftover pick highlight.
  act.onMove(() => pick.dismissHighlight())
  const ac = createAutocomplete({
    parent,
    input: overlay.el,
    picker: pick,
    activeCell: () => S.anchor,
    displayAt: (r, c) => {
      const v = getValue(cellId(r, c))
      return v == null ? undefined : String(v)
    },
    sheetNames: () => host.getSheetNames?.() || [],
    crossSheetName: act.crossSheetName,
    onInput: (v) => host.onInput?.(act.activeId(), v),
    render: () => render(),
  })
  const editor = createEditor({
    overlay,
    picker: pick,
    autocomplete: ac,
    activeCell: () => S.anchor,
    cellRect: (r, c) => ({ x: geo.colX(c), y: geo.rowY(r), w: geo.cw(c), h: geo.rh(r) }),
    formatAt: (r, c) => cells.getStyle?.(cellId(r, c)) || {},
    getZoom: () => vm.zoom,
    canEdit,
    isCellEditable: (r, c) => !cells.isCellEditable || cells.isCellEditable(r, c),
    onBlockedEdit: () => host.onBlockedEdit?.(),
    collapseSelection: () => {
      S.head = { r: S.anchor.r, c: S.anchor.c }
    },
    ensureVisible: (r, c) => vp.ensureVisible(r, c),
    onInput: (v) => host.onInput?.(act.activeId(), v),
    onCommit: (v) => host.onCommit?.(act.activeId(), v),
    onCancel: () => host.onCancel?.(act.activeId()),
    leave: (move) => keys?.afterEdit(move),
    focusGrid: () => canvas.focus(),
    render: () => render(),
  })
  const hits = createHitTester({
    geo,
    getZoom: () => vm.zoom,
    // The fill handle sits on the selection's far corner, widened to a
    // merge so it matches where the painter draws the dot. None while editing.
    fillCorner: () => {
      if (editor.isOpen()) return null
      let { r1, c1 } = S.range()
      const m = cells.getMergeInfo?.(cellId(r1, c1))
      if (m) {
        r1 += m.rowSpan - 1
        c1 += m.colSpan - 1
      }
      return { r: r1, c: c1 }
    },
  })

  // ── Paint ────────────────────────────────────────────────────────────────
  let diffCells: { [sheet: string]: { [id: string]: boolean } } | null = null
  let diffSheet: string | null = null
  const diffFor = (id: string): boolean => !!(diffCells && diffSheet && diffCells[diffSheet]?.[id])

  const loop = createRenderLoop(() => {
    const drag = mouse?.colDrag()
    renderer.render({
      cssW: vp.cssW,
      cssH: vp.cssH,
      getValue,
      cells,
      sel: S.anchor,
      selEnd: S.head,
      selMode: S.mode,
      editing: editor.isOpen(),
      freeze: vm.freeze,
      getDiffFor: diffCells ? diffFor : null,
      marchAnts: ants.rect,
      marchPhase: ants.phase,
      pickerRect: pick.rect,
      colDrag: drag && drag.moved ? drag : null,
      zoom: vm.zoom,
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

  // A view-state change that moves cells: re-layout, then paint now or on
  // the next frame.
  function relayout(now = true): void {
    applyCanvasSize()
    if (now) render()
    else scheduleRender()
  }

  // ── Mouse and keyboard ───────────────────────────────────────────────────
  mouse = createMouse({
    canvas,
    geo,
    hits,
    picker: pick,
    editor,
    sel: S,
    host,
    getZoom: () => vm.zoom,
    totalRows: () => vm.totalRows,
    totalCols: () => vm.totalCols,
    canEdit,
    moveSel: act.moveSel,
    extendSel: act.extendSel,
    resetTabAnchor: () => keys?.resetTabAnchor(),
    resolveMaster: act.resolveMaster,
    crossSheetName: act.crossSheetName,
    editValue: act.editValue,
    hyperlinkAt: (r, c) => cells.getStyle?.(cellId(r, c))?.hyperlink,
    validationAt: (r, c) => cells.getValidation?.(cellId(r, c)),
    hasValue: act.hasValue,
    colWidth: (c) => vm.colWidth(c),
    rowHeight: (r) => vm.rowHeight(r),
    setColWidths: (cols, w) => {
      for (const c of cols) vm.setColWidth(c, w)
      applyCanvasSize()
    },
    setRowHeights: (rows, h) => {
      for (const r of rows) vm.setRowHeight(r, h)
      applyCanvasSize()
    },
    autoFitCol,
    autoFitRow,
    scrollBy: (dx, dy) => scrollTo(vm.scroll.x + dx, vm.scroll.y + dy),
    render: () => render(),
  })

  keys = createKeyboard({
    canvas,
    editorElement: overlay.el,
    picker: pick,
    editor,
    sel: S,
    host,
    totalRows: () => vm.totalRows,
    totalCols: () => vm.totalCols,
    canEdit,
    rangeEditable: act.rangeEditable,
    moveSel: act.moveSel,
    extendSel: act.extendSel,
    setSelRange: act.setSelRange,
    jumpEdge: act.jumpEdge,
    lastUsedCell: act.lastUsedCell,
    hasValue: act.hasValue,
    skipHiddenRow: act.skipHiddenRow,
    skipHiddenCol: act.skipHiddenCol,
    pageRows: () => {
      const top = geo.firstVisRow()
      return Math.max(1, geo.lastVisRow(top, vp.cssH) - top)
    },
    editValue: act.editValue,
    forgetCells: (ids) => {
      for (const id of ids) delete data[id]
    },
    render: () => render(),
  })

  // ── Public API ───────────────────────────────────────────────────────────

  function autoFitCol(c: number): void {
    vm.setColWidth(c, fit.fitColWidth(c))
    relayout()
  }
  function autoFitRow(r: number): void {
    vm.setRowHeight(r, fit.fitRowHeight(r))
    relayout()
  }

  // Eager mode only: keep the `data` cache current. Lazy mode reads the
  // provider, which the host already updated, so it just repaints.
  function store(id: string, value: CellValue): void {
    if (lazy) return
    if (isEmpty(value)) delete data[id]
    else data[id] = value
  }

  return {
    resize(w, h) {
      // The canvas is capped to the sheet's extent; past the last row or
      // column the wrapper's own background shows (as in Google Sheets).
      vp.setViewportSize(w, h)
      relayout()
    },
    render,
    setCell(id, value) {
      store(id, value)
      scheduleRender()
    },
    batchSetCells(map) {
      for (const [id, value] of Object.entries(map)) store(id, value)
      scheduleRender()
    },
    clearAll() {
      for (const k of Object.keys(data)) delete data[k]
      render()
    },
    getCell: (id) => getValue(id) ?? '',
    getActiveCell: act.activeId,
    isEditingFormula: () => editor.isOpen() && editor.value().startsWith('='),
    isEditing: () => editor.isOpen(),
    getSelection: () => S.range(),
    setSelection: act.setSelRange,
    getPreMousedownSel: () => mouse?.preMousedownSel() ?? null,
    moveTo: act.moveSel,

    getColWidth: (c) => vm.colWidth(c),
    setColWidth(c, w) {
      vm.setColWidth(c, w)
      relayout(false)
    },
    getRowHeight: (r) => vm.rowHeight(r),
    setRowHeight(r, h) {
      vm.setRowHeight(r, h)
      relayout(false)
    },
    shiftRowHeights(at, delta) {
      vm.shiftRows(at, delta)
      applyCanvasSize()
    },
    shiftColWidths(at, delta) {
      vm.shiftCols(at, delta)
      applyCanvasSize()
    },
    remapColsMeta(map) {
      vm.remapCols(map)
      applyCanvasSize()
    },
    remapRowsMeta(map) {
      vm.remapRows(map)
      applyCanvasSize()
    },
    getHitRegion(ex, ey) {
      const rect = canvas.getBoundingClientRect()
      return {
        headerCol: geo.hitTestColHeader(ex, ey, rect),
        headerRow: geo.hitTestRowHeader(ex, ey, rect),
        cell: geo.hitTest(ex, ey, rect),
      }
    },

    setFreeze(rows, cols) {
      // Freezing resets scroll, which moves every cell.
      vm.setFreeze(rows, cols)
      vp.clampScroll()
      editor.reposition()
      render()
    },
    setHiddenRows(rows) {
      vm.setHiddenRows(rows)
      relayout()
    },
    setHiddenCols(cols) {
      vm.setHiddenCols(cols)
      relayout()
    },
    setFilterHiddenRows(rows) {
      vm.setFilterHiddenRows(rows)
      render()
    },
    getHiddenRows: () => new Set(vm.hiddenRows),
    getHiddenCols: () => new Set(vm.hiddenCols),

    // Rects for DOM overlays (filter chevrons, pivot button, popovers,
    // remote cursors): canvas-local CSS px, zoom applied. Callers must not
    // multiply by zoom again.
    getColumnHeaderRects() {
      const z = vm.zoom
      const rects: { c: number; x: number; width: number }[] = []
      const add = (c: number): void => {
        rects.push({ c, x: geo.colX(c) * z, width: geo.cw(c) * z })
      }
      for (let c = 0; c < vm.freeze.cols; c++) add(c)
      const c0 = geo.firstVisCol()
      const c1 = geo.lastVisCol(c0, vp.cssW)
      for (let c = c0; c <= c1; c++) add(c)
      return rects
    },
    getRow0Rect: () => ({ y: geo.rowY(0) * vm.zoom, height: geo.rh(0) * vm.zoom }),
    getRowRect: (r) => ({ y: geo.rowY(r) * vm.zoom, height: geo.rh(r) * vm.zoom }),
    getCellRect: (r, c) => {
      const z = vm.zoom
      return { x: geo.colX(c) * z, y: geo.rowY(r) * z, width: geo.cw(c) * z, height: geo.rh(r) * z }
    },
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
    // Called by the host on commit. The height change rides the undo op.
    autoGrowRowFor(r, c, value) {
      const before = vm.rowHeight(r)
      const after = fit.grownRowHeight(r, c, value, before)
      if (after === null) return null
      vm.setRowHeight(r, after)
      applyCanvasSize()
      return { before, after }
    },

    expandRows(by = 1000) {
      vm.setTotalRows(vm.totalRows + by)
      relayout()
    },
    expandCols(by = 1) {
      vm.setTotalCols(vm.totalCols + by)
      relayout()
    },
    getTotalRows: () => vm.totalRows,
    getTotalCols: () => vm.totalCols,
    // Close enough to the last row that "add more rows" is worth showing.
    isNearBottom(threshold = 10) {
      const r0 = geo.firstVisRow()
      return geo.lastVisRow(r0, vp.cssH) >= vm.totalRows - 1 - threshold
    },
    setZoom(z) {
      vm.setZoom(z)
      relayout()
    },
    getZoom: () => vm.zoom,

    viewSnapshot: () => vm.serialize(),
    viewRestore(snap) {
      if (!snap) return
      vm.restore(snap)
      relayout()
    },
    setLazyValues(on) {
      lazy = !!on && typeof cells.getDisplay === 'function'
      render()
    },
    isLazyValues: () => lazy,
    destroy() {
      overlay.remove()
      scrollbars.destroy()
      ac.remove()
      loop.cancel()
      stopWatchingRatio()
      ants.cancel()
      mouse?.destroy()
      keys?.destroy()
    },
  }
}
