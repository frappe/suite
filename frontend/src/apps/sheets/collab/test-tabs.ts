// Test kit: editor-less tabs, each a real IronCalc (through a fake worker
// port, as in core/client.test.js) plus real side stores plus a Y.Doc, glued
// with createGlue. Tabs swap Y updates directly, only when a test calls
// sync(), so anything done between two syncs is concurrent.
//
// Imported by tests only.

import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import * as Y from 'yjs'

import { createWorkbookClient, type WorkbookClient } from '../core/client'
import { createWorkerHost } from '../core/worker'
import { createChartEngine } from '../engine/charts'
import { createCommentsEngine } from '../engine/comments'
import { createCondFormatEngine } from '../engine/cond-format'
import { createFormatsEngine } from '../engine/formats'
import { createMergeEngine } from '../engine/merge'
import { createNamedRanges } from '../engine/named-ranges'
import { createPivotEngine } from '../engine/pivot'
import { createProtectionEngine } from '../engine/protection'
import { createSlicerEngine } from '../engine/slicers'
import { createValidationEngine } from '../engine/validation'
import { cellId, parseCellId } from '../utils/cells'
import { createGlue, type Glue } from './glue'
import { axis, parseCellKey, roots } from './schema'
import { docSheets, storeEntries } from './stores'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

function fakePort() {
  const host = createWorkerHost()
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(message: unknown) {
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
  }
  return port
}

export function makeStores() {
  let view: Record<string, unknown> = {}
  return {
    formats: createFormatsEngine(),
    comments: createCommentsEngine(),
    validation: createValidationEngine(),
    merge: createMergeEngine(),
    protection: createProtectionEngine(),
    view: {
      snapshot: () => structuredClone(view),
      restore: (v: Record<string, unknown>) => (view = v),
    },
    condFormat: createCondFormatEngine(),
    slicers: createSlicerEngine(),
    charts: createChartEngine(),
    pivot: createPivotEngine(),
    namedRanges: createNamedRanges(),
  }
}

export type Stores = ReturnType<typeof makeStores>

export interface Tab {
  name: string
  doc: Y.Doc
  client: WorkbookClient
  stores: Stores
  glue: Glue
  /** Updates this tab made that the others haven't received yet. */
  outbox: Uint8Array[]
}

let seq = 0
export function cmd(type: string, payload: object) {
  return { id: `t${seq++}`, actor: 'test', ts: seq, type, payload }
}

/** A new, empty IronCalc workbook. */
export function newClient(): Promise<WorkbookClient> {
  return createWorkbookClient({ port: fakePort() })
}

/** A tab. Given a doc, it opens that doc's current state; else it starts a new sheet. */
export async function openTab(name: string, from?: Y.Doc): Promise<Tab> {
  const doc = new Y.Doc()
  if (from) Y.applyUpdate(doc, Y.encodeStateAsUpdate(from))
  const client = await newClient()
  const stores = makeStores()
  const glue = createGlue({ doc, client, stores })
  await glue.load()
  const outbox: Uint8Array[] = []
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== glue.remoteOrigin) outbox.push(update)
  })
  return { name, doc, client, stores, glue, outbox }
}

/** Two tabs on one new sheet. */
export async function twoTabs(): Promise<[Tab, Tab]> {
  const a = await openTab('A')
  const b = await openTab('B', a.doc)
  return [a, b]
}

/** Deliver every waiting update to every other tab, until none is left. */
export async function sync(...tabs: Tab[]): Promise<void> {
  for (let round = 0; round < 10; round++) {
    let sent = 0
    for (const t of tabs) {
      const msgs = t.outbox.splice(0)
      sent += msgs.length
      for (const other of tabs) if (other !== t) for (const m of msgs) other.glue.receive(m)
    }
    await Promise.all(tabs.map((t) => t.glue.settled()))
    if (!sent) return
  }
  throw new Error('tabs did not settle')
}

/** Type into a cell (A1 notation) and commit, as one user action. */
export async function type(t: Tab, sheet: string, a1: string, input: string): Promise<void> {
  const p = parseCellId(a1)!
  t.glue.dispatch(cmd('setInput', { sheet, row: p.row + 1, col: p.col + 1, input }))
  await t.glue.commit()
}

/** Every cell's input, as { 'Sheet!A1': input }, read from the tab's IronCalc. */
export async function inputs(t: Tab): Promise<Record<string, string>> {
  return readAll(t, 'input')
}

/** Every cell's shown value, as { 'Sheet!A1': display }. */
export async function displays(t: Tab): Promise<Record<string, string>> {
  return readAll(t, 'display')
}

async function readAll(t: Tab, what: 'input' | 'display'): Promise<Record<string, string>> {
  await t.client.idle()
  const out: Record<string, string> = {}
  for (const sheet of t.client.sheets) {
    const { cells: flat } = await t.client.usedCells({ sheet })
    const cells = []
    for (let i = 0; i < flat.length; i += 2) cells.push({ row: flat[i]!, col: flat[i + 1]! })
    if (!cells.length) continue
    const res = await t.client.readCells({ sheet, cells, what: [what] })
    for (const c of res.cells) out[`${sheet}!${cellId(c.row - 1, c.col - 1)}`] = c[what] ?? ''
  }
  return out
}

/** Every input as the tab's doc says it, as { 'Sheet!A1': input }: what its IronCalc must hold. */
export function docInputs(t: Tab): Record<string, string> {
  const out: Record<string, string> = {}
  const nameOf = new Map(docSheets(t.doc).map((s) => [s.id, s.name]))
  for (const [key, input] of roots(t.doc).inputs.entries()) {
    const k = parseCellKey(key)
    const sheet = k && nameOf.get(k.sheetId)
    if (!k || sheet === undefined || !input) continue
    const row = axis(t.doc, k.sheetId, 'rows').posOf(k.rowId)
    const col = axis(t.doc, k.sheetId, 'cols').posOf(k.colId)
    if (row >= 0 && col >= 0) out[`${sheet}!${cellId(row, col)}`] = input
  }
  return out
}

/** The side stores as sorted JSON entries: two tabs that converged print the same. */
export function storeState(t: Tab): string[] {
  return storeEntries(t.stores)
    .map((e) => JSON.stringify(e))
    .sort()
}
