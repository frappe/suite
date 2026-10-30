import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import SheetToolbar from './SheetToolbar.vue'

// The real frappe-ui pieces the row is built from.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/TextInput')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tooltip')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Popover')),
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

function mountRow(props: Record<string, unknown> = {}) {
  const handlers = {
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSort: vi.fn(),
    onMerge: vi.fn(),
    'onUpdate:showSortFilter': vi.fn(),
    onToggleFormat: vi.fn(),
    onAdjustDecimals: vi.fn(),
    onNumberFormat: vi.fn(),
    onToggleFormatPainter: vi.fn(),
  }
  const clearFormatting = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(
        SheetToolbar,
        {
          readOnly: false,
          activeFormat: {},
          numberFormatDropdownOptions: [{ label: 'Number', onClick: vi.fn() }],
          numberFormatLabel: 'General',
          currencyDropdownOptions: [{ label: 'INR (₹)', onClick: vi.fn() }],
          activeNumberFormatType: '',
          activeCurrencySymbol: '₹',
          alignDropdownOptions: [{ label: 'Left', onClick: vi.fn() }],
          hAlignIcon: 'lucide-align-left',
          canUndo: true,
          canRedo: true,
          isPaintingFormat: false,
          showSortFilter: false,
          textWrapDropdownOptions: [{ label: 'Wrap', onClick: vi.fn() }],
          textWrapIcon: 'lucide-wrap-text',
          borderDropdownOptions: [{ label: 'All borders', onClick: vi.fn() }],
          formatMenuOptions: [{ label: 'Clear formatting', onClick: clearFormatting }],
          ...handlers,
          ...props,
        },
        {
          formula: () => [
            h('input', { 'aria-label': 'Name box' }),
            h('input', { 'aria-label': 'Cell value or formula' }),
          ],
        },
      ),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return { root, handlers, clearFormatting }
}

const named = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('button, input')].map(
    (el) => el.getAttribute('aria-label') || el.textContent?.trim(),
  )
const button = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

describe('SheetToolbar (row 2)', () => {
  it('lays the row out as in B5: undo first, then the formula bar, then the tools', () => {
    const { root } = mountRow()
    expect(named(root)).toEqual([
      'Undo',
      'Redo',
      'Format painter',
      'Name box',
      'Cell value or formula',
      'Number format: General',
      'Currency: ₹',
      'Percent',
      'Fewer decimal places',
      'More decimal places',
      'Font size',
      'Bold',
      'Italic',
      'Strikethrough',
      'Text colour',
      'Fill colour',
      'Borders',
      'Merge cells',
      'Alignment',
      'Text wrapping',
      'Sort',
      'Filter',
      'Format',
    ])
  })

  it('draws every tool with a Lucide icon, never a text glyph', () => {
    const { root } = mountRow()
    // Every button carries a Lucide icon; the number-format menu's "123" and the
    // Format button's word sit beside one (a chevron, the sliders).
    const glyphs = [...root.querySelectorAll('button')].filter(
      (b) => !b.querySelector('svg, [class*="lucide-"]'),
    )
    expect(glyphs.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual([])
    expect(button(root, 'Currency: ₹').innerHTML).toMatch(/indian-rupee|svg/)
  })

  it('keeps every tool in the tab order', () => {
    const { root } = mountRow()
    const skipped = [...root.querySelectorAll<HTMLElement>('button, input')].filter(
      (el) => el.tabIndex < 0,
    )
    expect(skipped).toEqual([])
  })

  it('reports the tools it does not own', () => {
    const { root, handlers } = mountRow()
    button(root, 'Undo').click()
    button(root, 'Sort').click()
    button(root, 'Filter').click()
    button(root, 'Merge cells').click()
    button(root, 'Fewer decimal places').click()
    expect(handlers.onUndo).toHaveBeenCalledOnce()
    expect(handlers.onSort).toHaveBeenCalledOnce()
    expect(handlers['onUpdate:showSortFilter']).toHaveBeenCalledWith(true)
    expect(handlers.onMerge).toHaveBeenCalledOnce()
    expect(handlers.onAdjustDecimals).toHaveBeenCalledWith(-1)
  })

  it('opens the Format menu from the Format button', async () => {
    const { root, clearFormatting } = mountRow()
    const format = [...root.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Format',
    )!
    format.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('Clear formatting'),
    )!
    item.click()
    await settle()
    expect(clearFormatting).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('leaves the formula bar usable for viewers while the tools go inert', () => {
    const { root } = mountRow({ readOnly: true })
    const inert = [...root.querySelectorAll('.sn-tools--readonly')]
    expect(inert.length).toBeGreaterThan(0)
    for (const label of ['Name box', 'Cell value or formula']) {
      const input = root.querySelector(`input[aria-label="${label}"]`)!
      expect(input.closest('.sn-tools--readonly')).toBeNull()
    }
    expect(button(root, 'Bold').closest('.sn-tools--readonly')).not.toBeNull()
  })
})
