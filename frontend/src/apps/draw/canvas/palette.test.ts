import { expect, it } from 'vitest'

import { paletteColor } from './palette'

it.each([
  ['#e6f4ff', 'var(--surface-blue-2)'],
  ['#a7d7fd', 'var(--surface-blue-4)'],
  ['#0289f7', 'var(--surface-blue-6)'],
  ['#0070cc', 'var(--surface-blue-8)'],
  ['#004880', 'var(--surface-blue-10)'],
  ['#e4faeb', 'var(--surface-green-2)'],
  ['#ffe7e7', 'var(--surface-red-2)'],
  ['#383838', 'var(--surface-gray-9)'],
  ['#171717', 'var(--surface-gray-10)'],
  ['#000', 'var(--surface-gray-10)'],
  ['#000000', 'var(--surface-gray-10)'],
  ['#fff', 'var(--surface-base)'],
  ['#ffffff', 'var(--surface-base)'],
  ['#E6F4FF', 'var(--surface-blue-2)'],
])('adapts the saved palette color %s through its inverse Frappe ramp', (stored, displayed) => {
  expect(paletteColor(stored, true)).toBe(displayed)
  expect(paletteColor(stored, false)).toBe(stored)
})

it.each(['#8db20c', '#9a624a', '#e6577a'])(
  'retains the hue of palette colors without a Frappe ramp (%s)',
  (stored) => {
    expect(paletteColor(stored, true)).toBe(
      `oklch(from ${stored} clamp(0.24, calc(1.18 - l), 0.96) c h)`,
    )
    expect(paletteColor(stored, false)).toBe(stored)
  },
)

it.each([undefined, 'none', 'transparent', '#123456', '#ffffff80', 'rgba(0,0,0,0.5)'])(
  'leaves missing, transparent, and custom colors unchanged (%s)',
  (stored) => {
    expect(paletteColor(stored, true)).toBe(stored)
    expect(paletteColor(stored, false)).toBe(stored)
  },
)
