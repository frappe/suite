import { describe, expect, it } from 'vitest'

import { groupSheetsByRecency, parseFrappeDatetime, recencyBucket } from './recency-groups.js'

// Fixed reference point: a Wednesday mid-afternoon.
const NOW = new Date('2026-07-22T15:00:00')

describe('parseFrappeDatetime', () => {
  it('parses Frappe datetimes with microseconds', () => {
    const d = parseFrappeDatetime('2026-07-22 10:11:12.123456')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(22)
    expect(d.getHours()).toBe(10)
    expect(d.getSeconds()).toBe(12)
  })

  it('parses datetimes without microseconds', () => {
    expect(parseFrappeDatetime('2026-07-22 10:11:12').getTime()).not.toBeNaN()
  })
})

describe('recencyBucket', () => {
  it('buckets by calendar day and rolling windows', () => {
    expect(recencyBucket('2026-07-22 00:00:01', NOW)).toBe('Today')
    expect(recencyBucket('2026-07-21 23:59:59', NOW)).toBe('Previous 7 days')
    expect(recencyBucket('2026-07-15 00:00:00', NOW)).toBe('Previous 7 days')
    expect(recencyBucket('2026-07-14 23:59:59', NOW)).toBe('Previous 30 days')
    expect(recencyBucket('2026-06-22 00:00:00', NOW)).toBe('Previous 30 days')
    expect(recencyBucket('2026-06-21 23:59:59', NOW)).toBe('Earlier')
    expect(recencyBucket('2026-06-07 12:00:00', NOW)).toBe('Earlier')
  })

  it('folds future timestamps (clock skew) into Today', () => {
    expect(recencyBucket('2026-07-23 09:00:00', NOW)).toBe('Today')
  })
})

describe('groupSheetsByRecency', () => {
  const row = (name, modified) => ({ name, modified })

  it('emits groups in fixed order, omitting empty buckets', () => {
    const rows = [
      row('a', '2026-07-22 09:00:00'), // Today
      row('b', '2026-05-01 09:00:00'), // Earlier
      row('c', '2026-07-20 09:00:00'), // Previous 7 days
    ]
    const groups = groupSheetsByRecency(rows, NOW)
    expect(groups.map((g) => g.group)).toEqual(['Today', 'Previous 7 days', 'Earlier'])
  })

  it('preserves row order within a bucket and matches the ListView shape', () => {
    const rows = [row('a', '2026-07-22 12:00:00'), row('b', '2026-07-22 09:00:00')]
    const groups = groupSheetsByRecency(rows, NOW)
    expect(groups).toHaveLength(1)
    for (const g of groups) {
      // ListView only renders grouped mode when EVERY row is {group, rows: []}.
      expect(typeof g.group).toBe('string')
      expect(Array.isArray(g.rows)).toBe(true)
    }
    expect(groups[0].rows.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('carries collapsed state forward from prevGroups by label', () => {
    const rows = [
      row('a', '2026-07-22 09:00:00'), // Today
      row('b', '2026-07-20 09:00:00'), // Previous 7 days
    ]
    const prev = [{ group: 'Previous 7 days', collapsed: true, rows: [] }]
    const groups = groupSheetsByRecency(rows, NOW, prev)
    expect(groups.find((g) => g.group === 'Today').collapsed).toBe(false)
    expect(groups.find((g) => g.group === 'Previous 7 days').collapsed).toBe(true)
  })

  it('returns an empty array for no rows', () => {
    expect(groupSheetsByRecency([], NOW)).toEqual([])
  })
})
