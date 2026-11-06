import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  RouterView,
  type Router,
} from 'vue-router'

import type { DriveNode } from '@/apps/drive/client/types'
import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import { TransportError, type Operation } from '@/platform/transport'
import { setTweaks } from '@/platform/tweaks'

import { rememberShown } from '../features/preview/lastShown'

// A Drive server that keeps the caller's Recent, stars and one folder's children.
const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const server = vi.hoisted(() => ({
  recents: fromPartial<string[]>([]),
  nodes: new Map<string, DriveNode>(),
  folderRole: 30,
  calls: fromPartial<Array<{ id: string; input: Record<string, unknown> }>>([]),
  /** The answer to a download request: a Preparing download, or an error to throw. */
  download: fromPartial<null | (() => unknown)>(null),
  /** The answers to polling a download, one per poll. */
  polls: fromPartial<unknown[]>([]),
  /** The cursor a folder listing answers with: set, the folder has more to load. */
  nextCursor: fromPartial<string | null>(null),
  /** Set, trash and batch writes wait for it before they answer. */
  gate: fromPartial<Promise<void> | null>(null),
  /** Set, a folder's details wait for it before they answer. */
  detailGate: fromPartial<Promise<void> | null>(null),
  /** Set, trash and batch writes are refused with it. */
  refusal: fromPartial<Error | null>(null),
  /** The nodes a batch answers as failed, and leaves unchanged. */
  batchFailures: fromPartial<string[]>([]),
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
          // Any other id is a folder of its own, so no test reads an answer another test cached.
          case 'node_get':
            await server.detailGate
            return {
              ...(node(input.node) ?? {
                name: input.node,
                title: 'Drafts',
                kind: 'folder',
                parent_node: 'root',
                root: 'root',
                state: 'Active',
              }),
              access: { role: server.folderRole },
              breadcrumbs: [{ name: 'root', title: 'My files' }],
            }
          case 'node_create.create_document': {
            const created = {
              ...(server.nodes.get('a') as DriveNode),
              name: `doc-${server.nodes.size}`,
              title: String(input.title),
              kind: 'document' as const,
              parent_node: String(input.parent_node),
              content_doctype: String(input.content_doctype),
            }
            server.nodes.set(created.name, created)
            return created
          }
          case 'node_patch.trash': {
            await server.gate
            if (server.refusal) throw server.refusal
            const trashed = node(input.node)
            if (trashed) trashed.state = 'Trashed'
            return trashed
          }
          case 'node_batch': {
            await server.gate
            if (server.refusal) throw server.refusal
            const { nodes, patch } = input as {
              nodes: string[]
              patch: { state?: 'Active' | 'Trashed'; parent_node?: string }
            }
            const changed = nodes.filter((name) => !server.batchFailures.includes(name))
            for (const name of changed) Object.assign(server.nodes.get(name)!, patch)
            return {
              ok: changed,
              failed: nodes
                .filter((name) => server.batchFailures.includes(name))
                .map((name) => ({ node: name, type: 'DriveForbidden', message: 'No' })),
            }
          }
          case 'node_children':
            return {
              rows: [...server.nodes.values()].filter(
                (row) => row.parent_node === input.node && row.state === 'Active',
              ),
              next_cursor: server.nextCursor,
            }
          case 'view_list':
            return { rows: server.recents.map((name) => node(name)), next_cursor: null }
          case 'view_clear_recents': {
            const named = input.nodes
            if (!Array.isArray(named) || !named.every((node) => typeof node === 'string'))
              throw new Error('Expected node names')
            const before = server.recents.length
            server.recents = server.recents.filter((name) => !named.includes(name))
            return { count: before - server.recents.length }
          }
          case 'download_start':
            return server.download?.()
          case 'download_get':
            return server.polls.shift()
          case 'notifications_list':
            return {
              rows: [
                {
                  name: 'notice-1',
                  read: 0,
                  creation: null,
                  download: {
                    name: 'download-1',
                    title: 'Photos.zip',
                    status: 'Ready',
                    delivery: 'Inbox',
                    size: 2048,
                    expires_at: null,
                    error: null,
                    url: '/api/suite/drive/downloads/download-1/content',
                  },
                },
              ],
              next_cursor: null,
            }
          case 'notifications_read.notification_names':
            return { count: 1 }
          case 'node_put_favourite':
          case 'node_delete_favourite': {
            const starred = node(input.node)
            if (starred) starred.favourite = operation.id === 'node_put_favourite'
            return { count: 1 }
          }
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
  options?: { id?: unknown; description?: string; duration?: number }
}
const feedback = vi.hoisted(() => ({
  toasts: fromPartial<ShownToast[]>([]),
  /** Every confirmation the page asked for, answered yes unless a test says otherwise. */
  confirm: vi.fn(async (_options: { title: string; destructive?: boolean }) => true),
}))
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
  // A menu lists its options beside its trigger, so a test can choose one.
  type Option = { label?: string; onClick?: () => unknown; options?: Option[] }
  const menu = defineComponent({
    props: { options: { type: Array as PropType<Option[]>, default: () => [] } },
    setup:
      (props, { slots }) =>
      () =>
        h('div', { 'data-menu': '' }, [
          slots.default?.(),
          ...props.options
            .flatMap((item) => item.options ?? [item])
            .map((option) =>
              h('button', { role: 'menuitem', onClick: () => option.onClick?.() }, option.label),
            ),
        ]),
  })
  return {
    ContextMenu: slotOnly,
    Dropdown: menu,
    confirm: feedback.confirm,
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
  rows: fromPartial<DriveNode[]>([]),
  menu: fromPartial<null | ((row: DriveNode) => MenuGroup[])>(null),
  /** The row that shows keyboard focus. */
  focused: fromPartial<DriveNode | null>(null),
  revealed: fromPartial<string[]>([]),
  /** The revealed items asked to flash. */
  highlighted: fromPartial<string[]>([]),
  /** Set, a reveal does not find its item. */
  missing: false,
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
        query: { type: fromPartial<PropType<{ rows: DriveNode[] }>>(Object), required: true },
        menuOptions: { type: fromPartial<PropType<(row: DriveNode) => MenuGroup[]>>(Function) },
      },
      setup(props, { expose }) {
        expose({
          focusedRow: () => listing.focused,
          reveal: async (id: string, options: { highlight?: boolean } = {}) => {
            listing.revealed.push(id)
            if (options.highlight) listing.highlighted.push(id)
            return !listing.missing
          },
        })
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
const dialogs = vi.hoisted(() => ({
  showDetails: vi.fn(async () => {}),
  share: vi.fn(async () => false),
}))
vi.mock('@/apps/drive', async (original) => ({
  ...(await original<typeof import('@/apps/drive')>()),
  useDriveDialogs: () => ({ ...dialogs, move: vi.fn() }),
}))

interface ShortcutConfig {
  combo: string
  description: string
  enabled?: () => boolean
  handler: (event: KeyboardEvent) => void
}
/** The shortcuts the page registered. */
const shortcuts = vi.hoisted(() => [] as ShortcutConfig[])
/** Presses `combo` as frappe-ui would: the live registration for it runs. */
function press(combo: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true })
  const live = shortcuts.find((each) => each.combo === combo && (each.enabled?.() ?? true))
  live?.handler(event)
  return event
}
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
  useKeyboardShortcut: (configs: ShortcutConfig[]) => shortcuts.push(...configs),
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

const spreadsheets: DocumentTypeDefinition = {
  key: 'sheets',
  contentDoctype: 'Sheet',
  newLabel: () => 'Spreadsheet',
  icon: quiet(),
  loadSurface: async () => quiet(),
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
      node('photos', 'Photos', { kind: 'folder', parent_node: 'folder-5', mime: null }),
    ].map((row) => [row.name, row]),
  )
})
afterEach(() => {
  unmount?.()
  unmount = null
  server.recents = []
  server.calls = []
  server.folderRole = 30
  server.download = null
  server.polls = []
  server.nextCursor = null
  server.gate = null
  server.detailGate = null
  server.refusal = null
  server.batchFailures = []
  vi.useRealTimers()
  feedback.toasts.length = 0
  feedback.confirm.mockClear()
  listing.rows = []
  listing.menu = null
  listing.focused = null
  listing.revealed = []
  listing.highlighted = []
  listing.missing = false
  shortcuts.length = 0
  uploads.upload.mockReset()
  dialogs.showDetails.mockClear()
  dialogs.share.mockClear()
  vi.unstubAllGlobals()
  setTweaks(
    ['t3-folder-menu', 't3-selection-menu', 't8', 't19-owner-sort', 't31-toast-closes'],
    true,
  )
  document.body.innerHTML = ''
})

async function mount(
  path: string,
  history = createMemoryHistory(),
): Promise<{ root: HTMLElement; router: Router }> {
  const router = createRouter({
    history,
    routes: [
      { path: '/drive', component: { render: () => null } },
      {
        path: '/drive/recent',
        name: 'files-recent',
        component: FilesPage,
        props: { destination: 'recent' },
      },
      { path: '/drive/starred', component: FilesPage, props: { destination: 'starred' } },
      { path: '/drive/trash', component: FilesPage, props: { destination: 'trash' } },
      { path: '/drive/f/:node/:slug?', component: FilesPage, props: { destination: 'folder' } },
      { path: '/d/:node/:slug?', component: { render: () => null } },
    ],
  })
  await router.push(path)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.provide(DOCUMENT_TYPES_KEY, [spreadsheets])
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

/** The options of the menu whose trigger is named `trigger`, or none when it is not shown. */
function menuOf(root: HTMLElement, trigger: string): string[] {
  const menu = root.querySelector(`[aria-label="${trigger}"]`)?.closest('[data-menu]')
  return [...(menu?.querySelectorAll(':scope > [role="menuitem"]') ?? [])].map(
    (item) => item.textContent ?? '',
  )
}
function choose(root: HTMLElement, trigger: string, option: string) {
  const menu = root.querySelector(`[aria-label="${trigger}"]`)?.closest('[data-menu]')
  const items = [...(menu?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? [])]
  items.find((item) => item.textContent === option)?.click()
}

describe("The open folder's menu", () => {
  it('offers its row actions, and leaves the folder it moves to Trash', async () => {
    server.folderRole = 40
    server.nodes.set(
      'folder-7',
      node('folder-7', 'Archive', { kind: 'folder', parent_node: 'root', mime: null }),
    )
    const { root, router } = await mount('/drive/f/folder-7/archive')
    await vi.waitFor(() => expect(menuOf(root, 'More file actions')).toContain('Rename'))

    const offered = menuOf(root, 'More file actions')
    expect(offered).toEqual(
      expect.arrayContaining(['Details', 'Rename', 'Move', 'Star', 'Move to trash']),
    )
    expect(offered).not.toContain('Open')
    expect(offered).not.toContain('Select')

    choose(root, 'More file actions', 'Move to trash')

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive'))
    expect(server.nodes.get('folder-7')?.state).toBe('Trashed')
    expect(feedback.toasts.at(-1)?.message).toMatch(/^Moved .*Archive.* to Trash$/)
  })

  it('offers Share, Copy link and Rename folder with the tweak off', async () => {
    setTweaks(['t3-folder-menu'], false)
    server.folderRole = 40
    const { root } = await mount('/drive/f/folder-8/drafts')
    await vi.waitFor(() => expect(menuOf(root, 'More file actions')).toContain('Rename folder'))

    expect(menuOf(root, 'More file actions')).toEqual([
      'Copy link',
      'Rename folder',
      'Keyboard shortcuts',
    ])
  })
})

describe('New', () => {
  const newSpreadsheet = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Spreadsheet',
    )

  it('creates one spreadsheet with the default title and opens it, however often it is clicked', async () => {
    server.folderRole = 40
    const { root, router } = await mount('/drive/f/folder-9/drafts')
    await vi.waitFor(() => expect(newSpreadsheet(root)).toBeDefined())

    newSpreadsheet(root)?.click()
    newSpreadsheet(root)?.click()

    await vi.waitFor(() => expect(router.currentRoute.value.path).toMatch(/^\/d\//))
    const created = server.calls.filter((call) => call.id === 'node_create.create_document')
    expect(created).toHaveLength(1)
    expect(created[0]?.input).toMatchObject({
      parent_node: 'folder-9',
      content_doctype: 'Sheet',
      title: 'Untitled spreadsheet',
    })
    expect(router.currentRoute.value.query.new).toBe('1')
  })

  const newButtons = (root: HTMLElement) => [...root.querySelectorAll('[label="New"]')]
  for (const [role, shows] of [
    [30, true],
    [10, false],
  ] as const) {
    it(`keeps its room unseen while the folder loads, then ${shows ? 'shows it' : 'drops it'} for role ${role}`, async () => {
      let answer = () => {}
      server.detailGate = new Promise((resolve) => (answer = resolve))
      server.folderRole = role
      const { root } = await mount(`/drive/f/loading-${role}/drafts`)
      await vi.waitFor(() => expect(newButtons(root)).not.toHaveLength(0))
      expect(newButtons(root).every((button) => button.classList.contains('invisible'))).toBe(true)

      answer()

      const seen = () => newButtons(root).map((button) => !button.classList.contains('invisible'))
      await vi.waitFor(() => expect(seen()).toEqual(shows ? [true] : []))
    })
  }

  it('asks for a name first with the tweak off', async () => {
    setTweaks(['t8'], false)
    server.folderRole = 40
    const { root, router } = await mount('/drive/f/folder-10/drafts')
    await vi.waitFor(() => expect(newSpreadsheet(root)).toBeDefined())

    newSpreadsheet(root)?.click()
    await nextTick()

    expect(server.calls.some((call) => call.id === 'node_create.create_document')).toBe(false)
    expect(router.currentRoute.value.path).toBe('/drive/f/folder-10/drafts')
  })
})

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

describe('Show in folder', () => {
  afterEach(() => setTweaks(['t17-show-in-folder'], true))
  const inTalks = {
    parent_node: 'folder-1',
    breadcrumbs: [
      { name: 'root', title: 'My files', kind: 'root', role: 50 },
      { name: 'folder-1', title: 'Talks', kind: 'folder', role: 50 },
    ],
  }
  // The test server answers every saved view with `server.recents`.
  function starred(...rows: DriveNode[]) {
    for (const row of rows) server.nodes.set(row.name, row)
    server.recents = rows.map((row) => row.name)
    return mount('/drive/starred')
  }

  it('opens a starred item’s folder with the item focused and highlighted', async () => {
    const { router } = await starred(node('a', 'a.png', inTalks))
    await vi.waitFor(() => expect(menuItem('a', 'Show in folder')).toBeDefined())

    menuItem('a', 'Show in folder')?.onClick()

    await vi.waitFor(() => expect(listing.highlighted).toEqual(['a']))
    expect(router.currentRoute.value.path).toBe('/drive/f/folder-1/talks')
    expect(feedback.toasts).toEqual([])
  })

  it('says so when the folder no longer has the item', async () => {
    listing.missing = true
    await starred(node('b', 'b.png', inTalks))
    await vi.waitFor(() => expect(menuItem('b', 'Show in folder')).toBeDefined())

    menuItem('b', 'Show in folder')?.onClick()

    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(1))
    expect(feedback.toasts[0]).toMatchObject({
      kind: 'info',
      message: 'Opened Talks. The item is no longer in it.',
    })
  })

  it('is not offered without a trail to the folder, or in the folder itself', async () => {
    await starred(node('c', 'c.png', { breadcrumbs: [] }))
    await vi.waitFor(() => expect(titles()).toEqual(['c.png']))
    expect(menuItem('c', 'Show in folder')).toBeUndefined()

    unmount?.()
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    expect(menuItem('a', 'Show in folder')).toBeUndefined()
  })

  it('is not offered with the tweak off', async () => {
    setTweaks(['t17-show-in-folder'], false)
    await starred(node('a', 'a.png', inTalks))
    await vi.waitFor(() => expect(titles()).toEqual(['a.png']))

    expect(menuItem('a', 'Show in folder')).toBeUndefined()
  })
})

describe('back from a file preview', () => {
  /** Opens the Talks folder, previews a file that steps on to `last`, and goes Back. */
  async function backFromPreview(last: string) {
    const { router } = await mount('/drive/f/folder-1/talks', createWebHistory())
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    await router.push('/d/a/a-png')
    rememberShown('/drive/f/folder-1/talks', last)
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive/f/folder-1/talks'))
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  afterEach(() => setTweaks(['t15-return-focus'], true))

  it('focuses the row of the last file the preview showed, without a highlight', async () => {
    await backFromPreview('c')
    expect(listing.revealed).toEqual(['c'])
    expect(listing.highlighted).toEqual([])
  })

  it('focuses nothing with t15-return-focus off', async () => {
    setTweaks(['t15-return-focus'], false)
    await backFromPreview('c')
    expect(listing.revealed).toEqual([])
  })
})

describe('Sort', () => {
  const orders = () =>
    server.calls.filter((call) => call.id === 'node_children').map((call) => call.input.order_by)

  it('reads a folder of My files by name when the saved sort is Owner', async () => {
    await mount('/drive/f/folder-1/talks?sort=owner')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    expect(orders()).toEqual(['title'])
  })

  it('reads it by owner with the tweak off', async () => {
    setTweaks(['t19-owner-sort'], false)
    await mount('/drive/f/folder-1/talks?sort=owner')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    expect(orders()).toEqual(['owner'])
  })
})

describe('Access column', () => {
  afterEach(() => setTweaks(['t36-access-column'], true))
  const expansions = (id: string) =>
    server.calls.filter((call) => call.id === id).map((call) => call.input.expand)

  it('asks for each row’s audience in a folder', async () => {
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    expect(expansions('node_children')).toEqual(['access,audience'])
  })

  it('asks for none in Trash', async () => {
    await mount('/drive/trash')
    await vi.waitFor(() => expect(expansions('view_list')).toHaveLength(1))

    expect(expansions('view_list')).toEqual(['access'])
  })

  it('asks for no audience with the tweak off', async () => {
    setTweaks(['t36-access-column'], false)
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    expect(expansions('node_children')).toEqual(['access'])
  })
})

describe('Details', () => {
  it('opens from a row menu', async () => {
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    await menuItem('b', 'Details')?.onClick()

    expect(dialogs.showDetails).toHaveBeenCalledWith('b')
  })
})

/** A paste as the browser sends it, carrying `items` from the clipboard. */
function paste(
  items: Array<{ kind: string; type: string; file?: File }>,
  on: EventTarget = window,
) {
  const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: {
      items: items.map((item) => ({ ...item, getAsFile: () => item.file ?? null })),
    },
  })
  on.dispatchEvent(event)
  return event
}
const screenshot = () => new File(['png'], 'image.png', { type: 'image/png' })

/** Waits until the page has read the folder's details, which say whether it takes uploads. */
async function opened(folder: string) {
  await vi.waitFor(() =>
    expect(server.calls.some((call) => call.id === 'node_get' && call.input.node === folder)).toBe(
      true,
    ),
  )
  await new Promise((resolve) => setTimeout(resolve))
}

describe('Pasting an image', () => {
  it('uploads it into the open folder', async () => {
    await mount('/drive/f/folder-2/drafts')
    await opened('folder-2')

    const image = screenshot()
    const event = paste([
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png', file: image },
    ])

    expect(event.defaultPrevented).toBe(true)
    expect(uploads.upload).toHaveBeenCalledWith(
      { files: [{ file: image }], folders: [] },
      { parent: 'folder-2', root: 'root' },
    )
  })

  it('leaves text, and a paste into a field, alone', async () => {
    const { root } = await mount('/drive/f/folder-3/drafts')
    await opened('folder-3')

    paste([{ kind: 'string', type: 'text/plain' }])
    const field = root.appendChild(document.createElement('input'))
    paste([{ kind: 'file', type: 'image/png', file: screenshot() }], field)

    expect(uploads.upload).not.toHaveBeenCalled()
  })

  it('uploads nothing into a folder the user cannot upload to', async () => {
    server.folderRole = 10
    await mount('/drive/f/folder-4/drafts')
    await opened('folder-4')

    const event = paste([{ kind: 'file', type: 'image/png', file: screenshot() }])

    expect(event.defaultPrevented).toBe(false)
    expect(uploads.upload).not.toHaveBeenCalled()
  })
})

const preparing = {
  name: 'download-1',
  title: 'Photos.zip',
  status: 'Preparing',
  delivery: 'Inbox',
  size: null,
  expires_at: null,
  error: null,
  url: null,
}

describe('Downloading a folder', () => {
  async function download() {
    const assign = vi.fn()
    await mount('/drive/f/folder-5/drafts')
    await vi.waitFor(() => expect(titles()).toEqual(['Photos']))
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })
    await menuItem('photos', 'Download')?.onClick()
    return assign
  }

  it('keeps a toast on the page until the zip is ready, then downloads it', async () => {
    const url = '/api/suite/drive/downloads/download-1/content'
    server.download = () => preparing
    server.polls = [preparing, { ...preparing, status: 'Ready', size: 2048, url }]
    const assign = vi.fn()
    await mount('/drive/f/folder-5/drafts')
    await vi.waitFor(() => expect(titles()).toEqual(['Photos']))
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })
    vi.useFakeTimers({ toFake: ['setTimeout'] })

    const downloading = menuItem('photos', 'Download')?.onClick()
    await vi.advanceTimersByTimeAsync(2000)

    expect(server.calls.filter((call) => call.id === 'download_start')).toEqual([
      { id: 'download_start', input: { nodes: ['photos'] } },
    ])
    expect(assign).not.toHaveBeenCalled()
    expect(feedback.toasts).toEqual([
      {
        kind: 'loading',
        message: 'Preparing “Photos” for download',
        options: {
          id: 'download-1',
          description:
            'The download starts here when the zip is ready. You will also get a notification.',
        },
      },
    ])

    await vi.advanceTimersByTimeAsync(2000)
    await downloading

    expect(assign).toHaveBeenCalledWith(url)
    expect(feedback.toasts[1]).toEqual({
      kind: 'success',
      message: 'Downloading “Photos”',
      options: { id: 'download-1', description: '2 KB', duration: 5000 },
    })
    // The bell's notification for this zip is read: this tab delivered it.
    await vi.waitFor(() =>
      expect(
        server.calls.filter((call) => call.id === 'notifications_read.notification_names'),
      ).toEqual([
        { id: 'notifications_read.notification_names', input: { notifications: ['notice-1'] } },
      ]),
    )
  })

  it('keeps the old endless loading toast with t31-toast-closes off', async () => {
    setTweaks(['t31-toast-closes'], false)
    server.download = () => preparing
    server.polls = [{ ...preparing, status: 'Ready', size: 2048, url: '/zip' }]
    const assign = vi.fn()
    await mount('/drive/f/folder-5/drafts')
    await vi.waitFor(() => expect(titles()).toEqual(['Photos']))
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })
    vi.useFakeTimers({ toFake: ['setTimeout'] })

    const downloading = menuItem('photos', 'Download')?.onClick()
    await vi.advanceTimersByTimeAsync(2000)
    await downloading

    expect(feedback.toasts[0]?.options?.duration).toBe(Infinity)
    expect(feedback.toasts[1]?.options?.description).toBeUndefined()
  })

  it('waits on the page for a zip asked for through a share link, then downloads it', async () => {
    const url = '/api/suite/drive/downloads/download-1/content'
    server.download = () => ({ ...preparing, delivery: 'Page' })
    server.polls = [
      { ...preparing, delivery: 'Page' },
      { ...preparing, delivery: 'Page', status: 'Ready', size: 2048, url },
    ]
    const assign = vi.fn()
    await mount('/drive/f/folder-5/drafts')
    await vi.waitFor(() => expect(titles()).toEqual(['Photos']))
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign })
    vi.useFakeTimers({ toFake: ['setTimeout'] })

    const downloading = menuItem('photos', 'Download')?.onClick()
    await vi.advanceTimersByTimeAsync(4000)
    await downloading

    expect(server.calls.filter((call) => call.id === 'download_get')).toHaveLength(2)
    expect(assign).toHaveBeenCalledWith(url)
    expect(feedback.toasts.map((shown) => shown.kind)).toEqual(['loading', 'success'])
    expect(feedback.toasts[0]?.options?.description).toBe(
      'The download starts here when the zip is ready.',
    )
  })

  it('downloads a zip that is already ready at once', async () => {
    const url = '/api/suite/drive/downloads/download-1/content'
    server.download = () => ({ ...preparing, status: 'Ready', size: 2048, url })

    const assign = await download()

    expect(assign).toHaveBeenCalledWith(url)
    expect(feedback.toasts).toEqual([])
  })

  it('shows the reason when Drive refuses the download', async () => {
    const reason = 'Only active Drive items can be downloaded'
    server.download = () => {
      throw new TransportError({ type: 'DriveConflict', status: 409, message: reason, details: {} })
    }

    await download()

    expect(feedback.toasts).toEqual([
      { kind: 'error', message: 'Could not download “Photos”', options: { description: reason } },
    ])
  })
})

describe('A selection', () => {
  async function select(...names: string[]): Promise<HTMLElement> {
    const { root } = await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    for (const name of names) menuItem(name, 'Select')?.onClick()
    await nextTick()
    return root
  }
  function bulkButton(root: HTMLElement, label: string): HTMLElement | undefined {
    return [...root.querySelectorAll<HTMLElement>('div')].find(
      (element) => element.getAttribute('label') === label,
    )
  }

  it('downloads as one zip in one request', async () => {
    server.download = () => ({ ...preparing, title: 'Talks.zip' })
    const root = await select('a', 'c')

    bulkButton(root, 'Download')?.click()

    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(1))
    expect(server.calls.filter((call) => call.id === 'download_start')).toEqual([
      { id: 'download_start', input: { nodes: ['a', 'c'] } },
    ])
    expect(feedback.toasts[0]).toMatchObject({
      kind: 'loading',
      message: 'Preparing 2 items for download',
    })
  })

  it('leads with the count, and gives one item its row menu without Select', async () => {
    server.folderRole = 40
    const root = await select('a')

    const count = [...root.querySelectorAll('span')].find(
      (span) => span.textContent === '1 selected',
    )
    const move = bulkButton(root, 'Move')
    expect(count && move && count.compareDocumentPosition(move)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const offered = menuOf(root, 'More actions')
    expect(offered).toEqual(expect.arrayContaining(['Rename', 'Details', 'Move to trash']))
    expect(offered).not.toContain('Select')

    menuItem('c', 'Select')?.onClick()
    await nextTick()
    expect(menuOf(root, 'More actions')).toEqual([])
  })

  it('keeps the count after the actions, with no "…", with the tweak off', async () => {
    setTweaks(['t3-selection-menu'], false)
    const root = await select('a')

    const count = [...root.querySelectorAll('span')].find(
      (span) => span.textContent === '1 selected',
    )
    const move = bulkButton(root, 'Move')
    expect(count && move && count.compareDocumentPosition(move)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    )
    expect(root.querySelector('[aria-label="More actions"]')).toBeNull()
  })

  it('stars every item, then offers to unstar them all', async () => {
    const root = await select('a', 'c')

    bulkButton(root, 'Star')?.click()

    await vi.waitFor(() => expect(bulkButton(root, 'Unstar')).toBeDefined())
    const starred = server.calls.filter((call) => call.id === 'node_put_favourite')
    expect(starred.map((call) => call.input.node).sort()).toEqual(['a', 'c'])

    bulkButton(root, 'Unstar')?.click()

    await vi.waitFor(() => expect(bulkButton(root, 'Star')).toBeDefined())
    const unstarred = server.calls.filter((call) => call.id === 'node_delete_favourite')
    expect(unstarred.map((call) => call.input.node).sort()).toEqual(['a', 'c'])
  })

  describe('moved to Trash', () => {
    afterEach(() => setTweaks(['t34-bulk-trash-confirm'], true))
    const trashed = () =>
      [...server.nodes.values()].filter((row) => row.state === 'Trashed').map((row) => row.name)

    it('asks first for two or more items, from the bar and from the Delete key', async () => {
      const root = await select('a', 'c')
      feedback.confirm.mockResolvedValueOnce(false)

      bulkButton(root, 'Move to trash')?.click()
      await vi.waitFor(() => expect(feedback.confirm).toHaveBeenCalledOnce())
      expect(feedback.confirm.mock.calls[0]?.[0]).toMatchObject({
        title: 'Move 2 items to trash?',
        destructive: true,
      })
      await nextTick()
      expect(trashed()).toEqual([])

      press('Delete')
      await vi.waitFor(() => expect(trashed()).toEqual(['a', 'c']))
      expect(feedback.confirm).toHaveBeenCalledTimes(2)
      expect(feedback.toasts.at(-1)?.message).toBe('Moved 2 items to Trash')
    })

    it('moves one item at once, with Undo', async () => {
      const root = await select('b')

      bulkButton(root, 'Move to trash')?.click()

      await vi.waitFor(() => expect(trashed()).toEqual(['b']))
      expect(feedback.confirm).not.toHaveBeenCalled()
      expect(feedback.toasts.at(-1)?.message).toBe('Moved “b.png” to Trash')
    })

    it('does not ask with the tweak off', async () => {
      setTweaks(['t34-bulk-trash-confirm'], false)
      const root = await select('a', 'c')

      bulkButton(root, 'Move to trash')?.click()

      await vi.waitFor(() => expect(trashed()).toEqual(['a', 'c']))
      expect(feedback.confirm).not.toHaveBeenCalled()
    })
  })
})

describe('Keyboard shortcuts', () => {
  function pressNamed(description: string) {
    const shortcut = shortcuts.find((candidate) => candidate.description === description)
    shortcut?.handler(new KeyboardEvent('keydown', { cancelable: true }))
  }
  /** Letter keys go through Suite's own listener, not frappe-ui's registry. */
  function type(...letters: string[]) {
    for (const key of letters) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
    }
  }

  it('run the item the menus show for them', async () => {
    // A folder of its own, so its rows are not ones an earlier test cached.
    for (const name of ['x', 'y', 'z']) {
      server.nodes.set(
        name,
        node(name, `${name}.png`, { parent_node: 'folder-6', access: { role: 50 } }),
      )
    }
    const { root } = await mount('/drive/f/folder-6/drafts')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    menuItem('x', 'Select')?.onClick()
    await nextTick()

    type('s')
    expect(dialogs.share).toHaveBeenCalledWith('x')

    pressNamed('Select all')
    await nextTick()
    expect(root.textContent).toContain('3 selected')

    pressNamed('Delete selected items')
    await vi.waitFor(() =>
      expect(server.calls.find((call) => call.id === 'node_batch')?.input).toEqual({
        nodes: ['x', 'y', 'z'],
        patch: { state: 'Trashed' },
      }),
    )
  })

  it('open a view by its route', async () => {
    const { router } = await mount('/drive/f/folder-7/drafts')

    type('g', 'r')

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive/recent'))
  })
})

describe('Select on a touch screen', () => {
  afterEach(() => setTweaks(['t18-select-entry'], true))
  const bar = (root: HTMLElement) =>
    [...root.querySelectorAll('span')].find((span) => /select/i.test(span.textContent ?? ''))
      ?.textContent
  const button = (root: HTMLElement, label: string) =>
    [...root.querySelectorAll<HTMLElement>('div')].find(
      (element) => element.getAttribute('label') === label,
    )

  it('starts selecting with nothing checked, and the bar waits for a choice', async () => {
    const { root } = await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(menuOf(root, 'More file actions')).toContain('Select'))
    expect(menuOf(root, 'More file actions')).not.toContain('Select rows')

    choose(root, 'More file actions', 'Select')
    await nextTick()

    expect(bar(root)).toBe('Select items')
    expect(button(root, 'Move')?.hasAttribute('disabled')).toBe(true)
    expect(button(root, 'Move to trash')?.hasAttribute('disabled')).toBe(true)

    menuItem('b', 'Select')?.onClick()
    await nextTick()
    expect(bar(root)).toBe('1 selected')
  })

  it('checks the first row from "Select rows" with the tweak off', async () => {
    setTweaks(['t18-select-entry'], false)
    const { root } = await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(menuOf(root, 'More file actions')).toContain('Select rows'))

    choose(root, 'More file actions', 'Select rows')
    await nextTick()

    expect(bar(root)).toBe('1 selected')
  })
})

describe('Select all in a folder with more to load', () => {
  afterEach(() => setTweaks(['t20-loaded-label'], true))
  const bar = (root: HTMLElement) =>
    [...root.querySelectorAll('span')].find((span) => /selected$/.test(span.textContent ?? ''))
      ?.textContent
  async function selectAll(folder = 'folder-1'): Promise<HTMLElement> {
    server.nextCursor = 'more'
    const { root } = await mount(`/drive/f/${folder}/talks`)
    await vi.waitFor(() => expect(menuOf(root, 'More file actions')).toContain('Select all'))
    choose(root, 'More file actions', 'Select all')
    await nextTick()
    return root
  }

  it('says that only the loaded items are selected', async () => {
    expect(bar(await selectAll())).toBe('3 loaded items selected')
  })

  it('says "3 selected" with the tweak off', async () => {
    setTweaks(['t20-loaded-label'], false)
    expect(bar(await selectAll())).toBe('3 selected')
  })

  it('refuses to download more than 200 items in one zip', async () => {
    for (let index = 0; index < 201; index++) {
      const name = `big-${index}`
      server.nodes.set(name, node(name, `${name}.png`, { parent_node: 'folder-big' }))
    }
    const root = await selectAll('folder-big')

    const download = [...root.querySelectorAll<HTMLElement>('div')].find(
      (element) => element.getAttribute('label') === 'Download',
    )
    download?.click()

    await vi.waitFor(() => expect(feedback.toasts).toHaveLength(1))
    expect(feedback.toasts[0]).toMatchObject({
      kind: 'error',
      message: 'Download up to 200 items at a time.',
    })
    expect(server.calls.filter((call) => call.id === 'download_start')).toEqual([])
  })
})

describe('Trash and move before Drive answers', () => {
  let release: () => void = () => {}
  beforeEach(() => {
    server.gate = new Promise((resolve) => (release = resolve))
  })
  afterEach(() => setTweaks(['t26-optimistic-remove'], true))
  const refused = () =>
    new TransportError({ type: 'DriveForbidden', status: 403, message: 'Not allowed', details: {} })

  it('takes a trashed row out at once, and puts it back with the error when Drive refuses', async () => {
    server.refusal = refused()
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toEqual(['a.png', 'b.png', 'c.png']))

    const trashing = Promise.resolve(menuItem('b', 'Move to trash')?.onClick())

    await vi.waitFor(() => expect(titles()).toEqual(['a.png', 'c.png']))
    release()
    await expect(trashing).rejects.toThrow('Not allowed')
    expect(titles()).toEqual(['a.png', 'b.png', 'c.png'])
    await vi.waitFor(() =>
      expect(feedback.toasts).toContainEqual(
        expect.objectContaining({ kind: 'error', message: 'Not allowed' }),
      ),
    )
  })

  it('takes a selection out at once, and brings back only the items that failed', async () => {
    server.nodes.set('d', node('d', 'd.png'))
    server.nodes.set('e', node('e', 'e.png'))
    server.batchFailures = ['b', 'd']
    const { root } = await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(5))
    for (const name of ['a', 'b', 'c', 'd', 'e']) menuItem(name, 'Select')?.onClick()
    await nextTick()

    const trash = [...root.querySelectorAll<HTMLElement>('div')].find(
      (element) => element.getAttribute('label') === 'Move to trash',
    )
    trash?.click()

    await vi.waitFor(() => expect(titles()).toEqual([]))
    release()
    await vi.waitFor(() => expect(titles()).toEqual(['b.png', 'd.png']))
    expect(server.nodes.get('a')?.state).toBe('Trashed')
    expect(server.nodes.get('b')?.state).toBe('Active')
  })

  it('waits for Drive with the tweak off', async () => {
    setTweaks(['t26-optimistic-remove'], false)
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    void menuItem('b', 'Move to trash')?.onClick()
    await vi.waitFor(() => expect(server.calls.at(-1)?.id).toBe('node_patch.trash'))
    await nextTick()

    expect(titles()).toEqual(['a.png', 'b.png', 'c.png'])
    release()
    await vi.waitFor(() => expect(titles()).toEqual(['a.png', 'c.png']))
  })
})

describe('Keys', () => {
  afterEach(() => setTweaks(['t14-focused-row'], true))

  it('moves the focused row to Trash with Delete, and Mod+Z brings it back', async () => {
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    listing.focused = listing.rows.find((row) => row.name === 'b')!

    press('Delete')
    await vi.waitFor(() => expect(server.nodes.get('b')?.state).toBe('Trashed'))
    expect(feedback.toasts.at(-1)?.message).toBe('Moved “b.png” to Trash')

    expect(press('Mod+Z').defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(server.nodes.get('b')?.state).toBe('Active'))
  })

  it('opens the parent folder with Alt+Up and asks it to show the folder the user left', async () => {
    const { router } = await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))

    press('Alt+ArrowUp')

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive'))
    expect(router.options.history.state.reveal).toBe('folder-1')
  })

  it('acts only on selected rows with the focused-row tweak off', async () => {
    setTweaks(['t14-focused-row'], false)
    await mount('/drive/f/folder-1/talks')
    await vi.waitFor(() => expect(titles()).toHaveLength(3))
    listing.focused = listing.rows.find((row) => row.name === 'b')!

    press('Delete')
    await nextTick()

    expect(server.calls.some((call) => call.id === 'node_patch.trash')).toBe(false)
  })
})
