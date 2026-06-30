import { createGeometry } from './geometry.js'
import { createRenderer } from './renderer.js'
import { createOverlay }  from './overlay.js'
import { TOTAL_ROWS, TOTAL_COLS, DEFAULT_TOTAL_ROWS, DEFAULT_TOTAL_COLS, DEFAULT_ROW_H, ROW_HEADER_W, COL_HEADER_H, setTotalRows, setTotalCols } from './constants.js'
import { cellId, colLabel, parseCellId } from '../utils/cells.js'
import { AC_FUNS, AC_FUN_KEYS, parseAcToken } from '../utils/formula-ac.js'
import { isWrapText } from '../utils/text-wrap.js'
import { CHIP, chipMetrics } from './chip-geometry.js'

export { colLabel, cellId, parseCellId } from '../utils/cells.js'

export function createGrid(canvas, { onSelect, onCommit, onInput, onCancel, getFormat, onFill, onBatchCommit, getMergeInfo, isSlave, getMasterId, getComment, getValidation, getCondFormat, getRightInset, onHyperlinkClick, onDropdownClick, onPivotDrill, onResizeEnd, getSheetNames, getCurrentSheet, getEditingHomeSheet, getDisplay, getCellIds, lazyValues = false } = {}) {
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1

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
  const getValue = id => _lazyValues ? getDisplay(id) : data[id]
  const hasVal   = id => !!getValue(id)
  const cellIds  = () => _lazyValues ? (getCellIds ? getCellIds() : []) : Object.keys(data)
  function setLazyValues(on) { _lazyValues = !!on && typeof getDisplay === 'function'; render() }
  function isLazyValues() { return _lazyValues }
  const colW = {}
  const rowH = {}

  let sel    = { r: 0, c: 0 }
  let selEnd = { r: 0, c: 0 }
  let selMode    = 'cell'  // 'cell' | 'col' | 'row'
  let dragging   = false
  let editing    = false
  let resizing   = null  // { col, startX, startW }
  let resizingRow = null  // { row, startY, startH }
  let filling    = null  // { startCell }
  let _tabAnchorCol = null  // column where the current Tab sequence started

  const scroll     = { x: 0, y: 0 }
  const freeze     = { rows: 0, cols: 0 }
  const hiddenRows = new Set()
  const hiddenCols = new Set()
  // Subset of hiddenRows that came from an active filter (vs a manual hide).
  // Tracked separately so grid-painter can suppress the bold "rows hidden
  // here" marker for filter gaps, which would otherwise cover every row
  // boundary in a filtered region.
  const filterHiddenRows = new Set()
  let cssW = 0, cssH = 0

  // Marching-ants rect drawn over cut/copy source until paste/Escape clears it.
  let marchAnts  = null     // { r0, c0, r1, c1 } or null
  let marchPhase = 0
  let _marchRAF  = null

  // User-facing zoom (Ctrl+= / Ctrl+-). Affects ctx transform + hit tests.
  let _zoom = 1

  let _acEl = null, _acItems = [], _acIdx = 0

  const geo      = createGeometry(colW, rowH, scroll, freeze, hiddenRows, hiddenCols, () => _zoom, filterHiddenRows)
  const renderer = createRenderer(ctx, geo)
  const overlay  = createOverlay(canvas.parentElement)
  _acSetup()

  // ── Render ──────────────────────────────────────────────────────────────────

  let _raf = null
  function scheduleRender() {
    if (!_raf) _raf = requestAnimationFrame(() => { _raf = null; render() })
  }

  const _renderListeners = []
  function onRender(cb) { _renderListeners.push(cb); return () => { const i = _renderListeners.indexOf(cb); if (i >= 0) _renderListeners.splice(i, 1) } }

  // Diff overlay: { 'A1': true, ... } for the active sheet.  Used in version-
  // preview mode to paint changed cells with a teal highlight.  Reset on
  // setDiffOverlay(null) when leaving preview.
  let _diffCells = null
  function setDiffOverlay(diffBySheet) {
    if (!diffBySheet) { _diffCells = null; scheduleRender(); return }
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

  function render() {
    renderer.render({ cssW, cssH, getValue, sel, selEnd, selMode, editing, getFormat, freeze, getMergeInfo, isSlave, getComment, getValidation, getCondFormat, getRightInset, getDiffFor: _diffCells ? _getDiffFor : null, marchAnts, marchPhase, pickerRect, zoom: _zoom })
    for (const cb of _renderListeners) cb()
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
    if (_marchRAF) { cancelAnimationFrame(_marchRAF); _marchRAF = null }
    if (marchAnts) _marchRAF = requestAnimationFrame(_stepMarch)
    else           render()
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
    const c1 = geo.lastVisCol(c0, cssW)
    for (let c = c0; c <= c1; c++) rects.push({ c, x: geo.colX(c) * _zoom, width: geo.cw(c) * _zoom })
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

  function getSelRange() {
    return {
      r0: Math.min(sel.r, selEnd.r), c0: Math.min(sel.c, selEnd.c),
      r1: Math.max(sel.r, selEnd.r), c1: Math.max(sel.c, selEnd.c),
      mode: selMode,
    }
  }

  // Restore a rectangular selection (used by the contextmenu handler when
  // mousedown collapsed a multi-cell range the user wanted to keep).
  function setSelRange({ r0, c0, r1, c1, mode } = {}) {
    if (r0 == null || c0 == null || r1 == null || c1 == null) return
    selMode = mode || 'cell'
    sel    = geo.clamp(r0, c0)
    selEnd = geo.clamp(r1, c1)
    render()
    onSelect?.(cellId(sel.r, sel.c))
  }

  // Snapshot of the selection just before the most recent mousedown — lets the
  // contextmenu handler tell whether mousedown collapsed a multi-cell range so
  // it can restore it for actions like Split text to columns.
  let _preMousedownSel = null
  function getPreMousedownSel() { return _preMousedownSel }

  // Max scroll so the last col/row sits flush with the viewport's right/bottom.
  // Beyond this we'd just be showing empty canvas past the sheet — Google
  // Sheets clamps to here, so do we.
  function _sheetTotalW() { let w = 0; for (let c = 0; c < TOTAL_COLS; c++) w += geo.cw(c); return w }
  function _sheetTotalH() { let h = 0; for (let r = 0; r < TOTAL_ROWS; r++) h += geo.rh(r); return h }
  function _maxScrollX()  { return Math.max(0, _sheetTotalW() + ROW_HEADER_W - cssW) }
  function _maxScrollY()  { return Math.max(0, _sheetTotalH() + COL_HEADER_H - cssH) }
  function _clampScroll() {
    scroll.x = Math.max(0, Math.min(scroll.x, _maxScrollX()))
    scroll.y = Math.max(0, Math.min(scroll.y, _maxScrollY()))
  }

  function ensureVisible(r, c) {
    if (c < (freeze.cols || 0) || r < (freeze.rows || 0)) return
    const frozW_ = geo.frozenW ? geo.frozenW() : 0
    const frozH_ = geo.frozenH ? geo.frozenH() : 0
    const x = geo.colX(c), y = geo.rowY(r), w = geo.cw(c), h = geo.rh(r)
    const minX = 50 + frozW_, minY = 24 + frozH_
    if (x < minX)        scroll.x = Math.max(0, scroll.x - (minX - x))
    else if (x+w > cssW) scroll.x += x + w - cssW + 8
    if (y < minY)        scroll.y = Math.max(0, scroll.y - (minY - y))
    else if (y+h > cssH) scroll.y += y + h - cssH + 8
    _clampScroll()
  }

  function moveSel(r, c) {
    selMode = 'cell'
    const p = geo.clamp(r, c)
    sel = selEnd = p
    ensureVisible(sel.r, sel.c)
    // Any non-picker selection move dismisses a lingering picker highlight.
    if (pickerRect) { pickerRect = null }
    render()
    onSelect?.(cellId(sel.r, sel.c))
  }

  function extendSel(r, c) {
    selEnd = geo.clamp(r, c)
    // ensureVisible target depends on selMode. For a whole-column selection
    // selEnd.r is pinned to the last row, so scrolling to it on a sideways
    // extend would jump us to the bottom of the new column — not what the
    // user expects from Shift+Right on a column header. Same in reverse for
    // whole-row selections.
    if (selMode === 'col')      ensureVisible(0,         selEnd.c)
    else if (selMode === 'row') ensureVisible(selEnd.r,  0)
    else                        ensureVisible(selEnd.r,  selEnd.c)
    render()
    // Re-emit onSelect so subscribers (collab cursor broadcaster) see the
    // new range. The anchor cell id is unchanged here — callers that care
    // about anchor identity short-circuit on equality; callers that fetch
    // grid.getSelection() pick up the extended range.
    onSelect?.(cellId(sel.r, sel.c))
  }

  // Jump to data-region edge (Cmd+Arrow behaviour matching Google Sheets)
  function _jumpEdge(startR, startC, dr, dc) {
    const maxR = TOTAL_ROWS - 1, maxC = TOTAL_COLS - 1
    const curFilled = hasVal(cellId(startR, startC))
    let nr = Math.max(0, Math.min(maxR, startR + dr))
    let nc = Math.max(0, Math.min(maxC, startC + dc))
    if (curFilled && hasVal(cellId(nr, nc))) {
      // Scan forward to end of contiguous block
      let r = startR, c = startC
      while (true) {
        const tr = r + dr, tc = c + dc
        if (tr < 0 || tr > maxR || tc < 0 || tc > maxC) break
        if (!hasVal(cellId(tr, tc))) break
        r = tr; c = tc
      }
      return { r, c }
    } else {
      // Scan forward to next filled cell
      let r = startR + dr, c = startC + dc
      while (r >= 0 && r <= maxR && c >= 0 && c <= maxC) {
        if (hasVal(cellId(r, c))) return { r, c }
        r += dr; c += dc
      }
      // No filled cell — go to grid boundary
      return {
        r: dr > 0 ? maxR : dr < 0 ? 0 : startR,
        c: dc > 0 ? maxC : dc < 0 ? 0 : startC,
      }
    }
  }

  function _lastUsedCell() {
    let maxR = 0, maxC = 0
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (p) { if (p.row > maxR) maxR = p.row; if (p.col > maxC) maxC = p.col }
    }
    return { r: maxR, c: maxC }
  }

  // ── Formula autocomplete ─────────────────────────────────────────────────────

  function _acSetup() {
    _acEl = document.createElement('div')
    _acEl.style.cssText = [
      'position:absolute', 'display:none', 'z-index:50',
      'background:#fff', 'border:1px solid #e2e2e2', 'border-radius:6px',
      'box-shadow:0 4px 14px rgba(0,0,0,.1)',
      'min-width:200px', 'max-height:208px', 'overflow-y:auto',
      'padding:4px 0',
      'font:13px Inter,system-ui,sans-serif',
    ].join(';')
    canvas.parentElement.appendChild(_acEl)
  }

  // _acItems: { name, kind: 'fn' | 'sheet' }[]
  function _acUpdate(value, cursor) {
    if (!_acEl) return
    const result = parseAcToken(value, cursor)
    if (!result) { _acHide(); return }
    const up     = result.tok.toUpperCase()
    const fns    = AC_FUN_KEYS.filter(n => n.startsWith(up)).slice(0, 6)
    const sheets = (getSheetNames?.() || [])
      .filter(n => n.toUpperCase().startsWith(up) && !fns.includes(n.toUpperCase()))
      .slice(0, 3)
    _acItems = [
      ...fns.map(name => ({ name, kind: 'fn' })),
      ...sheets.map(name => ({ name, kind: 'sheet' })),
    ]
    if (!_acItems.length) { _acHide(); return }
    _acIdx = 0
    _acRender()
  }

  function _acRender() {
    if (!_acEl) return
    _acEl.innerHTML = ''
    _acItems.forEach((item, i) => {
      const row = document.createElement('div')
      row.style.cssText = `display:flex;align-items:baseline;gap:10px;padding:6px 12px;cursor:pointer;white-space:nowrap;border-radius:4px;${i === _acIdx ? 'background:#f3f3f3;' : ''}`
      const right = item.kind === 'sheet'
        ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#0891b2;background:#ecfeff;border-radius:3px;padding:1px 5px;">sheet</span>`
        : `<span style="font-size:11px;color:#7c7c7c;">${AC_FUNS[item.name]}</span>`
      row.innerHTML = `<span style="font-weight:600;min-width:80px;color:#171717;">${item.name}</span>${right}`
      row.addEventListener('mousedown', e => { e.preventDefault(); _acCommit(item) })
      row.addEventListener('mouseover', () => { _acIdx = i; _acHighlight() })
      _acEl.appendChild(row)
    })
    const ox = parseFloat(overlay.el.style.left)   || 0
    const oy = parseFloat(overlay.el.style.top)    || 0
    const oh = parseFloat(overlay.el.style.height) || 24
    _acEl.style.left    = ox + 'px'
    _acEl.style.top     = (oy + oh + 2) + 'px'
    _acEl.style.display = 'block'
    // Flip upward if the list clips the viewport bottom.
    const rect = _acEl.getBoundingClientRect()
    if (rect.bottom > window.innerHeight - 8) {
      _acEl.style.top = Math.max(0, oy - _acEl.offsetHeight - 2) + 'px'
    }
  }

  function _acHighlight() {
    if (!_acEl) return
    Array.from(_acEl.children).forEach((row, i) => {
      row.style.background = i === _acIdx ? '#f3f3f3' : ''
    })
  }

  function _acHide() {
    _acItems = []; _acIdx = 0
    if (_acEl) _acEl.style.display = 'none'
  }

  // item: { name, kind: 'fn' | 'sheet' }
  function _acCommit(item) {
    const input  = overlay.el
    const cursor = input.selectionStart
    const result = parseAcToken(input.value, cursor)
    if (result) {
      const { tokStart } = result
      const suffix = item.kind === 'sheet' ? '!' : '('
      const newVal = input.value.slice(0, tokStart) + item.name + suffix + input.value.slice(cursor)
      input.value  = newVal
      const pos    = tokStart + item.name.length + 1
      input.setSelectionRange(pos, pos)
      onInput?.(cellId(sel.r, sel.c), newVal)
    }
    _acHide()
    input.focus()
  }

  // ── Inline editor ────────────────────────────────────────────────────────────

  // 'enter' mode (fresh typing) lets arrow keys commit-and-move like Excel /
  // Google Sheets. 'edit' mode (F2 / dblclick on existing content) keeps arrow
  // keys as cursor movement inside the input.
  let editMode = 'enter'

  // Formula-reference picker. Active while *any* focused <input> contains a
  // formula (`=…`) and the user clicks/drags cells. The click inserts the
  // cell's ref into that input instead of moving selection. Drag extends to a
  // range. Works for both the inline cell editor (overlay) and the top
  // formula bar — anything that's a currently-focused <input> with =-prefixed
  // text qualifies.
  let picker     = null  // { anchorR, anchorC, target: HTMLInputElement }
  // The visible amber dashed highlight. Tracks the last picked cell/range and
  // stays visible until the edit commits or is cancelled.
  let pickerRect = null  // { r0, c0, r1, c1 }
  // Keyboard-driven picker state ("PICKING" in the state-machine doc). Set by
  // arrow keys while editing a formula at a ref-acceptable caret position.
  // Going to null returns us to EDITING (text caret moves). See _pickerKb*.
  let pickerKb   = null  // { target, anchorR, anchorC, headR, headC, insertStart, insertEnd, savedValue, savedCaret }

  function _pickTarget() {
    const ae = document.activeElement
    if (!ae || ae.tagName !== 'INPUT') return null
    if (typeof ae.value !== 'string' || !ae.value.startsWith('=')) return null
    return ae
  }

  function _isPickMode() { return !!_pickTarget() }

  // Returns the index right before any partial ref characters that abut the
  // cursor — e.g. cursor after `=SUM(A1:B` → start of `A1:B`. Also consumes
  // an immediately-preceding sheet prefix (`Sheet1!` or `'Sheet 1'!`) so a
  // second cross-sheet pick replaces the *whole* prior ref instead of just
  // its cell-ref tail (which produced `Sheet1!Sheet1!B2:E21`).
  function _refReplaceStart(input) {
    const pos = input.selectionStart
    const val = input.value
    const m = val.slice(0, pos).match(/(?:'(?:[^']|'')*'!|[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+\d*(?::[A-Z]*\d*)?$/i)
    return m ? pos - m[0].length : pos
  }

  function _refForRange(r0, c0, r1, c1, sheetName) {
    const a = colLabel(c0) + (r0 + 1)
    const range = (r0 === r1 && c0 === c1) ? a : a + ':' + colLabel(c1) + (r1 + 1)
    // Sheet prefix only when the pick is on a different sheet than the one
    // the formula was started on. Quote any name that isn't a clean bare
    // identifier (letters/digits/underscore, not starting with a digit) —
    // dots, dashes, spaces, apostrophes all need wrapping per Excel rules.
    // The engine tokenizer accepts both bare and quoted forms.
    if (!sheetName) return range
    const bareOk = /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)
    if (bareOk) return `${sheetName}!${range}`
    const escaped = sheetName.replace(/'/g, "''")
    return `'${escaped}'!${range}`
  }
  // Cross-sheet picker support. When the user is editing a formula on one
  // sheet (the "editing home") but currently viewing another sheet, every
  // ref written by the picker needs to carry that other sheet's name as a
  // prefix so the formula reads `Sheet1!A1:B5` instead of just `A1:B5`.
  // Returns the bare sheet name when foreign, or null otherwise.
  function _crossSheetName() {
    const cur  = getCurrentSheet?.()
    const home = getEditingHomeSheet?.()
    return home && cur && cur !== home ? cur : null
  }
  // Sheet prefix in the exact form the engine tokenizer parses — bare for
  // clean identifiers, apostrophe-wrapped for everything else (matching
  // _refForRange's own rule below).
  function _sheetPrefixIfForeign() {
    const sn = _crossSheetName()
    if (!sn) return ''
    const bareOk = /^[A-Za-z_][A-Za-z0-9_]*$/.test(sn)
    return bareOk ? `${sn}!` : `'${sn.replace(/'/g, "''")}'!`
  }

  function _clearPickerHighlight() {
    if (!pickerRect && !picker && !pickerKb) return
    picker = null
    pickerKb = null
    pickerRect = null
    render()
  }

  function _writeRef(input, refText, replaceStart) {
    const val = input.value
    const cursor = input.selectionStart
    const next = val.slice(0, replaceStart) + refText + val.slice(cursor)
    input.value = next
    const newPos = replaceStart + refText.length
    input.setSelectionRange(newPos, newPos)
    // Notify any framework binding (Vue v-model / @input listeners on the
    // top formula bar) plus our overlay's existing input handler.
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // ── Formula picker — keyboard state machine ─────────────────────────────────
  //
  // While editing a `=…` formula, arrow keys at a *reference-acceptable* caret
  // position drive a phantom picker cursor on the grid (match Google Sheets):
  //   IDLE → showEditor → EDITING
  //   EDITING → (arrow at ref pos) → PICKING → (arrow) updates ref live
  //   EDITING → (arrow mid-token)  → native caret move (no picker)
  //   PICKING → (type non-arrow)   → EDITING, inserted ref stays
  //   PICKING → (Esc)              → EDITING, inserted ref removed
  //   PICKING → (Enter/Tab)        → IDLE,    formula committed
  //
  // The text caret BEFORE the picker started is preserved so Esc can revert.

  const REF_PRECEDERS = '=(,;+-*/:&^<>%'

  function _isRefPosition(input) {
    const pos = input.selectionStart
    if (pos == null) return false
    const left = input.value.slice(0, pos)
    if (!left.startsWith('=')) return false
    const trimmed = left.replace(/\s+$/, '')
    if (trimmed === '=') return true
    const last = trimmed[trimmed.length - 1]
    if (REF_PRECEDERS.includes(last)) return true
    // Trailing chars form a partial cell ref AND are preceded by a ref-preceder.
    const m = trimmed.match(/([A-Z]+\d*(?::[A-Z]*\d*)?)$/i)
    if (!m) return false
    const before = trimmed.slice(0, trimmed.length - m[0].length).replace(/\s+$/, '')
    if (!before) return true                                  // just '=A1'
    const prev = before[before.length - 1]
    return REF_PRECEDERS.includes(prev)
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
  // ensureVisible but works regardless of `sel` (which we don't move).
  function _scrollIntoView(r, c) {
    const frozW_ = geo.frozenW(), frozH_ = geo.frozenH()
    if (c >= (freeze.cols || 0)) {
      const x = geo.colX(c), w = geo.cw(c)
      const minX = ROW_HEADER_W + frozW_
      if (x < minX)         scroll.x = Math.max(0, scroll.x - (minX - x))
      else if (x + w > cssW) scroll.x += x + w - cssW + 8
    }
    if (r >= (freeze.rows || 0)) {
      const y = geo.rowY(r), h = geo.rh(r)
      const minY = COL_HEADER_H + frozH_
      if (y < minY)         scroll.y = Math.max(0, scroll.y - (minY - y))
      else if (y + h > cssH) scroll.y += y + h - cssH + 8
    }
    _clampScroll()
  }

  // Compute the ref text from anchor+head and rewrite the inserted span.
  function _pickerKbRender() {
    if (!pickerKb) return
    const { target, anchorR, anchorC, headR, headC, insertStart } = pickerKb
    const r0 = Math.min(anchorR, headR), r1 = Math.max(anchorR, headR)
    const c0 = Math.min(anchorC, headC), c1 = Math.max(anchorC, headC)
    const ref = _refForRange(r0, c0, r1, c1, _crossSheetName())
    // Replace the previously-inserted span (anchored by insertStart).
    const val = target.value
    const next = val.slice(0, insertStart) + ref + val.slice(pickerKb.insertEnd)
    target.value = next
    pickerKb.insertEnd = insertStart + ref.length
    target.setSelectionRange(pickerKb.insertEnd, pickerKb.insertEnd)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    pickerRect = { r0, c0, r1, c1 }
    _scrollIntoView(headR, headC)
    render()
  }

  // Enter PICKING from EDITING. Anchor starts at the cell directly adjacent
  // to the edited cell, in the direction of the arrow keypress.
  function _pickerKbStart(target, dr, dc, shiftKey) {
    const savedCaret = target.selectionStart
    const savedValue = target.value

    let anchorR, anchorC, headR, headC, insertStart, insertEnd

    // Mouse → keyboard handoff: a prior click/drag set `picker` and the ref
    // was inserted at the input's current cursor. Adopt that anchor + rect
    // so Shift+arrow extends from where the user dragged, not from `sel`.
    if (picker && picker.target === target && pickerRect) {
      const refLen = _refForRange(pickerRect.r0, pickerRect.c0, pickerRect.r1, pickerRect.c1, _crossSheetName()).length
      insertEnd   = target.selectionStart
      insertStart = Math.max(0, insertEnd - refLen)

      anchorR = picker.anchorR
      anchorC = picker.anchorC
      // Current "head" = the rect corner opposite the anchor.
      const curHeadR = (anchorR === pickerRect.r0) ? pickerRect.r1 : pickerRect.r0
      const curHeadC = (anchorC === pickerRect.c0) ? pickerRect.c1 : pickerRect.c0
      headR = curHeadR + dr
      headC = curHeadC + dc
    } else {
      insertStart = _refReplaceStart(target)
      insertEnd   = target.selectionStart
      // Fresh pick — start one step from the edited cell.
      headR = sel.r + dr
      headC = sel.c + dc
      anchorR = headR; anchorC = headC
    }

    // Clamp, skip hidden, resolve merge masters.
    headR = Math.max(0, Math.min(TOTAL_ROWS - 1, headR))
    headC = Math.max(0, Math.min(TOTAL_COLS - 1, headC))
    if (dr !== 0) headR = _skipHiddenR(headR, dr)
    if (dc !== 0) headC = _skipHiddenC(headC, dc)
    const m = _resolveMaster(headR, headC)
    headR = m.r; headC = m.c
    // Plain arrow collapses the range; Shift+arrow extends.
    if (!shiftKey) { anchorR = headR; anchorC = headC }

    pickerKb = {
      target, anchorR, anchorC, headR, headC,
      insertStart, insertEnd, savedValue, savedCaret,
    }
    _pickerKbRender()
  }

  // Move/extend the picker head. shift=true keeps anchor, false collapses.
  // mod=true → jump to data-region edge using existing _jumpEdge.
  function _pickerKbMove(dr, dc, shift, mod) {
    if (!pickerKb) return
    let nr = pickerKb.headR + dr, nc = pickerKb.headC + dc
    if (mod) {
      const t = _jumpEdge(pickerKb.headR, pickerKb.headC, dr, dc)
      nr = t.r; nc = t.c
    } else {
      // Skip hidden rows/cols
      if (dr !== 0) nr = _skipHiddenR(nr, dr)
      if (dc !== 0) nc = _skipHiddenC(nc, dc)
      nr = Math.max(0, Math.min(TOTAL_ROWS - 1, nr))
      nc = Math.max(0, Math.min(TOTAL_COLS - 1, nc))
    }
    const master = _resolveMaster(nr, nc)
    nr = master.r; nc = master.c
    if (!shift) { pickerKb.anchorR = nr; pickerKb.anchorC = nc }
    pickerKb.headR = nr; pickerKb.headC = nc
    _pickerKbRender()
  }

  // Cancel PICKING (Esc): restore the input to its pre-picker state.
  function _pickerKbCancel() {
    if (!pickerKb) return
    const { target, savedValue, savedCaret } = pickerKb
    target.value = savedValue
    target.setSelectionRange(savedCaret, savedCaret)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    pickerKb = null
    pickerRect = null
    render()
  }

  // Exit PICKING but keep the inserted ref (user typed an operator / digit).
  function _pickerKbCommit() {
    pickerKb = null
    // Leave pickerRect visible — picker.kind = 'cell' so anchor data is the
    // last picked rect. It'll clear on next selection move / commit / cancel.
  }

  function showEditor(initialValue, mode = 'enter') {
    editMode = mode
    selEnd = { r: sel.r, c: sel.c }
    const fmt = getFormat ? getFormat(cellId(sel.r, sel.c)) : {}
    overlay.position(geo.colX(sel.c) * _zoom, geo.rowY(sel.r) * _zoom, geo.cw(sel.c) * _zoom, geo.rh(sel.r) * _zoom, fmt, _zoom)
    overlay.show(initialValue)
    editing = true
    onInput?.(cellId(sel.r, sel.c), initialValue)
    render()
  }

  function _commitAndHide() {
    if (!editing) return
    _acHide()
    editing = false
    const id  = cellId(sel.r, sel.c)
    const val = overlay.getValue()
    overlay.hide()
    _clearPickerHighlight()
    onCommit?.(id, val)
  }

  overlay.el.addEventListener('input', () => {
    const val = overlay.getValue()
    onInput?.(cellId(sel.r, sel.c), val)
    _acUpdate(val, overlay.el.selectionStart)
  })

  overlay.el.addEventListener('keydown', e => {
    if (_acItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); _acIdx = Math.min(_acIdx + 1, _acItems.length - 1); _acHighlight(); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); _acIdx = Math.max(_acIdx - 1, 0); _acHighlight(); return }
      if ((e.key === 'Tab' || e.key === 'Enter') && _acItems[_acIdx]) { e.preventDefault(); _acCommit(_acItems[_acIdx]); return }
      if (e.key === 'Escape')    { _acHide(); return }
    }
    // Commit any active cell-ref pick when the user types a printable char
    // (e.g. '+' after picking C1) so the next arrow key starts a fresh ref
    // instead of replacing the one already inserted.
    if (pickerKb && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      _pickerKbCommit()
    }
    // In 'enter' mode, arrow keys commit the current value and move the
    // selection one cell in that direction — matching Excel / Google Sheets.
    // In 'edit' mode (F2 / dblclick), arrows stay as cursor-movement.
    if (editMode === 'enter' && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      const [dr, dc] = dirs[e.key]
      const mod = e.ctrlKey || e.metaKey
      // If picker is already active, move it.
      if (pickerKb) {
        e.preventDefault()
        _pickerKbMove(dr, dc, e.shiftKey, mod)
        return
      }
      // Inside a formula (value starts with `=`) arrows always drive the
      // picker — even between args, after a comma, etc. _isRefPosition's
      // finer "REPLACE vs INSERT" check happens inside _pickerKbStart via
      // _refReplaceStart; gating the picker on it here was eating the
      // second-range pick in =VLOOKUP(..., …) and dumping the user to the
      // adjacent cell instead.
      if (overlay.getValue().startsWith('=')) {
        e.preventDefault()
        _pickerKbStart(overlay.el, dr, dc, e.shiftKey)
        return
      }
      // Not a formula — arrow commits and moves like Excel / Google Sheets.
      e.preventDefault()
      _commitAndHide()
      moveSel(sel.r + dr, sel.c + dc)
      canvas.focus()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (pickerKb) _pickerKbCommit()
      _commitAndHide()
      const anchorC = _tabAnchorCol ?? sel.c
      _tabAnchorCol = null
      moveSel(sel.r + 1, anchorC)
      canvas.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (pickerKb) _pickerKbCommit()
      if (_tabAnchorCol === null) _tabAnchorCol = sel.c
      _commitAndHide()
      moveSel(sel.r, e.shiftKey ? sel.c - 1 : sel.c + 1)
      canvas.focus()
    } else if (e.key === 'Escape') {
      _acHide()
      if (pickerKb) { _pickerKbCancel(); return }  // Esc while picking: cancel pick, stay editing
      editing = false
      overlay.hide()
      _clearPickerHighlight()
      render()
      canvas.focus()
      onCancel?.(cellId(sel.r, sel.c))
    }
  })

  overlay.el.addEventListener('blur', () => {
    if (!editing) return
    _acHide()
    editing = false
    const id  = cellId(sel.r, sel.c)
    const val = overlay.getValue()
    overlay.hide()
    render()
    onCommit?.(id, val)
  })

  // ── Fill handle ──────────────────────────────────────────────────────────────

  function _fillHandlePos() {
    let { r1, c1 } = getSelRange()
    // Extend to the merge's far corner so a single-merged-cell selection
    // hit-tests at the same bottom-right point the painter draws the dot at.
    // Without this, the dot rendered correctly but mousedowns landed on the
    // master cell's bottom-right (mid-block) and the drag never engaged.
    const m = getMergeInfo?.(cellId(r1, c1))
    if (m) { r1 += m.rowSpan - 1; c1 += m.colSpan - 1 }
    return {
      fx: geo.colX(c1) + geo.cw(c1),
      fy: geo.rowY(r1) + geo.rh(r1),
    }
  }

  function hitTestFillHandle(ex, ey, rect) {
    if (editing) return false
    // Mouse coords are physical CSS px; fillHandlePos is logical. Undo zoom.
    const x = (ex - rect.left) / _zoom
    const y = (ey - rect.top)  / _zoom
    const { fx, fy } = _fillHandlePos()
    return Math.hypot(x - fx, y - fy) <= 6
  }

  // Double-click-fill extent: pick a non-empty neighbour column (left, then
  // right) and walk its contiguous run starting at r1+1 — Google Sheets rule.
  function _autoFillDownExtent(src) {
    const filled = (r, c) => {
      if (r < 0 || r >= TOTAL_ROWS || c < 0 || c >= TOTAL_COLS) return false
      return hasVal(cellId(r, c))
    }
    let anchor = null
    if (filled(src.r1 + 1, src.c0 - 1))      anchor = src.c0 - 1
    else if (filled(src.r1 + 1, src.c1 + 1)) anchor = src.c1 + 1
    if (anchor === null) return src.r1
    let r = src.r1 + 1
    while (r < TOTAL_ROWS && filled(r, anchor)) r++
    return r - 1
  }

  // ── Auto-fit (double-click resize edge or header) ────────────────────────────

  // Measure with the same font the renderer uses, scoped to a fmt's bold/italic.
  function _measureWidth(text, fmt) {
    const weight = fmt?.bold   ? 'bold'   : 'normal'
    const style  = fmt?.italic ? 'italic' : 'normal'
    ctx.save()
    ctx.font = `${style} ${weight} 13px InterVar, Inter, ui-sans-serif, system-ui, sans-serif`
    const w = ctx.measureText(String(text)).width
    ctx.restore()
    return w
  }

  function autoFitCol(c) {
    const CELL_PAD   = 12   // matches renderer's left/right padding (≈6px each side)
    const HEADER_PAD = 16
    const MIN_W      = 40
    const MAX_W      = 600
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
    const MIN_H   = DEFAULT_ROW_H
    const MAX_H   = 400
    let tallest = MIN_H
    for (const id of cellIds()) {
      const p = parseCellId(id)
      if (!p || p.row !== r) continue
      const val = getValue(id)
      if (val == null || val === '') continue
      const fmt = getFormat ? getFormat(id) : {}
      let h = 18 // single line height at 13px
      if (isWrapText(fmt)) {
        // Estimate wrapped line count from measured width vs. column width.
        const w   = _measureWidth(val, fmt)
        const cw  = Math.max(1, geo.cw(p.col) - 8)
        const ln  = Math.max(1, Math.ceil(w / cw))
        h = ln * 18
      }
      if (h + ROW_PAD > tallest) tallest = h + ROW_PAD
    }
    rowH[r] = Math.max(MIN_H, Math.min(MAX_H, Math.ceil(tallest)))
    _applyCanvasSize()
    render()
  }

  // ── Canvas events ────────────────────────────────────────────────────────────

  canvas.addEventListener('mousedown', e => {
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
    const pickInput = _pickTarget()
    if (pickInput) {
      e.preventDefault()
      // Resize edges / fill handle / corner are no-ops during pick.
      if (geo.hitTestColResize(e.clientX, e.clientY, rect) !== null) return
      if (geo.hitTestRowResize(e.clientX, e.clientY, rect) !== null) return
      if (geo.hitTestCorner(e.clientX, e.clientY, rect))              return
      if (hitTestFillHandle(e.clientX, e.clientY, rect))              return

      const colHit = geo.hitTestColHeader(e.clientX, e.clientY, rect)
      if (colHit !== null) {
        // Full-column reference (`A:A`, with optional `Sheet1!` prefix when foreign).
        const ref = `${_sheetPrefixIfForeign()}${colLabel(colHit)}:${colLabel(colHit)}`
        _writeRef(pickInput, ref, _refReplaceStart(pickInput))
        picker     = { anchorR: 0, anchorC: colHit, target: pickInput, kind: 'col' }
        pickerRect = { r0: 0, c0: colHit, r1: TOTAL_ROWS - 1, c1: colHit }
        render()
        return
      }
      const rowHit = geo.hitTestRowHeader(e.clientX, e.clientY, rect)
      if (rowHit !== null) {
        // Full-row reference (`1:1`).
        const ref = `${_sheetPrefixIfForeign()}${rowHit + 1}:${rowHit + 1}`
        _writeRef(pickInput, ref, _refReplaceStart(pickInput))
        picker     = { anchorR: rowHit, anchorC: 0, target: pickInput, kind: 'row' }
        pickerRect = { r0: rowHit, c0: 0, r1: rowHit, c1: TOTAL_COLS - 1 }
        render()
        return
      }
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (!h) return
      // No self-reference — clicking the cell being edited is a no-op, but
      // only when we're on the editing-home sheet (clicking the same screen
      // cell on a *different* sheet is a legitimate cross-sheet reference).
      if (editing && h.r === sel.r && h.c === sel.c && !_crossSheetName()) return
      // Slave cells redirect to their merge master.
      let tr = h.r, tc = h.c
      if (getMasterId) {
        const mid = getMasterId(cellId(h.r, h.c))
        if (mid) { const p = parseCellId(mid); if (p) { tr = p.row; tc = p.col } }
      }
      _writeRef(pickInput, _refForRange(tr, tc, tr, tc, _crossSheetName()), _refReplaceStart(pickInput))
      picker     = { anchorR: tr, anchorC: tc, target: pickInput, kind: 'cell' }
      pickerRect = { r0: tr, c0: tc, r1: tr, c1: tc }
      pickerKb   = null   // mouse-pick supersedes any keyboard pick state
      render()
      return
    }

    const resizeCol = geo.hitTestColResize(e.clientX, e.clientY, rect)
    if (resizeCol !== null) {
      e.preventDefault()
      // Broadcast resize: when the dragged column is part of a multi-column
      // selection (whole-grid via corner-click, or a header-drag column
      // range), apply the new width to every column in that selection.
      // Otherwise fall back to single-column resize.
      const range = getSelRange()
      const cols = (selMode === 'all')
        ? Array.from({ length: TOTAL_COLS }, (_, c) => c)
        : (selMode === 'col' && resizeCol >= range.c0 && resizeCol <= range.c1)
          ? Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => range.c0 + i)
          : [resizeCol]
      resizing = { cols, startX: e.clientX, startW: colW[resizeCol] ?? 100 }
      return
    }

    const resizeRowHit = geo.hitTestRowResize(e.clientX, e.clientY, rect)
    if (resizeRowHit !== null) {
      e.preventDefault()
      const range = getSelRange()
      const rows = (selMode === 'all')
        ? Array.from({ length: TOTAL_ROWS }, (_, r) => r)
        : (selMode === 'row' && resizeRowHit >= range.r0 && resizeRowHit <= range.r1)
          ? Array.from({ length: range.r1 - range.r0 + 1 }, (_, i) => range.r0 + i)
          : [resizeRowHit]
      resizingRow = { rows, startY: e.clientY, startH: rowH[resizeRowHit] ?? DEFAULT_ROW_H }
      return
    }

    if (hitTestFillHandle(e.clientX, e.clientY, rect)) {
      const { r0, c0, r1, c1 } = getSelRange()
      // Track the mousedown screen position so mousemove can ignore sub-pixel
      // jitter — otherwise a 1px wobble during the click extends the selection
      // and turns a click (or the first half of a dblclick) into a stray fill.
      filling = { r0, c0, r1, c1, startX: e.clientX, startY: e.clientY, moved: false }
      return
    }

    // Top-left corner cell → select the entire grid (Google Sheets behavior).
    if (geo.hitTestCorner(e.clientX, e.clientY, rect)) {
      if (editing) _commitAndHide()
      selMode = 'all'
      sel    = { r: 0, c: 0 }
      selEnd = { r: TOTAL_ROWS - 1, c: TOTAL_COLS - 1 }
      canvas.focus()
      render()
      onSelect?.('A1')
      return
    }

    const colHit = geo.hitTestColHeader(e.clientX, e.clientY, rect)
    if (colHit !== null) {
      if (editing) _commitAndHide()
      selMode = 'col'
      sel    = { r: 0, c: colHit }
      selEnd = { r: TOTAL_ROWS - 1, c: colHit }
      canvas.focus()
      render()
      onSelect?.(colLabel(colHit) + ':' + colLabel(colHit))
      return
    }

    const rowHit = geo.hitTestRowHeader(e.clientX, e.clientY, rect)
    if (rowHit !== null) {
      if (editing) _commitAndHide()
      selMode = 'row'
      sel    = { r: rowHit, c: 0 }
      selEnd = { r: rowHit, c: TOTAL_COLS - 1 }
      canvas.focus()
      render()
      onSelect?.(String(rowHit + 1) + ':' + String(rowHit + 1))
      return
    }

    // Picker check moved to top of mousedown (PRIORITY 0) — by here we know
    // no =-formula input is focused, so a click is a real selection.
    if (editing) _commitAndHide()
    const h = geo.hitTest(e.clientX, e.clientY, rect)
    if (!h) return
    canvas.focus()

    const hId = cellId(h.r, h.c)

    // Ctrl/Cmd+click on a hyperlink → open URL without starting a selection drag
    if ((e.ctrlKey || e.metaKey) && getFormat?.(hId)?.hyperlink) {
      onHyperlinkClick?.(getFormat(hId).hyperlink)
      return
    }

    // Click on the dropdown caret of a list-validated cell → open dropdown.
    // The caret zone tracks the chip when one is drawn (list rule + value),
    // else it's the plain arrow box at the cell's right edge. Only list rules
    // get a dropdown — number/length rules fall through to normal selection.
    const vrule = getValidation?.(hId)
    if (vrule?.type === 'list') {
      const x = geo.colX(h.c), y = geo.rowY(h.r)
      const w = geo.cw(h.c), cellRight = x + w
      const lx = (e.clientX - rect.left) / _zoom
      const val = getValue(hId)
      let caretL = cellRight - 14
      if (val != null && String(val) !== '') {
        const { offsetX, chipW } = chipMetrics(ctx, String(val), getFormat?.(hId) || {}, w)
        caretL = x + offsetX + chipW - CHIP.caretW
      }
      if (lx >= caretL && lx <= cellRight) {
        e.stopPropagation()   // prevent _onDocMouseDown from closing the just-opened panel
        moveSel(h.r, h.c)
        const pos = {
          x: rect.left + x * _zoom,
          y: rect.top  + (y + geo.rh(h.r)) * _zoom,
          w: w * _zoom,
        }
        onDropdownClick?.(hId, vrule, pos)
        return
      }
    }

    dragging = true
    // Redirect clicks on slave cells to their master cell
    let tr = h.r, tc = h.c
    if (getMasterId) {
      const mid = getMasterId(hId)
      if (mid) { const p = parseCellId(mid); if (p) { tr = p.row; tc = p.col } }
    }
    if (e.shiftKey) extendSel(tr, tc)
    else            { _tabAnchorCol = null; moveSel(tr, tc) }
  })

  canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect()

    // Double-click on the fill handle → fill down to the bottom of the
    // adjacent column's contiguous data run (Google Sheets behaviour).
    if (hitTestFillHandle(e.clientX, e.clientY, rect)) {
      const src = getSelRange()
      const end = _autoFillDownExtent(src)
      if (end > src.r1) {
        const total = { r0: src.r0, c0: src.c0, r1: end, c1: src.c1 }
        onFill?.(src, total, { withModifier: e.metaKey || e.ctrlKey })
      }
      return
    }

    // Double-click on the column resize edge or column header → auto-fit column width.
    const resizeCol = geo.hitTestColResize(e.clientX, e.clientY, rect)
    if (resizeCol !== null)        { autoFitCol(resizeCol); return }
    const headerCol = geo.hitTestColHeader(e.clientX, e.clientY, rect)
    if (headerCol !== null)        { autoFitCol(headerCol); return }

    // Double-click on the row resize edge or row header → auto-fit row height.
    const resizeRowHit = geo.hitTestRowResize(e.clientX, e.clientY, rect)
    if (resizeRowHit !== null)     { autoFitRow(resizeRowHit); return }
    const headerRow = geo.hitTestRowHeader(e.clientX, e.clientY, rect)
    if (headerRow !== null)        { autoFitRow(headerRow); return }

    const h = geo.hitTest(e.clientX, e.clientY, rect)
    if (!h) return
    // On a pivot output sheet, a double-click drills into the source rows
    // instead of editing the (regenerated) cell. The handler returns true
    // when it took over.
    if (onPivotDrill?.(h.r, h.c)) return
    showEditor(getValue(cellId(h.r, h.c)) ?? '', 'edit')
  })

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect()
    const resizeCol = geo.hitTestColResize(e.clientX, e.clientY, rect)
    const resizeRowHit = !resizing && geo.hitTestRowResize(e.clientX, e.clientY, rect)
    const overFill  = !resizing && !resizingRow && !dragging && hitTestFillHandle(e.clientX, e.clientY, rect)
    const hoverCell = !resizing && !resizingRow && !dragging && !overFill
      ? geo.hitTest(e.clientX, e.clientY, rect) : null
    const overLink = hoverCell && getFormat?.(cellId(hoverCell.r, hoverCell.c))?.hyperlink
    if (resizeCol !== null || resizing)            canvas.style.cursor = 'col-resize'
    else if (resizeRowHit !== null || resizingRow) canvas.style.cursor = 'row-resize'
    else if (overFill)                             canvas.style.cursor = 'crosshair'
    else if (overLink)                             canvas.style.cursor = 'pointer'
    else                                           canvas.style.cursor = 'default'

    if (filling) {
      if (!filling.moved) {
        const dx = e.clientX - filling.startX, dy = e.clientY - filling.startY
        if (Math.hypot(dx, dy) < 4) return
        filling.moved = true
      }
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) extendSel(h.r, h.c)
      return
    }
    if (picker) {
      const h = geo.hitTest(e.clientX, e.clientY, rect)
      if (h) {
        const r0 = Math.min(picker.anchorR, h.r), r1 = Math.max(picker.anchorR, h.r)
        const c0 = Math.min(picker.anchorC, h.c), c1 = Math.max(picker.anchorC, h.c)
        _writeRef(picker.target, _refForRange(r0, c0, r1, c1, _crossSheetName()), _refReplaceStart(picker.target))
        pickerRect = { r0, c0, r1, c1 }
        render()
      }
      return
    }
    if (!dragging) return
    const h = geo.hitTest(e.clientX, e.clientY, rect)
    if (h) extendSel(h.r, h.c)
  })

  canvas.addEventListener('mouseup', (e) => {
    if (filling) {
      const src   = filling
      const total = getSelRange()
      const hasTarget = total.r0 !== src.r0 || total.c0 !== src.c0 ||
                        total.r1 !== src.r1 || total.c1 !== src.c1
      // Modifier flag lets onFill toggle copy ↔ series — Cmd/Ctrl held = invert
      // the auto-detected mode (matches Google Sheets behaviour).
      if (hasTarget) onFill?.(src, total, { withModifier: e.metaKey || e.ctrlKey })
      filling = null
    }
    if (picker) {
      // Return focus to whichever input fed the picker so the user keeps typing.
      const t = picker.target
      picker = null
      t?.focus?.()
    }
    dragging = false
  })

  function _onDocMouseMove(e) {
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
    const didResize = resizing || resizingRow
    if (resizing)    resizing    = null
    if (resizingRow) resizingRow = null
    if (didResize) onResizeEnd?.()
  }

  document.addEventListener('mousemove', _onDocMouseMove)
  document.addEventListener('mouseup',   _onDocMouseUp)

  // Document-level keydown delegator — picks up arrow keys for the top
  // formula bar input without touching Vue.  The in-cell overlay handles
  // its own arrow keys directly in its keydown listener below, so we skip
  // overlay events here to avoid double-handling.
  function _onDocPickerKey(e) {
    if (e.target === overlay.el) return          // overlay is self-contained
    const target = _pickTarget()
    if (!target) return
    // Home/End/Shift+Home/Shift+End always move text caret. Never picker.
    if (e.key === 'Home' || e.key === 'End') return

    const dirs = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    const dir = dirs[e.key]
    const mod = e.ctrlKey || e.metaKey

    // PICKING mode — every keydown is meaningful.
    if (pickerKb && pickerKb.target === target) {
      if (dir) {
        e.preventDefault()
        e.stopPropagation()
        _pickerKbMove(dir[0], dir[1], e.shiftKey, mod)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        _pickerKbCancel()
        return                                       // EDITING continues
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        _pickerKbCommit()
        return                                       // fall through to commit
      }
      // Any other key (digit, letter, operator, comma, close-paren, etc.):
      // exit PICKING and let the keystroke reach the input naturally.
      _pickerKbCommit()
      return
    }

    // EDITING mode — any arrow in a `=…` input drives the picker. The tighter
    // _isRefPosition check is delegated to _pickerKbStart (it picks REPLACE
    // vs INSERT via _refReplaceStart); gating it here was breaking second-
    // range picks in =VLOOKUP(..., …).
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      _pickerKbStart(target, dir[0], dir[1], e.shiftKey)
      return
    }
    // Otherwise let the native input handle the key (caret moves in text).
  }
  // capture=true so we beat the overlay's own keydown listener that would
  // commit-and-move on plain arrows.
  document.addEventListener('keydown', _onDocPickerKey, true)

  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    // Wheel deltas are physical pixels; scroll is logical. Divide so a single
    // notch advances the same logical distance regardless of zoom.
    scroll.x += e.deltaX / _zoom
    scroll.y += e.deltaY / _zoom
    _clampScroll()
    if (editing) {
      const fmt = getFormat ? getFormat(cellId(sel.r, sel.c)) : {}
      overlay.position(geo.colX(sel.c) * _zoom, geo.rowY(sel.r) * _zoom, geo.cw(sel.c) * _zoom, geo.rh(sel.r) * _zoom, fmt, _zoom)
    }
    render()
  }, { passive: false })

  canvas.setAttribute('tabindex', '0')
  canvas.addEventListener('keydown', e => {
    const { r, c }         = sel
    const { r: er, c: ec } = selEnd
    const mod    = e.ctrlKey || e.metaKey
    const isArrow = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)
    const dirs   = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] }

    // Cmd/Ctrl+A — Excel/Sheets pattern: first press selects the data region
    // (A1 → last used cell), second press expands to the entire grid. Empty
    // sheets jump straight to the whole-grid selection.
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      const last = _lastUsedCell()
      const hasData = last.r > 0 || last.c > 0 || hasVal(cellId(0, 0))
      const cur = getSelRange()
      const onDataRegion = hasData
        && cur.r0 === 0 && cur.c0 === 0
        && cur.r1 === last.r && cur.c1 === last.c
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
      if (e.shiftKey) { const t = _jumpEdge(er, ec, dr, dc); extendSel(t.r, t.c) }
      else            { const t = _jumpEdge(r,  c,  dr, dc); moveSel(t.r,  t.c)  }
      return
    }

    // Cmd+Home / Cmd+End
    if (mod && e.key === 'Home') {
      e.preventDefault()
      if (e.shiftKey) extendSel(0, 0); else moveSel(0, 0)
      return
    }
    if (mod && e.key === 'End') {
      e.preventDefault()
      const last = _lastUsedCell()
      if (e.shiftKey) extendSel(last.r, last.c); else moveSel(last.r, last.c)
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

    if (e.key === 'F2') { e.preventDefault(); showEditor(getValue(cellId(r, c)) ?? '', 'edit'); return }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault()
      const { r0, c0, r1, c1 } = getSelRange()
      if (r0 === r1 && c0 === c1) {
        onCommit?.(cellId(r, c), '')
      } else {
        const cells = []
        for (let dr = r0; dr <= r1; dr++)
          for (let dc = c0; dc <= c1; dc++)
            cells.push({ id: cellId(dr, dc), value: '' })
        onBatchCommit?.(cells)
        for (const { id } of cells) delete data[id]
        render()
      }
      return
    }

    if (e.key.length === 1 && !mod) { e.preventDefault(); showEditor(e.key); return }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (_tabAnchorCol === null) _tabAnchorCol = c
      const dc = e.shiftKey ? -1 : 1
      moveSel(r, _skipHiddenC(c + dc, dc))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const anchorC = _tabAnchorCol ?? c
      _tabAnchorCol = null
      const dr = e.shiftKey ? -1 : 1
      moveSel(_skipHiddenR(r + dr, dr), anchorC)
      return
    }
    const moves = { ArrowUp:[r-1,c,-1,0], ArrowDown:[r+1,c,1,0], ArrowLeft:[r,c-1,0,-1], ArrowRight:[r,c+1,0,1] }
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

  // Last viewport dimensions reported by the parent (gridWrap). Stored so we
  // can re-apply the sheet-extent cap whenever column/row sizes change.
  let _viewportW = 0, _viewportH = 0

  function _applyCanvasSize() {
    // Logical viewport (cssW/cssH) shrinks with zoom so the geometry sees a
    // smaller area while the on-screen pixels stay constant. The canvas's
    // *physical* size is tied to the viewport (×dpr ×zoom), so high-DPI plus
    // zoom both contribute to backing-store resolution.
    const sheetW = _sheetTotalW() + ROW_HEADER_W
    const sheetH = _sheetTotalH() + COL_HEADER_H
    const viewLogicalW = _viewportW / _zoom
    const viewLogicalH = _viewportH / _zoom
    cssW = Math.min(viewLogicalW, sheetW)
    cssH = Math.min(viewLogicalH, sheetH)
    // Physical CSS size is logical × zoom; backing store is that × dpr.
    const physW = cssW * _zoom
    const physH = cssH * _zoom
    canvas.width  = Math.round(physW * dpr)
    canvas.height = Math.round(physH * dpr)
    canvas.style.width  = physW + 'px'
    canvas.style.height = physH + 'px'
    _clampScroll()
  }

  function resize(w, h) {
    // Cap the canvas to the actual sheet extent. If the viewport is wider than
    // the sheet, the canvas is shrunk so nothing renders past column Z / row N,
    // and the surrounding wrap shows its own background. Matches the no-blank
    // behavior of Google Sheets.
    _viewportW = w; _viewportH = h
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
    _acEl?.remove()
    if (_raf)       { cancelAnimationFrame(_raf);       _raf = null }
    if (_marchRAF)  { cancelAnimationFrame(_marchRAF);  _marchRAF = null }
    document.removeEventListener('mousemove', _onDocMouseMove)
    document.removeEventListener('mouseup',   _onDocMouseUp)
    document.removeEventListener('keydown',   _onDocPickerKey, true)
  }

  function getColWidth(c)    { return colW[c] ?? 100 }
  function setColWidth(c, w) { geo.setColWidth(c, w); _applyCanvasSize(); scheduleRender() }
  function getRowHeight(r)   { return rowH[r] ?? DEFAULT_ROW_H }
  function setRowHeight(r, h){ geo.setRowHeight(r, h); _applyCanvasSize(); scheduleRender() }

  function shiftRowHeights(atRow, delta) {
    const pairs = Object.entries(rowH).map(([k, v]) => [+k, v]).filter(([r]) => r >= atRow)
    delta > 0 ? pairs.sort((a, b) => b[0] - a[0]) : pairs.sort((a, b) => a[0] - b[0])
    for (const [r, h] of pairs) { delete rowH[r]; const nr = r + delta; if (nr >= 0) rowH[nr] = h }
    _applyCanvasSize()
  }

  function shiftColWidths(atCol, delta) {
    const pairs = Object.entries(colW).map(([k, v]) => [+k, v]).filter(([c]) => c >= atCol)
    delta > 0 ? pairs.sort((a, b) => b[0] - a[0]) : pairs.sort((a, b) => a[0] - b[0])
    for (const [c, w] of pairs) { delete colW[c]; const nc = c + delta; if (nc >= 0) colW[nc] = w }
    _applyCanvasSize()
  }

  function getHitRegion(ex, ey) {
    const rect = canvas.getBoundingClientRect()
    return {
      headerCol: geo.hitTestColHeader(ex, ey, rect),
      headerRow: geo.hitTestRowHeader(ex, ey, rect),
      cell:      geo.hitTest(ex, ey, rect),
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

  function getHiddenRows() { return new Set(hiddenRows) }
  function getHiddenCols() { return new Set(hiddenCols) }

  function expandRows(by = 1000) {
    setTotalRows(TOTAL_ROWS + by)
    _applyCanvasSize()
    render()
  }

  function getTotalRows() { return TOTAL_ROWS }

  function expandCols(by = 1) {
    setTotalCols(TOTAL_COLS + by)
    _applyCanvasSize()
    render()
  }

  function getTotalCols() { return TOTAL_COLS }

  function setZoom(z) {
    _zoom = Math.max(0.5, Math.min(2.5, z))
    _applyCanvasSize()
    render()
  }
  function getZoom() { return _zoom }

  // True when the user has scrolled close enough to the bottom of the sheet
  // that an "add more rows" affordance is worth showing. Threshold is in rows.
  function isNearBottom(threshold = 10) {
    const r0   = geo.firstVisRow()
    const last = geo.lastVisRow(r0, cssH)
    return last >= TOTAL_ROWS - 1 - threshold
  }

  // ── View-state snapshot/restore (for persistence) ────────────────────────────
  // Captures everything the user can change visually but isn't part of the
  // cell/format/merge engines: column widths, row heights, freeze, hidden,
  // total-rows expansion, zoom. Without this the doc would reload with default
  // 100px widths, no freeze, no expanded rows, etc.
  function viewSnapshot() {
    return {
      colW:       { ...colW },
      rowH:       { ...rowH },
      freezeRows: freeze.rows || 0,
      freezeCols: freeze.cols || 0,
      // Only MANUAL hides belong in the per-sheet view. Filter hides are
      // transient and derived per-sheet from the sortFilter engine; baking
      // them in here leaked one sheet's filter onto others (they were read
      // back as manual hides and re-applied everywhere).
      hiddenRows: Array.from(hiddenRows).filter(r => !filterHiddenRows.has(r)),
      hiddenCols: Array.from(hiddenCols),
      totalRows:  TOTAL_ROWS,
      totalCols:  TOTAL_COLS,
      zoom:       _zoom,
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
    for (const r of (snap.hiddenRows || [])) hiddenRows.add(r)
    // Filter hides are transient and re-applied per-sheet by _applyHiddenRows;
    // drop any stale tag from the previous sheet so it can't bleed through.
    filterHiddenRows.clear()
    hiddenCols.clear()
    for (const c of (snap.hiddenCols || [])) hiddenCols.add(c)
    // Reset to the default size when the view doesn't carry an explicit count
    // (new / pivot / drill-down sheets) — otherwise the count stays at whatever
    // a large source sheet grew the global binding to. _repopulateGrid expands
    // again to fit any real data right after this, so nothing gets hidden.
    setTotalRows(typeof snap.totalRows === 'number' ? snap.totalRows : DEFAULT_TOTAL_ROWS)
    setTotalCols(typeof snap.totalCols === 'number' ? snap.totalCols : DEFAULT_TOTAL_COLS)
    if (typeof snap.zoom === 'number')      _zoom = Math.max(0.5, Math.min(2.5, snap.zoom))
    _applyCanvasSize()
    render()
  }

  return {
    resize, render, setCell, batchSetCells, clearAll,
    getCell: id => getValue(id) ?? '',
    getActiveCell: () => cellId(sel.r, sel.c),
    // Whether the in-cell overlay is currently editing a `=…` formula —
    // SheetEditor uses this to keep the editor alive across sheet-tab clicks
    // for cross-sheet range picking.
    isEditingFormula: () => editing && overlay.getValue().startsWith('='),
    getSelection: getSelRange,
    setSelection: setSelRange,
    getPreMousedownSel,
    moveTo: (r, c) => moveSel(r, c),
    getColWidth, setColWidth, getRowHeight, setRowHeight,
    shiftRowHeights, shiftColWidths, getHitRegion,
    setFreeze, setHiddenRows, setHiddenCols, setFilterHiddenRows, getHiddenRows, getHiddenCols,
    getColumnHeaderRects, getRow0Rect, getRowRect, onRender,
    setMarchingAnts,
    // Pixel rect (canvas-local CSS coords, zoom-applied) for one cell —
    // drives popovers anchored to a cell (auto-fill menu, pivot FAB, remote
    // cursor overlay, etc.). DO NOT multiply by zoom in callers — already
    // included here.
    getCellRect: (r, c) => ({ x: geo.colX(c) * _zoom, y: geo.rowY(r) * _zoom,
                              width: geo.cw(c) * _zoom, height: geo.rh(r) * _zoom }),
    setDiffOverlay, setActiveDiffSheet,
    autoFitCol, autoFitRow,
    expandRows, getTotalRows, isNearBottom,
    expandCols, getTotalCols,
    setZoom, getZoom,
    viewSnapshot, viewRestore,
    setLazyValues, isLazyValues,
    destroy,
  }
}
