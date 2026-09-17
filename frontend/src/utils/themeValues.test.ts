import { describe, expect, it } from 'vitest'
import { nextTheme, normalizeTheme } from './themeValues'

describe('theme values', () => {
  it('cycles through automatic, light, and dark modes', () => {
    expect(nextTheme('automatic')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('automatic')
  })

  it('normalizes persisted theme values', () => {
    expect(normalizeTheme('Automatic')).toBe('automatic')
    expect(normalizeTheme('DARK')).toBe('dark')
    expect(normalizeTheme('unknown')).toBe('light')
  })
})
