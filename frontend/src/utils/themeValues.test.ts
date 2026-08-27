import { describe, expect, it } from 'vitest'
import { nextTheme, normalizeTheme } from './themeValues'

describe('theme values', () => {
	it('normalizes server and client values to one vocabulary', () => {
		expect(normalizeTheme('Automatic')).toBe('automatic')
		expect(normalizeTheme('Dark')).toBe('dark')
		expect(normalizeTheme('invalid')).toBe('light')
	})

	it('cycles automatic, light, and dark', () => {
		expect(nextTheme('automatic')).toBe('light')
		expect(nextTheme('light')).toBe('dark')
		expect(nextTheme('dark')).toBe('automatic')
	})
})
