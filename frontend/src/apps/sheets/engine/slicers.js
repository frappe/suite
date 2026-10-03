// Slicer registry — a slicer is a floating value-filter control bound to a
// column of the sheet's filter range. The filtering itself lives in the
// sortFilter engine (a slicer just drives that column's `inSet` spec); this
// engine only tracks WHICH columns have a slicer and WHERE each one floats.
// Per sheet. Columns are 0-indexed.

import { deepClone } from '../utils/deep-clone.js'

let _nextId = 1

export function createSlicerEngine() {
  // store[sheet] = [ { id, col, x, y } ]
  const store = {}
  function _ensure(s) {
    return store[s] || (store[s] = [])
  }

  function list(sheet = 'Sheet1') {
    return store[sheet] || []
  }
  function get(id, sheet = 'Sheet1') {
    return store[sheet]?.find((s) => s.id === id) || null
  }

  // Add a slicer for a column. One slicer per column — an existing one for the
  // same column is returned instead of duplicated.
  function add(col, x = 0, y = 0, sheet = 'Sheet1') {
    const s = _ensure(sheet)
    const existing = s.find((sl) => sl.col === col)
    if (existing) return existing.id
    const id = _nextId++
    s.push({ id, col, x, y })
    return id
  }

  function remove(id, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = store[sheet].filter((sl) => sl.id !== id)
  }

  function move(id, x, y, sheet = 'Sheet1') {
    const sl = store[sheet]?.find((s) => s.id === id)
    if (sl) {
      sl.x = x
      sl.y = y
    }
  }

  // Re-point a slicer at a different column (unless one already targets it).
  function setCol(id, col, sheet = 'Sheet1') {
    const s = store[sheet]
    if (!s || s.some((sl) => sl.col === col && sl.id !== id)) return
    const sl = s.find((x) => x.id === id)
    if (sl) sl.col = col
  }

  // ── Structural column shifts (a slicer follows its column) ────────────────────
  function insertCol(atCol, sheet = 'Sheet1') {
    for (const sl of store[sheet] || []) if (sl.col >= atCol) sl.col += 1
  }
  function deleteCol(atCol, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter((sl) => sl.col !== atCol) // its column is gone
    for (const sl of store[sheet]) if (sl.col > atCol) sl.col -= 1
  }

  function remapCols(mapCol, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet]
      .map((sl) => ({ ...sl, col: mapCol(sl.col) }))
      .filter((sl) => sl.col != null && sl.col >= 0) // bound column deleted
  }

  // ── Sheet lifecycle ──────────────────────────────────────────────────────────
  function renameSheet(oldName, newName) {
    if (store[oldName] && !store[newName]) {
      store[newName] = store[oldName]
      delete store[oldName]
    }
  }
  function duplicateSheet(src, dst) {
    if (store[src] && !store[dst]) store[dst] = deepClone(store[src])
  }
  function deleteSheet(name) {
    delete store[name]
  }

  function snapshot() {
    return deepClone(store)
  }
  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    // Advance the id counter past every restored slicer — a reload resets the
    // module counter, so a new add() would otherwise reuse an id and remove()
    // would drop the wrong slicer.
    let maxId = 0
    for (const [k, v] of Object.entries(snap || {})) {
      store[k] = deepClone(v)
      for (const sl of v) if (sl.id > maxId) maxId = sl.id
    }
    if (maxId >= _nextId) _nextId = maxId + 1
  }

  return {
    list,
    get,
    add,
    remove,
    move,
    setCol,
    insertCol,
    deleteCol,
    remapCols,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    snapshot,
    restore,
  }
}
