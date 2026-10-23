import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dateGroup, dateGroupLabel } from './dateGroups'

// A Wednesday. Weeks start on Sunday, so this week began on 11 October.
const WEDNESDAY = '2026-10-14T12:00:00'

describe('dateGroup', () => {
  it('groups this week by day, the three weeks before by week, then by month', () => {
    expect(dateGroup('2026-10-14T08:00:00', WEDNESDAY)).toBe('day:2026-10-14')
    expect(dateGroup('2026-10-13T23:30:00', WEDNESDAY)).toBe('day:2026-10-13')
    expect(dateGroup('2026-10-12T09:00:00', WEDNESDAY)).toBe('day:2026-10-12')
    expect(dateGroup('2026-10-11T00:00:00', WEDNESDAY)).toBe('day:2026-10-11')
    expect(dateGroup('2026-10-10T22:00:00', WEDNESDAY)).toBe('week:2026-10-04')
    expect(dateGroup('2026-10-04T00:00:00', WEDNESDAY)).toBe('week:2026-10-04')
    expect(dateGroup('2026-10-03T18:00:00', WEDNESDAY)).toBe('week:2026-09-27')
    expect(dateGroup('2026-09-27T00:00:00', WEDNESDAY)).toBe('week:2026-09-27')
    expect(dateGroup('2026-09-26T10:00:00', WEDNESDAY)).toBe('week:2026-09-20')
    expect(dateGroup('2026-09-20T00:00:00', WEDNESDAY)).toBe('week:2026-09-20')
    expect(dateGroup('2026-09-19T23:59:00', WEDNESDAY)).toBe('2026-09')
    expect(dateGroup('2026-08-31T10:00:00', WEDNESDAY)).toBe('2026-08')
    expect(dateGroup('2025-12-25T10:00:00', WEDNESDAY)).toBe('2025-12')
  })

  it('runs the days and weeks back into last month early in this one', () => {
    const friday = '2026-10-02T12:00:00'
    expect(dateGroup('2026-10-01T10:00:00', friday)).toBe('day:2026-10-01')
    expect(dateGroup('2026-09-30T10:00:00', friday)).toBe('day:2026-09-30')
    expect(dateGroup('2026-09-26T10:00:00', friday)).toBe('week:2026-09-20')
    expect(dateGroup('2026-09-06T10:00:00', friday)).toBe('week:2026-09-06')
    expect(dateGroup('2026-09-05T10:00:00', friday)).toBe('2026-09')
  })

  it('keeps yesterday a day of its own on a Sunday, when this week began today', () => {
    const sunday = '2026-10-11T12:00:00'
    expect(dateGroup('2026-10-10T10:00:00', sunday)).toBe('day:2026-10-10')
    expect(dateGroup('2026-10-09T10:00:00', sunday)).toBe('week:2026-10-04')
  })

  it('keeps a group its key across midnight', () => {
    expect(dateGroup('2026-10-14T08:00:00', '2026-10-15T00:30:00')).toBe(
      dateGroup('2026-10-14T08:00:00', WEDNESDAY),
    )
  })

  it('has no other days this week on a Monday, yesterday being all of it', () => {
    const monday = '2026-10-12T12:00:00'
    expect(dateGroup('2026-10-11T10:00:00', monday)).toBe('day:2026-10-11')
    expect(dateGroup('2026-10-10T10:00:00', monday)).toBe('week:2026-10-04')
  })

  it('meets each group once in a list sorted newest first', () => {
    for (const now of [
      WEDNESDAY,
      '2026-10-12T12:00:00',
      '2026-10-11T12:00:00',
      '2026-10-02T12:00:00',
      '2026-03-01T12:00:00',
    ]) {
      const keys = Array.from({ length: 120 }, (_, back) => {
        const day = new Date(now)
        day.setDate(day.getDate() - back)
        return dateGroup(day, now)
      })
      const runs = keys.filter((key, i) => key !== keys[i - 1])
      expect(new Set(runs).size).toBe(runs.length)
    }
  })
})

describe('dateGroupLabel', () => {
  beforeEach(() => {
    vi.stubGlobal('__', (text: string, args: string[] = []) =>
      text.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? ''),
    )
  })

  it('reads this week by day', () => {
    expect(dateGroupLabel('day:2026-10-14', WEDNESDAY)).toBe('Today')
    expect(dateGroupLabel('day:2026-10-13', WEDNESDAY)).toBe('Yesterday')
    expect(dateGroupLabel('day:2026-10-12', WEDNESDAY)).toBe('Monday')
    expect(dateGroupLabel('day:2026-10-11', WEDNESDAY)).toBe('Sunday')
  })

  it('reads the weeks before by how long ago they were', () => {
    expect(dateGroupLabel('week:2026-10-04', WEDNESDAY)).toBe('Last week')
    expect(dateGroupLabel('week:2026-09-27', WEDNESDAY)).toBe('2 weeks ago')
    expect(dateGroupLabel('week:2026-09-20', WEDNESDAY)).toBe('3 weeks ago')
  })

  it('moves a header on with the clock, today becoming yesterday', () => {
    expect(dateGroupLabel('day:2026-10-14', '2026-10-15T00:30:00')).toBe('Yesterday')
  })

  it('reads a whole month by name, with the year once it is not this one', () => {
    expect(dateGroupLabel('2026-08', WEDNESDAY)).toBe('August')
    expect(dateGroupLabel('2025-12', WEDNESDAY)).toBe('December 2025')
  })

  it('reads the month the weeks end in as what is left of it', () => {
    // The weeks end on 20 September.
    expect(dateGroupLabel('2026-09', WEDNESDAY)).toBe('Earlier in September')
    // On the 31st they end on 4 October.
    expect(dateGroupLabel('2026-10', '2026-10-31T12:00:00')).toBe('Earlier this month')
    // Early in January, in December.
    expect(dateGroupLabel('2025-12', '2026-01-02T12:00:00')).toBe('Earlier in December 2025')
  })

  it('reads a month the weeks end at the very start of as whole', () => {
    // A Saturday the 28th: this week began on the 22nd and the weeks end on 1 November, so they
    // hold all of November and none of October.
    expect(dateGroupLabel('2026-10', '2026-11-28T12:00:00')).toBe('October')
  })
})
