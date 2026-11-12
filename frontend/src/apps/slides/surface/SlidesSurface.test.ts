import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { Paragraph } from '@tiptap/extension-paragraph'
import { Text } from '@tiptap/extension-text'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Component, type Ref } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import { applyUpdate, Doc, encodeStateAsUpdate, UndoManager } from 'yjs'

import type { useCommentDrafts } from '@/apps/drive'
import type { StoreSlide } from '@/apps/slides/collab/liveDeck'
import type { RoomStatus } from '@/platform/collab'
import { requireTestElement } from '@/platform/testing/dom'

import {
  collabRoom,
  commentPanel,
  driveComments,
  exported,
  fakeServer,
  forgetTemplates,
  openedSurface,
  previews,
  propertiesPanel,
  savedStates,
  saves,
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
  versionRestore,
  versionsPanel,
  visits,
  warms,
} from './SlidesSurface.fakes'

const {
  addEmptySlide,
  duplicateSlide,
  handleInsertSlide,
  saveSlide,
  slideIndex,
  slides: editorSlides,
} = await import('@/apps/slides/stores/slide')
const {
  dirty,
  getPresentationFromLocalDB,
  isSaving,
  markDirty,
  saveCurrentState,
  saveFailed,
  saveRefused,
  savingFor,
  writeDraft,
} = await import('@/apps/slides/stores/saving')
const {
  initPresentationDoc,
  inReadonlyMode,
  loadTemplates,
  presentationId,
  templateList,
  viewOnly,
} = await import('@/apps/slides/stores/presentation')
const { drawnSlides } = await import('@/apps/slides/collab/drawnDeck')
const { undoLive } = await import('@/apps/slides/stores/liveDeck')
const { offlineCopyStatus } = await import('@/apps/slides/stores/offlineCopy')
const { draftsDbName, RECORD_PREFIX } = await import('@/apps/slides/utils/slidesCaches')
const { openDraftsDb } = await import('@/apps/slides/utils/drafts')
const { keepRecovery, readRecovery, removeNewestRecovery } = await import('./recovery')
const { dialog, toast, useKeyboardShortcut } = await import('frappe-ui')
const { changeSlideInSlideshow } = await import('@/apps/slides/stores/slideshow')
const { router: slidesRouter } = await import('@/apps/slides/router')
const elementStore = await import('@/apps/slides/stores/element')
const { setActiveElements } = elementStore
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
  saves.length = 0
  server.fetch.mockReset()
  driveComments.threads = []
  driveComments.reads = 0
  driveComments.sent = []
})

describe('Slides autosave', () => {
  it('saves an edit made after picking the second slide in the thumbnails', async () => {
    mounted = await openedSurface()

    const [, second] = thumbnails(mounted.root)
    second.click()
    await nextTick()
    duplicateSlide()

    await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 })
    expect(saves[0]).toMatchObject({ name: mounted.docname })
    expect(savedSlides(saves[0])).toHaveLength(3)
  })

  it('asks the browser to confirm leaving while an edit is unsaved', async () => {
    mounted = await openedSurface()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)

    duplicateSlide()
    const unsaved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unsaved)

    expect(clean.defaultPrevented).toBe(false)
    expect(unsaved.defaultPrevented).toBe(true)
  })
})

function mountedDocumentName() {
  if (!mounted) throw new Error('No presentation is mounted')
  return mounted.docname
}

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

function toolbar() {
  return document.querySelector('[data-toolbar]')
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

  it('opens a converted deck in its view instead of a show from its rows', async () => {
    mounted = await openedSurface({ path: '/present?slide=1', deck: { is_converted: true } })

    await vi.waitFor(() => expect(mounted?.router.currentRoute.value.name).toBe('document-host'))
    expect(mounted.router.currentRoute.value.query).toEqual({ slide: '1' })
    expect(shown()).toBe(false)
  })

  it('never mounts the show on a converted deck, even before the redirect lands', async () => {
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

  function drawnTexts() {
    const drawn = fromPartial<Array<{ elements: Array<{ content?: string }> }>>(editorSlides.value)
    return drawn.map((slide) => slide.elements.map((element) => element.content).join())
  }

  it('draws a converted presentation from its room, not its rows, and lets it be edited', async () => {
    convertedRoom('one', 'two', 'three')
    mounted = await openedSurface({ deck: { is_converted: true } })

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
    expect(drawnTexts()).toEqual(
      ['one', 'two', 'three'].map((text) => expect.stringContaining(`>${text}</p>`)),
    )
    expect(viewOnly.value).toBe(false)
    expect(saves).toEqual([])
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

  it('sends a change to the room and never saves the rows', async () => {
    const doc = convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))

    fromAny<StoreSlide[], unknown>(editorSlides.value)[0].background = '#123456'
    markDirty()
    await nextTick()

    const [slide] = drawnSlides(doc)
    expect(slide.background).toBe('#123456')
    expect(saves).toEqual([])
    expect(dirty.value).toBe(false)
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

  describe('restoring a version', () => {
    beforeEach(() => {
      versionsPanel.confirmRestore = null
    })

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
      await vi.waitFor(() => expect(versionsPanel.confirmRestore).not.toBeNull())
    }

    it('asks first, then restores it in the editor for everyone and lists the versions again', async () => {
      const room = roomOf('now')
      collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
      versionBytes.current = await storedVersion(roomOf('then').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      const reloads = versionsPanel.reloads

      versionsPanel.confirmRestore!('3')
      await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
      const [asked] = fromAny<[{ message: string; onConfirm: () => Promise<void> }], unknown>(
        vi.mocked(dialog.confirm).mock.lastCall,
      )
      expect(versionsPanel.writable).toBe(true)
      expect(asked.message).toBe(
        'The presentation goes back to this version for everyone. Its current state is kept as a version first.',
      )
      await asked.onConfirm()

      expect(room.restoreVersion).toHaveBeenCalledWith(3, expect.any(Function))
      await vi.waitFor(() => expect(drawnTexts()).toEqual([expect.stringContaining('>then</p>')]))
      expect(toast.success).toHaveBeenCalledWith('Version restored')
      expect(versionsPanel.reloads).toBe(reloads + 1)
      expect(saves).toEqual([])
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

      versionsPanel.confirmRestore!('3')
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

      versionsPanel.preview('3')
      await vi.waitFor(() => expect(previewOf(mounted!.root)?.textContent).toContain('first'))
      const preview = requireTestElement(previewOf(mounted.root), HTMLElement)
      expect(preview.textContent).toContain('1 of 2')
      expect(mounted.root.querySelector('[data-toolbar]')).toBeNull()
      expect(versionsPanel.previewed).toBe('3')

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
      expect(saves).toEqual([])
    })

    it('leaves the live presentation alone when edit shortcuts are pressed over a version', async () => {
      const live = convertedRoom('now')
      versionBytes.current = await storedVersion(roomOf('first').doc)
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()
      versionsPanel.preview('3')
      await vi.waitFor(() => expect(previewOf(mounted!.root)?.textContent).toContain('first'))
      const before = Array.from(encodeStateAsUpdate(live))

      for (const combo of ['Mod+A', 'Delete', 'Backspace', 'Mod+D', 'Enter', 'Mod+Z', 'Mod+Y']) {
        await press(combo)
      }

      expect(Array.from(encodeStateAsUpdate(live))).toEqual(before)
      expect(saves).toEqual([])
    })

    it('shows an old version from its rows', async () => {
      convertedRoom('now')
      const elements = [{ id: 'element-old', type: 'text', content: '<p>before collaboration</p>' }]
      const record = { schema: 'presentation/1', slides: [{ elements: JSON.stringify(elements) }] }
      versionBytes.current = new TextEncoder().encode(JSON.stringify(record))
      mounted = await openedSurface({ deck: { is_converted: true } })
      await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
      await openVersions()

      versionsPanel.preview('1')

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

      versionsPanel.confirmRestore!('1')
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
      expect(versionsPanel.previewed).toBe('1')
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

    it('leaves a presentation on its rows to the panel and the server', async () => {
      mounted = await openedSurface()
      requireTestElement(mounted.root.querySelector('[data-versions]'), HTMLElement).click()
      await vi.waitFor(() => expect(versionsPanel.writable).toBe(true))

      expect(versionsPanel.confirmRestore).toBeNull()
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
      markDirty()
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

  it('starts no slideshow on a converted presentation from Mod+P', async () => {
    convertedRoom('one')
    mounted = await openedSurface({ deck: { is_converted: true } })
    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(1))
    const fullscreen = vi.fn(async () => {})
    document.documentElement.requestFullscreen = fullscreen
    vi.mocked(slidesRouter.replace).mockClear()
    const shortcuts = vi.mocked(useKeyboardShortcut).mock.calls.at(-1)![0]
    if (!Array.isArray(shortcuts)) throw new Error('Expected a list of shortcuts')

    const printShortcut = shortcuts.find(({ combo }) => combo === 'Mod+P')
    if (typeof printShortcut?.handler !== 'function') throw new Error('Missing print shortcut')
    printShortcut.handler(new KeyboardEvent('keydown', { key: 'p' }))

    expect(fullscreen).not.toHaveBeenCalled()
    expect(slidesRouter.replace).not.toHaveBeenCalled()
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

    async function openedNew(deck: Record<string, unknown> = { is_converted: true }) {
      templates.list = [dark, team]
      mounted = await openedSurface({ path: '?new=1', deck })
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

    it.each(['pending', 'refused'])('is not offered on a %s presentation', async (state) => {
      await openedNew({ conversion: { state } })
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
      expect(saves).toEqual([])
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

    it('leaves a presentation on its rows to the server', async () => {
      await openedNew({})

      themeChange.create('dark-template')

      await vi.waitFor(() => expect(calls('apply_theme')).toHaveLength(1))
      expect(bodyOf('apply_theme')).toMatchObject({ theme: 'dark-template' })
      expect(calls('update_slide_attachments')).toEqual([])
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

describe('Slides push refused by the server', () => {
  const REFUSED = 'This presentation changed elsewhere. Your changes are kept on this device.'
  const REFUSED_UNSTORED =
    'This presentation changed elsewhere. Download your changes before you reload.'

  let files: ReturnType<typeof vi.fn<(file: File) => string>>

  startsFromEmptyStore()

  beforeEach(() => {
    files = vi.fn((_file: File) => 'blob:recovery')

    URL.createObjectURL = fromPartial<typeof URL.createObjectURL>(files)
    URL.revokeObjectURL = () => {}
  })

  function keptToast(message: string) {
    const call = vi.mocked(toast.warning).mock.calls.find(([text]) => text === message)
    const [, actions] = call ?? []
    const action = actions?.action
    if (
      !action ||
      typeof action !== 'object' ||
      !('label' in action) ||
      typeof action.label !== 'string' ||
      !('onClick' in action) ||
      typeof action.onClick !== 'function'
    )
      return undefined
    const { label, onClick } = action
    return { action: { label, onClick: (event: MouseEvent) => onClick.call(action, event) } }
  }

  function heldNotice(message: string) {
    const notices = Array.from(mounted?.root.querySelectorAll('[role="alert"]') ?? [])
    const notice = notices.find((element) => element.textContent?.includes(message))
    if (!notice) return undefined

    const button = (label: string) => notice.querySelector<HTMLElement>(`[label="${label}"]`)
    return {
      canReload: () => button('Reload') !== null,
      download: () => button('Download')?.click(),
      reload: () => button('Reload')?.click(),
    }
  }

  async function refused(message = REFUSED) {
    mounted = await openedSurface()
    fakeServer.isRefusing = true
    duplicateSlide()
    await vi.waitFor(() => expect(heldNotice(message)).toBeDefined(), { timeout: 3000 })
    const notice = heldNotice(message)
    if (!notice) throw new Error('Expected the held-work notice')
    return notice
  }

  function serverMoves() {
    fakeServer.isRefusing = false
    served.modified = 'M2'
  }

  async function reloaded(notice: NonNullable<ReturnType<typeof heldNotice>>) {
    notice.reload()
    await vi.waitFor(() => expect(saveRefused.value).toBe(false))
    await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
  }

  function fillTheStore() {
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith('suite:slides-recovery')) {
        throw new DOMException('full', 'QuotaExceededError')
      }

      setItem.call(this, key, value)
    })
  }

  function menuItem(label: string) {
    const buttons = Array.from(mounted?.root.querySelectorAll('button') ?? [])
    return buttons.find((button) => button.textContent === label)
  }

  function downloadButton() {
    return mounted?.root.querySelector<HTMLButtonElement>('[data-download-changes]:not([hidden])')
  }

  async function downloadedSlides() {
    const file = files.mock.lastCall?.[0]
    if (!(file instanceof File)) throw new Error('Expected a downloaded presentation file')
    return fromPartial<unknown[]>(JSON.parse(await file.text()).slides)
  }

  it('says so in a notice that stays up, and keeps a copy at that moment', async () => {
    const refusal = await refused()

    expect(refusal.canReload()).toBe(true)
    const [copy] = readRecovery('node-1')
    expect(copy.slides).toHaveLength(3)
    expect(copy.sticky).toBe(true)
  })

  it('stops editing, with only the Reload notice and no second banner', async () => {
    const refusal = await refused()

    await vi.waitFor(() => expect(toolbar()).toBeNull())
    expect(refusal.canReload()).toBe(true)
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
    await press('Mod+D')
    expect(editorSlides.value).toHaveLength(3)
  })

  it('keeps the copy through a reload, an edit and a landed save', async () => {
    const refusal = await refused()

    serverMoves()
    await reloaded(refusal)
    expect(readRecovery('node-1')).toHaveLength(1)
    await nextTick()
    expect(heldNotice(REFUSED)).toBeUndefined()

    duplicateSlide()
    await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 })
    await vi.waitFor(() => expect(dirty.value || isSaving.value).toBe(false))
    await nextTick()

    expect(readRecovery('node-1')).toHaveLength(1)
    downloadButton()?.click()
    expect(await downloadedSlides()).toHaveLength(3)
    await nextTick()
    expect(readRecovery('node-1')).toHaveLength(1)
    expect(downloadButton()).not.toBeNull()
  })

  it('finds the copy of a killed tab when the draft goes, beside an older one', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    const nextOpen = fakeServer.opens + 1
    await writeDraft({
      id: `p${nextOpen}`,
      content: [{ clientId: 'killed', background: '#00ff00ff', elements: [] }],
      dirty: true,
      updatedAt: 1,
      baseModified: 'M0',
    })

    mounted = await openedSurface()

    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([
      [{ clientId: 'older' }],
      [{ clientId: 'killed', background: '#00ff00ff', elements: [] }],
    ])
    expect(downloadButton()).not.toBeNull()
  })

  it('offers the live slides when no copy could be stored, and lets the person out', async () => {
    fillTheStore()
    const refusal = await refused(REFUSED_UNSTORED)
    expect(readRecovery('node-1')).toEqual([])
    expect(downloadButton()).not.toBeNull()

    refusal.download()
    expect(await downloadedSlides()).toHaveLength(3)

    serverMoves()
    const docname = mountedDocumentName()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    menuItem('Discard my changes')?.click()
    expect(confirm).toHaveBeenCalledWith("Discard your kept changes? This can't be undone.")
    expect(saveRefused.value).toBe(true)

    confirm.mockReturnValue(true)
    menuItem('Discard my changes')?.click()
    await vi.waitFor(() => expect(saveRefused.value).toBe(false))
    await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
    const draft = await getPresentationFromLocalDB(docname)
    if (!draft || typeof draft !== 'object' || !('dirty' in draft))
      throw new Error('Expected a stored draft')
    expect(draft.dirty).toBe(false)
    expect(dirty.value).toBe(false)
  })

  describe('leaving', () => {
    async function left() {
      const docname = mountedDocumentName()
      mounted?.app.unmount()
      mounted = null
      await new Promise((resolve) => setTimeout(resolve, 50))
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
      return docname
    }

    it('sends nothing and leaves no dirty draft when nothing was edited', async () => {
      mounted = await openedSurface()

      const docname = await left()

      expect(saves).toEqual([])
      const draft = await getPresentationFromLocalDB(docname)
      expect(draft).not.toEqual(expect.objectContaining({ dirty: true }))
    })

    it('still pushes an edit', async () => {
      mounted = await openedSurface()
      duplicateSlide()

      await left()

      expect(saves).toHaveLength(1)
      expect(savedSlides(saves[0])).toHaveLength(served.slides.length + 1)
    })
  })

  describe('leaving with the real properties panel', () => {
    const base = { width: 100, height: 100, left: 0, top: 0, opacity: 50, zIndex: 1 }
    const elements = [
      { ...base, id: 'shape', type: 'shape' },
      { ...base, id: 'text', type: 'text', content: '<p style="line-height: 1.5;">Hello</p>' },
      { ...base, id: 'image', type: 'image', attachmentName: 'a.png', src: '/a.png' },
      { ...base, id: 'video', type: 'video', attachmentName: 'a.mp4', src: '/a.mp4' },
      {
        ...base,
        id: 'table',
        type: 'table',
        content:
          '<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><td colspan="1" rowspan="1"><p style="line-height: 1.5;">Cell</p></td></tr></tbody></table>',
      },
    ]
    const withElements = [
      {
        clientId: 'c1',
        background: '#ffffffff',
        transition: 'Fade',
        transitionDuration: 1,
        elements,
      },
    ]

    function opacityField(root: Element) {
      const row = [...root.querySelectorAll('span')].find((el) => el.textContent === 'Opacity')
      return requireTestElement(row?.parentElement?.querySelector('input'), HTMLInputElement)
    }

    async function left() {
      mounted?.app.unmount()
      mounted = null
      await new Promise((resolve) => setTimeout(resolve, 50))
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
    }

    beforeAll(async () => {
      const panel = await vi.importActual<{ default: Component }>(
        '@/apps/slides/components/PropertiesPanel.vue',
      )
      propertiesPanel.real = panel.default
    })

    afterAll(() => {
      propertiesPanel.real = null
    })

    afterEach(() => setActiveElements([]))

    it('pushes an arrow step made with focus still in the field', async () => {
      mounted = await openedSurface({ slides: withElements })
      setActiveElements(['shape'])
      await nextTick()

      const field = opacityField(mounted.root)
      field.focus()
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      await left()

      expect(saves).toHaveLength(1)
      const [saved] = savedSlides(saves[0])
      const pushed: typeof elements = JSON.parse(saved.elements)
      expect(pushed.find((el) => el.id === 'shape')?.opacity).toBe(51)
    })

    it('sends nothing when every panel was shown and nothing was edited', async () => {
      mounted = await openedSurface({ slides: withElements })
      const selections = [...elements.map((el) => [el.id]), ['shape', 'image'], []]
      for (const selection of selections) {
        setActiveElements(selection)
        await nextTick()
      }

      expect(dirty.value).toBe(false)

      await left()

      expect(saves).toEqual([])
    })
  })

  describe('templates that fail to load', () => {
    beforeEach(() => {
      // a theme pick's surface may still list the templates it read
      templateList.value = []
      forgetTemplates.run()
      fakeServer.isFailingTemplates = true
    })

    it('shows no toast offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

      mounted = await openedSurface()
      await loadTemplates()

      expect(toast.error).not.toHaveBeenCalled()
    })

    it('still says so online', async () => {
      mounted = await openedSurface()
      await loadTemplates()

      expect(toast.error).toHaveBeenCalledWith('Failed to fetch')
    })
  })

  async function draftDirty() {
    await new Promise((resolve) => setTimeout(resolve, 50))
    const draft = await getPresentationFromLocalDB(mountedDocumentName())
    if (!draft || typeof draft !== 'object' || !('dirty' in draft))
      throw new Error('Expected a stored draft')
    return draft.dirty
  }

  it('sends the live slides past an older copy when no copy could be stored', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    fillTheStore()
    const refusal = await refused(REFUSED_UNSTORED)

    refusal.download()

    expect(await downloadedSlides()).toHaveLength(3)
    expect(await draftDirty()).toBe(true)
    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
  })

  it('ends nothing with a download in the hold, and a reload adds no second copy', async () => {
    const refusal = await refused()
    const before = readRecovery('node-1')

    refusal.download()

    expect(await downloadedSlides()).toHaveLength(3)
    expect(readRecovery('node-1')).toEqual(before)
    expect(await draftDirty()).toBe(true)

    serverMoves()
    await reloaded(refusal)

    const copies = readRecovery('node-1')
    expect(copies).toHaveLength(1)
    expect(copies[0].slides).toEqual(before[0].slides)
    expect(downloadButton()).not.toBeNull()
  })

  it('drops only the newest copy on a discard after a download', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })
    mounted = await openedSurface()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    downloadButton()?.click()
    menuItem('Discard my changes')?.click()
    await nextTick()

    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
  })

  it('hides the download once another tab has emptied the list', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    mounted = await openedSurface()
    expect(downloadButton()).not.toBeNull()

    localStorage.clear()
    downloadButton()?.click()
    await nextTick()

    expect(toast.error).toHaveBeenCalledWith('No recovery copy is kept for this presentation.')
    expect(downloadButton()).toBeNull()
  })

  describe('leaving with unsaved edits', () => {
    const KEPT = 'Your latest changes are kept as a recovery copy. Leave this presentation?'
    const NOT_KEPT =
      'Your latest changes could not be kept on this device. Leave this presentation anyway?'

    async function leavingAsks(afterOpening = () => {}) {
      mounted = await openedSurface()
      afterOpening()
      duplicateSlide()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await mounted.router.push('/d/node-2')
      return confirm
    }

    it('says the copy is kept when it is', async () => {
      const confirm = await leavingAsks()

      expect(confirm).toHaveBeenCalledWith(KEPT)
      expect(readRecovery('node-1')).toHaveLength(1)
    })

    it('says it could not be kept when the store is full, with no toast', async () => {
      const confirm = await leavingAsks(fillTheStore)

      expect(confirm).toHaveBeenCalledWith(NOT_KEPT)
      expect(toast.error).not.toHaveBeenCalled()
      expect(mounted?.router.currentRoute.value.params.node).toBe('node-1')
    })

    it('still warns when the browser unloads with the store full', async () => {
      mounted = await openedSurface()
      fillTheStore()
      duplicateSlide()
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)

      expect(unload.defaultPrevented).toBe(true)
      expect(toast.error).toHaveBeenCalledWith(
        'Your latest changes could not be kept on this device.',
      )
    })

    it('holds through a refusal', async () => {
      await refused()
      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)

      expect(unload.defaultPrevented).toBe(true)
    })
  })

  it('keeps a sticky copy when a save lands on a full store', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    fillTheStore()
    mounted = await openedSurface()
    const errors = vi.fn()
    mounted.app.config.errorHandler = errors

    duplicateSlide()
    await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 })
    await vi.waitFor(() => expect(dirty.value || isSaving.value).toBe(false))
    await nextTick()

    expect(errors).not.toHaveBeenCalled()
    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
    expect(downloadButton()).not.toBeNull()
  })

  describe('edit access lost with unsaved edits', () => {
    const KEPT = 'Editing access changed. Your unsaved changes are kept on this device.'
    const UNSTORED = 'Editing access changed. Download your changes before you reload.'
    const VIEW_ONLY = 'Editing access changed. This presentation is now view only.'
    const BACK_UNSTORED = 'Editing access is back. Download your changes before you reload.'
    const UNREAD = 'Editing access changed. Unsaved changes from earlier are kept on this device.'

    async function narrowedWithEdits(afterOpening = () => {}) {
      mounted = await openedSurface()
      afterOpening()
      duplicateSlide()
      expect(editorSlides.value).toHaveLength(3)
      if (mounted) {
        mounted.access.value = { role: 10 }
      }
    }

    function widen() {
      if (mounted) {
        mounted.access.value = { role: 50 }
      }
    }

    describe('with the last presentation still pushing', () => {
      let land!: () => void

      async function openedDuringItsPush() {
        mounted = await openedSurface()
        const answerAtServer = server.fetch.getMockImplementation()
        const held = new Promise<Response>((resolve) => {
          land = () => resolve(new Response('{}', { status: 500 }))
        })
        server.fetch.mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('save_slides')) {
            return held
          }

          return answerAtServer?.(url, init)
        })
        duplicateSlide()
        await vi.waitFor(() => expect(isSaving.value).toBe(true), { timeout: 3000 })
        mounted.app.unmount()
        mounted.root.remove()

        mounted = await openedSurface()
      }

      afterEach(async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        land()
        await vi.waitFor(() => expect(savingFor.value).toBeNull())
        vi.mocked(console.error).mockRestore()
      })

      it('takes a clean presentation as having nothing unsaved when access narrows', async () => {
        await openedDuringItsPush()
        const copies = readRecovery('node-1').length
        vi.mocked(toast.warning).mockClear()

        if (mounted) {
          mounted.access.value = { role: 10 }
        }

        await nextTick()

        expect(toast.warning).toHaveBeenCalledWith(VIEW_ONLY)
        expect(readRecovery('node-1')).toHaveLength(copies)
      })

      it('still asks the browser to confirm closing the tab', async () => {
        await openedDuringItsPush()

        const unload = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(unload)

        expect(unload.defaultPrevented).toBe(true)
      })

      it('keeps no copy of this clean presentation when the tab closes', async () => {
        await openedDuringItsPush()
        while (readRecovery('node-1').length) {
          removeNewestRecovery('node-1')
        }

        window.dispatchEvent(new Event('beforeunload', { cancelable: true }))

        expect(readRecovery('node-1')).toEqual([])
      })
    })

    it('says the copy is kept when it is', async () => {
      await narrowedWithEdits()

      expect(keptToast(KEPT)).toBeDefined()
      expect(heldNotice(UNSTORED)).toBeUndefined()
      expect(readRecovery('node-1')).toHaveLength(1)
    })

    it('says to download, and nothing else, when the store is full', async () => {
      await narrowedWithEdits(fillTheStore)

      expect(heldNotice(UNSTORED)).toBeDefined()
      expect(keptToast(KEPT)).toBeUndefined()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('sends the live slides past an older copy', async () => {
      await narrowedWithEdits(() => {
        keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
        fillTheStore()
      })

      heldNotice(UNSTORED)?.download()
      expect(await downloadedSlides()).toHaveLength(3)

      await nextTick()
      downloadButton()?.click()
      expect(await downloadedSlides()).toHaveLength(3)
    })

    it('offers the download with no copy at all', async () => {
      await narrowedWithEdits(fillTheStore)
      await nextTick()

      expect(downloadButton()).not.toBeNull()
    })

    it('leaves the slides on screen when access returns and the store is still full', async () => {
      await narrowedWithEdits(fillTheStore)
      const reads = server.fetch.mock.calls.length

      widen()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(editorSlides.value).toHaveLength(3)
      expect(server.fetch.mock.calls.length).toBe(reads)
      const back = heldNotice(BACK_UNSTORED)
      expect(back?.canReload()).toBe(true)

      back?.download()
      expect(await downloadedSlides()).toHaveLength(3)
    })

    it('saves nothing while the slides wait, and Reload loads the server copy', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      await new Promise((resolve) => setTimeout(resolve, 1200))

      expect(saves).toEqual([])

      vi.spyOn(window, 'confirm').mockReturnValue(true)
      heldNotice(BACK_UNSTORED)?.reload()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      await nextTick()

      expect(downloadButton()).toBeNull()
      expect(heldNotice(BACK_UNSTORED)).toBeUndefined()
    })

    it('keeps a copy and then loads when access returns with room', async () => {
      await narrowedWithEdits(fillTheStore)

      vi.mocked(Storage.prototype.setItem).mockRestore()
      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      expect(heldNotice(BACK_UNSTORED)).toBeUndefined()
      const [copy] = readRecovery('node-1')
      expect(copy.slides).toHaveLength(3)
    })

    async function savedJustAsAccessWent() {
      mounted = await openedSurface()
      fillTheStore()
      const put = IDBObjectStore.prototype.put
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        record: { dirty?: boolean },
        key?: IDBValidKey,
      ) {
        if (record.dirty === false && mounted?.access.value.role === 50) {
          mounted.access.value = { role: 10 }
        }

        return put.call(this, record, key)
      })

      duplicateSlide()
      await vi.waitFor(() => expect(heldNotice(UNSTORED)).toBeDefined(), { timeout: 3000 })
      await vi.waitFor(() => expect(dirty.value || isSaving.value).toBe(false))
      await nextTick()
    }

    it('asks before leaving when the save landed just as access went', async () => {
      await savedJustAsAccessWent()
      expect(downloadButton()).not.toBeNull()

      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)

      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await mounted?.router.push('/d/node-2')
      expect(confirm).toHaveBeenCalled()
      expect(mounted?.router.currentRoute.value.params.node).toBe('node-1')
    })

    it('does not let a load already running land over the slides', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      let release!: () => void
      mounted?.loads.push(
        new Promise((resolve) => {
          release = resolve
        }),
      )
      await nextTick()
      heldNotice(BACK_UNSTORED)?.reload()
      await vi.waitFor(() =>
        expect(mounted?.root.querySelector('[aria-label="Opening presentation"]')).not.toBeNull(),
      )

      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(editorSlides.value).toHaveLength(3)
      expect(downloadButton()).not.toBeNull()
      expect(mounted?.root.querySelector('[aria-label="Opening presentation"]')).toBeNull()
      expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(3)

      widen()
      await nextTick()
      heldNotice(BACK_UNSTORED)?.reload()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
    })

    async function saveLands() {
      const landed = saves.length
      await vi.waitFor(() => expect(saves.length).toBeGreaterThan(landed), { timeout: 3000 })
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
      await nextTick()
    }

    it('keeps the copy through access returning and the next save', async () => {
      await narrowedWithEdits()
      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      duplicateSlide()
      duplicateSlide()
      await saveLands()

      expect(readRecovery('node-1').map((copy) => copy.slides.length)).toEqual([3])
      keptToast(KEPT)?.action.onClick(new MouseEvent('click', { cancelable: true }))
      expect(await downloadedSlides()).toHaveLength(3)
    })

    it('keeps the copy taken when access returns with room through the next save', async () => {
      await narrowedWithEdits(fillTheStore)
      vi.mocked(Storage.prototype.setItem).mockRestore()
      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      duplicateSlide()
      duplicateSlide()
      await saveLands()

      expect(readRecovery('node-1').map((copy) => copy.slides.length)).toEqual([3])
    })

    it('keeps the copy from leaving while view only through the next save', async () => {
      await narrowedWithEdits()
      localStorage.clear()
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      await mounted?.router.push('/d/node-2')
      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      duplicateSlide()
      duplicateSlide()
      await saveLands()

      expect(readRecovery('node-1').map((copy) => copy.slides.length)).toEqual([3])
    })

    it('lets the next save clear a copy kept by unloading a writable tab', async () => {
      mounted = await openedSurface()
      duplicateSlide()
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
      expect(readRecovery('node-1')).toHaveLength(1)

      await saveLands()

      expect(readRecovery('node-1')).toEqual([])
    })

    function seedDraft(baseModified = 'M0') {
      const nextOpen = fakeServer.opens + 1
      return writeDraft({
        id: `p${nextOpen}`,
        content: [{ clientId: 'killed', background: '#00ff00ff', elements: [] }],
        dirty: true,
        updatedAt: 1,
        baseModified,
      })
    }

    function holdFirstLoad() {
      let release!: () => void
      const firstLoad = new Promise<void>((resolve) => {
        release = resolve
      })
      return { firstLoad, release }
    }

    it('keeps a draft nobody loaded yet when access narrows during the first load', async () => {
      await seedDraft()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })

      mounted.access.value = { role: 10 }
      await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(1))
      release()
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
      )

      const [copy] = readRecovery('node-1')
      expect(copy.sticky).toBe(true)
      expect(copy.slides).toEqual([{ clientId: 'killed', background: '#00ff00ff', elements: [] }])
      expect((await getPresentationFromLocalDB(mounted.docname))?.dirty).toBe(false)
      expect(keptToast(KEPT)).toBeUndefined()
      keptToast(UNREAD)?.action.onClick(new MouseEvent('click', { cancelable: true }))
      expect(await downloadedSlides()).toEqual(copy.slides)
    })

    it('keeps a draft nobody loaded yet whatever the save flags still say', async () => {
      await seedDraft()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })
      saveFailed.value = true

      mounted.access.value = { role: 10 }
      await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(1))
      release()
      saveFailed.value = false
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
      )

      const [copy] = readRecovery('node-1')
      expect(copy.sticky).toBe(true)
    })

    it('keeps a draft the load already read when access narrows', async () => {
      await seedDraft()
      let answerPing!: () => void
      const ping = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answerPing = () => resolve(new Response('{"message":"pong"}'))
          }),
      )
      vi.stubGlobal('fetch', ping)
      mounted = await openedSurface({ firstLoad: Promise.resolve() })
      await vi.waitFor(() => expect(ping).toHaveBeenCalled())

      mounted.access.value = { role: 10 }
      await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(1))
      answerPing()
      await vi.waitFor(() =>
        expect(mounted?.root.querySelectorAll('nav button').length).toBeGreaterThan(0),
      )

      const [copy] = readRecovery('node-1')
      expect(copy.sticky).toBe(true)
      expect(copy.slides).toEqual([{ clientId: 'killed', background: '#00ff00ff', elements: [] }])
    })

    it('leaves the draft in place when access narrows during the load and no copy fits', async () => {
      await seedDraft()
      fillTheStore()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })

      mounted.access.value = { role: 10 }
      await new Promise((resolve) => setTimeout(resolve, 50))
      release()
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
      )

      expect((await getPresentationFromLocalDB(mounted.docname))?.dirty).toBe(true)
      expect(keptToast(UNREAD)).toBeUndefined()
    })

    function failDraftWrites() {
      const put = IDBObjectStore.prototype.put
      return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        record: unknown,
        key?: IDBValidKey,
      ) {
        const request = put.call(this, record, key)
        const { transaction } = this
        request.addEventListener('success', () => {
          Object.defineProperty(transaction, 'error', {
            get: () => new DOMException('full', 'QuotaExceededError'),
            set() {},
          })
          transaction.abort()
        })
        return request
      })
    }

    it('shows the server copy and no false toast after a landed save could not write', async () => {
      mounted = await openedSurface()
      await writeDraft({
        id: mounted.docname,
        content: [{ clientId: 'older', background: '#00ff00ff', elements: [] }],
        dirty: true,
        updatedAt: 1,
        baseModified: 'M0',
      })
      const writes = failDraftWrites()

      duplicateSlide()
      await saveLands()
      await vi.waitFor(async () =>
        expect(await getPresentationFromLocalDB(mountedDocumentName())).toBeFalsy(),
      )
      writes.mockRestore()
      vi.mocked(toast.warning).mockClear()

      await initPresentationDoc(mounted.docname)

      expect(editorSlides.value).toHaveLength(2)
      expect(toast.warning).not.toHaveBeenCalled()
      expect(readRecovery('node-1')).toEqual([])
    })

    it('takes the copy before the record goes when access narrows on a full store', async () => {
      await seedDraft()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })
      const writes = failDraftWrites()

      mounted.access.value = { role: 10 }
      await vi.waitFor(() => expect(readRecovery('node-1')).toHaveLength(1))
      await vi.waitFor(async () =>
        expect(await getPresentationFromLocalDB(mountedDocumentName())).toBeFalsy(),
      )
      writes.mockRestore()
      release()
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
      )

      const [copy] = readRecovery('node-1')
      expect(copy.slides).toEqual([{ clientId: 'killed', background: '#00ff00ff', elements: [] }])
    })

    it('keeps the copy and says so when the draft can be neither rewritten nor removed', async () => {
      await seedDraft()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })
      const writes = failDraftWrites()
      const removes = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => {
        throw new DOMException('broken', 'UnknownError')
      })

      mounted.access.value = { role: 10 }
      await vi.waitFor(() => expect(keptToast(UNREAD)).toBeDefined())
      await vi.waitFor(() => expect(removes).toHaveBeenCalled())
      writes.mockRestore()
      removes.mockRestore()

      const [copy] = readRecovery('node-1')
      expect(copy.sticky).toBe(true)
      expect(copy.slides).toEqual([{ clientId: 'killed', background: '#00ff00ff', elements: [] }])
      expect((await getPresentationFromLocalDB(mounted.docname))?.dirty).toBe(true)
      release()
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(2),
      )
    })

    it('stays view only when access returns and the store is still full', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      await nextTick()

      expect(inReadonlyMode.value).toBe(true)
      expect(heldNotice(BACK_UNSTORED)).toBeDefined()
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('keeps a copy on Reload when there is room by then, with no question', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      vi.mocked(Storage.prototype.setItem).mockRestore()
      const confirm = vi.spyOn(window, 'confirm')

      await nextTick()
      heldNotice(BACK_UNSTORED)?.reload()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      expect(confirm).not.toHaveBeenCalled()
      const [copy] = readRecovery('node-1')
      expect(copy.slides).toHaveLength(3)
      expect(copy.sticky).toBe(true)
      expect(inReadonlyMode.value).toBe(false)
    })

    it('asks before Reload replaces the only copy, and stays put on no', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const reads = server.fetch.mock.calls.length

      await nextTick()
      heldNotice(BACK_UNSTORED)?.reload()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(editorSlides.value).toHaveLength(3)
      expect(server.fetch.mock.calls.length).toBe(reads)
      expect(heldNotice(BACK_UNSTORED)).toBeDefined()
    })

    it('shows no load error from a load the only copy cancelled', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      let fail!: (answer: Response) => void
      mounted?.loads.push(
        new Promise((resolve) => {
          fail = resolve
        }),
      )
      await nextTick()
      heldNotice(BACK_UNSTORED)?.reload()
      await vi.waitFor(() =>
        expect(mounted?.root.querySelector('[aria-label="Opening presentation"]')).not.toBeNull(),
      )
      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      fail(new Response(JSON.stringify({ exception: 'load gone wrong' }), { status: 404 }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(3)
    })

    it('still holds the only copy when access narrows again with the flags clean', async () => {
      await savedJustAsAccessWent()
      widen()
      vi.mocked(toast.warning).mockClear()

      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      expect(heldNotice(UNSTORED)).toBeDefined()
      expect(keptToast(VIEW_ONLY)).toBeUndefined()
    })

    it('keeps writes stopped after a discard while view only', async () => {
      await narrowedWithEdits(fillTheStore)
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await nextTick()
      menuItem('Discard my changes')?.click()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      viewOnly.value = false
      duplicateSlide()
      await saveCurrentState()

      expect(saves).toEqual([])
    })

    it('a discard loads the server copy and leaves an older copy alone', async () => {
      await narrowedWithEdits(() => {
        keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
        fillTheStore()
      })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await nextTick()

      menuItem('Discard my changes')?.click()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
    })

    it('loads the server copy after a discard while view only, so leaving keeps nothing', async () => {
      await narrowedWithEdits()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await nextTick()

      menuItem('Discard my changes')?.click()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      expect(readRecovery('node-1')).toEqual([])

      await mounted?.router.push('/d/node-2')

      expect(window.confirm).toHaveBeenCalledTimes(1)
      expect(readRecovery('node-1')).toEqual([])
    })

    it('pushes a draft left for lack of room once access returns', async () => {
      await seedDraft('M1')
      fillTheStore()
      const { firstLoad, release } = holdFirstLoad()
      mounted = await openedSurface({ firstLoad })
      mounted.access.value = { role: 10 }
      await new Promise((resolve) => setTimeout(resolve, 50))
      release()
      await vi.waitFor(() =>
        expect(thumbnails(requireTestElement(mounted?.root, Element))).toHaveLength(1),
      )
      vi.mocked(Storage.prototype.setItem).mockRestore()

      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(1))
      await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 })

      expect(JSON.stringify(saves[0])).toContain('killed')
      expect(toast.warning).toHaveBeenCalledWith(VIEW_ONLY)
    })

    it('shows the server copy when access returns over an older stored document', async () => {
      mounted = await openedSurface()
      await writeDraft({
        id: mounted.docname,
        content: [{ clientId: 'killed', background: '#00ff00ff', elements: [] }],
        dirty: true,
        updatedAt: 1,
        baseModified: 'M9',
      })
      mounted.access.value = { role: 10 }
      await vi.waitFor(async () =>
        expect((await getPresentationFromLocalDB(mountedDocumentName()))?.dirty).toBe(false),
      )

      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(JSON.stringify(editorSlides.value)).not.toContain('killed')
      expect(dirty.value).toBe(false)
      expect(readRecovery('node-1')).toHaveLength(1)
    })

    it('offers Reload from the menu only while the only copy waits with access back', async () => {
      await narrowedWithEdits(fillTheStore)
      await nextTick()
      expect(menuItem('Reload')).toBeUndefined()

      widen()
      await nextTick()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      menuItem('Reload')?.click()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(editorSlides.value).toHaveLength(3)

      confirm.mockReturnValue(true)
      menuItem('Reload')?.click()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      await nextTick()
      expect(menuItem('Reload')).toBeUndefined()
    })

    it('writes no theme over the only copy from a dialog left open', async () => {
      await savedJustAsAccessWent()
      widen()
      const shownBefore = editorSlides.value.length
      const reads = server.fetch.mock.calls.length

      themeChange.update('Dark')
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.fetch.mock.calls.length).toBe(reads)
      expect(editorSlides.value).toHaveLength(shownBefore)
    })

    async function discardedARefusal() {
      fakeServer.isRefusing = false
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await nextTick()
      menuItem('Discard my changes')?.click()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
      saves.length = 0
    }

    it('saves again after discarding a refusal once access is back on a full store', async () => {
      await refused()
      fillTheStore()
      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      await nextTick()
      widen()
      await nextTick()
      await discardedARefusal()

      duplicateSlide()
      await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3000 })
    })

    it('keeps writes stopped after discarding a refusal while view only', async () => {
      await refused()
      fillTheStore()
      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      await nextTick()
      await discardedARefusal()

      viewOnly.value = false
      duplicateSlide()
      await saveCurrentState()

      expect(saves).toEqual([])
    })

    it('closes the refusal when the only copy takes over', async () => {
      await refused()
      fillTheStore()
      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      await nextTick()
      expect(heldNotice(UNSTORED)).toBeDefined()
      expect(heldNotice(REFUSED)).toBeUndefined()
    })
  })

  it('takes a failed push from the last surface as nothing about the one now open', async () => {
    mounted = await openedSurface()
    const left = mounted.docname
    const answerAtServer = server.fetch.getMockImplementation()
    let failPush!: () => void
    const held = new Promise<Response>((resolve) => {
      failPush = () => resolve(new Response('{}', { status: 500 }))
    })
    server.fetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('save_slides')) {
        return held
      }

      return answerAtServer?.(url, init)
    })
    duplicateSlide()
    await vi.waitFor(() => expect(isSaving.value).toBe(true), { timeout: 3000 })
    mounted.app.unmount()
    mounted.root.remove()

    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    mounted = await openedSurface()
    keepRecovery('node-1', [{ clientId: 'kept-by-this-page' }])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    failPush()
    await vi.waitFor(() => expect(savingFor.value).toBeNull())
    await nextTick()
    error.mockRestore()

    expect(saveFailed.value).toBe(false)
    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([
      [{ clientId: 'older' }],
      [{ clientId: 'kept-by-this-page' }],
    ])
    expect(await getPresentationFromLocalDB(left)).toMatchObject({ dirty: true })
  })

  it('leaves a sticky copy after a download outside the hold', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })
    mounted = await openedSurface()

    downloadButton()?.click()
    expect(await downloadedSlides()).toEqual([{ clientId: 'newer' }])
    downloadButton()?.click()
    expect(await downloadedSlides()).toEqual([{ clientId: 'older' }])
    await nextTick()

    expect(readRecovery('node-1')).toHaveLength(2)
    expect(downloadButton()).not.toBeNull()
  })

  it('removes the newest copy from the menu once the hold is over', async () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })
    mounted = await openedSurface()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    menuItem('Discard my changes')?.click()
    await nextTick()

    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
    menuItem('Discard my changes')?.click()
    await nextTick()
    expect(readRecovery('node-1')).toEqual([])
    expect(menuItem('Discard my changes')).toBeUndefined()
  })

  it('has no discard in the menu with nothing to discard', async () => {
    mounted = await openedSurface()

    expect(menuItem('Change theme')).toBeDefined()
    expect(menuItem('Discard my changes')).toBeUndefined()
  })

  it('asks for a reload on a save shortcut and on a version action', async () => {
    await refused()

    saveSlide({ preventDefault() {} })
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This presentation changed elsewhere. Reload to continue.',
      ),
    )

    mounted?.root.querySelector<HTMLButtonElement>('[data-versions]')?.click()
    await nextTick()
    await expect(versionsPanel.flush()).rejects.toThrow(
      'This presentation changed elsewhere. Reload before you do this.',
    )
  })
})

describe('the Drive preview after a version restore', () => {
  const firstSlide = (background: string) => ({ clientId: 'c1', background, elements: [] })
  const secondSlide = { clientId: 'c2', background: '#ffffffff', elements: [] }

  beforeEach(() => {
    previews.length = 0
    versionRestore.run = async () => {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openDeck(deck: unknown[]) {
    mounted = await openedSurface({ slides: deck })
    mounted.root.querySelector<HTMLElement>('[data-versions]')?.click()
    await nextTick()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  }

  async function editFirstSlide() {
    editorSlides.value[0].background = '#123456ff'
    markDirty()
    await nextTick()
  }

  it('sends one picture after the pause when the first slide changes, and none when it does not', async () => {
    const deck = [firstSlide('#ffffffff'), secondSlide]
    await openDeck(deck)
    versionRestore.run = async () => {
      deck[0] = firstSlide('#000000ff')
    }

    await versionsPanel.restore('v1')
    await vi.advanceTimersByTimeAsync(4_900)
    expect(previews).toEqual([])

    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(previews).toHaveLength(1))
    expect(editorSlides.value[0].background).toBe('#000000ff')
    expect(saves).toEqual([])
    expect(dirty.value).toBe(false)

    await versionsPanel.restore('v2')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(previews).toHaveLength(1)
  })

  it('sends nothing when the restore fails, or when the deck cannot be reloaded after it', async () => {
    await openDeck([firstSlide('#ffffffff'), secondSlide])
    versionRestore.run = async () => {
      throw new Error('The version is gone')
    }

    await expect(versionsPanel.restore('v1')).rejects.toThrow('The version is gone')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(previews).toEqual([])

    // The save before this restore started the wait for a picture of the old slides.
    versionRestore.run = async () => {
      mounted?.loads.push(Promise.resolve(new Response('{}', { status: 404 })))
    }
    await editFirstSlide()
    await versionsPanel.restore('v2')
    expect(saves).toHaveLength(1)
    expect(inReadonlyMode.value).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(previews).toEqual([])

    versionRestore.run = async () => {}
    mounted?.loads.push(Promise.resolve(new Response('{}', { status: 403 })))
    await versionsPanel.restore('v3')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(previews).toEqual([])
  })

  it('still sends the save it made first when the server refuses the restore', async () => {
    await openDeck([firstSlide('#ffffffff'), secondSlide])
    versionRestore.run = async () => {
      throw new Error('The version is gone')
    }

    await editFirstSlide()
    await expect(versionsPanel.restore('v1')).rejects.toThrow('The version is gone')
    await vi.advanceTimersByTimeAsync(5_000)

    await vi.waitFor(() => expect(previews).toHaveLength(1))
  })
})

function savedSlides(value: unknown) {
  if (!value || typeof value !== 'object' || !('slides' in value) || !Array.isArray(value.slides))
    throw new Error('Expected a saved slide array')
  return value.slides.map((slide: unknown) => {
    if (!isSavedSlide(slide)) throw new Error('Expected serialized slide elements')
    return slide
  })
}

interface SavedSlidePayload {
  elements: string
  [key: string]: unknown
}
function isSavedSlide(value: unknown): value is SavedSlidePayload {
  return (
    !!value &&
    typeof value === 'object' &&
    'elements' in value &&
    typeof value.elements === 'string'
  )
}

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
    mounted = await openedSurface()
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
