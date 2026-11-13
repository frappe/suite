import { afterEach, beforeEach, expect, vi } from 'vitest'
import { computed, createApp, defineComponent, h, ref, type Ref, type SetupContext } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { Doc } from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import type { ConvertVersionOutput } from '@/apps/slides/client/generated'
import { translationPlugin } from '@/platform/translation'

const { fromPartial, fromAny } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
// the stored bytes every version's content URL answers with
export const versionBytes = { current: new Uint8Array() }
// what the server's upgrade of an old version answers
interface VersionConversionFixture {
  answer: ConvertVersionOutput
}
export const versionConversion: VersionConversionFixture = { answer: {} }
// the slides the print view was last handed
interface ExportedFixture {
  slides: unknown[]
}
const exported = vi.hoisted((): ExportedFixture => ({ slides: [] }))
// a guest has no user
interface SignedIn {
  user: string | null
}
const signedIn = vi.hoisted((): SignedIn => ({ user: 'me@example.com' }))
interface VersionsPanelFixture {
  flush: () => Promise<void>
  restore: (seq: string) => Promise<void>
  confirmRestore: ((seq: string) => void) | null
  writable: boolean
  reloads: number
  // the version shown in the canvas's place, and how the panel picks one
  previewed: string | null
  preview: (seq: string | null) => void
}
const versionsPanel = vi.hoisted((): VersionsPanelFixture => ({
  flush: async () => {},
  restore: async () => {},
  confirmRestore: null,
  writable: false,
  reloads: 0,
  previewed: null,
  preview: () => {},
}))
// the two theme dialogs: the new presentation's pick, and a change of theme
const themeChange = vi.hoisted(() => ({
  create: (_theme: string) => {},
  update: (_theme: string) => {},
}))
// the templates the picker lists
interface TemplatesFixture {
  list: unknown[]
}
export const templates: TemplatesFixture = { list: [] }
// a pasted slide's pictures, adopted: a test can hold the answer back
interface SlideAdoptionFixture {
  held: Promise<void> | null
}
export const slideAdoption: SlideAdoptionFixture = { held: null }
const forgetTemplates = vi.hoisted(() => ({ run: () => {} }))
// what the presentation's comment threads read, and what the comment panel was handed
interface DriveComments {
  threads: unknown[]
  reads: number
  sent: unknown[][]
}
export const driveComments: DriveComments = { threads: [], reads: 0, sent: [] }
interface CommentPanelFixture {
  attrs: Record<string, unknown>
}
const commentPanel = vi.hoisted((): CommentPanelFixture => ({ attrs: {} }))
// a converted presentation's room; tests hand it a live one
const collabRoom = vi.hoisted(() => ({
  open: vi.fn(async (): Promise<unknown> => ({ state: 'failed' })),
}))
// converted templates' and sources' saved states by node, and the nodes read; any other node reads for real
interface SavedStatesFixture {
  byNode: Map<string, Doc | Error>
  reads: string[]
}
const savedStates = vi.hoisted((): SavedStatesFixture => ({ byNode: new Map(), reads: [] }))
// The realtime socket a presentation waiting for its conversion listens on
const realtime = await vi.hoisted(async () => {
  const { fakeSocket } = await import('@suite/collab-client/test-support')
  return { socket: fakeSocket({ answers: true }) }
})
export const fakeServer = { isFailingTemplates: false, opens: 0 }

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
  const { api: real } = await vi.importActual<typeof import('@/api')>('@/api')
  const engine = createApiClient(
    // Drive's own policy imports `@/api`, which is this module still loading.
    {
      slides: async () => registration,
      drive: async () => ({ policy: () => ({ effects: 'none' }) }),
    },
    { transport: createTransport({ fetch: server.fetch }) },
  )

  forgetTemplates.run = () => {
    engine.invalidate((reference) => reference.id === 'get_templates')
  }

  return { api: { slides, drive: real.drive }, ...engine }
})
vi.mock('modern-screenshot', () => ({
  domToWebp: async () => 'data:image/webp;base64,UklGRg==',
}))
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
    dialog: Object.assign(vi.fn(), { confirm: vi.fn(), danger: vi.fn() }),
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
          return signedIn.user ? { id: signedIn.user } : null
        },
      },
    }),
  }
})
const warms = vi.hoisted((): Promise<void>[] => [])
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
vi.mock('@/platform/collab', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/platform/collab')>()
  const { watchRooms } = await import('@suite/collab-client')
  return {
    ...real,
    openCollabRoom: collabRoom.open,
    watchConversion: (keys: string[], onTold: () => void) =>
      watchRooms(realtime.socket, keys, 'suite_collab_converted', onTold),
    readSavedDocument: async (options: Parameters<typeof real.readSavedDocument>[0]) => {
      const saved = savedStates.byNode.get(options.nodeId)
      if (!saved) {
        return real.readSavedDocument(options)
      }

      savedStates.reads.push(options.nodeId)
      if (saved instanceof Error) {
        throw saved
      }

      return saved
    },
  }
})
vi.mock('@/apps/slides/router', () => ({
  router: { currentRoute: { value: { params: {}, query: {} } }, replace: vi.fn() },
}))
vi.mock('@/apps/drive', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  documentSessionUrls: () => [],
  DriveDocumentHeader: {
    props: { recoverable: Boolean, panels: { type: Array, default: () => [] } },
    emits: ['download-changes', 'update:panel'],
    setup:
      (props: { recoverable: boolean; panels: string[] }, { slots, emit }: SetupContext) =>
      () =>
        h('header', [
          h('output', { 'data-panels': '' }, props.panels.join()),
          slots.actions?.(),
          slots.primary?.(),
          slots.icon?.({ icon: '' }),
          h('button', {
            'data-download-changes': '',
            hidden: !props.recoverable,
            onClick: () => emit('download-changes'),
          }),
          h('button', { 'data-versions': '', onClick: () => emit('update:panel', 'versions') }),
          h('button', { 'data-comments': '', onClick: () => emit('update:panel', 'comments') }),
        ]),
  },
  DriveCommentList: {
    inheritAttrs: false,
    setup: (_props: unknown, { attrs }: SetupContext) => {
      commentPanel.attrs = attrs
      return () => h('section', { 'data-comment-list': '' })
    },
  },
  useDriveDocumentActions: () => computed(() => ({ back: [], node: [] })),
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
  '@/apps/slides/components/LayoutDialog.vue',
]) {
  vi.doMock(path, () => ({ default: { render: () => null } }))
}

vi.doMock('./ExportView.vue', () => ({
  default: {
    props: { slides: { type: Array, default: () => [] } },
    setup(props: { slides: unknown[] }) {
      return () => {
        exported.slides = props.slides
        return h('div', [h('span', { style: 'font-family: Anton' }, 'Drawn')])
      }
    },
  },
}))

vi.doMock('@/apps/slides/components/Toolbar.vue', () => ({
  default: { render: () => h('div', { 'data-toolbar': '' }) },
}))

vi.doMock('@/apps/slides/components/PropertiesPanel.vue', () => ({
  default: { render: () => null },
}))

vi.doMock('@/apps/slides/components/ThemeDialog.vue', () => ({
  default: {
    props: { update: Boolean, open: Boolean },
    emits: ['create', 'update'],
    setup(props: { update: boolean; open: boolean }, { emit }: SetupContext) {
      if (props.update) {
        themeChange.update = (theme) => emit('update', theme)
      } else {
        themeChange.create = (theme) => emit('create', theme)
      }

      return () => (props.open && !props.update ? h('div', { 'data-theme-pick': '' }) : null)
    },
  },
}))

vi.doMock('./SlidesVersionsPanel.vue', () => ({
  default: {
    props: {
      flush: { type: Function, default: null },
      restore: { type: Function, default: null },
      confirmRestore: { type: Function, default: null },
      writable: Boolean,
      previewed: { type: String, default: null },
    },
    emits: ['update:previewed'],
    setup(
      props: {
        flush: () => Promise<void>
        restore: (seq: string) => Promise<void>
        confirmRestore: ((seq: string) => void) | null
        writable: boolean
        previewed: string | null
      },
      { emit, expose }: SetupContext,
    ) {
      versionsPanel.preview = (seq) => emit('update:previewed', seq)
      versionsPanel.flush = props.flush
      versionsPanel.restore = props.restore
      expose({
        reload: async () => {
          versionsPanel.reloads += 1
        },
      })
      return () => {
        versionsPanel.confirmRestore = props.confirmRestore
        versionsPanel.writable = props.writable
        versionsPanel.previewed = props.previewed
        return null
      }
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

function answer(message: unknown) {
  return new Response(JSON.stringify({ message }), { status: 200 })
}

function session(
  docname: string,
  access: Ref<{ role: number }>,
  media: DocumentSession['media'],
  panels: DocumentSession['panels']['value'],
): DocumentSession {
  return fromPartial<DocumentSession>({
    nodeId: 'node-1',
    contentDoctype: 'Presentation',
    contentDocname: docname,
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access,
    panels: ref(panels),
    refreshAccess: async () => {},
    credentials: {
      context: undefined,
      heldContext: undefined,
      fetch: async () => new Response(versionBytes.current),
      group: (nodeIds: readonly string[]) => [
        { context: undefined, nodeIds: [...nodeIds], fetch: server.fetch },
      ],
    },
    versions: {
      restore: async () => {},
      contentUrl: (seq: string) => `/versions/${seq}`,
    },
    canShare: ref(false),
    comments: {
      list: async () => {
        driveComments.reads += 1
        return { threads: driveComments.threads }
      },
      create: async (...sent: unknown[]) => {
        driveComments.sent.push(sent)
        return { name: 'thread-new' }
      },
    },
    media,
  })
}

export async function openedSurface({
  path = '',
  role = 50,
  slides = served.slides,
  firstLoad,
  // These surface tests have no media handles unless the caller supplies one.
  media = fromAny<DocumentSession['media'], () => undefined>(() => undefined),
  composite,
  deck,
  panels = ['comments', 'versions'],
}: {
  path?: string
  role?: number
  slides?: unknown[]
  firstLoad?: Promise<void | Response>
  media?: DocumentSession['media']
  // a reference's rows, or the node of a converted source whose saved state `savedStates` holds
  composite?: Record<string, unknown[] | Error | Promise<unknown[]> | { node: string }>
  deck?: Record<string, unknown>
  panels?: DocumentSession['panels']['value']
} = {}) {
  const docname = `p${++fakeServer.opens}`
  const loads: Array<Promise<void | Response>> = []
  if (firstLoad) {
    loads.push(firstLoad)
  }

  server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/preview')) {
      return new Response(JSON.stringify({ preview: null }), { status: 200 })
    }

    if (url.includes('convert_version')) {
      return answer(versionConversion.answer)
    }

    if (url.includes('get_templates')) {
      if (fakeServer.isFailingTemplates) {
        throw new TypeError('Failed to fetch')
      }

      return answer(templates.list)
    }

    // as the server adopts a pasted slide's pictures: each one becomes this presentation's own
    if (url.includes('update_slide_attachments')) {
      const { slide } = JSON.parse(String(init?.body))
      await slideAdoption.held
      const sent = typeof slide.elements === 'string' ? JSON.parse(slide.elements) : slide.elements
      const elements = sent.map((element: { src?: string }) =>
        element.src ? { ...element, src: `adopted:${element.src}` } : element,
      )
      return answer({ ...slide, elements: JSON.stringify(elements) })
    }

    if (composite && url.includes('composite_manifest')) {
      const references = Object.entries(composite).map(([reference, group], index) => ({
        reference,
        index: index + 1,
        presentation: reference,
        node: sourceNode(group),
      }))

      return answer({
        presentation: docname,
        node: 'node-1',
        modified: 'M1',
        group_limit: 1,
        reference_count: references.length,
        references,
      })
    }

    if (composite && url.includes('composite_group')) {
      const [reference] = JSON.parse(String(init?.body)).references
      // a test can hold a group back
      const group = await composite[reference]
      if (group instanceof Error) {
        throw group
      }

      return answer({
        presentation: docname,
        node: 'node-1',
        references: [
          {
            reference,
            index: 1,
            presentation: reference,
            readable: true,
            node: sourceNode(group),
            composite: false,
            slides: sourceNode(group) ? null : group,
          },
        ],
      })
    }

    const held = loads.shift()
    const heldAnswer = held && (await held)
    if (heldAnswer) {
      return heldAnswer
    }

    const { slides: _servedRows, ...shell } = structuredClone(served)
    const opening = { ...shell, name: docname, is_composite: composite ? 1 : 0, ...deck }
    // the server sends a converted deck's opening with no rows (Q20')
    return answer(deck?.is_converted ? opening : { ...opening, slides })
  })
  const access = ref({ role })
  const opened = session(docname, access, media, panels)
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
  if (!firstLoad && !composite && !deck?.is_converted) {
    await vi.waitFor(() => expect(thumbnails(root)).toHaveLength(slides.length))
  }

  return { app, root, docname, router, access, loads }
}

export function shown() {
  return document.querySelector('[data-show]') !== null
}

function sourceNode(group: unknown) {
  return group && typeof group === 'object' && 'node' in group ? String(group.node) : null
}

export function thumbnails(root: Element) {
  return [...root.querySelectorAll<HTMLButtonElement>('nav button')]
}

// what a test of kept copies starts from: nothing stored, a signal, the server reachable
export function startsFromEmptyStore() {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"pong"}')),
    )
  })

  afterEach(() => {
    fakeServer.isFailingTemplates = false
    versionConversion.answer = {}
    templates.list = []
    slideAdoption.held = null
    served.modified = 'M1'
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

export {
  collabRoom,
  realtime,
  savedStates,
  commentPanel,
  server,
  signedIn,
  versionsPanel,
  exported,
  themeChange,
  forgetTemplates,
  warms,
  visits,
}
