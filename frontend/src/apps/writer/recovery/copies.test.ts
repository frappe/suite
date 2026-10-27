import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { openSignedInDeviceStore } from '@/platform/collab'

import {
  copyEntries,
  copyToClipboard,
  discardCopy,
  downloadCopy,
  keepPageCopy,
  keepRemovedWork,
  listCopies,
  recoveryFile,
  type RecoveryCopy,
} from './copies'

vi.mock('@/platform/collab', async (importOriginal) => {
  const collab = await importOriginal<typeof import('@/platform/collab')>()
  return { ...collab, openSignedInDeviceStore: vi.fn(collab.openSignedInDeviceStore) }
})

function bodyState(words: string) {
  const doc = new yjs.Doc()
  const paragraph = new yjs.XmlElement('paragraph')
  paragraph.insert(0, [new yjs.XmlText(words)])
  doc.getXmlFragment(BODY_FIELD).insert(0, [paragraph])
  return yjs.encodeStateAsUpdate(doc)
}

async function keepInStore(node: string, words: string, title: string) {
  const store = (await openSignedInDeviceStore('writer'))!
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

function lostText(seen: string, runs: { offset: number; text: string }[], isUncertain = false) {
  const written = { before: new Map(), after: new Map() }
  const lost = runs.map((run) => ({ ...run, attrs: { bold: {} } }))
  return { kind: 'text' as const, seen, runs: lost, written, pulled: written, isUncertain }
}

describe('Writer recovery copies', () => {
  it('keeps the text another edit removed as its own copy, without the text around it', async () => {
    const removals = [
      lostText('defgh', [{ offset: 2, text: 'QQ' }]),
      lostText('xyz', [{ offset: 0, text: 'RR' }], true),
    ]
    const image = { kind: 'node' as const, name: 'image', attrs: { src: '/files/x.png' } }

    expect(await keepRemovedWork('node-1', 'Plan', removals)).toBe('kept')
    expect(await keepRemovedWork('node-1', 'Plan', [image])).toBe('kept')

    // Both copies may share a millisecond, so neither order is promised
    const copies = await listCopies('node-1')
    const textCopy = copies.find((copy) => copy.text !== '')!
    expect(summary(copies)).toContainEqual(['node-1', 'Plan', 'QQ\nRR'])
    expect(textCopy.html).toContain('<strong>QQ</strong>')
    expect(copies.filter((copy) => copy.html.includes('src="/files/x.png"'))).toHaveLength(1)
    const records = await (await openSignedInDeviceStore('writer'))!.recovery('node-1')
    expect(records.map((record) => record.reason)).toEqual(['restructure', 'restructure'])
  })

  it('keeps no copy when nothing another edit removed reads on its own', async () => {
    const paragraph = { kind: 'node' as const, name: 'paragraph', attrs: {} }
    const spaces = lostText('defgh', [{ offset: 2, text: ' \u00a0\n' }])
    const lineBreak = { kind: 'node' as const, name: 'hardBreak', attrs: {} }

    expect(await keepRemovedWork('node-1', 'Plan', [paragraph])).toBeNull()
    expect(await keepRemovedWork('node-1', 'Plan', [spaces, lineBreak])).toBeNull()

    expect(await listCopies('node-1')).toEqual([])
  })

  it('keeps a keyed loss once however often it is reported', async () => {
    const lost = { ...lostText('', [{ offset: 0, text: 'QQ' }]), key: '7:0+2' }

    expect(await keepRemovedWork('node-1', 'Plan', [lost])).toBe('kept')
    expect(await keepRemovedWork('node-1', 'Plan', [lost])).toBeNull()

    expect(summary(await listCopies('node-1'))).toEqual([['node-1', 'Plan', 'QQ']])
  })

  it('keeps a bigger keyed loss in a copy of its own holding all of it', async () => {
    const lostQQ = { ...lostText('', [{ offset: 0, text: 'QQ' }]), key: '7:0+2' }
    const lostQQR = { ...lostText('', [{ offset: 0, text: 'QQR' }]), key: '7:0+3' }

    expect(await keepRemovedWork('node-1', 'Plan', [lostQQ])).toBe('kept')
    expect(await keepRemovedWork('node-1', 'Plan', [lostQQR])).toBe('kept')

    const texts = (await listCopies('node-1')).map((copy) => copy.text)
    expect(texts.sort()).toEqual(['QQ', 'QQR'])
  })

  it('keeps keyed and unkeyed losses of one report in one copy', async () => {
    const keyed = { ...lostText('', [{ offset: 0, text: 'QQ' }]), key: '7:0+2' }
    const unkeyed = lostText('defgh', [{ offset: 2, text: 'RR' }])

    expect(await keepRemovedWork('node-1', 'Plan', [keyed, unkeyed])).toBe('kept')

    expect(summary(await listCopies('node-1'))).toEqual([['node-1', 'Plan', 'QQ\nRR']])
  })

  it('keeps of a report only the losses not kept already, in one copy', async () => {
    const lostQQ = { ...lostText('', [{ offset: 0, text: 'QQ' }]), key: '7:0+2' }
    const lostRR = { ...lostText('', [{ offset: 0, text: 'RR' }]), key: '7:4+2' }

    expect(await keepRemovedWork('node-1', 'Plan', [lostQQ])).toBe('kept')
    expect(await keepRemovedWork('node-1', 'Plan', [lostQQ, lostRR])).toBe('kept')

    const texts = (await listCopies('node-1')).map((copy) => copy.text)
    expect(texts.sort()).toEqual(['QQ', 'RR'])
  })

  it('keeps a keyed lost mention once however often it is reported', async () => {
    const mention = { kind: 'node' as const, name: 'mention', attrs: {}, key: '7:0+1' }

    expect(await keepRemovedWork('node-1', 'Plan', [mention])).toBe('kept')
    expect(await keepRemovedWork('node-1', 'Plan', [mention])).toBeNull()

    expect(await listCopies('node-1')).toHaveLength(1)
  })

  it('keeps a keyed loss again when a copy on the device cannot be read', async () => {
    const store = (await openSignedInDeviceStore('writer'))!
    const bytes = new Uint8Array([1, 2, 3])
    const garbled = { doc: 'node-1', sid: 'g', seq: 0, bytes, sha: '', seenRev: 0 }
    await store.recover('node-1', ['g'], 'restructure', [garbled], {
      state: new Uint8Array([255, 255]),
      title: 'Plan',
    })
    const lost = { ...lostText('', [{ offset: 0, text: 'QQ' }]), key: '7:0+2' }

    try {
      expect(await keepRemovedWork('node-1', 'Plan', [lost])).toBe('kept')

      expect(summary(await listCopies('node-1'))).toEqual([['node-1', 'Plan', 'QQ']])
    } finally {
      const records = await store.allRecovery()
      await Promise.all(records.map((record) => store.discard(record.id!)))
    }
  })

  it("says the text another edit removed couldn't be kept where the browser has no store", async () => {
    vi.mocked(openSignedInDeviceStore).mockResolvedValueOnce(null)

    const lost = [lostText('defgh', [{ offset: 2, text: 'QQ' }])]
    expect(await keepRemovedWork('node-1', 'Plan', lost)).toBe('unkept')
  })

  it("says the text another edit removed couldn't be kept when the store refuses it, keeping none", async () => {
    const store = (await openSignedInDeviceStore('writer'))!
    vi.spyOn(store, 'recover').mockRejectedValueOnce(new Error('QuotaExceededError'))

    const lost = [lostText('defgh', [{ offset: 2, text: 'QQ' }])]
    expect(await keepRemovedWork('node-1', 'Plan', lost)).toBe('unkept')

    expect(await listCopies('node-1')).toEqual([])
  })

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
    const store = (await openSignedInDeviceStore('writer'))!
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

  it('copying puts the copy on the clipboard, formatted where the browser allows', async () => {
    let pasted: Record<string, string> = {}
    const clipboard = {
      async write([item]: { parts: Record<string, Blob> }[]) {
        const parts = Object.entries(item.parts)
        const read = parts.map(async ([type, blob]) => [type, await blob.text()])
        pasted = Object.fromEntries(await Promise.all(read))
      },
      async writeText(text: string) {
        pasted = { 'text/plain': text }
      },
    }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly parts: Record<string, Blob>) {}
      },
    )
    keepPageCopy('node-1', 'Plan', '<p>Unsaved <b>work</b></p>')
    const [copy] = await listCopies('node-1')

    await copyToClipboard(copy)
    expect(pasted).toEqual({
      'text/html': '<p>Unsaved <b>work</b></p>',
      'text/plain': 'Unsaved work',
    })

    vi.stubGlobal('ClipboardItem', undefined)
    await copyToClipboard(copy)
    expect(pasted).toEqual({ 'text/plain': 'Unsaved work' })

    vi.unstubAllGlobals()
    delete (navigator as { clipboard?: unknown }).clipboard
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
