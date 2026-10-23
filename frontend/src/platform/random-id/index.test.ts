import { afterEach, describe, expect, it, vi } from 'vitest'

import { randomId } from '.'

afterEach(() => vi.unstubAllGlobals())

describe('randomId', () => {
  it('works over plain HTTP, where the browser has no crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(171),
    })
    expect(randomId()).toBe('ab'.repeat(16))
  })

  it('gives a different id each time', () => {
    expect(randomId()).not.toBe(randomId())
  })
})
