// The side stores (engine/*.ts) in the collab doc, both ways.
//
// Each store keeps its state keyed by sheet name and A1 position. The doc
// keys the same things by sheet id and row/col id (schema.ts), so an insert
// above a comment doesn't move its key. In between sits a flat list of
// entries, one per thing the doc keeps a key for, still by name and position:
//
//   store snapshots ──storeEntries──▶ entries ──writeStores──▶ doc
//   stores ◀──restoreStores── entries ◀──readEntries── doc
//
// Where each store lands (COLLAB-DESIGN §3):
//   formats       formats / rowFormats / colFormats, by cell / row / col id
//   comments      comments, by cell id
//   validation    validations, by cell id
//   merge, protection, sortFilter, view
//                 sheetState, one JSON per sheet (`sheetId:merge`, …)
//   condFormat, slicers
//                 condFormats / slicers, one key per item: { sheet: sheetId, at, item }
//   charts, pivot, namedRanges
//                 charts / pivots / names, one key per item
// Ranges inside a value stay A1 text, and the sheet names inside charts,
// pivots and named ranges stay names, like formulas (Q10): the tab that
// renames a sheet or inserts a row rewrites them and writes the result.
//
// writeStores writes only keys whose value differs from the doc's, so writing
// back what a remote change just restored writes nothing.
//
// A pivot's output is derived: each tab writes it locally on rebuild, inputs
// and header/total banding alike. Neither goes into the doc, and restoring the
// doc's formats keeps the banding this tab wrote.

import * as Y from 'yjs'

import type { ChartSnapshot } from '../engine/charts'
import type { CommentsSnapshot } from '../engine/comments'
import type { CfSnapshot } from '../engine/cond-format'
import type { Format, FormatSheet, FormatsSnapshot } from '../engine/formats'
import type { MergeSnapshot } from '../engine/merge'
import type { NamedRangesSnapshot } from '../engine/named-ranges'
import type { PivotEngine, PivotSnapshot } from '../engine/pivot'
import type { ProtectionSnapshot } from '../engine/protection'
import type { SlicersSnapshot } from '../engine/slicers'
import type { ValidationSnapshot } from '../engine/validation'
import { cellId, parseCellId } from '../utils/cells'
import {
  axis,
  cellKey,
  lineKey,
  parseCellKey,
  parseLineKey,
  parseStateKey,
  roots,
  stateKey,
  type Axis,
} from './schema'

interface Store<S> {
  snapshot(): S
  restore(snap: S): void
}

/** The editor's side stores. Any of them may be left out (tests pass a few). */
export interface GlueStores {
  formats?: Store<FormatsSnapshot>
  comments?: Store<CommentsSnapshot>
  validation?: Store<ValidationSnapshot>
  merge?: Store<MergeSnapshot>
  protection?: Store<ProtectionSnapshot>
  /** Filter snapshots are opaque here; the converter also holds old filter state verbatim. */
  sortFilter?: Store<Record<string, unknown>>
  /** Per-sheet view: widths, heights, hidden rows/cols, frozen panes (useSheetTabs). */
  view?: Store<Record<string, unknown>>
  condFormat?: Store<CfSnapshot>
  slicers?: Store<SlicersSnapshot>
  charts?: Store<ChartSnapshot>
  pivot?: Pick<PivotEngine, 'snapshot' | 'restore' | 'list' | 'setExtent'>
  namedRanges?: Store<NamedRangesSnapshot>
}

export type StoreName = keyof GlueStores

export const STORE_NAMES: readonly StoreName[] = [
  'formats',
  'comments',
  'validation',
  'merge',
  'protection',
  'sortFilter',
  'view',
  'condFormat',
  'slicers',
  'charts',
  'pivot',
  'namedRanges',
]

/** A sheet as the doc lists it, with the name its tab shows. */
export interface SheetRef {
  id: string
  name: string
}

/**
 * The doc's sheets in tab order. A sheet id listed twice (two tabs moving it at
 * once) counts at its first place; one without a name was deleted. Two sheets
 * given the same name at the same moment (two tabs adding "Sheet2") would
 * clash in IronCalc, so the later one in tab order shows "Sheet2 (2)". Every
 * tab works this out the same way.
 */
export function docSheets(doc: Y.Doc): SheetRef[] {
  const r = roots(doc)
  const out: SheetRef[] = []
  const seenIds = new Set<string>()
  const taken = new Set<string>()
  for (const id of r.sheets.toArray()) {
    const base = r.sheetMeta.get(id)?.name
    if (seenIds.has(id) || base === undefined || !r.rows.has(id) || !r.cols.has(id)) continue
    seenIds.add(id)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
    taken.add(name.toLowerCase())
    out.push({ id, name })
  }
  return out
}

/** Whether a cell (0-based) is inside the output a pivot last wrote. */
export type PivotOutput = (sheet: string, row: number, col: number) => boolean

/** The cells the pivots last wrote; null while none has written any. */
export function pivotOutput(stores: GlueStores): PivotOutput | null {
  const out = (stores.pivot?.list() ?? []).flatMap((p) =>
    p._extent && p.outputSheet ? [{ sheet: p.outputSheet, ...p._extent }] : [],
  )
  if (!out.length) return null
  return (sheet, row, col) =>
    out.some((e) => e.sheet === sheet && row >= e.r0 && row <= e.r1 && col >= e.c0 && col <= e.c1)
}

// ---- entries ----

type EntryRoot =
  | 'formats'
  | 'rowFormats'
  | 'colFormats'
  | 'comments'
  | 'validations'
  | 'sheetState'
  | 'condFormats'
  | 'slicers'
  | 'charts'
  | 'pivots'
  | 'names'

/**
 * One thing the doc keeps a key for, by sheet name and position. Fields a kind
 * doesn't use are '' / -1 / 0, so entries compare as plain JSON.
 */
export interface Entry {
  root: EntryRoot
  /** Sheet name; '' for workbook items (charts, pivots, names). */
  sheet: string
  /** 0-based; -1 when the entry has no row (col). */
  row: number
  col: number
  /** Item id, or the store name in sheetState; '' for keyed-by-position entries. */
  key: string
  /** Order among the sheet's items (CF rules apply in order); else 0. */
  at: number
  value: unknown
}

const ROOTS_OF: Record<StoreName, EntryRoot[]> = {
  formats: ['formats', 'rowFormats', 'colFormats'],
  comments: ['comments'],
  validation: ['validations'],
  merge: ['sheetState'],
  protection: ['sheetState'],
  sortFilter: ['sheetState'],
  view: ['sheetState'],
  condFormat: ['condFormats'],
  slicers: ['slicers'],
  charts: ['charts'],
  pivot: ['pivots'],
  namedRanges: ['names'],
}

// The key part of a sheetState key for each per-sheet store.
const STATE_KEY = { merge: 'merge', protection: 'protection', sortFilter: 'filter', view: 'view' }
type StateStore = keyof typeof STATE_KEY
const STATE_STORES = ['merge', 'protection', 'sortFilter', 'view'] satisfies StateStore[]
const STATE_STORE_OF: Record<string, StateStore> = Object.fromEntries(
  STATE_STORES.map((s) => [STATE_KEY[s], s]),
)

const ITEM_STORE: Record<'charts' | 'pivots' | 'names', 'charts' | 'pivot' | 'namedRanges'> = {
  charts: 'charts',
  pivots: 'pivot',
  names: 'namedRanges',
}

// A sheet's view minus what is each user's own (Q9): zoom. Widths, heights,
// hidden rows/cols and frozen panes are shared.
const PRIVATE_VIEW_FIELDS = ['zoom']
function sharedView(view: unknown): unknown {
  if (!view || typeof view !== 'object') return view
  return Object.fromEntries(Object.entries(view).filter(([k]) => !PRIVATE_VIEW_FIELDS.includes(k)))
}

function entry(root: EntryRoot, fields: Partial<Omit<Entry, 'root'>>): Entry {
  return { root, sheet: '', row: -1, col: -1, key: '', at: 0, value: null, ...fields }
}

function byCell(
  root: EntryRoot,
  snap: Record<string, Record<string, unknown>> | undefined,
  out: Entry[],
  skip: PivotOutput | null = null,
): void {
  for (const [sheet, cells] of Object.entries(snap ?? {})) {
    for (const [id, value] of Object.entries(cells ?? {})) {
      const p = parseCellId(id)
      if (p && !skip?.(sheet, p.row, p.col))
        out.push(entry(root, { sheet, row: p.row, col: p.col, value }))
    }
  }
}

/**
 * Every entry the given stores hold now, minus format cells inside `derived`.
 * A caller passing only some stores passes the pivot output of all of them.
 */
export function storeEntries(
  stores: GlueStores,
  derived: PivotOutput | null = pivotOutput(stores),
): Entry[] {
  const out: Entry[] = []
  for (const [sheet, fs] of Object.entries(stores.formats?.snapshot() ?? {})) {
    byCell('formats', { [sheet]: fs.cells }, out, derived)
    for (const [r, value] of Object.entries(fs.rows ?? {}))
      out.push(entry('rowFormats', { sheet, row: Number(r), value }))
    for (const [c, value] of Object.entries(fs.cols ?? {}))
      out.push(entry('colFormats', { sheet, col: Number(c), value }))
  }
  byCell('comments', stores.comments?.snapshot(), out)
  byCell('validations', stores.validation?.snapshot(), out)
  for (const store of STATE_STORES) {
    const snap: Record<string, unknown> | undefined = stores[store]?.snapshot()
    for (const [sheet, value] of Object.entries(snap ?? {})) {
      const shared = store === 'view' ? sharedView(value) : value
      out.push(entry('sheetState', { sheet, key: STATE_KEY[store], value: shared }))
    }
  }
  const perSheet: [EntryRoot, Record<string, { id: number }[]> | undefined][] = [
    ['condFormats', stores.condFormat?.snapshot()],
    ['slicers', stores.slicers?.snapshot()],
  ]
  for (const [root, snap] of perSheet) {
    for (const [sheet, items] of Object.entries(snap ?? {}))
      items.forEach((item, at) =>
        out.push(entry(root, { sheet, key: String(item.id), at, value: item })),
      )
  }
  const items: [EntryRoot, Record<string, unknown> | undefined][] = [
    ['charts', stores.charts?.snapshot().charts],
    ['pivots', stores.pivot?.snapshot().pivots],
    ['names', stores.namedRanges?.snapshot().entries],
  ]
  for (const [root, snap] of items) {
    for (const [key, value] of Object.entries(snap ?? {})) out.push(entry(root, { key, value }))
  }
  return out
}

// ---- writing ----

/** A JSON-clean copy: what the doc stores, and what two values are compared by. */
function plain(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

/** JSON with sorted keys, so equal values compare equal whatever their key order. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

type AxisCache = (sheetId: string, name: 'rows' | 'cols') => Axis

function axisCache(doc: Y.Doc): AxisCache {
  const cache = new Map<string, Axis>()
  return (sheetId, name) => {
    const k = `${sheetId}:${name}`
    let a = cache.get(k)
    if (!a) cache.set(k, (a = axis(doc, sheetId, name)))
    return a
  }
}

// The doc key and value for an entry, growing the id lists to reach it.
function docKeyValue(e: Entry, idOf: Map<string, string>, ax: AxisCache): [string, unknown] | null {
  if (e.root === 'charts' || e.root === 'pivots' || e.root === 'names')
    return [e.key, plain(e.value)]
  const sheetId = idOf.get(e.sheet)
  if (sheetId === undefined) return null
  switch (e.root) {
    case 'formats':
    case 'comments':
    case 'validations':
      return [
        cellKey(sheetId, ax(sheetId, 'rows').ensure(e.row), ax(sheetId, 'cols').ensure(e.col)),
        plain(e.value),
      ]
    case 'rowFormats':
      return [lineKey(sheetId, ax(sheetId, 'rows').ensure(e.row)), plain(e.value)]
    case 'colFormats':
      return [lineKey(sheetId, ax(sheetId, 'cols').ensure(e.col)), plain(e.value)]
    case 'sheetState':
      return [stateKey(sheetId, e.key), plain(e.value)]
    case 'condFormats':
    case 'slicers':
      return [e.key, { sheet: sheetId, at: e.at, item: plain(e.value) }]
  }
}

// Whether a key in `root` belongs to one of the given stores (sheetState is shared).
function owns(root: EntryRoot, key: string, present: Set<StoreName>): boolean {
  if (root !== 'sheetState') return true
  const store = STATE_STORE_OF[parseStateKey(key)?.store ?? '']
  return store !== undefined && present.has(store)
}

/**
 * Make the doc hold exactly what the given stores hold: set the keys whose
 * value differs, delete the keys a store no longer has. Stores left out of
 * `stores` are not touched. Runs in one transaction (the caller's, if any).
 */
export function writeStores(
  doc: Y.Doc,
  stores: GlueStores,
  sheets: SheetRef[],
  derived: PivotOutput | null = pivotOutput(stores),
): void {
  const present = new Set(STORE_NAMES.filter((s) => stores[s]))
  const owned = new Set([...present].flatMap((s) => ROOTS_OF[s]))
  const idOf = new Map(sheets.map((s) => [s.name, s.id]))
  const nameOf = new Map(sheets.map((s) => [s.id, s.name]))
  roots(doc)
  doc.transact(() => {
    const ax = axisCache(doc)
    // A doc format key inside the pivot output is not this tab's to delete:
    // another tab may have put it there before it saw the pivot.
    const inOutput = (root: EntryRoot, key: string) => {
      const k = root === 'formats' && derived ? parseCellKey(key) : null
      const sheet = k ? nameOf.get(k.sheetId) : undefined
      if (!k || sheet === undefined) return false
      const row = ax(k.sheetId, 'rows').posOf(k.rowId)
      const col = ax(k.sheetId, 'cols').posOf(k.colId)
      return row >= 0 && col >= 0 && !!derived?.(sheet, row, col)
    }
    const want = new Map<EntryRoot, Map<string, unknown>>(
      [...owned].map((root) => [root, new Map()]),
    )
    for (const e of storeEntries(stores, derived)) {
      const kv = docKeyValue(e, idOf, ax)
      if (kv) want.get(e.root)?.set(kv[0], kv[1])
    }
    for (const [root, keys] of want) {
      const map = doc.getMap<unknown>(root)
      for (const key of [...map.keys()]) {
        if (!keys.has(key) && owns(root, key, present) && !inOutput(root, key)) map.delete(key)
      }
      for (const [key, value] of keys) {
        if (!map.has(key) || canon(map.get(key)) !== canon(value)) map.set(key, value)
      }
    }
  })
}

// ---- reading ----

/** Every entry the doc holds, by the names and positions they have now. Orphans are skipped. */
export function readEntries(doc: Y.Doc, sheets: SheetRef[]): Entry[] {
  const r = roots(doc)
  const nameOf = new Map(sheets.map((s) => [s.id, s.name]))
  const ax = axisCache(doc)
  const out: Entry[] = []
  const clone = (v: unknown) => plain(v)

  const cellRoots: ['formats' | 'comments' | 'validations', Pick<Y.Map<unknown>, 'entries'>][] = [
    ['formats', r.formats],
    ['comments', r.comments],
    ['validations', r.validations],
  ]
  for (const [root, map] of cellRoots) {
    for (const [key, value] of map.entries()) {
      const k = parseCellKey(key)
      const sheet = k ? nameOf.get(k.sheetId) : undefined
      if (!k || sheet === undefined) continue
      const row = ax(k.sheetId, 'rows').posOf(k.rowId)
      const col = ax(k.sheetId, 'cols').posOf(k.colId)
      if (row >= 0 && col >= 0) out.push(entry(root, { sheet, row, col, value: clone(value) }))
    }
  }
  const lineRoots: [
    'rowFormats' | 'colFormats',
    Pick<Y.Map<unknown>, 'entries'>,
    'rows' | 'cols',
  ][] = [
    ['rowFormats', r.rowFormats, 'rows'],
    ['colFormats', r.colFormats, 'cols'],
  ]
  for (const [root, map, name] of lineRoots) {
    for (const [key, value] of map.entries()) {
      const k = parseLineKey(key)
      const sheet = k ? nameOf.get(k.sheetId) : undefined
      if (!k || sheet === undefined) continue
      const pos = ax(k.sheetId, name).posOf(k.id)
      if (pos < 0) continue
      const at = name === 'rows' ? { row: pos } : { col: pos }
      out.push(entry(root, { sheet, ...at, value: clone(value) }))
    }
  }
  for (const [key, value] of r.sheetState.entries()) {
    const k = parseStateKey(key)
    const sheet = k ? nameOf.get(k.sheetId) : undefined
    if (k && sheet !== undefined && STATE_STORE_OF[k.store])
      out.push(entry('sheetState', { sheet, key: k.store, value: clone(value) }))
  }
  const perSheet: ['condFormats' | 'slicers', Y.Map<unknown>][] = [
    ['condFormats', r.condFormats],
    ['slicers', r.slicers],
  ]
  for (const [root, map] of perSheet) {
    for (const [key, value] of map.entries()) {
      if (
        !value ||
        typeof value !== 'object' ||
        !('sheet' in value) ||
        typeof value.sheet !== 'string'
      )
        continue
      const sheet = nameOf.get(value.sheet)
      if (sheet !== undefined)
        out.push(
          entry(root, {
            sheet,
            key,
            at: 'at' in value && typeof value.at === 'number' ? value.at : 0,
            value: clone('item' in value ? value.item : undefined),
          }),
        )
    }
  }
  for (const root of ['charts', 'pivots', 'names'] as const) {
    for (const [key, value] of r[root].entries())
      out.push(entry(root, { key, value: clone(value) }))
  }
  return out
}

// ---- restoring ----

function bySheet<T>(list: Entry[], value: (e: Entry) => [string, T]) {
  const out: Record<string, Record<string, T>> = {}
  for (const e of list) {
    const [k, v] = value(e)
    ;(out[e.sheet] ??= {})[k] = v
  }
  return out
}

function itemsBySheet<T>(list: Entry[]) {
  const out: Record<string, T[]> = {}
  const order = [...list].sort(
    (a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
  for (const e of order) {
    // SAFETY: callers pair this list's root with its receiving item store; Entry
    // erases the snapshot type, while sorting leaves the payload itself unchanged.
    const item = e.value as T
    ;(out[e.sheet] ??= []).push(item)
  }
  return out
}

/**
 * Restore the stores from entries (readEntries). `only` limits it to some
 * stores; a pivot keeps the output extent it last wrote, which is render state
 * the doc doesn't hold.
 */
export function restoreStores(stores: GlueStores, entries: Entry[], only?: Set<StoreName>): void {
  const of = (root: EntryRoot) => entries.filter((e) => e.root === root)
  const want = (s: StoreName) => (only ? only.has(s) : true)

  if (stores.formats && want('formats')) {
    const snap: Record<string, FormatSheet> = {}
    const sheet = (name: string) => (snap[name] ??= { cells: {}, cols: {}, rows: {} })
    for (const e of of('formats')) {
      // SAFETY: formats is the FormatsSnapshot cell map; readEntries remaps its
      // positions without changing the format object written by storeEntries.
      sheet(e.sheet).cells[cellId(e.row, e.col)] = e.value as Format
    }
    for (const e of of('rowFormats')) {
      // SAFETY: rowFormats is the same Format payload stored under a stable row id.
      sheet(e.sheet).rows[e.row] = e.value as Format
    }
    for (const e of of('colFormats')) {
      // SAFETY: colFormats is the same Format payload stored under a stable column id.
      sheet(e.sheet).cols[e.col] = e.value as Format
    }
    const derived = pivotOutput(stores)
    for (const [name, fs] of Object.entries(derived ? stores.formats.snapshot() : {})) {
      for (const [id, format] of Object.entries(fs.cells ?? {})) {
        const p = parseCellId(id)
        if (p && derived?.(name, p.row, p.col)) sheet(name).cells[id] = format
      }
    }
    stores.formats.restore(snap)
  }
  if (stores.comments && want('comments'))
    stores.comments.restore(
      // SAFETY: the comments root contains this owner's stored comments; bySheet
      // changes only the stable cell keys back into the owner's A1 keys.
      bySheet(of('comments'), (e) => [cellId(e.row, e.col), e.value]) as CommentsSnapshot,
    )
  if (stores.validation && want('validation'))
    stores.validation.restore(
      // SAFETY: the validations root carries ValidationSnapshot cell values;
      // restoring A1 keys leaves each owner's saved rule unchanged.
      bySheet(of('validations'), (e) => [cellId(e.row, e.col), e.value]) as ValidationSnapshot,
    )
  for (const store of STATE_STORES) {
    const s: Store<Record<string, unknown>> | undefined = stores[store]
    if (!s || !want(store)) continue
    const snap: Record<string, unknown> = {}
    for (const e of of('sheetState')) if (e.key === STATE_KEY[store]) snap[e.sheet] = e.value
    s.restore(snap)
  }
  if (stores.condFormat && want('condFormat'))
    stores.condFormat.restore(itemsBySheet(of('condFormats')))
  if (stores.slicers && want('slicers')) stores.slicers.restore(itemsBySheet(of('slicers')))

  const items = (root: 'charts' | 'pivots' | 'names') =>
    Object.fromEntries(of(root).map((e) => [e.key, e.value]))
  for (const root of ['charts', 'pivots', 'names'] as const) {
    const store = ITEM_STORE[root]
    if (!stores[store] || !want(store)) continue
    if (root === 'charts') {
      // SAFETY: charts contains ChartSnapshot.charts, written by that owner; items
      // restores the key-to-item envelope after Entry erased its snapshot type.
      stores.charts?.restore({ charts: items(root) } as ChartSnapshot)
    }
    if (root === 'names') {
      // SAFETY: names is NamedRangesSnapshot.entries, keyed by the owner's normalized names.
      stores.namedRanges?.restore({ entries: items(root) } as NamedRangesSnapshot)
    }
    if (root === 'pivots' && stores.pivot) {
      const extents = stores.pivot.list().map((p) => [p.id, p._extent ?? null] as const)
      // SAFETY: pivots holds PivotSnapshot.pivots; derived output extents are restored
      // separately below because the shared document intentionally omits those extents.
      stores.pivot.restore({ pivots: items(root) } as PivotSnapshot)
      for (const [id, extent] of extents) stores.pivot.setExtent(id, extent)
    }
  }
}

/** Which stores read from a given doc root (for restoring only what a change touched). */
export function storesOfRoot(root: string): StoreName[] {
  return STORE_NAMES.filter((s) => ROOTS_OF[s].some((entryRoot) => entryRoot === root))
}
