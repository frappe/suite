import { ref } from 'vue'

// Sheet tabs. IronCalc owns the sheets: every tab change is a command sent
// with run(type, payload), and names() is the sheet list as of the last apply.
// The tab list updates at once from what was asked for; syncNames() takes
// IronCalc's list when it reports one (load, undo, an apply that changed it).
//
// getGrid is a getter fn () => grid. onSwitch is called after every sheet switch
// so the caller can repopulate canvas data for the new sheet.
// extras: additional engines with renameSheet/duplicateSheet/deleteSheet/reorderSheets
// showInput(id): puts a cell's input in the formula bar.
export function useSheetTabs({
  names,
  run,
  currentSheet,
  formats,
  extras = [],
  getGrid,
  activeCell,
  showInput,
  refreshActiveFormat,
  onSwitch,
}) {
  const sheetNames = ref(names())

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
    // Skip if the cached "current" name no longer exists (e.g. deleteSheet
    // just removed it) — otherwise we'd resurrect dead entries with stale
    // grid state on every subsequent switch.
    if (!cs || !sheetNames.value.includes(cs)) return
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
    currentSheet.value = name
    _applyViewFor(name)
    if (!preserveEdit) {
      activeCell.value = 'A1'
      showInput('A1')
      getGrid()?.moveTo(0, 0)
    }
    refreshActiveFormat()
    onSwitch?.()
  }

  // name(n) for the first n from `from` that no tab uses.
  function _freeName(name, from) {
    const taken = new Set(sheetNames.value)
    let n = from
    while (taken.has(name(n))) n++
    return name(n)
  }

  // name is optional: callers normally let us auto-name the next sheet, but
  // undo/redo passes an explicit name to recreate the exact sheet it removed.
  function addSheet(name) {
    name = name || _freeName((n) => `Sheet${n}`, sheetNames.value.length + 1)
    run('addSheet', { name })
    sheetNames.value = [...sheetNames.value, name]
    switchSheet(name)
    return name
  }

  // Returns true on success, false on collision / invalid name.
  function renameSheet(oldName, newName) {
    newName = (newName || '').trim()
    if (!newName || !sheetNames.value.includes(oldName)) return false
    if (newName === oldName) return true
    if (sheetNames.value.includes(newName)) return false
    // IronCalc rewrites formulas that name the sheet.
    run('renameSheet', { sheet: oldName, name: newName })
    if (_viewBySheet[oldName] != null) {
      _viewBySheet[newName] = _viewBySheet[oldName]
      delete _viewBySheet[oldName]
    }
    formats?.renameSheet(oldName, newName)
    extras.forEach((e) => e?.renameSheet?.(oldName, newName))
    sheetNames.value = sheetNames.value.map((n) => (n === oldName ? newName : n))
    if (currentSheet.value === oldName) currentSheet.value = newName
    return true
  }

  function duplicateSheet(srcName) {
    const copy = _freeName((n) => (n === 1 ? `${srcName} copy` : `${srcName} copy ${n}`), 1)
    run('duplicateSheet', { sheet: srcName, name: copy })
    // Inherit the source's view (freeze, widths, hidden, ...) onto the copy.
    // When srcName is the currently-active sheet, the live grid state is the
    // freshest snapshot — capture it first so the cache is up to date before
    // we clone.
    if (srcName === currentSheet.value) _captureCurrentView()
    if (_viewBySheet[srcName]) {
      _viewBySheet[copy] = JSON.parse(JSON.stringify(_viewBySheet[srcName]))
    }
    formats?.duplicateSheet(srcName, copy)
    extras.forEach((e) => e?.duplicateSheet?.(srcName, copy))
    // Shown next to its source until IronCalc reports where it put it.
    const at = sheetNames.value.indexOf(srcName) + 1
    sheetNames.value = [...sheetNames.value.slice(0, at), copy, ...sheetNames.value.slice(at)]
    switchSheet(copy)
    return copy
  }

  function deleteSheet(name) {
    if (sheetNames.value.length <= 1 || !sheetNames.value.includes(name)) return false
    const wasCurrent = currentSheet.value === name
    run('deleteSheet', { sheet: name })
    delete _viewBySheet[name]
    formats?.deleteSheet(name)
    extras.forEach((e) => e?.deleteSheet?.(name))
    sheetNames.value = sheetNames.value.filter((n) => n !== name)
    // Deleting the open tab opens the first one.
    if (wasCurrent) switchSheet(sheetNames.value[0])
    return true
  }

  // One moveSheet per tab that is out of place, front to back.
  function reorderSheets(orderedNames) {
    const order = [...sheetNames.value]
    orderedNames.forEach((name, i) => {
      const from = order.indexOf(name)
      if (from < 0 || from === i) return
      run('moveSheet', { sheet: name, index: i })
      order.splice(from, 1)
      order.splice(i, 0, name)
    })
    formats?.reorderSheets(orderedNames)
    extras.forEach((e) => e?.reorderSheets?.(orderedNames))
    sheetNames.value = order
  }

  // Takes IronCalc's sheet list. If the open tab is gone, opens the first.
  function syncNames() {
    sheetNames.value = names()
    if (!sheetNames.value.includes(currentSheet.value)) switchSheet(sheetNames.value[0])
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
    const active = currentSheet.value
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
    sheetNames,
    currentSheet,
    switchSheet,
    addSheet,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    reorderSheets,
    syncNames,
    viewSnapshot,
    viewRestore,
  }
}
