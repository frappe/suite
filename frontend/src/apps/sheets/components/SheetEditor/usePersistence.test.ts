import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createWorkbookClient, type WorkbookClient } from '../../core/client'
import { createWorkerHost } from '../../core/worker'
import { usePersistence } from './usePersistence.js'

const nodeRequire = createRequire(import.meta.url)

const server = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: Record<string, unknown>; context?: unknown }>,
  answer: (_method: string): unknown => ({}),
  visits: [] as string[],
}))

vi.mock('@/api', async () => {
  const { api: sheetsAPI } = await import('@/apps/sheets/client/generated')
  // The one Drive call persistence makes, keyed by its route like the rest.
  const driveAPI = { versions: { create: { path: 'nodes/{node}/versions' } } }
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
    api: { sheets: sheetsAPI, drive: driveAPI },
    client: { query: send, mutation: send },
  }
})
vi.mock('./driveVisit', () => ({
  recordVisit: async (node: string) => {
    server.visits.push(node)
  },
}))
vi.mock('../../utils/compress.js', () => ({
  isDecompressionSupported: () => false,
  decodeFromDownload: async (value: string) => value,
  encodeForUpload: async (value: string) => value,
}))

function refusal(): Error {
  return Object.assign(new Error('Not permitted'), { type: 'PermissionError', status: 403 })
}

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
    emit: () => {},
    ...options,
  })
}

const saves = () => server.calls.filter((call) => call.method === 'suite.sheets.api.save_sheet')

beforeEach(() => {
  started.length = 0
  server.calls = []
  server.visits = []
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

describe('Sheets persistence', () => {
  it("records a Drive visit on the sheet's node, and none for a legacy sheet or when the caller records it", async () => {
    await persistence().loadSheet('sheet-1')
    await persistence({ recordVisits: false }).loadSheet('sheet-1')
    server.answer = () => ({ name: 'sheet-2', title: 'Old', sheets_data: '{}', node: null })
    await persistence().loadSheet('sheet-2')

    expect(server.visits).toEqual(['node-1'])
    expect(server.calls.map((call) => call.method)).not.toContain(
      'suite.drive.api.files.track_visit',
    )
  })

  it('sends nothing while the editor may not write, and says the change is not saved', async () => {
    const saved = persistence({ isWritable: () => false })
    await expect(saved.saveExisting('sheet-1', 'Budget')).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(saves()).toEqual([])
    expect(saved.saveError.value).toMatch(/not saved/i)
  })

  it('reports a refused save once and does not retry it', async () => {
    server.answer = () => refusal()
    const onRefused = vi.fn()
    const saved = persistence({ onRefused })

    await expect(saved.saveExisting('sheet-1', 'Budget')).rejects.toBeInstanceOf(Error)

    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(saves()).toHaveLength(1)
    expect(saved.saveError.value).toContain('Not permitted')
  })

  it('keeps the whole workbook as JSON for a recovery copy', async () => {
    const workbook = JSON.parse(await persistence().workbookJson())
    expect(workbook).toMatchObject({
      formats: {},
      merge: null,
      view: null,
      engine_version: '0.8.4',
    })
    expect(workbook.engine).toBe(btoa('\x01\x02\x03'))
  })

  it('saves the IronCalc workbook in sheets_data', async () => {
    await persistence().saveExisting('sheet-1', 'Budget')
    const sent = JSON.parse(saves()[0]!.args.sheets_data as string)
    expect(sent.engine).toBe(btoa('\x01\x02\x03'))
    expect(sent.sheet).toBeUndefined()
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

  it("loads and saves through the caller's fetch, so link credentials ride along", async () => {
    const requestContext = vi.fn()
    const saved = persistence({ requestContext })
    await saved.loadSheet('sheet-1')
    await saved.saveExisting('sheet-1', 'Budget')

    expect(server.calls.map((call) => [call.method, call.context])).toEqual([
      ['suite.sheets.api.get_sheet', requestContext],
      ['suite.sheets.api.save_sheet', requestContext],
    ])
  })

  it('treats Drive hiding the sheet as a refusal, not a network blip', async () => {
    server.answer = () =>
      Object.assign(new Error('Not found'), { type: 'DriveNotFound', status: 404 })
    const onRefused = vi.fn()
    await expect(
      persistence({ onRefused }).saveExisting('sheet-1', 'Budget'),
    ).rejects.toMatchObject({ type: 'DriveNotFound' })

    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(saves()).toHaveLength(1)
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
    onmessage: null as ((e: { data: unknown }) => void) | null,
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

const versionCalls = () => server.calls.filter((call) => call.method === 'nodes/{node}/versions')

describe('Sheets persistence: opening a develop sheet', () => {
  initSync({ module: fs.readFileSync(nodeRequire.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

  function answerWith(doc: Record<string, unknown>, onVersion: () => unknown = () => ({})) {
    server.answer = (method) =>
      method === 'suite.sheets.api.get_sheet'
        ? doc
        : method === 'nodes/{node}/versions'
          ? onVersion()
          : { name: doc.name }
  }

  it('converts its cells into IronCalc and lists the formulas IronCalc does not know', async () => {
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
    expect(saved.legacyUpgrade.value).toMatchObject({
      ok: true,
      save: true,
      current: 'Notes',
      unknown: [{ sheet: 'Budget', cell: 'C2', formula: '=OLDFN(B1)' }],
    })
  })

  it('keeps a "Before upgrade" Drive version before the first save, and only then', async () => {
    answerWith(developSheet())
    const saved = persistence({ engine: realEngine() })
    await saved.loadSheet('old-1')
    expect(versionCalls()).toEqual([])

    await saved.saveExisting('old-1', 'From develop')
    await saved.saveExisting('old-1', 'From develop')

    expect(server.calls.map((call) => call.method)).toEqual([
      'suite.sheets.api.get_sheet',
      'nodes/{node}/versions',
      'suite.sheets.api.save_sheet',
      'suite.sheets.api.save_sheet',
    ])
    expect(versionCalls()[0]?.args).toEqual({
      node: 'node-old',
      kind: 'named',
      label: 'Before upgrade',
    })
  })

  it('sends no save while that version could not be kept, and keeps trying it', async () => {
    let versionFails = true
    answerWith(developSheet(), () =>
      versionFails ? Object.assign(new Error('Drive is full'), { status: 507 }) : {},
    )
    const saved = persistence({ engine: realEngine() })
    await saved.loadSheet('old-1')

    await expect(saved.saveExisting('old-1', 'From develop')).rejects.toThrow('Drive is full')
    expect(saves()).toEqual([])
    expect(saved.saveError.value).toMatch(/before upgrad/i)

    versionFails = false
    await saved.retrySave()
    expect(versionCalls()).toHaveLength(2)
    expect(saves()).toHaveLength(1)
  })

  it('converts in memory only for a viewer', async () => {
    answerWith(developSheet({ can_write: false }))
    const saved = persistence({ engine: realEngine() })
    await saved.loadSheet('old-1')

    expect(saved.canWrite.value).toBe(false)
    expect(saved.legacyUpgrade.value).toMatchObject({ ok: true, save: false })
  })

  it('opens read-only when IronCalc refuses the conversion, so the old body is never overwritten', async () => {
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

    expect(saved.legacyUpgrade.value).toMatchObject({ ok: false, save: false })
    expect(saved.canWrite.value).toBe(false)
  })

  it('carries renamed sheets into the side stores and the saved view', async () => {
    const body = {
      sheet: { sheets: { 'Q1/Q2': { A1: '5' } } },
      view: { 'Q1/Q2': { colW: { 0: 90 } } },
    }
    answerWith(developSheet({ sheets_data: JSON.stringify(body) }))
    const formats = { restore: () => {}, snapshot: () => ({}), renameSheet: vi.fn() }
    const charts = { restore: () => {}, renameSheet: vi.fn() }
    const applyViewState = vi.fn()
    const saved = persistence({ engine: realEngine(), formats, charts, applyViewState })
    await saved.loadSheet('old-1')

    expect(formats.renameSheet).toHaveBeenCalledWith('Q1/Q2', 'Q1_Q2')
    expect(charts.renameSheet).toHaveBeenCalledWith('Q1/Q2', 'Q1_Q2')
    expect(applyViewState).toHaveBeenCalledWith({ Q1_Q2: { colW: { 0: 90 } } })
    expect(saved.legacyUpgrade.value?.renamed).toEqual({ 'Q1/Q2': 'Q1_Q2' })
  })

  it('treats an IronCalc sheet as already upgraded', async () => {
    answerWith(developSheet({ sheets_data: JSON.stringify({ engine: btoa('\x07') }) }))
    const saved = persistence()
    await saved.loadSheet('old-1')
    await saved.saveExisting('old-1', 'From develop')

    expect(saved.legacyUpgrade.value).toBeNull()
    expect(versionCalls()).toEqual([])
  })
})
