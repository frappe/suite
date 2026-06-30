import { ref, computed, watch } from 'vue'
import { computePivotModel, computePivotModelAsync, pivotDrillDown, writePivotToSheet } from '../../engine/pivot.js'
import { colLabel, cellId, parseCellId } from '../../utils/cells.js'
import { COL_HEADER_H, ROW_HEADER_W } from '../../canvas/constants.js'

// Styling applied to the pivot's column header row (row 0) and Grand Total
// row (last row). Matches the Google Sheets look the user asked for.
const PIVOT_HEADER_FORMAT = { bold: true, backgroundColor: '#d9e0e8' }

// Does an output rectangle contain a cell?
function _rectContains(ext, row, col) {
  return !!ext && row >= ext.r0 && row <= ext.r1 && col >= ext.c0 && col <= ext.c1
}

// Do an output rectangle and a selection {r0,c0,r1,c1} overlap?
function _rectIntersects(ext, sel) {
  return !!ext && !!sel &&
    sel.r0 <= ext.r1 && sel.r1 >= ext.r0 &&
    sel.c0 <= ext.c1 && sel.c1 >= ext.c0
}

/**
 * @param {{
 *   pivot: object,
 *   sheet: object,
 *   currentSheet: import('vue').Ref<string>,
 *   renderVersion: import('vue').Ref<number>,
 *   getGrid: () => object,
 *   contextMenu: { open: boolean },
 *   switchSheet: (name: string) => void,
 *   syncNames: () => void,
 *   history: { push: () => void },
 *   isDirty: import('vue').Ref<boolean>,
 *   repopulateGrid: () => void,
 * }} opts
 */
export function usePivotIntegration({
  pivot, sheet, formats, currentSheet, activeCell, renderVersion, getGrid,
  contextMenu, switchSheet, syncNames,
  history, isDirty, repopulateGrid,
}) {
  const pivotDialogOpen   = ref(false)
  const pivotInitialRange = ref('')
  const pivotEditId       = ref('')
  const pivotEditConfig   = ref(null)
  const pivotVersion      = ref(0)
  // True while an async pivot build is aggregating the source rows — drives a
  // spinner so big sheets don't look frozen.
  const pivotBuilding     = ref(false)

  // Every engine mutation (including restore on page reload) bumps the version,
  // so reactive computeds like `activePivotConfig` re-evaluate. Without this,
  // the edit FAB stays hidden after a reload because `pivot.restore()` runs
  // silently and the cached computed never sees the new pivot list.
  pivot.setOnChange?.(() => { pivotVersion.value++ })

  // The pivot the edit FAB / drill-down / delete should target: among the
  // pivots on the current sheet, the one whose output rectangle contains the
  // active cell. Several pivots can now share an outputSheet, so this is
  // selection-aware. Reading pivotVersion + renderVersion + activeCell forces
  // Vue to re-evaluate on add/update/delete, after each render (which sets
  // pivot _extents), and whenever the selection moves.
  const activePivotConfig = computed(() => {
    void pivotVersion.value
    void renderVersion.value
    const candidates = pivot.list().filter(p => p.outputSheet === currentSheet.value)
    if (!candidates.length) return null
    const cell = parseCellId(activeCell?.value || '')
    if (cell) {
      const hit = candidates
        .filter(p => _rectContains(p._extent, cell.row, cell.col))
        .sort((a, b) => (a._extent.r0 - b._extent.r0) || (a._extent.c0 - b._extent.c0))[0]
      if (hit) return hit
    }
    // Fall back to the sole pivot on the sheet so single-pivot sheets always
    // show the edit affordance — and so a freshly-added pivot whose _extent
    // isn't computed yet is still active. With several pivots, require a hit.
    return candidates.length === 1 ? candidates[0] : null
  })

  // Set of sheet names that are pivot outputs — computed so templates reactively
  // update tab styles when pivots are added or deleted.
  const pivotSheetNames = computed(() => {
    void pivotVersion.value
    return new Set(pivot.list().map(p => p.outputSheet))
  })

  function isPivotSheet(name) { return pivotSheetNames.value.has(name) }

  // After a page reload, pivot.restore() puts the config back but the transient
  // _extent (not persisted) is gone, so both the edit FAB and the highlight
  // overlay (which gate on _extent) silently hide. Watch the active config:
  // when it lacks an _extent, derive one from the already-written cells without
  // touching the sheet, so we don't bump renderVersion or mark the sheet dirty
  // even though the cells already match the saved snapshot.
  //
  // Also (re-)apply the header/total banding so older pivots created before
  // this styling existed pick it up the first time they're opened. formats.set
  // is idempotent and doesn't mark isDirty by itself, so this is safe.
  watch(activePivotConfig, (cfg) => {
    // _extent is transient render state that isn't persisted, so after a reload
    // a pivot's rectangle is unknown until it's recomputed. Derive it from the
    // already-written cells (cheap contiguous scan from the anchor) rather than
    // re-running the aggregation, then cache it. Once cached we skip — extents
    // are otherwise refreshed at render time in _applyPivotOutput.
    if (!cfg || cfg._extent) return
    const ext = _outputExtentAt(cfg.outputSheet, cfg.anchorRow || 0, cfg.anchorCol || 0)
    if (!ext) return
    pivot.setExtent(cfg.id, ext)
    _restyleHeaderAndTotal(cfg.outputSheet, ext)
    // setExtent doesn't notify; nudge the overlays to pick up the new rect.
    pivotVersion.value++
  }, { immediate: true })

  // Positions the edit FAB below the active pivot's Grand Total row from its
  // cached _extent, without re-running computePivot() on every render frame.
  // getCellRect returns coordinates even when the cell has scrolled above the
  // visible cell area, so the FAB would otherwise overlap the column/row
  // headers when the user scrolls past the pivot. Gate on the headers.
  const pivotFabStyle = computed(() => {
    void pivotVersion.value
    renderVersion.value
    const cfg  = activePivotConfig.value
    const grid = getGrid()
    const ext  = cfg?._extent
    if (!grid || !ext) return null
    const rect = grid.getCellRect?.(ext.r1, ext.c0)
    if (!rect) return null
    const zoom = grid.getZoom?.() ?? 1
    const top  = rect.y + rect.height + 6
    if (top < COL_HEADER_H * zoom || rect.x + rect.width < ROW_HEADER_W * zoom) {
      return null
    }
    return { top: top + 'px', left: rect.x + 'px' }
  })

  // Highlight overlay — a thin coloured border drawn over the pivot output
  // range so users can see it's a generated table (Google Sheets does the
  // same). Anchored on getCellRect of the top-left and bottom-right output
  // cells; tracks scroll/zoom via the renderVersion read.
  //
  // Clip the overlay to the visible cell area so it never bleeds into the
  // column/row headers when scrolled. Hide entirely when the pivot has
  // scrolled completely above/left of the visible area.
  const pivotHighlightStyle = computed(() => {
    void pivotVersion.value
    renderVersion.value
    const cfg  = activePivotConfig.value
    const grid = getGrid()
    const ext  = cfg?._extent
    if (!grid || !ext) return null
    const tl = grid.getCellRect?.(ext.r0, ext.c0)
    const br = grid.getCellRect?.(ext.r1, ext.c1)
    if (!tl || !br) return null
    const zoom    = grid.getZoom?.() ?? 1
    const headerY = COL_HEADER_H * zoom
    const headerX = ROW_HEADER_W * zoom
    const right   = br.x + br.width
    const bottom  = br.y + br.height
    if (bottom <= headerY || right <= headerX) return null
    const top  = Math.max(tl.y, headerY)
    const left = Math.max(tl.x, headerX)
    return {
      top:    top  + 'px',
      left:   left + 'px',
      width:  (right  - left) + 'px',
      height: (bottom - top)  + 'px',
    }
  })

  const pivotBannerMenuOptions = [
    { label: 'Edit pivot',   icon: 'edit-2',                    onClick: onPivotEdit   },
    { label: 'Delete pivot', icon: 'trash-2', theme: 'red',     onClick: onPivotDelete },
  ]

  function openPivotDialog() {
    contextMenu.open = false
    const grid = getGrid()
    const sel  = grid?.getSelection()
    pivotInitialRange.value = sel
      ? `${colLabel(sel.c0)}${sel.r0 + 1}:${colLabel(sel.c1)}${sel.r1 + 1}`
      : ''
    pivotEditId.value     = ''
    pivotEditConfig.value = null
    pivotDialogOpen.value = true
  }

  function onPivotEdit() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    pivotEditId.value       = cfg.id
    pivotEditConfig.value   = { ...cfg }
    pivotInitialRange.value = cfg.sourceRange || ''
    pivotDialogOpen.value   = true
  }

  async function onPivotRefresh() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    await _applyPivotOutput(cfg)
    repopulateGrid()
  }

  function onPivotDelete() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    pivot.remove(cfg.id)
  }

  // Clear only the pivot's previous output rectangle — never the whole sheet,
  // which would wipe a neighbouring pivot or user data now that several pivots
  // can live on one sheet. `extent` is the previously-rendered rect (null on a
  // pivot's first render → nothing to clear).
  function _clearPivotRect(sheetName, extent) {
    if (!extent) return
    for (let r = extent.r0; r <= extent.r1; r++) {
      for (let c = extent.c0; c <= extent.c1; c++) {
        const id = cellId(r, c)
        sheet.setCell(id, '', sheetName)
        // Clear the format too — otherwise the previous header/total band
        // lingers on rows the new (shorter) pivot no longer occupies.
        formats?.clear?.(id, sheetName)
      }
    }
  }

  // Async, chunked build. Aggregates the source in row blocks, yielding between
  // them so a 100k-row pivot doesn't freeze the UI. A newer build supersedes an
  // in-flight one via the token (e.g. rapid edits / refresh).
  let _buildToken = 0
  async function _applyPivotOutput(config) {
    const token = ++_buildToken
    pivotBuilding.value = true
    try {
      const model = await computePivotModelAsync(
        config,
        (s, e, sh) => sheet.getRangeValues(s, e, sh),
        { onYield: () => _yieldUnlessSuperseded(token) },
      )
      if (token !== _buildToken) return
      const table = model?.table ?? []
      const ar = config.anchorRow || 0
      const ac = config.anchorCol || 0
      const prevExtent = pivot.get(config.id)?._extent ?? null
      writePivotToSheet(
        table, config.outputSheet,
        (id, val, sh) => sheet.setCell(id, val, sh),
        (sh, ext) => _clearPivotRect(sh, ext),
        { row: ar, col: ac },
        prevExtent,
      )
      const newExtent = table.length
        ? { r0: ar, c0: ac, r1: ar + table.length - 1, c1: ac + (table[0]?.length || 1) - 1 }
        : null
      pivot.setExtent(config.id, newExtent)
      _styleHeaderAndTotal(table, config.outputSheet, ar, ac)
    } finally {
      if (token === _buildToken) pivotBuilding.value = false
    }
  }

  // Yield a macrotask so the UI can paint/respond between blocks; resolves
  // false when a newer build has taken over so the engine bails early.
  function _yieldUnlessSuperseded(token) {
    return new Promise(res => setTimeout(() => res(token === _buildToken), 0))
  }

  // Output rectangle of an already-written pivot, derived without re-aggregating
  // the source: the output is a solid block anchored at (ar, ac), so walk the
  // header row right and the row-label column down to the first gap. Scoped to
  // the anchor so it never unions a neighbouring pivot's cells. Returns null
  // when nothing is written at the anchor.
  function _outputExtentAt(sheetName, ar, ac) {
    const data = sheet.getRawData(sheetName)
    const has = (r, c) => {
      const v = data[cellId(r, c)]
      return v !== undefined && v !== null && v !== ''
    }
    if (!has(ar, ac)) return null
    let lastCol = ac
    while (has(ar, lastCol + 1)) lastCol++
    let lastRow = ar
    while (has(lastRow + 1, ac)) lastRow++
    return { r0: ar, c0: ac, r1: lastRow, c1: lastCol }
  }

  // Re-apply header/total banding over an extent (used on load so pivots made
  // before this styling existed pick it up, without recomputing the table).
  function _restyleHeaderAndTotal(outputSheet, ext) {
    if (!formats?.set || !ext) return
    for (let c = ext.c0; c <= ext.c1; c++) {
      formats.set(cellId(ext.r0, c), PIVOT_HEADER_FORMAT, outputSheet)
      if (ext.r1 > ext.r0) formats.set(cellId(ext.r1, c), PIVOT_HEADER_FORMAT, outputSheet)
    }
  }

  // Apply the bold + #d9e0e8 banding to the header row (anchorRow) and the
  // Grand Total row (last). Walks every column in the pivot width so the band
  // is continuous even for cells the engine left empty (which writePivotToSheet
  // skipped). Re-applied on every recompute since _clearPivotRect wipes formats
  // first.
  function _styleHeaderAndTotal(table, outputSheet, anchorRow = 0, anchorCol = 0) {
    if (!formats?.set || !table.length) return
    const cols = table[0]?.length || 0
    const lastRow = anchorRow + table.length - 1
    for (let c = 0; c < cols; c++) {
      formats.set(cellId(anchorRow, anchorCol + c), PIVOT_HEADER_FORMAT, outputSheet)
      if (lastRow > anchorRow) {
        formats.set(cellId(lastRow, anchorCol + c), PIVOT_HEADER_FORMAT, outputSheet)
      }
    }
  }

  // Double-click drill-down: given a cell (r, c) on the current pivot output
  // sheet, open the underlying source rows in a fresh sheet (Google Sheets
  // behaviour). Returns true when it handled the cell so the grid skips the
  // cell editor; false for non-pivot sheets or non-drillable cells.
  function drillDownAt(r, c) {
    const cfg = activePivotConfig.value
    if (!cfg) return false
    // The grid passes absolute (r, c); pivotDrillDown works in pivot-local
    // coordinates, so translate by the pivot's anchor first.
    const lr = r - (cfg.anchorRow || 0)
    const lc = c - (cfg.anchorCol || 0)
    if (lr < 0 || lc < 0) return false
    const model = computePivotModel(cfg, (s, e, sh) => sheet.getRangeValues(s, e, sh))
    const res = pivotDrillDown(model, lr, lc)
    if (!res || !res.rows.length) return false

    const existing = sheet.getSheetNames()
    let name = 'Drill-down'; let n = 2
    while (existing.includes(name)) name = `Drill-down ${n++}`
    sheet.addSheet(name)
    syncNames()

    const table = [res.headers, ...res.rows]
    for (let rr = 0; rr < table.length; rr++) {
      const tr = table[rr]
      for (let cc = 0; cc < tr.length; cc++) {
        const v = tr[cc]
        if (v === null || v === undefined || v === '') continue
        sheet.setCell(cellId(rr, cc), typeof v === 'number' ? v : String(v), name)
      }
    }
    if (formats?.set) {
      for (let cc = 0; cc < res.headers.length; cc++) formats.set(cellId(0, cc), { bold: true }, name)
    }

    switchSheet(name)
    repopulateGrid()
    history.push(); isDirty.value = true
    return true
  }

  async function recomputePivotsForSheet(srcSheet) {
    if (!pivot.affectsPivot(srcSheet)) return
    for (const cfg of pivot.list()) {
      if (cfg.sourceSheet === srcSheet) await _applyPivotOutput(cfg)
    }
    repopulateGrid()
  }

  async function onPivotConfirm(config) {
    const existing = sheet.getSheetNames()
    let id, outputSheet
    if (config.id) {
      const old = pivot.get(config.id)
      outputSheet = old?.outputSheet || `Pivot – ${config.rows.join(', ')}`
      pivot.update(config.id, { ...config, outputSheet })
      id = config.id
    } else {
      const baseName = `Pivot – ${config.rows.join(', ')}`
      outputSheet = baseName; let n = 2
      while (existing.includes(outputSheet)) outputSheet = `${baseName} ${n++}`
      sheet.addSheet(outputSheet)
      syncNames()
      id = pivot.add({ ...config, outputSheet })
    }
    // Switch first so the user sees the output sheet (with a spinner) while it
    // builds, then fill it in. Render from the stored config so _applyPivotOutput
    // can read/write the pivot's _extent by id.
    switchSheet(outputSheet)
    await _applyPivotOutput(pivot.get(id))
    repopulateGrid()
    history.push(); isDirty.value = true
  }

  // ── Copy/paste a pivot as a new live pivot ──────────────────────────────────

  // If a selection overlaps a pivot's output on `sheetName`, return a portable
  // blob (config minus identity/placement) the clipboard can stash so a paste
  // can mint an independent copy. null when the selection touches no pivot.
  function getPivotAt(sel, sheetName) {
    const hit = pivot.list().find(p =>
      p.outputSheet === sheetName && _rectIntersects(p._extent, sel))
    if (!hit) return null
    return {
      sourceSheet: hit.sourceSheet,
      sourceRange: hit.sourceRange,
      rows:   [...(hit.rows   || [])],
      cols:   [...(hit.cols   || [])],
      values: (hit.values || []).map(v => ({ ...v })),
    }
  }

  // Create a new, independent pivot from a pasted blob, anchored at the paste
  // cell on `outputSheet` (the current sheet — the headline "multiple pivots on
  // one page" case). History/dirty are owned by the caller (onDocPaste).
  async function createPastedPivot(blob, anchorId, outputSheet) {
    const anch = parseCellId(anchorId)
    if (!anch) return
    const id = pivot.add({ ...blob, outputSheet, anchorRow: anch.row, anchorCol: anch.col })
    await _applyPivotOutput(pivot.get(id))
    repopulateGrid()
  }

  return {
    pivotDialogOpen, pivotInitialRange, pivotEditId, pivotEditConfig, pivotVersion, pivotBuilding,
    activePivotConfig, pivotFabStyle, pivotHighlightStyle, pivotBannerMenuOptions,
    isPivotSheet, openPivotDialog, onPivotEdit, onPivotRefresh, onPivotDelete, onPivotConfirm,
    recomputePivotsForSheet, drillDownAt, getPivotAt, createPastedPivot,
  }
}
