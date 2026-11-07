import { describe, expect, it, vi } from 'vitest'

import { editedDetails, editedLabel } from './editedLabel'

vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => 'UTC' }))

const now = new Date('2026-11-05T12:00:00Z')
const before = (ms: number) => new Date(now.getTime() - ms)

describe('editedDetails', () => {
  const edited = new Date('2026-11-05T09:30:00Z')
  const created = new Date('2026-03-02T16:05:00Z')

  it('gives the exact time edited, then when and by whom it was created', () => {
    const [editedLine, createdLine] = editedDetails(edited, created, 'Asha Rao')

    expect(editedLine).toMatch(/^Edited .*2026.*9:30/)
    expect(createdLine).toMatch(/^Created .*2026.*4:05.* by Asha Rao$/)
  })

  it('leaves out what it does not know', () => {
    expect(editedDetails(edited, null, null)).toHaveLength(1)
    expect(editedDetails(edited, created, null)[1]).toMatch(/^Created .*4:05[^y]*$/)
  })
})

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
