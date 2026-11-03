import { afterEach, beforeEach, expect, vi } from 'vitest'
import {
  computed,
  createApp,
  defineComponent,
  h,
  ref,
  type Component,
  type Ref,
  type SetupContext,
} from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { DocumentSession } from '@/apps/drive'
import { translationPlugin } from '@/platform/translation'

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
export const saves: unknown[] = []
const signedIn = vi.hoisted(() => ({ user: 'me@example.com' }))
const versionsPanel = vi.hoisted(() => ({ flush: async () => {} }))
const themeChange = vi.hoisted(() => ({ update: (_theme: string) => {} }))
const forgetTemplates = vi.hoisted(() => ({ run: () => {} }))
const propertiesPanel = vi.hoisted(() => ({ real: null as Component | null }))
export const fakeServer = { isRefusing: false, isFailingTemplates: false, opens: 0 }

interface MenuEntry {
  label: string
  condition?: () => boolean
  onClick: () => void
  options?: MenuEntry[]
}

export const served = {
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
  const engine = createApiClient(
    { slides: async () => registration },
    { persistence: false, transport: createTransport({ fetch: server.fetch }) },
  )

  forgetTemplates.run = () => {
    engine.invalidate((reference) => reference.id === 'get_templates')
  }

  return { api: { slides }, ...engine }
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
  '@/apps/slides/components/Toolbar.vue',
  '@/apps/slides/components/LayoutDialog.vue',
  './ExportView.vue',
]) {
  vi.doMock(path, () => ({ default: { render: () => null } }))
}

vi.doMock('@/apps/slides/components/PropertiesPanel.vue', () => ({
  default: { render: () => propertiesPanel.real && h(propertiesPanel.real) },
}))

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
const { toast } = await import('frappe-ui')

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

export async function openedSurface({
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
  const docname = `p${++fakeServer.opens}`
  const loads: Array<Promise<void | Response>> = []
  if (firstLoad) {
    loads.push(firstLoad)
  }

  server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('save_slides')) {
      if (fakeServer.isRefusing) {
        return new Response(JSON.stringify({ exc_type: 'TimestampMismatchError' }), { status: 417 })
      }

      const body = JSON.parse(String(init?.body))
      // an earlier open's leaving push can land here
      if (body.name === docname) {
        saves.push(body)
      }

      const version = saves.length + 1
      return answer({ modified: `M${version}` })
    }

    if (url.includes('get_templates')) {
      if (fakeServer.isFailingTemplates) {
        throw new TypeError('Failed to fetch')
      }

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

export function shown() {
  return document.querySelector('[data-show]') !== null
}

export function thumbnails(root: Element) {
  return [...root.querySelectorAll<HTMLButtonElement>('nav button')]
}

// what a test of kept copies starts from: nothing stored, a signal, the server reachable
export function startsFromEmptyStore() {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(toast.warning).mockReturnValue('refusal')
    localStorage.clear()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"pong"}')),
    )
  })

  afterEach(() => {
    fakeServer.isRefusing = false
    fakeServer.isFailingTemplates = false
    served.modified = 'M1'
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

export {
  server,
  signedIn,
  versionsPanel,
  themeChange,
  forgetTemplates,
  propertiesPanel,
  warms,
  visits,
}
