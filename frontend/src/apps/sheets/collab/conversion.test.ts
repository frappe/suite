import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initSync } from '@ironcalc/wasm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import type { WorkbookClient } from '../core/client'
import { bytesToBase64, ENGINE_VERSION } from '../core/snapshot-codec'
import { createCondFormatEngine } from '../engine/cond-format'
import { createFormatsEngine } from '../engine/formats'
import { createMergeEngine } from '../engine/merge'
import { createNamedRanges, definedNameChanges } from '../engine/named-ranges'
import { createSlicerEngine } from '../engine/slicers'
import { parseCellId } from '../utils/cells'
import { applyNumberFmt } from '../utils/format-number'
import { convertSheetsData, inProcessClient, OPEN_KEY } from './conversion'
import { docToHtml } from './html'
import { buildWorkbookFromDoc, glueBatch, glueCommand, readSheetInputs } from './load'
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
  formats.setRow(5, { fill: '#eee' }, 'Budget')
  const merge = createMergeEngine()
  merge.merge(0, 0, 0, 1, 'Budget')
  const condFormat = createCondFormatEngine()
  condFormat.addRule(
    { range: 'B1:B2', type: 'greaterThan', value: 500, format: {} } as never,
    'Budget',
  )
  const slicers = createSlicerEngine()
  slicers.add(0, 0, 0, 'Budget')
  const namedRanges = createNamedRanges()
  namedRanges.add({ name: 'Rent_Total', sheet: 'Budget', range: 'B1:B2' })
  const body = JSON.stringify({
    engine: bytesToBase64(await client.snapshot()),
    engine_version: ENGINE_VERSION,
    formats: formats.snapshot(),
    merge: merge.snapshot(),
    condFormat: condFormat.snapshot(),
    slicers: slicers.snapshot(),
    namedRanges: namedRanges.snapshot(),
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
    for (const name of [
      'formats',
      'rowFormats',
      'condFormats',
      'slicers',
      'names',
      'charts',
      'sheetState',
    ])
      expect(doc.getMap(name).size, name).toBeGreaterThan(0)
  })

  it("leaves a pivot's output out of the doc: each tab rebuilds it", async () => {
    const client = await inProcessClient(null)
    client.dispatch(glueCommand('addSheet', { name: 'Data' }))
    for (const [row, col, input] of [
      [1, 1, 'Region'],
      [1, 2, 'Sales'],
      [2, 1, 'North'],
      [2, 2, '10'],
      [3, 1, 'South'],
      [3, 2, '5'],
    ] as const)
      client.dispatch(glueCommand('setInput', { sheet: 'Data', row, col, input }))
    // The output the old editor wrote, at C2, and a note of the person's beside it.
    for (const [row, col, input] of [
      [2, 3, 'Region'],
      [2, 4, 'Sum of Sales'],
      [3, 3, 'North'],
      [3, 4, '10'],
      [4, 3, 'South'],
      [4, 4, '5'],
      [5, 3, 'Grand Total'],
      [5, 4, '15'],
      [1, 1, 'my note'],
      // The person's own cells touching the table: right of its header, under Grand Total.
      [2, 5, 'Target'],
      [6, 3, 'checked'],
    ] as const)
      client.dispatch(glueCommand('setInput', { sheet: 'Sheet1', row, col, input }))
    await client.idle()
    const formats = createFormatsEngine()
    formats.applyToRange(['C2', 'D2', 'C5', 'D5'], { bold: true }, 'Sheet1')
    formats.applyToRange(['A1'], { italic: true }, 'Sheet1')
    const pivot = {
      id: 'pivot_p1',
      sourceSheet: 'Data',
      // Whole columns: the pivot reads only as far as the sheet holds data.
      sourceRange: 'A1:Z1048576',
      outputSheet: 'Sheet1',
      anchorRow: 1,
      anchorCol: 2,
      rows: ['Region'],
      cols: [],
      values: [{ field: 'Sales', agg: 'sum' }],
    }
    const body = JSON.stringify({
      engine: bytesToBase64(await client.snapshot()),
      engine_version: ENGINE_VERSION,
      formats: formats.snapshot(),
      pivot: { pivots: { pivot_p1: pivot } },
    })
    client.terminate()

    const tab = await opened((await converted(body)).state)
    expect(Object.keys(tab.cells).filter((k) => k.startsWith('Sheet1!'))).toEqual([
      'Sheet1!1:1',
      'Sheet1!2:5',
      'Sheet1!6:3',
    ])
    expect(tab.stores.formats.snapshot().Sheet1?.cells).toEqual({ A1: { italic: true } })
    expect(Object.keys(tab.stores.pivot.snapshot().pivots)).toEqual(['pivot_p1'])
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

// Bodies saved before this editor, frozen in core/ironcalc-gate/. The develop
// one was made by develop's own editor code (origin/develop f3f31d63a:
// sheet-codec packSheet and the formats, merge and named-ranges engines), in
// the shape its usePersistence saved. Develop never ran IronCalc, so its
// bodies hold no IronCalc bytes and IronCalc's version cannot matter to them.
const SAVED = path.join(path.dirname(fileURLToPath(import.meta.url)), '../core/ironcalc-gate')
const savedBody = (name: string) => fs.readFileSync(path.join(SAVED, name), 'utf8')

describe('convertSheetsData: a body saved before IronCalc 0.9.0', { timeout: TIMEOUT }, () => {
  // A tab on the converted doc, with the defined names sent as the editor sends them.
  async function shown(state: Uint8Array) {
    const tab = await opened(state)
    const client = await inProcessClient(null)
    const stores = makeStores()
    await buildWorkbookFromDoc(tab.doc, client, stores)
    const { changes } = definedNameChanges(new Map(), stores.namedRanges.list(), client.sheets)
    client.dispatch(glueBatch(changes.map((c) => glueCommand(c.type, c.payload))))
    const read = async (sheet: string, a1: string[]) => {
      const cells = a1.map((id) => {
        const { row, col } = parseCellId(id)!
        return { row: row + 1, col: col + 1 }
      })
      const res = await client.readCells({ sheet, cells, what: ['display'] })
      return res.cells.map((c, i) => {
        const format = stores.formats.get(a1[i]!, sheet).numberFormat
        return format ? applyNumberFmt(c.display, format) : c.display
      })
    }
    const out = {
      budget: await read('Budget', ['B2', 'B3', 'B4', 'C2', 'C3']),
      summary: await read('Summary', ['B1', 'B2', 'B3']),
    }
    client.terminate()
    return { ...tab, shown: out }
  }

  it('a develop body keeps its cells, formulas, names, formats, merges and view', async () => {
    const answer = await converted(savedBody('saved-body-develop.json'))
    const tab = await shown(answer.state)
    expect(answer.dropped).toEqual([])
    expect(tab.sheets).toEqual(['Budget', 'Summary'])
    expect(tab.cells).toEqual({
      'Budget!1:1': 'Item',
      'Budget!1:2': 'Amount',
      'Budget!1:3': 'Share',
      'Budget!2:1': 'Rent',
      'Budget!2:2': '1200',
      'Budget!2:3': '=B2/B$4',
      'Budget!3:1': 'Food',
      'Budget!3:2': '350.5',
      'Budget!3:3': '=B3/B$4',
      'Budget!4:1': 'Total',
      'Budget!4:2': '=SUM(B2:B3)',
      'Budget!6:1': 'Paid on the 1st of each month',
      'Summary!1:1': 'Total ×2',
      'Summary!1:2': '=Budget!B4*2',
      'Summary!2:1': 'Costs',
      'Summary!2:2': '=SUM(Costs)',
      'Summary!3:1': 'Code',
      'Summary!3:2': "'007",
    })
    // What develop's own renderer showed for these cells.
    expect(tab.shown).toEqual({
      budget: ['$1,200.00', '$350.50', '$1,550.50', '77.4%', '22.6%'],
      summary: ['3101', '1550.5', '007'],
    })
    const formats = tab.stores.formats
    expect(formats.get('A1', 'Budget')).toEqual({ bold: true, backgroundColor: '#FFEE00' })
    expect(formats.get('A4', 'Budget')).toEqual({ italic: true, color: '#1F6FEB', align: 'right' })
    expect(tab.stores.merge.getMasterInfo('A6', 'Budget')).toMatchObject({ rowSpan: 1, colSpan: 3 })
    expect(tab.stores.namedRanges.list()).toEqual([
      { name: 'Costs', sheet: 'Budget', range: 'B2:B3' },
    ])
    const views = [...roots(tab.doc).sheetState.entries()].filter(([k]) => k.endsWith(':view'))
    expect(views.map(([, v]) => v)).toEqual([
      expect.objectContaining({ colW: { 0: 160 }, rowH: { 5: 36 }, freezeRows: 1 }),
    ])
  })

  it('a body saved by IronCalc 0.8.4 is refused, never converted to an empty sheet', async () => {
    // 0.9.0 cannot read 0.8.4's bytes ("bitcode error"). Only this branch's
    // editor saved them, before it moved to 0.9.0; the sheet keeps its body
    // and opens on the error screen that names both versions.
    const body = JSON.parse(savedBody('saved-body-0.8.4.json')) as { engine_version: string }
    expect(body.engine_version).toBe('0.8.4')
    expect(await convertSheetsData(JSON.stringify(body), MAX_STATE)).toEqual({
      kind: 'failed',
      reason: 'check',
    })
  })
})
