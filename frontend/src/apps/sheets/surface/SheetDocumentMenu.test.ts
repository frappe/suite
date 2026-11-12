import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import type { DocumentPanel } from '@/apps/drive'

import SheetDocumentMenu from './SheetDocumentMenu.vue'

// The real frappe-ui menu and button.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../node_modules/frappe-ui/src/components/Dropdown')),
}))
vi.mock('@/apps/drive', () => ({
  PANEL_BUTTONS: {
    comments: { label: 'Comments', icon: 'lucide-messages-square' },
    versions: { label: 'Versions', icon: 'lucide-history' },
  },
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

function mountMenu(panels: readonly DocumentPanel[]) {
  const onTogglePanel = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(SheetDocumentMenu, { panels, panel: null, onTogglePanel }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, onTogglePanel }
}

async function openMenu(root: HTMLElement) {
  root
    .querySelector('button[aria-label="More document actions"]')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

it('lists the side panels and reports the one picked', async () => {
  const { root, onTogglePanel } = mountMenu(['comments', 'versions'])

  const items = await openMenu(root)
  expect(items.map((item) => item.textContent?.trim())).toEqual(['Comments', 'Versions'])

  items[1]!.click()
  await settle()
  expect(onTogglePanel).toHaveBeenCalledExactlyOnceWith('versions')
})
