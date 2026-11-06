import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import type { DriveNode } from '@/apps/drive/client/types'
import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import { TransportError, type Operation } from '@/platform/transport'
import { setTweaks } from '@/platform/tweaks'

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
            const trashed = node(input.node)
            if (trashed) trashed.state = 'Trashed'
            return trashed
          }
          case 'node_children':
            return {
              rows: [...server.nodes.values()].filter((row) => row.parent_node === input.node),
              next_cursor: null,
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
const feedback = vi.hoisted(() => ({ toasts: fromPartial<ShownToast[]>([]) }))
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
  rows: fromPartial<DriveNode[]>([]),
  menu: fromPartial<null | ((row: DriveNode) => MenuGroup[])>(null),
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
const dialogs = vi.hoisted(() => ({
  showDetails: vi.fn(async () => {}),
  share: vi.fn(async () => false),
}))
vi.mock('@/apps/drive', async (original) => ({
  ...(await original<typeof import('@/apps/drive')>()),
  useDriveDialogs: () => ({ ...dialogs, move: vi.fn() }),
}))
// The page's keyboard shortcuts, as it registers them.
const keys = vi.hoisted(() => ({
  shortcuts: fromPartial<Array<{ description: string; handler: (event: KeyboardEvent) => void }>>(
    [],
  ),
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
  useKeyboardShortcut: (shortcuts: typeof keys.shortcuts) => keys.shortcuts.push(...shortcuts),
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
  vi.useRealTimers()
  feedback.toasts.length = 0
  listing.rows = []
  listing.menu = null
  uploads.upload.mockReset()
  dialogs.showDetails.mockClear()
  dialogs.share.mockClear()
  keys.shortcuts = []
  vi.unstubAllGlobals()
  setTweaks(['t3-folder-menu', 't3-selection-menu', 't8'], true)
  document.body.innerHTML = ''
})

async function mount(path: string): Promise<{ root: HTMLElement; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/drive', component: { render: () => null } },
      {
        path: '/drive/recent',
        name: 'files-recent',
        component: FilesPage,
        props: { destination: 'recent' },
      },
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
            'The download starts here when the zip is ready. A notification will bring it too.',
          duration: Infinity,
        },
      },
    ])

    await vi.advanceTimersByTimeAsync(2000)
    await downloading

    expect(assign).toHaveBeenCalledWith(url)
    expect(feedback.toasts[1]).toEqual({
      kind: 'success',
      message: 'Downloading “Photos”',
      options: { id: 'download-1', description: undefined, duration: 5000 },
    })
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
})

describe('Keyboard shortcuts', () => {
  function press(description: string) {
    const shortcut = keys.shortcuts.find((candidate) => candidate.description === description)
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

    press('Select all')
    await nextTick()
    expect(root.textContent).toContain('3 selected')

    press('Delete selected items')
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
