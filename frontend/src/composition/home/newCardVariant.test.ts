import { describe, expect, it } from 'vitest'

import { variantOf } from '@/composition/home/newCardVariant'

describe('variantOf', () => {
  it.each([
    [{ a: true, b: true, c: true }, 'a'],
    [{ a: true, b: false, c: true }, 'a'],
    [{ a: false, b: true, c: true }, 'b'],
    [{ a: false, b: true, c: false }, 'b'],
    [{ a: false, b: false, c: true }, 'c'],
    [{ a: false, b: false, c: false }, 'current'],
  ] as const)('picks %o as %s', (flags, expected) => {
    expect(variantOf(flags)).toBe(expected)
  })
})
