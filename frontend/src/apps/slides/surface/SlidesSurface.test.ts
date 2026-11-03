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
const themeChange = vi.hoisted(() => ({ update: (_theme: string) => {} }))
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
const visits = vi.hoisted(() => ({
  remember: vi.fn((_id: string) => Promise.resolve()),
  cancel: vi.fn(),
}))
vi.mock('@/apps/slides/stores/visitedCopies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/slides/stores/visitedCopies')>()),
  rememberVisit: visits.remember,
  cancelVisit: visits.cancel,
}))
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
  './ExportView.vue',
]) {
  vi.doMock(path, () => ({ default: { render: () => null } }))
}

vi.doMock('@/apps/slides/components/ThemeDialog.vue', () => ({
  default: {
    emits: ['update'],
    setup(_: unknown, { emit }: SetupContext) {
      themeChange.update = (theme) => emit('update', theme)
      return () => null
    },
  },
}))

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
const {
  dirty,
  getPresentationFromLocalDB,
  isSaving,
  saveCurrentState,
  saveFailed,
  saveRefused,
  writeDraft,
} = await import('@/apps/slides/stores/saving')
const { initPresentationDoc, inReadonlyMode, viewOnly } =
  await import('@/apps/slides/stores/presentation')
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

async function openedSurface({
  path = '',
  role = 50,
  slides = served.slides,
  firstLoad,
}: {
  path?: string
  role?: number
  slides?: unknown[]
  firstLoad?: Promise<void | Response>
} = {}) {
  const docname = `p${++opens}`
  const loads: Array<Promise<void | Response>> = []
  if (firstLoad) {
    loads.push(firstLoad)
  }

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
    const heldAnswer = held && (await held)
    if (heldAnswer) {
      return heldAnswer
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
  if (!firstLoad) {
    await vi.waitFor(() => expect(thumbnails(root)).toHaveLength(slides.length))
  }

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
      const next = opens + 1
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

    it('says the copy is kept when it is', async () => {
      await narrowedWithEdits()

      expect(refusalToast(KEPT)).toBeDefined()
      expect(refusalToast(UNSTORED)).toBeUndefined()
      expect(readRecovery('node-1')).toHaveLength(1)
    })

    it('says to download, and nothing else, when the store is full', async () => {
      await narrowedWithEdits(fillTheStore)

      expect(refusalToast(UNSTORED)?.duration).toBe(Number.POSITIVE_INFINITY)
      expect(refusalToast(KEPT)).toBeUndefined()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('sends the live slides past an older copy', async () => {
      await narrowedWithEdits(() => {
        keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
        fillTheStore()
      })

      refusalToast(UNSTORED)?.action.onClick(new MouseEvent('click', { cancelable: true }))
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
      const back = refusalToast(BACK_UNSTORED)
      expect(back?.action.label).toBe('Download')
      expect(back?.cancel.label).toBe('Reload')

      back?.action.onClick(new MouseEvent('click', { cancelable: true }))
      expect(await downloadedSlides()).toHaveLength(3)
    })

    it('saves nothing while the slides wait, and Reload loads the server copy', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      await new Promise((resolve) => setTimeout(resolve, 1200))

      expect(saves).toEqual([])

      vi.spyOn(window, 'confirm').mockReturnValue(true)
      refusalToast(BACK_UNSTORED)?.cancel.onClick()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      await nextTick()

      expect(downloadButton()).toBeNull()
      expect(toast.dismiss).toHaveBeenCalled()
    })

    it('keeps a copy and then loads when access returns with room', async () => {
      await narrowedWithEdits(fillTheStore)

      vi.mocked(Storage.prototype.setItem).mockRestore()
      widen()
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))

      expect(refusalToast(BACK_UNSTORED)).toBeUndefined()
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
      await vi.waitFor(() => expect(refusalToast(UNSTORED)).toBeDefined(), { timeout: 3000 })
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
      refusalToast(BACK_UNSTORED)?.cancel.onClick()
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
      refusalToast(BACK_UNSTORED)?.cancel.onClick()
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
      refusalToast(KEPT)?.action.onClick(new MouseEvent('click', { cancelable: true }))
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
      const nextOpen = opens + 1
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
      expect(refusalToast(KEPT)).toBeUndefined()
      refusalToast(UNREAD)?.action.onClick(new MouseEvent('click', { cancelable: true }))
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
      expect(refusalToast(UNREAD)).toBeUndefined()
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

    it('stays view only when access returns and the store is still full', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      await nextTick()

      expect(inReadonlyMode.value).toBe(true)
      expect(refusalToast(BACK_UNSTORED)).toBeDefined()
      expect(toast.info).not.toHaveBeenCalled()
    })

    it('keeps a copy on Reload when there is room by then, with no question', async () => {
      await narrowedWithEdits(fillTheStore)
      widen()
      vi.mocked(Storage.prototype.setItem).mockRestore()
      const confirm = vi.spyOn(window, 'confirm')

      refusalToast(BACK_UNSTORED)?.cancel.onClick()
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
      const shownBefore = vi.mocked(toast.warning).mock.calls.length
      const reads = server.fetch.mock.calls.length

      refusalToast(BACK_UNSTORED)?.cancel.onClick()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(editorSlides.value).toHaveLength(3)
      expect(server.fetch.mock.calls.length).toBe(reads)
      expect(vi.mocked(toast.warning).mock.calls.length).toBe(shownBefore + 1)
      expect(vi.mocked(toast.warning).mock.lastCall?.[0]).toBe(BACK_UNSTORED)
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
      refusalToast(BACK_UNSTORED)?.cancel.onClick()
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

      expect(refusalToast(UNSTORED)).toBeDefined()
      expect(refusalToast(VIEW_ONLY)).toBeUndefined()
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

    it('closes the refusal when the only copy takes over', async () => {
      await refused()
      fillTheStore()
      vi.mocked(toast.dismiss).mockClear()
      vi.mocked(toast.warning).mockClear()
      vi.mocked(toast.warning).mockReturnValue('only copy')

      if (mounted) {
        mounted.access.value = { role: 10 }
      }

      await nextTick()
      expect(toast.dismiss).toHaveBeenCalledWith('refusal')
      expect(refusalToast(UNSTORED)).toBeDefined()
      expect(vi.mocked(toast.warning).mock.calls).toHaveLength(1)
    })
  })

  describe('a copy that outlived its page', () => {
    const rows = [
      {
        name: 'row-1',
        client_id: 'c1',
        background: '#FFF',
        elements: JSON.stringify([
          { id: 'e1', type: 'shape', shapeType: 'circle', fillColor: 'red', top: 1, left: 2 },
        ]),
        transition: null,
        transition_duration: '0.5',
        fade_unmatched_elements: 0,
        advance_after: null,
      },
    ]

    async function saveLanded(count: number) {
      await vi.waitFor(() => expect(saves.length).toBeGreaterThanOrEqual(count), { timeout: 3000 })
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
      await nextTick()
    }

    // the copy a closing page keeps, with what its push had sent by then
    async function closedWithCopy() {
      mounted = await openedSurface({ slides: rows })
      duplicateSlide()
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
      const [copy] = readRecovery('node-1')
      expect(copy.sticky).toBe(false)
      await saveLanded(1)
      const { slides: sent } = saves[0] as { slides: Record<string, unknown>[] }
      mounted.app.unmount()
      mounted = null
      // the unmount sends what it holds, and that landing must not reach the next open
      await new Promise((resolve) => setTimeout(resolve, 50))
      await vi.waitFor(() => expect(isSaving.value).toBe(false))
      saves.length = 0
      localStorage.clear()
      return { copy, sent }
    }

    it('keeps a copy that differs from the load through the first landed save', async () => {
      keepRecovery('node-1', [{ clientId: 'gone', background: '#000000ff', elements: [] }])
      mounted = await openedSurface()
      const [kept] = readRecovery('node-1')
      expect(kept.sticky).toBe(true)

      duplicateSlide()
      await saveLanded(1)

      expect(readRecovery('node-1')).toHaveLength(1)
    })

    it.each<[string, 'server' | 'draft']>([
      ['the server took its push', 'server'],
      ['its draft restores', 'draft'],
    ])('clears a copy with the same content when %s', async (_name, route) => {
      const { copy, sent } = await closedWithCopy()
      keepRecovery('node-1', copy.slides)
      if (route === 'draft') {
        const nextOpen = opens + 1
        await writeDraft({
          id: `p${nextOpen}`,
          content: copy.slides,
          dirty: true,
          updatedAt: 1,
          baseModified: 'M1',
        })
      }

      // what the server stores: each row gets a name, and numbers come back as strings
      const stored = sent.map((row, position) => ({
        ...row,
        name: row.client_id,
        idx: position + 1,
        transition_duration: String(row.transition_duration),
      }))
      mounted = await openedSurface({ slides: stored })
      await vi.waitFor(() => expect(editorSlides.value).toHaveLength(2))
      const [same] = readRecovery('node-1')
      expect(same.sticky).toBe(false)

      duplicateSlide()
      await saveLanded(1)

      expect(readRecovery('node-1')).toEqual([])
    })

    it('still clears a same-page copy on the next landed save after the first', async () => {
      mounted = await openedSurface()
      duplicateSlide()
      await saveLanded(1)
      duplicateSlide()
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
      const [ownPage] = readRecovery('node-1')
      expect(ownPage.sticky).toBe(false)

      await saveLanded(2)

      expect(readRecovery('node-1')).toEqual([])
    })

    it('holds off a landing from the last surface until the first load has compared', async () => {
      keepRecovery('node-1', [{ clientId: 'gone', background: '#000000ff', elements: [] }])
      let release!: () => void
      mounted = await openedSurface({
        firstLoad: new Promise<void>((resolve) => {
          release = resolve
        }),
      })
      saveFailed.value = false
      isSaving.value = true
      await nextTick()
      isSaving.value = false
      await nextTick()

      release()
      await vi.waitFor(() => expect(thumbnails(mounted?.root as Element)).toHaveLength(2))

      const [held] = readRecovery('node-1')
      expect(held.sticky).toBe(true)
    })

    it('leaves a copy alone when the surface goes before its first load ends', async () => {
      keepRecovery('node-1', [{ clientId: 'gone' }])
      let release!: () => void
      mounted = await openedSurface({
        firstLoad: new Promise<void>((resolve) => {
          release = resolve
        }),
      })

      mounted.app.unmount()
      mounted = null
      release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const [untouched] = readRecovery('node-1')
      expect(untouched.sticky).toBe(false)
    })
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
