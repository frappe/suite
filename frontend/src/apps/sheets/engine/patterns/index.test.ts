import { describe, expect, it } from 'vitest'

import { detectSeries } from './index.js'
import { timeDetector } from './time.js'

// ISSUES #24: an empty source used to come back as a "time" series whose
// next() threw.
describe('detectSeries with no source cells', () => {
  it('finds no series', () => {
    expect(detectSeries([])).toBeNull()
  })

  it('the time detector alone finds none either', () => {
    expect(timeDetector.detect([])).toBeNull()
  })

  it('still continues a time series', () => {
    const series = detectSeries(['9:00', '9:30'])
    expect(series?.kind).toBe('time')
    expect(series?.next(1, 1)).toBe('10:00')
  })
})
