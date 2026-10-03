import { cellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { remapRect } from './ref-remap.js'

// Per-sheet merge state.
//
// History: this engine used to be sheet-blind — a single global pair
// of masterMap / slaveMap keyed by raw cellId. Merging A1:B2 in Sheet1
// therefore appeared in Sheet2 too, because Sheet2's renderer asked
// `getMasterInfo("A1")` and got Sheet1's data back. Switching sheets
// did nothing for the merge engine.
//
// The store is now shaped exactly like the formats engine —
// `{ sheetName: { masterMap, slaveMap } }` — so each tab carries its
// own merge map and sheet-level operations (rename / duplicate /
// delete) plumb through useSheetTabs the same way formats does.
//
// All public methods accept an optional `sheet` parameter; it defaults
// to `'Sheet1'` to match formats.js so call sites that never carried a
// sheet name behave the same way they used to in a single-sheet doc.

export function createMergeEngine() {
  const store = {} // { sheetName: { masterMap, slaveMap } }

  function _slice(sheet) {
    if (!store[sheet]) store[sheet] = { masterMap: {}, slaveMap: {} }
    return store[sheet]
  }

  function merge(r0, c0, r1, c1, sheet = 'Sheet1') {
    _unmergeRect(r0, c0, r1, c1, sheet)
    if (r0 === r1 && c0 === c1) return
    const s = _slice(sheet)
    const mid = cellId(r0, c0)
    s.masterMap[mid] = { rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1, r: r0, c: c0 }
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (!(r === r0 && c === c0)) s.slaveMap[cellId(r, c)] = mid
  }

  function unmerge(r0, c0, r1, c1, sheet = 'Sheet1') {
    _unmergeRect(r0, c0, r1, c1, sheet)
  }

  function _unmergeRect(r0, c0, r1, c1, sheet) {
    const s = store[sheet]
    if (!s) return
    for (const mid of Object.keys(s.masterMap)) {
      const { r: mr, c: mc, rowSpan, colSpan } = s.masterMap[mid]
      const mr1 = mr + rowSpan - 1,
        mc1 = mc + colSpan - 1
      if (mr1 < r0 || mr > r1 || mc1 < c0 || mc > c1) continue
      for (let r = mr; r <= mr1; r++)
        for (let c = mc; c <= mc1; c++) if (!(r === mr && c === mc)) delete s.slaveMap[cellId(r, c)]
      delete s.masterMap[mid]
    }
  }

  // Structural permutation — rebuild every merge from its remapped bounding box.
  // A move that would split a merge grows it to the box (Sheets blocks such a
  // move; here it degrades to the covering rectangle rather than corrupting).
  function _remap(sheet, mapCol, mapRow) {
    const s = store[sheet]
    if (!s) return
    const masters = Object.values(s.masterMap)
    s.masterMap = {}
    s.slaveMap = {}
    for (const m of masters) {
      const box = remapRect(
        { r0: m.r, c0: m.c, r1: m.r + m.rowSpan - 1, c1: m.c + m.colSpan - 1 },
        mapCol,
        mapRow,
      )
      if (!box) continue
      const rowSpan = box.r1 - box.r0 + 1,
        colSpan = box.c1 - box.c0 + 1
      if (rowSpan === 1 && colSpan === 1) continue // collapsed → no longer a merge
      const mid = cellId(box.r0, box.c0)
      s.masterMap[mid] = { r: box.r0, c: box.c0, rowSpan, colSpan }
      for (let r = box.r0; r <= box.r1; r++)
        for (let c = box.c0; c <= box.c1; c++)
          if (!(r === box.r0 && c === box.c0)) s.slaveMap[cellId(r, c)] = mid
    }
  }
  function remapCols(mapCol, sheet = 'Sheet1') {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow, sheet = 'Sheet1') {
    _remap(sheet, null, mapRow)
  }

  function isMaster(id, sheet = 'Sheet1') {
    return !!store[sheet]?.masterMap[id]
  }
  function isSlave(id, sheet = 'Sheet1') {
    return !!store[sheet]?.slaveMap[id]
  }
  function getMasterInfo(id, sheet = 'Sheet1') {
    return store[sheet]?.masterMap[id] || null
  }
  function getMasterId(id, sheet = 'Sheet1') {
    return store[sheet]?.slaveMap[id] || null
  }
  function resolveId(id, sheet = 'Sheet1') {
    return store[sheet]?.slaveMap[id] || id
  }

  function snapshot() {
    return deepClone(store)
  }

  // Accept both shapes:
  //   * legacy flat snapshot { masterMap, slaveMap } from before the
  //     per-sheet rewrite — migrate it under the default sheet name
  //     so old saved docs keep their merges
  //   * new per-sheet snapshot { sheetName: { masterMap, slaveMap } }
  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    if (!snap) return
    if (snap.masterMap && snap.slaveMap) {
      // legacy
      store['Sheet1'] = {
        masterMap: deepClone(snap.masterMap),
        slaveMap: deepClone(snap.slaveMap),
      }
      return
    }
    for (const [name, slice] of Object.entries(snap)) {
      store[name] = {
        masterMap: deepClone(slice.masterMap || {}),
        slaveMap: deepClone(slice.slaveMap || {}),
      }
    }
  }

  // ── Sheet-level operations (rename / duplicate / delete / reorder) ─────────
  // Mirror formats.js so useSheetTabs can plumb this engine through its
  // `extras` array and merges follow tab renames / duplications.

  function renameSheet(oldName, newName) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName, newName) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || { masterMap: {}, slaveMap: {} })
  }

  function deleteSheet(name) {
    delete store[name]
  }

  function reorderSheets(orderedNames) {
    const next = {}
    for (const name of orderedNames) if (store[name]) next[name] = store[name]
    for (const name of Object.keys(store)) if (!next[name]) next[name] = store[name]
    for (const k of Object.keys(store)) delete store[k]
    Object.assign(store, next)
  }

  return {
    merge,
    unmerge,
    remapCols,
    remapRows,
    isMaster,
    isSlave,
    getMasterInfo,
    getMasterId,
    resolveId,
    snapshot,
    restore,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    reorderSheets,
  }
}
