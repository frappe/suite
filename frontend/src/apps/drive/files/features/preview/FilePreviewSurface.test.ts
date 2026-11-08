import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  unref,
  type PropType,
  type Ref,
} from 'vue'
import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  RouterLink,
  RouterView,
  type RouteLocationRaw,
  type Router,
} from 'vue-router'

import type { DriveNode } from '@/apps/drive/client/types'
import type { Operation } from '@/platform/transport'

import type { FilePreviewSession } from './session'

vi.mock('frappe-ui', async () => ({
  Button: (
    await import('../../../../../../../node_modules/frappe-ui/src/components/Button/Button.vue')
  ).default,
  TabButtons: (
    await import('../../../../../../../node_modules/frappe-ui/src/components/TabButtons/TabButtons.vue')
  ).default,
  Spinner: defineComponent({ setup: () => () => h('div', { role: 'status' }) }),
  // The menu's items show beside its trigger, so a test can choose one.
  Dropdown: defineComponent({
    props: {
      options: {
        type: fromPartial<PropType<Array<{ label: string; onClick: () => unknown }>>>(Array),
        default: () => [],
      },
    },
    setup:
      (props, { slots }) =>
      () =>
        h('div', [
          slots.default?.(),
          h(
            'menu',
            props.options.map((option) =>
              h('button', { role: 'menuitem', onClick: option.onClick }, option.label),
            ),
          ),
        ]),
  }),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// The header has its own tests. This one shows its slots and its link back to the folder.
vi.mock('../document/DocumentHeader.vue', () => ({
  default: defineComponent({
    props: {
      location: {
        type: fromPartial<PropType<{ label: string; to: RouteLocationRaw } | null>>(Object),
        default: null,
      },
    },
    setup:
      (props, { slots }) =>
      () =>
        h('header', [
          props.location
            ? h(RouterLink, { to: props.location.to }, () => props.location?.label)
            : null,
          slots.status?.(),
          slots.actions?.(),
          slots.menu?.(),
        ]),
  }),
}))

// A folder of mixed files, and a server that keeps the types `?type=` names, as Drive does.
type Row = Pick<
  DriveNode,
  'name' | 'title' | 'kind' | 'mime' | 'state' | 'parent_node' | 'modified' | 'size'
>
const file = (name: string, title: string, mime: string): Row => ({
  name,
  title,
  kind: 'file',
  mime,
  state: 'Active',
  parent_node: 'folder-1',
  modified: '2026-10-01 10:00:00',
  size: 100,
})
const FOLDER: Row[] = [
  file('a', 'a.png', 'image/png'),
  file('b', 'b.pdf', 'application/pdf'),
  file('c', 'c.png', 'image/png'),
  file('d', 'd.txt', 'text/plain'),
  file('e', 'e.jpg', 'image/jpeg'),
  { ...file('f', 'Assets', ''), kind: 'folder', mime: null },
]
/** The state of the folder's rows. A trashed folder lists what was trashed with it. */
let folderState = 'Active'
/** The caller's role on the folder a file sits in. */
let folderRole = 30
function typeOf(row: Row): string {
  if (row.kind === 'folder') return 'folder'
  if (row.mime === 'application/pdf') return 'pdf'
  return row.mime?.split('/')[0] ?? ''
}

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const requests = vi.hoisted(() => fromPartial<Array<{ id: string; input: unknown }>>([]))
vi.mock('@/platform/transport', async (original) => ({
  ...(await original<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { type?: string; node?: string }) => {
      requests.push({ id: operation.id, input })
      if (operation.id === 'node_patch.trash') return { name: input.node, state: 'Trashed' }
      if (operation.id === 'node_get') {
        return {
          name: input.node,
          kind: 'folder',
          state: 'Active',
          root: 'root',
          access: { role: folderRole },
        }
      }
      if (operation.id !== 'node_children') throw new Error(`Unexpected request ${operation.id}`)
      const types = input.type?.split(',')
      const rows = FOLDER.filter((row) => !types || types.includes(typeOf(row)))
      const trashRoot = folderState === 'Trashed' ? input.node : null
      const listed = rows.map((row) => ({
        ...row,
        parent_node: input.node,
        state: folderState,
        trash_root: trashRoot,
      }))
      return { rows: listed.sort((a, b) => a.title.localeCompare(b.title)), next_cursor: null }
    },
  },
}))

const account = vi.hoisted(() => ({ status: 'guest' as 'guest' | 'authenticated' }))
vi.mock('@/platform/session', async (original) => {
  const actual = await original<typeof import('@/platform/session')>()
  return {
    ...actual,
    useSession: () => ({ ...actual.useSession(), status: ref(account.status) }),
  }
})

const { default: FilePreviewSurface } = await import('./FilePreviewSurface.vue')

function session(
  nodeId: string,
  title: string,
  mime: string,
  size = 100,
  trashRoot: string | null = null,
  role = 10,
): FilePreviewSession {
  const fields = {
    nodeId,
    contentDoctype: 'File',
    contentDocname: nodeId,
    mime,
    title: ref(title),
    state: ref<FilePreviewSession['state']['value']>(trashRoot ? 'Trashed' : 'Active'),
    root: 'root',
    trashRoot: ref(trashRoot),
    access: ref({ role }),
    canShare: ref(false),
    size: ref(size),
    // A trashed folder of its own, so its listing is not the Active one another test read.
    parent: ref(trashRoot ? 'folder-2' : 'folder-1'),
    folder: ref(
      trashRoot ? { name: 'folder-2', title: 'Old talks' } : { name: 'folder-1', title: 'Talks' },
    ),
    preview: ref(null),
    editedAt: null,
    isStarred: ref(false),
    canStar: ref(true),
    setStarred: vi.fn(),
    refreshPreview: async () => {},
  }
  return fromPartial<FilePreviewSession>(fields)
}

let unmount: (() => void) | null = null
afterEach(() => {
  unmount?.()
  unmount = null
  folderState = 'Active'
  folderRole = 30
  account.status = 'guest'
  requests.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** Mounts the preview at `path`. With `from`, the browser's history opened it from that page, so it knows its way back. */
async function mount(
  opened: FilePreviewSession | Ref<FilePreviewSession>,
  path: string,
  from?: string,
): Promise<{ root: HTMLElement; router: Router }> {
  const router = createRouter({
    history: from ? createWebHistory() : createMemoryHistory(),
    routes: [
      {
        path: '/d/:node/:slug?',
        component: { render: () => h(FilePreviewSurface, { session: unref(opened) }) },
      },
      { path: '/drive/f/:node/:slug?', component: { render: () => null } },
      { path: '/drive', component: { render: () => null } },
    ],
  })
  if (from) await router.push(from)
  await router.push(path)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(RouterView) })
  app.use(router)
  app.mount(root)
  unmount = () => app.unmount()
  return { root, router }
}

const menuItem = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label,
  )
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const counter = (root: HTMLElement) => root.querySelector('header span.tabular-nums')?.textContent

describe('file preview', () => {
  describe('a CSV, which has a text preview', () => {
    const openAsSheetButton = (root: HTMLElement) =>
      [...root.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Open as spreadsheet'),
      )

    it('offers to open as a spreadsheet when the folder takes uploads', async () => {
      vi.stubGlobal('fetch', async () => new Response('a,b\n1,2\n'))
      const { root } = await mount(session('g', 'data.csv', 'text/csv'), '/d/g/data-csv')

      await vi.waitFor(() => expect(openAsSheetButton(root)).toBeDefined())
    })

    it('does not offer it to someone who can only read the folder', async () => {
      folderRole = 10
      vi.stubGlobal('fetch', async () => new Response('a,b\n1,2\n'))
      // Its own folder, so the answer is not the one another test cached.
      const opened = { ...session('g', 'data.csv', 'text/csv'), parent: ref('folder-3') }
      const { root } = await mount(fromPartial<FilePreviewSession>(opened), '/d/g/data-csv')

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(openAsSheetButton(root)).toBeUndefined()
    })
  })

  it('steps through only the files the filtered listing showed', async () => {
    const { root, router } = await mount(
      session('c', 'c.png', 'image/png'),
      '/d/c/c-png?type=image',
    )

    await vi.waitFor(() => expect(counter(root)).toBe('2 of 3'))
    expect(root.querySelector('header a')?.getAttribute('href')).toBe(
      '/drive/f/folder-1/talks?type=image',
    )

    press('ArrowRight')
    await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('e'))
    expect(router.currentRoute.value.query.type).toBe('image')
    expect(counter(root)).toBe('3 of 3')

    press('ArrowLeft')
    await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('c'))
    press('ArrowLeft')
    await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('a'))
    expect(router.currentRoute.value.query.type).toBe('image')
    expect(counter(root)).toBe('1 of 3')
    expect(root.querySelector('[aria-label="Previous file"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('steps through every file in the folder without a filter', async () => {
    const { root, router } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')

    await vi.waitFor(() => expect(counter(root)).toBe('3 of 5'))
    press('ArrowRight')
    await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('d'))
    expect(router.currentRoute.value.query.type).toBeUndefined()
  })

  it('steps through the files of a trashed folder, which were trashed with it', async () => {
    folderState = 'Trashed'
    const { root, router } = await mount(
      session('c', 'c.png', 'image/png', 100, 'folder-2'),
      '/d/c/c-png',
    )

    await vi.waitFor(() => expect(counter(root)).toBe('3 of 5'))
    press('ArrowRight')
    await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('d'))
  })

  it('opens a Markdown file rendered, and every next one too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Plan\n\nSome text')),
    )
    const opened = shallowRef(session('m1', 'plan.md', 'application/octet-stream'))
    const { root } = await mount(opened, '/d/m1/plan-md')

    await vi.waitFor(() => expect(root.querySelector('article h1')?.textContent).toBe('Plan'))
    expect(root.querySelector('.cm-content')).toBeNull()
    const source = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Source',
    )
    source?.click()
    await vi.waitFor(() =>
      expect(root.querySelector('.cm-content')?.textContent).toContain('# Plan'),
    )
    expect(root.querySelector('article h1')).toBeNull()

    // The next file, as stepping shows it in the same preview.
    opened.value = session('m2', 'notes.markdown', 'application/octet-stream')
    await vi.waitFor(() => expect(root.querySelector('article h1')?.textContent).toBe('Plan'))
    expect(root.querySelector('.cm-content')).toBeNull()
  })

  describe('pictures', () => {
    const contentOf = (node: string) => `/api/suite/drive/nodes/${node}/content`

    it('loads the pictures either side, and a step shows the one already loaded', async () => {
      const created = vi.spyOn(document, 'createElement')
      const opened = shallowRef(session('c', 'c.png', 'image/png'))
      const { root } = await mount(opened, '/d/c/c-png?type=image')
      const made = () =>
        created.mock.results.flatMap((result) =>
          result.value instanceof HTMLImageElement ? [result.value] : [],
        )
      const ahead = () => made().find((image) => image.getAttribute('src') === contentOf('e'))
      await vi.waitFor(() => expect(counter(root)).toBe('2 of 3'))
      // The pictures beside wait for the one on screen, so they do not slow it down.
      expect(ahead()).toBeUndefined()
      root.querySelector('img')!.dispatchEvent(new Event('load'))
      await vi.waitFor(() => expect(ahead()).toBeDefined())
      expect(made().map((image) => image.getAttribute('src'))).toContain(contentOf('a'))

      opened.value = session('e', 'e.jpg', 'image/jpeg')

      await vi.waitFor(() => expect(root.querySelector('img')).toBe(ahead()))
    })

    it('shows a loaded picture at once, even one with no natural size, such as an SVG with only a viewBox', async () => {
      const created = vi.spyOn(document, 'createElement')
      const opened = shallowRef(session('c', 'c.png', 'image/png'))
      const { root } = await mount(opened, '/d/c/c-png?type=image')
      await vi.waitFor(() => expect(counter(root)).toBe('2 of 3'))
      root.querySelector('img')!.dispatchEvent(new Event('load'))
      const beside = () =>
        created.mock.results
          .flatMap((result) => (result.value instanceof HTMLImageElement ? [result.value] : []))
          .find((image) => image.getAttribute('src') === contentOf('e'))
      await vi.waitFor(() => expect(beside()).toBeDefined())
      Object.defineProperty(beside(), 'complete', { value: true })
      expect(beside()?.naturalWidth).toBe(0)

      opened.value = session('e', 'e.svg', 'image/jpeg')

      await vi.waitFor(() => expect(root.querySelector('img')).toBe(beside()))
      expect(beside()?.style.opacity).toBe('')
    })

    it('keeps a server preview up while its URL is signed again, until the new one has loaded', async () => {
      const created = vi.spyOn(document, 'createElement')
      const preview = ref<{ url: string } | null>({ url: '/preview?signature=one' })
      const opened = fromPartial<FilePreviewSession>({
        ...session('h', 'photo.heic', 'image/heic'),
        preview,
      })
      const { root } = await mount(opened, '/d/h/photo-heic')
      const first = root.querySelector('img')!
      expect(first.getAttribute('src')).toBe('/preview?signature=one')
      first.dispatchEvent(new Event('load'))
      await vi.waitFor(() => expect(first.style.opacity).toBe(''))

      preview.value = { url: '/preview?signature=two' }
      const second = () =>
        created.mock.results
          .flatMap((result) => (result.value instanceof HTMLImageElement ? [result.value] : []))
          .find((image) => image.getAttribute('src') === '/preview?signature=two')
      await vi.waitFor(() => expect(second()).toBeDefined())
      await nextTick()
      expect([...root.querySelectorAll('img')]).toEqual([first])
      expect(first.style.opacity).toBe('')

      second()!.dispatchEvent(new Event('load'))
      await vi.waitFor(() => expect([...root.querySelectorAll('img')]).toEqual([second()]))
      expect(second()?.style.opacity).toBe('')
    })

    it('shows a spinner after a short wait, then the picture, or Download when it fails', async () => {
      const opened = shallowRef(session('c', 'c.png', 'image/png'))
      const { root } = await mount(opened, '/d/c/c-png')
      const spinner = () => root.querySelector('[role="status"]')
      expect(spinner()).toBeNull()
      await vi.waitFor(() => expect(spinner()).not.toBeNull(), { timeout: 1000 })
      root.querySelector('img')!.dispatchEvent(new Event('load'))
      await vi.waitFor(() => expect(spinner()).toBeNull())
      expect(root.querySelector('img')?.style.opacity).toBe('')

      opened.value = session('a', 'a.png', 'image/png')
      await vi.waitFor(() =>
        expect(root.querySelector('img')?.getAttribute('src')).toBe(contentOf('a')),
      )
      root.querySelector('img')!.dispatchEvent(new Event('error'))
      await vi.waitFor(() => expect(root.textContent).toContain('Could not load the preview'))
      expect(root.querySelector('img')).toBeNull()
      expect(root.querySelector('a[href*="download=1"]')).not.toBeNull()
    })
  })

  describe('keys', () => {
    const LISTING = '/drive/f/folder-1/talks'

    it('Escape goes where the way back goes, the listing as it was, which then focuses the last file shown', async () => {
      const opener = `${LISTING}?view=grid&sort=modified&dir=desc`
      const { root, router } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png', opener)
      await vi.waitFor(() => expect(counter(root)).toBe('3 of 5'))
      const wayBack = root.querySelector<HTMLAnchorElement>('header a[href^="/drive/f/"]')
      expect(new URL(wayBack!.href).pathname + new URL(wayBack!.href).search).toBe(opener)
      press('ArrowRight')
      await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('d'))

      press('Escape')

      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(opener))
      expect(router.options.history.state.reveal).toBe('d')
    })

    it('Escape does nothing while a menu or dialog is open, but a tooltip does not stop it', async () => {
      const { router } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')
      const layer = document.createElement('div')
      layer.setAttribute('data-dismissable-layer', '')
      layer.setAttribute('role', 'menu')
      document.body.append(layer)

      press('Escape')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(router.currentRoute.value.params.node).toBe('c')

      layer.setAttribute('role', 'tooltip')
      press('Escape')
      // Opened straight from its address, so it opens the folder with the file focused.
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(LISTING))
      expect(router.options.history.state.reveal).toBe('c')
    })

    describe('with no folder to go back to and no page before it', () => {
      const shared = () =>
        fromPartial<FilePreviewSession>({
          ...session('c', 'c.png', 'image/png'),
          folder: ref(null),
          parent: ref(null),
        })

      it('Escape keeps a guest on the file, since Drive would send them to the login page', async () => {
        const { router } = await mount(shared(), '/d/c/c-png')

        press('Escape')
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(router.currentRoute.value.path).toBe('/d/c/c-png')
      })

      it('Escape takes a signed-in user to their files', async () => {
        account.status = 'authenticated'
        const { router } = await mount(shared(), '/d/c/c-png')

        press('Escape')

        await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive'))
      })
    })

    it('steps with the arrows after a click on Next file', async () => {
      // Focus opens the button's tooltip, which measures itself.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      )
      const { root, router } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')
      await vi.waitFor(() => expect(counter(root)).toBe('3 of 5'))
      root.querySelector<HTMLButtonElement>('[aria-label="Next file"]')!.focus()
      press('ArrowRight')
      await vi.waitFor(() => expect(router.currentRoute.value.params.node).toBe('d'))
    })
  })

  describe("the listing's actions", () => {
    it('lets an editor move the file to Trash, and goes back to its folder with Undo', async () => {
      const { toast } = await import('frappe-ui')
      const { root, router } = await mount(
        session('c', 'c.png', 'image/png', 100, null, 40),
        '/d/c/c-png?type=image',
      )

      menuItem(root, 'Move to trash')?.click()

      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/drive/f/folder-1/talks'))
      expect(router.currentRoute.value.query.type).toBe('image')
      expect(requests).toContainEqual({
        id: 'node_patch.trash',
        input: { node: 'c', state: 'Trashed' },
      })
      expect(toast.success).toHaveBeenCalledWith(
        'Moved “c.png” to Trash',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
      )
    })

    it('copies the link to the file page', async () => {
      const writeText = vi.fn(async () => {})
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const { root } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')

      menuItem(root, 'Copy link')?.click()

      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/d/c/c-png`))
    })

    it('offers a reader a copy and the link, but not Trash', async () => {
      const { root } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')

      expect(menuItem(root, 'Make a copy')).toBeDefined()
      expect(menuItem(root, 'Copy link')).toBeDefined()
      expect(menuItem(root, 'Move to trash')).toBeUndefined()
    })

    it('shows the file fullscreen where the browser allows it', async () => {
      Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
      const requestFullscreen = vi.fn(async () => {})
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        value: requestFullscreen,
        configurable: true,
      })
      try {
        const { root } = await mount(session('c', 'c.png', 'image/png'), '/d/c/c-png')

        root.querySelector<HTMLButtonElement>('[aria-label="Fullscreen"]')?.click()

        expect(requestFullscreen).toHaveBeenCalledOnce()
        expect(requestFullscreen.mock.contexts[0]).toBe(root.querySelector('header + div'))
      } finally {
        Reflect.deleteProperty(document, 'fullscreenEnabled')
        Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
      }
    })
  })
})
