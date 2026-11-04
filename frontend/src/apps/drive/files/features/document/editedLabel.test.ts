import { describe, expect, it, vi } from 'vitest'

import { editedLabel } from './editedLabel'

vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => 'UTC' }))

const now = new Date('2026-11-05T12:00:00Z')
const before = (ms: number) => new Date(now.getTime() - ms)

describe('editedLabel', () => {
  it.each([
    [20_000, 'Edited just now'],
    [5 * 60_000, 'Edited 5m ago'],
    [60 * 60_000, 'Edited 1h ago'],
    [3 * 24 * 60 * 60_000, 'Edited 3d ago'],
  ])('reads %i ms back as %s', (elapsed, label) => {
    expect(editedLabel(before(elapsed), now)).toBe(label)
  })

  it('names the date once it is over a month back', () => {
    expect(editedLabel(before(40 * 24 * 60 * 60_000), now)).toContain('2026')
  })
})
