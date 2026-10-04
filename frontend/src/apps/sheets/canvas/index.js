import { cellId, colLabel, parseCellId } from '../utils/cells.js'
import { getTextWrap, isWrapText, lineHeightFor, wrapLines } from '../utils/text-wrap.js'
import { chipFont } from './chip-geometry.js'
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
import { createKeyboard } from './input/keyboard.js'
import { createMouse } from './input/mouse.js'
import { createRangePicker } from './input/range-picker.js'
import { createOverlay } from './overlay.js'
import { createRenderLoop } from './render-loop.js'
import { createRenderer } from './renderer.js'
import { createScrollbars } from './scrollbars.js'
import { createSelection, jumpEdge } from './selection.js'
import { createViewport, watchPixelRatio } from './viewport.js'

export function createGrid(
  canvas,
  {
    onSelect,
    onCommit,
    onInput,
    onCancel,
    getFormat,
    onFill,
    onBatchCommit,
    getMergeInfo,
    isSlave,
    getMasterId,
    getComment,
    getValidation,
    getCondFormat,
    getSparkline,
    getRightInset,
    onHyperlinkClick,
    onLinkHover,
    onDropdownClick,
    onCheckboxToggle,
    onPivotDrill,
    onResizeEnd,
    onColMove,
    getSheetNames,
    getCurrentSheet,
    getEditingHomeSheet,
    getDisplay,
    getCellIds,
    getEditValue,
    lazyValues = false,
    canEdit = () => true,
    isCellEditable,
    onBlockedEdit,
  } = {},
) {
  const ctx = canvas.getContext('2d')
  // A <canvas> only takes focus with a tabindex. Without it canvas.focus() is
  // a no-op and the grid's keydown handler (typing, Delete, arrows) never runs.
  canvas.setAttribute('tabindex', '0')

  const data = {}

  // ── Value-source seam (lazy-viewport cutover) ────────────────────────────────
  // Legacy/eager path reads the grid's own `data` cache, populated wholesale by
  // the host's repopulate. Lazy path pulls each cell's display string from the
  // host's `getDisplay` on demand, so switch/load cost no longer scales with
  // total cell count — the grid only ever touches visible cells plus the cells
  // a cold-path scan (Cmd+Arrow, Cmd+A, autofit) walks.
  //
  // Three seams, used everywhere instead of touching `data` directly:
  //   getValue(id) — display string for a cell
  //   hasVal(id)   — is the cell non-empty (matches the legacy `!!data[id]`)
  //   cellIds()    — every non-empty cell id on the current sheet
  // In eager mode they read `data`; in lazy mode they read the engine via the
  // host callbacks. Flipping `_lazyValues` is the cutover.
  let _lazyValues = lazyValues && typeof getDisplay === 'function'
  const getValue = (id) => (_lazyValues ? getDisplay(id) : data[id])
  const hasVal = (id) => !!getValue(id)
  const cellIds = () => (_lazyValues ? (getCellIds ? getCellIds() : []) : Object.keys(data))
  // What the in-cell editor opens with: the cell's input (a formula keeps
  // its `=…` text), not its display. Seeding the editor with the display
  // and committing on blur would overwrite a formula with its result.
  // Hosts without getEditValue keep the display, as before.
  const editValue = (id) => {
    const v = getEditValue ? getEditValue(id) : getValue(id)
    return v == null ? '' : String(v)
  }
  function setLazyValues(on) {
    _lazyValues = !!on && typeof getDisplay === 'function'
    render()
  }
  function isLazyValues() {
    return _lazyValues
  }
  const colW = {}
  const rowH = {}

  // Selection: anchor (active cell), head (opposite corner), mode.
  // geo is created further down; clamp only runs after construction.
  const S = createSelection({
    clamp: (r, c) => geo.clamp(r, c),
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
  })
  let mouse = null // input/mouse.ts, created with the event wiring below
  let keys = null // input/keyboard.ts, created with the event wiring below

  const scroll = { x: 0, y: 0 }
  const freeze = { rows: 0, cols: 0 }
  const hiddenRows = new Set()
  const hiddenCols = new Set()
  // Subset of hiddenRows that came from an active filter (vs a manual hide).
  // Tracked separately so grid-painter can suppress the bold "rows hidden
  // here" marker for filter gaps, which would otherwise cover every row
  // boundary in a filtered region.
  const filterHiddenRows = new Set()

  // Marching-ants rect drawn over cut/copy source until paste/Escape clears it.
  let marchAnts = null // { r0, c0, r1, c1 } or null
  let marchPhase = 0
  let _marchRAF = null

  // User-facing zoom (Ctrl+= / Ctrl+-). Affects ctx transform + hit tests.
  let _zoom = 1

  const geo = createGeometry(
    colW,
    rowH,
    scroll,
    freeze,
    hiddenRows,
    hiddenCols,
    () => _zoom,
    filterHiddenRows,
  )
  const vp = createViewport({
    scroll,
    geo,
    totalCols: () => TOTAL_COLS,
    totalRows: () => TOTAL_ROWS,
    getZoom: () => _zoom,
    getFreeze: () => freeze,
    rowHeaderW: ROW_HEADER_W,
    colHeaderH: COL_HEADER_H,
  })
  // Re-size the backing store when the pixel ratio changes, or the grid is
  // painted at the new ratio into a canvas sized for the old one.
  const _stopWatchingRatio = watchPixelRatio(() => {
    _applyCanvasSize()
    render()
  })
  const renderer = createRenderer(ctx, geo)
  const overlay = createOverlay(canvas.parentElement)
  const scrollbars = createScrollbars(canvas.parentElement, {
    getModel: () => _scrollModel(),
    scrollTo,
  })
  // Formula reference picking (click/drag/arrow cells into a `=…` formula).
  const pick = createRangePicker({
    activeElement: () => document.activeElement,
    editorElement: overlay.el,
    editingCell: () => S.anchor,
    crossSheetName: () => _crossSheetName(),
    colLabel,
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    skipHiddenRow: (r, dr) => _skipHiddenR(r, dr),
    skipHiddenCol: (c, dc) => _skipHiddenC(c, dc),
    resolveMaster: (r, c) => _resolveMaster(r, c),
    jumpEdge: (r, c, dr, dc) => _jumpEdge(r, c, dr, dc),
    scrollIntoView: (r, c) => _scrollIntoView(r, c),
    render: () => render(),
  })
  // Formula autocomplete popup under the in-cell editor.
  const ac = createAutocomplete({
    parent: canvas.parentElement,
    input: overlay.el,
    picker: pick,
    activeCell: () => S.anchor,
    displayAt: (r, c) => getValue(cellId(r, c)),
    sheetNames: () => getSheetNames?.() || [],
    crossSheetName: () => _crossSheetName(),
    onInput: (v) => onInput?.(cellId(S.anchor.r, S.anchor.c), v),
    render: () => render(),
  })
  // The in-cell editor: open/commit/cancel and its keys.
  const editor = createEditor({
    overlay,
    picker: pick,
    autocomplete: ac,
    activeCell: () => S.anchor,
    cellRect: (r, c) => ({ x: geo.colX(c), y: geo.rowY(r), w: geo.cw(c), h: geo.rh(r) }),
    formatAt: (r, c) => (getFormat ? getFormat(cellId(r, c)) || {} : {}),
    getZoom: () => _zoom,
    canEdit: () => canEdit(),
    isCellEditable: (r, c) => !isCellEditable || isCellEditable(r, c),
    onBlockedEdit: () => onBlockedEdit?.(),
    collapseSelection: () => {
      S.head = { r: S.anchor.r, c: S.anchor.c }
    },
    ensureVisible: (r, c) => ensureVisible(r, c),
    onInput: (v) => onInput?.(cellId(S.anchor.r, S.anchor.c), v),
    onCommit: (v) => onCommit?.(cellId(S.anchor.r, S.anchor.c), v),
    onCancel: () => onCancel?.(cellId(S.anchor.r, S.anchor.c)),
    leave: (move) => keys.afterEdit(move),
    focusGrid: () => canvas.focus(),
    render: () => render(),
  })

  // ── Render ──────────────────────────────────────────────────────────────────

  const loop = createRenderLoop(() => {
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
      isSlave,
      getComment,
      getValidation,
      getCondFormat,
      getSparkline,
      getRightInset,
      getDiffFor: _diffCells ? _getDiffFor : null,
      marchAnts,
      marchPhase,
      pickerRect: pick.rect,
      colDrag: _movingColDrag(),
      zoom: _zoom,
    })
    scrollbars.layout()
  })
  function _movingColDrag() {
    const d = mouse?.colDrag()
    return d && d.moved ? d : null
  }
  // Declarations, not consts: both are called from code above this point.
  function render() {
    loop.render()
  }
  function scheduleRender() {
    loop.scheduleRender()
  }
  const onRender = loop.onRender

  // Diff overlay: { 'A1': true, ... } for the active sheet.  Used in version-
  // preview mode to paint changed cells with a teal highlight.  Reset on
  // setDiffOverlay(null) when leaving preview.
  let _diffCells = null
  function setDiffOverlay(diffBySheet) {
    if (!diffBySheet) {
      _diffCells = null
      scheduleRender()
      return
    }
    // The caller passes diff keyed by sub-sheet name; we only know the
    // active sheet here, so pull that slice.  When the user switches
    // sub-sheets the caller is expected to call setDiffOverlay again.
    _diffCells = diffBySheet
    scheduleRender()
  }
  function setActiveDiffSheet(sheetName) {
    // No-op today — _diffCells is already a sheets→cells map.  Kept as a
    // hook for the renderer to pick the right slice.
    _activeDiffSheet = sheetName
    scheduleRender()
  }
  let _activeDiffSheet = null
  function _getDiffFor(id) {
    if (!_diffCells || !_activeDiffSheet) return false
    const slice = _diffCells[_activeDiffSheet]
    return !!(slice && slice[id])
  }

  function _stepMarch() {
    _marchRAF = null
    if (!marchAnts) return
    marchPhase = (marchPhase + 0.5) % 1000
    render()
    _marchRAF = requestAnimationFrame(_stepMarch)
  }

  function setMarchingAnts(rect) {
    if (rect && (rect.r0 === undefined || rect.c0 === undefined)) rect = null
    marchAnts = rect ? { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 } : null
    if (_marchRAF) {
      cancelAnimationFrame(_marchRAF)
      _marchRAF = null
    }
    if (marchAnts) _marchRAF = requestAnimationFrame(_stepMarch)
    else render()
  }

  // Visible column header rects for DOM overlays (filter chevrons, etc).
  // Returns [{c, x, width}] for frozen + currently-visible non-frozen columns.
  // Rect returners are CONTRACTED to return canvas-local CSS pixels (what
  // the DOM uses), not the engine's logical units. `geo.colX/cw/rowY/rh`
  // are logical; we multiply by `_zoom` here so callers can drop their
  // own multiplications and so the chevron / fill-handle / pivot FAB
  // overlays line up at every zoom level.
  function getColumnHeaderRects() {
    const rects = []
    const fc = freeze.cols || 0
    for (let c = 0; c < fc; c++) rects.push({ c, x: geo.colX(c) * _zoom, width: geo.cw(c) * _zoom })
    const c0 = geo.firstVisCol()
    const c1 = geo.lastVisCol(c0, vp.cssW)
    for (let c = c0; c <= c1; c++)
      rects.push({ c, x: geo.colX(c) * _zoom, width: geo.cw(c) * _zoom })
    return rects
  }

  // Row-0 rect — the user's header row of data. Used to position filter chevrons.
  function getRow0Rect() {
    return { y: geo.rowY(0) * _zoom, height: geo.rh(0) * _zoom }
  }

  // Rect for any row by index — lets ranged-filter chevrons sit on the range's
  // header row (which may be row 0 or any other row).
  function getRowRect(r) {
    return { y: geo.rowY(r) * _zoom, height: geo.rh(r) * _zoom }
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  // Selection state and range maths live in selection.ts; these wrappers add
  // the side effects (scroll into view, repaint, tell the host).
  function getSelRange() {
    return S.range()
  }

  // Restore a rectangular selection (used by the contextmenu handler when
  // mousedown collapsed a multi-cell range the user wanted to keep).
  function setSelRange({ r0, c0, r1, c1, mode } = {}) {
    if (r0 == null || c0 == null || r1 == null || c1 == null) return
    S.set({ r0, c0, r1, c1, mode: mode || 'cell' })
    render()
    onSelect?.(cellId(S.anchor.r, S.anchor.c))
  }

  // Snapshot of the selection just before the most recent mousedown — lets the
  // contextmenu handler tell whether mousedown collapsed a multi-cell range so
  // it can restore it for actions like Split text to columns.
  function getPreMousedownSel() {
    return mouse.preMousedownSel()
  }

  // Scroll extent and clamping live in viewport.ts.
  function _clampScroll() {
    vp.clampScroll()
  }

  // Pin the open in-cell editor to its cell. ANY change to scroll, zoom, or
  // layout that repaints the grid must call this too, or the <textarea> is
  // left floating at a stale offset — the "editor shows somewhere else" bug.
  function _positionEditor() {
    editor.reposition()
  }

  // Single entry point for setting the scroll offset (logical units). Used by
  // the wheel handler and the overlay scrollbars so both keep the in-cell
  // editor pinned to its cell and repaint. Values are clamped to the sheet.
  function scrollTo(x, y) {
    vp.scrollTo(x, y)
    _positionEditor()
    render()
  }

  function _scrollModel() {
    return vp.scrollModel()
  }
  function ensureVisible(r, c) {
    vp.ensureVisible(r, c)
  }

  function moveSel(r, c) {
    S.moveTo(r, c)
    ensureVisible(S.anchor.r, S.anchor.c)
    // Any non-picker selection move dismisses a lingering picker highlight.
    pick.dismissHighlight()
    render()
    onSelect?.(cellId(S.anchor.r, S.anchor.c))
  }

  function extendSel(r, c) {
    S.extendTo(r, c)
    // ensureVisible target depends on S.mode. For a whole-column selection
    // S.head.r is pinned to the last row, so scrolling to it on a sideways
    // extend would jump us to the bottom of the new column — not what the
    // user expects from Shift+Right on a column header. Same in reverse for
    // whole-row selections.
    if (S.mode === 'col') ensureVisible(0, S.head.c)
    else if (S.mode === 'row') ensureVisible(S.head.r, 0)
    else ensureVisible(S.head.r, S.head.c)
    render()
    // Re-emit onSelect so subscribers (collab cursor broadcaster) see the
    // new range. The anchor cell id is unchanged here — callers that care
    // about anchor identity short-circuit on equality; callers that fetch
    // grid.getSelection() pick up the extended range.
    onSelect?.(cellId(S.anchor.r, S.anchor.c))
  }

  // Jump to data-region edge (Cmd+Arrow behaviour matching Google Sheets)
  function _jumpEdge(startR, startC, dr, dc) {
    return jumpEdge(
      { r: startR, c: startC },
      dr,
      dc,
      (r, c) => hasVal(cellId(r, c)),
      TOTAL_ROWS - 1,
      TOTAL_COLS - 1,
    )
  }

  function _lastUsedCell() {
    let maxR = 0,
      maxC = 0
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (p) {
        if (p.row > maxR) maxR = p.row
        if (p.col > maxC) maxC = p.col
      }
    }
    return { r: maxR, c: maxC }
  }

  // ── Inline editor (input/editor.ts) ─────────────────────────────────────────

  // Cross-sheet picker support. When the user is editing a formula on one
  // sheet (the "editing home") but currently viewing another sheet, every
  // ref written by the picker needs to carry that other sheet's name as a
  // prefix so the formula reads `Sheet1!A1:B5` instead of just `A1:B5`.
  // Returns the bare sheet name when foreign, or null otherwise.
  function _crossSheetName() {
    const cur = getCurrentSheet?.()
    const home = getEditingHomeSheet?.()
    return home && cur && cur !== home ? cur : null
  }

  // Resolve a click/keystroke landing on a slave cell to its merge master.
  function _resolveMaster(r, c) {
    if (!getMasterId) return { r, c }
    const mid = getMasterId(cellId(r, c))
    if (!mid) return { r, c }
    const p = parseCellId(mid)
    return p ? { r: p.row, c: p.col } : { r, c }
  }

  // Skip hidden rows/cols when moving the picker head. dr/dc are ±1.
  function _skipHiddenR(r, dr) {
    while (r >= 0 && r < TOTAL_ROWS && geo.rh(r) === 0) r += dr
    return Math.max(0, Math.min(TOTAL_ROWS - 1, r))
  }
  function _skipHiddenC(c, dc) {
    while (c >= 0 && c < TOTAL_COLS && geo.cw(c) === 0) c += dc
    return Math.max(0, Math.min(TOTAL_COLS - 1, c))
  }

  // Bring (r, c) into view inside the scrollable region — same idea as
  // ensureVisible but works regardless of `S.anchor` (which we don't move).
  function _scrollIntoView(r, c) {
    vp.ensureVisible(r, c)
    // Picking scrolls the view while the editor stays anchored to the formula
    // cell; repin it so it tracks that cell instead of hanging in place.
    _positionEditor()
  }

  // True unless the host marks any cell in the rect protected. Guards the two
  // canvas-owned write paths (opening the editor, and Delete-clear) so a
  // protected cell can't be edited even before the host handlers run.
  function _rangeEditable(r0, c0, r1, c1) {
    if (!isCellEditable) return true
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (!isCellEditable(r, c)) return false
    return true
  }

  // A committed value with hard newlines (Cmd+Enter) grows the row so every
  // line is visible — Google Sheets behavior. Grow-only (never shrinks a row
  // the user sized). Called by the host on commit; returns the {before,
  // after} height diff so it can ride the undo op, or null when no growth.
  function autoGrowRowFor(r, c, val) {
    if (typeof val !== 'string' || val.startsWith('=') || !val.includes('\n')) return null
    const fmt = getFormat ? getFormat(cellId(r, c)) || {} : {}
    const needed = Math.min(400, _cellVisualLines(val, c, fmt) * lineHeightFor(fmt) + 8)
    const before = rowH[r] ?? DEFAULT_ROW_H
    if (needed <= before) return null
    rowH[r] = needed
    _applyCanvasSize()
    return { before, after: needed }
  }

  // How many visual lines `val` occupies in column `c` at `fmt`'s font. In
  // wrap mode a paragraph also soft-wraps, so count the wrapped lines with the
  // same maxW the painter uses (cell width minus its 8px inset); otherwise
  // only hard newlines break.
  function _cellVisualLines(val, c, fmt) {
    if (getTextWrap(fmt) !== 'wrap') return String(val).split('\n').length
    ctx.save()
    ctx.font = chipFont(fmt)
    const maxW = Math.max(1, geo.cw(c) - 8)
    const n = wrapLines(val, maxW, (t) => ctx.measureText(t).width).length
    ctx.restore()
    return n
  }

  // ── Fill handle ──────────────────────────────────────────────────────────────

  // What's under the mouse, in one priority order: hit-test.ts.
  const hits = createHitTester({
    geo,
    getZoom: () => _zoom,
    fillCorner: () => {
      if (editor.isOpen()) return null
      let { r1, c1 } = getSelRange()
      // Extend to the merge's far corner so a single-merged-cell selection
      // hit-tests at the same bottom-right point the painter draws the dot at.
      // Without this, the dot rendered correctly but mousedowns landed on the
      // master cell's bottom-right (mid-block) and the drag never engaged.
      const m = getMergeInfo?.(cellId(r1, c1))
      if (m) {
        r1 += m.rowSpan - 1
        c1 += m.colSpan - 1
      }
      return { r: r1, c: c1 }
    },
  })
  // ── Auto-fit (double-click resize edge or header) ────────────────────────────

  // Measure with the same font the renderer uses, scoped to a fmt's bold/italic.
  function _measureWidth(text, fmt) {
    const weight = fmt?.bold ? 'bold' : 'normal'
    const style = fmt?.italic ? 'italic' : 'normal'
    ctx.save()
    ctx.font = `${style} ${weight} 13px InterVar, Inter, ui-sans-serif, system-ui, sans-serif`
    const w = ctx.measureText(String(text)).width
    ctx.restore()
    return w
  }

  function autoFitCol(c) {
    const CELL_PAD = 12 // matches renderer's left/right padding (≈6px each side)
    const HEADER_PAD = 16
    const MIN_W = 40
    const MAX_W = 600
    let widest = _measureWidth(colLabel(c), { bold: true }) + HEADER_PAD
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (!p || p.col !== c) continue
      const val = getValue(id)
      if (val == null || val === '') continue
      const fmt = getFormat ? getFormat(id) : {}
      // Skip wrap-text columns — they auto-grow rows, not cols.
      if (isWrapText(fmt)) continue
      const w = _measureWidth(val, fmt) + CELL_PAD
      if (w > widest) widest = w
    }
    colW[c] = Math.max(MIN_W, Math.min(MAX_W, Math.ceil(widest)))
    _applyCanvasSize()
    render()
  }

  function autoFitRow(r) {
    const ROW_PAD = 6
    const MIN_H = DEFAULT_ROW_H
    const MAX_H = 400
    let tallest = MIN_H
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (!p || p.row !== r) continue
      const val = getValue(id)
      if (val == null || val === '') continue
      const fmt = getFormat ? getFormat(id) || {} : {}
      // Hard newlines and (in wrap mode) soft-wrapping both add lines; size to
      // whichever the cell actually renders, at the cell's own line height.
      const h = _cellVisualLines(val, p.col, fmt) * lineHeightFor(fmt)
      if (h + ROW_PAD > tallest) tallest = h + ROW_PAD
    }
    rowH[r] = Math.max(MIN_H, Math.min(MAX_H, Math.ceil(tallest)))
    _applyCanvasSize()
    render()
  }

  // ── Canvas events ────────────────────────────────────────────────────────────

  // Press, drag, release, double-click, hover and wheel: input/mouse.ts.
  mouse = createMouse({
    canvas,
    geo,
    hits,
    picker: pick,
    editor,
    sel: S,
    host: {
      onSelect,
      onHyperlinkClick,
      onCheckboxToggle,
      onDropdownClick,
      onFill,
      onPivotDrill,
      onLinkHover,
      onColMove,
      onResizeEnd,
    },
    getZoom: () => _zoom,
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    canEdit: () => canEdit(),
    moveSel,
    extendSel,
    resetTabAnchor: () => keys.resetTabAnchor(),
    resolveMaster: (r, c) => _resolveMaster(r, c),
    crossSheetName: () => _crossSheetName(),
    editValue: (r, c) => editValue(cellId(r, c)),
    hyperlinkAt: (r, c) => getFormat?.(cellId(r, c))?.hyperlink,
    validationAt: (r, c) => getValidation?.(cellId(r, c)),
    hasValue: (r, c) => hasVal(cellId(r, c)),
    colWidth: (c) => colW[c] ?? 100,
    rowHeight: (r) => rowH[r] ?? DEFAULT_ROW_H,
    setColWidths: (cols, w) => {
      for (const c of cols) colW[c] = w
      _applyCanvasSize()
    },
    setRowHeights: (rows, h) => {
      for (const r of rows) rowH[r] = h
      _applyCanvasSize()
    },
    autoFitCol,
    autoFitRow,
    scrollBy: (dx, dy) => scrollTo(scroll.x + dx, scroll.y + dy),
    render: () => render(),
  })

  // Grid keys and formula-bar arrow picking: input/keyboard.ts.
  keys = createKeyboard({
    canvas,
    editorElement: overlay.el,
    picker: pick,
    editor,
    sel: S,
    host: { onSelect, onCommit, onBatchCommit, onBlockedEdit },
    totalRows: () => TOTAL_ROWS,
    totalCols: () => TOTAL_COLS,
    canEdit: () => canEdit(),
    rangeEditable: (r0, c0, r1, c1) => _rangeEditable(r0, c0, r1, c1),
    moveSel,
    extendSel,
    setSelRange,
    jumpEdge: (r, c, dr, dc) => _jumpEdge(r, c, dr, dc),
    lastUsedCell: () => _lastUsedCell(),
    hasValue: (r, c) => hasVal(cellId(r, c)),
    skipHiddenRow: (r, dr) => _skipHiddenR(r, dr),
    skipHiddenCol: (c, dc) => _skipHiddenC(c, dc),
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

  // ── Public API ───────────────────────────────────────────────────────────────

  // The single choke point every size change (viewport, zoom, column/row
  // sizes, freeze, hide, pixel ratio) goes through. viewport.ts computes the
  // sizes; this applies them to the element.
  function _applyCanvasSize() {
    const size = vp.layout()
    canvas.width = size.backingW
    canvas.height = size.backingH
    canvas.style.width = size.styleW + 'px'
    canvas.style.height = size.styleH + 'px'
    // A viewport/zoom/extent change can re-clamp scroll and shift every cell;
    // repin the open editor so it doesn't strand at its pre-resize offset (e.g.
    // a ResizeObserver firing mid-edit when a side panel opens or the window
    // resizes).
    _positionEditor()
  }

  function resize(w, h) {
    // Cap the canvas to the actual sheet extent. If the viewport is wider than
    // the sheet, the canvas is shrunk so nothing renders past column Z / row N,
    // and the surrounding wrap shows its own background. Matches the no-blank
    // behavior of Google Sheets.
    vp.setViewportSize(w, h)
    _applyCanvasSize()
    render()
  }

  // In lazy mode the grid owns no value cache — getValue pulls from the engine,
  // which the host has already updated before calling here — so these just
  // schedule a repaint. In eager mode they keep the `data` cache current.
  function setCell(id, value) {
    if (!_lazyValues) {
      if (!value && value !== 0) delete data[id]
      else data[id] = value
    }
    scheduleRender()
  }

  function batchSetCells(map) {
    if (!_lazyValues) {
      for (const [id, value] of Object.entries(map)) {
        if (!value && value !== 0) delete data[id]
        else data[id] = value
      }
    }
    scheduleRender()
  }

  function clearAll() {
    for (const k of Object.keys(data)) delete data[k]
    render()
  }

  function destroy() {
    overlay.remove()
    scrollbars.destroy()
    ac.remove()
    loop.cancel()
    _stopWatchingRatio()
    if (_marchRAF) {
      cancelAnimationFrame(_marchRAF)
      _marchRAF = null
    }
    mouse.destroy()
    keys.destroy()
  }

  function getColWidth(c) {
    return colW[c] ?? 100
  }
  function setColWidth(c, w) {
    geo.setColWidth(c, w)
    _applyCanvasSize()
    scheduleRender()
  }
  function getRowHeight(r) {
    return rowH[r] ?? DEFAULT_ROW_H
  }
  function setRowHeight(r, h) {
    geo.setRowHeight(r, h)
    _applyCanvasSize()
    scheduleRender()
  }

  function shiftRowHeights(atRow, delta) {
    const pairs = Object.entries(rowH)
      .map(([k, v]) => [+k, v])
      .filter(([r]) => r >= atRow)
    delta > 0 ? pairs.sort((a, b) => b[0] - a[0]) : pairs.sort((a, b) => a[0] - b[0])
    for (const [r, h] of pairs) {
      delete rowH[r]
      const nr = r + delta
      if (nr >= 0) rowH[nr] = h
    }
    _applyCanvasSize()
  }

  function shiftColWidths(atCol, delta) {
    const pairs = Object.entries(colW)
      .map(([k, v]) => [+k, v])
      .filter(([c]) => c >= atCol)
    delta > 0 ? pairs.sort((a, b) => b[0] - a[0]) : pairs.sort((a, b) => a[0] - b[0])
    for (const [c, w] of pairs) {
      delete colW[c]
      const nc = c + delta
      if (nc >= 0) colW[nc] = w
    }
    _applyCanvasSize()
  }

  // View-metadata half of a structural op — permute column widths and the
  // hidden-column set through the same index map the engines use. (The engines
  // own cell/format/range state; the grid owns widths / hidden / freeze.)
  function remapColsMeta(mapCol) {
    const pairs = Object.entries(colW).map(([k, v]) => [+k, v])
    for (const [c] of pairs) delete colW[c]
    for (const [c, w] of pairs) {
      const nc = mapCol(c)
      if (nc != null && nc >= 0) colW[nc] = w
    }
    const cols = [...hiddenCols]
    hiddenCols.clear()
    for (const c of cols) {
      const nc = mapCol(c)
      if (nc != null && nc >= 0) hiddenCols.add(nc)
    }
    _applyCanvasSize()
  }

  function remapRowsMeta(mapRow) {
    const pairs = Object.entries(rowH).map(([k, v]) => [+k, v])
    for (const [r] of pairs) delete rowH[r]
    for (const [r, h] of pairs) {
      const nr = mapRow(r)
      if (nr != null && nr >= 0) rowH[nr] = h
    }
    const rows = [...hiddenRows]
    hiddenRows.clear()
    for (const r of rows) {
      const nr = mapRow(r)
      if (nr != null && nr >= 0) hiddenRows.add(nr)
    }
    _applyCanvasSize()
  }

  function getHitRegion(ex, ey) {
    const rect = canvas.getBoundingClientRect()
    return {
      headerCol: geo.hitTestColHeader(ex, ey, rect),
      headerRow: geo.hitTestRowHeader(ex, ey, rect),
      cell: geo.hitTest(ex, ey, rect),
    }
  }

  function setFreeze(rows, cols) {
    freeze.rows = rows || 0
    freeze.cols = cols || 0
    // CRITICAL: reset scroll so the first scrollable column/row sits flush at
    // the right/bottom edge of the frozen pane (spec rule: leftmost visible
    // at scrollLeft=0 must be column N). Without this, freezing while already
    // scrolled hides cols N..N+k under the just-frozen pane's mapping.
    scroll.x = 0
    scroll.y = 0
    _clampScroll()
    // Freezing resets the scroll origin, shifting every cell; repin the open
    // editor so it tracks its cell instead of stranding at the old offset.
    _positionEditor()
    render()
  }

  function setHiddenRows(newSet) {
    hiddenRows.clear()
    for (const r of newSet) hiddenRows.add(r)
    _applyCanvasSize()
    render()
  }

  // Tag a subset of the already-hidden rows as "filter hidden". Must be a
  // subset of whatever was just passed to setHiddenRows. Caller is expected
  // to push the union to setHiddenRows first, then call this to tag the
  // filter portion so the painter can render the gap as a flat gridline
  // instead of a bold boundary.
  function setFilterHiddenRows(newSet) {
    filterHiddenRows.clear()
    for (const r of newSet) filterHiddenRows.add(r)
    render()
  }

  function setHiddenCols(newSet) {
    hiddenCols.clear()
    for (const c of newSet) hiddenCols.add(c)
    _applyCanvasSize()
    render()
  }

  function getHiddenRows() {
    return new Set(hiddenRows)
  }
  function getHiddenCols() {
    return new Set(hiddenCols)
  }

  function expandRows(by = 1000) {
    setTotalRows(TOTAL_ROWS + by)
    _applyCanvasSize()
    render()
  }

  function getTotalRows() {
    return TOTAL_ROWS
  }

  function expandCols(by = 1) {
    setTotalCols(TOTAL_COLS + by)
    _applyCanvasSize()
    render()
  }

  function getTotalCols() {
    return TOTAL_COLS
  }

  function setZoom(z) {
    _zoom = Math.max(0.5, Math.min(2.5, z))
    _applyCanvasSize()
    render()
  }
  function getZoom() {
    return _zoom
  }

  // True when the user has scrolled close enough to the bottom of the sheet
  // that an "add more rows" affordance is worth showing. Threshold is in rows.
  function isNearBottom(threshold = 10) {
    const r0 = geo.firstVisRow()
    const last = geo.lastVisRow(r0, vp.cssH)
    return last >= TOTAL_ROWS - 1 - threshold
  }

  // ── View-state snapshot/restore (for persistence) ────────────────────────────
  // Captures everything the user can change visually but isn't part of the
  // cell/format/merge engines: column widths, row heights, freeze, hidden,
  // total-rows expansion, zoom. Without this the doc would reload with default
  // 100px widths, no freeze, no expanded rows, etc.
  function viewSnapshot() {
    return {
      colW: { ...colW },
      rowH: { ...rowH },
      freezeRows: freeze.rows || 0,
      freezeCols: freeze.cols || 0,
      // Only MANUAL hides belong in the per-sheet view. Filter hides are
      // transient and derived per-sheet from the sortFilter engine; baking
      // them in here leaked one sheet's filter onto others (they were read
      // back as manual hides and re-applied everywhere).
      hiddenRows: Array.from(hiddenRows).filter((r) => !filterHiddenRows.has(r)),
      hiddenCols: Array.from(hiddenCols),
      totalRows: TOTAL_ROWS,
      totalCols: TOTAL_COLS,
      zoom: _zoom,
    }
  }

  function viewRestore(snap) {
    if (!snap) return
    for (const k of Object.keys(colW)) delete colW[k]
    for (const k of Object.keys(rowH)) delete rowH[k]
    Object.assign(colW, snap.colW || {})
    Object.assign(rowH, snap.rowH || {})
    freeze.rows = snap.freezeRows || 0
    freeze.cols = snap.freezeCols || 0
    hiddenRows.clear()
    for (const r of snap.hiddenRows || []) hiddenRows.add(r)
    // Filter hides are transient and re-applied per-sheet by _applyHiddenRows;
    // drop any stale tag from the previous sheet so it can't bleed through.
    filterHiddenRows.clear()
    hiddenCols.clear()
    for (const c of snap.hiddenCols || []) hiddenCols.add(c)
    // Reset to the default size when the view doesn't carry an explicit count
    // (new / pivot / drill-down sheets) — otherwise the count stays at whatever
    // a large source sheet grew the global binding to. _repopulateGrid expands
    // again to fit any real data right after this, so nothing gets hidden.
    setTotalRows(typeof snap.totalRows === 'number' ? snap.totalRows : DEFAULT_TOTAL_ROWS)
    setTotalCols(typeof snap.totalCols === 'number' ? snap.totalCols : DEFAULT_TOTAL_COLS)
    if (typeof snap.zoom === 'number') _zoom = Math.max(0.5, Math.min(2.5, snap.zoom))
    _applyCanvasSize()
    render()
  }

  return {
    resize,
    render,
    setCell,
    batchSetCells,
    clearAll,
    getCell: (id) => getValue(id) ?? '',
    getActiveCell: () => cellId(S.anchor.r, S.anchor.c),
    // Whether the in-cell overlay is currently editing a `=…` formula —
    // SheetEditor uses this to keep the editor alive across sheet-tab clicks
    // for cross-sheet range picking.
    isEditingFormula: () => editor.isOpen() && editor.value().startsWith('='),
    // Whether the in-cell overlay editor is open at all. The host uses this to
    // hand clipboard ops (copy/cut/paste) to the textarea's native handling
    // while editing, instead of hijacking them for grid-level cell ops.
    isEditing: () => editor.isOpen(),
    getSelection: getSelRange,
    setSelection: setSelRange,
    getPreMousedownSel,
    moveTo: (r, c) => moveSel(r, c),
    getColWidth,
    setColWidth,
    getRowHeight,
    setRowHeight,
    shiftRowHeights,
    shiftColWidths,
    remapColsMeta,
    remapRowsMeta,
    getHitRegion,
    setFreeze,
    setHiddenRows,
    setHiddenCols,
    setFilterHiddenRows,
    getHiddenRows,
    getHiddenCols,
    getColumnHeaderRects,
    getRow0Rect,
    getRowRect,
    onRender,
    setMarchingAnts,
    // Pixel rect (canvas-local CSS coords, zoom-applied) for one cell —
    // drives popovers anchored to a cell (auto-fill menu, pivot FAB, remote
    // cursor overlay, etc.). DO NOT multiply by zoom in callers — already
    // included here.
    getCellRect: (r, c) => ({
      x: geo.colX(c) * _zoom,
      y: geo.rowY(r) * _zoom,
      width: geo.cw(c) * _zoom,
      height: geo.rh(r) * _zoom,
    }),
    // Physical size of the visible grid viewport (the grid-wrap content box), in
    // CSS px. Cached in _applyCanvasSize, so reading it is reflow-free — used by
    // DOM overlays to clamp themselves to what's on screen.
    getViewportSize: () => ({ w: vp.viewportW, h: vp.viewportH }),
    setDiffOverlay,
    setActiveDiffSheet,
    autoFitCol,
    autoFitRow,
    autoGrowRowFor,
    expandRows,
    getTotalRows,
    isNearBottom,
    expandCols,
    getTotalCols,
    setZoom,
    getZoom,
    viewSnapshot,
    viewRestore,
    setLazyValues,
    isLazyValues,
    destroy,
  }
}
