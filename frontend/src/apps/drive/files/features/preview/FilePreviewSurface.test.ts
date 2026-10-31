import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, shallowRef, unref, type PropType, type Ref } from 'vue'
import {
  createMemoryHistory,
  createRouter,
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
  Dropdown: defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  }),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// The header has its own tests. This one shows its slots and its link back to the folder.
vi.mock('../document/DocumentHeader.vue', () => ({
  default: defineComponent({
    props: {
      location: {
        type: Object as PropType<{ label: string; to: RouteLocationRaw } | null>,
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
        ]),
  }),
}))

// A folder of mixed files, and a server that keeps the types `?type=` names, as Drive does.
type Row = Pick<
  DriveNode,
  'name' | 'title' | 'kind' | 'mime' | 'state' | 'parent_node' | 'modified'
>
const file = (name: string, title: string, mime: string): Row => ({
  name,
  title,
  kind: 'file',
  mime,
  state: 'Active',
  parent_node: 'folder-1',
  modified: '2026-10-01 10:00:00',
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
function typeOf(row: Row): string {
  if (row.kind === 'folder') return 'folder'
  if (row.mime === 'application/pdf') return 'pdf'
  return row.mime?.split('/')[0] ?? ''
}

vi.mock('@/platform/transport', async (original) => ({
  ...(await original<typeof import('@/platform/transport')>()),
  transport: {
    request: async (operation: Operation, input: { type?: string }) => {
      if (operation.id !== 'node_children') throw new Error(`Unexpected request ${operation.id}`)
      const types = input.type?.split(',')
      const rows = FOLDER.filter((row) => !types || types.includes(typeOf(row)))
      const listed = rows.map((row) => ({ ...row, state: folderState }))
      return { rows: listed.sort((a, b) => a.title.localeCompare(b.title)), next_cursor: null }
    },
  },
}))

const { default: FilePreviewSurface } = await import('./FilePreviewSurface.vue')

function session(
  nodeId: string,
  title: string,
  mime: string,
  size = 100,
  trashRoot: string | null = null,
): FilePreviewSession {
  const fields = {
    nodeId,
    contentDoctype: 'File',
    contentDocname: nodeId,
    mime,
    title: ref(title),
    state: ref(trashRoot ? 'Trashed' : 'Active'),
    root: 'root',
    trashRoot: ref(trashRoot),
    access: ref({ role: 10 }),
    canShare: ref(false),
    size: ref(size),
    // A trashed folder of its own, so its listing is not the Active one another test read.
    parent: ref(trashRoot ? 'folder-2' : 'folder-1'),
    folder: ref(
      trashRoot ? { name: 'folder-2', title: 'Old talks' } : { name: 'folder-1', title: 'Talks' },
    ),
    preview: ref(null),
    favourite: ref(false),
    refreshPreview: async () => {},
  }
  return fields as unknown as FilePreviewSession
}

let unmount: (() => void) | null = null
afterEach(() => {
  unmount?.()
  unmount = null
  folderState = 'Active'
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(
  opened: FilePreviewSession | Ref<FilePreviewSession>,
  path: string,
): Promise<{ root: HTMLElement; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/d/:node/:slug?',
        component: { render: () => h(FilePreviewSurface, { session: unref(opened) }) },
      },
      { path: '/drive/f/:node/:slug?', component: { render: () => null } },
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

const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const counter = (root: HTMLElement) => root.querySelector('header span.tabular-nums')?.textContent

describe('file preview', () => {
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
})
