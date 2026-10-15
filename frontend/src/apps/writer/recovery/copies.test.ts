import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { writerDeviceStore } from '@/apps/writer/collab'
import { BODY_FIELD } from '@/apps/writer/collab/field'

import {
  copyEntries,
  discardCopy,
  downloadCopy,
  keepPageCopy,
  listCopies,
  recoveryFile,
  type RecoveryCopy,
} from './copies'

function bodyState(words: string) {
  const doc = new yjs.Doc()
  const paragraph = new yjs.XmlElement('paragraph')
  paragraph.insert(0, [new yjs.XmlText(words)])
  doc.getXmlFragment(BODY_FIELD).insert(0, [paragraph])
  return yjs.encodeStateAsUpdate(doc)
}

async function keepInStore(node: string, words: string, title: string) {
  const store = (await writerDeviceStore())!
  const update = bodyState(words)
  await store.saveSession({ doc: node, sid: 's', lineage: 'L', cid: 1, bound: true })
  const entry = { doc: node, sid: 's', seq: 1, bytes: update, sha: '' }
  await store.recover(node, ['s'], 'schema', [entry], { state: update, title })
}

function summary(copies: RecoveryCopy[]) {
  return copies.map((copy) => [copy.node, copy.title, copy.text])
}

beforeEach(() => localStorage.clear())

afterEach(async () => {
  const copies = await listCopies()
  await Promise.all(copies.map(discardCopy))
})

describe('Writer recovery copies', () => {
  it('lists the device store’s copies and this page’s, newest first, for one document or all', async () => {
    keepPageCopy(
      'node-1',
      'Plan',
      '<p>typed in the old editor</p>',
      new Date('2026-09-29T10:00:00Z'),
    )
    await keepInStore('node-1', 'typed while live', 'Plan')
    await keepInStore('node-2', 'other work', 'Notes')

    expect(summary(await listCopies('node-1'))).toEqual([
      ['node-1', 'Plan', 'typed while live'],
      ['node-1', 'Plan', 'typed in the old editor'],
    ])
    expect((await listCopies()).map((copy) => copy.node).sort()).toEqual([
      'node-1',
      'node-1',
      'node-2',
    ])
    expect((await copyEntries()).map((entry) => entry.document).sort()).toEqual([
      'node-1',
      'node-1',
      'node-2',
    ])
  })

  it('lists the other copies when one record on the device cannot be read', async () => {
    await keepInStore('node-1', 'readable work', 'Plan')
    const store = (await writerDeviceStore())!
    const garbled = { doc: 'node-1', sid: 'g', seq: 1, bytes: new Uint8Array([1, 2, 3]), sha: '' }
    await store.saveSession({ doc: 'node-1', sid: 'g', lineage: 'L', cid: 2, bound: true })
    await store.recover('node-1', ['g'], 'schema', [garbled], {
      state: new Uint8Array([255, 255]),
      title: 'Plan',
    })

    expect(summary(await listCopies('node-1'))).toEqual([['node-1', 'Plan', 'readable work']])
    const records = await store.allRecovery()
    await Promise.all(records.map((record) => store.discard(record.id)))
  })

  it('lists and counts the device store’s copies where the browser blocks this page’s storage', async () => {
    await keepInStore('node-1', 'typed while live', 'Plan')
    const blocked = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    const listed = await listCopies()
    const entries = await copyEntries()
    blocked.mockRestore()
    expect([summary(listed), entries.length]).toEqual([[['node-1', 'Plan', 'typed while live']], 1])
  })

  it('keeps a copy from before page loads were told apart', async () => {
    const copy = { savedAt: '2026-09-29T10:05:00.000Z', html: '<p>older copy</p>' }
    localStorage.setItem('suite:writer-recovery:node-1', JSON.stringify(copy))
    localStorage.setItem('suite:writer-recovery:node-2', 'not json')

    expect(summary(await listCopies())).toEqual([['node-1', '', 'older copy']])
    expect(await copyEntries()).toEqual([{ document: 'node-1' }])
  })

  it('lists only the copies of the document asked for, not of one whose id starts the same', async () => {
    const older = { savedAt: '2026-09-29T10:05:00.000Z', html: '<p>older copy</p>' }
    localStorage.setItem('suite:writer-recovery:node-1', JSON.stringify(older))
    localStorage.setItem('suite:writer-recovery:node-10', JSON.stringify(older))
    keepPageCopy('node-1', 'Plan', '<p>plan</p>')
    keepPageCopy('node-10', 'Notes', '<p>notes</p>')

    expect(summary(await listCopies('node-1')).sort()).toEqual([
      ['node-1', '', 'older copy'],
      ['node-1', 'Plan', 'plan'],
    ])
  })

  it('a later keep in the same page replaces its copy, never another page’s', async () => {
    const earlier = { savedAt: '2026-09-29T10:05:00.000Z', html: '<p>earlier tab</p>' }
    localStorage.setItem('suite:writer-recovery:node-1', JSON.stringify(earlier))
    keepPageCopy('node-1', 'Plan', '<p>first</p>')
    keepPageCopy('node-1', 'Plan', '<p>second</p>')

    expect((await listCopies('node-1')).map((copy) => copy.text).sort()).toEqual([
      'earlier tab',
      'second',
    ])
  })

  it('a download leaves the copy on the device, and discarding removes only that copy', async () => {
    const url = URL as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (href: string) => void
    }
    url.createObjectURL = () => 'blob:recovery'
    url.revokeObjectURL = () => {}

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    keepPageCopy('node-1', 'Plan', '<p>page copy</p>')
    await keepInStore('node-1', 'store copy', 'Plan')

    const copies = await listCopies('node-1')
    for (const copy of copies) {
      downloadCopy(copy)
    }

    expect((await listCopies('node-1')).length).toBe(2)
    for (const copy of copies) {
      await discardCopy(copy)
      expect((await listCopies('node-1')).map((kept) => kept.key)).not.toContain(copy.key)
    }

    click.mockRestore()
    delete url.createObjectURL
    delete url.revokeObjectURL
  })

  it('offers a copy as a standalone HTML file named after the document', async () => {
    keepPageCopy('node-1', 'Q3 <plan>', '<p>Unsaved <b>work</b></p>')
    const [copy] = await listCopies('node-1')
    const file = recoveryFile(copy)

    expect([file.name, file.type]).toEqual(['Q3 plan (recovered).html', 'text/html'])
    const text = await file.text()
    expect(text).toContain('<title>Q3 &lt;plan&gt;</title>')
    expect(text).toContain('<p>Unsaved <b>work</b></p>')
  })
})
