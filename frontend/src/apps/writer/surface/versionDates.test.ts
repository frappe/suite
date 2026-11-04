import { describe, expect, it } from 'vitest'

import type { DocumentVersion } from '@/apps/drive'

import { dayOrTime, versionDays, versionTitle } from './versionDates'

const NOW = new Date(2026, 9, 15, 18, 0)

function version(seq: number, takenAt: Date, label: string | null = null) {
  return { seq, label, creation: takenAt.toISOString() } as unknown as DocumentVersion
}

function daysOf(versions: DocumentVersion[], now = NOW) {
  return versionDays(versions, now).map((day) => [day.label, day.versions.map(({ seq }) => seq)])
}

describe('version days', () => {
  it('puts versions under Today, Yesterday, then their date, keeping the newest first', () => {
    const versions = [
      version(5, new Date(2026, 9, 15, 14, 14)),
      version(4, new Date(2026, 9, 15, 0, 5)),
      version(3, new Date(2026, 9, 14, 23, 59)),
      version(2, new Date(2026, 9, 12, 9, 0)),
      version(1, new Date(2026, 9, 12, 8, 0)),
    ]

    expect(daysOf(versions)).toEqual([
      ['Today', [5, 4]],
      ['Yesterday', [3]],
      [expect.stringMatching(/^(Oct 12|12 Oct)$/), [2, 1]],
    ])
  })

  it("adds the year to a day that isn't this year's", () => {
    const [[label]] = daysOf([version(1, new Date(2025, 2, 4, 10, 41))])

    expect(label).toMatch(/^(Mar 4, 2025|4 Mar 2025)$/)
  })

  it('counts calendar days, so last night is Yesterday however few hours ago', () => {
    const justAfterMidnight = new Date(2026, 9, 15, 0, 30)

    expect(daysOf([version(1, new Date(2026, 9, 14, 23, 50))], justAfterMidnight)).toEqual([
      ['Yesterday', [1]],
    ])
  })
})

describe('version title', () => {
  it('is the name a version was given', () => {
    expect(versionTitle(version(2, new Date(2026, 9, 15, 14, 14), 'Before review'), NOW)).toBe(
      'Before review',
    )
  })

  it('is the day and time an automatic version was taken', () => {
    expect(versionTitle(version(2, new Date(2026, 9, 15, 14, 14)), NOW)).toMatch(
      /^Today, (2:14\s?pm|14:14)$/i,
    )
  })
})

describe('comment time', () => {
  it('is the time for something made today, else its day', () => {
    const times = [
      new Date(2026, 9, 15, 14, 14),
      new Date(2026, 9, 14, 9, 0),
      new Date(2026, 9, 12),
    ]

    expect(times.map((made) => dayOrTime({ creation: made.toISOString() }, NOW))).toEqual([
      expect.stringMatching(/^(2:14\s?pm|14:14)$/i),
      'Yesterday',
      expect.stringMatching(/^(Oct 12|12 Oct)$/),
    ])
  })
})
