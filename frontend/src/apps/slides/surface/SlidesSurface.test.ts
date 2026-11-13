import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import {
  applyUpdate,
  Doc,
  encodeStateAsUpdate,
  UndoManager,
  type XmlElement,
  type XmlText,
} from 'yjs'

import type { DocumentVersion, useCommentDrafts } from '@/apps/drive'
import type { StoreSlide } from '@/apps/slides/collab/liveDeck'
import type { LostAccess, RoomStatus } from '@/platform/collab'
import { requireTestElement } from '@/platform/testing/dom'

import {
  collabRoom,
  commentPanel,
  driveComments,
  exported,
  fakeServer,
  forgetTemplates,
  openedSurface,
  realtime,
  savedStates,
  served,
  server,
  shown,
  signedIn,
  slideAdoption,
  startsFromEmptyStore,
  templates,
  themeChange,
  thumbnails,
  versionBytes,
  versionConversion,
  versionsPanel,
  visits,
  warms,
} from './SlidesSurface.fakes'

const {
  addEmptySlide,
  handleInsertSlide,
  slideIndex,
  slides: editorSlides,
} = await import('@/apps/slides/stores/slide')
const { inReadonlyMode, loadTemplates, presentationId, templateList, viewOnly } =
  await import('@/apps/slides/stores/presentation')
const { drawnSlides } = await import('@/apps/slides/collab/drawnDeck')
const { askLivePush, undoLive } = await import('@/apps/slides/stores/liveDeck')
const { offlineCopyStatus } = await import('@/apps/slides/stores/offlineCopy')
const { draftsDbName, DRAFTS_DB_NAME, RECORD_PREFIX } =
  await import('@/apps/slides/utils/slidesCaches')
const { openDraftsDb } = await import('@/apps/slides/utils/drafts')
const { keepRecovery, readRecovery } = await import('./recovery')
const { dialog, toast, useKeyboardShortcut } = await import('frappe-ui')
const { changeSlideInSlideshow, showSlideshowEndScreen, shownSlide } =
  await import('@/apps/slides/stores/slideshow')
const { router: slidesRouter } = await import('@/apps/slides/router')
const elementStore = await import('@/apps/slides/stores/element')
const editorStore = await import('@/apps/slides/composables/useTextEditor')
// the old stores are untyped; the tests set them as the surface reads them
const focusElementId = fromAny<Ref<string | null>, unknown>(elementStore.focusElementId)
const activeEditor = fromAny<Ref<Editor | null>, unknown>(editorStore.activeEditor)
const { registerElementDiv } = await import('@/apps/slides/stores/elementRegistry')
const { convertLegacy } = await import('@/apps/slides/collab/conversion')
const {
  addElement,
  addSlide,
  deleteElement,
  deleteSlide,
  elementIds,
  elementText,
  ROOT,
  setElement,
  setSlide,
  slideIds,
} = await import('@/apps/slides/collab/deck')

const slideStyles = vi.hoisted(() => ({ fontsImported: false }))

vi.mock('@/apps/slides/styles/fonts.css', () => {
  slideStyles.fontsImported = true
  return {}
})

let mounted: Awaited<ReturnType<typeof openedSurface>> | null = null

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = null
  server.fetch.mockReset()
  driveComments.threads = []
  driveComments.reads = 0
  driveComments.sent = []
})

// frappe-ui's dispatcher: a shortcut runs only while it is enabled
async function press(combo: string) {
  const config = vi.mocked(useKeyboardShortcut).mock.lastCall?.[0]
  const shortcuts = Array.isArray(config) ? config : config ? [config] : []
  const shortcut = shortcuts.find((entry) => entry.combo === combo)
  if (!shortcut || typeof shortcut.handler !== 'function')
    throw new Error(`Missing shortcut ${combo}`)
  const enabled =
    typeof shortcut.enabled === 'function' ? shortcut.enabled() : (shortcut.enabled ?? true)
  if (enabled) shortcut.handler(new KeyboardEvent('keydown'))
  await nextTick()
}

describe('Slides slideshow route', () => {
  it('keeps the show up on its slide while the presentation reloads', async () => {
    mounted = await openedSurface({ path: '/present?slide=2', role: 10 })
    await vi.waitFor(() => expect(shown()).toBe(true))
    let release!: () => void
    mounted.loads.push(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    mounted.access.value = { role: 50 }
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(shown()).toBe(true)
    release()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(shown()).toBe(true)
    expect(slideIndex.value).toBe(1)
  })

  it('opens an empty presentation in the editor instead of its show', async () => {
    mounted = await openedSurface({ path: '/present?slide=1', slides: [] })

    await vi.waitFor(() => expect(mounted?.router.currentRoute.value.name).toBe('document-host'))
    expect(mounted.router.currentRoute.value.query).toEqual({ slide: '1' })
    expect(shown()).toBe(false)
  })

  it('opens a converted deck whose room does not open in its view, not a show from its rows', async () => {
    mounted = await openedSurface({ path: '/present?slide=1', deck: { is_converted: true } })

    await vi.waitFor(() => expect(mounted?.router.currentRoute.value.name).toBe('document-host'))
    expect(mounted.router.currentRoute.value.query).toEqual({ slide: '1' })
    expect(shown()).toBe(false)
  })

  it('never mounts a show from rows on a converted deck whose room does not open', async () => {
    const mountedShows: boolean[] = []
    const seen = new MutationObserver(() => mountedShows.push(shown()))
    seen.observe(document.body, { childList: true, subtree: true })

    mounted = await openedSurface({ path: '/present?slide=1', deck: { is_converted: true } })
    await vi.waitFor(() => expect(mounted?.router.currentRoute.value.name).toBe('document-host'))
    seen.disconnect()

    expect(mountedShows).not.toContain(true)
  })
})

describe('Slides Present button', () => {
  const unwired = slidesRouter.currentRoute

  async function presentable(slides = served.slides) {
    mounted = await openedSurface({ slides })
    const { router } = mounted
    Object.assign(slidesRouter, { currentRoute: router.currentRoute })
    vi.mocked(slidesRouter.replace).mockImplementation((to) => router.replace(to))
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Opening presentation"]')).toBeNull(),
    )
    return mounted
  }

  function choice(name: string) {
    return [...document.querySelectorAll<HTMLElement>('header button')].find(
      (el) => el.textContent === name,
    )!
  }

  afterEach(() => {
    Object.assign(slidesRouter, { currentRoute: unwired })
    vi.mocked(slidesRouter.replace).mockReset()
  })

  it('presents from the current slide', async () => {
    const { router } = await presentable()
    slideIndex.value = 1

    document.querySelector<HTMLElement>('header [aria-label="Present"]')!.click()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('slides-slideshow'))
    expect(router.currentRoute.value.query.slide).toBe('2')
  })

  it('presents from the start', async () => {
    const { router } = await presentable()
    slideIndex.value = 1

    choice('From the start').click()

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('slides-slideshow'))
    expect(router.currentRoute.value.query.slide).toBe('1')
  })

  it('presents on loop from the start, going round after the last slide', async () => {
    const { router } = await presentable()
    slideIndex.value = 1

    choice('On loop').click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('slides-slideshow'))
    expect(router.currentRoute.value.query.slide).toBe('1')
    changeSlideInSlideshow(2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(router.currentRoute.value.query.slide).toBe('1')
  })

  it.each([
    ['an empty presentation', [], true],
    ['a presentation with slides', served.slides, false],
  ])('disables both halves of Present for %s', async (_label, slides, isDisabled) => {
    await presentable(slides)
    const options = document.querySelector('header [aria-label="Presentation options"]')!
    const halves = [
      ...document.querySelectorAll('header [aria-label="Present"], header [label="Present"]'),
      options.parentElement!,
    ]

    expect(halves).toHaveLength(3)
    for (const half of halves) {
      // the stand-ins are divs, which keep the value as written
      expect(half.getAttribute('disabled')).toBe(String(isDisabled))
    }
  })
})

// the offline copy (DESIGN-slides-offline §1, §5)
function answersStartupReads() {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.startsWith('/d/')) {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'X-Suite-Build': '100' },
      })
    }

    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

// the rows hold two slides; the room the server converted them into holds these
function roomOf(...texts: string[]) {
  const answer = convertLegacy(
    {
      slides: texts.map((text) => ({
        id: text,
        elements: [{ id: `element-${text}`, type: 'text', content: `<p>${text}</p>` }],
      })),
    },
    4 * 1024 * 1024,
  )
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  const doc = new Doc()
  applyUpdate(doc, answer.state)
  const changes = new Set<() => void>()
  const room = {
    doc,
    close: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    // the server takes every restore
    restoreVersion: vi.fn(async (_seq: number, edit: () => void) => {
      edit()
      return { outcome: 'landed' }
    }),
    status: { canWrite: true, saveState: 'clean', unsentCount: 0, restoreRev: 0 },
    presence: {
      awareness: new Awareness(doc),
      peers: [],
      ownPid: 1,
      ownArrival: 1,
      onChange: () => () => {},
    },
    onChange(listener: () => void) {
      changes.add(listener)
      return () => changes.delete(listener)
    },
    setStatus(next: Partial<RoomStatus>) {
      room.status = { ...room.status, ...next }
      changes.forEach((listener) => listener())
    },
  }
  return room
}

function convertedRoom(...texts: string[]) {
  const room = roomOf(...texts)
  collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
  return room.doc
}

describe('a deck on the content layer', () => {
  // a test may stand in for another tab's lock, which would lock every later presentation
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function statusOf(root: Element) {
    return root.querySelector('p[role="status"]')?.textContent
  }

  it('tells a waiting deck it is being upgraded and keeps it read-only', async () => {
    mounted = await openedSurface({ deck: { conversion: { state: 'pending' } } })

    expect(statusOf(mounted.root)).toContain('being upgraded')
    expect(viewOnly.value).toBe(true)
  })

  it('tells a refused deck it stays read-only and draws its rows', async () => {
    mounted = await openedSurface({ deck: { conversion: { state: 'refused' } } })

    expect(statusOf(mounted.root)).toContain("couldn't be upgraded, so it stays read-only")
    expect(statusOf(mounted.root)).not.toContain('Reason')
    expect(thumbnails(mounted.root)).toHaveLength(served.slides.length)
    expect(viewOnly.value).toBe(true)
  })

  it('shows a System Manager the reason in plain words', async () => {
    mounted = await openedSurface({
      deck: { conversion: { state: 'refused', reason: 'check: html' } },
    })

    expect(statusOf(mounted.root)).toContain(
      "Reason: the upgraded version didn't match the original.",
    )
  })

  it('shows no notice on a combined deck', async () => {
    mounted = await openedSurface({ composite: {} })
    await vi.waitFor(() => expect(viewOnly.value).toBe(true))

    expect(statusOf(mounted.root)).toBeUndefined()
  })

  function drawnTexts() {
    const drawn = fromPartial<Array<{ elements: Array<{ content?: string }> }>>(editorSlides.value)
    return drawn.map((slide) => slide.elements.map((element) => element.content).join())
  }

  describe('waiting for its conversion', () => {
    // A waiting presentation's rooms, as the server names them
    function told(keys: string[]) {
      return { epoch: 1, keys, epoch_seconds: 150, server_time: 150 }
    }

    // The rooms the tab listens on
    function joined() {
      return [...realtime.socket.joined]
    }

    // What the server sends for the presentation from now on
    function serves(deck: Record<string, unknown>, change: Record<string, unknown>) {
      Object.assign(deck, change)
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    })

    // a room a test handed over and never opened stays out of the next test
    afterEach(() => {
      vi.useRealTimers()
      collabRoom.open.mockReset()
    })

    it('opens live by itself, and editable, once a poll finds it converted', async () => {
      const deck = { conversion: { state: 'pending' } }
      mounted = await openedSurface({ deck })

      convertedRoom('one', 'two', 'three')
      serves(deck, { conversion: undefined, is_converted: true })
      vi.advanceTimersByTime(15_000)

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
      expect(viewOnly.value).toBe(false)
      expect(statusOf(mounted.root)).toBeUndefined()
    })

    it('stays read-only and keeps waiting while a poll finds it still waiting', async () => {
      const deck = { conversion: { state: 'pending' } }
      mounted = await openedSurface({ deck })

      vi.advanceTimersByTime(15_000)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect([collabRoom.open.mock.calls.length, viewOnly.value]).toEqual([0, true])

      convertedRoom('one')
      serves(deck, { conversion: undefined, is_converted: true })
      vi.advanceTimersByTime(15_000)

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    })

    it('opens live as soon as its rooms say it converted, without a poll', async () => {
      const deck = { conversion: { state: 'pending', rooms: told(['sc:a', 'sc:b']) } }
      mounted = await openedSurface({ deck })
      await vi.waitFor(() => expect(joined()).toEqual(['sc:a', 'sc:b']))

      convertedRoom('one', 'two', 'three')
      serves(deck, { conversion: undefined, is_converted: true })
      realtime.socket.hear('suite_collab_converted', { state: 'converted' })

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
      expect([viewOnly.value, joined()]).toEqual([false, []])
    })

    it('says it stays read-only once a poll finds it refused, and polls no more', async () => {
      const deck = { conversion: { state: 'pending', rooms: told(['sc:a']) } }
      mounted = await openedSurface({ deck })
      await vi.waitFor(() => expect(joined()).toEqual(['sc:a']))

      serves(deck, { conversion: { state: 'refused' } })
      vi.advanceTimersByTime(15_000)
      await vi.waitFor(() =>
        expect(statusOf(mounted!.root)).toContain("couldn't be upgraded, so it stays read-only"),
      )
      convertedRoom('one')
      serves(deck, { conversion: undefined, is_converted: true })
      vi.advanceTimersByTime(45_000)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect([collabRoom.open.mock.calls.length, joined(), viewOnly.value]).toEqual([0, [], true])
    })

    it('moves to the rooms each poll names while it waits', async () => {
      const deck = { conversion: { state: 'pending', rooms: told(['sc:a', 'sc:b']) } }
      mounted = await openedSurface({ deck })
      await vi.waitFor(() => expect(joined()).toEqual(['sc:a', 'sc:b']))

      serves(deck, { conversion: { state: 'pending', rooms: told(['sc:b', 'sc:c']) } })
      vi.advanceTimersByTime(15_000)

      await vi.waitFor(() => expect(joined()).toEqual(['sc:b', 'sc:c']))
    })

    it('stops listening once the presentation is left', async () => {
      const deck = { conversion: { state: 'pending', rooms: told(['sc:a']) } }
      mounted = await openedSurface({ deck })
      await vi.waitFor(() => expect(joined()).toEqual(['sc:a']))

      mounted.app.unmount()
      mounted.root.remove()
      mounted = null

      expect(joined()).toEqual([])
    })
  })

  it('draws a converted presentation from its room, not its rows, and lets it be edited', async () => {
    convertedRoom('one', 'two', 'three')
    mounted = await openedSurface({ deck: { is_converted: true } })

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
    expect(drawnTexts()).toEqual(
      ['one', 'two', 'three'].map((text) => expect.stringContaining(`>${text}</p>`)),
    )
    expect(viewOnly.value).toBe(false)
  })

  it('reads the comment threads again when the room says they changed', async () => {
    convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    requireTestElement(mounted.root.querySelector('[data-comments]'), HTMLButtonElement).click()
    await vi.waitFor(() => expect(driveComments.reads).toBe(1))

    const [{ onThreadsChanged }] = fromAny<[{ onThreadsChanged: () => void }], unknown>(
      collabRoom.open.mock.lastCall,
    )
    onThreadsChanged()

    await vi.waitFor(() => expect(driveComments.reads).toBe(2))
  })

  it('sends a change to the room', async () => {
    const doc = convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    fromAny<StoreSlide[], unknown>(editorSlides.value)[0].background = '#123456'
    askLivePush()
    await nextTick()

    const [slide] = drawnSlides(doc)
    expect(slide.background).toBe('#123456')
  })

  it('stops editing while the room cannot write and starts again when it can', async () => {
    const room = roomOf('one')
    collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(viewOnly.value).toBe(false))

    room.setStatus({ canWrite: false, pauseReason: 'server' })
    await vi.waitFor(() => expect(viewOnly.value).toBe(true))

    room.setStatus({ canWrite: true, pauseReason: null })
    await vi.waitFor(() => expect(viewOnly.value).toBe(false))
  })

  describe('a draft this device kept from before the live room', () => {
    const KEPT = [{ name: 'row-1', elements: [{ type: 'text', content: 'Unsent words' }] }]

    function requestResult<T>(request: IDBRequest<T>) {
      return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    async function drafts(change?: (store: IDBObjectStore) => IDBRequest) {
      const db = await openDraftsDb(draftsDbName('me@example.com'))
      const store = db.transaction('presentations', 'readwrite').objectStore('presentations')
      if (change) await requestResult(change(store))
      const ids = await requestResult(store.getAllKeys())
      db.close()
      return ids
    }

    // the next open's docname, so the draft is this presentation's
    function keepDraft(fields: Record<string, unknown>) {
      const record = {
        id: `p${fakeServer.opens + 1}`,
        user: 'me@example.com',
        content: KEPT,
        updatedAt: 1_700_000_000_000,
        ...fields,
      }
      return drafts((store) => store.put(record))
    }

    function oldDraftNotice() {
      const notices = Array.from(mounted?.root.querySelectorAll('[role="alert"]') ?? [])
      return notices.find((element) =>
        element.textContent?.includes('This device has unsaved work from'),
      )
    }

    function press(label: string) {
      oldDraftNotice()!.querySelector<HTMLElement>(`[label="${label}"]`)!.click()
    }

    beforeEach(() => {
      document.cookie = 'user_id=me@example.com'
      vi.mocked(dialog.danger).mockReset()
    })

    afterEach(async () => {
      document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      await drafts((store) => store.clear())
    })

    it('shows its unsent edits as a recovery copy, and deletes it only once Dismiss is confirmed', async () => {
      await keepDraft({ dirty: true })
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(oldDraftNotice()).toBeDefined())

      press('Dismiss')
      await vi.waitFor(() => expect(dialog.danger).toHaveBeenCalledTimes(1))
      const [asked] = fromAny<[{ onCancel: () => void }], unknown>(
        vi.mocked(dialog.danger).mock.lastCall,
      )
      asked.onCancel()
      await nextTick()
      expect(oldDraftNotice()).toBeDefined()
      expect(await drafts()).toEqual([mounted.docname])

      press('Dismiss')
      await vi.waitFor(() => expect(dialog.danger).toHaveBeenCalledTimes(2))
      const [confirmed] = fromAny<[{ onConfirm: () => void }], unknown>(
        vi.mocked(dialog.danger).mock.lastCall,
      )
      confirmed.onConfirm()
      await vi.waitFor(() => expect(oldDraftNotice()).toBeUndefined())
      expect(await drafts()).toEqual([])
    })

    it('keeps a newer draft another tab wrote while Dismiss was asked, and shows that one', async () => {
      await keepDraft({ dirty: true })
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(oldDraftNotice()).toBeDefined())
      const shownText = oldDraftNotice()!.textContent
      await drafts((store) =>
        store.put({
          id: mounted!.docname,
          user: 'me@example.com',
          content: KEPT,
          updatedAt: 1_800_000_000_000,
          dirty: true,
        }),
      )

      press('Dismiss')
      await vi.waitFor(() => expect(dialog.danger).toHaveBeenCalledTimes(1))
      const [confirmed] = fromAny<[{ onConfirm: () => void }], unknown>(
        vi.mocked(dialog.danger).mock.lastCall,
      )
      confirmed.onConfirm()

      await vi.waitFor(() => expect(oldDraftNotice()?.textContent).not.toBe(shownText))
      expect(oldDraftNotice()).toBeDefined()
      expect(await drafts()).toEqual([mounted.docname])
    })

    it("downloads the draft's slides under the presentation's title, and keeps it", async () => {
      await keepDraft({ dirty: true })
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(oldDraftNotice()).toBeDefined())
      const files: File[] = []
      vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
        if (file instanceof File) files.push(file)
        return 'blob:copy'
      })
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      press('Download')

      expect(files[0]!.name).toBe(`${served.title} (recovered).json`)
      expect(JSON.parse(await files[0]!.text()).slides).toEqual(KEPT)
      expect(await drafts()).toEqual([mounted.docname])
    })

    it('deletes a clean draft on open, and shows no notice', async () => {
      await keepDraft({ dirty: false })
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(async () => expect(await drafts()).toEqual([]))

      expect(oldDraftNotice()).toBeUndefined()
    })

    describe('one in the shared store that names no one', () => {
      async function sharedDrafts(change?: (store: IDBObjectStore) => IDBRequest) {
        const db = await openDraftsDb(DRAFTS_DB_NAME)
        const store = db.transaction('presentations', 'readwrite').objectStore('presentations')
        if (change) await requestResult(change(store))
        const ids = await requestResult(store.getAllKeys())
        db.close()
        return ids
      }

      beforeEach(async () => {
        const record = {
          id: `p${fakeServer.opens + 1}`,
          content: KEPT,
          updatedAt: 1_700_000_000_000,
          dirty: true,
        }
        await sharedDrafts((store) => store.put(record))
      })

      afterEach(() => sharedDrafts((store) => store.clear()))

      it('an editor sees it as a recovery copy, and it stays where it is', async () => {
        convertedRoom('one')
        mounted = await openedSurface({ deck: { is_converted: true } })

        await vi.waitFor(() => expect(oldDraftNotice()).toBeDefined())
        expect(await drafts()).toEqual([])
        expect(await sharedDrafts()).toEqual([mounted.docname])
      })

      it('an editor dismissing their own newer draft is shown the shared one next', async () => {
        await keepDraft({ dirty: true, updatedAt: 1_800_000_000_000 })
        convertedRoom('one')
        mounted = await openedSurface({ deck: { is_converted: true } })
        await vi.waitFor(() => expect(oldDraftNotice()).toBeDefined())
        const ownText = oldDraftNotice()!.textContent

        press('Dismiss')
        await vi.waitFor(() => expect(dialog.danger).toHaveBeenCalledTimes(1))
        const [confirmed] = fromAny<[{ onConfirm: () => void }], unknown>(
          vi.mocked(dialog.danger).mock.lastCall,
        )
        confirmed.onConfirm()

        await vi.waitFor(() => expect(oldDraftNotice()?.textContent).not.toBe(ownText))
        expect(oldDraftNotice()).toBeDefined()
        expect(await drafts()).toEqual([])
        expect(await sharedDrafts()).toEqual([mounted.docname])
      })

      it('a viewer leaves it where it is, and sees no copy', async () => {
        // a clean draft of its own, whose delete shows the open settled its drafts
        await keepDraft({ dirty: false })
        convertedRoom('one')
        mounted = await openedSurface({ role: 10, deck: { is_converted: true } })
        await vi.waitFor(async () => expect(await drafts()).toEqual([]))

        expect(oldDraftNotice()).toBeUndefined()
        expect(await sharedDrafts()).toEqual([mounted.docname])
      })
    })
  })

  describe('a page copy an earlier page kept', () => {
    const EARLIER = [{ clientId: 'gone', background: '#000000ff', elements: [] }]

    afterEach(() => localStorage.clear())

    // as an earlier page load leaves its unsent copy: under an id of its own, not this page's
    function keptByEarlierPage(slides: unknown[]) {
      keepRecovery('node-1', slides)
      const key = Object.keys(localStorage).find((stored) => stored.includes(':node-1:'))!
      localStorage.setItem(
        `${key.slice(0, key.lastIndexOf(':'))}:earlier`,
        localStorage.getItem(key)!,
      )
      localStorage.removeItem(key)
    }

    it('stays as it was past a later copy this page keeps', async () => {
      keptByEarlierPage(EARLIER)
      const room = roomOf('one')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

      room.setStatus({ saveState: 'failed', unsentCount: 1 })

      expect(readRecovery('node-1')).toEqual([
        expect.objectContaining({ slides: EARLIER, sticky: false }),
        expect.objectContaining({ slides: editorSlides.value }),
      ])
    })
  })

  describe('a combined presentation of converted sources', () => {
    afterEach(() => {
      savedStates.byNode.clear()
      savedStates.reads = []
    })

    function slideBackgrounds() {
      return fromAny<StoreSlide[], unknown>(editorSlides.value).map((slide) => slide.background)
    }

    function elementIdsOf(doc: Doc) {
      return slideIds(doc).flatMap((slide) => elementIds(doc, slide))
    }

    it('draws a source and its copy, which keeps every slide and element id', async () => {
      const source = roomOf('one', 'two').doc
      // a server copy starts from the source's state, so its ids are the same
      const copy = new Doc()
      applyUpdate(copy, encodeStateAsUpdate(source))
      setSlide(copy, 'one', { background: '#123456FF' })
      savedStates.byNode.set('source-node', source)
      savedStates.byNode.set('copy-node', copy)
      expect(elementIdsOf(copy)).toEqual(elementIdsOf(source))

      mounted = await openedSurface({
        composite: { source: { node: 'source-node' }, copy: { node: 'copy-node' } },
      })

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(4))
      expect(drawnTexts()).toEqual(
        ['one', 'two', 'one', 'two'].map((text) => expect.stringContaining(`>${text}</p>`)),
      )
      expect(slideBackgrounds()[0]).not.toBe('#123456FF')
      expect(slideBackgrounds()[2]).toBe('#123456FF')
    })

    it('draws all fourteen slides of the shipped Light and Dark templates', async () => {
      const file = path.resolve(
        __dirname,
        '../../../../../suite/slides/templates/system_templates.json',
      )
      const shipped: Array<{ title: string; state: string }> = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      )
      const docs = new Map<string, Doc>()
      for (const { title, state } of shipped) {
        const doc = new Doc()
        applyUpdate(doc, Buffer.from(state, 'base64'))
        docs.set(title, doc)
        savedStates.byNode.set(`${title}-node`, doc)
      }
      const lightIds = new Set(elementIdsOf(docs.get('Light')!))
      expect(elementIdsOf(docs.get('Dark')!).some((id) => lightIds.has(id))).toBe(true)

      mounted = await openedSurface({
        composite: { light: { node: 'Light-node' }, dark: { node: 'Dark-node' } },
      })

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(14))
      expect(slideBackgrounds()).toEqual([
        ...Array(7).fill('#FFFFFFFF'),
        ...Array(7).fill('#000000FF'),
      ])
      // the seven layouts: blank, title, title and subtitle, title, title and subtitle,
      // title and points, title and picture
      const counts = [0, 1, 2, 1, 2, 2, 2]
      const drawn = fromAny<StoreSlide[], unknown>(editorSlides.value)
      expect(drawn.map((slide) => slide.elements.length)).toEqual([...counts, ...counts])
      expect(drawnTexts()[5]).toContain('Insert second point here')
      expect(drawnTexts()[12]).toContain('Insert second point here')
    })
  })

  describe('naming a version', () => {
    async function openedLive() {
      const room = roomOf('one')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      requireTestElement(mounted.root.querySelector('[data-versions]'), HTMLElement).click()
      await vi.waitFor(() => expect(versionsPanel.isOpen).toBe(true))
      return room
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('goes ahead once the edits are saved, sending them first', async () => {
      const room = await openedLive()

      await versionsPanel.saveFirst()

      expect(room.flush).toHaveBeenCalled()
    })

    it('refuses while the edits could not be saved', async () => {
      const room = await openedLive()
      room.setStatus({ saveState: 'failed', unsentCount: 1 })

      await expect(versionsPanel.saveFirst()).rejects.toThrow(
        'No version was taken: your changes could not be saved.',
      )
    })

    it('refuses once ten seconds pass with the edits still held', async () => {
      const room = await openedLive()
      room.setStatus({ saveState: 'unsaved', unsentCount: 1 })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const naming = expect(versionsPanel.saveFirst()).rejects.toThrow(
        'No version was taken: your changes are still saving. Try again in a moment.',
      )
      await vi.advanceTimersByTimeAsync(10_000)

      await naming
    })
  })

  describe('the presentation menu', () => {
    function menuEntry(label: string) {
      return Array.from(mounted!.root.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )
    }

    it('opens the versions panel to name a version once the closing menu gives focus back', async () => {
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      const namings = versionsPanel.namings

      requireTestElement(menuEntry('Save version'), HTMLElement).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(versionsPanel.namings).toBe(namings)
      requireTestElement(
        mounted.root.querySelector('[aria-label="Presentation menu"]'),
        HTMLElement,
      ).dispatchEvent(new FocusEvent('focus'))

      await vi.waitFor(() => expect(versionsPanel.namings).toBe(namings + 1))
      expect(versionsPanel.isOpen).toBe(true)
    })

    it('offers no Save version to someone who can only view', async () => {
      mounted = await openedSurface({ role: 10 })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(served.slides.length))

      expect(menuEntry('Shortcuts')).toBeDefined()
      expect(menuEntry('Save version')).toBeUndefined()
    })
  })

  describe('restoring a version', () => {
    // a version as the panel lists it
    function listed(seq: number) {
      return fromPartial<DocumentVersion>({ seq, kind: 'auto', label: null })
    }

    // a version as the server stores one: the Yjs state gzipped, then base64, in a JSON record
    async function storedVersion(doc: Doc) {
      const stream = new Response(new Uint8Array(encodeStateAsUpdate(doc))).body!.pipeThrough(
        new CompressionStream('gzip'),
      )
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
      const state = btoa(String.fromCharCode(...compressed))
      const record = { schema: 'slides-document/2', codec: 'yjs1', lineage: 'l1', state }
      return new TextEncoder().encode(JSON.stringify(record))
    }

    async function openVersions() {
      requireTestElement(mounted!.root.querySelector('[data-versions]'), HTMLElement).click()
      await vi.waitFor(() => expect(versionsPanel.isOpen).toBe(true))
    }

    it('asks first, then restores it in the editor for everyone and lists the versions again', async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      versionBytes.current = await storedVersion(roomOf('then').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      const reloads = versionsPanel.reloads

      versionsPanel.restore(listed(3))
      await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
      const [asked] = fromAny<[{ message: string; onConfirm: () => Promise<void> }], unknown>(
        vi.mocked(dialog.confirm).mock.lastCall,
      )
      expect(versionsPanel.canRestore).toBe(true)
      expect(asked.message).toBe(
        'The presentation goes back to this version for everyone. Its current state is kept as a version first.',
      )
      await asked.onConfirm()

      expect(room.restoreVersion).toHaveBeenCalledWith(3, expect.any(Function))
      await vi.waitFor(() => expect(drawnTexts()).toEqual([expect.stringContaining('>then</p>')]))
      expect(toast.success).toHaveBeenCalledWith('Version restored')
      expect(versionsPanel.reloads).toBe(reloads + 1)
    })

    it('offers the stored file of a version it cannot read, and neither asks nor restores', async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      versionBytes.current = new TextEncoder().encode('not a version')
      const files = vi.fn((_file: File) => 'blob:version')
      URL.createObjectURL = fromPartial<typeof URL.createObjectURL>(files)
      URL.revokeObjectURL = () => {}

      vi.mocked(dialog.confirm).mockClear()
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()

      versionsPanel.restore(listed(3))
      const message = "This version can't be read, so it can't be restored. You can download it."
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, expect.anything()))
      const [, options] = fromAny<
        [string, { action: { label: string; onClick: () => void } }],
        unknown
      >(vi.mocked(toast.error).mock.calls.find(([text]) => text === message))
      expect(options.action.label).toBe('Download')
      options.action.onClick()

      const [[file]] = files.mock.calls
      expect(file.name).toBe('Quarterly plan (v3).json')
      expect(await file.text()).toBe('not a version')
      expect(dialog.confirm).not.toHaveBeenCalled()
      expect(room.restoreVersion).not.toHaveBeenCalled()
    })

    function previewOf(root: Element) {
      return root.querySelector('[aria-label="Version preview"]')
    }

    it('shows a version read-only in the canvas place, steps through its slides, and Escape goes back', async () => {
      const live = convertedRoom('now')
      versionBytes.current = await storedVersion(roomOf('first', 'second').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      const before = Array.from(encodeStateAsUpdate(live))
      const writes = vi.fn()
      live.on('update', writes)

      versionsPanel.preview(listed(3))
      await vi.waitFor(() => expect(previewOf(mounted!.root)?.textContent).toContain('first'))
      const preview = requireTestElement(previewOf(mounted.root), HTMLElement)
      expect(preview.textContent).toContain('1 of 2')
      expect(mounted.root.querySelector('[data-toolbar]')).toBeNull()
      expect(versionsPanel.previewed?.seq).toBe(3)

      requireTestElement(preview.querySelector('[aria-label="Next slide"]'), HTMLElement).click()
      await vi.waitFor(() => expect(preview.textContent).toContain('second'))
      expect(preview.textContent).toContain('2 of 2')

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await vi.waitFor(() => expect(previewOf(mounted!.root)).toBeNull())
      expect(versionsPanel.previewed).toBeNull()
      expect(mounted.root.querySelector('[data-toolbar]')).not.toBeNull()
      expect(drawnTexts()).toEqual([expect.stringContaining('>now</p>')])
      // showing a version never writes to the live presentation
      expect(writes).not.toHaveBeenCalled()
      expect(Array.from(encodeStateAsUpdate(live))).toEqual(before)
    })

    it('leaves the live presentation alone when edit shortcuts are pressed over a version', async () => {
      const live = convertedRoom('now')
      versionBytes.current = await storedVersion(roomOf('first').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      versionsPanel.preview(listed(3))
      await vi.waitFor(() => expect(previewOf(mounted!.root)?.textContent).toContain('first'))
      const before = Array.from(encodeStateAsUpdate(live))

      for (const combo of ['Mod+A', 'Delete', 'Backspace', 'Mod+D', 'Enter', 'Mod+Z', 'Mod+Y']) {
        await press(combo)
      }

      expect(Array.from(encodeStateAsUpdate(live))).toEqual(before)
    })

    it('shows an old version from its rows', async () => {
      convertedRoom('now')
      const elements = [{ id: 'element-old', type: 'text', content: '<p>before collaboration</p>' }]
      const record = { schema: 'presentation/1', slides: [{ elements: JSON.stringify(elements) }] }
      versionBytes.current = new TextEncoder().encode(JSON.stringify(record))
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()

      versionsPanel.preview(listed(1))

      await vi.waitFor(() =>
        expect(previewOf(mounted!.root)?.textContent).toContain('before collaboration'),
      )
      expect(previewOf(mounted.root)?.textContent).toContain('1 of 1')
    })

    // an old version the server's upgrade refuses: the restore is asked for, then refused with a Download
    async function refusedDownload(slides: unknown[]) {
      const record = { schema: 'presentation/1', slides }
      versionBytes.current = new TextEncoder().encode(JSON.stringify(record))
      versionConversion.answer = { reason: "some of its content can't be upgraded" }
      vi.mocked(dialog.confirm).mockClear()
      vi.mocked(toast.error).mockClear()
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()

      versionsPanel.restore(listed(1))
      await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
      const [asked] = fromAny<[{ onConfirm: () => Promise<void> }], unknown>(
        vi.mocked(dialog.confirm).mock.lastCall,
      )
      await asked.onConfirm()
      const message =
        "This version couldn't be upgraded, so it can't be restored. You can download it. Reason: some of its content can't be upgraded."
      const [, options] = fromAny<
        [string, { action: { label: string; onClick: () => void } }],
        unknown
      >(vi.mocked(toast.error).mock.calls.find(([text]) => text === message))
      expect(options.action.label).toBe('Download')
      options.action.onClick()
    }

    // an old slide row, its elements kept as JSON text
    function oldSlide(text: string) {
      const content = `<p>${text}</p>`
      return { elements: JSON.stringify([{ id: `element-${text}`, type: 'text', content }]) }
    }

    it('prints a refused old version it can draw, from the preview, and restores nothing', async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      const before = Array.from(encodeStateAsUpdate(room.doc))
      const print = vi.fn()
      window.print = print

      await refusedDownload([oldSlide('old one'), oldSlide('old two')])

      await vi.waitFor(() => expect(print).toHaveBeenCalledOnce())
      const printed = fromAny<Array<{ elements: Array<{ content: string }> }>, unknown>(
        exported.slides,
      )
      expect(printed.map((slide) => slide.elements[0].content)).toEqual([
        '<p>old one</p>',
        '<p>old two</p>',
      ])
      expect(previewOf(mounted!.root)?.textContent).toContain('old one')
      expect(versionsPanel.previewed?.seq).toBe(1)
      expect(room.restoreVersion).not.toHaveBeenCalled()
      expect(Array.from(encodeStateAsUpdate(room.doc))).toEqual(before)
    })

    it('downloads the stored file of a refused old version it cannot draw', async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      const files = vi.fn((_file: File) => 'blob:version')
      const print = vi.fn()

      window.print = print
      URL.createObjectURL = fromPartial<typeof URL.createObjectURL>(files)
      URL.revokeObjectURL = () => {}

      await refusedDownload([null])

      await vi.waitFor(() => expect(files).toHaveBeenCalledOnce())
      const [[file]] = files.mock.calls
      expect(file.name).toBe('Quarterly plan (v1).json')
      expect(JSON.parse(await file.text())).toEqual({ schema: 'presentation/1', slides: [null] })
      expect(print).not.toHaveBeenCalled()
      expect(previewOf(mounted!.root)).toBeNull()
      expect(room.restoreVersion).not.toHaveBeenCalled()
    })

    it("prints a version's slides when the list's Download is picked, and restores nothing", async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      versionBytes.current = await storedVersion(roomOf('then one', 'then two').doc)
      const print = vi.fn()
      window.print = print
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()

      versionsPanel.download(listed(3))

      await vi.waitFor(() => expect(print).toHaveBeenCalledOnce())
      const printed = fromAny<Array<{ elements: Array<{ content: string }> }>, unknown>(
        exported.slides,
      )
      expect(printed.map((slide) => slide.elements[0].content)).toEqual([
        expect.stringContaining('then one'),
        expect.stringContaining('then two'),
      ])
      expect(room.restoreVersion).not.toHaveBeenCalled()
      expect(drawnTexts()).toEqual([expect.stringContaining('>now</p>')])
    })

    it("restores from the bar over a shown version, and the bar's Back to current leaves it", async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      versionBytes.current = await storedVersion(roomOf('then').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      versionsPanel.preview(listed(3))
      await vi.waitFor(() => expect(previewOf(mounted!.root)?.textContent).toContain('then'))
      vi.mocked(dialog.confirm).mockClear()

      requireTestElement(
        mounted.root.querySelector('[aria-label="Restore this version"]'),
        HTMLElement,
      ).click()
      await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
      expect(room.restoreVersion).not.toHaveBeenCalled()

      // the Button stub keeps its label as an attribute
      requireTestElement(
        mounted.root.querySelector('[label="Back to current"]'),
        HTMLElement,
      ).click()
      await vi.waitFor(() => expect(previewOf(mounted!.root)).toBeNull())
      expect(versionsPanel.previewed).toBeNull()
      expect(drawnTexts()).toEqual([expect.stringContaining('>now</p>')])
    })

    it('asks first, then has the server restore a presentation on its rows and reads it again', async () => {
      mounted = await openedSurface()
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(served.slides.length))
      await openVersions()
      const restores = vi.spyOn(mounted.session.versions, 'restore')
      const reloads = versionsPanel.reloads
      // the rows the server holds once it has restored the version
      const restored = [...served.slides, { clientId: 'c3', background: '#ffffffff', elements: [] }]
      mounted.loads.push(
        Promise.resolve(
          new Response(
            JSON.stringify({ message: { ...served, name: mounted.docname, slides: restored } }),
          ),
        ),
      )

      versionsPanel.restore(listed(3))
      await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
      const [asked] = fromAny<[{ message: string; onConfirm: () => Promise<void> }], unknown>(
        vi.mocked(dialog.confirm).mock.lastCall,
      )
      expect(asked.message).toBe(
        'The presentation goes back to this version. Its current state is kept as a new version first.',
      )
      expect(restores).not.toHaveBeenCalled()
      await asked.onConfirm()

      expect(restores).toHaveBeenCalledWith('3')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
      expect(toast.success).toHaveBeenCalledWith('Version restored')
      expect(versionsPanel.reloads).toBe(reloads + 1)
    })

    it('tells this tab when someone else restored a version, and lists the versions again', async () => {
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      const reloads = versionsPanel.reloads

      const [{ onVersionRestored }] = fromAny<
        [{ onVersionRestored: (restored: unknown) => void }],
        unknown
      >(collabRoom.open.mock.lastCall)
      onVersionRestored({ by: null, version: null })

      await vi.waitFor(() =>
        expect(toast.info).toHaveBeenCalledWith(
          'Someone restored an earlier version of this presentation.',
        ),
      )
      expect(versionsPanel.reloads).toBe(reloads + 1)
    })
  })

  describe('centred text restored while its font is still loading', () => {
    const CENTRED = 'translate(-50%, -50%)'
    const SAVED_TOP = 200
    const FALLBACK_HEIGHT = 40
    const FONT_HEIGHT = 100
    const TOP_IN_THE_FONT = SAVED_TOP - FONT_HEIGHT / 2
    const browser = {
      status: 'loaded',
      height: FONT_HEIGHT,
      ready: Promise.resolve<unknown>(undefined),
      fontArrives: () => {},
    }

    beforeEach(() => {
      Object.assign(browser, { status: 'loaded', height: FONT_HEIGHT, ready: Promise.resolve() })
      Object.defineProperty(document, 'fonts', { configurable: true, value: browser })
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
        () => browser.height,
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
      Reflect.deleteProperty(document, 'fonts')
    })

    function fontStartsLoading() {
      browser.status = 'loading'
      browser.height = FALLBACK_HEIGHT
      browser.ready = new Promise((resolve) => {
        browser.fontArrives = () => {
          browser.status = 'loaded'
          browser.height = FONT_HEIGHT
          resolve(browser)
        }
      })
    }

    // a co-editor deletes a slide, this tab opens without it, the co-editor undoes that
    async function openedWithSlideRestored() {
      const room = roomOf('one', 'two')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      const { doc } = room
      const [first, second] = drawnSlides(doc)
      const [element] = second.elements
      for (const { id } of [...first.elements, element]) {
        setElement(doc, id, {
          frame: { left: 100, top: SAVED_TOP, width: 300, transform: CENTRED },
        })
      }

      const peer = new UndoManager([doc.getMap(ROOT.slides), doc.getMap(ROOT.elements)], {
        trackedOrigins: new Set(['peer']),
      })
      doc.transact(() => deleteSlide(doc, second.clientId), 'peer')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

      fontStartsLoading()
      peer.undo()
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))

      const saved = () =>
        doc.getMap<Map<string, unknown>>(ROOT.elements).get(element.id)!.get('frame')
      return { doc, saved }
    }

    const restored = () => fromAny<StoreSlide[], unknown>(editorSlides.value)[1].elements[0]

    async function setOpacity(opacity: number) {
      restored().opacity = opacity
      askLivePush()
      await nextTick()
    }

    it('saves the position worked out in the font, once it has arrived', async () => {
      const { saved } = await openedWithSlideRestored()

      browser.fontArrives()

      await vi.waitFor(() => expect(restored().top).toBe(TOP_IN_THE_FONT))
      expect(saved()).toMatchObject({ top: SAVED_TOP, transform: CENTRED })

      await setOpacity(50)

      expect(saved()).toMatchObject({ top: TOP_IN_THE_FONT, transform: 'none' })
    })

    it('saves an edit still unsent when the font arrives, and not its measured position', async () => {
      const { doc, saved } = await openedWithSlideRestored()

      restored().opacity = 50
      browser.fontArrives()

      await vi.waitFor(() => expect(restored().top).toBe(TOP_IN_THE_FONT))
      expect(restored().opacity).toBe(50)
      expect(drawnSlides(doc)[1].elements[0].opacity).toBe(50)
      expect(saved()).toMatchObject({ top: SAVED_TOP, transform: CENTRED })
    })

    it('keeps the saved centre through an edit made before the font arrives', async () => {
      const { doc, saved } = await openedWithSlideRestored()

      await setOpacity(50)

      expect(saved()).toMatchObject({ top: SAVED_TOP, transform: CENTRED })
      expect(drawnSlides(doc)[1].elements[0].opacity).toBe(50)

      browser.fontArrives()
      await vi.waitFor(() => expect(restored().top).toBe(TOP_IN_THE_FONT))
      await setOpacity(60)

      expect(saved()).toMatchObject({ top: TOP_IN_THE_FONT, transform: 'none' })
    })

    it('keeps right-aligned text on its edge at the first keystroke after the font arrives', async () => {
      const room = roomOf('one')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      const id = 'element-one'
      setElement(room.doc, id, { frame: { left: 500, top: 300, transform: CENTRED } })
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await vi.waitFor(() => expect(viewOnly.value).toBe(false))
      const rendered = { width: 100 }
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => rendered.width)
      registerElementDiv(id, Object.assign(document.createElement('div'), { contains: () => true }))
      const type = async (text: string, width: number) => {
        rendered.width = width
        const editor: Editor = fromAny(activeEditor.value)
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, text)
        await nextTick()
      }
      const drawnLeft = () =>
        fromPartial<Array<{ elements: Array<{ left: number }> }>>(editorSlides.value)[0].elements[0]
          .left
      const saved = () => room.doc.getMap<Map<string, unknown>>(ROOT.elements).get(id)!.get('frame')

      fontStartsLoading()
      focusElementId.value = id
      await vi.waitFor(() => expect(activeEditor.value).toBeTruthy())
      await nextTick()
      fromAny<Editor, unknown>(activeEditor.value).commands.setTextAlign('right')
      await type('x', 120)
      expect(saved()).toMatchObject({ left: 500, transform: CENTRED })

      rendered.width = 160
      browser.fontArrives()
      await vi.waitFor(() => expect(drawnLeft()).toBe(420))
      await nextTick()
      await type('y', 180)

      expect(saved()).toMatchObject({ left: 400, transform: 'none' })
    })
  })

  describe('with a text editor open when the room stops taking writes', () => {
    let editor: Editor

    async function openedWithEditor(focusedId: string | null) {
      const room = roomOf('one')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await vi.waitFor(() => expect(viewOnly.value).toBe(false))
      editor = new Editor({ extensions: [Document, Paragraph, Text] })
      activeEditor.value = editor
      focusElementId.value = focusedId
      return room
    }

    afterEach(() => {
      focusElementId.value = null
      activeEditor.value = null
      editor.destroy()
    })

    it('stops the editor taking typing, and lets it type again afterwards', async () => {
      const room = await openedWithEditor('e1')

      room.setStatus({ canWrite: false, pauseReason: 'server' })
      await vi.waitFor(() => expect(viewOnly.value).toBe(true))
      expect(editor.isEditable).toBe(false)

      room.setStatus({ canWrite: true, pauseReason: null })
      await vi.waitFor(() => expect(viewOnly.value).toBe(false))
      expect(editor.isEditable).toBe(true)
    })

    it('leaves an element that was only selected out of text editing afterwards', async () => {
      const room = await openedWithEditor(null)
      editor.setEditable(false)

      room.setStatus({ canWrite: false, pauseReason: 'server' })
      await vi.waitFor(() => expect(viewOnly.value).toBe(true))
      room.setStatus({ canWrite: true, pauseReason: null })
      await vi.waitFor(() => expect(viewOnly.value).toBe(false))

      expect(editor.isEditable).toBe(false)
    })
  })

  it('edits a converted presentation that another tab has open, with no lock between them', async () => {
    // ifAvailable with another tab holding the lock: granted nothing
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: async (_: string, __: LockOptions, hold: (lock: null) => unknown) => hold(null),
      },
    })
    convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    expect(inReadonlyMode.value).toBe(false)
  })

  it('draws a slide the room gains after it opened', async () => {
    const doc = convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    addSlide(doc)

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
  })

  function shownText() {
    const texts = drawnTexts()
    return texts[slideIndex.value ?? 0]
  }

  it('moves to a slide that is left when the shown one is deleted in the room', async () => {
    const doc = convertedRoom('one', 'two')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
    slideIndex.value = 1

    deleteSlide(doc, 'two')

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    expect(shownText()).toContain('>one</p>')
  })

  it('keeps showing the same slide when one before it is deleted in the room', async () => {
    const doc = convertedRoom('one', 'two', 'three')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
    slideIndex.value = 1

    deleteSlide(doc, 'one')

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
    expect(shownText()).toContain('>two</p>')
  })

  it('drops a room that opens after its presentation was left, so the next one keeps its own slides', async () => {
    let open!: (opened: unknown) => void
    collabRoom.open.mockReturnValueOnce(
      new Promise((resolve) => {
        open = resolve
      }),
    )
    const opens = collabRoom.open.mock.calls.length
    const left = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(collabRoom.open.mock.calls.length).toBeGreaterThan(opens))
    left.app.unmount()
    left.root.remove()
    mounted = await openedSurface()
    const own = drawnTexts()

    const room = roomOf('one', 'two', 'three')
    open({ state: 'live', room })

    await vi.waitFor(() => expect(room.close).toHaveBeenCalled())
    expect(drawnTexts()).toEqual(own)
    expect(thumbnails(mounted.root)).toHaveLength(served.slides.length)
  })

  describe('presenting it (Q12, Q175)', () => {
    const unwired = slidesRouter.currentRoute

    afterEach(() => {
      Object.assign(slidesRouter, { currentRoute: unwired })
      vi.mocked(slidesRouter.replace).mockReset()
    })

    // the show on its slide, its moves going through this surface's router
    async function presented(slide: number, ...texts: string[]) {
      const doc = convertedRoom(...texts)
      mounted = await openedSurface({
        path: `/present?slide=${slide}`,
        deck: { is_converted: true },
      })
      const { router } = mounted
      Object.assign(slidesRouter, { currentRoute: router.currentRoute })
      vi.mocked(slidesRouter.replace).mockImplementation((to) => router.replace(to))
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(texts.length))
      return doc
    }

    // what the running show draws
    function presentedText() {
      const drawn = fromPartial<{ elements: Array<{ content?: string }> } | undefined>(
        shownSlide.value,
      )
      return drawn?.elements.map((element) => element.content).join()
    }

    async function settle() {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    it('presents a converted presentation from its live room', async () => {
      await presented(2, 'one', 'two')
      await settle()

      expect(mounted!.router.currentRoute.value.name).toBe('slides-slideshow')
      expect(shown()).toBe(true)
      expect(presentedText()).toContain('>two</p>')
    })

    it('redraws the shown slide when a co-editor changes its text', async () => {
      const doc = await presented(1, 'one')
      const [element] = drawnSlides(doc)[0].elements
      const paragraph = fromPartial<XmlElement>(elementText(doc, element.id)!.get(0))

      fromPartial<XmlText>(paragraph.get(0)).insert(3, ' more')

      await vi.waitFor(() => expect(presentedText()).toContain('one more'))
    })

    it('keeps the shown slide up when a co-editor deletes it, and Next shows the one after it', async () => {
      const doc = await presented(2, 'one', 'two', 'three')

      deleteSlide(doc, 'two')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
      expect(presentedText()).toContain('>two</p>')

      changeSlideInSlideshow(slideIndex.value + 1)
      await settle()

      expect(presentedText()).toContain('>three</p>')
      expect(mounted!.router.currentRoute.value.query.slide).toBe('2')
    })

    it('keeps holding the shown slide when the one that took its place is deleted too', async () => {
      const doc = await presented(2, 'one', 'two', 'three', 'four')
      deleteSlide(doc, 'two')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))

      deleteSlide(doc, 'three')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
      expect(presentedText()).toContain('>two</p>')

      changeSlideInSlideshow(slideIndex.value + 1)
      await settle()
      expect(presentedText()).toContain('>four</p>')
    })

    it('goes from a held slide back to the one before it', async () => {
      const doc = await presented(2, 'one', 'two', 'three')
      deleteSlide(doc, 'two')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))

      changeSlideInSlideshow(slideIndex.value - 1)

      await vi.waitFor(() => expect(mounted!.router.currentRoute.value.query.slide).toBe('1'))
      expect(presentedText()).not.toContain('>two</p>')
    })

    it('ends the show on Next from a held last slide', async () => {
      const doc = await presented(2, 'one', 'two')
      deleteSlide(doc, 'two')
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      expect(presentedText()).toContain('>two</p>')
      expect(showSlideshowEndScreen.value).toBe(false)

      changeSlideInSlideshow(slideIndex.value + 1)
      await settle()

      expect(showSlideshowEndScreen.value).toBe(true)
    })

    // Q178′: the show draws a blank slide on zero slides without writing, as a viewer does
    it('writes no blank slide when a co-editor empties the presentation it shows', async () => {
      const doc = await presented(1, 'one')
      const written = vi.fn()
      doc.on('update', written)

      deleteSlide(doc, 'one')
      await settle()

      expect(slideIds(doc)).toEqual([])
      expect(written).toHaveBeenCalledOnce()

      // past the held slide, the blank it draws in its place
      changeSlideInSlideshow(slideIndex.value + 1)
      await settle()
      expect(mounted!.router.currentRoute.value.name).toBe('slides-slideshow')
      expect(presentedText()).toBe('')
      expect(slideIds(doc)).toEqual([])
    })

    it('writes no blank slide into an empty presentation the show opens on', async () => {
      const doc = convertedRoom()
      const written = vi.fn()
      doc.on('update', written)
      mounted = await openedSurface({ path: '/present?slide=1', deck: { is_converted: true } })
      await settle()

      expect(mounted.router.currentRoute.value.name).toBe('slides-slideshow')
      expect(slideIds(doc)).toEqual([])
      expect(written).not.toHaveBeenCalled()
    })

    it('adds a real blank slide to an empty presentation once the show is left for the editor', async () => {
      const doc = convertedRoom()
      mounted = await openedSurface({ path: '/present?slide=1', deck: { is_converted: true } })
      await settle()

      const { params } = mounted.router.currentRoute.value
      await mounted.router.replace({ name: 'document-host', params })
      await settle()

      const [blank] = slideIds(doc)
      expect(slideIds(doc)).toHaveLength(1)
      expect(
        fromAny<StoreSlide[], unknown>(editorSlides.value).map(({ clientId }) => clientId),
      ).toEqual([blank])
      await elementStore.addShapeElement('rectangle')
      await settle()
      expect(elementIds(doc, blank)).toHaveLength(1)
    })

    it('starts the slideshow from Mod+P', async () => {
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      document.documentElement.requestFullscreen = vi.fn(async () => {})

      await press('Mod+P')

      expect(slidesRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'slides-slideshow' }),
      )
    })

    it('turns Present and Export on', async () => {
      convertedRoom('one')
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

      const present = mounted.root.querySelector('header [aria-label="Present"]')
      const exportButton = mounted.root.querySelector('header [aria-label="Export"]')
      // the stand-ins are divs, which keep the value as written
      expect(present?.getAttribute('disabled')).toBe('false')
      expect(exportButton?.getAttribute('disabled')).toBe('false')
    })
  })

  // Q13
  it("prints the tab's live slides, with a co-editor's change since it opened", async () => {
    window.print = vi.fn()
    const doc = convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    const [element] = drawnSlides(doc)[0].elements
    const paragraph = fromPartial<XmlElement>(elementText(doc, element.id)!.get(0))
    fromPartial<XmlText>(paragraph.get(0)).insert(3, ' more')
    await vi.waitFor(() => expect(drawnTexts()[0]).toContain('one more'))

    mounted.root.querySelector<HTMLElement>('header [aria-label="Export"]')!.click()

    await vi.waitFor(() => expect(window.print).toHaveBeenCalledOnce())
    const printed = fromAny<Array<{ elements: Array<{ content?: string }> }>, unknown>(
      exported.slides,
    )
    expect(printed).toHaveLength(1)
    expect(printed[0].elements[0].content).toContain('one more')
  })

  describe('read by everyone through its room (Q11, Q138)', () => {
    afterEach(() => {
      signedIn.user = 'me@example.com'
      vi.unstubAllGlobals()
    })

    // a room the server opened for someone it takes no edits from
    function readOnlyRoom(...texts: string[]) {
      const room = roomOf(...texts)
      room.status.canWrite = false
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      return room.doc
    }

    function signInLink() {
      return [...document.querySelectorAll('a')].find(
        (link) => link.textContent === 'Sign in to edit',
      )
    }

    it("shows a guest the room's slides, and a co-editor's new one", async () => {
      signedIn.user = null
      const doc = readOnlyRoom('one')
      mounted = await openedSurface({ role: 10, deck: { is_converted: true } })
      await vi.waitFor(() => expect(drawnTexts()).toHaveLength(1))
      expect(drawnTexts()[0]).toContain('>one</p>')

      addSlide(doc)

      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(2))
      expect(viewOnly.value).toBe(true)
    })

    it('asks a guest whose link lets them edit to sign in, back to this page', async () => {
      signedIn.user = null
      readOnlyRoom('one')
      mounted = await openedSurface({ role: 50, deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

      await vi.waitFor(() => expect(signInLink()).toBeDefined())
      expect(signInLink()!.getAttribute('href')).toBe(
        `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
      )
      expect(viewOnly.value).toBe(true)
    })

    it.each([
      ['a guest whose link only reads', null, 10],
      ['a signed-in editor', 'me@example.com', 50],
    ])('asks %s for no sign-in', async (_label, user, role) => {
      signedIn.user = user
      readOnlyRoom('one')
      mounted = await openedSurface({ role, deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(signInLink()).toBeUndefined()
    })

    it("shows a phone the room's slides, and a co-editor's new one", async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      const doc = convertedRoom('one')
      mounted = await openedSurface({ role: 10, deck: { is_converted: true } })
      await vi.waitFor(() => expect(drawnTexts()).toHaveLength(1))
      expect(drawnTexts()[0]).toContain('>one</p>')

      addSlide(doc)

      await vi.waitFor(() => expect(drawnTexts()).toHaveLength(2))
    })
  })

  it('says a converted presentation could not open when its room does not, and draws no rows', async () => {
    mounted = await openedSurface({ deck: { is_converted: true } })

    await vi.waitFor(() =>
      expect(mounted!.root.textContent).toContain('Could not open this presentation.'),
    )
    expect(thumbnails(mounted.root)).toHaveLength(0)
  })

  it('puts the notice in the slide area beside the side panel, not above both', async () => {
    mounted = await openedSurface({ deck: { conversion: { state: 'refused' } } })

    const notice = mounted.root.querySelector('p[role="status"]')
    expect(notice?.parentElement?.querySelector(':scope > nav')).not.toBeNull()
  })

  describe("a new presentation's theme pick", () => {
    interface LayoutFixture {
      background?: string
      elements: Array<{ id: string; type: string; content?: string; src?: string }>
    }

    function template(name: string, title: string, layouts: LayoutFixture[]) {
      return {
        name,
        title,
        slug: name,
        creation: '2026-11-01',
        is_template: 1,
        node: `${name}-node`,
        is_converted: false,
        thumbnails: [],
        layouts: layouts.map((layout, at) => ({
          name: `${name}-row-${at + 1}`,
          idx: at + 1,
          parent: name,
          client_id: `${name}-slide-${at + 1}`,
          transition: 'None',
          ...layout,
          elements: JSON.stringify(layout.elements),
        })),
      }
    }

    const dark = template('dark-template', 'Dark', [
      { elements: [{ id: 'dark-cover', type: 'text', content: '<p>Dark cover</p>' }] },
      { elements: [{ id: 'dark-cover-2', type: 'text', content: '<p>Dark second cover</p>' }] },
      {
        background: '#111111',
        elements: [
          { id: 'dark-title', type: 'text', content: '<p>Dark title</p>' },
          { id: 'dark-photo', type: 'image', src: '/files/dark-photo.png' },
        ],
      },
    ])
    const team = template('team-template', 'Team', [
      { elements: [{ id: 'team-first', type: 'text', content: '<p>Team first</p>' }] },
      { elements: [{ id: 'team-second', type: 'text', content: '<p>Team second</p>' }] },
      { elements: [{ id: 'team-third', type: 'text', content: '<p>Team third</p>' }] },
    ])

    // an earlier test may have left its templates listed and read
    beforeEach(() => {
      templateList.value = []
      forgetTemplates.run()
    })

    afterEach(() => {
      templateList.value = []
      forgetTemplates.run()
    })

    // a presentation Drive just made with Slides collaboration on: one blank slide in its room
    function blankRoom() {
      const room = roomOf('one')
      deleteElement(room.doc, 'element-one')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      return room.doc
    }

    async function openedNew() {
      templates.list = [dark, team]
      mounted = await openedSurface({ path: '?new=1', deck: { is_converted: true } })
      await vi.waitFor(() => expect(templateList.value).toHaveLength(2))
    }

    function calls(method: string) {
      return server.fetch.mock.calls.filter(([url]) => String(url).includes(method))
    }

    function bodyOf(method: string) {
      const [[, init]] = calls(method)
      return JSON.parse(String(init?.body))
    }

    function shownTexts(doc: Doc) {
      return drawnSlides(doc).map(({ elements }) =>
        elements.map((element) => element.content ?? element.src),
      )
    }

    function themePick() {
      return mounted!.root.querySelector('[data-theme-pick]')
    }

    it('is offered on a presentation in its room', async () => {
      blankRoom()
      await openedNew()

      await vi.waitFor(() => expect(themePick()).not.toBeNull())
    })

    // a presentation with no room is read-only, so it lists no templates to wait on
    it.each([
      ['a pending', { conversion: { state: 'pending' } }],
      ['a refused', { conversion: { state: 'refused' } }],
      ['a row-only', {}],
    ])('is not offered on %s presentation', async (_state, deck) => {
      templates.list = [dark, team]
      mounted = await openedSurface({ path: '?new=1', deck })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(served.slides.length))
      await new Promise((resolve) => setTimeout(resolve))
      await nextTick()

      expect(themePick()).toBeNull()
    })

    it("fills the blank slide with a system theme's cover layout in the live presentation", async () => {
      const doc = blankRoom()
      const [blankId] = slideIds(doc)
      await openedNew()

      themeChange.create('dark-template')

      await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))
      expect(bodyOf('update_theme')).toMatchObject({ theme: 'dark-template' })
      expect(bodyOf('update_slide_attachments')).toMatchObject({ parent: mounted!.docname })
      expect(calls('apply_theme')).toEqual([])
      const [slide] = drawnSlides(doc)
      expect(drawnSlides(doc)).toHaveLength(1)
      expect(slide.clientId).toBe(blankId)
      expect(slide.background).toBe('#111111')
      expect(shownTexts(doc)).toEqual([
        [expect.stringContaining('Dark title'), 'adopted:/files/dark-photo.png'],
      ])
      const ids = slide.elements.map((element) => element.id)
      expect(ids).not.toContain('dark-title')
      expect(ids).not.toContain('dark-photo')
    })

    it("fills it with another template's first layout", async () => {
      const doc = blankRoom()
      await openedNew()

      themeChange.create('team-template')

      await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))
      expect(shownTexts(doc)).toEqual([[expect.stringContaining('Team first')]])
    })

    it('writes nothing when a co-editor adds an element while the pictures are adopted', async () => {
      const doc = blankRoom()
      const [blankId] = slideIds(doc)
      let release = () => {}
      slideAdoption.held = new Promise((resolve) => (release = resolve))
      await openedNew()

      themeChange.create('dark-template')
      await vi.waitFor(() => expect(calls('update_slide_attachments')).toHaveLength(1))
      doc.transact(
        () => addElement(doc, blankId, { type: 'image', src: 'theirs.png' }),
        'co-editor',
      )
      release()

      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Only a new, empty presentation can take a theme'),
      )
      expect(shownTexts(doc)).toEqual([['theirs.png']])
      expect(calls('update_theme')).toEqual([])
    })

    it('keeps the filled slide through an undo', async () => {
      const doc = blankRoom()
      await openedNew()
      themeChange.create('dark-template')
      await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))

      undoLive()
      await nextTick()

      expect(shownTexts(doc)).toEqual([
        [expect.stringContaining('Dark title'), 'adopted:/files/dark-photo.png'],
      ])
    })

    describe('templates on the content layer', () => {
      const DARK_PICTURES = [1, 2, 3].map((idx) => `/pictures/dark/thumbnail-${idx}.webp`)

      afterEach(() => {
        savedStates.byNode.clear()
        savedStates.reads = []
      })

      // the server sends a converted template's node and pictures, never its rows
      function savedTemplate(
        name: string,
        title: string,
        texts: string[],
        thumbnails: string[] = [],
      ) {
        savedStates.byNode.set(`${name}-node`, roomOf(...texts).doc)
        return {
          name,
          title,
          slug: name,
          creation: '2026-11-01',
          is_template: 1,
          node: `${name}-node`,
          is_converted: true,
          thumbnails,
          layouts: [],
        }
      }

      function layoutsOf(name: string) {
        return templateList.value.find((template) => template.name === name)?.layouts ?? []
      }

      async function opened(list: unknown[], path = '?new=1', deck = {}) {
        templates.list = list
        mounted = await openedSurface({ path, deck: { is_converted: true, ...deck } })
        await vi.waitFor(() => expect(templateList.value).toHaveLength(list.length))
      }

      it("fills the blank slide from a converted template's saved first slide", async () => {
        const doc = blankRoom()
        await opened([savedTemplate('brand', 'Brand', ['Brand first', 'Brand second'])])

        themeChange.create('brand')

        await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))
        expect(shownTexts(doc)).toEqual([[expect.stringContaining('Brand first')]])
        expect(slideIds(doc)).toHaveLength(1)
      })

      it('reads no saved template when the editor opens', async () => {
        collabRoom.open.mockResolvedValueOnce({ state: 'live', room: roomOf('one') })
        await opened([savedTemplate('brand', 'Brand', ['Brand first'])], '')
        await new Promise((resolve) => setTimeout(resolve))

        expect(savedStates.reads).toEqual([])
      })

      it("reads each template's saved state once", async () => {
        blankRoom()
        await opened([savedTemplate('brand', 'Brand', ['Brand first'])])
        await vi.waitFor(() => expect(layoutsOf('brand')).toHaveLength(1))

        themeChange.create('brand')

        await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))
        expect(savedStates.reads).toEqual(['brand-node'])
      })

      it("shows a system template's pictures and draws a user template", async () => {
        blankRoom()
        await opened([
          savedTemplate('dark', 'Dark', ['Dark one', 'Dark two', 'Dark three'], DARK_PICTURES),
          savedTemplate('brand', 'Brand', ['Brand first']),
        ])

        await vi.waitFor(() => expect(layoutsOf('brand')).toHaveLength(1))
        await vi.waitFor(() => expect(layoutsOf('dark')).toHaveLength(3))
        expect(layoutsOf('dark').map(({ thumbnail }) => thumbnail)).toEqual(DARK_PICTURES)
        expect(layoutsOf('brand')).toMatchObject([{ thumbnail: '', elements: [{ type: 'text' }] }])
      })

      it('draws a system template whose saved slides no longer match its pictures', async () => {
        blankRoom()
        const texts = ['Dark one', 'Dark new', 'Dark two', 'Dark three']
        await opened([savedTemplate('dark', 'Dark', texts, DARK_PICTURES)])

        await vi.waitFor(() => expect(layoutsOf('dark')).toHaveLength(4))
        expect(layoutsOf('dark').map(({ thumbnail }) => thumbnail)).toEqual(['', '', '', ''])
      })

      it('fills from the rows of a template not converted yet, reading no saved state', async () => {
        const doc = blankRoom()
        await opened([team])

        themeChange.create('team-template')

        await vi.waitFor(() => expect(calls('update_theme')).toHaveLength(1))
        expect(shownTexts(doc)).toEqual([[expect.stringContaining('Team first')]])
        expect(savedStates.reads).toEqual([])
      })

      it('leaves the slide blank when the saved template cannot be read', async () => {
        const doc = blankRoom()
        const brand = savedTemplate('brand', 'Brand', ['Brand first'])
        savedStates.byNode.set('brand-node', new TypeError('Failed to fetch'))
        await opened([brand])

        themeChange.create('brand')

        await vi.waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith('This theme has no slides to start from'),
        )
        expect(shownTexts(doc)).toEqual([[]])
        expect(calls('update_theme')).toEqual([])
      })

      it("adds a slide from the presentation's converted theme", async () => {
        const room = roomOf('one')
        collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
        await opened([savedTemplate('brand', 'Brand', ['Brand first'])], '', { theme: 'brand' })

        addEmptySlide()

        await vi.waitFor(() => expect(slideIds(room.doc)).toHaveLength(2))
        expect(shownTexts(room.doc)[1]).toEqual([expect.stringContaining('Brand first')])
      })
    })
  })
})

describe('the fonts a slide draws with', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
  })

  it('come with the surface, so every view of a presentation has them', async () => {
    mounted = await openedSurface()

    expect(slideStyles.fontsImported).toBe(true)
  })

  it('are left for the browser to fetch when a slide uses one, not all asked for on open', async () => {
    const load = vi.fn(async () => [])
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })

    mounted = await openedSurface()

    expect(load).not.toHaveBeenCalled()
  })
})

describe('printing a presentation', () => {
  let print: ReturnType<typeof vi.fn<() => void>>

  function clickExport() {
    document.querySelector<HTMLElement>('header [aria-label="Export"]')!.click()
  }

  beforeEach(() => {
    print = vi.fn<() => void>()
    window.print = print
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('waits for a font the drawn text uses', async () => {
    let finishLoading = () => {}
    const load = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          finishLoading = () => resolve([])
        }),
    )
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    mounted = await openedSurface()
    vi.useFakeTimers()

    clickExport()
    await vi.advanceTimersByTimeAsync(1000)

    expect(load).toHaveBeenCalledWith(expect.stringContaining('Anton'), 'Drawn')
    expect(load).not.toHaveBeenCalledWith(expect.stringContaining('Courier'), expect.anything())
    expect(print).not.toHaveBeenCalled()

    finishLoading()
    await vi.advanceTimersByTimeAsync(0)

    expect(print).toHaveBeenCalledOnce()
  })

  it('opens one print dialog when Export is clicked again during the wait', async () => {
    let finishLoading = () => {}
    const loading = new Promise<unknown[]>((resolve) => {
      finishLoading = () => resolve([])
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn(() => loading) },
    })
    mounted = await openedSurface()
    vi.useFakeTimers()

    clickExport()
    await vi.advanceTimersByTimeAsync(1000)
    clickExport()
    await vi.advanceTimersByTimeAsync(1000)
    finishLoading()
    await vi.advanceTimersByTimeAsync(1000)

    expect(print).toHaveBeenCalledOnce()

    clickExport()
    await vi.advanceTimersByTimeAsync(1000)

    expect(print).toHaveBeenCalledTimes(2)
  })

  it('prints anyway when the font wait fails, and a later Export still works', async () => {
    const load = vi.fn(() => {
      throw new Error('Unreadable font')
    })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    mounted = await openedSurface()
    vi.useFakeTimers()

    clickExport()
    await vi.advanceTimersByTimeAsync(1000)

    expect(print).toHaveBeenCalledOnce()

    clickExport()
    await vi.advanceTimersByTimeAsync(1000)

    expect(print).toHaveBeenCalledTimes(2)
  })

  it('still prints when a font never arrives', async () => {
    const load = vi.fn(() => new Promise<unknown[]>(() => {}))
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
    mounted = await openedSurface()
    vi.useFakeTimers()

    clickExport()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(load).toHaveBeenCalled()
    expect(print).toHaveBeenCalledOnce()
  })
})

describe('Slides panels', () => {
  it('offers a signed-out reader of a public presentation no comments or versions', async () => {
    mounted = await openedSurface({ panels: [] })
    await nextTick()

    expect(mounted.root.querySelector('[data-panels]')?.textContent).toBe('')
  })

  it('offers everyone else the panels their session names', async () => {
    mounted = await openedSurface()
    await nextTick()

    expect(mounted.root.querySelector('[data-panels]')?.textContent).toBe('comments,versions')
  })

  function openComments() {
    requireTestElement(mounted!.root.querySelector('[data-comments]'), HTMLButtonElement).click()
  }

  it('shows the presentation’s threads in the shared comment panel, named as a presentation', async () => {
    driveComments.threads = [
      { name: 'thread-1', anchor: 'document', resolved: false, comments: [] },
    ]
    mounted = await openedSurface({ role: 20 })

    openComments()

    await vi.waitFor(() => expect(commentPanel.attrs.threads).toHaveLength(1))
    const { threads, noun, places } = commentPanel.attrs
    const [thread] = fromAny<{ name: string }[], unknown>(threads)
    const flags = [commentPanel.attrs['can-comment'], commentPanel.attrs['can-edit-document']]
    expect([thread.name, noun, places, flags]).toEqual([
      'thread-1',
      'presentation',
      null,
      [true, false],
    ])
  })

  it('posts a comment on the whole presentation, with no text in the room to wait for', async () => {
    mounted = await openedSurface({ role: 20 })
    openComments()
    await vi.waitFor(() => expect(driveComments.reads).toBe(1))
    const drafts = fromAny<ReturnType<typeof useCommentDrafts>, unknown>(commentPanel.attrs.drafts)

    drafts.start('document')
    const [draft] = drafts.drafts.value
    drafts.write(draft, 'Looks good')
    await drafts.post(draft)

    expect([driveComments.sent, driveComments.reads]).toEqual([
      [['document', 'Looks good', undefined, draft.clientId]],
      2,
    ])
  })
})

describe('Slides offline copy', () => {
  const posted: string[] = []
  const register = vi.fn(async () => ({}))
  const unregister = vi.fn(async () => true)

  function offlineCopyButton() {
    return document.querySelector('[data-offline-copy]')
  }

  beforeEach(() => {
    posted.length = 0
    register.mockClear()
    unregister.mockClear()
    signedIn.user = 'me@example.com'
    vi.stubEnv('VITE_SLIDES_SW', '1')
    vi.stubGlobal('caches', {
      open: async () => ({ keys: async () => [] }),
      match: async () => undefined,
      delete: async () => true,
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register,
        getRegistration: async () => ({ unregister }),
        addEventListener: () => {},
        removeEventListener: () => {},
        controller: {
          postMessage: (message: string, [port]: MessagePort[]) => {
            posted.push(message)
            port.postMessage(true)
          },
        },
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    delete window.disable_slides_service_worker
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('offers the copy to the owner and registers the worker', async () => {
    mounted = await openedSurface()

    await vi.waitFor(() => expect(offlineCopyButton()).not.toBeNull())
    expect(register).toHaveBeenCalledWith('/service-worker.js')
  })

  describe('on a composite', () => {
    const groups = {
      a: [{ name: 'a1', idx: 1, parent: 'a', background: '#ffffffff', elements: [] }],
    }

    async function openedComposite() {
      mounted = await openedSurface({ composite: groups })
      await vi.waitFor(() =>
        expect(fromAny<StoreSlide[], unknown>(editorSlides.value)[0]?.name).toBe('a1'),
      )
      await nextTick()
    }

    it('offers no copy, even to the owner', async () => {
      await openedComposite()

      expect(offlineCopyButton()).toBeNull()
    })

    it.each([
      ['the owner', 'me@example.com'],
      ['someone else', 'someone@example.com'],
    ])('lets %s reach an earlier copy', async (_who, user) => {
      signedIn.user = user
      const next = fakeServer.opens + 1
      localStorage.setItem(`${RECORD_PREFIX}p${next}`, JSON.stringify({ node: 'node-1', keys: [] }))

      await openedComposite()

      expect(offlineCopyButton()).not.toBeNull()
    })
  })

  it('fetches each bundled font once through the worker, so it is there offline', async () => {
    const fonts: { url: string; isMarked: boolean }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/slides/fonts/')) {
        fonts.push({ url, isMarked: new Headers(init?.headers).has('x-slides-pin') })
      }

      return new Response('', { status: 404 })
    })

    mounted = await openedSurface()

    await vi.waitFor(() => expect(fonts.length).toBeGreaterThan(0))
    const urls = fonts.map(({ url }) => url)
    expect(urls).toContain('/assets/suite/slides/fonts/Anton/Anton-Regular-latin.woff2')
    expect(new Set(urls).size).toBe(urls.length)
    expect(fonts.some(({ isMarked }) => isMarked)).toBe(false)
  })

  it('fetches the fonts once a worker takes control, however late', async () => {
    const worker: EventTarget & { controller: object | null } = Object.assign(new EventTarget(), {
      register,
      controller: null,
    })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker })
    const fonts: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/slides/fonts/')) {
        fonts.push(url)
      }

      return new Response('', { status: 404 })
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    mounted = await openedSurface()
    await vi.advanceTimersByTimeAsync(10_000)
    vi.useRealTimers()
    expect(fonts).toEqual([])
    worker.controller = { postMessage: () => {} }
    worker.dispatchEvent(new Event('controllerchange'))

    await vi.waitFor(() =>
      expect(fonts).toContain('/assets/suite/slides/fonts/Anton/Anton-Regular-latin.woff2'),
    )
  })

  it('hides the copy from someone who is not the owner', async () => {
    signedIn.user = 'someone@example.com'
    mounted = await openedSurface()
    await nextTick()

    expect(offlineCopyButton()).toBeNull()
  })

  it('hides the copy in a browser without service workers', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    mounted = await openedSurface()
    await nextTick()

    expect(offlineCopyButton()).toBeNull()
  })

  it('hides the copy and unregisters the worker with the kill switch on', async () => {
    window.disable_slides_service_worker = true
    mounted = await openedSurface()

    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce())
    expect(register).not.toHaveBeenCalled()
    expect(offlineCopyButton()).toBeNull()
  })

  it('forgets every offline copy with the kill switch on', async () => {
    window.disable_slides_service_worker = true
    localStorage.setItem('slides-offline-copy:other', JSON.stringify({ node: 'n9', keys: [] }))
    mounted = await openedSurface()

    await vi.waitFor(() => expect(localStorage.getItem('slides-offline-copy:other')).toBeNull())
  })

  // an online visit refreshes the copy's start-up files (DESIGN-slides-offline §3)
  it.each([
    ['the owner', 'me@example.com', ['/d/node-1']],
    ['someone who is not the owner', 'someone@example.com', []],
  ])('refreshes the offline copy only for %s', async (_label, user, refreshed) => {
    signedIn.user = user
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response('', { status: 404 })
    })
    const next = fakeServer.opens + 1
    localStorage.setItem(
      `slides-offline-copy:p${next}`,
      JSON.stringify({ node: 'node-1', keys: [] }),
    )
    warms.length = 0
    mounted = await openedSurface()
    await Promise.allSettled(warms)

    expect(warms).toHaveLength(refreshed.length)
    expect(fetched.filter((url) => url.startsWith('/d/'))).toEqual(refreshed)
  })

  // Q18′: the copy holds no rows, as the server sends a live presentation's opening without them
  describe('on a presentation that went live', () => {
    function openedLive() {
      convertedRoom('one')
      return openedSurface({ deck: { is_converted: true } })
    }

    it('offers the copy to the owner', async () => {
      mounted = await openedLive()

      await vi.waitFor(() => expect(offlineCopyButton()).not.toBeNull())
    })

    it('hides the copy from someone who is not the owner', async () => {
      signedIn.user = 'someone@example.com'
      mounted = await openedLive()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(1))

      expect(offlineCopyButton()).toBeNull()
    })

    it("refreshes the owner's copy saved before it went live", async () => {
      const fetched: string[] = []
      vi.stubGlobal('fetch', async (url: string) => {
        fetched.push(url)
        return new Response('', { status: 404 })
      })
      const next = fakeServer.opens + 1
      localStorage.setItem(`${RECORD_PREFIX}p${next}`, JSON.stringify({ node: 'node-1', keys: [] }))
      warms.length = 0

      mounted = await openedLive()
      await vi.waitFor(() => expect(warms).toHaveLength(1))
      await Promise.allSettled(warms)

      expect(fetched).toContain('/d/node-1')
    })

    // the worker answers the start-up reads from the copy, and the room opens from the device
    it.each([
      ['an editor', 50, false],
      ['a viewer', 10, true],
    ])('opened offline, lets %s edit as they could online', async (_who, role, isViewOnly) => {
      const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      fakeServer.isFailingTemplates = true
      try {
        convertedRoom('one')
        mounted = await openedSurface({ role, deck: { is_converted: true } })

        await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
        expect(viewOnly.value).toBe(isViewOnly)
      } finally {
        offline.mockRestore()
      }
    })

    // a copy pinned before the upgrade answers with its rows, and only a live room takes edits
    it('opened offline from a copy that holds the rows, lets an editor edit nothing', async () => {
      const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      fakeServer.isFailingTemplates = true
      try {
        mounted = await openedSurface({ role: 50 })

        await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(served.slides.length))
        expect(viewOnly.value).toBe(true)
      } finally {
        offline.mockRestore()
      }
    })

    // its slides change in place, so only the pictures they name may bring a refresh
    it('refreshes for a new picture, and not for a text edit', async () => {
      vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
      const doc = convertedRoom('one')
      const next = fakeServer.opens + 1
      localStorage.setItem(`${RECORD_PREFIX}p${next}`, JSON.stringify({ node: 'node-1', keys: [] }))
      warms.length = 0
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(warms).toHaveLength(1))

      const [slide] = drawnSlides(doc)
      const paragraph = fromPartial<XmlElement>(elementText(doc, slide.elements[0].id)!.get(0))
      fromPartial<XmlText>(paragraph.get(0)).insert(3, ' more')
      await vi.waitFor(() => expect(JSON.stringify(editorSlides.value)).toContain('one more'))
      await nextTick()
      expect(warms).toHaveLength(1)

      doc.transact(() => addElement(doc, slide.clientId, { type: 'image', src: '/files/new.png' }))
      await vi.waitFor(() => expect(warms).toHaveLength(2))
    })

    describe('held by someone who is not the owner', () => {
      const looked: string[] = []

      function pinned(opening: Record<string, unknown>) {
        looked.length = 0
        vi.stubGlobal('caches', {
          open: async () => ({
            keys: async () => [],
            match: async (key: string) => {
              looked.push(key)
              return new Response(JSON.stringify({ message: opening }))
            },
            delete: async () => true,
          }),
          match: async () => undefined,
          delete: async () => true,
        })
        signedIn.user = 'someone@example.com'
        const record = `${RECORD_PREFIX}p${fakeServer.opens + 1}`
        // not node-1: a removed copy's node stays forgotten for the page, and later tests save node-1
        localStorage.setItem(record, JSON.stringify({ node: 'node-gone', keys: [] }))
        return record
      }

      it('removes a copy that holds the rows', async () => {
        const record = pinned({ name: 'p', slides: [{ name: 's1' }] })

        mounted = await openedLive()

        await vi.waitFor(() => expect(localStorage.getItem(record)).toBeNull())
      })

      it('keeps a copy that holds no rows', async () => {
        const record = pinned({ name: 'p', is_converted: true })

        mounted = await openedLive()
        await vi.waitFor(() => expect(looked).toHaveLength(1))
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(localStorage.getItem(record)).not.toBeNull()
      })

      it("keeps the next presentation's copy when a left one's room opens late", async () => {
        signedIn.user = 'someone@example.com'
        let open!: (opened: unknown) => void
        collabRoom.open.mockReturnValueOnce(
          new Promise((resolve) => {
            open = resolve
          }),
        )
        const opens = collabRoom.open.mock.calls.length
        const left = await openedSurface({ deck: { is_converted: true } })
        await vi.waitFor(() => expect(collabRoom.open.mock.calls.length).toBeGreaterThan(opens))
        left.app.unmount()
        left.root.remove()
        const record = pinned({ name: 'p', slides: [{ name: 's1' }] })
        mounted = await openedSurface()

        const room = roomOf('one')
        open({ state: 'live', room })
        await vi.waitFor(() => expect(room.close).toHaveBeenCalled())
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(looked).toEqual([])
        expect(localStorage.getItem(record)).not.toBeNull()
      })

      it('keeps the copy of a presentation still on its rows', async () => {
        const record = pinned({ name: 'p', slides: [{ name: 's1' }] })

        mounted = await openedSurface()
        await nextTick()

        expect(looked).toEqual([])
        expect(localStorage.getItem(record)).not.toBeNull()
      })
    })
  })

  describe('a presentation opened online', () => {
    function signOut() {
      document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }

    beforeEach(() => {
      visits.remember.mockReset()
      visits.remember.mockImplementation(() => Promise.resolve())
      visits.cancel.mockClear()
      document.cookie = 'user_id=me@example.com'
    })

    afterEach(signOut)

    it.each([
      ['an editor', 50],
      ['a viewer', 10],
    ])('is remembered for %s', async (_label, role) => {
      signedIn.user = 'someone@example.com'
      const next = fakeServer.opens + 1
      const docname = `p${next}`
      mounted = await openedSurface({ role })

      await vi.waitFor(() => expect(visits.remember).toHaveBeenCalledWith(docname))
    })

    it('is remembered for a presentation that went live', async () => {
      convertedRoom('one')
      const docname = `p${fakeServer.opens + 1}`
      mounted = await openedSurface({ deck: { is_converted: true } })

      await vi.waitFor(() => expect(visits.remember).toHaveBeenCalledWith(docname))
    })

    it('is not remembered for a guest', async () => {
      signOut()
      mounted = await openedSurface()
      await nextTick()

      expect(visits.remember).not.toHaveBeenCalled()
    })

    it('loads without waiting for the copy', async () => {
      visits.remember.mockImplementation(() => new Promise(() => {}))
      mounted = await openedSurface()

      await vi.waitFor(() => expect(visits.remember).toHaveBeenCalled())
      expect(offlineCopyButton()).not.toBeNull()
    })

    it('stops the copy when the surface goes away', async () => {
      mounted = await openedSurface()

      mounted.app.unmount()
      mounted.root.remove()
      mounted = null

      expect(visits.cancel).toHaveBeenCalledOnce()
    })
  })

  it('keeps the bytes of a picture Drive refused when a saved copy opens', async () => {
    const pinnedPicture = '/private/files/m1.png'
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      open: async () => ({
        keys: async () => [],
        put: async () => {},
        delete: async (key: string) => {
          deleted.push(key)
          return true
        },
      }),
      match: async () => undefined,
      delete: async () => true,
    })
    answersStartupReads()
    const next = fakeServer.opens + 1
    const record = `${RECORD_PREFIX}p${next}`
    localStorage.setItem(record, JSON.stringify({ node: 'node-1', keys: [pinnedPicture] }))
    const refused = {
      id: 'media-node-1',
      src: ref(null),
      cacheKey: ref('media-node-1'),
      status: ref<'refused'>('refused'),
      refresh: async () => {},
    }

    mounted = await openedSurface({
      slides: [
        {
          clientId: 'c1',
          background: '#ffffffff',
          elements: [{ id: 'e1', type: 'image', src: 'media-node-1' }],
        },
      ],
      media: () => fromPartial(refused),
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(deleted).toEqual([])
    expect(JSON.parse(localStorage.getItem(record) ?? '{}').keys).toContain(pinnedPicture)
  })

  describe('a saved composite copy opens', () => {
    const pinnedPicture = '/private/files/b.png'
    const groupSlides = [{ name: 'a1', idx: 1, parent: 'a', background: '#ffffffff', elements: [] }]

    function pinnedThenOpened(composite: Record<string, unknown[] | Error>) {
      const deleted: string[] = []
      vi.stubGlobal('caches', {
        open: async () => ({
          keys: async () => [],
          put: async () => {},
          delete: async (key: string) => {
            deleted.push(key)
            return true
          },
        }),
        match: async () => undefined,
        delete: async () => true,
      })
      answersStartupReads()
      const next = fakeServer.opens + 1
      const record = `${RECORD_PREFIX}p${next}`
      localStorage.setItem(record, JSON.stringify({ node: 'node-1', keys: [pinnedPicture] }))

      return { deleted, record, opening: openedSurface({ composite }) }
    }

    it('keeps the pictures of a group a dropped connection left out', async () => {
      const { deleted, record, opening } = pinnedThenOpened({
        a: groupSlides,
        b: new TypeError('Failed to fetch'),
      })

      mounted = await opening
      await vi.waitFor(
        () =>
          expect(fromAny<StoreSlide[], unknown>(editorSlides.value)[1]?.compositePlaceholder).toBe(
            'failed',
          ),
        { timeout: 5000 },
      )
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(deleted).toEqual([])
      expect(JSON.parse(localStorage.getItem(record) ?? '{}').keys).toContain(pinnedPicture)
    })

    it('clears a picture no group shows once every group has loaded', async () => {
      const { deleted, opening } = pinnedThenOpened({ a: groupSlides, b: groupSlides })

      mounted = await opening

      await vi.waitFor(() => expect(deleted).toEqual([pinnedPicture]))
    })
  })

  it('takes a refused picture as missing from the copy only while offline', async () => {
    function goes(state: 'online' | 'offline') {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => state === 'online',
      })
      window.dispatchEvent(new Event(state))
    }

    const next = fakeServer.opens + 1
    localStorage.setItem(`${RECORD_PREFIX}p${next}`, JSON.stringify({ node: 'node-1', keys: [] }))
    const refused = {
      id: 'media-node-1',
      src: ref(null),
      cacheKey: ref('media-node-1'),
      status: ref<'refused'>('refused'),
      refresh: async () => {},
    }
    mounted = await openedSurface({
      slides: [
        {
          clientId: 'c1',
          background: '#ffffffff',
          elements: [{ id: 'e1', type: 'image', src: 'media-node-1' }],
        },
      ],
      media: () => fromPartial(refused),
    })
    await vi.waitFor(() => expect(offlineCopyStatus.value).toBe('available'))

    try {
      goes('offline')
      await nextTick()
      expect(offlineCopyStatus.value).toBe('outdated')

      goes('online')
      await nextTick()
      expect(offlineCopyStatus.value).toBe('available')
    } finally {
      Reflect.deleteProperty(navigator, 'onLine')
    }
  })

  it('tells the worker when the presentation opens and closes', async () => {
    mounted = await openedSurface()
    await vi.waitFor(() => expect(posted).toEqual(['slides-entered']))

    mounted.app.unmount()
    mounted.root.remove()
    mounted = null

    expect(posted).toEqual(['slides-entered', 'slides-left'])
  })
})

describe('templates that fail to load', () => {
  startsFromEmptyStore()

  beforeEach(() => {
    // a theme pick's surface may still list the templates it read
    templateList.value = []
    forgetTemplates.run()
    fakeServer.isFailingTemplates = true
  })

  // only an editor reads the templates, and only a live room takes edits
  async function openedEditor() {
    convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
  }

  it('shows no toast offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await openedEditor()
    await loadTemplates()

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still says so online', async () => {
    await openedEditor()
    await loadTemplates()

    expect(toast.error).toHaveBeenCalledWith('Failed to fetch')
  })
})

describe('edit access changing on a converted presentation', () => {
  // a room for one slide, as the server converted it
  function liveRoom() {
    const answer = convertLegacy(
      { slides: [{ id: 's1', elements: [{ id: 'e1', type: 'text', content: '<p>one</p>' }] }] },
      4 * 1024 * 1024,
    )
    if (answer.kind !== 'converted') throw new Error(JSON.stringify(answer))

    const doc = new Doc()
    applyUpdate(doc, answer.state)
    const status: Partial<RoomStatus> = {
      canWrite: true,
      saveState: 'clean',
      unsentCount: 0,
      restoreRev: 0,
      isKeptOnDevice: true,
    }
    const room = {
      doc,
      close: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      restoreVersion: vi.fn(),
      status,
      presence: {
        awareness: new Awareness(doc),
        peers: [],
        ownPid: 1,
        ownArrival: 1,
        onChange: () => () => {},
      },
      onChange(listener: () => void) {
        changes.add(listener)
        return () => changes.delete(listener)
      },
      setStatus(next: Partial<RoomStatus>) {
        room.status = { ...room.status, ...next }
        changes.forEach((listener) => listener())
      },
      // As the client does: shut at once, and blocked for the lost right if work is still unsent
      loseAccess: vi.fn(async (lost: LostAccess) => {
        room.setStatus({ canWrite: false })
        if (room.status.unsentCount) {
          room.setStatus({ blockReason: lost })
        }
      }),
      // As the client does: a room shut with nothing kept takes edits again
      regainAccess: vi.fn(async (mayEdit: () => boolean) => {
        if (mayEdit() && !room.status.blockReason) {
          room.setStatus({ canWrite: true })
        }
      }),
    }
    const changes = new Set<() => void>()
    collabRoom.open.mockResolvedValue({ state: 'live', room })
    return room
  }

  // The room and the surface, drawn and editing
  async function editing() {
    const room = liveRoom()
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    return room
  }

  beforeEach(() => {
    vi.mocked(toast.warning).mockClear()
    vi.mocked(toast.info).mockClear()
  })

  afterEach(() => {
    collabRoom.open.mockReset()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('turns view only and says so when edit access goes', async () => {
    liveRoom()
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    mounted.access.value = { role: 10 }

    await vi.waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'Editing access changed. This presentation is now view only.',
      ),
    )
    expect(viewOnly.value).toBe(true)
  })

  it('keeps unsent edits on this device when edit access goes, and offers them as a download', async () => {
    const room = await editing()
    room.setStatus({ unsentCount: 1, saveState: 'unsaved' })
    const files: File[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
      if (file instanceof File) {
        files.push(file)
      }

      return 'blob:changes'
    })

    mounted!.access.value = { role: 10 }

    await vi.waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'Editing access changed. Your unsaved changes are kept on this device.',
        expect.anything(),
      ),
    )
    expect(room.loseAccess).toHaveBeenCalledWith('lost_edit')
    expect(readRecovery('node-1')).toMatchObject([{ sticky: true }])
    expect(toast.warning).not.toHaveBeenCalledWith(
      'Editing access changed. This presentation is now view only.',
    )
    const [, options] = fromAny<
      [string, { action: { label: string; onClick: () => void } }],
      unknown
    >(vi.mocked(toast.warning).mock.lastCall)
    expect(options.action.label).toBe('Download my changes')
    options.action.onClick()
    const downloaded = JSON.parse(await files[0]!.text())
    expect(JSON.stringify(downloaded.slides)).toContain('one')
  })

  it('shuts the room for reading when read access goes', async () => {
    const room = await editing()

    mounted!.access.value = { role: 0 }

    await vi.waitFor(() => expect(room.loseAccess).toHaveBeenCalledWith('lost_read'))
  })

  it('takes edits again in the same room when edit access comes back before the edits are sent', async () => {
    const room = await editing()
    room.setStatus({ unsentCount: 1, saveState: 'unsaved' })
    let send = () => {}
    const sending = new Promise<void>((resolve) => {
      send = resolve
    })
    room.loseAccess.mockImplementation(async () => {
      room.setStatus({ canWrite: false })
      await sending
    })
    room.regainAccess.mockImplementation(async (mayEdit) => {
      await sending
      if (mayEdit()) {
        room.setStatus({ canWrite: true })
      }
    })
    const opens = collabRoom.open.mock.calls.length
    mounted!.access.value = { role: 10 }
    await nextTick()

    mounted!.access.value = { role: 50 }
    send()

    await vi.waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('You can edit this presentation again.'),
    )
    // a load would close this room on its way to opening another
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(viewOnly.value).toBe(false)
    expect(room.close).not.toHaveBeenCalled()
    expect(collabRoom.open.mock.calls.length).toBe(opens)
  })

  it('stays on the shut room when its unsent edits are kept nowhere else', async () => {
    const room = await editing()
    room.setStatus({ unsentCount: 1, saveState: 'unsaved', isKeptOnDevice: false })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    mounted!.access.value = { role: 10 }
    await vi.waitFor(() => expect(room.status.blockReason).toBe('lost_edit'))

    mounted!.access.value = { role: 50 }
    await vi.waitFor(() => expect(room.regainAccess).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(room.close).not.toHaveBeenCalled()
    expect(viewOnly.value).toBe(true)
  })

  it('keeps the unsent edits of a room that failed as edit access came back past later copies', async () => {
    const room = await editing()
    room.setStatus({ unsentCount: 1, saveState: 'unsaved', isKeptOnDevice: false })
    let fail = () => {}
    const flushing = new Promise<void>((resolve) => {
      fail = resolve
    })
    room.loseAccess.mockImplementation(async () => {
      room.setStatus({ canWrite: false })
      await flushing
      room.setStatus({ saveState: 'failed' })
    })
    room.regainAccess.mockImplementation(async (mayEdit) => {
      await flushing
      if (mayEdit()) {
        room.setStatus({ canWrite: true })
      }
    })
    const next = liveRoom()
    mounted!.access.value = { role: 10 }
    await nextTick()
    mounted!.access.value = { role: 50 }
    fail()
    await vi.waitFor(() => expect(room.close).toHaveBeenCalled())
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    // the next room's own edits, kept as an ordinary copy as the tab closes
    const paragraph = fromPartial<XmlElement>(elementText(next.doc, 'e1')!.get(0))
    fromPartial<XmlText>(paragraph.get(0)).insert(3, ' more')
    next.setStatus({ unsentCount: 1, saveState: 'unsaved' })
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))

    await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(2))
    expect(JSON.stringify(readRecovery('node-1')[0]!.slides)).not.toContain('one more')
  })

  it('keeps the unsent edits of a room given up for a new one past later copies', async () => {
    const room = await editing()
    const next = liveRoom()
    room.setStatus({
      unsentCount: 1,
      saveState: 'unsaved',
      isKeptOnDevice: false,
      isReopenNeeded: true,
    })
    await vi.waitFor(() => expect(room.close).toHaveBeenCalled())
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    // the next room's own edits, kept as an ordinary copy as the tab closes
    const paragraph = fromPartial<XmlElement>(elementText(next.doc, 'e1')!.get(0))
    fromPartial<XmlText>(paragraph.get(0)).insert(3, ' more')
    next.setStatus({ unsentCount: 1, saveState: 'unsaved' })
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))

    await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(2))
    expect(JSON.stringify(readRecovery('node-1')[0]!.slides)).not.toContain('one more')
  })

  it('says nothing turned view only when edit access comes back while the room shuts', async () => {
    const room = await editing()
    let shut = () => {}
    room.loseAccess.mockImplementation(async () => {
      room.setStatus({ canWrite: false })
      await new Promise<void>((resolve) => {
        shut = resolve
      })
    })
    mounted!.access.value = { role: 10 }
    await nextTick()

    mounted!.access.value = { role: 50 }
    shut()

    await vi.waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('You can edit this presentation again.'),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('still turns view only and says so when the room fails to shut', async () => {
    const room = await editing()
    room.loseAccess.mockRejectedValue(new Error('socket gone'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mounted!.access.value = { role: 10 }

    await vi.waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'Editing access changed. This presentation is now view only.',
      ),
    )
    expect(viewOnly.value).toBe(true)
  })

  it('opens again to edit, and says so, when edit access comes back', async () => {
    liveRoom()
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    mounted.access.value = { role: 10 }
    await nextTick()

    mounted.access.value = { role: 50 }

    await vi.waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('You can edit this presentation again.'),
    )
    expect(viewOnly.value).toBe(false)
  })
})

describe('a presentation left while a request is out', () => {
  // only the next presentation has a black slide
  const slideB = { clientId: 'b1', background: '#000000ff', elements: [] }

  function shownBackgrounds() {
    return editorSlides.value.map((slide) => slide.background)
  }

  function leave() {
    mounted?.app.unmount()
    mounted?.root.remove()
  }

  it('keeps the next presentation when a group of the left one arrives', async () => {
    const group = Promise.withResolvers<unknown[]>()
    mounted = await openedSurface({ composite: { a: group.promise } })
    await vi.waitFor(() =>
      expect(server.fetch.mock.calls.some(([url]) => String(url).includes('composite_group'))).toBe(
        true,
      ),
    )

    leave()
    mounted = await openedSurface({ slides: [slideB] })
    group.resolve([{ name: 'a1', idx: 1, parent: 'a', background: '#ffffffff', elements: [] }])
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(presentationId.value).toBe(mounted.docname)
    expect(shownBackgrounds()).toEqual(['#000000ff'])
  })

  it('keeps the next presentation when a theme change of the left one finishes', async () => {
    // only a live room takes a theme change
    convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    const presentationA = mounted.docname
    const readA = server.fetch.getMockImplementation()!
    const write = Promise.withResolvers<void>()
    server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('theme')) {
        await write.promise
        return new Response(JSON.stringify({ message: { modified: 'M2', base_modified: 'M1' } }), {
          status: 200,
        })
      }

      return readA(url, init)
    })
    themeChange.update('Dark')
    await vi.waitFor(() =>
      expect(server.fetch.mock.calls.some(([url]) => String(url).includes('theme'))).toBe(true),
    )

    leave()
    mounted = await openedSurface({ slides: [slideB] })
    const readB = server.fetch.getMockImplementation()!
    // the left presentation's own read still answers with its own slides
    server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(init?.body).includes(presentationA)) {
        return readA(url, init)
      }

      return readB(url, init)
    })
    write.resolve()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(presentationId.value).toBe(mounted.docname)
    expect(shownBackgrounds()).toEqual(['#000000ff'])
  })
  it('keeps the next presentation when a layout slide of the left one is measured', async () => {
    mounted = await openedSurface()
    const fonts = Promise.withResolvers<void>()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: fonts.promise },
    })
    const centred = {
      type: 'text',
      content: 'Title',
      left: 480,
      top: 270,
      transform: 'translate(-50%, -50%)',
    }
    handleInsertSlide(0, { elements: [centred] })

    leave()
    mounted = await openedSurface({ slides: [slideB] })
    fonts.resolve()
    await new Promise((resolve) => setTimeout(resolve, 50))
    Reflect.deleteProperty(document, 'fonts')

    expect(shownBackgrounds()).toEqual(['#000000ff'])
  })
})

// Q17: copy out of a presentation still on its rows works, and nothing pastes into it
// The stand-in SlideContainer binds no clipboard events, so these call the handlers it binds
const clipboard = await import('@/apps/slides/stores/copyPaste')

describe('a slide copied from a presentation waiting for its upgrade', () => {
  const picture = { id: 'photo', type: 'image', src: '/files/waiting-photo.png' }
  const waitingSlides = [{ clientId: 'w1', background: '#ffffffff', elements: [picture] }]

  function copied() {
    let json = ''
    clipboard.handleCopy({
      target: document.body,
      preventDefault() {},
      clipboardData: { setData: (_type: string, data: string) => (json = data) },
    })
    return json
  }

  function paste(json: string) {
    return clipboard.handlePaste({
      preventDefault() {},
      clipboardData: {
        getData: (type: string) => (type === 'application/json' ? json : ''),
        items: [],
      },
    })
  }

  function adoptions() {
    return server.fetch.mock.calls.filter(([url]) =>
      String(url).includes('update_slide_attachments'),
    )
  }

  function openedWaiting() {
    return openedSurface({ deck: { conversion: { state: 'pending' } }, slides: waitingSlides })
  }

  it('lands in a converted presentation with its picture its own, with fresh ids each paste', async () => {
    mounted = await openedWaiting()
    const json = copied()
    expect(JSON.parse(json)).toMatchObject({
      parent: mounted.docname,
      elements: [{ src: picture.src }],
    })
    mounted.app.unmount()
    mounted.root.remove()

    const doc = convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    await paste(json)
    await paste(json)

    await vi.waitFor(() => expect(drawnSlides(doc)).toHaveLength(3))
    const pastedPictures = drawnSlides(doc).flatMap(({ elements }) =>
      elements.filter(({ type }) => type === 'image'),
    )
    expect(pastedPictures.map(({ src }) => src)).toEqual([
      `adopted:${picture.src}`,
      `adopted:${picture.src}`,
    ])
    const ids = pastedPictures.map(({ id }) => id)
    expect(new Set([...ids, picture.id]).size).toBe(3)
  })

  it('takes no paste itself', async () => {
    mounted = await openedWaiting()

    await paste(JSON.stringify({ clientId: 'x1', parent: 'another', elements: [picture] }))

    expect(adoptions()).toEqual([])
    expect(thumbnails(mounted.root)).toHaveLength(1)
  })
})
