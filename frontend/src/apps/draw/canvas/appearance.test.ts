import { expect, it } from 'vitest'

import { contrastingInk, textInk } from './appearance'
import { paletteColor } from './palette'

it.each(['#fff', '#ffffff', '#FFFFFF'])(
  'keeps explicit white %s visible as a stroke or text on dark paper',
  (white) => {
    expect(paletteColor(white, true)).toBe(white)
    expect(textInk(white, undefined, true)).toBe(white)
    expect(paletteColor(white, true, 'fill')).toBe('var(--surface-base)')
    expect(paletteColor(white, false, 'fill')).toBe(white)
  },
)

it('uses light ink for labels and shortcuts on the rendered dark red swatch', () => {
  const theme = document.documentElement.style
  theme.setProperty('--surface-red-6', '#a82c2b')
  theme.setProperty('--ink-base', '#171717')
  theme.setProperty('--ink-gray-9', '#f8f8f8')
  try {
    expect(textInk(undefined, '#e03636')).toBe('#000000')
    expect(textInk(undefined, '#e03636', true)).toBe('var(--ink-gray-9)')
    expect(contrastingInk('var(--surface-red-6)', true)).toBe('var(--ink-gray-9)')
  } finally {
    theme.removeProperty('--surface-red-6')
    theme.removeProperty('--ink-base')
    theme.removeProperty('--ink-gray-9')
  }
})

it('keeps automatic ink readable on unchanged custom fills in dark mode', () => {
  expect(textInk(undefined, '#123456', true)).toBe('#ffffff')
  expect(textInk(undefined, '#abcdef', true)).toBe('#171717')
  expect(textInk(undefined, 'transparent', true)).toBe('var(--draw-ink, var(--ink-gray-9))')
})
