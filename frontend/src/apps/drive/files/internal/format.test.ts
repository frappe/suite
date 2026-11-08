import { describe, expect, it } from 'vitest'

import { formatBytes, formatModified } from './format'

describe('byte counts', () => {
  it('counts in 1024s, with one decimal below 100 and none when it is whole', () => {
    expect(
      [0, 1023, 1024, 1126, 150 * 1024, 2.4 * 1024 ** 3, 10 * 1024 ** 3].map((bytes) =>
        formatBytes(bytes, { locale: 'en' }),
      ),
    ).toEqual(['0 B', '1,023 B', '1 KB', '1.1 KB', '150 KB', '2.4 GB', '10 GB'])
  })

  it("uses the reader's decimal separator", () => {
    expect(formatBytes(2.4 * 1024 ** 3, { locale: 'de' })).toBe('2,4 GB')
  })

  it('rounds up for a limit, so a file just over it never reads as the limit', () => {
    expect(formatBytes(1025, { locale: 'en' })).toBe('1 KB')
    expect(formatBytes(1025, { roundUp: true, locale: 'en' })).toBe('1.1 KB')
  })
})

describe('listing dates', () => {
  const now = new Date(2026, 9, 2, 15, 0)
  const at = (...parts: [number, number, number, number, number]) =>
    new Date(...parts).toISOString()

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
