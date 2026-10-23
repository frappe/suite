// The Y.Doc layout for one spreadsheet: root names, key spellings, and the
// row/col id lists. Everything that reads or writes the collab doc goes
// through here, so the spelling lives in one place (the server registration
// and the Python converter mirror it).
//
// Layout (one Y.Doc per spreadsheet):
//
//   meta         Y.Map    schemaVersion → 1
//   sheets       Y.Array  sheet ids, in tab order
//   sheetMeta    Y.Map    sheetId → { name, … }
//   rows, cols   Y.Map    sheetId → Y.Array of row (col) ids, top to bottom
//   inputs       Y.Map    sheetId:rowId:colId → typed string ("500", "=SUM(A2:A5)")
//   formats      Y.Map    sheetId:rowId:colId → format object
//   rowFormats   Y.Map    sheetId:rowId → format object
//   colFormats   Y.Map    sheetId:colId → format object
//   charts, pivots, condFormats, validations, comments, slicers, names
//                Y.Map    item id → JSON (one key per item)
//   sheetState   Y.Map    sheetId:store → JSON (merges, sizes, hidden, frozen, filters, …)
//   tails        Y.Map    sheetId:rows|cols:base → highest tail number used
//
// The doc stores what people typed, never results. Rows and columns are
// addressed by id, so a cell key survives inserts above it.
//
// Id lists hold ids only up to the last used row/col; positions past the end
// have no id yet. Growing into them appends predictable "tail" ids named from
// the last id in the list (e200 → e201, e202…; an inserted id x7p2 → x7p2.1…),
// so two tabs that see the same list and type into the same far row pick the
// same id. Concurrent growth can put an id in the list twice; the first copy
// counts. `tails` remembers the highest tail number per base, so a deleted
// tail id is never handed out again.
//
// Positions are 0-based (like the canvas and engine/ref-remap.ts).

import * as Y from 'yjs'

export const SCHEMA_VERSION = 1

export const ROOT = {
  meta: 'meta',
  sheets: 'sheets',
  sheetMeta: 'sheetMeta',
  rows: 'rows',
  cols: 'cols',
  inputs: 'inputs',
  formats: 'formats',
  rowFormats: 'rowFormats',
  colFormats: 'colFormats',
  charts: 'charts',
  pivots: 'pivots',
  condFormats: 'condFormats',
  validations: 'validations',
  comments: 'comments',
  slicers: 'slicers',
  names: 'names',
  sheetState: 'sheetState',
  tails: 'tails',
} as const

export type AxisName = 'rows' | 'cols'

/** A format object as the side store keeps it; its fields are the glue's business. */
type Format = Record<string, unknown>

interface SheetMeta {
  name: string
  [field: string]: unknown
}

export interface Roots {
  meta: Y.Map<unknown>
  sheets: Y.Array<string>
  sheetMeta: Y.Map<SheetMeta>
  rows: Y.Map<Y.Array<string>>
  cols: Y.Map<Y.Array<string>>
  inputs: Y.Map<string>
  formats: Y.Map<Format>
  rowFormats: Y.Map<Format>
  colFormats: Y.Map<Format>
  charts: Y.Map<unknown>
  pivots: Y.Map<unknown>
  condFormats: Y.Map<unknown>
  validations: Y.Map<unknown>
  comments: Y.Map<unknown>
  slicers: Y.Map<unknown>
  names: Y.Map<unknown>
  sheetState: Y.Map<unknown>
  tails: Y.Map<number>
}

/** Typed handles on every root. */
export function roots(doc: Y.Doc): Roots {
  return {
    meta: doc.getMap(ROOT.meta),
    sheets: doc.getArray(ROOT.sheets),
    sheetMeta: doc.getMap(ROOT.sheetMeta),
    rows: doc.getMap(ROOT.rows),
    cols: doc.getMap(ROOT.cols),
    inputs: doc.getMap(ROOT.inputs),
    formats: doc.getMap(ROOT.formats),
    rowFormats: doc.getMap(ROOT.rowFormats),
    colFormats: doc.getMap(ROOT.colFormats),
    charts: doc.getMap(ROOT.charts),
    pivots: doc.getMap(ROOT.pivots),
    condFormats: doc.getMap(ROOT.condFormats),
    validations: doc.getMap(ROOT.validations),
    comments: doc.getMap(ROOT.comments),
    slicers: doc.getMap(ROOT.slicers),
    names: doc.getMap(ROOT.names),
    sheetState: doc.getMap(ROOT.sheetState),
    tails: doc.getMap(ROOT.tails),
  }
}

/** Stamp the schema version on a new doc. Never touches a doc that already has one. */
export function initDoc(doc: Y.Doc): void {
  const { meta } = roots(doc)
  if (!meta.has('schemaVersion')) meta.set('schemaVersion', SCHEMA_VERSION)
}

// ---- keys ----

export function cellKey(sheetId: string, rowId: string, colId: string): string {
  return `${sheetId}:${rowId}:${colId}`
}

export function parseCellKey(
  key: string,
): { sheetId: string; rowId: string; colId: string } | null {
  const [sheetId, rowId, colId, extra] = key.split(':')
  if (!sheetId || !rowId || !colId || extra !== undefined) return null
  return { sheetId, rowId, colId }
}

/** Key for `rowFormats` (sheetId:rowId) and `colFormats` (sheetId:colId). */
export function lineKey(sheetId: string, id: string): string {
  return `${sheetId}:${id}`
}

export function parseLineKey(key: string): { sheetId: string; id: string } | null {
  const [sheetId, id, extra] = key.split(':')
  if (!sheetId || !id || extra !== undefined) return null
  return { sheetId, id }
}

/** Key for `sheetState`: one JSON value per store per sheet. */
export function stateKey(sheetId: string, store: string): string {
  return `${sheetId}:${store}`
}

export function parseStateKey(key: string): { sheetId: string; store: string } | null {
  const parts = parseLineKey(key)
  return parts && { sheetId: parts.sheetId, store: parts.id }
}

// No 'e' (tail ids are e1, e2, …), no '.' (tail suffix) and no ':' (key separator).
const ID_CHARS = 'abcdfghijklmnopqrstuvwxyz0123456789'

/** A random 8-character id for sheets and inserted rows/cols (35^8 ≈ 2e12 values). */
function randomId(): string {
  let id = ''
  while (id.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(8))) {
      // 245 = 7 × 35: dropping bytes above it keeps every character equally likely.
      if (b < 245 && id.length < 8) id += ID_CHARS[b % ID_CHARS.length]
    }
  }
  return id
}

// ---- sheets ----

/**
 * Add a sheet: its id in tab order, its name, and its empty row/col lists.
 * The lists are created here, once, because two tabs creating the same
 * nested Y.Array at the same moment would lose one tab's writes.
 */
export function addSheet(doc: Y.Doc, name: string, index?: number): string {
  const r = roots(doc)
  const sheetId = randomId()
  doc.transact(() => {
    r.sheets.insert(Math.min(index ?? r.sheets.length, r.sheets.length), [sheetId])
    r.sheetMeta.set(sheetId, { name })
    r.rows.set(sheetId, new Y.Array<string>())
    r.cols.set(sheetId, new Y.Array<string>())
  })
  return sheetId
}

/**
 * Remove a sheet and every key built from its id, in one transaction. Items in the
 * per-item stores (charts, comments, …) carry their sheet inside the JSON; the glue
 * removes those.
 */
export function removeSheet(doc: Y.Doc, sheetId: string): void {
  const r = roots(doc)
  const prefix = sheetId + ':'
  doc.transact(() => {
    const at = r.sheets.toArray().indexOf(sheetId)
    if (at >= 0) r.sheets.delete(at, 1)
    r.sheetMeta.delete(sheetId)
    r.rows.delete(sheetId)
    r.cols.delete(sheetId)
    for (const map of [r.inputs, r.formats, r.rowFormats, r.colFormats, r.sheetState, r.tails]) {
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key)
    }
  })
}

// ---- row/col id lists ----

export interface Axis {
  /** How many rows (cols) have ids. Everything past this is empty. */
  readonly length: number
  /** The ids in order, duplicates counted once. */
  ids(): string[]
  /** Position → id; undefined past the end. */
  idAt(pos: number): string | undefined
  /** Id → position; -1 if it was deleted (or never existed). */
  posOf(id: string): number
  /** The id at `pos`, appending tail ids up to it if the list is shorter. */
  ensure(pos: number): string
  /** Insert `count` new ids before `pos`; returns them. No-op past the end (nothing to shift). */
  insert(pos: number, count: number): string[]
  /** Delete `count` ids from `pos` and every cell/format keyed by them; returns them. */
  remove(pos: number, count: number): string[]
  /**
   * Move `count` ids from `pos` so the block starts at `pos + delta` (IronCalc's
   * moveRows/moveColumns). The ids, and so their cells, go with it; positions
   * past the end get tail ids first.
   */
  move(pos: number, count: number, delta: number): void
}

interface Index {
  ids: string[]
  pos: Map<string, number>
  /** The transaction whose appends `ensure` already applied to this index. */
  extendedIn?: Y.Transaction
}

// Effective lists, built once per change and always current when an observer
// runs: dropped when a transaction touches the Y.Array (before its observers
// are called) and by our own inserts/removes mid-transaction. `ensure` extends
// the index in place inside its transaction instead; that index is kept, so
// typing down a sheet row by row stays cheap.
const indexes = new WeakMap<Y.Array<string>, Index>()
const watched = new WeakSet<Y.Doc>()

function watch(doc: Y.Doc): void {
  if (watched.has(doc)) return
  watched.add(doc)
  doc.on('beforeObserverCalls', (tr: Y.Transaction) => {
    for (const type of tr.changed.keys()) {
      if (!(type instanceof Y.Array)) continue
      const index = indexes.get(type)
      if (index?.extendedIn === tr) delete index.extendedIn
      else indexes.delete(type)
    }
  })
}

function indexOf(list: Y.Array<string>): Index {
  let index = indexes.get(list)
  if (!index) {
    const ids: string[] = []
    const pos = new Map<string, number>()
    for (const id of list.toArray()) {
      if (pos.has(id)) continue
      pos.set(id, ids.length)
      ids.push(id)
    }
    index = { ids, pos }
    indexes.set(list, index)
  }
  return index
}

const ROOT_TAIL = /^e(\d+)$/
const SUFFIX_TAIL = /^(.+)\.(\d+)$/

/** Where tail ids after `lastId` continue from: e7 → (e, 7); x7p2.3 → (x7p2, 3); x7p2 → (x7p2, 0). */
function tailStart(lastId: string | undefined): { base: string; n: number } {
  if (lastId === undefined) return { base: 'e', n: 0 }
  const root = ROOT_TAIL.exec(lastId)
  if (root) return { base: 'e', n: Number(root[1]) }
  const suffixed = SUFFIX_TAIL.exec(lastId)
  if (suffixed) return { base: suffixed[1]!, n: Number(suffixed[2]) }
  return { base: lastId, n: 0 }
}

/** Whether an id was grown past the end (e7, x7p2.3) rather than inserted. */
export function isTailId(id: string): boolean {
  return ROOT_TAIL.test(id) || SUFFIX_TAIL.test(id)
}

function tailId(base: string, n: number): string {
  return base === 'e' ? `e${n}` : `${base}.${n}`
}

function checkPos(pos: number, count = 1): void {
  if (!Number.isInteger(pos) || pos < 0 || !Number.isInteger(count) || count < 0) {
    throw new RangeError(`bad position ${pos} / count ${count}`)
  }
}

/** The row (or col) id list of one sheet. The sheet must exist (see addSheet). */
export function axis(doc: Y.Doc, sheetId: string, name: AxisName): Axis {
  const r = roots(doc)
  const list = r[name].get(sheetId)
  if (!list) throw new Error(`no ${name} list for sheet ${sheetId}`)
  watch(doc)
  const fresh = () => indexOf(list)
  const changed = () => indexes.delete(list)

  const api: Axis = {
    get length() {
      return fresh().ids.length
    },
    ids: () => [...fresh().ids],
    idAt: (pos) => fresh().ids[pos],
    posOf: (id) => fresh().pos.get(id) ?? -1,

    ensure(pos) {
      checkPos(pos)
      const index = fresh()
      const { ids, pos: at } = index
      const have = ids[pos]
      if (have !== undefined) return have
      const start = tailStart(ids[ids.length - 1])
      const tailsKey = `${sheetId}:${name}:${start.base}`
      let n = Math.max(start.n, r.tails.get(tailsKey) ?? 0)
      const added: string[] = []
      while (ids.length + added.length <= pos) {
        n++
        const id = tailId(start.base, n)
        if (!at.has(id)) added.push(id)
      }
      doc.transact((tr) => {
        list.push(added)
        r.tails.set(tailsKey, n)
        // Appending keeps the index valid (the new ids are not in it yet), so extend it
        // instead of rebuilding: growing row by row would otherwise be quadratic. Done
        // inside the transaction, before its observers run.
        for (const id of added) {
          at.set(id, ids.length)
          ids.push(id)
        }
        index.extendedIn = tr
      })
      return added[added.length - 1]!
    },

    insert(pos, count) {
      checkPos(pos, count)
      const target = fresh().ids[pos]
      if (target === undefined || count === 0) return []
      const added = Array.from({ length: count }, randomId)
      list.insert(list.toArray().indexOf(target), added)
      changed()
      return added
    },

    remove(pos, count) {
      checkPos(pos, count)
      const gone = fresh().ids.slice(pos, pos + count)
      if (!gone.length) return []
      const goneSet = new Set(gone)
      const prefix = sheetId + ':'
      const lineFormats = name === 'rows' ? r.rowFormats : r.colFormats
      doc.transact(() => {
        // Every copy of each id goes (a surviving duplicate would bring the row back),
        // deleted as runs from the end so earlier indexes stay valid.
        const raw = list.toArray()
        for (let end = raw.length - 1; end >= 0; end--) {
          if (!goneSet.has(raw[end]!)) continue
          let start = end
          while (start > 0 && goneSet.has(raw[start - 1]!)) start--
          list.delete(start, end - start + 1)
          end = start
        }
        for (const map of [r.inputs, r.formats]) {
          for (const key of [...map.keys()]) {
            if (!key.startsWith(prefix)) continue
            const cell = parseCellKey(key)
            if (cell && goneSet.has(name === 'rows' ? cell.rowId : cell.colId)) map.delete(key)
          }
        }
        for (const id of gone) lineFormats.delete(lineKey(sheetId, id))
      })
      changed()
      return gone
    },

    move(pos, count, delta) {
      checkPos(pos, count)
      checkPos(pos + delta)
      if (count === 0 || delta === 0) return
      doc.transact(() => {
        api.ensure(Math.max(pos, pos + delta) + count - 1)
        const ids = fresh().ids
        const block = ids.slice(pos, pos + count)
        const rest = [...ids.slice(0, pos), ...ids.slice(pos + count)]
        const before = rest[pos + delta] // the id the block lands in front of; none = the end
        const moving = new Set(block)
        // Every copy goes (as in remove), so the block counts at its new place only.
        const raw = list.toArray()
        for (let i = raw.length - 1; i >= 0; i--) if (moving.has(raw[i]!)) list.delete(i, 1)
        list.insert(before === undefined ? list.length : list.toArray().indexOf(before), block)
      })
      changed()
    },
  }
  return api
}
