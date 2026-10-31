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

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
const saves: unknown[] = []
const signedIn = vi.hoisted(() => ({ user: 'me@example.com' }))
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
        'Dropdown',
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
    FileUploadHandler: class {},
    dialog: vi.fn(),
    toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
    useKeyboardShortcut: vi.fn(),
    usePageMeta: vi.fn(),
  }
})
vi.mock('@/boot/session', async (importOriginal) => {
  const { reactive: wrap } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@/boot/session')>()),
    session: wrap({
      user: {
        get sessionUser() {
          return signedIn.user
        },
      },
    }),
  }
})
vi.mock('@/apps/slides/router', () => ({
  router: { currentRoute: { value: { params: {}, query: {} } }, replace: vi.fn() },
}))
vi.mock('@/apps/drive', () => ({
  GUEST_NAME_LIMIT: 50,
  DriveDocumentHeader: {
    setup:
      (_: unknown, { slots }: SetupContext) =>
      () =>
        h('header', slots.actions?.()),
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
  './SlidesVersionsPanel.vue',
  './ExportView.vue',
]) {
  vi.doMock(path, () => ({ default: { render: () => null } }))
}

vi.doMock('@/apps/slides/components/OfflineCopyButton.vue', () => ({
  default: { render: () => h('button', { 'data-offline-copy': '' }) },
}))

vi.doMock('@/apps/slides/pages/Slideshow.vue', () => ({
  __esModule: true,
  default: { render: () => h('div', { 'data-show': '' }) },
}))

const { default: SlidesSurface } = await import('./SlidesSurface.vue')
const { duplicateSlide, slideIndex } = await import('@/apps/slides/stores/slide')

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
  app.use(router)
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
    vi.stubGlobal('caches', { open: async () => ({}), match: async () => undefined })
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

  it('tells the worker when the presentation opens and closes', async () => {
    mounted = await openedSurface()
    await vi.waitFor(() => expect(posted).toEqual(['slides-entered']))

    mounted.app.unmount()
    mounted.root.remove()
    mounted = null

    expect(posted).toEqual(['slides-entered', 'slides-left'])
  })
})
