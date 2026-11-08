import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, type Component } from 'vue'
import { applyUpdate, Doc } from 'yjs'

import {
  collabRoom,
  fakeServer,
  forgetTemplates,
  openedSurface,
  previews,
  propertiesPanel,
  saves,
  served,
  server,
  shown,
  signedIn,
  startsFromEmptyStore,
  themeChange,
  thumbnails,
  versionRestore,
  versionsPanel,
  visits,
  warms,
} from './SlidesSurface.fakes'

const {
  duplicateSlide,
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
const { initPresentationDoc, inReadonlyMode, loadTemplates, viewOnly } =
  await import('@/apps/slides/stores/presentation')
const { offlineCopyStatus } = await import('@/apps/slides/stores/offlineCopy')
const { RECORD_PREFIX } = await import('@/apps/slides/utils/slidesCaches')
const { keepRecovery, readRecovery, removeNewestRecovery } = await import('./recovery')
const { toast, useKeyboardShortcut } = await import('frappe-ui')
const { changeSlideInSlideshow } = await import('@/apps/slides/stores/slideshow')
const { router: slidesRouter } = await import('@/apps/slides/router')
const { setActiveElements } = await import('@/apps/slides/stores/element')
const { convertLegacy } = await import('@/apps/slides/collab/conversion')
const { addSlide, deleteSlide } = await import('@/apps/slides/collab/deck')

let mounted: Awaited<ReturnType<typeof openedSurface>> | null = null

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = null
  saves.length = 0
  server.fetch.mockReset()
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
    expect((saves[0] as { slides: unknown[] }).slides).toHaveLength(3)
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

// frappe-ui's dispatcher: a shortcut runs only while it is enabled
async function press(combo: string) {
  const [shortcuts] = vi.mocked(useKeyboardShortcut).mock.lastCall as [
    { combo: string; enabled?: () => boolean; handler: (event: KeyboardEvent) => void }[],
  ]
  const shortcut = shortcuts.find((entry) => entry.combo === combo)!
  if (shortcut.enabled?.() ?? true) shortcut.handler(new KeyboardEvent('keydown'))
  await nextTick()
}

function banner() {
  return document.querySelector('[role="alert"]')
}

function toolbar() {
  return document.querySelector('[data-toolbar]')
}

describe('Slides editing a deck another tab holds', () => {
  // the Button stand-in keeps its label as an attribute
  function action(label: string) {
    return document.querySelector<HTMLElement>(`[role="alert"] [label="${label}"]`)!
  }

  function menuItem(label: string) {
    return [...document.querySelectorAll('button')].find((item) => item.textContent === label)
  }

  // another tab holds every deck: only a steal is granted
  function anotherTabHoldsTheDeck() {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          options: { steal?: boolean },
          hold: (lock: { name: string } | null) => unknown,
        ) => hold(options.steal ? { name } : null),
      },
    })
  }

  // this tab gets the lock; the answer is what another tab's "Edit here" does to it
  function thisTabHoldsTheDeck() {
    let takeOver = () => {}
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          name: string,
          _options: unknown,
          hold: (lock: { name: string }) => Promise<unknown>,
        ) =>
          new Promise((resolve, reject) => {
            takeOver = () => reject(new DOMException('Stolen', 'AbortError'))
            void hold({ name }).then(resolve, reject)
          }),
      },
    })
    return () => takeOver()
  }

  function asksBeforeLeaving() {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  async function lockedDeck() {
    anotherTabHoldsTheDeck()
    const opened = await openedSurface()
    await vi.waitFor(() =>
      expect(banner()?.textContent).toContain('open for editing in another tab'),
    )
    return opened
  }

  async function storedDraft() {
    return (await getPresentationFromLocalDB(mounted?.docname)) as {
      dirty: boolean
      content: unknown[]
    } | null
  }

  afterEach(() => {
    delete (navigator as { locks?: unknown }).locks
  })

  it('opens read-only while another tab edits the deck, and edits here on request', async () => {
    mounted = await lockedDeck()
    expect(toolbar()).toBeNull()
    await press('Mod+D')
    expect(thumbnails(mounted.root)).toHaveLength(2)

    action('Edit here').click()
    await vi.waitFor(() => expect(banner()).toBeNull())
    expect(toolbar()).not.toBeNull()
    await press('Mod+D')
    expect(thumbnails(mounted.root)).toHaveLength(3)
  })

  it('does not let a locked tab restore a version or change the theme', async () => {
    mounted = await lockedDeck()
    versionsPanel.writable = true
    mounted.root.querySelector<HTMLElement>('[data-versions]')?.click()
    await nextTick()

    expect(versionsPanel.writable).toBe(false)
    expect(menuItem('Change theme')).toBeUndefined()
    themeChange.update('Dark')
    await new Promise((resolve) => setTimeout(resolve))
    expect(server.fetch.mock.calls.filter(([url]) => String(url).includes('update_theme'))).toEqual(
      [],
    )

    action('Edit here').click()
    await vi.waitFor(() => expect(banner()).toBeNull())
    expect(versionsPanel.writable).toBe(true)
    expect(menuItem('Change theme')).toBeDefined()
  })

  describe('when another tab takes the deck from this one', () => {
    it('leaves the unsaved edit in the draft and has nothing left to warn about', async () => {
      const takeOver = thisTabHoldsTheDeck()
      mounted = await openedSurface()
      duplicateSlide()

      takeOver()

      await vi.waitFor(() => expect(banner()).not.toBeNull())
      await vi.waitFor(() => expect(dirty.value).toBe(false))
      const draft = await storedDraft()
      expect(draft?.dirty).toBe(true)
      expect(draft?.content).toHaveLength(3)
      expect(saves).toEqual([])
      expect(asksBeforeLeaving()).toBe(false)
    })

    it('stays dirty when the draft could not be written', async () => {
      const takeOver = thisTabHoldsTheDeck()
      mounted = await openedSurface()
      duplicateSlide()
      const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('Refused', 'UnknownError')
      })

      takeOver()
      await vi.waitFor(() => expect(banner()).not.toBeNull())
      await new Promise((resolve) => setTimeout(resolve, 50))
      put.mockRestore()

      expect(dirty.value).toBe(true)
      expect(asksBeforeLeaving()).toBe(true)
    })

    it('sends nothing and warns of nothing when no edit was made', async () => {
      const takeOver = thisTabHoldsTheDeck()
      mounted = await openedSurface()

      takeOver()
      await vi.waitFor(() => expect(banner()).not.toBeNull())
      expect((await storedDraft())?.dirty).not.toBe(true)

      // what the tab that took over does next: it loads, and saves only if something is dirty
      action('Edit here').click()
      await vi.waitFor(() => expect(banner()).toBeNull())
      await new Promise((resolve) => setTimeout(resolve, 1100))

      expect(dirty.value).toBe(false)
      expect(saves).toEqual([])
    })
  })
})

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

  it('shows a System Manager the reason the server sent', async () => {
    mounted = await openedSurface({
      deck: { conversion: { state: 'refused', reason: 'check: html' } },
    })

    expect(statusOf(mounted.root)).toContain('Reason: check: html.')
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
          elements: [{ id: `box-${text}`, type: 'text', content: `<p>${text}</p>` }],
        })),
      },
      4 * 1024 * 1024,
    )
    if (answer.kind !== 'converted') {
      throw new Error(JSON.stringify(answer))
    }

    const doc = new Doc()
    applyUpdate(doc, answer.state)
    return { doc, close: vi.fn(async () => {}) }
  }

  function convertedRoom(...texts: string[]) {
    const room = roomOf(...texts)
    collabRoom.open.mockResolvedValueOnce({ state: 'live', room })
    return room.doc
  }

  function drawnTexts() {
    const drawn = editorSlides.value as Array<{ elements: Array<{ content?: string }> }>
    return drawn.map((slide) => slide.elements.map((element) => element.content).join())
  }

  it('draws a converted presentation in the view-only editor from its room, not its rows', async () => {
    convertedRoom('one', 'two', 'three')
    mounted = await openedSurface({ deck: { is_converted: true } })

    await vi.waitFor(() => expect(thumbnails(mounted!.root)).toHaveLength(3))
    expect(drawnTexts()).toEqual(
      ['one', 'two', 'three'].map((text) => expect.stringContaining(`>${text}</p>`)),
    )
    expect(viewOnly.value).toBe(true)
    expect(saves).toEqual([])
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
    const shortcuts = vi.mocked(useKeyboardShortcut).mock.calls.at(-1)![0] as unknown as Array<{
      combo: string
      handler: () => void
    }>

    shortcuts.find(({ combo }) => combo === 'Mod+P')!.handler()

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
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
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
      const root = mounted.root
      await vi.waitFor(() => expect(root.textContent).toContain('1 · ready'))
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

  it('hides the copy from someone who is not the owner', async () => {
    signedIn.user = 'someone@example.com'
    mounted = await openedSurface()
    await nextTick()

    expect(offlineCopyButton()).toBeNull()
  })

  it('hides the copy in a browser without service workers', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
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
      status: ref('refused'),
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
      media: () => refused as never,
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
      const root = mounted.root
      await vi.waitFor(() => expect(root.textContent).toContain('2 · failed'), { timeout: 5000 })
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
      status: ref('refused'),
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
      media: () => refused as never,
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
      delete (navigator as { onLine?: unknown }).onLine
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

  interface KeptToast {
    action: { label: string; onClick: (event: Event) => void }
  }

  let files: ReturnType<typeof vi.fn<(file: File) => string>>

  startsFromEmptyStore()

  beforeEach(() => {
    files = vi.fn((_file: File) => 'blob:recovery')

    URL.createObjectURL = files as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = () => {}
  })

  function keptToast(message: string) {
    const call = vi.mocked(toast.warning).mock.calls.find(([text]) => text === message)
    const [, actions] = call ?? []
    return actions as unknown as KeptToast | undefined
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
    return heldNotice(message) as NonNullable<ReturnType<typeof heldNotice>>
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
    const [file] = files.mock.lastCall as [File]
    return JSON.parse(await file.text()).slides as unknown[]
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
    const docname = mounted?.docname as string
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    menuItem('Discard my changes')?.click()
    expect(confirm).toHaveBeenCalledWith("Discard your kept changes? This can't be undone.")
    expect(saveRefused.value).toBe(true)

    confirm.mockReturnValue(true)
    menuItem('Discard my changes')?.click()
    await vi.waitFor(() => expect(saveRefused.value).toBe(false))
    await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
    const draft = (await getPresentationFromLocalDB(docname)) as { dirty: boolean }
    expect(draft.dirty).toBe(false)
    expect(dirty.value).toBe(false)
  })

  describe('leaving', () => {
    async function left() {
      const docname = mounted?.docname as string
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
      expect((saves[0] as { slides: unknown[] }).slides).toHaveLength(served.slides.length + 1)
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
      return row?.parentElement?.querySelector('input') as HTMLInputElement
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
      const [saved] = (saves[0] as { slides: Array<{ elements: string }> }).slides
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
    const draft = (await getPresentationFromLocalDB(mounted?.docname as string)) as {
      dirty: boolean
    }
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
      expect(thumbnails(mounted?.root as Element)).toHaveLength(3)

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
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))

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
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))

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
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))

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
        expect(await getPresentationFromLocalDB(mounted?.docname as string)).toBeFalsy(),
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
        expect(await getPresentationFromLocalDB(mounted?.docname as string)).toBeFalsy(),
      )
      writes.mockRestore()
      release()
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))

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
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))
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

      expect(thumbnails(mounted?.root as Element)).toHaveLength(3)
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
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(1))
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
        expect((await getPresentationFromLocalDB(mounted?.docname as string))?.dirty).toBe(false),
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
