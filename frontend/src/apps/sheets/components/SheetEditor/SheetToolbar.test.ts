import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, isRef, nextTick, ref } from 'vue'

import SheetToolbar from './SheetToolbar.vue'

// The real frappe-ui pieces the row is built from.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/TextInput')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Tooltip')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Popover')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/ItemListRow')),
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
    onAdjustFontSize: vi.fn(),
    onSetFontSize: vi.fn(),
    onInsertLink: vi.fn(),
    onInsertChart: vi.fn(),
  }
  const clearFormatting = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(SheetToolbar, {
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
        fontFamilyDropdownOptions: [
          { label: 'Inter', onClick: vi.fn() },
          { label: 'Georgia', onClick: vi.fn() },
        ],
        fontFamilyLabel: 'Inter',
        ...handlers,
        // A ref prop stays live, so a test can change it after mounting.
        ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k, isRef(v) ? v.value : v])),
      }),
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
  it('holds only the tools, undo first', () => {
    const { root } = mountRow()
    expect(named(root)).toEqual([
      'Undo',
      'Redo',
      'Format painter',
      'Number format: General',
      'Currency: ₹',
      'Percent',
      'Fewer decimal places',
      'More decimal places',
      'Font: Inter',
      'Decrease font size',
      'Font size',
      'Increase font size',
      'Bold',
      'Italic',
      'Strikethrough',
      'Text colour',
      'Fill colour',
      'Borders',
      'Merge cells',
      'Alignment',
      'Text wrapping',
      'Link',
      'Chart',
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

  it('steps the font size by 1 with − and +, and stops at 8 and 72', () => {
    const { root, handlers } = mountRow({ activeFormat: { fontSize: 13 } })
    button(root, 'Decrease font size').click()
    button(root, 'Increase font size').click()
    expect(handlers.onAdjustFontSize.mock.calls).toEqual([[-1], [1]])
    cleanup?.()
    const low = mountRow({ activeFormat: { fontSize: 8 } })
    expect(button(low.root, 'Decrease font size').disabled).toBe(true)
    expect(button(low.root, 'Increase font size').disabled).toBe(false)
    cleanup?.()
    const high = mountRow({ activeFormat: { fontSize: 72 } })
    expect(button(high.root, 'Increase font size').disabled).toBe(true)
  })

  it('lists common font sizes when the size field is clicked, and keeps the caret there', async () => {
    const { root, handlers } = mountRow({ activeFormat: { fontSize: 14 } })
    const field = root.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!
    field.focus()
    field.click()
    await settle()
    const sizes = [...document.querySelectorAll<HTMLButtonElement>('.sn-font-sizes button')]
    expect(sizes.map((o) => o.textContent?.trim())).toEqual([
      '8',
      '9',
      '10',
      '11',
      '12',
      '14',
      '18',
      '24',
      '36',
    ])
    expect(sizes.find((o) => o.getAttribute('aria-current') === 'true')?.textContent?.trim()).toBe(
      '14',
    )
    expect(document.activeElement).toBe(field)
    sizes.find((o) => o.textContent?.trim() === '18')!.click()
    await settle()
    expect(handlers.onSetFontSize.mock.calls).toEqual([[18]])
    expect(document.querySelector('.sn-font-sizes')).toBeNull()
  })

  it('applies a typed size once, clamped, and drops it when a listed size is picked', async () => {
    const { root, handlers } = mountRow({ activeFormat: { fontSize: 13 } })
    const field = root.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!
    const type = (text: string) => {
      field.value = text
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // Enter blurs the field, and the blur's change applies the size.
    field.focus()
    type('100')
    field.dispatchEvent(new Event('change', { bubbles: true }))
    expect(handlers.onSetFontSize.mock.calls).toEqual([[72]])
    // A change with nothing typed applies nothing.
    field.dispatchEvent(new Event('change', { bubbles: true }))
    expect(handlers.onSetFontSize).toHaveBeenCalledOnce()

    handlers.onSetFontSize.mockClear()
    field.click()
    await settle()
    type('2')
    const size24 = [...document.querySelectorAll<HTMLButtonElement>('.sn-font-sizes button')].find(
      (o) => o.textContent?.trim() === '24',
    )!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    size24.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    size24.click()
    field.dispatchEvent(new Event('change', { bubbles: true }))
    expect(handlers.onSetFontSize.mock.calls).toEqual([[24]])
  })

  it('shows the size of the next selection after an edit that changed nothing', async () => {
    const activeFormat = ref({ fontSize: 13 })
    const { root } = mountRow({ activeFormat })
    const field = root.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!
    // Typed back to the size it had: the browser sends no change on blur.
    field.focus()
    field.value = '13'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('blur'))
    activeFormat.value = { fontSize: 24 }
    await settle()
    expect(field.value).toBe('24')
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

  it('makes the tools inert for viewers', () => {
    const { root } = mountRow({ readOnly: true })
    expect(button(root, 'Bold').closest('.sn-tools--readonly')).not.toBeNull()
  })

  it('draws the font size with no box at rest', () => {
    const { root } = mountRow()
    const field = root.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!
    expect(field.className).toContain('bg-transparent')
    expect(field.className).toContain('border-0')
    expect(field.className).not.toContain('border-outline-gray-2')
  })

  it('shows the Comment tool only where the surface has comments', () => {
    const openComments = vi.fn()
    const { root } = mountRow({ openComments })
    button(root, 'Comment').click()
    expect(openComments).toHaveBeenCalledOnce()
    cleanup?.()
    expect(button(mountRow().root, 'Comment')).toBeNull()
  })

  it('keeps Comment usable for a viewer, whose Link and Chart are off', () => {
    const { root } = mountRow({ readOnly: true, openComments: vi.fn() })
    expect(button(root, 'Comment').disabled).toBe(false)
    expect(button(root, 'Comment').closest('.sn-tools--readonly')).toBeNull()
    expect(button(root, 'Link').disabled).toBe(true)
    expect(button(root, 'Chart').disabled).toBe(true)
  })

  it('runs the same Link and Chart actions as the Insert menu', () => {
    const { root, handlers } = mountRow()
    button(root, 'Link').click()
    button(root, 'Chart').click()
    expect(handlers.onInsertLink).toHaveBeenCalledOnce()
    expect(handlers.onInsertChart).toHaveBeenCalledOnce()
  })

  it('lists the fonts from the Font tool', async () => {
    const { root } = mountRow()
    const font = button(root, 'Font: Inter')
    expect(font.textContent).toContain('Georgia') // the hidden name that sets its width
    font.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(items).toEqual(['Inter', 'Georgia'])
  })

  it.each([
    'Number format: General',
    'Currency: ₹',
    'Font: Inter',
    'Text colour',
    'Fill colour',
    'Borders',
    'Alignment',
    'Text wrapping',
  ])('puts a chevron on %s, which opens a menu', (label) => {
    const { root } = mountRow()
    expect(button(root, label).querySelector('.lucide-chevron-down')).not.toBeNull()
  })

  it('marks the Format button as the one for narrow screens', () => {
    const { root } = mountRow()
    const format = [...root.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Format',
    )!
    expect(format.closest('.sn-format-group')).not.toBeNull()
  })
})

describe('SheetToolbar spacing', () => {
  const css = readFileSync(resolve(__dirname, 'SheetToolbar.vue'), 'utf8')
  const rule = (selector: string) => {
    const at = css.indexOf(`
${selector} {`)
    expect(at, selector).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('is a 36px row of tools 2px apart, as in Writer', () => {
    expect(rule('.sn-toolbar')).toContain('height: 36px')
    expect(rule('.sn-toolbar')).toContain('gap: 2px')
    expect(rule('.sn-tools-scroll')).toContain('gap: 2px')
  })

  it('draws Writer’s divider', () => {
    expect(rule('.sn-vr')).toContain('height: 20px')
    expect(rule('.sn-vr')).toContain('margin: 0 4px')
    expect(rule('.sn-vr')).toContain('background: var(--surface-gray-3)')
  })

  it('keeps the sideways scroll on a narrow bar', () => {
    expect(rule('.sn-tools-scroll')).toContain('overflow-x: auto')
  })

  it('starts Undo 12px in, where Writer’s toolbar starts it', () => {
    expect(rule('.sn-toolbar')).toContain('padding: 0 12px')
    expect(rule('.sn-toolbar')).not.toContain('9px')
  })

  it('draws the tool icons in Writer’s toolbar ink', () => {
    expect(rule('.sn-toolbar :deep(button:not(.bg-surface-gray-10))')).toContain(
      'color: var(--ink-gray-7)',
    )
    expect(rule('.sn-swatch-btn')).toContain('color: var(--ink-gray-7)')
    expect(rule('.sn-toolbar :deep(button:disabled)')).toContain('opacity: 0.4')
  })
})

describe('SheetToolbar text colour', () => {
  // With no colour set, the swatch under the "T" shows the ink a cell gets
  // by default (canvas/constants.ts COLORS.cellText).
  it('shows the default cell ink when the cell has no text colour', () => {
    const sfc = readFileSync(resolve(__dirname, 'SheetToolbar.vue'), 'utf8')
    expect(sfc).toContain("activeFormat.color || 'var(--ink-gray-7)'")
  })
})
