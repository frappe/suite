import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { DocumentSession } from '@/apps/drive/client/session'

import DocumentMenu from './DocumentMenu.vue'

// The real frappe-ui menu and button
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/platform/feedback', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))
// Naming Drive's roots takes a query, so here every folder goes by its own title
vi.mock('@/apps/drive/files/internal/locations', async (original) => ({
  ...(await original()),
  useLocationTitle: () => (node: { title: string }) => node.title,
}))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** A document in a folder, with the caller's role on each. */
function session(role: number, folderRole: number) {
  return fromPartial<DocumentSession>({
    nodeId: 'node-1',
    title: ref('Budget'),
    state: ref<DocumentSession['state']['value']>('Active'),
    access: ref({ role }),
    folder: ref({ name: 'folder-9', title: 'Projects', kind: 'folder', role: folderRole }),
    canStar: ref(true),
    isStarred: ref(false),
    setStarred: vi.fn(async () => {}),
  })
}

const item = (label: string, onClick = () => {}) => ({ label, onClick })

function mountMenu(
  props: Omit<InstanceType<typeof DocumentMenu>['$props'], 'session'>,
  doc = session(50, 50),
) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(DocumentMenu, { session: doc, ...props }) })
  app.use(
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
    }),
  )
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

/** Opens the menu by its one name, and reads the items of each group it shows. */
async function openGroups(root: HTMLElement) {
  root
    .querySelector('button[aria-label="More actions"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return [...document.querySelectorAll('[data-slot="group"]')].map((group) =>
    [...group.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) =>
      el.textContent?.trim(),
    ),
  )
}

/** Picks an item, which closes the menu. */
async function pick(root: HTMLElement, name: string) {
  if (!document.querySelector('[role="menuitem"]')) await openGroups(root)
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  items.find((el) => el.textContent?.trim() === name)!.click()
  await settle()
}

it('keeps one order: the panels, the link with export and import, the setting above the file’s actions, then what removes it', async () => {
  const root = mountMenu({
    panels: ['comments', 'versions'],
    review: [item('Save version')],
    transfer: [item('Export as DOCX'), item('Import DOCX')],
    settings: [item('Lock')],
    discard: [item('Discard my changes')],
  })

  expect(await openGroups(root)).toEqual([
    ['Comments', 'Versions', 'Save version'],
    ['Copy link', 'Export as DOCX', 'Import DOCX'],
    ['Lock', 'Star', 'Make a copy'],
    ['Discard my changes', 'Move to trash'],
  ])
})

it('leaves no gap for a surface that adds nothing of its own', async () => {
  expect(await openGroups(mountMenu({}))).toEqual([
    ['Copy link'],
    ['Star', 'Make a copy'],
    ['Move to trash'],
  ])
})

it('offers someone who only views neither Make a copy nor Move to trash', async () => {
  const root = mountMenu({ transfer: [item('Export as CSV')] }, session(10, 10))

  expect(await openGroups(root)).toEqual([['Copy link', 'Export as CSV'], ['Star']])
})

it('shows a file’s own link and actions in place of a document’s', async () => {
  const copyFileLink = vi.fn()
  const root = mountMenu({
    link: [item('Copy link', copyFileLink), item('Details')],
    transfer: [item('Upload new version')],
    file: [item('Rename')],
    remove: [item('Restore')],
  })

  expect(await openGroups(root)).toEqual([
    ['Copy link', 'Details', 'Upload new version'],
    ['Rename'],
    ['Restore'],
  ])
  await pick(root, 'Copy link')
  expect(copyFileLink).toHaveBeenCalledOnce()
})

it('reports the side panel picked and stars the document', async () => {
  const onTogglePanel = vi.fn()
  const doc = session(50, 50)
  const root = mountMenu({ panels: ['comments', 'versions'], onTogglePanel }, doc)

  await pick(root, 'Versions')
  await pick(root, 'Star')

  expect(onTogglePanel).toHaveBeenCalledExactlyOnceWith('versions')
  expect(doc.setStarred).toHaveBeenCalledExactlyOnceWith(true)
})
