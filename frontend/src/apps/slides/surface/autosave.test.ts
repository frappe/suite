import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, ref, type SetupContext } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { DocumentSession } from '@/apps/drive'

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
const saves: unknown[] = []
const served = {
  node: 'node-1',
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
vi.mock('@/apps/slides/router', () => ({
  router: { currentRoute: { value: { params: {}, query: {} } }, replace: vi.fn() },
}))
vi.mock('@/apps/drive', () => ({
  GUEST_NAME_LIMIT: 50,
  DriveDocumentHeader: { render: () => null },
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

const { default: SlidesSurface } = await import('./SlidesSurface.vue')
const { duplicateSlide } = await import('@/apps/slides/stores/slide')

function answer(message: unknown) {
  return new Response(JSON.stringify({ message }), { status: 200 })
}

function session(docname: string): DocumentSession {
  return {
    nodeId: 'node-1',
    contentDoctype: 'Presentation',
    contentDocname: docname,
    title: ref('Quarterly plan'),
    state: ref('Active'),
    access: ref({ role: 50 }),
    refreshAccess: async () => {},
    credentials: { context: undefined, heldContext: undefined },
    media: () => undefined,
  } as unknown as DocumentSession
}

// each test opens its own presentation, so no draft carries over between them
let opens = 0

async function openedSurface() {
  const docname = `p${++opens}`
  server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('save_slides')) {
      saves.push(JSON.parse(String(init?.body)))
      const version = saves.length + 1
      return answer({ modified: `M${version}` })
    }

    if (url.includes('get_templates')) {
      return answer([])
    }

    return answer({ ...structuredClone(served), name: docname })
  })
  const opened = session(docname)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node', component: SlidesSurface, props: () => ({ session: opened }) }],
  })
  await router.push('/d/node-1')
  const app = createApp(defineComponent({ setup: () => () => h(RouterView) }))
  app.use(router)
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  await vi.waitFor(() => expect(thumbnails(root)).toHaveLength(2))
  return { app, root, docname }
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
