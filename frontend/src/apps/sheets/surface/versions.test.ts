import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'

import { addSheet, axis, cellKey, initDoc, roots } from '../collab/schema'
import type { SheetVersion } from './records'
import { copyFromVersion, nextStep, readPreview, useVersionList } from './versions'

const api = vi.hoisted(() => ({ mutation: vi.fn(async () => ({})) }))
vi.mock('@/api', () => ({
  api: { drive: { nodes: { trash: 'drive.nodes.trash' } } },
  client: { mutation: api.mutation },
}))

const version: SheetVersion = {
  seq: '4',
  kind: 'named',
  label: 'Before import',
  pinned: false,
  actor: 'ann@example.com',
  person: null,
  creation: '2026-10-01 09:00:00',
}

/** A one-sheet doc with `cells` ("row,col" → input) and the sheet's id. */
function sheetDoc(cells: Record<string, string>) {
  const doc = new Y.Doc()
  initDoc(doc)
  const sheetId = addSheet(doc, 'Sheet1')
  doc.transact(() => {
    for (const [at, input] of Object.entries(cells)) {
      const [row, col] = at.split(',').map(Number) as [number, number]
      const key = cellKey(
        sheetId,
        axis(doc, sheetId, 'rows').ensure(row),
        axis(doc, sheetId, 'cols').ensure(col),
      )
      roots(doc).inputs.set(key, input)
    }
  })
  return { doc, sheetId }
}

/** The bytes Drive stores for a version made while editing together. */
function storedBytes(doc: Y.Doc) {
  const state = gzipSync(Y.encodeStateAsUpdate(doc)).toString('base64')
  const record = { schema: 'sheets-document/2', codec: 'yjs1', lineage: 'l', state, html: null }
  return new TextEncoder().encode(JSON.stringify(record))
}

const oldBytes = new TextEncoder().encode(
  JSON.stringify({ schema: 'sheet/1', sheets_data: '{"sheet":{}}', head_seq: 1 }),
)

describe('readPreview', () => {
  it('lists the cells the version holds differently from the sheet now', async () => {
    const { doc: then, sheetId } = sheetDoc({ '0,0': 'old', '1,1': 'same' })
    const now = new Y.Doc()
    Y.applyUpdate(now, Y.encodeStateAsUpdate(then))
    now.transact(() => {
      const key = cellKey(
        sheetId,
        axis(now, sheetId, 'rows').idAt(0)!,
        axis(now, sheetId, 'cols').idAt(0)!,
      )
      roots(now).inputs.set(key, 'new')
    })

    const preview = await readPreview(version, storedBytes(then), Y.encodeStateAsUpdate(now))

    expect(preview.changes).toEqual([{ sheet: 'Sheet1', cell: 'A1' }])
    expect(preview.version).toBe(version)
  })

  it("shows a version from before editing together, though its changes can't be listed", async () => {
    const now = Y.encodeStateAsUpdate(sheetDoc({}).doc)
    expect((await readPreview(version, oldBytes, now)).changes).toBeNull()
  })

  it('refuses bytes that are no Sheets version', async () => {
    const other = new TextEncoder().encode(JSON.stringify({ schema: 'writer-document/2' }))
    await expect(readPreview(version, other, null)).rejects.toThrow("can't be shown")
  })
})

describe('nextStep', () => {
  it('starts at either end and wraps around', () => {
    expect(nextStep(null, 1, 3)).toBe(0)
    expect(nextStep(null, -1, 3)).toBe(2)
    expect(nextStep(2, 1, 3)).toBe(0)
    expect(nextStep(0, -1, 3)).toBe(2)
    expect(nextStep(null, 1, 0)).toBeNull()
  })
})

describe('copyFromVersion', () => {
  const copied = { name: 'node-copy', title: 'Budget (Before import)' }
  const session = (copy = vi.fn(async () => copied)) => ({ copy }) as unknown as DocumentSession

  it("copies the sheet into the folder and writes the version into the copy's room", async () => {
    const { doc } = sheetDoc({ '0,0': 'then' })
    const copy = vi.fn(async () => copied)
    const write = vi.fn(async () => true)

    const made = await copyFromVersion(
      session(copy),
      'folder-1',
      storedBytes(doc),
      copied.title,
      write,
    )

    expect(made).toEqual(copied)
    expect(copy).toHaveBeenCalledWith('folder-1', copied.title)
    const [target, state] = write.mock.calls[0] as unknown as [{ nodeId: string }, Uint8Array]
    expect(target.nodeId).toBe('node-copy')
    const written = new Y.Doc()
    Y.applyUpdate(written, state)
    expect([...roots(written).inputs.values()]).toEqual(['then'])
    expect(api.mutation).not.toHaveBeenCalled()
  })

  it('trashes a copy that could not take the version, so none is left looking like it', async () => {
    const { doc } = sheetDoc({ '0,0': 'then' })
    const write = vi.fn(async () => false)

    await expect(
      copyFromVersion(session(), 'folder-1', storedBytes(doc), 'Copy', write),
    ).rejects.toThrow('The copy could not be made')
    expect(api.mutation).toHaveBeenCalledWith(
      'drive.nodes.trash',
      { node: 'node-copy', state: 'Trashed' },
      { silent: true },
    )
  })

  it('makes no copy of a version from before editing together', async () => {
    const copy = vi.fn(async () => copied)
    await expect(copyFromVersion(session(copy), 'folder-1', oldBytes, 'Copy')).rejects.toThrow(
      'before editing together',
    )
    expect(copy).not.toHaveBeenCalled()
  })
})

describe('useVersionList', () => {
  it('renames a version through Drive and shows the new name in the list', async () => {
    const update = vi.fn(async () => ({}))
    const list = vi.fn(async () => ({
      rows: [{ ...version, seq: 4, pinned: 0 }],
      next_cursor: null,
    }))
    const versions = useVersionList({
      versions: { list, update },
      title: ref('Budget'),
    } as unknown as DocumentSession)
    await versions.load()

    const named = await versions.rename(versions.versions.value[0]!, 'Q3 close')

    expect(update).toHaveBeenCalledWith('4', { label: 'Q3 close' })
    expect(named.label).toBe('Q3 close')
    expect(versions.versions.value[0]!.label).toBe('Q3 close')
  })
})
