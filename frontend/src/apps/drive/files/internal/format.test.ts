import { describe, expect, it } from 'vitest'
import { formatModified } from './format'

describe('listing dates', () => {
  const now = new Date(2026, 9, 2, 15, 0)
  const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString()

  it('reads relative while recent', () => {
    expect(formatModified(at(2026, 9, 2, 14, 59), now)).toBe('1 min ago')
    expect(formatModified(new Date(now.getTime() - 10_000).toISOString(), now)).toBe('Just now')
    expect(formatModified(at(2026, 9, 2, 12, 0), now)).toBe('3 hr ago')
    expect(formatModified(at(2026, 9, 1, 23, 0), now)).toBe('Yesterday')
  })

  it('shows the day after that, and the year only when it differs', () => {
    expect(formatModified(at(2026, 8, 28, 10, 0), now)).not.toMatch(/2026/)
    expect(formatModified(at(2025, 8, 28, 10, 0), now)).toMatch(/2025/)
    expect(formatModified(null, now)).toBe('—')
  })
})
