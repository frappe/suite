import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { toast } from 'frappe-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import * as Y from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { elementText, writeDeck } from '@/apps/slides/collab/deck'
import { roomCopies } from '@/apps/slides/recovery/copies'
import { slides } from '@/apps/slides/stores/slide'
import { openSignedInDeviceStore } from '@/platform/collab'

import { downloadRecovery, downloadSlides, keepRecovery } from './recovery'
import { useUnsavedRecovery } from './useUnsavedRecovery'

vi.mock('frappe-ui', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  FileUploadHandler: class {},
}))
vi.mock('@/apps/slides/stores/presentation', () => ({ viewOnly: { value: false } }))
vi.mock('@/apps/slides/stores/slide', async () => {
  const { ref } = await import('vue')
  return { slides: ref([]) }
})
vi.mock('./recovery', async (original) => ({
  ...(await original<typeof import('./recovery')>()),
  downloadRecovery: vi.fn(),
  downloadSlides: vi.fn(),
  keepRecovery: vi.fn(),
  readRecovery: () => [],
}))
const stored = await vi.importActual<typeof import('./recovery')>('./recovery')

function recovery({ isKeptByRoom = (): boolean => false } = {}) {
  return useUnsavedRecovery(
    fromPartial<DocumentSession>({ nodeId: 'n', contentDocname: 'd', title: ref('Talk') }),
    {
      isWritable: () => true,
      isReadable: () => true,
      load: async () => {},
      loseAccess: async () => false,
      regainAccess: async () => 'editing',
      isKeptByRoom,
    },
  )
}

const typed = [{ clientId: 's', elements: [{ id: 'a', content: '<p>the only copy</p>' }] }]

describe('keeping the text of a deleted element', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    slides.value = JSON.parse(JSON.stringify(typed))
  })

  it('stores it and offers nothing more when the device has room', () => {
    expect(recovery().retainStickyOrOffer()).toBe(true)

    expect(keepRecovery).toHaveBeenCalledWith('n', typed, { sticky: true })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still downloads the text after the element is gone when the device has no room', () => {
    vi.mocked(keepRecovery).mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(recovery().retainStickyOrOffer()).toBe(false)
    slides.value = [{ clientId: 's', elements: [] }]
    const options = fromAny<{ action: { onClick: () => void }; duration: number }, unknown>(
      vi.mocked(toast.error).mock.calls[0][1],
    )
    options.action.onClick()

    expect(options.duration).toBe(Number.POSITIVE_INFINITY)
    expect(downloadSlides).toHaveBeenCalledWith(typed, 'Talk')
  })
})

describe("the menu's Discard", () => {
  const shownAt = new Date('2026-11-12T10:00:00Z')

  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it.each([
    ['a newer', new Date('2026-11-12T10:01:00Z')],
    ['a same-date, different', shownAt],
  ])(
    'discards the copy shown when it asked, keeping %s copy written during the prompt',
    async (_, at) => {
      stored.keepRecovery('n', [{ clientId: 'shown' }], { sticky: true, now: shownAt })
      vi.spyOn(window, 'confirm').mockImplementation(() => {
        stored.keepRecovery('n', [{ clientId: 'written' }], { sticky: true, now: at })
        return true
      })

      await recovery().discardChanges()

      expect(stored.readRecovery('n').map((copy) => copy.slides)).toEqual([
        [{ clientId: 'written' }],
      ])
    },
  )
})

describe('a device too full to note a discard or a download', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    localStorage.clear()
    document.cookie = 'user_id=me%40example.com'
    // a copy in the older single list, which only a mark can hide
    localStorage.setItem(
      'suite:slides-recovery:me@example.com:n',
      JSON.stringify([{ savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }] }]),
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
  })

  it('says the copy could not be discarded, and keeps it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await recovery().discardChanges()

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't discard"))
    expect(stored.readRecovery('n').map((copy) => copy.slides)).toEqual([[{ clientId: 'old' }]])
  })

  it('says the download could not be noted', () => {
    URL.createObjectURL = () => 'blob:recovery'
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(downloadRecovery).mockImplementation(stored.downloadRecovery)

    recovery().downloadChanges()

    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('too full'))
    expect(stored.readRecovery('n')).toEqual([expect.not.objectContaining({ downloaded: true })])
  })
})

describe('the copy the live room kept on the device', () => {
  // as the room keeps its unsent work when it stops: a record in the device store
  async function keptByRoom(words: string) {
    const store = (await openSignedInDeviceStore('slides'))!
    const doc = new Y.Doc()
    writeDeck(doc, [{ id: 'one', elements: [{ id: 'title', type: 'text' }] }])
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(words)])
    elementText(doc, 'title')!.insert(0, [paragraph])
    const state = Y.encodeStateAsUpdate(doc)
    await store.saveSession({ doc: 'n', sid: 's', lineage: 'L', cid: 1, bound: true })
    const entry = { doc: 'n', sid: 's', seq: 1, bytes: state, sha: '', seenRev: 0 }
    await store.recover('n', ['s'], 'lost_access', [entry], { state, title: 'Talk' })
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    localStorage.clear()
    document.cookie = 'user_id=me%40example.com'
  })

  afterEach(async () => {
    const store = (await openSignedInDeviceStore('slides'))!
    const records = await store.allRecovery()
    await Promise.all(records.map((record) => store.discard(record.id!)))
  })

  it('is offered as a download from the editor, with no page copy', async () => {
    await keptByRoom('kept by the room')
    const saved: File[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
      if (file instanceof File) saved.push(file)
      return 'blob:copy'
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const kept = recovery()
    await vi.waitFor(() => expect(kept.canDownloadChanges.value).toBe(true))

    kept.downloadChanges()

    expect(saved.map((file) => file.name)).toEqual(['Talk (recovered).json'])
    expect(await saved[0]!.text()).toContain('kept by the room')
  })

  it("is gone from the device once the editor's Discard is confirmed", async () => {
    await keptByRoom('kept by the room')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const kept = recovery()
    await vi.waitFor(() => expect(kept.canDownloadChanges.value).toBe(true))

    await kept.discardChanges()

    expect([await roomCopies('n'), kept.canDownloadChanges.value]).toEqual([[], false])
  })

  it('keeps no page copy beside it as the tab closes', () => {
    slides.value = JSON.parse(JSON.stringify(typed))

    expect(recovery({ isKeptByRoom: () => true }).retainOrWarn()).toBe(true)

    expect(keepRecovery).not.toHaveBeenCalled()
  })

  it('leaves a page copy kept meanwhile that holds other work than the copy the room kept', async () => {
    vi.mocked(keepRecovery).mockImplementation(stored.keepRecovery)
    slides.value = JSON.parse(JSON.stringify(typed))
    let isKept = false
    const kept = recovery({ isKeptByRoom: () => isKept })
    expect(kept.retainRecovery()).toBe(true)

    await keptByRoom('older words')
    isKept = true
    await kept.syncRoomKept()

    expect(stored.readRecovery('n').map((copy) => copy.slides)).toEqual([typed])
  })
})
