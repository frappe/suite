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
import type { CellPos, IndexMap } from './types.js'

export interface CommentReply {
  author: string
  name: string
  text: string
  /** Epoch ms; null for a note migrated from the legacy string form. */
  ts: number | null
  mentions?: string[]
}

export interface CommentThread {
  resolved: boolean
  thread: CommentReply[]
}

/** What a cell holds: a thread, or a legacy string note not migrated yet. */
export type StoredComment = CommentThread | string

/** { sheetName: { cellId: thread } } */
export type CommentsSnapshot = Record<string, Record<string, StoredComment>>

export interface ReplyInput {
  author?: string
  name?: string
  text?: string
  ts?: number | null
  mentions?: string[]
}

export type CommentsEngine = ReturnType<typeof createCommentsEngine>

// Upgrade a legacy string note to a thread; pass a thread object through.
// Returns null for an empty/blank note (nothing to keep).
function _migrate(v: unknown): CommentThread | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t ? { resolved: false, thread: [{ author: '', name: '', text: t, ts: null }] } : null
  }
  // Only a well-formed thread object survives; a number / array / corrupt value
  // is dropped rather than crashing hasOpenComment's `.thread.length` later.
  return v && Array.isArray((v as CommentThread).thread) ? (v as CommentThread) : null
}

interface CommentEntry {
  id: string
  p: CellPos
  val: StoredComment
}

// Each stored comment with its parsed position; ids that don't parse are skipped.
function _entries(
  st: Record<string, StoredComment>,
  pred: (p: CellPos) => boolean,
): CommentEntry[] {
  return Object.entries(st)
    .map(([id, val]) => ({ id, p: parseCellId(id), val }))
    .filter((e): e is CommentEntry => !!e.p && pred(e.p))
}

export function createCommentsEngine() {
  const store: CommentsSnapshot = {}

  function ensure(sheet: string): Record<string, StoredComment> {
    if (!store[sheet]) store[sheet] = {}
    return store[sheet]
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  // The thread at a cell, migrating a legacy string in place on first touch.
  function getThread(id: string, sheet = 'Sheet1'): CommentThread | null {
    const st = store[sheet]
    if (!st) return null
    const v = st[id]
    if (v == null) return null
    if (typeof v === 'string') {
      const m = _migrate(v)
      if (m) st[id] = m
      return m
    }
    return v
  }

  // Drives the grid marker — only unresolved threads mark the cell so resolved
  // discussions don't clutter the sheet (they stay in the all-comments list).
  function hasOpenComment(id: string, sheet = 'Sheet1') {
    const t = getThread(id, sheet)
    return !!(t && !t.resolved && t.thread.length)
  }

  function getAll(sheet = 'Sheet1') {
    return store[sheet] || {}
  }

  // First reply's text — a one-line preview for the all-comments list.
  function preview(id: string, sheet = 'Sheet1') {
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
    id: string,
    { author = '', name = '', text, ts = Date.now(), mentions = [] }: ReplyInput = {},
    sheet = 'Sheet1',
  ) {
    const clean = (text || '').trim()
    if (!clean) return
    const st = ensure(sheet)
    const entry: CommentReply = { author, name, text: clean, ts }
    if (mentions.length) entry.mentions = mentions
    const t = getThread(id, sheet)
    st[id] = t
      ? { resolved: false, thread: [...t.thread, entry] }
      : { resolved: false, thread: [entry] }
  }

  // Drop one reply; if it was the last, the whole thread goes.
  function removeReply(id: string, index: number, sheet = 'Sheet1') {
    const st = store[sheet]
    const t = getThread(id, sheet)
    // A thread was found, so its sheet exists; `st` is only checked for TS.
    if (!st || !t || !t.thread[index]) return
    const thread = t.thread.filter((_, i) => i !== index)
    if (thread.length) st[id] = { ...t, thread }
    else delete st[id]
  }

  function resolve(id: string, resolved: boolean, sheet = 'Sheet1') {
    const st = store[sheet]
    const t = getThread(id, sheet)
    if (st && t) st[id] = { ...t, resolved: !!resolved }
  }

  function clear(id: string, sheet = 'Sheet1') {
    if (store[sheet]) delete store[sheet][id]
  }

  // Replace a cell's whole thread (or clear it). Used by op-replay / undo, which
  // captures the entire before/after thread rather than a single reply. Deep-
  // clones so the stored thread is isolated from the caller's object — later
  // in-place mutations (addReply/resolve) can never leak into a restored state.
  function setThread(id: string, value: CommentThread | null | undefined, sheet = 'Sheet1') {
    const st = ensure(sheet)
    if (value) st[id] = deepClone(value)
    else delete st[id]
  }

  // ── Row/col shifts (value-agnostic — move whole threads by cell id) ───────────

  function _shift(
    sheet: string,
    pred: (p: CellPos) => boolean,
    newIdFn: (p: CellPos) => string,
    descending: boolean,
  ) {
    const st = ensure(sheet)
    const entries = _entries(st, pred)
    entries.sort((a, b) => (descending ? b.p.row - a.p.row : a.p.row - b.p.row))
    for (const { id, p, val } of entries) {
      delete st[id]
      const nid = newIdFn(p)
      if (nid) st[nid] = val
    }
  }

  function insertRow(atRow: number, sheet = 'Sheet1') {
    _shift(
      sheet,
      (p) => p.row >= atRow,
      (p) => colLabel(p.col) + (p.row + 2),
      true,
    )
  }

  function deleteRow(atRow: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete st[id]
    }
    _shift(
      sheet,
      (p) => p.row > atRow,
      (p) => colLabel(p.col) + p.row,
      false,
    )
  }

  function insertCol(atCol: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    const entries = _entries(st, (p) => p.col >= atCol).sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, val } of entries) {
      delete st[id]
      st[colLabel(p.col + 1) + (p.row + 1)] = val
    }
  }

  function deleteCol(atCol: number, sheet = 'Sheet1') {
    const st = ensure(sheet)
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete st[id]
    }
    const entries = _entries(st, (p) => p.col > atCol).sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, val } of entries) {
      delete st[id]
      st[colLabel(p.col - 1) + (p.row + 1)] = val
    }
  }

  function remapCols(mapCol: IndexMap, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], mapCol, null)
  }

  function remapRows(mapRow: IndexMap, sheet = 'Sheet1') {
    if (store[sheet]) store[sheet] = remapCellKeys(store[sheet], null, mapRow)
  }

  // ── Sheet lifecycle ──────────────────────────────────────────────────────────

  function renameSheet(oldName: string, newName: string) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName: string, newName: string) {
    if (store[newName]) return
    store[newName] = deepClone(store[srcName] || {})
  }

  function deleteSheet(name: string) {
    delete store[name]
  }

  function snapshot() {
    return deepClone(store)
  }

  // Migrate legacy string notes on load so old saved docs upgrade transparently.
  // Deep-clone the incoming snapshot first: threads are mutated in place
  // (addReply/resolve), so aliasing a history entry here would let a later edit
  // corrupt the stored snapshot and break a subsequent undo/redo.
  function restore(snap: Record<string, Record<string, unknown>> | null | undefined) {
    for (const k of Object.keys(store)) delete store[k]
    const clone = deepClone(snap || {})
    for (const [sheet, cells] of Object.entries(clone)) {
      const st: Record<string, StoredComment> = {}
      store[sheet] = st
      for (const [id, v] of Object.entries(cells)) {
        const m = _migrate(v)
        if (m) st[id] = m
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
