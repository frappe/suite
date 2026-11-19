import { expect, it } from 'vitest'

import { textInk } from './appearance'

it.each(['#e6f4ff', '#e4faeb', '#ffe7e7', '#fff', '#888'])(
  'keeps default text dark on a pale authored background %s',
  (background) => {
    expect(textInk(undefined, background)).toBe('#171717')
  },
)

it.each(['#000', '#171717', '#333', '#777'])(
  'uses white default text on a dark authored background %s',
  (background) => {
    expect(textInk(undefined, background)).toBe('#ffffff')
  },
)

it.each([undefined, 'none', 'transparent', '#ffffff80', 'rgba(255,255,255,0.5)'])(
  'follows the canvas theme without an opaque hex background %s',
  (background) => {
    expect(textInk(undefined, background)).toBe('var(--draw-ink, var(--ink-gray-9))')
  },
)

it.each(['#171717', '#ffffff', '#0070cc', 'transparent'])(
  'preserves explicitly chosen ink %s on both light and dark backgrounds',
  (ink) => {
    expect(textInk(ink, '#ffffff')).toBe(ink)
    expect(textInk(ink, '#171717')).toBe(ink)
  },
)

it.each(['#e6f4ff', '#e4faeb', '#ffe7e7'])(
  'adapts default text with its recognised pastel background %s in dark mode',
  (background) => {
    expect(textInk(undefined, background, true)).toBe('var(--surface-gray-10)')
  },
)

it('keeps default contrast ink literal when a custom background is not adapted', () => {
  expect(textInk(undefined, '#123456', true)).toBe('#ffffff')
  expect(textInk(undefined, '#abcdef', true)).toBe('#171717')
})

it('adapts explicitly chosen palette ink while retaining custom ink', () => {
  expect(textInk('#171717', '#e6f4ff', true)).toBe('var(--surface-gray-10)')
  expect(textInk('#123456', '#e6f4ff', true)).toBe('#123456')
})
