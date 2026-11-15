import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DocumentPanel, DocumentSession } from '@/apps/drive'

import SheetDocumentMenu from './SheetDocumentMenu.vue'

// The real frappe-ui menu and button.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Dropdown')),
}))
// Drive's own menu items, without the rest of the Drive package
vi.mock('@/apps/drive', () => import('@/apps/drive/files/features/document/header'))
vi.mock('@/platform/feedback', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))
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

function mountMenu(panels: readonly DocumentPanel[], canStar = true) {
  const onTogglePanel = vi.fn()
  const exportCsv = vi.fn()
  const session = fromPartial<DocumentSession>({
    canStar: ref(canStar),
    isStarred: ref(false),
    setStarred: vi.fn(async () => {}),
  })
  const fileOptions = [
    { group: 'Export', options: [{ label: 'Export as CSV', onClick: exportCsv }] },
    { group: 'Import', options: [{ label: 'Import CSV', onClick: () => {} }] },
  ]
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(SheetDocumentMenu, { session, panels, panel: null, fileOptions, onTogglePanel }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, onTogglePanel, exportCsv, session }
}

async function openMenu(root: HTMLElement) {
  root
    .querySelector('button[aria-label="More document actions"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

const names = (items: HTMLElement[]) => items.map((item) => item.textContent?.trim())

it('lists the side panels, Copy link, Star, then the file’s items', async () => {
  const { root } = mountMenu(['comments', 'versions'])

  expect(names(await openMenu(root))).toEqual([
    'Comments',
    'Versions',
    'Copy link',
    'Star',
    'Export as CSV',
    'Import CSV',
  ])
})

it('reports the side panel picked', async () => {
  const { root, onTogglePanel } = mountMenu(['comments', 'versions'])

  const items = await openMenu(root)
  items[1]!.click()
  await settle()
  expect(onTogglePanel).toHaveBeenCalledExactlyOnceWith('versions')
})

it('stars the spreadsheet and runs a file item from the menu', async () => {
  const { root, session, exportCsv } = mountMenu([])

  const pick = async (name: string) => {
    const items = await openMenu(root)
    items.find((item) => item.textContent?.trim() === name)!.click()
    await settle()
  }
  await pick('Star')
  await pick('Export as CSV')

  expect(session.setStarred).toHaveBeenCalledExactlyOnceWith(true)
  expect(exportCsv).toHaveBeenCalledOnce()
})

it('offers no Star to someone who cannot keep one', async () => {
  const { root } = mountMenu([], false)

  expect(names(await openMenu(root))).toEqual(['Copy link', 'Export as CSV', 'Import CSV'])
})
