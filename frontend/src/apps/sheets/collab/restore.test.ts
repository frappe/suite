import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { alignDoc, readVersionState, restoreVersion } from './restore'
import { addSheet, axis, cellKey, initDoc, roots } from './schema'

function sheetWith(cells: Record<string, string>) {
  const doc = new Y.Doc()
  initDoc(doc)
  const id = addSheet(doc, 'Sheet1')
  doc.transact(() => {
    for (const [at, input] of Object.entries(cells)) {
      const [row, col] = at.split(',').map(Number) as [number, number]
      roots(doc).inputs.set(
        cellKey(id, axis(doc, id, 'rows').ensure(row), axis(doc, id, 'cols').ensure(col)),
        input,
      )
    }
  })
  return doc
}

const json = (doc: Y.Doc) => {
  const r = roots(doc)
  return JSON.stringify({
    sheets: r.sheets.toJSON(),
    sheetMeta: r.sheetMeta.toJSON(),
    rows: r.rows.toJSON(),
    cols: r.cols.toJSON(),
    inputs: r.inputs.toJSON(),
  })
}

function versionBytes(doc: Y.Doc, schema = 'sheets-document/2') {
  // As the server stores it (suite/content/logged.py version_record).
  const state = gzipSync(Y.encodeStateAsUpdate(doc)).toString('base64')
  const record = { schema, codec: 'yjs1', lineage: 'l', state, html: null }
  return new TextEncoder().encode(JSON.stringify(record))
}

describe('alignDoc', () => {
  it('makes the doc hold what the version holds', () => {
    // The version: A1 = 1. Since then: A1 changed, B2 typed, rows inserted, a sheet added.
    const version = sheetWith({ '0,0': '1' })
    const current = new Y.Doc()
    Y.applyUpdate(current, Y.encodeStateAsUpdate(version))
    const sheetId = roots(current).sheets.get(0)
    current.transact(() => {
      axis(current, sheetId, 'rows').insert(0, 2)
      roots(current).inputs.set(cellKey(sheetId, 'x', 'y'), 'later')
      addSheet(current, 'Sheet2')
    })
    current.transact(() => alignDoc(current, version))
    expect(json(current)).toBe(json(version))
  })

  it('writes nothing when the doc already is the version', () => {
    const version = sheetWith({ '0,0': '1', '3,2': '=A1' })
    const current = new Y.Doc()
    Y.applyUpdate(current, Y.encodeStateAsUpdate(version))
    const onUpdate = vi.fn()
    current.on('update', onUpdate)
    current.transact(() => alignDoc(current, version))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('never lowers a tail mark, so a deleted tail id is never handed out again', () => {
    const version = sheetWith({ '0,0': '1' })
    const current = new Y.Doc()
    Y.applyUpdate(current, Y.encodeStateAsUpdate(version))
    const sheetId = roots(current).sheets.get(0)
    axis(current, sheetId, 'rows').ensure(50)
    const marks = roots(current).tails.toJSON()
    current.transact(() => alignDoc(current, version))
    expect(roots(current).tails.toJSON()).toEqual(marks)
  })
})

describe('restoreVersion', () => {
  const room = (doc: Y.Doc, outcome = 'landed', refusal?: string) => ({
    doc,
    flush: vi.fn(async () => {}),
    restoreVersion: vi.fn(async (_v: number, edit: () => void) => {
      if (outcome === 'landed') doc.transact(edit)
      return { outcome, refusal } as never
    }),
  })

  it('reads a stored version and restores it through the room', async () => {
    const version = sheetWith({ '0,0': 'old' })
    const current = new Y.Doc()
    Y.applyUpdate(current, Y.encodeStateAsUpdate(version))
    current.transact(() => roots(current).inputs.set([...roots(current).inputs.keys()][0]!, 'new'))
    const r = room(current)
    const notice = await restoreVersion(r, 4, versionBytes(version))
    expect(notice).toEqual({ isRestored: true, message: 'Version restored' })
    expect(r.flush).toHaveBeenCalled()
    expect(r.restoreVersion).toHaveBeenCalledWith(4, expect.any(Function))
    expect([...roots(current).inputs.values()]).toEqual(['old'])
  })

  it("refuses a version from before editing together, which this tab can't read", async () => {
    const r = room(new Y.Doc())
    const old = new TextEncoder().encode(JSON.stringify({ sheets: [] }))
    const notice = await restoreVersion(r, 2, old)
    expect(notice.isRestored).toBe(false)
    expect(notice.message).toContain('before editing together')
    expect(r.restoreVersion).not.toHaveBeenCalled()
  })

  it("says why the server didn't take it", async () => {
    const version = sheetWith({ '0,0': '1' })
    const r = room(new Y.Doc(), 'refused', 'restoring')
    const notice = await restoreVersion(r, 2, versionBytes(version))
    expect(notice).toEqual({
      isRestored: false,
      message: 'Someone else is restoring a version. Try again once it is done.',
    })
  })

  it("reads only this app's versions", async () => {
    const version = sheetWith({ '0,0': '1' })
    expect(await readVersionState(versionBytes(version, 'writer-document/2'))).toBeNull()
    expect(await readVersionState(versionBytes(version))).toBeInstanceOf(Uint8Array)
  })
})
