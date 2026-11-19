import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import ShapeColorPicker from './ShapeColorPicker.vue'

const colorScheme = ref<'light' | 'dark'>('light')

vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/platform/theme', () => ({ useTheme: () => ({ resolvedMode: colorScheme }) }))
vi.mock('frappe-ui', () => {
  const control = (tag: string) =>
    defineComponent({
      setup(_props, { attrs, slots }) {
        return () => h(tag, attrs, [slots.trigger?.(), slots.default?.()])
      },
    })
  return {
    Button: control('button'),
    Popover: control('div'),
    TextInput: control('input'),
  }
})

let cleanup: () => void

afterEach(() => {
  cleanup?.()
  colorScheme.value = 'light'
  delete document.documentElement.dataset.theme
})

function mountPicker() {
  const host = document.createElement('div')
  document.body.append(host)
  const color = ref<string | undefined>('#f3f3f3')
  const select = vi.fn((value: string | undefined, target?: string) => {
    if (target === 'fill') color.value = value
  })
  const app = createApp({
    setup: () => () =>
      h(ShapeColorPicker, {
        color: color.value,
        secondaryColor: '#383838',
        target: 'fill',
        mode: 'property-object',
        label: 'Shape colors',
        onSelect: select,
      }),
  })
  app.mount(host)
  cleanup = () => {
    app.unmount()
    host.remove()
  }
  return { host, select }
}

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number)
  const linear = channels.map((value) =>
    value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4,
  )
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

it('keeps palette shortcut labels readable on the light palette', () => {
  const { host } = mountPicker()
  const swatches = host.querySelectorAll<HTMLButtonElement>(
    '.color-grid button[style], .color-row button[style]',
  )
  expect(swatches.length).toBeGreaterThan(20)
  for (const swatch of swatches) {
    const background = luminance(swatch.style.backgroundColor)
    const foreground = luminance(swatch.style.color)
    const contrast =
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
    expect(contrast, swatch.getAttribute('aria-label')!).toBeGreaterThanOrEqual(4.5)
  }
})

it('announces selected colors and retains the authored color when the theme changes', async () => {
  const { host, select } = mountPicker()
  const gray = host.querySelector<HTMLButtonElement>('[aria-label^="Gray fill color"]')!
  const blue = host.querySelector<HTMLButtonElement>('[aria-label^="Blue fill color"]')!
  expect(gray.getAttribute('aria-pressed')).toBe('true')
  expect(blue.getAttribute('aria-pressed')).toBe('false')
  blue.click()
  await nextTick()
  expect(select).toHaveBeenLastCalledWith('#e6f4ff', 'fill')
  expect(blue.getAttribute('aria-pressed')).toBe('true')
  expect(gray.getAttribute('aria-pressed')).toBe('false')
  colorScheme.value = 'dark'
  await nextTick()
  expect(blue.style.backgroundColor).toBe('var(--surface-blue-2)')
  expect(blue.style.color).toBe('var(--ink-gray-9)')
  expect(blue.getAttribute('aria-pressed')).toBe('true')
  expect(select).toHaveBeenCalledOnce()
  colorScheme.value = 'light'
  await nextTick()
  expect(blue.style.backgroundColor).toBe('rgb(230, 244, 255)')
  expect(select).toHaveBeenCalledOnce()
})
