import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref } from 'vue'

import { PALETTE } from '@/platform/collab/colours'

import SheetTabsBar from './SheetTabsBar.vue'

// The real reka-based tabs: selection, keyboard and the highlight are theirs.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tabs')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/directives/onOutsideClick')),
  toast: { error: vi.fn() },
}))

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

// startRenaming waits 50ms for a closing menu's click to finish.
const settle = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  await nextTick()
}

type BarProps = InstanceType<typeof SheetTabsBar>['$props']

function mountBar(overrides: Partial<BarProps> = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const events = {
    tabClick: vi.fn(),
    tabMenu: vi.fn(),
    dragStart: vi.fn(),
    drop: vi.fn(),
    renameEnd: vi.fn(),
  }
  const renameSheet = vi.fn((_from: string, to: string) => to !== 'Taken')
  const props = reactive({
    readOnly: false,
    sheetNames: ['Sheet1', 'Sheet2', 'Pivot1'],
    currentSheet: 'Sheet1',
    isPivotSheet: (name: string) => name === 'Pivot1',
    tabDragOver: null,
    tabDragName: null,
    peersBySubSheet: new Map(),
    selectionStats: null,
    renameSheet,
    ...overrides,
  })
  const bar = ref<InstanceType<typeof SheetTabsBar> | null>(null)
  const app = createApp({
    setup: () => () =>
      h(SheetTabsBar, {
        ...props,
        ref: bar,
        onTabClick: events.tabClick,
        onTabMenu: events.tabMenu,
        onDragStart: events.dragStart,
        onTabDrop: events.drop,
        onRenameEnd: events.renameEnd,
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, props, events, renameSheet, bar }
}

const tab = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) =>
    t.textContent?.includes(name),
  )!

const field = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.sn-tab-name-field')

const dblclick = async (el: HTMLElement) => {
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await settle()
}

const press = async (el: HTMLElement, key: string) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  await settle()
}

const type = async (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('SheetTabsBar', () => {
  it("uses Writer's small ghost tab list, with the current sheet selected", async () => {
    const { root } = mountBar()
    await settle()
    const list = root.querySelector('[data-slot="tab-list"]')!
    expect(list.getAttribute('data-variant')).toBe('ghost')
    expect(list.getAttribute('data-size')).toBe('sm')
    expect(root.querySelectorAll('[role="tab"]').length).toBe(3)
    expect(tab(root, 'Sheet1').getAttribute('aria-selected')).toBe('true')
    expect(tab(root, 'Sheet2').getAttribute('aria-selected')).toBe('false')
  })

  it('has no chevron on a tab', async () => {
    const { root } = mountBar()
    await settle()
    expect(root.querySelector('[aria-label$="options"]')).toBeNull()
  })

  // switchSheet clears the grid, so it must wait for the blur that commits an
  // open cell edit: that comes after mousedown and before click.
  it('switches sheet on click, not on mousedown', async () => {
    const { root, events } = mountBar()
    await settle()
    tab(root, 'Sheet2').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await settle()
    expect(events.tabClick).not.toHaveBeenCalled()
    tab(root, 'Sheet2').click()
    expect(events.tabClick).toHaveBeenCalledWith('Sheet2')
  })

  it('opens the tab menu on right-click', async () => {
    const { root, events } = mountBar()
    await settle()
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    tab(root, 'Sheet2').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(events.tabMenu).toHaveBeenCalledWith(expect.any(MouseEvent), 'Sheet2')
  })

  it('renames in place on double-click, and Enter commits the trimmed name', async () => {
    const { root, renameSheet, events } = mountBar()
    await settle()
    expect(field(root)).toBeNull()
    await dblclick(tab(root, 'Sheet2'))
    const input = field(root)!
    expect(input.value).toBe('Sheet2')
    await type(input, '  Sales ')
    await press(input, 'Enter')
    expect(renameSheet).toHaveBeenCalledWith('Sheet2', 'Sales')
    expect(field(root)).toBeNull()
    expect(events.renameEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps the field open on a name that is taken', async () => {
    const { root } = mountBar()
    await settle()
    await dblclick(tab(root, 'Sheet2'))
    const input = field(root)!
    await type(input, 'Taken')
    await press(input, 'Enter')
    expect(field(root)).not.toBeNull()
    expect(field(root)!.getAttribute('aria-invalid')).toBe('true')
  })

  it('cancels on Escape and on an empty name', async () => {
    const { root, renameSheet } = mountBar()
    await settle()
    await dblclick(tab(root, 'Sheet2'))
    await press(field(root)!, 'Escape')
    expect(field(root)).toBeNull()

    await dblclick(tab(root, 'Sheet2'))
    await type(field(root)!, '   ')
    await press(field(root)!, 'Enter')
    expect(field(root)).toBeNull()
    expect(renameSheet).not.toHaveBeenCalled()
  })

  it('commits when the user clicks away, without taking focus back', async () => {
    const { root, renameSheet, events } = mountBar()
    await settle()
    await dblclick(tab(root, 'Sheet2'))
    await type(field(root)!, 'Sales')
    document.body.click()
    await settle()
    expect(renameSheet).toHaveBeenCalledWith('Sheet2', 'Sales')
    expect(field(root)).toBeNull()
    expect(events.renameEnd).not.toHaveBeenCalled()
  })

  it('starts the same rename when the tab menu asks for it', async () => {
    const { root, bar } = mountBar()
    await settle()
    bar.value?.startRenaming('Sheet2')
    await settle()
    expect(field(root)!.value).toBe('Sheet2')
  })

  it('does not rename or drag for a viewer', async () => {
    const { root } = mountBar({ readOnly: true })
    await settle()
    await dblclick(tab(root, 'Sheet2'))
    expect(field(root)).toBeNull()
    expect(root.querySelector('[draggable="true"]')).toBeNull()
  })

  it('reports a drag and a drop on the tab', async () => {
    const { root, events } = mountBar()
    await settle()
    const cell = tab(root, 'Sheet2').closest<HTMLElement>('[draggable="true"]')!
    cell.dispatchEvent(new Event('dragstart', { bubbles: true }))
    cell.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    expect(events.dragStart).toHaveBeenCalledWith(expect.anything(), 'Sheet2')
    expect(events.drop).toHaveBeenCalledWith(expect.anything(), 'Sheet2')
  })

  it('sends a drop in the gap between tabs to the tab the mark is on, once', async () => {
    const { root, events } = mountBar({ tabDragOver: 'Sheet2', tabDragName: 'Pivot1' })
    await settle()
    root
      .querySelector('.sn-tabs-track')!
      .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    expect(events.drop).toHaveBeenCalledTimes(1)
    expect(events.drop).toHaveBeenCalledWith(expect.anything(), 'Sheet2')

    tab(root, 'Sheet1')
      .closest('[draggable="true"]')!
      .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    expect(events.drop).toHaveBeenCalledTimes(2)
    expect(events.drop).toHaveBeenLastCalledWith(expect.anything(), 'Sheet1')
  })

  it('shows peer dots inside the tab, and an icon on a pivot sheet', async () => {
    const peers = new Map([['Sheet2', [{ user: 'a', full_name: 'A', colour: PALETTE[0] }]]])
    const { root } = mountBar({ peersBySubSheet: peers })
    await settle()
    expect(tab(root, 'Sheet2').querySelector('.sn-tab-peer-dot')).not.toBeNull()
    expect(tab(root, 'Pivot1').querySelector('svg, [class*="lucide"]')).not.toBeNull()
    expect(tab(root, 'Sheet1').querySelector('svg, [class*="lucide"]')).toBeNull()
  })

  it('keeps Count, Sum and Avg', async () => {
    const { root } = mountBar({ selectionStats: { count: 2, sum: 3, avg: 1.5 } })
    await settle()
    expect(root.querySelector('.sn-stats')?.textContent).toMatch(/Count: 2.*Sum: 3.*Avg: 1\.5/)
  })
})
