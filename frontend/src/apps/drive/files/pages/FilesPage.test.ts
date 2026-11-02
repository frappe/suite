import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import type { DriveNode } from '@/apps/drive/client/types'
import type { Operation } from '@/platform/transport'

// A Drive server that keeps the caller's Recent and one folder's children.
const server = vi.hoisted(() => ({
  recents: [] as string[],
  nodes: new Map<string, DriveNode>(),
  folderRole: 30,
  calls: [] as Array<{ id: string; input: Record<string, unknown> }>,
  /** The answer to a folder archive build: a status, or an error to throw. */
  archive: null as null | (() => unknown),
}))

vi.mock('@/platform/transport', async (original) => {
  const actual = await original<typeof import('@/platform/transport')>()
  return {
    ...actual,
    transport: {
      request: async (operation: Operation, input: Record<string, unknown>) => {
        server.calls.push({ id: operation.id, input })
        const node = (name: unknown) => server.nodes.get(String(name))
        switch (operation.id) {
          case 'roots_discover':
            return { personal: { node: 'root', title: 'My files' }, organization: null }
          case 'node_get':
            return { ...node(input.node), access: { role: server.folderRole } }
          case 'node_children':
            return {
              rows: [...server.nodes.values()].filter((row) => row.parent_node === input.node),
              next_cursor: null,
            }
          case 'view_list':
            return { rows: server.recents.map((name) => node(name)), next_cursor: null }
          case 'view_clear_recents': {
            const named = input.nodes as string[]
            const before = server.recents.length
            server.recents = server.recents.filter((name) => !named.includes(name))
            return { count: before - server.recents.length }
          }
          case 'node_archive_start':
            return server.archive?.()
          default:
            throw new Error(`Unexpected request ${operation.id}`)
        }
      },
    },
  }
})

vi.mock('@/platform/session', async (original) => {
  const actual = await original<typeof import('@/platform/session')>()
  const { ref } = await import('vue')
  const status = ref('authenticated')
  return { ...actual, useSession: () => ({ ...actual.useSession(), status }) }
})

interface ShownToast {
  kind: string
  message: string
  options?: { id?: unknown; description?: string }
}
const feedback = vi.hoisted(() => ({ toasts: [] as ShownToast[] }))
vi.mock('@/platform/feedback', async () => {
  const { defineComponent, h } = await import('vue')
  const slotOnly = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  const show = (kind: string) => (message: string, options?: ShownToast['options']) => {
    feedback.toasts.push({ kind, message, options })
    return feedback.toasts.length
  }
  return {
    ContextMenu: slotOnly,
    Dropdown: slotOnly,
    confirm: async () => true,
    reportMutationError: (error: Error) => show('error')(error.message),
    toast: {
      success: show('success'),
      error: show('error'),
      info: show('info'),
      loading: show('loading'),
      dismiss: vi.fn(),
    },
  }
})

// The page is under test, not its parts. The listing hands its rows and row
// menu to the test, and the parts that open their own dialogs stay closed.
const listing = vi.hoisted(() => ({
  rows: [] as DriveNode[],
  menu: null as null | ((row: DriveNode) => MenuGroup[]),
}))
interface MenuGroup {
  group: string
  options: Array<{ label: string; onClick: () => unknown; disabled?: boolean }>
}
vi.mock('../features/FilesListing.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: {
        query: { type: Object as PropType<{ rows: DriveNode[] }>, required: true },
        menuOptions: { type: Function as PropType<(row: DriveNode) => MenuGroup[]> },
      },
      setup(props) {
        return () => {
          listing.rows = props.query.rows
          listing.menu = props.menuOptions ?? null
          return h(
            'ul',
            props.query.rows.map((row) => h('li', row.title)),
          )
        }
      },
    }),
  }
})
const uploads = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('../features/uploads/DriveUploads.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      setup(_props, { expose }) {
        expose({ upload: uploads.upload, pickFiles: vi.fn(), pickFolder: vi.fn() })
        return () => null
      },
    }),
  }
})
const dialogs = vi.hoisted(() => ({ showDetails: vi.fn(async () => {}) }))
vi.mock('@/apps/drive', async (original) => ({
  ...(await original<typeof import('@/apps/drive')>()),
  useDriveDialogs: () => ({ ...dialogs, move: vi.fn(), share: vi.fn() }),
}))

const quiet = () =>
  defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
vi.mock('frappe-ui', () => ({
  Alert: quiet(),
  Breadcrumbs: quiet(),
  Button: quiet(),
  MultiSelect: quiet(),
  PageHeader: quiet(),
  PageHeaderBackButton: quiet(),
  PageHeaderMobile: quiet(),
  TabButtons: quiet(),
  TextInput: quiet(),
}))
for (const part of [
  '../features/ViewSettings.vue',
  '../features/FolderPicker.vue',
  '../features/TemplatePicker.vue',
  '../features/RenameDialog.vue',
  '../features/CreateNodeDialog.vue',
  '../features/RecoveryNotice.vue',
  '../features/BatchOutcome.vue',
  '../features/uploads/DropOverlay.vue',
  './FilesPanel.vue',
]) {
  vi.doMock(part, () => ({ default: quiet() }))
}
vi.mock('@/platform/area-sidebar', () => ({ AreaSidebar: quiet(), openAreaSidebar: vi.fn() }))

const { default: FilesPage } = await import('./FilesPage.vue')

function node(name: string, title: string, extra: Partial<DriveNode> = {}): DriveNode {
  return {
    name,
    title,
    kind: 'file',
    parent_node: 'folder-1',
    root: 'root',
    state: 'Active',
    trash_root: null,
    size: 10,
    mime: 'image/png',
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'me@example.com', full_name: 'Me', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
    access: { role: 40 },
    ...extra,
  }
}

let unmount: (() => void) | null = null
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  server.nodes = new Map(
    [
      node('folder-1', 'Talks', { kind: 'folder', parent_node: 'root', mime: null }),
      node('a', 'a.png'),
      node('b', 'b.png'),
      node('c', 'c.png'),
    ].map((row) => [row.name, row]),
  )
})
afterEach(() => {
  unmount?.()
  unmount = null
  server.recents = []
  server.calls = []
  server.folderRole = 30
  server.archive = null
  feedback.toasts.length = 0
  listing.rows = []
  listing.menu = null
  uploads.upload.mockReset()
  dialogs.showDetails.mockClear()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(path: string): Promise<{ root: HTMLElement; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/drive/recent', component: FilesPage, props: { destination: 'recent' } },
      { path: '/drive/f/:node/:slug?', component: FilesPage, props: { destination: 'folder' } },
      { path: '/d/:node/:slug?', component: { render: () => null } },
    ],
  })
  await router.push(path)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(root)
  unmount = () => app.unmount()
  return { root, router }
}

const titles = () => listing.rows.map((row) => row.title)
function menuItem(row: string, label: string) {
  const shown = listing.rows.find((candidate) => candidate.name === row)
  if (!shown || !listing.menu) return undefined
  return listing
    .menu(shown)
    .flatMap((group) => group.options)
    .find((item) => item.label === label)
}

describe('Recent', () => {
  it('removes an item from Recent from its row menu', async () => {
    server.recents = ['a', 'b', 'c']
    await mount('/drive/recent')
    await vi.waitFor(() => expect(titles()).toEqual(['a.png', 'b.png', 'c.png']))

    await menuItem('b', 'Remove from Recent')?.onClick()

    await vi.waitFor(() => expect(titles()).toEqual(['a.png', 'c.png']))
    expect(server.calls.filter((call) => call.id === 'view_clear_recents')).toEqual([
      { id: 'view_clear_recents', input: { nodes: ['b'] } },
    ])
  })

  it('removes a selection from Recent in one request', async () => {
    server.recents = ['a', 'b', 'c']
    const { root } = await mount('/drive/recent')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    menuItem('a', 'Select')?.onClick()
    menuItem('c', 'Select')?.onClick()
    await nextTick()
    const remove = [...root.querySelectorAll('div')].find(
      (element) => element.getAttribute('label') === 'Remove from Recent',
    )
    remove?.click()

    await vi.waitFor(() => expect(titles()).toEqual(['b.png']))
    expect(server.calls.find((call) => call.id === 'view_clear_recents')?.input).toEqual({
      nodes: ['a', 'c'],
    })
  })

  it('is not offered in a folder', async () => {
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    expect(menuItem('a', 'Remove from Recent')).toBeUndefined()
  })
})
