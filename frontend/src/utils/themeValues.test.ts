import { describe, expect, it } from 'vitest'
import { nextTheme, normalizeTheme, themeActionLabel } from './themeValues'

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

  it('describes automatic mode as the system theme', () => {
    expect(themeActionLabel('automatic')).toBe('Use system theme')
    expect(themeActionLabel('light')).toBe('Switch to light theme')
    expect(themeActionLabel('dark')).toBe('Switch to dark theme')
  })
})
