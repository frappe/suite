import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createWorkbookClient, type WorkbookClient } from '../../core/client'
import { ENGINE_VERSION } from '../../core/snapshot-codec'
import { createWorkerHost } from '../../core/worker'
import { createNamedRanges } from '../../engine/named-ranges.js'
import { usePersistence } from './usePersistence.js'

const nodeRequire = createRequire(import.meta.url)

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

interface SheetServer {
  calls: Array<{ method: string; args: Record<string, unknown>; context?: unknown }>
  answer(method: string): unknown
}
const server = vi.hoisted(() => {
  const state: SheetServer = {
    calls: fromPartial<Array<{ method: string; args: Record<string, unknown>; context?: unknown }>>(
      [],
    ),
    answer: (_method: string) => ({}),
  }
  return state
})

vi.mock('@/api', async () => {
  const { api: sheetsAPI } = await import('@/apps/sheets/client/generated')
  const send = async (
    reference: { path: string },
    args: Record<string, unknown>,
    options: { context?: unknown } = {},
  ) => {
    const method = reference.path.replace('/api/method/', '')
    server.calls.push({ method, args, context: options.context })
    const answer = server.answer(method)
    if (answer instanceof Error) throw answer
    return answer
  }
  return {
    api: { sheets: sheetsAPI },
    client: { query: send, mutation: send },
  }
})
vi.mock('../../utils/compress.js', () => ({
  isDecompressionSupported: () => false,
  decodeFromDownload: async (value: string) => value,
}))

const WORKBOOK = new Uint8Array([1, 2, 3])
const started: Array<Uint8Array | null> = []

function persistence(options: Record<string, unknown> = {}) {
  const engine = {
    start: async (bytes: Uint8Array | null) => {
      started.push(bytes)
    },
    toBytes: async () => WORKBOOK,
  }
  const formats = { restore: () => {}, snapshot: () => ({}) }
  return usePersistence({
    engine,
    formats,
    currentTitle: ref('Budget'),
    ...options,
  })
}

// Every call that isn't the one read: loading the old body never writes.
const writes = () => server.calls.filter((call) => call.method !== 'suite.sheets.api.get_sheet')

beforeEach(() => {
  started.length = 0
  server.calls = []
  server.answer = (method) =>
    method === 'suite.sheets.api.get_sheet'
      ? {
          name: 'sheet-1',
          title: 'Budget',
          can_write: true,
          sheets_data: '{}',
          owner: 'a@example.com',
          node: 'node-1',
        }
      : { name: 'sheet-1' }
})

describe('Sheets old body', () => {
  // The /d/ surface's Drive session records the visit.
  it('only reads the sheet: it records no Drive visit', async () => {
    await persistence().loadSheet('sheet-1')
    expect(server.calls.map((call) => call.method)).toEqual(['suite.sheets.api.get_sheet'])
  })

  it('keeps the whole workbook as JSON for a recovery copy', async () => {
    const workbook = JSON.parse(await persistence().workbookJson())
    expect(workbook).toMatchObject({
      formats: {},
      merge: null,
      view: null,
      engine_version: ENGINE_VERSION,
    })
    expect(workbook.engine).toBe(btoa('\x01\x02\x03'))
  })

  it('starts IronCalc from the saved workbook, or empty for an older save', async () => {
    server.answer = () => ({
      name: 's',
      title: 'T',
      sheets_data: JSON.stringify({ engine: btoa('\x07') }),
    })
    await persistence().loadSheet('s')
    server.answer = () => ({ name: 's', title: 'T', sheets_data: JSON.stringify({ sheet: {} }) })
    await persistence().loadSheet('s')
    expect(started).toEqual([new Uint8Array([7]), null])
  })

  // IronCalc starts before the names are restored, and its saved names can be
  // out of date (ISSUES #74: a name whose cells were deleted).
  it('sends IronCalc the saved names once they are restored', async () => {
    const order: string[] = []
    const entries = { REVENUE: { name: 'Revenue', sheet: 'Sheet1', range: 'A1:A9' } }
    server.answer = () => ({
      name: 's',
      title: 'T',
      sheets_data: JSON.stringify({ engine: btoa('\x07'), namedRanges: { entries } }),
    })
    await persistence({
      engine: {
        start: async () => {},
        toBytes: async () => WORKBOOK,
        syncDefinedNames: () => order.push('sync'),
      },
      namedRanges: { restore: () => order.push('restore'), snapshot: () => ({}) },
    }).loadSheet('s')
    expect(order).toEqual(['restore', 'sync'])
  })

  // Saved before ISSUES #77: a name still points at a sheet the file no longer
  // has. It is #REF! as if that sheet were deleted now, so a sheet added later
  // under the same name (often the default "Sheet2") doesn't revive it.
  it('loads a name on a missing sheet as #REF!, before the names are sent', async () => {
    const entries = {
      REVENUE: { name: 'Revenue', sheet: 'Sheet1', range: 'A1:A9' },
      FAR: { name: 'far', sheet: 'Sheet2', range: 'A1' },
    }
    server.answer = () => ({
      name: 's',
      title: 'T',
      sheets_data: JSON.stringify({ engine: btoa('\x07'), namedRanges: { entries } }),
    })
    const namedRanges = createNamedRanges()
    const sent: string[][] = []
    await persistence({
      engine: {
        start: async () => {},
        toBytes: async () => WORKBOOK,
        client: () => ({ sheets: ['sheet1'] }),
        syncDefinedNames: () => sent.push(namedRanges.list().map((e) => `${e.name} ${e.range}`)),
      },
      namedRanges,
    }).loadSheet('s')
    expect(sent.at(-1)).toEqual(['Revenue A1:A9', 'far #REF!'])
  })

  it('names both IronCalc versions when a body saved by another one does not open', async () => {
    const failing = (version?: string) => {
      server.answer = () => ({
        name: 's',
        title: 'T',
        sheets_data: JSON.stringify({ engine: btoa('\x07'), engine_version: version }),
      })
      return persistence({
        engine: {
          start: async () => {
            throw new Error('Error parsing workbook: bitcode error')
          },
        },
      })
    }

    const older = failing('0.8.4')
    await older.loadSheet('s')
    expect(older.loadError.value).toEqual({
      kind: 'other',
      message: expect.stringContaining(
        `saved by IronCalc 0.8.4, which this Sheets (IronCalc ${ENGINE_VERSION}) cannot read`,
      ),
    })

    // Same version: the body itself is damaged; say what IronCalc said.
    const same = failing(ENGINE_VERSION)
    await same.loadSheet('s')
    expect(same.loadError.value).toEqual({
      kind: 'other',
      message: 'Error parsing workbook: bitcode error',
    })
  })

  it("loads through the caller's fetch, so link credentials ride along, and sends nothing back", async () => {
    const requestContext = vi.fn()
    const loaded = persistence({ requestContext })
    await loaded.loadSheet('sheet-1')
    await loaded.workbookJson()

    expect(server.calls.map((call) => [call.method, call.context])).toEqual([
      ['suite.sheets.api.get_sheet', requestContext],
    ])
    expect(loaded).not.toHaveProperty('saveExisting')
  })

  it('puts a cell edit still in progress into the recovery copy', async () => {
    const draft = { sheet: 'Sheet1', cell: 'B2', value: 'typing' }
    const workbook = JSON.parse(await persistence().workbookJson(draft))
    expect(workbook.draft).toEqual(draft)
  })
})

// A sheet last saved by the develop editor: its cells in `sheet` (the packed
// shape from utils/sheet-codec.ts), no IronCalc `engine`.
const DEVELOP_BODY = {
  sheet: {
    v: 2,
    current: 'Notes',
    sheets: {
      Budget: { rows: { '0': ['Rent', '1200'], '1': ['Total', '=SUM(B1:B1)', '=OLDFN(B1)'] } },
      Notes: { rows: { '0': ['see Budget'] } },
    },
  },
  formats: { Budget: { B1: { bold: true } } },
  view: { Budget: { colW: { 0: 140 } } },
}

function developSheet(overrides: Record<string, unknown> = {}) {
  return {
    name: 'old-1',
    title: 'From develop',
    can_write: true,
    owner: 'a@example.com',
    node: 'node-old',
    sheets_data: JSON.stringify(DEVELOP_BODY),
    ...overrides,
  }
}

// Runs the real IronCalc host in-process, as core/client.test.js does.
function fakePort() {
  const host = createWorkerHost()
  const port = {
    onmessage: fromPartial<((e: { data: unknown }) => void) | null>(null),
    postMessage(message: unknown) {
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
  }
  return port
}

function realEngine() {
  let client: WorkbookClient | null = null
  return {
    start: async (bytes: Uint8Array | null) => {
      started.push(bytes)
      client = await createWorkbookClient({ port: fakePort(), snapshotBytes: bytes })
    },
    toBytes: async () => WORKBOOK,
    client: () => client,
    syncDefinedNames: vi.fn(),
  }
}

describe('Sheets old body: a develop sheet', () => {
  initSync({ module: fs.readFileSync(nodeRequire.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

  function answerWith(doc: Record<string, unknown>) {
    server.answer = () => doc
  }

  it('converts its cells into IronCalc in memory, and opens on the tab it had open', async () => {
    answerWith(developSheet())
    const engine = realEngine()
    const saved = persistence({ engine })
    await saved.loadSheet('old-1')

    expect(started).toEqual([null])
    expect(engine.client()?.sheets).toEqual(['Budget', 'Notes'])
    const cells = await engine.client()!.readCells({
      sheet: 'Budget',
      cells: [{ row: 2, col: 2 }],
      what: ['display'],
    })
    expect(cells.cells[0]?.display).toBe('1200')
    expect(engine.syncDefinedNames).toHaveBeenCalled()
    expect(saved.legacyCurrent.value).toBe('Notes')
    expect(writes()).toEqual([])
  })

  it('still says nothing back when IronCalc refuses the conversion', async () => {
    answerWith(developSheet())
    const engine = {
      ...realEngine(),
      client: () => ({
        dispatch: () => {
          throw new Error('invalid batch command')
        },
        idle: async () => {},
        onCommandError: () => () => {},
      }),
    }
    const saved = persistence({ engine })
    await saved.loadSheet('old-1')

    expect(saved.loadError.value).toBeNull()
    expect(writes()).toEqual([])
  })

  it('carries renamed sheets into the side stores and the saved view', async () => {
    const body = {
      sheet: { sheets: { 'Q1/Q2': { A1: '5' } } },
      view: { 'Q1/Q2': { colW: { 0: 90 } } },
      namedRanges: { entries: { REV: { name: 'Rev', sheet: 'Q1/Q2', range: 'A1' } } },
    }
    answerWith(developSheet({ sheets_data: JSON.stringify(body) }))
    const formats = { restore: () => {}, snapshot: () => ({}), renameSheet: vi.fn() }
    const charts = { restore: () => {}, renameSheet: vi.fn() }
    const namedRanges = createNamedRanges()
    const applyViewState = vi.fn()
    const saved = persistence({
      engine: realEngine(),
      formats,
      charts,
      namedRanges,
      applyViewState,
    })
    await saved.loadSheet('old-1')

    expect(formats.renameSheet).toHaveBeenCalledWith('Q1/Q2', 'Q1_Q2')
    expect(charts.renameSheet).toHaveBeenCalledWith('Q1/Q2', 'Q1_Q2')
    // Renamed before names on missing sheets turn #REF! (ISSUES #77).
    expect(namedRanges.get('Rev')).toEqual({ name: 'Rev', sheet: 'Q1_Q2', range: 'A1' })
    expect(applyViewState).toHaveBeenCalledWith({ Q1_Q2: { colW: { 0: 90 } } })
  })

  it('leaves develop comments to Drive once Drive owns the sheet', async () => {
    // The Drive migration turned sheets_data.comments into Drive threads and
    // stripped the live body, but an old version restored later still carries
    // them. Restoring them here would show every comment twice.
    const thread = { G2: { resolved: false, thread: [{ text: 'hi' }] } }
    const body = { sheet: { sheets: { Sheet1: { A1: '1' } } }, comments: { Sheet1: thread } }
    const comments = { restore: vi.fn() }

    answerWith(developSheet({ sheets_data: JSON.stringify(body) }))
    await persistence({ engine: realEngine(), comments }).loadSheet('old-1')
    expect(comments.restore).not.toHaveBeenCalled()

    // A develop sheet Drive never adopted has nowhere else to keep them.
    answerWith(developSheet({ node: null, sheets_data: JSON.stringify(body) }))
    await persistence({ engine: realEngine(), comments }).loadSheet('old-1')
    expect(comments.restore).toHaveBeenCalledWith({ Sheet1: thread })
  })

  it('treats an IronCalc sheet as already upgraded', async () => {
    answerWith(developSheet({ sheets_data: JSON.stringify({ engine: btoa('\x07') }) }))
    const saved = persistence()
    await saved.loadSheet('old-1')

    expect(saved.legacyCurrent.value).toBeNull()
  })
})
