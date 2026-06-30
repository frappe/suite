import { ref } from 'vue'

// getGrid is a getter fn () => grid. onSwitch is called after every sheet switch
// so the caller can repopulate canvas data for the new sheet.
// extras: additional engines with renameSheet/duplicateSheet/deleteSheet/reorderSheets
export function useSheetTabs({ sheet, formats, extras = [], getGrid, activeCell, formulaValue, refreshActiveFormat, onSwitch }) {
  const sheetNames   = ref(sheet.getSheetNames())
  const currentSheet = ref(sheet.getCurrentSheet())

  // Per-sheet view-state cache. Freeze, hidden rows/cols, column widths, row
  // heights, total rows/cols and zoom are all sheet-local in Google Sheets —
  // before this cache existed, switching to Sheet2 inherited Sheet1's freeze,
  // hidden state, column widths, etc. because the canvas only holds one set.
  // Populated lazily as each sheet is visited (so an as-yet-unseen sheet
  // restores from defaults rather than the previous sheet's chrome) and
  // persisted whole via viewSnapshot / viewRestore.
  const _viewBySheet = {}

  function _captureCurrentView() {
    const cs = currentSheet.value
    // Skip if the cached "current" name no longer exists in the engine
    // (e.g. deleteSheet just removed it) — otherwise we'd resurrect dead
    // entries with stale grid state on every subsequent switch.
    if (!cs || !sheet.getSheetNames().includes(cs)) return
    const snap = getGrid()?.viewSnapshot?.()
    if (snap) _viewBySheet[cs] = snap
  }

  function _applyViewFor(name) {
    const grid = getGrid()
    if (!grid) return
    // Pass through either the cached snap or {} so the grid resets every
    // view-state field to its default — the grid's viewRestore is fully
    // overwrite-based (it clears colW/rowH/hiddenRows/etc. before applying).
    grid.viewRestore?.(_viewBySheet[name] || {})
  }

  // preserveEdit: keep activeCell + formulaValue + grid selection intact —
  // used by the cross-sheet picker so a tab click during an active formula
  // edit doesn't wipe the in-progress formula. Caller is responsible for
  // tracking the "home" sheet/cell and writing the formula back there on
  // commit.
  function switchSheet(name, { preserveEdit = false } = {}) {
    // Stamp the outgoing sheet's view into the cache BEFORE clearAll so
    // freeze / hidden / col widths / etc. come back the next time the user
    // returns to this tab.
    _captureCurrentView()
    getGrid()?.clearAll()
    sheet.switchSheet(name)
    currentSheet.value = sheet.getCurrentSheet()
    _applyViewFor(currentSheet.value)
    if (!preserveEdit) {
      activeCell.value   = 'A1'
      formulaValue.value = sheet.getCell('A1')
      getGrid()?.moveTo(0, 0)
    }
    refreshActiveFormat()
    onSwitch?.()
  }

  // name is optional: callers normally let us auto-name the next sheet, but
  // undo/redo passes an explicit name to recreate the exact sheet it removed.
  function addSheet(name) {
    name = name || ('Sheet' + (sheet.getSheetNames().length + 1))
    sheet.addSheet(name)
    sheetNames.value = sheet.getSheetNames()
    switchSheet(name)
    return name
  }

  // Returns true on success, false on collision / invalid name.
  function renameSheet(oldName, newName) {
    newName = (newName || '').trim()
    if (!newName) return false
    if (sheet.getSheetNames().includes(newName) && newName !== oldName) return false
    const ok = sheet.renameSheet(oldName, newName)
    if (!ok) return false
    if (_viewBySheet[oldName] != null) {
      _viewBySheet[newName] = _viewBySheet[oldName]
      delete _viewBySheet[oldName]
    }
    formats?.renameSheet(oldName, newName)
    extras.forEach(e => e?.renameSheet?.(oldName, newName))
    sheetNames.value   = sheet.getSheetNames()
    currentSheet.value = sheet.getCurrentSheet()
    return true
  }

  function duplicateSheet(srcName) {
    const existing = sheet.getSheetNames()
    let copy = `${srcName} copy`
    let n = 1
    while (existing.includes(copy)) { n++; copy = `${srcName} copy ${n}` }
    sheet.duplicateSheet(srcName, copy)
    // Inherit the source's view (freeze, widths, hidden, ...) onto the copy.
    // When srcName is the currently-active sheet, the live grid state is the
    // freshest snapshot — capture it first so the cache is up to date before
    // we clone.
    if (srcName === sheet.getCurrentSheet()) _captureCurrentView()
    if (_viewBySheet[srcName]) {
      _viewBySheet[copy] = JSON.parse(JSON.stringify(_viewBySheet[srcName]))
    }
    formats?.duplicateSheet(srcName, copy)
    extras.forEach(e => e?.duplicateSheet?.(srcName, copy))
    sheetNames.value = sheet.getSheetNames()
    switchSheet(copy)
    return copy
  }

  function deleteSheet(name) {
    if (sheet.getSheetNames().length <= 1) return false
    const wasCurrent = sheet.getCurrentSheet() === name
    const ok = sheet.deleteSheet(name)
    if (!ok) return false
    delete _viewBySheet[name]
    formats?.deleteSheet(name)
    extras.forEach(e => e?.deleteSheet?.(name))
    sheetNames.value = sheet.getSheetNames()
    if (wasCurrent) switchSheet(sheet.getCurrentSheet())
    else            currentSheet.value = sheet.getCurrentSheet()
    return true
  }

  function reorderSheets(orderedNames) {
    sheet.reorderSheets(orderedNames)
    formats?.reorderSheets(orderedNames)
    extras.forEach(e => e?.reorderSheets?.(orderedNames))
    sheetNames.value = sheet.getSheetNames()
  }

  function syncNames() {
    sheetNames.value   = sheet.getSheetNames()
    currentSheet.value = sheet.getCurrentSheet()
  }

  // Snapshot the whole per-sheet view map (stamping the active sheet first
  // so the live grid state lands in the cache before we clone). Used by the
  // persistence layer instead of grid.viewSnapshot() directly.
  function viewSnapshot() {
    _captureCurrentView()
    return JSON.parse(JSON.stringify(_viewBySheet))
  }

  // Restore the whole per-sheet view map AND apply the currently-active
  // sheet's view to the live grid.
  //
  // Back-compat: old docs persisted a single flat view object ({colW, rowH,
  // freezeRows, ...}) rather than a per-sheet map. Detect the legacy shape by
  // the presence of a known top-level field and apply it to the current sheet
  // only — historically the only sheet whose view was preserved anyway.
  function viewRestore(snap) {
    for (const k of Object.keys(_viewBySheet)) delete _viewBySheet[k]
    const active = sheet.getCurrentSheet()
    if (!snap) {
      _applyViewFor(active)
      return
    }
    const isLegacy = 'colW' in snap || 'rowH' in snap || 'freezeRows' in snap
    if (isLegacy) {
      _viewBySheet[active] = snap
    } else {
      Object.assign(_viewBySheet, JSON.parse(JSON.stringify(snap)))
    }
    _applyViewFor(active)
  }

  return {
    sheetNames, currentSheet,
    switchSheet, addSheet, renameSheet, duplicateSheet, deleteSheet, reorderSheets,
    syncNames,
    viewSnapshot, viewRestore,
  }
}
