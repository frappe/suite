import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import SheetMenuBar, { type SheetMenu } from './SheetMenuBar.vue'

// The real reka-based Dropdown and Button: opening, closing and focus are theirs.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
}))

// jsdom has none; the menu's positioning watches its size.
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

function mountBar(menus: SheetMenu[], openComments?: () => void) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(SheetMenuBar, { menus, openComments }) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

const trigger = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`[data-menu="${label}"]`)!
const openMenu = () => document.querySelector('[role="menu"]')
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
    el.textContent?.includes(label),
  )
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

function menus() {
  const zoomIn = vi.fn()
  const exportCsv = vi.fn()
  return {
    zoomIn,
    exportCsv,
    list: [
      { label: 'File', options: [{ label: 'Download as CSV', onClick: exportCsv }] },
      { label: 'Edit', options: [{ label: 'Find and replace', onClick: vi.fn() }] },
      { label: 'View', options: [{ label: 'Zoom in', onClick: zoomIn }] },
      { label: 'Insert', options: [{ label: 'Chart…', onClick: vi.fn() }] },
      { label: 'Format', options: [{ label: 'Bold', onClick: vi.fn() }] },
      { label: 'Data', options: [{ label: 'Smart Fill', onClick: vi.fn() }] },
    ],
  }
}

describe('SheetMenuBar', () => {
  it('shows each menu as a labelled button, in order', () => {
    const root = mountBar(menus().list)
    const names = [...root.querySelectorAll('[data-menu]')].map((b) => b.textContent?.trim())
    expect(names).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data'])
    expect(root.querySelector('nav')!.getAttribute('aria-label')).toBe('Spreadsheet menus')
  })

  it('opens a menu, runs the chosen item and closes', async () => {
    const { list, zoomIn } = menus()
    const root = mountBar(list)
    press(trigger(root, 'View'), 'Enter')
    await settle()
    expect(openMenu()).not.toBeNull()

    menuItem('Zoom in')!.click()
    await settle()
    expect(zoomIn).toHaveBeenCalledOnce()
    expect(openMenu()).toBeNull()
  })

  it('works from the keyboard: arrows between menus, Escape closes back to the button', async () => {
    const { list, exportCsv } = menus()
    const root = mountBar(list)
    trigger(root, 'File').focus()
    press(trigger(root, 'File'), 'ArrowRight')
    expect(document.activeElement).toBe(trigger(root, 'Edit'))
    press(trigger(root, 'Edit'), 'ArrowLeft')
    press(trigger(root, 'File'), 'ArrowLeft')
    expect(document.activeElement).toBe(trigger(root, 'Data'))

    trigger(root, 'Data').focus()
    press(trigger(root, 'Data'), 'ArrowRight')
    expect(document.activeElement).toBe(trigger(root, 'File'))

    press(trigger(root, 'File'), 'Enter')
    await settle()
    expect(menuItem('Download as CSV')).toBeDefined()
    press(document.activeElement!, 'Escape')
    await settle()
    expect(openMenu()).toBeNull()
    expect(document.activeElement).toBe(trigger(root, 'File'))
    expect(exportCsv).not.toHaveBeenCalled()
  })

  it('adds Insert → Comment when the surface has a comments panel', async () => {
    const openComments = vi.fn()
    const root = mountBar(menus().list, openComments)
    press(trigger(root, 'Insert'), 'Enter')
    await settle()
    menuItem('Comment')!.click()
    expect(openComments).toHaveBeenCalledOnce()
  })

  it('gives a viewer with no Insert menu one for Comment, after View', () => {
    const list = menus().list.filter((m) => m.label !== 'Insert' && m.label !== 'Format')
    const root = mountBar(list, vi.fn())
    const names = [...root.querySelectorAll('[data-menu]')].map((b) => b.textContent?.trim())
    expect(names).toEqual(['File', 'Edit', 'View', 'Insert', 'Data'])
  })
})
