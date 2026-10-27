// The glue between one tab's workbook (IronCalc + side stores) and the
// collab doc (schema.ts). The doc is the source of truth; IronCalc never
// sees an id.
//
//   editor ──dispatch(cmd)──▶ glue ──▶ IronCalc (core/client.ts)
//   side stores ◀────────────▶ glue ◀──▶ Y.Doc
//                                ▲
//                     receive(update): updates from other tabs
//
// Out (local → doc). Every command the editor sends IronCalc goes through
// dispatch(), which passes it on and remembers it. commit(), called once at
// the end of each user action, writes the action into the doc in one
// transaction: each command turned into keys (positions → ids), then every
// side store compared with the doc (stores.ts), then, after a row/col/sheet
// change, every formula as IronCalc rewrote it. Pivot output is written
// through localOnly() and never reaches the doc.
//
// In (doc → local). An update from another tab is applied to the doc with
// remoteOrigin. The glue compares the doc's sheets and id lists with what
// IronCalc holds (the mirror), sends IronCalc the inserts, deletes and moves
// that turn one into the other, then every input that changed (ids →
// positions), all in one batch, and restores the side stores the update
// touched. After a row/col/sheet change it re-sends every formula from the
// doc, so both tabs hold the doc's text whatever IronCalc rewrote.
// Its own commits carry localOrigin, so they never come back in.
//
// An update that arrives while a local action is not committed yet waits
// until the commit: its inserts would otherwise move rows under a command
// that still names them by position. So does one that arrives while load()
// builds IronCalc. The glue can't see a side store change until commit()
// runs, so the editor commits in the same task as the change (before any
// update can come in).
//
// The seam for collab 4: collab-client calls receive() with each update
// from the server and sends every doc update whose origin isn't
// remoteOrigin.

import * as Y from 'yjs'

import type { WorkbookClient } from '../core/client'
import { validateCommand, type CellRange, type NonBatchCommand } from '../core/commands'
import {
  buildWorkbookFromDoc,
  glueBatch,
  glueCommand,
  putInput,
  readSheetFormulas,
  readSheetInputs,
  writeWorkbookToDoc,
  type CellInput,
} from './load'
import {
  addSheet,
  axis,
  cellKey,
  parseCellKey,
  parseLineKey,
  removeSheet,
  roots,
  type AxisName,
} from './schema'
import {
  docSheets,
  readEntries,
  restoreStores,
  STORE_NAMES,
  storesOfRoot,
  writeStores,
  type GlueStores,
  type SheetRef,
  type StoreName,
} from './stores'

/** What a change from another tab touched, so the editor repaints what it must. */
interface RemoteChange {
  /** IronCalc changed: repaint the grid, refresh charts. */
  cells: boolean
  /** Sheets were added, removed, renamed or reordered: refresh the tabs. */
  sheets: boolean
  /** Side stores restored from the doc. */
  stores: StoreName[]
}

export interface Glue {
  /** Origin of the glue's own doc writes. */
  readonly localOrigin: object
  /** Origin of updates applied through receive(). */
  readonly remoteOrigin: object
  /** Open the doc: build IronCalc + stores from it, or fill it from them when it is empty. */
  load(): Promise<void>
  /** Send a command to IronCalc, and write it to the doc at the next commit. */
  dispatch(cmd: unknown): void
  /** Run `fn`; commands it dispatches reach IronCalc but never the doc (pivot output). */
  localOnly<T>(fn: () => T): T
  /** Write everything since the last commit to the doc, as one transaction. */
  commit(): Promise<void>
  /** Apply an update from another tab (held while a local action is open). */
  receive(update: Uint8Array): void
  /** Resolves once commits and held updates are done and IronCalc is idle. */
  settled(): Promise<void>
  onRemote(cb: (change: RemoteChange) => void): () => void
  stop(): void
}

export interface GlueOptions {
  doc: Y.Doc
  client: WorkbookClient
  stores: GlueStores
}

interface Lists {
  rows: string[]
  cols: string[]
}

/** What IronCalc holds, in the doc's terms: sheets in tab order and their id lists. */
interface Mirror {
  sheets: SheetRef[]
  lists: Map<string, Lists>
}

// Reads a commit needs from IronCalc, taken before its transaction (reads are
// async, the transaction is not).
interface Reads {
  /** Every cell of the sheets the action created (added or duplicated), by final name. */
  created: Map<string, CellInput[]>
  /** Every formula, by sheet name, when the action moved rows/cols or renamed/deleted a sheet. */
  formulas: Map<string, CellInput[]> | null
}

const STRUCTURAL = new Set([
  'insertRows',
  'deleteRows',
  'insertColumns',
  'deleteColumns',
  'moveRows',
  'moveColumns',
  'renameSheet',
  'deleteSheet',
])

// Clears up to this many cells by position; a bigger range scans the sheet's keys instead.
const CLEAR_BY_POSITION = 4096

// tr.changed is typed by Yjs's internal AbstractType; our typed roots compare by identity.
const touchedIn = (tr: Y.Transaction, type: object) =>
  (tr.changed as Map<object, Set<string | null>>).has(type)
const changedKeys = (tr: Y.Transaction, type: object) =>
  (tr.changed as Map<object, Set<string | null>>).get(type) ?? []

// A sheet's name while sheets swap names (A ↔ B). No user names a sheet this.
const renameTmp = (sheetId: string) => `~glue~${sheetId}`

export function createGlue({ doc, client, stores }: GlueOptions): Glue {
  const localOrigin = { glue: 'local' }
  const remoteOrigin = { glue: 'remote' }
  const r = roots(doc)
  const rootName = new Map<unknown, string>(Object.entries(r).map(([name, type]) => [type, name]))

  let pending: NonBatchCommand[] = []
  let localOnlyDepth = 0
  let committing = false
  let chain: Promise<void> = Promise.resolve()
  const held: Uint8Array[] = []
  let mirror: Mirror = { sheets: [], lists: new Map() }
  let loaded = false
  let stopped = false
  const listeners = new Set<(change: RemoteChange) => void>()
  const warned = new Set<string>()

  // Each store's snapshot, as JSON, when it last matched the doc. A commit
  // skips the stores whose snapshot hasn't changed since: diffing 10k formats
  // against the doc on every keystroke cost ~75 ms (glue.bench.test.ts).
  const synced = new Map<StoreName, string>()
  const fingerprint = (s: StoreName) => JSON.stringify(stores[s]?.snapshot() ?? null)
  function markSynced(names: readonly StoreName[]): void {
    for (const s of names) if (stores[s]) synced.set(s, fingerprint(s))
  }
  // The stores that changed since they last matched the doc; all of them
  // after a row/col/sheet change, which moves what their positions mean.
  function changedStores(all: boolean): GlueStores {
    const out: GlueStores = {}
    for (const s of STORE_NAMES) {
      if (stores[s] && (all || fingerprint(s) !== synced.get(s)))
        Object.assign(out, { [s]: stores[s] })
    }
    return out
  }

  // ---- mirror ----

  function readMirror(tr?: Y.Transaction): Mirror {
    const sheets = docSheets(doc)
    const lists = new Map<string, Lists>()
    for (const s of sheets) {
      const old = mirror.lists.get(s.id)
      const list = (name: AxisName) => {
        const y = r[name].get(s.id)
        const same = old && tr && y && !touchedIn(tr, y) && !touchedIn(tr, r[name])
        return same ? old[name] : axis(doc, s.id, name).ids()
      }
      lists.set(s.id, { rows: list('rows'), cols: list('cols') })
    }
    return { sheets, lists }
  }

  // ---- load ----

  async function load(): Promise<void> {
    if (docSheets(doc).length) {
      await buildWorkbookFromDoc(doc, client, stores)
    } else {
      await client.idle()
      await writeWorkbookToDoc(doc, client, stores, { origin: localOrigin, skip: pivotOutput() })
    }
    mirror = readMirror()
    markSynced(STORE_NAMES)
    loaded = true
    flushHeld()
  }

  // Whether a cell (1-based) is inside the last output of a pivot.
  function pivotOutput(): (sheet: string, row: number, col: number) => boolean {
    const out = (stores.pivot?.list() ?? []).flatMap((p) =>
      p._extent && p.outputSheet ? [{ sheet: p.outputSheet, ...p._extent }] : [],
    )
    return (sheet, row, col) =>
      out.some(
        (e) =>
          e.sheet === sheet &&
          row - 1 >= e.r0 &&
          row - 1 <= e.r1 &&
          col - 1 >= e.c0 &&
          col - 1 <= e.c1,
      )
  }

  // ---- out: local → doc ----

  function dispatch(cmd: unknown): void {
    const c = validateCommand(cmd)
    client.dispatch(c)
    if (localOnlyDepth) return
    if (c.type === 'batch') pending.push(...c.payload.commands)
    else pending.push(c)
  }

  function localOnly<T>(fn: () => T): T {
    localOnlyDepth++
    try {
      return fn()
    } finally {
      localOnlyDepth--
    }
  }

  function commit(): Promise<void> {
    const run = chain.then(commitNow)
    chain = run.catch(() => {})
    return run
  }

  async function commitNow(): Promise<void> {
    if (stopped) return
    committing = true
    try {
      const commands: NonBatchCommand[] = []
      let reads: Reads
      // Commands dispatched while the reads ran belong to this action too.
      do {
        commands.push(...pending)
        pending = []
        reads = await readsFor(commands)
      } while (pending.length)
      doc.transact(() => writeLocal(commands, reads), localOrigin)
      mirror = readMirror()
      markSynced(STORE_NAMES)
    } finally {
      committing = false
      flushHeld()
    }
  }

  // The final name of every sheet the commands create, following later renames.
  function createdNames(commands: NonBatchCommand[]): string[] {
    const names: string[] = []
    for (const c of commands) {
      const p = c.payload as { sheet?: string; name?: string }
      if ((c.type === 'addSheet' || c.type === 'duplicateSheet') && p.name) names.push(p.name)
      if (c.type === 'renameSheet' && p.name) {
        const at = names.indexOf(p.sheet ?? '')
        if (at >= 0) names[at] = p.name
      }
      if (c.type === 'deleteSheet') {
        const at = names.indexOf(p.sheet ?? '')
        if (at >= 0) names.splice(at, 1)
      }
    }
    return names
  }

  async function readsFor(commands: NonBatchCommand[]): Promise<Reads> {
    await client.idle()
    const sheets = new Set(client.sheets)
    const created = new Map<string, CellInput[]>()
    for (const name of createdNames(commands))
      if (sheets.has(name)) created.set(name, await readSheetInputs(client, name))
    let formulas: Reads['formulas'] = null
    if (commands.some((c) => STRUCTURAL.has(c.type))) {
      formulas = new Map()
      for (const name of client.sheets) formulas.set(name, await readSheetFormulas(client, name))
    }
    return { created, formulas }
  }

  function sheetIdOf(name: string): string | undefined {
    return docSheets(doc).find((s) => s.name === name)?.id
  }

  function writeLocal(commands: NonBatchCommand[], reads: Reads): void {
    for (const c of commands) writeCommand(c)
    const sheets = docSheets(doc)
    const idOf = new Map(sheets.map((s) => [s.name, s.id]))
    // Sheets this action created: every cell, at the positions it ends with.
    for (const [name, cells] of reads.created) {
      const sheetId = idOf.get(name)
      if (sheetId) for (const cell of cells) putInput(doc, sheetId, cell)
    }
    // Formulas IronCalc rewrote for a row/col/sheet change (Q10).
    for (const [name, cells] of reads.formulas ?? []) {
      const sheetId = idOf.get(name)
      if (sheetId) for (const cell of cells) putInput(doc, sheetId, cell)
    }
    reconcileSheetOrder()
    const moved = commands.some((c) => STRUCTURAL.has(c.type))
    writeStores(doc, changedStores(moved), docSheets(doc))
  }

  function writeCommand(c: NonBatchCommand): void {
    switch (c.type) {
      case 'setDefinedName':
      case 'deleteDefinedName':
        return // names live in the namedRanges store; the editor derives IronCalc's from it
      case 'setRangeStyle':
      case 'setColumnsWidth':
      case 'setRowsHeight':
      case 'setFrozen':
        // The editor keeps these in side stores and never sends them; no doc key yet.
        if (!warned.has(c.type)) console.warn('[sheets] collab: not synced:', c.type)
        warned.add(c.type)
        return
      case 'addSheet':
      case 'duplicateSheet':
        if (c.payload.name && sheetIdOf(c.payload.name) === undefined) addSheet(doc, c.payload.name)
        return
      case 'renameSheet': {
        const id = sheetIdOf(c.payload.sheet)
        const meta = id && r.sheetMeta.get(id)
        if (id && meta) r.sheetMeta.set(id, { ...meta, name: c.payload.name })
        return
      }
      case 'deleteSheet': {
        const id = sheetIdOf(c.payload.sheet)
        if (id) removeSheet(doc, id)
        return
      }
      case 'moveSheet':
        return // reconcileSheetOrder follows IronCalc's final order
    }
    const sheetId = sheetIdOf(c.payload.sheet)
    if (sheetId === undefined) return
    switch (c.type) {
      case 'setInput':
      case 'setArrayFormula': {
        const { row, col, input } = c.payload
        if (input === '') clearRange(sheetId, { r1: row, c1: col, r2: row, c2: col })
        else putInput(doc, sheetId, { row, col, input })
        return
      }
      case 'clearContents':
        clearRange(sheetId, c.payload.range)
        return
      case 'insertRows':
        axis(doc, sheetId, 'rows').insert(c.payload.row - 1, c.payload.count)
        return
      case 'insertColumns':
        axis(doc, sheetId, 'cols').insert(c.payload.col - 1, c.payload.count)
        return
      case 'deleteRows':
        axis(doc, sheetId, 'rows').remove(c.payload.row - 1, c.payload.count)
        return
      case 'deleteColumns':
        axis(doc, sheetId, 'cols').remove(c.payload.col - 1, c.payload.count)
        return
      case 'moveRows':
        axis(doc, sheetId, 'rows').move(c.payload.row - 1, c.payload.count, c.payload.delta)
        return
      case 'moveColumns':
        axis(doc, sheetId, 'cols').move(c.payload.col - 1, c.payload.count, c.payload.delta)
        return
    }
  }

  function clearRange(sheetId: string, range: CellRange): void {
    const rows = axis(doc, sheetId, 'rows')
    const cols = axis(doc, sheetId, 'cols')
    const area = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)
    if (area <= CLEAR_BY_POSITION) {
      for (let row = range.r1; row <= range.r2; row++) {
        const rowId = rows.idAt(row - 1)
        if (rowId === undefined) break
        for (let col = range.c1; col <= range.c2; col++) {
          const colId = cols.idAt(col - 1)
          if (colId === undefined) break
          r.inputs.delete(cellKey(sheetId, rowId, colId))
        }
      }
      return
    }
    for (const key of [...r.inputs.keys()]) {
      const k = parseCellKey(key)
      if (k?.sheetId !== sheetId) continue
      const row = rows.posOf(k.rowId) + 1
      const col = cols.posOf(k.colId) + 1
      if (row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2)
        r.inputs.delete(key)
    }
  }

  // Make the doc's tab order IronCalc's, and add any sheet IronCalc has that
  // the doc doesn't (an addSheet without a name).
  function reconcileSheetOrder(): void {
    const want = client.sheets
    for (const name of want) if (sheetIdOf(name) === undefined) addSheet(doc, name)
    const ids = want.map((name) => sheetIdOf(name)).filter((id): id is string => !!id)
    if (
      ids.join() ===
      docSheets(doc)
        .map((s) => s.id)
        .join()
    )
      return
    // Re-append in IronCalc's order; every copy goes first, as in a row move.
    const moving = new Set(ids)
    const raw = r.sheets.toArray()
    for (let i = raw.length - 1; i >= 0; i--) if (moving.has(raw[i]!)) r.sheets.delete(i, 1)
    r.sheets.push(ids)
  }

  // ---- in: doc → local ----

  function receive(update: Uint8Array): void {
    if (stopped) return
    if (!loaded || committing || pending.length) held.push(update)
    else Y.applyUpdate(doc, update, remoteOrigin)
  }

  function flushHeld(): void {
    while (held.length && loaded && !pending.length && !committing && !stopped)
      Y.applyUpdate(doc, held.shift()!, remoteOrigin)
  }

  function onAfterTransaction(tr: Y.Transaction): void {
    if (!loaded || stopped || tr.origin === localOrigin || tr.changed.size === 0) return
    applyRemote(tr)
  }

  function applyRemote(tr: Y.Transaction): void {
    const before = mirror
    const after = readMirror(tr)
    const commands: NonBatchCommand[] = []
    const sheetsChanged = sheetCommands(before, after, commands)
    let structural = sheetsChanged
    // Row/col ids that came into a list. Usually new rows, but an id can also
    // come back: an update applied before one it depends on arrives in two
    // halves (a moved row's delete first, its re-insert later), and cells keyed
    // by the id never left the doc. Those cells go back into IronCalc.
    const appeared = new Map<string, Set<string>>()
    for (const s of after.sheets) {
      const old = before.lists.get(s.id)
      const now = after.lists.get(s.id)!
      if (!old) continue
      for (const name of ['rows', 'cols'] as const) {
        if (old[name] === now[name]) continue
        structural = axisCommands(s.name, name, old[name], now[name], commands) || structural
        const had = new Set(old[name])
        for (const id of now[name]) {
          if (had.has(id)) continue
          if (!appeared.has(s.id)) appeared.set(s.id, new Set())
          appeared.get(s.id)!.add(id)
        }
      }
    }
    const onAppeared = (k: { sheetId: string; rowId: string; colId: string } | null) =>
      !!k &&
      !!appeared.get(k.sheetId) &&
      (appeared.get(k.sheetId)!.has(k.rowId) || appeared.get(k.sheetId)!.has(k.colId))

    const keys = new Set<string>()
    for (const key of changedKeys(tr, r.inputs)) if (key) keys.add(key)
    const added = new Set(after.sheets.filter((s) => !before.lists.has(s.id)).map((s) => s.id))
    if (structural || added.size || appeared.size) {
      for (const [key, input] of r.inputs.entries()) {
        const k = parseCellKey(key)
        if (!k) continue
        if (added.has(k.sheetId) || (structural && input.startsWith('=')) || onAppeared(k))
          keys.add(key)
      }
    }
    const nameOf = new Map(after.sheets.map((s) => [s.id, s.name]))
    for (const key of keys) {
      const k = parseCellKey(key)
      const sheet = k && nameOf.get(k.sheetId)
      if (!k || sheet === undefined) continue
      const row = axis(doc, k.sheetId, 'rows').posOf(k.rowId) + 1
      const col = axis(doc, k.sheetId, 'cols').posOf(k.colId) + 1
      if (!row || !col) continue // its row or column was deleted: delete wins
      const input = r.inputs.get(key)
      commands.push(
        input
          ? glueCommand('setInput', { sheet, row, col, input })
          : glueCommand('clearContents', { sheet, range: { r1: row, c1: col, r2: row, c2: col } }),
      )
    }
    if (commands.length === 1) client.dispatch(commands[0])
    else if (commands.length > 1) client.dispatch(glueBatch(commands))

    const touched = new Set<StoreName>()
    if (structural) for (const s of STORE_NAMES) touched.add(s)
    for (const type of tr.changed.keys()) {
      for (const s of storesOfRoot(rootName.get(type) ?? '')) touched.add(s)
    }
    // A store with a key on an id that came back shows it again.
    if (appeared.size) {
      for (const [root, map] of [
        ['formats', r.formats],
        ['comments', r.comments],
        ['validations', r.validations],
      ] as const) {
        for (const key of map.keys()) {
          if (!onAppeared(parseCellKey(key))) continue
          for (const s of storesOfRoot(root)) touched.add(s)
          break
        }
      }
      for (const [root, map] of [
        ['rowFormats', r.rowFormats],
        ['colFormats', r.colFormats],
      ] as const) {
        for (const key of map.keys()) {
          const k = parseLineKey(key)
          if (!k || !appeared.get(k.sheetId)?.has(k.id)) continue
          for (const s of storesOfRoot(root)) touched.add(s)
          break
        }
      }
    }
    const restored = STORE_NAMES.filter((s) => touched.has(s) && stores[s])
    if (restored.length) {
      restoreStores(stores, readEntries(doc, after.sheets), new Set(restored))
      markSynced(restored)
    }

    mirror = after
    const change = { cells: commands.length > 0, sheets: sheetsChanged, stores: restored }
    for (const cb of listeners) cb(change)
  }

  // IronCalc commands that turn the mirror's sheets into the doc's. True if any.
  function sheetCommands(before: Mirror, after: Mirror, out: NonBatchCommand[]): boolean {
    const want = new Map(after.sheets.map((s) => [s.id, s.name]))
    const had = new Set(before.sheets.map((s) => s.id))
    const order: SheetRef[] = []
    const start = out.length
    for (const s of before.sheets) {
      if (want.has(s.id)) order.push({ ...s })
      else out.push(glueCommand('deleteSheet', { sheet: s.name }))
    }
    const renamed = order.filter((s) => want.get(s.id) !== s.name)
    for (const s of renamed)
      out.push(glueCommand('renameSheet', { sheet: s.name, name: renameTmp(s.id) }))
    for (const s of renamed) {
      s.name = want.get(s.id)!
      out.push(glueCommand('renameSheet', { sheet: renameTmp(s.id), name: s.name }))
    }
    for (const s of after.sheets) {
      if (had.has(s.id)) continue
      out.push(glueCommand('addSheet', { name: s.name }))
      order.push({ ...s })
    }
    after.sheets.forEach((s, i) => {
      if (order[i]?.id === s.id) return
      const j = order.findIndex((o) => o.id === s.id)
      out.push(glueCommand('moveSheet', { sheet: s.name, index: i }))
      order.splice(i, 0, ...order.splice(j, 1))
    })
    return out.length > start
  }

  // IronCalc commands that turn one id list into another: deletes, then moves,
  // then inserts. Ids appended past the end need nothing (those rows are empty).
  function axisCommands(
    sheet: string,
    name: AxisName,
    old: string[],
    now: string[],
    out: NonBatchCommand[],
  ): boolean {
    const rows = name === 'rows'
    const del = (at: number, count: number) =>
      rows
        ? glueCommand('deleteRows', { sheet, row: at + 1, count })
        : glueCommand('deleteColumns', { sheet, col: at + 1, count })
    const ins = (at: number, count: number) =>
      rows
        ? glueCommand('insertRows', { sheet, row: at + 1, count })
        : glueCommand('insertColumns', { sheet, col: at + 1, count })
    const move = (at: number, delta: number) =>
      rows
        ? glueCommand('moveRows', { sheet, row: at + 1, count: 1, delta })
        : glueCommand('moveColumns', { sheet, col: at + 1, count: 1, delta })
    const start = out.length
    const keep = new Set(now)
    const had = new Set(old)
    const cur = [...old]
    for (let i = cur.length - 1; i >= 0; i--) {
      if (keep.has(cur[i]!)) continue
      let j = i
      while (j > 0 && !keep.has(cur[j - 1]!)) j--
      out.push(del(j, i - j + 1))
      cur.splice(j, i - j + 1)
      i = j
    }
    const target = now.filter((id) => had.has(id))
    for (let i = 0; i < target.length; i++) {
      if (cur[i] === target[i]) continue
      const j = cur.indexOf(target[i]!, i)
      out.push(move(j, i - j))
      cur.splice(i, 0, ...cur.splice(j, 1))
    }
    for (let i = 0; i < now.length && i < cur.length; i++) {
      if (cur[i] === now[i]) continue
      let n = 1
      while (i + n < now.length && !had.has(now[i + n]!)) n++
      out.push(ins(i, n))
      cur.splice(i, 0, ...now.slice(i, i + n))
      i += n - 1
    }
    return out.length > start
  }

  // ---- lifecycle ----

  async function settled(): Promise<void> {
    await chain
    await client.idle()
  }

  function onRemote(cb: (change: RemoteChange) => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function stop(): void {
    stopped = true
    doc.off('afterTransaction', onAfterTransaction)
    listeners.clear()
  }

  doc.on('afterTransaction', onAfterTransaction)

  return {
    localOrigin,
    remoteOrigin,
    load,
    dispatch,
    localOnly,
    commit,
    receive,
    settled,
    onRemote,
    stop,
  }
}
