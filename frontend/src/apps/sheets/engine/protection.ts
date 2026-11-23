// Protection engine — per-sheet protected ranges plus a whole-sheet lock.
//
// A protected cell rejects value edits, clears, pastes and fills (enforcement
// lives in the SheetEditor; this engine is the pure source of truth for "is
// this cell/rect protected?"). Ranges are { id, r0, c0, r1, c1, description }
// with 0-indexed, inclusive bounds. A whole-sheet lock protects every cell.
//
// Structural ops shift ranges with full interval semantics: inserting a line
// inside a range grows it, deleting a line inside a range shrinks it, and a
// range that collapses to nothing is dropped. This matches Google Sheets and,
// unlike the cond-format engine, handles ranges that *span* the pivot line.

import { deepClone } from '../utils/deep-clone.js'
import { remapRect } from './ref-remap.js'
import type { IndexMap, Rect } from './types.js'

export interface ProtectedRange extends Rect {
  id: number
  description: string
}

export interface ProtectionSheet {
  locked: boolean
  ranges: ProtectedRange[]
}

export type ProtectionSnapshot = Record<string, ProtectionSheet>

export type ProtectionEngine = ReturnType<typeof createProtectionEngine>

let _nextId = 1

export function createProtectionEngine() {
  // { sheetName: { locked: bool, ranges: [{ id, r0, c0, r1, c1, description }] } }
  const store: ProtectionSnapshot = {}

  function ensure(sheet: string): ProtectionSheet {
    if (!store[sheet]) store[sheet] = { locked: false, ranges: [] }
    return store[sheet]
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  function getRanges(sheet = 'Sheet1') {
    return store[sheet]?.ranges || []
  }

  function isSheetLocked(sheet = 'Sheet1') {
    return !!store[sheet]?.locked
  }

  // Is a single cell protected? Sheet lock short-circuits every range check.
  function isProtected(row: number, col: number, sheet = 'Sheet1') {
    const s = store[sheet]
    if (!s) return false
    if (s.locked) return true
    return s.ranges.some((r) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1)
  }

  // Does `rect` overlap any protected cell? Used to block a whole block-write
  // (paste / fill / delete-block) when any target cell is protected.
  function isAnyProtected(rect: Rect, sheet = 'Sheet1') {
    const s = store[sheet]
    if (!s) return false
    if (s.locked) return true
    const { r0, c0, r1, c1 } = _norm(rect)
    return s.ranges.some((r) => r0 <= r.r1 && r1 >= r.r0 && c0 <= r.c1 && c1 >= r.c0)
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  function setSheetLocked(locked: boolean, sheet = 'Sheet1') {
    ensure(sheet).locked = !!locked
  }

  function addRange(rect: Rect, description = '', sheet = 'Sheet1') {
    const s = ensure(sheet)
    const id = _nextId++
    s.ranges.push({ id, ..._norm(rect), description })
    return id
  }

  function removeRange(id: number, sheet = 'Sheet1') {
    const s = store[sheet]
    if (s) s.ranges = s.ranges.filter((r) => r.id !== id)
  }

  // ── Structural shifts ────────────────────────────────────────────────────────
  //
  // Shift both endpoints of every range on the given axis. Insert (delta +1)
  // pushes any endpoint at/after `at` down, so a range straddling `at` grows.
  // Delete (delta -1) pulls the start down only past `at` and the end down at
  // or past `at`, so a straddling range shrinks and a range that was only the
  // deleted line collapses (start > end) and is removed.

  function _shift(sheet: string, axis: 'row' | 'col', at: number, delta: number) {
    const s = store[sheet]
    if (!s) return
    const lo = axis === 'row' ? 'r0' : 'c0'
    const hi = axis === 'row' ? 'r1' : 'c1'
    const kept: ProtectedRange[] = []
    for (const r of s.ranges) {
      let a = r[lo],
        b = r[hi]
      if (delta > 0) {
        if (a >= at) a += 1
        if (b >= at) b += 1
      } else {
        if (a > at) a -= 1
        if (b >= at) b -= 1
        if (a > b) continue
      }
      kept.push({ ...r, [lo]: a, [hi]: b })
    }
    s.ranges = kept
  }

  function insertRow(at: number, sheet = 'Sheet1') {
    _shift(sheet, 'row', at, +1)
  }
  function deleteRow(at: number, sheet = 'Sheet1') {
    _shift(sheet, 'row', at, -1)
  }
  function insertCol(at: number, sheet = 'Sheet1') {
    _shift(sheet, 'col', at, +1)
  }
  function deleteCol(at: number, sheet = 'Sheet1') {
    _shift(sheet, 'col', at, -1)
  }

  function _remap(sheet: string, mapCol: IndexMap | null, mapRow: IndexMap | null) {
    const s = store[sheet]
    if (!s?.ranges) return
    s.ranges = s.ranges
      .map((r) => {
        const box = remapRect(r, mapCol, mapRow)
        return box ? { ...r, ...box } : null
      })
      .filter((r): r is ProtectedRange => Boolean(r))
  }
  function remapCols(mapCol: IndexMap, sheet = 'Sheet1') {
    _remap(sheet, mapCol, null)
  }
  function remapRows(mapRow: IndexMap, sheet = 'Sheet1') {
    _remap(sheet, null, mapRow)
  }

  // ── Sheet lifecycle ──────────────────────────────────────────────────────────

  function renameSheet(oldName: string, newName: string) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName: string, newName: string) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || { locked: false, ranges: [] })
  }

  function deleteSheet(name: string) {
    delete store[name]
  }

  function snapshot() {
    return deepClone(store)
  }

  function restore(snap: ProtectionSnapshot) {
    for (const k of Object.keys(store)) delete store[k]
    // Advance the id counter past every restored range. Without this a reload
    // (module re-init → _nextId=1) followed by a new addRange would mint an id
    // that collides with a restored one, so removeRange would drop both.
    let maxId = 0
    for (const [k, v] of Object.entries(snap)) {
      store[k] = v
      for (const r of v?.ranges || []) if (r.id > maxId) maxId = r.id
    }
    if (maxId >= _nextId) _nextId = maxId + 1
  }

  return {
    getRanges,
    isSheetLocked,
    isProtected,
    isAnyProtected,
    setSheetLocked,
    addRange,
    removeRange,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    remapCols,
    remapRows,
    renameSheet,
    duplicateSheet,
    deleteSheet,
    snapshot,
    restore,
  }
}

// Normalise a rect so r0<=r1 and c0<=c1 regardless of selection direction.
function _norm({ r0, c0, r1, c1 }: Rect): Rect {
  return {
    r0: Math.min(r0, r1),
    r1: Math.max(r0, r1),
    c0: Math.min(c0, c1),
    c1: Math.max(c0, c1),
  }
}
