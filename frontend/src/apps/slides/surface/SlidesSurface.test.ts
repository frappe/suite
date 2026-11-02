import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  type Ref,
  type SetupContext,
} from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { DocumentSession } from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
const saves: unknown[] = []
const signedIn = vi.hoisted(() => ({ user: 'me@example.com' }))
const versionsPanel = vi.hoisted(() => ({ flush: async () => {} }))
let isRefusing = false

interface MenuEntry {
  label: string
  condition?: () => boolean
  onClick: () => void
  options?: MenuEntry[]
}

const served = {
  node: 'node-1',
  owner: 'me@example.com',
  title: 'Quarterly plan',
  modified: 'M1',
  modified_by: 'me@example.com',
  is_composite: 0,
  theme: null,
  slides: [
    { clientId: 'c1', background: '#ffffffff', elements: [] },
    { clientId: 'c2', background: '#ffffffff', elements: [] },
  ],
}

vi.mock('@/api', async () => {
  const { createApiClient } = await import('@/platform/server-state')
  const { createTransport } = await import('@/platform/transport')
  const { api: slides } = await import('../client/api')
  const { registration } = await import('../client/policy')
  return {
    api: { slides },
    ...createApiClient(
      { slides: async () => registration },
      { persistence: false, transport: createTransport({ fetch: server.fetch }) },
    ),
  }
})
vi.mock('frappe-ui', () => {
  const passthrough = {
    setup:
      (_: unknown, { slots }: SetupContext) =>
      () =>
        h('div', slots.default?.()),
  }
  return {
    ...Object.fromEntries(
      [
        'Badge',
        'Button',
        'Checkbox',
        'Combobox',
        'ContextMenu',
        'Dialog',
        'FileUploader',
        'Popover',
        'Select',
        'Skeleton',
        'Switch',
        'TabButtons',
        'TextInput',
        'Tooltip',
      ].map((name) => [name, passthrough]),
    ),
    // the menu's choices render as buttons, so a test can pick one
    Dropdown: {
      props: { options: { type: Array, default: () => [] } },
      setup:
        (props: { options: MenuEntry[] }, { slots }: SetupContext) =>
        () =>
          h('div', [
            slots.default?.(),
            ...props.options
              .flatMap((entry) => entry.options ?? [entry])
              .filter((option) => option.condition?.() !== false)
              .map((option) => h('button', { onClick: option.onClick }, option.label)),
          ]),
    },
    FileUploadHandler: class {},
    dialog: vi.fn(),
    toast: {
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      dismiss: vi.fn(),
    },
    useKeyboardShortcut: vi.fn(),
    usePageMeta: vi.fn(),
  }
})
vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({
      ...original.useSession(),
      user: {
        get value() {
          return { id: signedIn.user }
        },
      },
    }),
  }
})
const warms = vi.hoisted(() => [] as Promise<void>[])
vi.mock('@/apps/slides/stores/offlineCopy', async (importOriginal) => {
  const store = await importOriginal<typeof import('@/apps/slides/stores/offlineCopy')>()
  function warmOfflineCopyAssets(id: string) {
    const warm = store.warmOfflineCopyAssets(id)
    warms.push(warm)
    return warm
  }

  return { ...store, warmOfflineCopyAssets }
})
vi.mock('@/apps/slides/router', () => ({
  router: { currentRoute: { value: { params: {}, query: {} } }, replace: vi.fn() },
}))
vi.mock('@/apps/drive', () => ({
  GUEST_NAME_LIMIT: 50,
  DriveDocumentHeader: {
    props: { recoverable: Boolean },
    emits: ['download-changes', 'update:panel'],
    setup:
      (props: { recoverable: boolean }, { slots, emit }: SetupContext) =>
      () =>
        h('header', [
          slots.actions?.(),
          slots.primary?.(),
          slots.icon?.({ icon: '' }),
          h('button', {
            'data-download-changes': '',
            hidden: !props.recoverable,
            onClick: () => emit('download-changes'),
          }),
          h('button', { 'data-versions': '', onClick: () => emit('update:panel', 'versions') }),
        ]),
  },
  DriveCommentAuthor: { render: () => null },
  useDriveDocumentActions: () => computed(() => ({ back: [], node: [] })),
  useDriveGuestName: () => ({
    shown: ref(false),
    text: ref(''),
    atLimit: ref(false),
    maxLength: 50,
    take: () => undefined,
  }),
}))
// a thumbnail that isn't the current slide asks the surface to change to it
vi.mock('@/apps/slides/components/NavigationPanel.vue', async () => {
  const { slides } = await import('@/apps/slides/stores/slide')
  return {
    default: defineComponent({
      emits: ['changeSlide'],
      setup:
        (_, { emit }) =>
        () =>
          h(
            'nav',
            slides.value.map((_slide, index) =>
              h('button', { onClick: () => emit('changeSlide', index) }),
            ),
          ),
    }),
  }
})
for (const path of [
  '@/apps/slides/components/SlideContainer.vue',
  '@/apps/slides/components/PropertiesPanel.vue',
  '@/apps/slides/components/Toolbar.vue',
  '@/apps/slides/components/LayoutDialog.vue',
  '@/apps/slides/components/ThemeDialog.vue',
  './ExportView.vue',
]) {
  vi.doMock(path, () => ({ default: { render: () => null } }))
}

vi.doMock('./SlidesVersionsPanel.vue', () => ({
  default: {
    props: { flush: { type: Function, default: null } },
    setup(props: { flush: () => Promise<void> }) {
      versionsPanel.flush = props.flush
      return () => null
    },
  },
}))

vi.doMock('@/apps/slides/components/OfflineCopyButton.vue', () => ({
  default: { render: () => h('button', { 'data-offline-copy': '' }) },
}))

vi.doMock('@/apps/slides/pages/Slideshow.vue', () => ({
  __esModule: true,
  default: { render: () => h('div', { 'data-show': '' }) },
}))

const { default: SlidesSurface } = await import('./SlidesSurface.vue')
const {
  duplicateSlide,
  saveSlide,
  slideIndex,
  slides: editorSlides,
} = await import('@/apps/slides/stores/slide')
const { dirty, getPresentationFromLocalDB, isSaving, saveRefused, writeDraft } =
  await import('@/apps/slides/stores/saving')
const { keepRecovery, readRecovery } = await import('./recovery')
const { toast } = await import('frappe-ui')
const { changeSlideInSlideshow } = await import('@/apps/slides/stores/slideshow')
const { router: slidesRouter } = await import('@/apps/slides/router')

function answer(message: unknown) {
  return new Response(JSON.stringify({ message }), { status: 200 })
}

function session(docname: string, access: Ref<{ role: number }>): DocumentSession {
  return {
    nodeId: 'node-1',
    contentDoctype: 'Presentation',
    contentDocname: docname,
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access,
    refreshAccess: async () => {},
    credentials: { context: undefined, heldContext: undefined },
    media: () => undefined,
  } as unknown as DocumentSession
}

// each test opens its own presentation, so no draft carries over between them
let opens = 0

async function openedSurface({ path = '', role = 50, slides = served.slides } = {}) {
  const docname = `p${++opens}`
  const loads: Array<Promise<void>> = []
  server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('save_slides')) {
      if (isRefusing) {
        return new Response(JSON.stringify({ exc_type: 'TimestampMismatchError' }), { status: 417 })
      }

      saves.push(JSON.parse(String(init?.body)))
      const version = saves.length + 1
      return answer({ modified: `M${version}` })
    }

    if (url.includes('get_templates')) {
      return answer([])
    }

    const held = loads.shift()
    if (held) {
      await held
    }

    return answer({ ...structuredClone(served), slides, name: docname })
  })
  const access = ref({ role })
  const opened = session(docname, access)
  const view = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/d/:node',
        component: SlidesSurface,
        props: () => ({ session: opened }),
        children: [
          { path: 'present', name: 'slides-slideshow', component: view },
          { path: ':slug?', name: 'document-host', component: view },
        ],
      },
    ],
  })
  await router.push(`/d/node-1${path}`)
  const app = createApp(defineComponent({ setup: () => () => h(RouterView) }))
  app.use(router).use(translationPlugin)
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await vi.waitFor(() => expect(thumbnails(root)).toHaveLength(slides.length))
  return { app, root, docname, router, access, loads }
}

function shown() {
  return document.querySelector('[data-show]') !== null
}

function thumbnails(root: Element) {
  return [...root.querySelectorAll<HTMLButtonElement>('nav button')]
}

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
    const next = opens + 1
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

  interface RefusalActions {
    action: { label: string; onClick: (event: Event) => void }
    cancel: { label: string; onClick: () => void }
    duration: number
  }

  let files: ReturnType<typeof vi.fn<(file: File) => string>>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(toast.warning).mockReturnValue('refusal')
    localStorage.clear()
    files = vi.fn((_file: File) => 'blob:recovery')

    URL.createObjectURL = files as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = () => {}

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"pong"}')),
    )
  })

  afterEach(() => {
    isRefusing = false
    served.modified = 'M1'
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function refusalToast(message: string) {
    const call = vi.mocked(toast.warning).mock.calls.find(([text]) => text === message)
    const [, actions] = call ?? []
    return actions as unknown as RefusalActions | undefined
  }

  async function refused(message = REFUSED) {
    mounted = await openedSurface()
    isRefusing = true
    duplicateSlide()
    await vi.waitFor(() => expect(refusalToast(message)).toBeDefined(), { timeout: 3000 })
    return refusalToast(message) as RefusalActions
  }

  function serverMoves() {
    isRefusing = false
    served.modified = 'M2'
  }

  async function reloaded(toastShown: RefusalActions) {
    toastShown.cancel.onClick()
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

  it('says so in a toast that stays up, and keeps a copy at that moment', async () => {
    const refusal = await refused()

    expect(refusal.duration).toBe(Number.POSITIVE_INFINITY)
    expect(refusal.action.label).toBe('Download')
    expect(refusal.cancel.label).toBe('Reload')
    const [copy] = readRecovery('node-1')
    expect(copy.slides).toHaveLength(3)
    expect(copy.sticky).toBe(true)
  })

  it('keeps the copy through a reload, an edit and a landed save', async () => {
    const refusal = await refused()

    serverMoves()
    await reloaded(refusal)
    expect(readRecovery('node-1')).toHaveLength(1)
    expect(toast.dismiss).toHaveBeenCalledWith('refusal')

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
    const nextOpen = opens + 1
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

    const click = new MouseEvent('click', { cancelable: true })
    refusal.action.onClick(click)
    expect(click.defaultPrevented).toBe(true)
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

    refusal.action.onClick(new MouseEvent('click', { cancelable: true }))

    expect(await downloadedSlides()).toHaveLength(3)
    expect(await draftDirty()).toBe(true)
    expect(readRecovery('node-1').map((copy) => copy.slides)).toEqual([[{ clientId: 'older' }]])
  })

  it('ends nothing with a download in the hold, and a reload adds no second copy', async () => {
    const refusal = await refused()
    const before = readRecovery('node-1')

    refusal.action.onClick(new MouseEvent('click', { cancelable: true }))

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
