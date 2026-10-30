import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { WorkbookClient } from '../core/client'
import { bytesToBase64, ENGINE_VERSION } from '../core/snapshot-codec'
import { createFormatsEngine } from '../engine/formats'
import { createMergeEngine } from '../engine/merge'
import { convertSheetsData, inProcessClient, OPEN_KEY } from './conversion'
import { docToHtml } from './html'
import { buildWorkbookFromDoc, glueCommand, readSheetInputs } from './load'
import { ROOT, roots } from './schema'
import { docSheets } from './stores'
import { makeStores } from './test-tabs'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

// Real IronCalc round trips: a few seconds on CI runners.
const TIMEOUT = 30_000
const MAX_STATE = 4 * 1024 * 1024

// `sheets_data` as today's editor saves it (usePersistence._workbookJson):
// IronCalc's bytes plus each side store's snapshot.
async function currentBody(): Promise<string> {
  const client = await inProcessClient(null)
  client.dispatch(glueCommand('renameSheet', { sheet: 'Sheet1', name: 'Budget' }))
  client.dispatch(glueCommand('addSheet', { name: 'Notes' }))
  for (const [row, col, input] of [
    [1, 1, 'Rent'],
    [1, 2, '1200'],
    [2, 1, 'Food'],
    [2, 2, '350.5'],
    [4, 2, '=SUM(B1:B2)'],
  ] as const)
    client.dispatch(glueCommand('setInput', { sheet: 'Budget', row, col, input }))
  client.dispatch(glueCommand('setInput', { sheet: 'Notes', row: 3, col: 3, input: 'see Budget' }))
  await client.idle()
  const formats = createFormatsEngine()
  formats.applyToRange(['B4'], { bold: true }, 'Budget')
  const merge = createMergeEngine()
  merge.merge(0, 0, 0, 1, 'Budget')
  const body = JSON.stringify({
    engine: bytesToBase64(await client.snapshot()),
    engine_version: ENGINE_VERSION,
    formats: formats.snapshot(),
    merge: merge.snapshot(),
    view: { Budget: { colW: { 0: 140 }, zoom: 1.5 } },
    charts: { charts: { c1: { id: 'c1', type: 'bar', sheet: 'Budget', range: 'A1:B2' } } },
  })
  client.terminate()
  return body
}

// `sheets_data` as the develop editor saved it: typed cells only, packed by
// utils/sheet-codec.ts, and side stores in the shapes used today.
const DEVELOP_BODY = JSON.stringify({
  sheet: {
    v: 2,
    current: 'Costs',
    sheets: {
      Budget: {
        rows: { '0': ['Item', 'Amount'], '1': ['Rent', '1200'], '3': [null, '=SUM(B2:B2)'] },
      },
      'Q1/Q2': { rows: { '0': ['=Budget!B4'] } },
    },
  },
  formats: { Budget: { cells: { A1: { bold: true } } } },
  view: { colW: { 0: 90 } },
  comments: { Budget: { A1: [{ id: 'x', text: 'in Drive now' }] } },
})

// A converted doc opened as a tab would: a fresh workbook and stores built from it.
async function opened(state: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  const client: WorkbookClient = await inProcessClient(null)
  const stores = makeStores()
  await buildWorkbookFromDoc(doc, client, stores)
  const cells: Record<string, string> = {}
  for (const sheet of client.sheets)
    for (const c of await readSheetInputs(client, sheet))
      cells[`${sheet}!${c.row}:${c.col}`] = c.input
  const shown = await client.readCells({
    sheet: client.sheets[0]!,
    cells: [{ row: 4, col: 2 }],
    what: ['display'],
  })
  client.terminate()
  return {
    doc,
    sheets: docSheets(doc).map((s) => s.name),
    cells,
    stores,
    shown: shown.cells[0]?.display,
  }
}

async function converted(body: string | null) {
  const answer = await convertSheetsData(body, MAX_STATE)
  if (answer.kind !== 'converted') throw new Error(`refused: ${answer.reason}`)
  return answer
}

describe('convertSheetsData: an old sheet becomes a collab doc', { timeout: TIMEOUT }, () => {
  it('a body today’s editor saved keeps its sheets, inputs and side stores', async () => {
    const answer = await converted(await currentBody())
    const tab = await opened(answer.state)
    expect(tab.sheets).toEqual(['Budget', 'Notes'])
    expect(tab.cells).toEqual({
      'Budget!1:1': 'Rent',
      'Budget!1:2': '1200',
      'Budget!2:1': 'Food',
      'Budget!2:2': '350.5',
      'Budget!4:2': '=SUM(B1:B2)',
      'Notes!3:3': 'see Budget',
    })
    expect(tab.shown).toBe('1550.5')
    expect(tab.stores.formats.snapshot().Budget?.cells?.B4).toEqual({ bold: true })
    expect(tab.stores.merge.getMasterInfo('A1', 'Budget')).toMatchObject({ rowSpan: 1, colSpan: 2 })
    expect(Object.keys(tab.stores.charts.snapshot().charts)).toEqual(['c1'])
    expect(answer.dropped).toEqual([])
  })

  it('stores what was typed, never results, and keeps zoom out of the shared view', async () => {
    const answer = await converted(await currentBody())
    const tab = await opened(answer.state)
    expect([...roots(tab.doc).inputs.values()]).not.toContain('1550.5')
    const views = [...roots(tab.doc).sheetState.entries()].filter(([k]) => k.endsWith(':view'))
    expect(views.map(([, v]) => v)).toEqual([{ colW: { 0: 140 } }])
  })

  it('a develop body is typed in as the browser upgrade does, with renamed sheets reported', async () => {
    const answer = await converted(DEVELOP_BODY)
    const tab = await opened(answer.state)
    expect(tab.sheets).toEqual(['Budget', 'Q1_Q2'])
    expect(tab.cells).toEqual({
      'Budget!1:1': 'Item',
      'Budget!1:2': 'Amount',
      'Budget!2:1': 'Rent',
      'Budget!2:2': '1200',
      'Budget!4:2': '=SUM(B2:B2)',
      'Q1_Q2!1:1': '=Budget!B4',
    })
    expect(tab.stores.formats.snapshot().Budget?.cells?.A1).toEqual({ bold: true })
    expect(answer.dropped).toEqual([{ kind: 'renamed-sheet', from: 'Q1/Q2', to: 'Q1_Q2' }])
  })

  it("a develop body's flat view belongs to its first sheet, and its comments stay in Drive", async () => {
    const tab = await opened((await converted(DEVELOP_BODY)).state)
    const views = [...roots(tab.doc).sheetState.values()]
    expect(views).toEqual([{ colW: { 0: 90 } }])
    expect(roots(tab.doc).comments.size).toBe(0)
  })

  it('a sheet never saved becomes one empty sheet', async () => {
    for (const body of [null, '', '{}']) {
      const tab = await opened((await converted(body)).state)
      expect(tab.sheets).toEqual(['Sheet1'])
      expect(tab.cells).toEqual({})
    }
  })

  it('answers the readable copy of the doc it made', async () => {
    const answer = await converted(await currentBody())
    expect(answer.html).toBe(docToHtml((await opened(answer.state)).doc))
    expect(answer.html).toContain('=SUM(B1:B2)')
  })

  it('a view that is not an object is left out, since it holds no data', async () => {
    const tab = await opened((await converted(JSON.stringify({ view: 'x' }))).state)
    expect(tab.sheets).toEqual(['Sheet1'])
    expect(roots(tab.doc).sheetState.size).toBe(0)
  })

  it('drops a defined name the server could not take as a key, and says so', async () => {
    const long = 'N'.repeat(129)
    const body = JSON.stringify({
      namedRanges: {
        entries: {
          RATE: { name: 'Rate', sheet: 'Sheet1', range: 'A1' },
          GRÖSSE: { name: 'Größe', sheet: 'Sheet1', range: 'A2' },
          [long]: { name: long, sheet: 'Sheet1', range: 'A3' },
        },
      },
    })
    const answer = await converted(body)
    const tab = await opened(answer.state)
    expect([...roots(tab.doc).names.keys()]).toEqual(['RATE'])
    expect(answer.dropped).toEqual([
      { kind: 'name-not-a-key', name: 'Größe' },
      { kind: 'name-not-a-key', name: long },
    ])
  })

  it('writes only keys the server takes in the roots keyed at runtime', async () => {
    const { doc } = await opened((await converted(await currentBody())).state)
    for (const name of Object.values(ROOT)) {
      if (name === ROOT.meta || name === ROOT.sheets) continue
      for (const key of doc.getMap(name).keys()) expect(key).toMatch(OPEN_KEY)
    }
  })

  it('refuses a doc bigger than the room allows', async () => {
    expect(await convertSheetsData(await currentBody(), 64)).toEqual({
      kind: 'failed',
      reason: 'too_large',
    })
  })

  it('refuses a body it cannot read, rather than converting it to an empty sheet', async () => {
    const unreadable = [
      'not json',
      JSON.stringify({ _z: 'gzip', data: 'H4sI' }),
      JSON.stringify({ engine: bytesToBase64(new Uint8Array([1, 2, 3])) }),
      JSON.stringify({ sheet: 'nope', formats: {} }),
      JSON.stringify({ protection: { Sheet1: { ranges: 5 } } }),
      JSON.stringify({ pivot: { pivots: { p: null } } }),
    ]
    for (const body of unreadable)
      expect(await convertSheetsData(body, MAX_STATE), body).toEqual({
        kind: 'failed',
        reason: 'check',
      })
  })
})
