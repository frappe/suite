import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { Room } from 'y-webrtc'
import * as Y from 'yjs'

import { useYjs } from './useYjs'

vi.mock('y-webrtc', async () => {
  const { Awareness } = await import('y-protocols/awareness')
  class WebrtcProvider {
    awareness: InstanceType<typeof Awareness>
    room = { bcconnected: true, bcConns: new Set() } as Pick<Room, 'bcconnected' | 'bcConns'> | null
    disconnect = vi.fn()
    destroy = vi.fn()

    constructor(_room: string, doc: Y.Doc) {
      this.awareness = new Awareness(doc)
    }
  }

  return { WebrtcProvider }
})

type Tab = ReturnType<typeof useYjs> & { edited: Ref<boolean> }

const tabs: Tab[] = []
afterEach(() => {
  for (const tab of tabs.splice(0)) {
    tab.cleanup()
  }

  vi.restoreAllMocks()
})

// An old editor's tab on document `id`, as TextEditor opens it
function openTab(id: string): Tab {
  const document = {
    doc: { name: id, content: '', ycomments: '' },
    saveDoc: { run: vi.fn(async () => {}) },
    saveComments: { run: vi.fn(async () => {}) },
  } as unknown as Parameters<typeof useYjs>[1]
  const edited = ref(false)
  const tab = { ...useYjs(id, document, ref(null), edited), edited }
  tabs.push(tab)
  return tab
}

async function loadedTab(id: string) {
  const tab = openTab(id)
  await vi.waitFor(() => expect(tab.loaded.value).toBe(true))
  return tab
}

function type(tab: Tab, words: string) {
  const text = tab.doc.getText('body')
  tab.doc.transact(() => text.insert(text.length, words), 'editor')
}

// What a later open of document `id` replays from this device
async function storedText(id: string) {
  const doc = new Y.Doc()
  const store = new IndexeddbPersistence(`fdoc-${id}`, doc)
  await store.whenSynced
  await store.destroy()
  return doc.getText('body').toString()
}

// The old editor opens a logged document when Writer collaboration is off or its log can't be
// read (R155 b); its refused save is then kept as a recovery copy
describe("the old editor's device store once a refused save is kept", () => {
  it('replays nothing into a later open, and the tab leaves the room', async () => {
    const tab = await loadedTab('doc-replay')
    type(tab, 'Old editor line')
    const before = await storedText('doc-replay')

    await tab.forgetStoredEdits()

    expect([before, await storedText('doc-replay')]).toEqual(['Old editor line', ''])
    expect(tab.provider.disconnect).toHaveBeenCalled()
  })

  it('still stores and saves what another old tab types after the clear', async () => {
    const [refused, sibling] = [await loadedTab('doc-sibling'), await loadedTab('doc-sibling')]
    type(refused, 'Refused line')

    await refused.forgetStoredEdits()
    type(sibling, 'Typed after')

    expect(sibling.edited.value).toBe(true)
    expect(await storedText('doc-sibling')).toBe('Typed after')
  })

  it('stops storing even when the clear fails', async () => {
    const tab = await loadedTab('doc-failed-clear')
    type(tab, 'Kept line')
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('The database connection is closing.', 'InvalidStateError')
    })

    await tab.forgetStoredEdits()
    transaction.mockRestore()
    type(tab, ' and more')

    expect(await storedText('doc-failed-clear')).toBe('Kept line')
  })

  it('keeps the store while another old tab of the document is open on this device', async () => {
    const tab = await loadedTab('doc-open-sibling')
    type(tab, 'Old editor line')
    tab.provider.room?.bcConns.add('sibling-tab')

    await tab.forgetStoredEdits()

    expect(await storedText('doc-open-sibling')).toBe('Old editor line')
    expect(tab.provider.disconnect).toHaveBeenCalled()
  })

  it.each([
    ["hasn't opened its room yet", 'doc-no-room', null],
    ['has its room closed', 'doc-closed-room', { bcconnected: false, bcConns: new Set() }],
  ])("keeps the store when the tab %s, so it can't see other tabs", async (_, id, room) => {
    const tab = await loadedTab(id)
    type(tab, 'Old editor line')
    Object.assign(tab.provider, { room })

    await tab.forgetStoredEdits()

    expect(await storedText(id)).toBe('Old editor line')
  })

  it('keeps the store when the copy was taken before the store loaded', async () => {
    const seeded = await loadedTab('doc-early')
    type(seeded, 'Stored line')
    seeded.cleanup()

    const tab = openTab('doc-early')
    await tab.forgetStoredEdits()
    await vi.waitFor(() => expect(tab.loaded.value).toBe(true))

    expect(await storedText('doc-early')).toBe('Stored line')
  })
})
