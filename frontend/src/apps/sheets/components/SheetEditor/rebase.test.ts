import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createWorkbookClient, type WorkbookClient } from '../../core/client'
import { createWorkerHost } from '../../core/worker'
import { createFormatsEngine } from '../../engine/formats'
import { createUnsentCommands } from './unsentCommands'
import { usePersistence } from './usePersistence.js'

const nodeRequire = createRequire(import.meta.url)

// One stored sheet, saved the way `save_sheet` does: a save built on any head
// but the current one is refused (specs/sheets/002).
const server = vi.hoisted(() => ({
  sheetsData: '{}',
  headSeq: 0,
}))

vi.mock('@/api', async () => {
  const { api } = await import('@/apps/sheets/client/generated')
  const send = async (reference: { path: string }, args: Record<string, unknown>) => {
    if (reference.path.endsWith('get_sheet')) {
      return {
        name: 'sheet-1',
        title: 'Budget',
        can_write: true,
        owner: 'sofia@example.com',
        node: null,
        sheets_data: server.sheetsData,
        head_seq: server.headSeq,
      }
    }
    if (args.base_seq !== server.headSeq) {
      throw Object.assign(new Error('Changed elsewhere'), {
        type: 'TimestampMismatchError',
        status: 417,
      })
    }
    server.sheetsData = String(args.sheets_data)
    server.headSeq += 1
    return { name: 'sheet-1', head_seq: server.headSeq }
  }
  return { api: { sheets: api }, client: { query: send, mutation: send } }
})
vi.mock('../../utils/compress.js', () => ({
  isDecompressionSupported: () => false,
  decodeFromDownload: async (value: string) => value,
  encodeForUpload: async (value: string) => value,
}))

// The real IronCalc host, in-process.
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

let commandSeq = 0
function command(type: string, payload: Record<string, unknown>) {
  return { id: `test-${commandSeq++}`, actor: 'local', ts: Date.now(), type, payload }
}

function at(cell: string) {
  const match = /^([A-Z])(\d+)$/.exec(cell)!
  return { col: match[1]!.charCodeAt(0) - 64, row: Number(match[2]) }
}

/** One editor on the sheet: a tab, wired as the editor wires usePersistence. */
async function openEditor() {
  const unsent = createUnsentCommands()
  const formats = createFormatsEngine()
  let client: WorkbookClient | null = null
  const engine = {
    async start(bytes: Uint8Array | null) {
      client?.terminate()
      client = await createWorkbookClient({ port: fakePort(), snapshotBytes: bytes })
      client.onEdit((edit) => unsent.record(edit))
    },
    toBytes: () => client!.snapshot(),
    client: () => client,
    syncDefinedNames: () => {},
  }
  const persistence = usePersistence({ engine, formats, currentTitle: ref('Budget'), unsent })
  await persistence.loadSheet('sheet-1')
  const notApplied: string[] = []

  return {
    persistence,
    formats,
    notApplied,
    type(cell: string, input: string) {
      client!.dispatch(command('setInput', { sheet: 'Sheet1', ...at(cell), input }))
    },
    insertRows(row: number, count: number) {
      client!.dispatch(command('insertRows', { sheet: 'Sheet1', row, count }))
    },
    /** Save; when another editor got there first, rebase and save once more, as the editor does. */
    async save() {
      try {
        await persistence.saveExisting('sheet-1', 'Budget')
        return 'saved'
      } catch (error) {
        if ((error as { type?: string }).type !== 'TimestampMismatchError') throw error
      }
      const outcome = await persistence.rebase('sheet-1')
      notApplied.push(...outcome.notApplied)
      if (!outcome.rebased) return 'changed elsewhere'
      await persistence.saveExisting('sheet-1', 'Budget')
      return 'rebased'
    },
    async read(cell: string) {
      const { cells } = await client!.readCells({
        sheet: 'Sheet1',
        cells: [at(cell)],
        what: ['input'],
      })
      return cells[0]?.input ?? ''
    },
  }
}

/** What anyone opening the sheet now sees. */
async function stored(cell: string) {
  return (await openEditor()).read(cell)
}

beforeEach(() => {
  server.sheetsData = '{}'
  server.headSeq = 0
  sessionStorage.clear()
})

describe('Sheets: two editors saving the same sheet', () => {
  initSync({ module: fs.readFileSync(nodeRequire.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

  it('keeps both editors’ edits when they change different cells', async () => {
    const first = await openEditor()
    const second = await openEditor()
    first.type('B13', 'Travel')
    second.type('C13', '420')

    expect(await first.save()).toBe('saved')
    expect(await second.save()).toBe('rebased')

    expect(await stored('B13')).toBe('Travel')
    expect(await stored('C13')).toBe('420')
    expect(await second.read('B13')).toBe('Travel')
  })

  it('keeps the value of whoever saved last when both change the same cell', async () => {
    const first = await openEditor()
    const second = await openEditor()
    first.type('B2', 'from the first tab')
    second.type('B2', 'from the second tab')

    await first.save()
    await second.save()

    expect(await stored('B2')).toBe('from the second tab')
  })

  it('keeps formats set in each editor, per cell', async () => {
    const first = await openEditor()
    const second = await openEditor()
    first.formats.set('B2', { bold: true }, 'Sheet1')
    second.formats.set('C2', { italic: true }, 'Sheet1')

    await first.save()
    await second.save()

    const formats = JSON.parse(server.sheetsData).formats
    expect(formats.Sheet1.cells).toEqual({ B2: { bold: true }, C2: { italic: true } })
  })

  it('lists edits that move cells instead of putting them on the newer copy', async () => {
    const first = await openEditor()
    const second = await openEditor()
    first.type('A1', 'Rent')
    second.insertRows(1, 2)
    second.type('A1', 'Header')

    await first.save()
    expect(await second.save()).toBe('changed elsewhere')

    expect(second.notApplied).toEqual([
      'Sheet1: inserted 2 rows at row 1',
      'Sheet1!A1: entered “Header”',
    ])
    // The second editor's own workbook is untouched, for its recovery copy.
    expect(await second.read('A3')).toBe('')
    expect(await second.read('A1')).toBe('Header')
    expect(await stored('A1')).toBe('Rent')
  })

  it('puts edits a reload interrupted back on top of the stored sheet', async () => {
    const before = await openEditor()
    before.type('D4', '=SUM(1,2)')
    before.persistence.keepDraft('sheet-1')

    const after = await openEditor()
    expect(after.persistence.restoreDraft('sheet-1')).toBe(true)
    await after.save()

    expect(await stored('D4')).toBe('=SUM(1,2)')
  })

  it('drops the draft once a save carries its edits', async () => {
    const editor = await openEditor()
    editor.type('A1', 'saved')
    editor.persistence.keepDraft('sheet-1')
    await editor.save()
    editor.persistence.keepDraft('sheet-1')

    const reopened = await openEditor()
    expect(reopened.persistence.restoreDraft('sheet-1')).toBe(false)
  })
})
