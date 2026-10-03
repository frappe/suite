// Cell comments engine — threaded, resolvable discussions per cell.
//
// Value shape: { resolved: bool, thread: [{ author, name, text, ts, mentions? }] }
//   author   user id (email) who wrote the reply     name  their display name
//   ts       epoch ms                                 mentions  @-ed user ids (optional)
// Legacy flat-string notes (the old single-note model) are migrated to a
// one-entry thread on read/restore so existing docs keep their notes.
//
// The row/col shift + sheet-lifecycle logic is value-type-agnostic (it moves
// whole values by cell id), so it's unchanged from the flat-note version.

import { colLabel, parseCellId } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'
import { remapCellKeys } from './ref-remap.js'

// Upgrade a legacy string note to a thread; pass a thread object through.
// Returns null for an empty/blank note (nothing to keep).
function _migrate(v) {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t ? { resolved: false, thread: [{ author: '', name: '', text: t, ts: null }] } : null
  }
  // Only a well-formed thread object survives; a number / array / corrupt value
  // is dropped rather than crashing hasOpenComment's `.thread.length` later.
  return v && Array.isArray(v.thread) ? v : null
}

export function createCommentsEngine() {
  // { sheetName: { cellId: { resolved, thread:[...] } } }
  const store = {}

  function ensure(sheet) {
    if (!store[sheet]) store[sheet] = {}
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  // The thread at a cell, migrating a legacy string in place on first touch.
  function getThread(id, sheet = 'Sheet1') {
    const v = store[sheet]?.[id]
    if (v == null) return null
    if (typeof v === 'string') {
      const m = _migrate(v)
      if (m) store[sheet][id] = m
      return m
    }
    return v
  }

  // Drives the grid marker — only unresolved threads mark the cell so resolved
  // discussions don't clutter the sheet (they stay in the all-comments list).
  function hasOpenComment(id, sheet = 'Sheet1') {
    const t = getThread(id, sheet)
    return !!(t && !t.resolved && t.thread.length)
  }

  function getAll(sheet = 'Sheet1') {
    return store[sheet] || {}
  }

  // First reply's text — a one-line preview for the all-comments list.
  function preview(id, sheet = 'Sheet1') {
    return getThread(id, sheet)?.thread?.[0]?.text || ''
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  // Every mutation REPLACES the thread object rather than editing it in place,
  // so a reference captured earlier (an undo payload, an open panel) stays
  // frozen at its old state and can never be corrupted by a later edit. This is
  // the root-cause guard against aliasing; the deep-clones in restore/setThread
  // are defence-in-depth on top of it.

  // Append a reply, creating the thread if new. A new reply reopens a resolved
  // thread (someone had more to say). `ts` is injectable for deterministic tests.
  function addReply(
    id,
    { author = '', name = '', text, ts = Date.now(), mentions = [] } = {},
    sheet = 'Sheet1',
  ) {
    const clean = (text || '').trim()
    if (!clean) return
    ensure(sheet)
    const entry = { author, name, text: clean, ts }
    if (mentions.length) entry.mentions = mentions
    const t = getThread(id, sheet)
    store[sheet][id] = t
      ? { resolved: false, thread: [...t.thread, entry] }
      : { resolved: false, thread: [entry] }
  }

  // Drop one reply; if it was the last, the whole thread goes.
  function removeReply(id, index, sheet = 'Sheet1') {
    const t = getThread(id, sheet)
    if (!t || !t.thread[index]) return
    const thread = t.thread.filter((_, i) => i !== index)
    if (thread.length) store[sheet][id] = { ...t, thread }
    else delete store[sheet][id]
  }

  function resolve(id, resolved, sheet = 'Sheet1') {
    const t = getThread(id, sheet)
    if (t) store[sheet][id] = { ...t, resolved: !!resolved }
  }

  function clear(id, sheet = 'Sheet1') {
    if (store[sheet]) delete store[sheet][id]
  }

  // Replace a cell's whole thread (or clear it). Used by op-replay / undo, which
  // captures the entire before/after thread rather than a single reply. Deep-
  // clones so the stored thread is isolated from the caller's object — later
  // in-place mutations (addReply/resolve) can never leak into a restored state.
  function setThread(id, value, sheet = 'Sheet1') {
    ensure(sheet)
    if (value) store[sheet][id] = deepClone(value)
    else delete store[sheet][id]
  }

  // ── Row/col shifts (value-agnostic — move whole threads by cell id) ───────────

  function _shift(sheet, pred, newIdFn, descending) {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, val]) => ({ id, p: parseCellId(id), val }))
      .filter(({ p }) => p && pred(p))
    entries.sort((a, b) => (descending ? b.p.row - a.p.row : a.p.row - b.p.row))
    for (const { id, p, val } of entries) {
      delete st[id]
      const nid = newIdFn(p)
      if (nid) st[nid] = val
    }
  }

  function insertRow(atRow, sheet = 'Sheet1') {
    _shift(
      sheet,
      (p) => p.row >= atRow,
      (p) => colLabel(p.col) + (p.row + 2),
      true,
    )
  }

  function deleteRow(atRow, sheet = 'Sheet1') {
    ensure(sheet)
    for (const id of Object.keys(store[sheet] || {})) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete store[sheet][id]
    }
    _shift(
      sheet,
      (p) => p.row > atRow,
      (p) => colLabel(p.col) + p.row,
      false,
    )
  }

  function insertCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, val]) => ({ id, p: parseCellId(id), val }))
      .filter(({ p }) => p && p.col >= atCol)
      .sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, val } of entries) {
      delete st[id]
      st[colLabel(p.col + 1) + (p.row + 1)] = val
    }
  }

  function deleteCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete st[id]
    }
    const entries = Object.entries(st)
      .map(([id, val]) => ({ id, p: parseCellId(id), val }))
      .filter(({ p }) => p && p.col > atCol)
      .sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, val } of entries) {
      delete st[id]
      st[colLabel(p.col - 1) + (p.row + 1)] = val
    }
  }

  function remapCols(mapCol, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], mapCol, null)
  }

  function remapRows(mapRow, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], null, mapRow)
  }

  // ── Sheet lifecycle ──────────────────────────────────────────────────────────

  function renameSheet(oldName, newName) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName, newName) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || {})
  }

  function deleteSheet(name) {
    delete store[name]
  }

  function snapshot() {
    return deepClone(store)
  }

  // Migrate legacy string notes on load so old saved docs upgrade transparently.
  // Deep-clone the incoming snapshot first: threads are mutated in place
  // (addReply/resolve), so aliasing a history entry here would let a later edit
  // corrupt the stored snapshot and break a subsequent undo/redo.
  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    const clone = deepClone(snap || {})
    for (const [sheet, cells] of Object.entries(clone)) {
      store[sheet] = {}
      for (const [id, v] of Object.entries(cells)) {
        const m = _migrate(v)
        if (m) store[sheet][id] = m
      }
    }
  }

  return {
    getThread,
    hasOpenComment,
    getAll,
    preview,
    addReply,
    removeReply,
    resolve,
    clear,
    setThread,
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
