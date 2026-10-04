import { cellId, colLabel, parseCellId } from '../utils/cells.js'
import { autoCloseKey } from '../utils/formula-autoclose.js'
import { getTextWrap, isWrapText, lineHeightFor, wrapLines } from '../utils/text-wrap.js'
import { checkboxRect } from './checkbox-geometry.js'
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
import { createHitTester } from './input/hit-test.js'
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
  let dragging = false
  // A plain single-click anywhere in a list-validated cell opens its dropdown.
  // We record the candidate on mousedown and fire on mouseup, so a click that
  // turns into a range-drag selects instead of opening, and a double-click
  // (which edits) is excluded. Set to { hId, rule, r, c, downX, downY, pos }.
  let _pendingListOpen = null
  let editing = false
  let resizing = null // { col, startX, startW }
  let resizingRow = null // { row, startY, startH }
  let filling = null // { startCell }
  // Column-header drag-to-reorder. Armed on a header mousedown (pending, moved:
  // false) and promoted to an active drag once the pointer passes threshold, so
  // a plain click still selects. { fromCol, count, startX, startY, moved, insertCol }
  let colDrag = null
  let _tabAnchorCol = null // column where the current Tab sequence started

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

  // ── Render ──────────────────────────────────────────────────────────────────

  const loop = createRenderLoop(() => {
    renderer.render({
      cssW: vp.cssW,
      cssH: vp.cssH,
      getValue,
      sel: S.anchor,
      selEnd: S.head,
      selMode: S.mode,
      editing,
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
      colDrag: colDrag && colDrag.moved ? colDrag : null,
      zoom: _zoom,
    })
    scrollbars.layout()
  })
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
  let _preMousedownSel = null
  function getPreMousedownSel() {
    return _preMousedownSel
  }

  // Scroll extent and clamping live in viewport.ts.
  function _clampScroll() {
    vp.clampScroll()
  }

  // Pin the open in-cell editor to `S.anchor`'s current on-screen rect. ANY change
  // to scroll, zoom, or layout that repaints the grid must call this too, or
  // the <textarea> is left floating at a stale offset while the highlight moves
  // under it — the "editor shows somewhere else" bug. Cheap no-op when idle.
  function _positionEditor() {
    if (!editing) return
    const fmt = getFormat ? getFormat(cellId(S.anchor.r, S.anchor.c)) || {} : {}
    overlay.position(
      geo.colX(S.anchor.c) * _zoom,
      geo.rowY(S.anchor.r) * _zoom,
      geo.cw(S.anchor.c) * _zoom,
      geo.rh(S.anchor.r) * _zoom,
      fmt,
      _zoom,
    )
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

  // ── Inline editor ────────────────────────────────────────────────────────────

  // 'enter' mode (fresh typing) lets arrow keys commit-and-move like Excel /
  // Google Sheets. 'edit' mode (F2 / dblclick on existing content) keeps arrow
  // keys as cursor movement inside the input.
  let editMode = 'enter'

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

  function showEditor(initialValue, mode = 'enter') {
    // Read-only viewers: never open the in-cell editor. This is the single
    // choke point for every begin-edit path (typing, F2, Enter, double-click),
    // so blocking it here keeps a viewer from typing into a cell that can't be
    // saved. Selection/navigation still work.
    if (!canEdit()) return
    if (isCellEditable && !isCellEditable(S.anchor.r, S.anchor.c)) {
      onBlockedEdit?.()
      return
    }
    editMode = mode
    S.head = { r: S.anchor.r, c: S.anchor.c }
    // Type-to-edit and F2 don't move the selection, so `S.anchor` may have been
    // scrolled off-screen (wheel/scrollbar leaves the selection put). Bring it
    // back into view before positioning, or the editor opens off in the void.
    ensureVisible(S.anchor.r, S.anchor.c)
    editing = true
    _positionEditor()
    overlay.show(initialValue)
    onInput?.(cellId(S.anchor.r, S.anchor.c), initialValue)
    render()
  }

  function _commitAndHide() {
    if (!editing) return
    ac.hide()
    editing = false
    const id = cellId(S.anchor.r, S.anchor.c)
    const val = overlay.getValue()
    overlay.hide()
    pick.clear()
    onCommit?.(id, val)
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

  overlay.el.addEventListener('input', () => {
    const val = overlay.getValue()
    onInput?.(cellId(S.anchor.r, S.anchor.c), val)
    ac.update(val, overlay.el.selectionStart)
  })

  overlay.el.addEventListener('keydown', (e) => {
    if (ac.handleKey(e)) return
    // Auto-close parens (`(` → `()`, `)` steps over, Backspace clears an empty
    // pair) — only inside a formula. Handle before the picker/nav branches so
    // typing `(` never leaks into them.
    const closed = autoCloseKey(
      e.key,
      overlay.el.value,
      overlay.el.selectionStart,
      overlay.el.selectionEnd,
    )
    if (closed) {
      e.preventDefault()
      if (pick.isKeyPicking()) pick.keyCommit() // finalize an in-progress keyboard pick first
      overlay.el.value = closed.value
      overlay.el.setSelectionRange(closed.caret, closed.caret)
      overlay.el.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }
    // Commit any active cell-ref pick when the user types a printable char
    // (e.g. '+' after picking C1) so the next arrow key starts a fresh ref
    // instead of replacing the one already inserted.
    if (pick.isKeyPicking() && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      pick.keyCommit()
    }
    // In 'enter' mode, arrow keys commit the current value and move the
    // selection one cell in that direction — matching Excel / Google Sheets.
    // In 'edit' mode (F2 / dblclick), arrows stay as cursor-movement.
    if (
      editMode === 'enter' &&
      (e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight')
    ) {
      const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      const [dr, dc] = dirs[e.key]
      const mod = e.ctrlKey || e.metaKey
      // If picker is already active, move it.
      if (pick.isKeyPicking()) {
        e.preventDefault()
        pick.keyMove(dr, dc, e.shiftKey, mod)
        return
      }
      // Inside a formula (value starts with `=`) arrows always drive the
      // picker — even between args, after a comma, etc. Whether the pick
      // replaces a partial ref or inserts a new one is decided in keyStart;
      // gating the picker here used to eat the second-range pick in
      // =VLOOKUP(..., …) and dump the user to the adjacent cell instead.
      if (overlay.getValue().startsWith('=')) {
        e.preventDefault()
        pick.keyStart(overlay.el, dr, dc, e.shiftKey)
        return
      }
      // Not a formula — arrow commits and moves like Excel / Google Sheets.
      e.preventDefault()
      _commitAndHide()
      moveSel(S.anchor.r + dr, S.anchor.c + dc)
      canvas.focus()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (pick.isKeyPicking()) pick.keyCommit()
      // Cmd/Ctrl/Alt+Enter: newline inside the cell (Google Sheets), not commit.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        const { selectionStart: s0, selectionEnd: s1, value } = overlay.el
        overlay.el.value = value.slice(0, s0) + '\n' + value.slice(s1)
        overlay.el.setSelectionRange(s0 + 1, s0 + 1)
        overlay.el.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      _commitAndHide()
      const anchorC = _tabAnchorCol ?? S.anchor.c
      _tabAnchorCol = null
      moveSel(S.anchor.r + 1, anchorC)
      canvas.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (pick.isKeyPicking()) pick.keyCommit()
      if (_tabAnchorCol === null) _tabAnchorCol = S.anchor.c
      _commitAndHide()
      moveSel(S.anchor.r, e.shiftKey ? S.anchor.c - 1 : S.anchor.c + 1)
      canvas.focus()
    } else if (e.key === 'Escape') {
      ac.hide()
      if (pick.isKeyPicking()) {
        pick.keyCancel()
        return
      } // Esc while picking: cancel pick, stay editing
      editing = false
      overlay.hide()
      pick.clear()
      render()
      canvas.focus()
      onCancel?.(cellId(S.anchor.r, S.anchor.c))
    }
  })

  overlay.el.addEventListener('blur', () => {
    if (!editing) return
    ac.hide()
    editing = false
    const id = cellId(S.anchor.r, S.anchor.c)
    const val = overlay.getValue()
    overlay.hide()
    render()
    onCommit?.(id, val)
  })

  // ── Fill handle ──────────────────────────────────────────────────────────────

  // What's under the mouse, in one priority order: hit-test.ts.
  const hits = createHitTester({
    geo,
    getZoom: () => _zoom,
    fillCorner: () => {
      if (editing) return null
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
  function hitTestFillHandle(ex, ey, rect) {
    return hits.onFillHandle(ex, ey, rect)
  }

  // Double-click-fill extent: pick a non-empty neighbour column (left, then
  // right) and walk its contiguous run starting at r1+1 — Google Sheets rule.
  function _autoFillDownExtent(src) {
    const filled = (r, c) => {
      if (r < 0 || r >= TOTAL_ROWS || c < 0 || c >= TOTAL_COLS) return false
      return hasVal(cellId(r, c))
    }
    let anchor = null
    if (filled(src.r1 + 1, src.c0 - 1)) anchor = src.c0 - 1
    else if (filled(src.r1 + 1, src.c1 + 1)) anchor = src.c1 + 1
    if (anchor === null) return src.r1
    let r = src.r1 + 1
    while (r < TOTAL_ROWS && filled(r, anchor)) r++
    return r - 1
  }

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

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect()

    // Snapshot the selection BEFORE any handler below mutates it. The
    // contextmenu handler reads this to restore a multi-cell range that
    // mousedown collapsed (so right-click → Split text to columns operates
    // on the user's actual selection, not just the clicked cell).
    _preMousedownSel = getSelRange()

    // Right-click inside the existing selection preserves it so the context
    // menu (Split text to columns, Delete, etc.) operates on the multi-cell
    // range the user already selected. Outside the selection we fall through
    // — the click moves selection to that cell first, matching Google Sheets.
    // Note: on macOS Ctrl+click can fire with button=0; the contextmenu
    // handler's restore-from-snapshot path covers that case.
    if (e.button === 2) {
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) {
        const r = getSelRange()
        if (h.r >= r.r0 && h.r <= r.r1 && h.c >= r.c0 && h.c <= r.c1) {
          canvas.focus()
          return
        }
      }
    }

    // ── PRIORITY 0: formula reference picker ────────────────────────────────
    // While a `=…` formula is focused (in-cell overlay OR top formula bar),
    // *any* canvas click is routed to the picker. This is what kills the
    // VLOOKUP-mid-typing crash: previously a click on a column/row header
    // would commit the partial formula → parser throws. Now those clicks
    // insert a column/row reference instead.
    const pickInput = pick.target()
    if (pickInput) {
      e.preventDefault()
      const hit = hits.at(e.clientX, e.clientY, rect)
      // Headers and cells insert a reference; resize edges, the fill handle
      // and the corner do nothing while picking.
      if (hit.kind === 'colHeader') {
        pick.pickColumn(pickInput, hit.col)
        return
      }
      if (hit.kind === 'rowHeader') {
        pick.pickRow(pickInput, hit.row)
        return
      }
      if (hit.kind !== 'cell') return
      // No self-reference — clicking the cell being edited is a no-op, but
      // only when we're on the editing-home sheet (clicking the same screen
      // cell on a *different* sheet is a legitimate cross-sheet reference).
      if (editing && hit.r === S.anchor.r && hit.c === S.anchor.c && !_crossSheetName()) return
      // Slave cells redirect to their merge master.
      const m = _resolveMaster(hit.r, hit.c)
      pick.pickCell(pickInput, m.r, m.c, e.shiftKey)
      return
    }

    // Resize edges and the fill handle are targets only for editors; for a
    // viewer the same press falls through to the header or cell beneath.
    const hit = hits.at(e.clientX, e.clientY, rect, { resize: canEdit(), fill: canEdit() })

    if (hit.kind === 'colResize') {
      const resizeCol = hit.col
      e.preventDefault()
      // Broadcast resize: when the dragged column is part of a multi-column
      // selection (whole-grid via corner-click, or a header-drag column
      // range), apply the new width to every column in that selection.
      // Otherwise fall back to single-column resize.
      const range = getSelRange()
      const cols =
        S.mode === 'all'
          ? Array.from({ length: TOTAL_COLS }, (_, c) => c)
          : S.mode === 'col' && resizeCol >= range.c0 && resizeCol <= range.c1
            ? Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => range.c0 + i)
            : [resizeCol]
      resizing = { cols, startX: e.clientX, startW: colW[resizeCol] ?? 100 }
      return
    }

    if (hit.kind === 'rowResize') {
      const resizeRowHit = hit.row
      e.preventDefault()
      const range = getSelRange()
      const rows =
        S.mode === 'all'
          ? Array.from({ length: TOTAL_ROWS }, (_, r) => r)
          : S.mode === 'row' && resizeRowHit >= range.r0 && resizeRowHit <= range.r1
            ? Array.from({ length: range.r1 - range.r0 + 1 }, (_, i) => range.r0 + i)
            : [resizeRowHit]
      resizingRow = { rows, startY: e.clientY, startH: rowH[resizeRowHit] ?? DEFAULT_ROW_H }
      return
    }

    if (hit.kind === 'fillHandle') {
      const { r0, c0, r1, c1 } = getSelRange()
      // Track the mousedown screen position so mousemove can ignore sub-pixel
      // jitter — otherwise a 1px wobble during the click extends the selection
      // and turns a click (or the first half of a dblclick) into a stray fill.
      filling = { r0, c0, r1, c1, startX: e.clientX, startY: e.clientY, moved: false }
      return
    }

    // Top-left corner cell → select the entire grid (Google Sheets behavior).
    if (hit.kind === 'corner') {
      if (editing) _commitAndHide()
      S.mode = 'all'
      S.anchor = { r: 0, c: 0 }
      S.head = { r: TOTAL_ROWS - 1, c: TOTAL_COLS - 1 }
      canvas.focus()
      render()
      onSelect?.('A1')
      return
    }

    if (hit.kind === 'colHeader') {
      const colHit = hit.col
      if (editing) _commitAndHide()
      // Pressing inside an existing multi-column selection keeps it and arms a
      // block move; otherwise select the single column (and arm a 1-col move).
      const range = getSelRange()
      const inBlock =
        S.mode === 'col' && range.c1 > range.c0 && colHit >= range.c0 && colHit <= range.c1
      if (!inBlock) {
        S.mode = 'col'
        S.anchor = { r: 0, c: colHit }
        S.head = { r: TOTAL_ROWS - 1, c: colHit }
        onSelect?.(colLabel(colHit) + ':' + colLabel(colHit))
      }
      // Moving columns is a data mutation — arm the drag only with write access.
      if (canEdit() && onColMove) {
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
              fromCol: colHit,
              count: 1,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
              insertCol: null,
            }
      }
      canvas.focus()
      render()
      return
    }

    if (hit.kind === 'rowHeader') {
      const rowHit = hit.row
      if (editing) _commitAndHide()
      S.mode = 'row'
      S.anchor = { r: rowHit, c: 0 }
      S.head = { r: rowHit, c: TOTAL_COLS - 1 }
      canvas.focus()
      render()
      onSelect?.(String(rowHit + 1) + ':' + String(rowHit + 1))
      return
    }

    // Picker check moved to top of mousedown (PRIORITY 0) — by here we know
    // no =-formula input is focused, so a click is a real selection.
    if (editing) _commitAndHide()
    if (hit.kind !== 'cell') return
    const h = hit
    canvas.focus()

    const hId = cellId(h.r, h.c)

    // Ctrl/Cmd+click on a hyperlink → open URL without starting a selection drag
    if ((e.ctrlKey || e.metaKey) && getFormat?.(hId)?.hyperlink) {
      onHyperlinkClick?.(getFormat(hId).hyperlink)
      return
    }

    const vrule = getValidation?.(hId)

    // Click on the tickbox of a checkbox-validated cell → toggle it. Clicking
    // elsewhere in the cell falls through to a normal selection.
    if (vrule?.type === 'checkbox' && canEdit()) {
      const x = geo.colX(h.c),
        y = geo.rowY(h.r)
      const w = geo.cw(h.c),
        hh = geo.rh(h.r)
      const box = checkboxRect(w, hh)
      const lx = (e.clientX - rect.left) / _zoom - x
      const ly = (e.clientY - rect.top) / _zoom - y
      if (lx >= box.x && lx <= box.x + box.size && ly >= box.y && ly <= box.y + box.size) {
        e.stopPropagation()
        moveSel(h.r, h.c)
        onCheckboxToggle?.(hId)
        return
      }
    }

    // A plain single-click anywhere in a list-validated cell opens its dropdown
    // (not just a caret zone). Record the candidate here and open it on mouseup,
    // so the click still falls through to select the cell / start a range-drag;
    // a drag or a double-click (which edits) cancels the open. Modifier-clicks
    // (shift/ctrl/cmd range ops) and non-list rules never open a dropdown.
    if (
      vrule?.type === 'list' &&
      canEdit() &&
      e.detail === 1 &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      const x = geo.colX(h.c),
        y = geo.rowY(h.r),
        w = geo.cw(h.c)
      _pendingListOpen = {
        hId,
        rule: vrule,
        r: h.r,
        c: h.c,
        downX: e.clientX,
        downY: e.clientY,
        pos: {
          x: rect.left + x * _zoom,
          y: rect.top + (y + geo.rh(h.r)) * _zoom,
          w: w * _zoom,
        },
      }
    }

    dragging = true
    // Redirect clicks on slave cells to their master cell
    let tr = h.r,
      tc = h.c
    if (getMasterId) {
      const mid = getMasterId(hId)
      if (mid) {
        const p = parseCellId(mid)
        if (p) {
          tr = p.row
          tc = p.col
        }
      }
    }
    if (e.shiftKey) extendSel(tr, tc)
    else {
      _tabAnchorCol = null
      moveSel(tr, tc)
    }
  })

  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect()

    // Read-only viewers: dbl-click neither edits a cell nor resizes/fills.
    if (!canEdit()) return

    const hit = hits.at(e.clientX, e.clientY, rect)

    // Double-click on the fill handle → fill down to the bottom of the
    // adjacent column's contiguous data run (Google Sheets behaviour).
    if (hit.kind === 'fillHandle') {
      const src = getSelRange()
      const end = _autoFillDownExtent(src)
      if (end > src.r1) {
        const total = { r0: src.r0, c0: src.c0, r1: end, c1: src.c1 }
        onFill?.(src, total, { withModifier: e.metaKey || e.ctrlKey })
      }
      return
    }

    // Double-click on the column resize edge or column header → auto-fit column width.
    if (hit.kind === 'colResize' || hit.kind === 'colHeader') {
      autoFitCol(hit.col)
      return
    }

    // Double-click on the row resize edge or row header → auto-fit row height.
    if (hit.kind === 'rowResize' || hit.kind === 'rowHeader') {
      autoFitRow(hit.row)
      return
    }

    if (hit.kind !== 'cell') return
    const h = hit
    // On a pivot output sheet, a double-click drills into the source rows
    // instead of editing the (regenerated) cell. The handler returns true
    // when it took over.
    if (onPivotDrill?.(h.r, h.c)) return
    showEditor(editValue(cellId(h.r, h.c)), 'edit')
  })

  let _lastLinkHover = null // 'r,c' of the linked cell the pointer is on

  canvas.addEventListener('mouseleave', () => {
    if (_lastLinkHover === null) return
    _lastLinkHover = null
    onLinkHover?.(null)
  })

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect()
    const resizeCol = geo.hitTestColResize(e.clientX, e.clientY, rect)
    const resizeRowHit = !resizing && geo.hitTestRowResize(e.clientX, e.clientY, rect)
    const overFill =
      !resizing && !resizingRow && !dragging && hitTestFillHandle(e.clientX, e.clientY, rect)
    const hoverCell =
      !resizing && !resizingRow && !dragging && !overFill
        ? geo.hitTest(e.clientX, e.clientY, rect)
        : null
    const overLink = hoverCell && getFormat?.(cellId(hoverCell.r, hoverCell.c))?.hyperlink
    // A column header (away from its resize edge) is grabbable — signal it with a
    // grab/grabbing cursor so drag-to-reorder is discoverable, not hidden.
    const overColHeader =
      resizeCol === null &&
      !resizing &&
      !resizingRow &&
      canEdit() &&
      onColMove &&
      geo.hitTestColHeader(e.clientX, e.clientY, rect) !== null
    if (colDrag && colDrag.moved) canvas.style.cursor = 'grabbing'
    else if (resizeCol !== null || resizing) canvas.style.cursor = 'col-resize'
    else if (resizeRowHit !== null || resizingRow) canvas.style.cursor = 'row-resize'
    else if (overFill) canvas.style.cursor = 'crosshair'
    else if (overColHeader) canvas.style.cursor = 'grab'
    else if (overLink) canvas.style.cursor = 'pointer'
    else canvas.style.cursor = 'default'

    // Hover-card feed: notify once per enter/leave of a linked cell (not per
    // pixel). The editor layers debounce + the popover itself on top of this.
    const linkKey = overLink ? `${hoverCell.r},${hoverCell.c}` : null
    if (linkKey !== _lastLinkHover) {
      _lastLinkHover = linkKey
      onLinkHover?.(
        linkKey
          ? { r: hoverCell.r, c: hoverCell.c, id: cellId(hoverCell.r, hoverCell.c), url: overLink }
          : null,
      )
    }

    if (filling) {
      if (!filling.moved) {
        const dx = e.clientX - filling.startX,
          dy = e.clientY - filling.startY
        if (Math.hypot(dx, dy) < 4) return
        filling.moved = true
      }
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) extendSel(h.r, h.c)
      return
    }
    if (pick.isDragging()) {
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) pick.dragTo(h.r, h.c)
      return
    }
    if (!dragging) return
    const h = geo.hitTest(e.clientX, e.clientY, rect)
    if (h) extendSel(h.r, h.c)
  })

  canvas.addEventListener('mouseup', (e) => {
    if (filling) {
      const src = filling
      const total = getSelRange()
      const hasTarget =
        total.r0 !== src.r0 || total.c0 !== src.c0 || total.r1 !== src.r1 || total.c1 !== src.c1
      // Modifier flag lets onFill toggle copy ↔ series — Cmd/Ctrl held = invert
      // the auto-detected mode (matches Google Sheets behaviour).
      if (hasTarget) onFill?.(src, total, { withModifier: e.metaKey || e.ctrlKey })
      filling = null
    }
    // Return focus to whichever input fed the picker so the user keeps typing.
    pick.endDrag()
    // A click that stayed on its origin list cell (no range-drag) opens the
    // dropdown. A drag past a few px is a selection, so it cancels the open.
    if (_pendingListOpen) {
      const p = _pendingListOpen
      _pendingListOpen = null
      const moved = Math.hypot(e.clientX - p.downX, e.clientY - p.downY) > 4
      if (!moved) {
        const rect = canvas.getBoundingClientRect()
        const h = geo.hitTest(e.clientX, e.clientY, rect)
        if (h && h.r === p.r && h.c === p.c) onDropdownClick?.(p.hId, p.rule, p.pos)
      }
    }
    dragging = false
  })

  function _onDocMouseMove(e) {
    if (colDrag) {
      const moved = Math.hypot(e.clientX - colDrag.startX, e.clientY - colDrag.startY) >= 5
      if (colDrag.moved || moved) {
        colDrag.moved = true
        colDrag.insertCol = geo.colInsertIndex(e.clientX, canvas.getBoundingClientRect())
        document.body.style.cursor = 'grabbing'
        render()
      }
    }
    if (resizing) {
      // Drag delta is in physical CSS px; colW stores logical units, so undo
      // the zoom on the delta before applying. When multiple columns are in
      // the resize target (whole-grid select or header-drag range), every
      // one gets the same final width — matches Sheets / Excel where
      // resizing any column of a multi-column selection sets all to the
      // dragged column's new width.
      const w = Math.max(30, resizing.startW + (e.clientX - resizing.startX) / _zoom)
      for (const c of resizing.cols) colW[c] = w
      _applyCanvasSize()
      render()
    }
    if (resizingRow) {
      const h = Math.max(16, resizingRow.startH + (e.clientY - resizingRow.startY) / _zoom)
      for (const r of resizingRow.rows) rowH[r] = h
      _applyCanvasSize()
      render()
    }
  }

  function _onDocMouseUp() {
    if (colDrag) {
      const cd = colDrag
      colDrag = null
      document.body.style.cursor = ''
      if (cd.moved && cd.insertCol != null) {
        onColMove?.(cd.fromCol, cd.insertCol, cd.count)
      }
      render()
    }
    const didResize = resizing || resizingRow
    if (resizing) resizing = null
    if (resizingRow) resizingRow = null
    if (didResize) onResizeEnd?.()
  }

  document.addEventListener('mousemove', _onDocMouseMove)
  document.addEventListener('mouseup', _onDocMouseUp)

  // Document-level keydown delegator — picks up arrow keys for the top
  // formula bar input without touching Vue.  The in-cell overlay handles
  // its own arrow keys directly in its keydown listener below, so we skip
  // overlay events here to avoid double-handling.
  function _onDocPickerKey(e) {
    if (e.target === overlay.el) return // overlay is self-contained
    const target = pick.target()
    if (!target) return
    // Home/End/Shift+Home/Shift+End always move text caret. Never picker.
    if (e.key === 'Home' || e.key === 'End') return

    const dirs = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    const dir = dirs[e.key]
    const mod = e.ctrlKey || e.metaKey

    // PICKING mode — every keydown is meaningful.
    if (pick.isKeyPicking(target)) {
      if (dir) {
        e.preventDefault()
        e.stopPropagation()
        pick.keyMove(dir[0], dir[1], e.shiftKey, mod)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        pick.keyCancel()
        return // EDITING continues
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        pick.keyCommit()
        return // fall through to commit
      }
      // Any other key (digit, letter, operator, comma, close-paren, etc.):
      // exit PICKING and let the keystroke reach the input naturally.
      pick.keyCommit()
      return
    }

    // EDITING mode — any arrow in a `=…` input drives the picker. keyStart
    // decides REPLACE vs INSERT; gating it here was breaking second-range
    // picks in =VLOOKUP(..., …).
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      pick.keyStart(target, dir[0], dir[1], e.shiftKey)
      return
    }
    // Otherwise let the native input handle the key (caret moves in text).
  }
  // capture=true so we beat the overlay's own keydown listener that would
  // commit-and-move on plain arrows.
  document.addEventListener('keydown', _onDocPickerKey, true)

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      // Wheel deltas are physical pixels; scroll is logical. Divide so a single
      // notch advances the same logical distance regardless of zoom.
      scrollTo(scroll.x + e.deltaX / _zoom, scroll.y + e.deltaY / _zoom)
    },
    { passive: false },
  )

  canvas.setAttribute('tabindex', '0')
  canvas.addEventListener('keydown', (e) => {
    const { r, c } = S.anchor
    const { r: er, c: ec } = S.head
    const mod = e.ctrlKey || e.metaKey
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
    const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }

    // Cmd/Ctrl+A — Excel/Sheets pattern: first press selects the data region
    // (A1 → last used cell), second press expands to the entire grid. Empty
    // sheets jump straight to the whole-grid selection.
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      const last = _lastUsedCell()
      const hasData = last.r > 0 || last.c > 0 || hasVal(cellId(0, 0))
      const cur = getSelRange()
      const onDataRegion =
        hasData && cur.r0 === 0 && cur.c0 === 0 && cur.r1 === last.r && cur.c1 === last.c
      if (!hasData || onDataRegion) {
        setSelRange({ r0: 0, c0: 0, r1: TOTAL_ROWS - 1, c1: TOTAL_COLS - 1, mode: 'all' })
      } else {
        setSelRange({ r0: 0, c0: 0, r1: last.r, c1: last.c, mode: 'cell' })
      }
      return
    }

    // Cmd+Arrow / Cmd+Shift+Arrow — jump to data-region edge
    if (mod && isArrow) {
      e.preventDefault()
      _tabAnchorCol = null
      const [dr, dc] = dirs[e.key]
      if (e.shiftKey) {
        const t = _jumpEdge(er, ec, dr, dc)
        extendSel(t.r, t.c)
      } else {
        const t = _jumpEdge(r, c, dr, dc)
        moveSel(t.r, t.c)
      }
      return
    }

    // Cmd+Home / Cmd+End
    if (mod && e.key === 'Home') {
      e.preventDefault()
      if (e.shiftKey) extendSel(0, 0)
      else moveSel(0, 0)
      return
    }
    if (mod && e.key === 'End') {
      e.preventDefault()
      const last = _lastUsedCell()
      if (e.shiftKey) extendSel(last.r, last.c)
      else moveSel(last.r, last.c)
      return
    }

    // Shift+Arrow — extend selection one cell
    if (e.shiftKey && !mod && isArrow) {
      e.preventDefault()
      _tabAnchorCol = null
      const [dr, dc] = dirs[e.key]
      extendSel(er + dr, ec + dc)
      return
    }

    if (e.key === 'F2') {
      e.preventDefault()
      showEditor(editValue(cellId(r, c)), 'edit')
      return
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault()
      if (!canEdit()) return
      const { r0, c0, r1, c1 } = getSelRange()
      // Bail before touching the local cell cache — otherwise a blocked host
      // handler would leave the canvas showing empty cells the engine still holds.
      if (!_rangeEditable(r0, c0, r1, c1)) {
        onBlockedEdit?.()
        return
      }
      if (r0 === r1 && c0 === c1) {
        onCommit?.(cellId(r, c), '')
      } else {
        const cells = []
        for (let dr = r0; dr <= r1; dr++)
          for (let dc = c0; dc <= c1; dc++) cells.push({ id: cellId(dr, dc), value: '' })
        onBatchCommit?.(cells)
        for (const { id } of cells) delete data[id]
        render()
      }
      return
    }

    // Shift+Space — select whole row(s); Ctrl/Cmd+Space — whole column(s);
    // Ctrl/Cmd+Shift+Space — the entire sheet. Mirrors Google Sheets. Kept
    // above the printable-char handler below so the Space keystroke isn't
    // swallowed into cell-edit mode. The anchor stays on the active cell
    // (r, c) — getSelRange() expands the perpendicular axis by S.mode — so the
    // highlighted cell keeps its column/row and arrows + typing resume from
    // there, exactly like Sheets. A pre-existing range promotes its span.
    if (e.code === 'Space' || e.key === ' ') {
      if (mod && e.shiftKey) {
        e.preventDefault()
        S.mode = 'all'
        S.anchor = { r: 0, c: 0 }
        S.head = { r: TOTAL_ROWS - 1, c: TOTAL_COLS - 1 }
        render()
        onSelect?.('A1')
        return
      }
      if (mod) {
        e.preventDefault()
        S.mode = 'col'
        S.anchor = { r, c }
        S.head = { r, c: ec }
        const cc0 = Math.min(c, ec),
          cc1 = Math.max(c, ec)
        render()
        onSelect?.(colLabel(cc0) + ':' + colLabel(cc1))
        return
      }
      if (e.shiftKey) {
        e.preventDefault()
        S.mode = 'row'
        S.anchor = { r, c }
        S.head = { r: er, c }
        const rr0 = Math.min(r, er),
          rr1 = Math.max(r, er)
        render()
        onSelect?.(String(rr0 + 1) + ':' + String(rr1 + 1))
        return
      }
    }

    // PageDown / PageUp — move the active cell one screenful down / up; Shift
    // extends the selection instead. Page size is the count of rows currently
    // visible in the viewport, so it tracks zoom and row heights.
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault()
      _tabAnchorCol = null
      const top = geo.firstVisRow()
      const page = Math.max(1, geo.lastVisRow(top, vp.cssH) - top)
      const dir = e.key === 'PageDown' ? 1 : -1
      const from = e.shiftKey ? er : r
      const target = _skipHiddenR(from + dir * page, dir)
      if (e.shiftKey) extendSel(target, ec)
      else moveSel(target, c)
      return
    }

    if (e.key.length === 1 && !mod) {
      e.preventDefault()
      showEditor(e.key)
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (_tabAnchorCol === null) _tabAnchorCol = c
      const dc = e.shiftKey ? -1 : 1
      moveSel(r, _skipHiddenC(c + dc, dc))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Google Sheets opens the selected cell for editing on a plain Enter,
      // caret after the existing text — the same begin-edit path as F2. The
      // move-down below is what the *second* Enter does, from inside the
      // editor. Shift/modified Enter, a multi-cell selection and a read-only
      // viewer keep Enter as pure navigation, so moving around the grid never
      // depends on being allowed to write.
      const { r0, c0, r1, c1 } = getSelRange()
      const singleCell = r0 === r1 && c0 === c1
      if (singleCell && !e.shiftKey && !mod && !e.altKey && canEdit()) {
        showEditor(editValue(cellId(r, c)), 'edit')
        return
      }
      const anchorC = _tabAnchorCol ?? c
      _tabAnchorCol = null
      const dr = e.shiftKey ? -1 : 1
      moveSel(_skipHiddenR(r + dr, dr), anchorC)
      return
    }
    const moves = {
      ArrowUp: [r - 1, c, -1, 0],
      ArrowDown: [r + 1, c, 1, 0],
      ArrowLeft: [r, c - 1, 0, -1],
      ArrowRight: [r, c + 1, 0, 1],
    }
    if (moves[e.key]) {
      e.preventDefault()
      _tabAnchorCol = null
      const [nr, nc, dr, dc] = moves[e.key]
      // Step past any hidden rows/cols so e.g. ArrowDown over a filter gap
      // lands on the next *visible* row instead of dropping the selection
      // into a 0-height row the user can't see.
      const tr = dr !== 0 ? _skipHiddenR(nr, dr) : nr
      const tc = dc !== 0 ? _skipHiddenC(nc, dc) : nc
      moveSel(tr, tc)
    }
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
    document.removeEventListener('mousemove', _onDocMouseMove)
    document.removeEventListener('mouseup', _onDocMouseUp)
    document.removeEventListener('keydown', _onDocPickerKey, true)
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
    isEditingFormula: () => editing && overlay.getValue().startsWith('='),
    // Whether the in-cell overlay editor is open at all. The host uses this to
    // hand clipboard ops (copy/cut/paste) to the textarea's native handling
    // while editing, instead of hijacking them for grid-level cell ops.
    isEditing: () => editing,
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
