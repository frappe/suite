import { describe, expect, it } from 'vitest'
import { slugify } from './slugify'

describe('slugify', () => {
  it('keeps letters and numbers from every script', () => {
    expect(slugify('  Résumé / वित्त 2026! ')).toBe('résumé-वित्त-2026')
  })

  it('omits unreadable titles and caps by Unicode characters', () => {
    expect(slugify('🙌 !!!')).toBe('')
    expect(Array.from(slugify(`文${'a'.repeat(100)}`))).toHaveLength(80)
  })
})

