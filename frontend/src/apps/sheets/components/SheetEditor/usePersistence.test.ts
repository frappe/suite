import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { usePersistence } from './usePersistence.js'

const server = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: Record<string, unknown>; context?: unknown }>,
  answer: (_method: string): unknown => ({}),
  visits: [] as string[],
}))

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
  return { api: { sheets: sheetsAPI }, client: { query: send, mutation: send } }
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
