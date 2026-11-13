import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type SetupContext } from 'vue'

import SheetMenuBar, { type SheetMenu } from './SheetMenuBar.vue'

const subContent = vi.hoisted((): Record<string, unknown>[] => [])

// Records the props each submenu panel gets, on the way to the real one.
vi.mock('reka-ui', async (importOriginal) => {
  const reka = await importOriginal<typeof import('reka-ui')>()
  const MenubarSubContent = (_: unknown, { attrs, slots }: SetupContext) => {
    subContent.push(attrs)
    return h(reka.MenubarSubContent, attrs, slots)
  }
  return { ...reka, MenubarSubContent }
})

const menuCss = readFileSync(resolve(__dirname, 'SheetEditor.global.css'), 'utf8')

// The real Button and portal helper. Opening, closing and focus are reka's. The
// Dropdown is what Writer's menu uses, so the look can be compared with it.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/composables/usePortalTarget')),
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
  root.querySelector<HTMLButtonElement>(`[data-menu="${label.toLowerCase()}"]`)!
const openMenu = () => document.querySelector('[role="menu"]')
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-menu])')].find((el) =>
    el.textContent?.includes(label),
  )
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const pointerDown = (el: Element) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
const hover = (el: Element) => el.dispatchEvent(new MouseEvent('pointerenter'))
const openLabels = () =>
  [...document.querySelectorAll('[role="menuitem"]:not([data-menu])')].map((el) =>
    el.textContent?.trim(),
  )

function menus() {
  const zoomIn = vi.fn()
  const exportCsv = vi.fn()
  return {
    zoomIn,
    exportCsv,
    list: [
      { key: 'file', label: 'File', options: [{ label: 'Download as CSV', onClick: exportCsv }] },
      { key: 'edit', label: 'Edit', options: [{ label: 'Find and replace', onClick: vi.fn() }] },
      { key: 'view', label: 'View', options: [{ label: 'Zoom in', onClick: zoomIn }] },
      { key: 'insert', label: 'Insert', options: [{ label: 'Chart…', onClick: vi.fn() }] },
      { key: 'format', label: 'Format', options: [{ label: 'Bold', onClick: vi.fn() }] },
      { key: 'data', label: 'Data', options: [{ label: 'Smart Fill', onClick: vi.fn() }] },
    ],
  }
}

describe('SheetMenuBar', () => {
  it('shows each menu as a labelled button, in order', () => {
    const root = mountBar(menus().list)
    const names = [...root.querySelectorAll('.sn-menubar-wide [data-menu]')].map((b) =>
      b.textContent?.trim(),
    )
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

  it('leaves the page live while a menu is open, so the other labels can be hovered', async () => {
    const root = mountBar(menus().list)
    pointerDown(trigger(root, 'File'))
    await settle()
    expect(openLabels()).toEqual(['Download as CSV'])
    expect(document.body.style.pointerEvents).not.toBe('none')
  })

  it('switches to the hovered label while a menu is open, without a click', async () => {
    const root = mountBar(menus().list)
    pointerDown(trigger(root, 'File'))
    await settle()
    hover(trigger(root, 'Edit'))
    await settle()
    expect(openLabels()).toEqual(['Find and replace'])
    hover(trigger(root, 'Data'))
    await settle()
    expect(openLabels()).toEqual(['Smart Fill'])
  })

  it('opens nothing on hover while every menu is closed', async () => {
    const root = mountBar(menus().list)
    hover(trigger(root, 'Edit'))
    await settle()
    expect(openMenu()).toBeNull()
  })

  it('closes when the open label is pressed again', async () => {
    const root = mountBar(menus().list)
    pointerDown(trigger(root, 'File'))
    await settle()
    expect(openMenu()).not.toBeNull()
    pointerDown(trigger(root, 'File'))
    await settle()
    expect(openMenu()).toBeNull()
  })

  it('closes on a press outside the bar', async () => {
    const root = mountBar(menus().list)
    pointerDown(trigger(root, 'File'))
    await settle()
    pointerDown(document.body)
    await settle()
    expect(openMenu()).toBeNull()
  })

  it('moves between open menus with the left and right arrows, wrapping at the ends', async () => {
    const root = mountBar(menus().list)
    press(trigger(root, 'File'), 'Enter')
    await settle()
    press(document.activeElement!, 'ArrowRight')
    await settle()
    expect(openLabels()).toEqual(['Find and replace'])
    press(document.activeElement!, 'ArrowLeft')
    await settle()
    press(document.activeElement!, 'ArrowLeft')
    await settle()
    expect(openLabels()).toEqual(['Smart Fill'])
  })

  it('draws its items exactly as the Dropdown behind Writer’s menu does', async () => {
    // Everything an item can show: icon, submenu arrow, disabled, no icon.
    const options = [
      {
        group: 'Edit',
        hideLabel: true,
        options: [
          { label: 'Undo', icon: 'lucide-undo-2', onClick: vi.fn() },
          { label: 'Redo', icon: 'lucide-redo-2', disabled: true, onClick: vi.fn() },
          { label: 'Paste', icon: 'lucide-clipboard', submenu: [{ label: 'Values' }] },
        ],
      },
      { group: 'Plain', hideLabel: true, options: [{ label: 'Plain', onClick: vi.fn() }] },
    ]
    /** An element's classes and those of everything inside it, ids aside. */
    const look = () => {
      const content = document.querySelector('[data-slot="content"]')!
      return [content, ...content.querySelectorAll('*')].map((el) => el.getAttribute('class'))
    }

    const root = mountBar([{ key: 'edit', label: 'Edit', options }])
    press(trigger(root, 'Edit'), 'Enter')
    await settle()
    const barLook = look()
    expect(barLook.length).toBeGreaterThan(8)
    cleanup?.()
    await settle()

    const { Dropdown } = await import('frappe-ui')
    const host = document.createElement('div')
    document.body.append(host)
    const writer = createApp({
      setup: () => () => h(Dropdown, { options, align: 'start', open: true }),
    })
    writer.mount(host)
    cleanup = () => {
      writer.unmount()
      host.remove()
    }
    await settle()
    expect(look()).toEqual(barLook)
  })

  // Left and Right between closed labels is reka's roving focus, which picks no
  // target under jsdom; the browser check covers it.
  it('closes on Escape, back to the label, without running anything', async () => {
    const { list, exportCsv } = menus()
    const root = mountBar(list)
    trigger(root, 'File').focus()
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
    const list = menus().list.filter((m) => m.key !== 'insert' && m.key !== 'format')
    const root = mountBar(list, vi.fn())
    const names = [...root.querySelectorAll('.sn-menubar-wide [data-menu]')].map((b) =>
      b.textContent?.trim(),
    )
    expect(names).toEqual(['File', 'Edit', 'View', 'Insert', 'Data'])
  })

  it('starts a submenu level with the row that opened it', async () => {
    const options = [{ label: 'Number', submenu: [{ label: 'Plain text', onClick: vi.fn() }] }]
    const root = mountBar([{ key: 'format', label: 'Format', options }])
    press(trigger(root, 'Format'), 'Enter')
    await settle()
    const row = menuItem('Number')!
    row.focus()
    press(row, 'ArrowRight')
    await settle()
    expect(menuItem('Plain text')).toBeDefined()
    // The real offset needs layout, so this reads what reka is handed.
    expect(subContent.at(-1)?.alignOffset).toBe(-6)
  })

  it('lets a panel grow to the window, with a slim scrollbar and no arrows', () => {
    expect(menuCss).not.toContain('min(60vh, 480px)')
    expect(menuCss).toContain('var(--reka-popper-available-height)')
    expect(menuCss).toMatch(/\.menu-content::-webkit-scrollbar-button[^{]*\{\s*display: none/)
  })

  it('folds the six menus into one Menu, each a submenu, for a narrow header', async () => {
    const { list, zoomIn } = menus()
    const root = mountBar(list)
    const menu = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Menu')!
    press(menu, 'Enter')
    await settle()
    expect(openLabels()).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data'])
    const view = menuItem('View')!
    view.focus()
    press(view, 'ArrowRight')
    await settle()
    menuItem('Zoom in')!.click()
    await settle()
    expect(zoomIn).toHaveBeenCalledOnce()
  })
})
