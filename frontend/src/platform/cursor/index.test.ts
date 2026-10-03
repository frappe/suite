import { afterEach, describe, expect, it } from 'vitest'

import { createCursorPreference } from './index'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-cursor')
})

describe('cursor preference', () => {
  it('starts as normal, and a choice applies to the page and survives a reload', () => {
    const first = createCursorPreference()
    expect(first.mode.value).toBe('normal')
    expect(document.documentElement.dataset.cursor).toBe('normal')

    first.set('pointer')
    expect(document.documentElement.dataset.cursor).toBe('pointer')

    document.documentElement.removeAttribute('data-cursor')
    const reloaded = createCursorPreference()
    expect(reloaded.mode.value).toBe('pointer')
    expect(document.documentElement.dataset.cursor).toBe('pointer')
  })

  it('follows a change made in another tab', () => {
    const preference = createCursorPreference()
    window.dispatchEvent(new StorageEvent('storage', { key: 'suite.cursor', newValue: 'pointer' }))
    expect(preference.mode.value).toBe('pointer')
    expect(document.documentElement.dataset.cursor).toBe('pointer')
  })
})
