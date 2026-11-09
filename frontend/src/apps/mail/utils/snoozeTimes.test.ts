import { afterEach, describe, expect, it, vi } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'

import { reminderChoices, returnedStrip, snoozeChoices } from './snoozeTimes'

const zone = vi.hoisted(() => ({ name: 'UTC' }))
vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => zone.name }))

const at = (when: string) => dayjs.utc(when).tz('UTC')
const labels = (when: string) => snoozeChoices(at(when)).map((choice) => choice.label)
const shown = (when: string, label: string) =>
  snoozeChoices(at(when)).find((choice) => choice.label === label)

describe('snooze times', () => {
  // 2026-11-04 is a Wednesday.
  it('leads with later today, six in the evening until mid-afternoon', () => {
    const first = snoozeChoices(at('2026-11-04T10:00:00Z'))[0]
    expect(first.label).toBe('Later today')
    expect(first.display).toBe('6:00 PM')
    expect(first.value).toBe('2026-11-04T18:00:00Z')
  })

  it('takes later today as three hours on from mid-afternoon, up to the next full hour', () => {
    expect(shown('2026-11-04T16:20:00Z', 'Later today')?.display).toBe('8:00 PM')
    expect(shown('2026-11-04T16:20:00Z', 'Later today')?.value).toBe('2026-11-04T20:00:00Z')
  })

  it('offers no later today once that would be past nine, and leads with tomorrow', () => {
    expect(labels('2026-11-04T18:30:00Z')).not.toContain('Later today')
    expect(labels('2026-11-04T18:30:00Z')[0]).toBe('Tomorrow')
  })

  it('offers no hour from now', () => {
    expect(labels('2026-11-04T10:00:00Z')).not.toContain('In 1 hour')
  })

  it('takes tomorrow as nine in the morning, and sends that as UTC', () => {
    const tomorrow = shown('2026-11-04T10:10:00Z', 'Tomorrow')
    expect(tomorrow?.display).toBe('Thu 9:00 AM')
    expect(tomorrow?.value).toBe('2026-11-05T09:00:00Z')
  })

  it('offers later this week from Monday to Wednesday only', () => {
    expect(labels('2026-11-02T10:00:00Z')).toContain('Later this week')
    expect(labels('2026-11-04T10:00:00Z')).toContain('Later this week')
    expect(labels('2026-11-05T10:00:00Z')).not.toContain('Later this week')
    expect(labels('2026-11-01T10:00:00Z')).not.toContain('Later this week')
  })

  it('takes next week as the coming Monday, dated once it is a week out', () => {
    expect(shown('2026-11-04T10:00:00Z', 'Next week')?.display).toBe('Mon 9:00 AM')
    expect(shown('2026-11-07T10:00:00Z', 'Next week')?.display).toBe('Mon 9:00 AM')
    expect(shown('2026-11-02T10:00:00Z', 'Next week')?.display).toBe('Mon, Nov 9, 9:00 AM')
  })

  it('does not offer next week on a Sunday, when it is tomorrow', () => {
    expect(labels('2026-11-01T10:00:00Z')).not.toContain('Next week')
    expect(shown('2026-11-01T10:00:00Z', 'Tomorrow')?.display).toBe('Mon 9:00 AM')
  })
})

describe('reminder times', () => {
  it('counts days from now, each at nine in the morning', () => {
    expect(
      reminderChoices(at('2026-11-04T16:45:00Z')).map((choice) => [choice.label, choice.display]),
    ).toEqual([
      ['Tomorrow', 'Thu 9:00 AM'],
      ['In 3 days', 'Sat 9:00 AM'],
      ['In a week', 'Wed, Nov 11, 9:00 AM'],
      ['In 2 weeks', 'Wed, Nov 18, 9:00 AM'],
    ])
  })
})

describe('the strip over a thread nobody has replied to', () => {
  afterEach(() => {
    zone.name = 'UTC'
  })
  // 09:30 on Monday 9 November in Kolkata.
  const now = new Date('2026-11-09T04:00:00Z')
  const since = (sentAt: string) => {
    zone.name = 'Asia/Kolkata'
    return returnedStrip(true, null, null, sentAt, now).text
  }

  it('gives the time for mail sent today', () => {
    expect(since('2026-11-09T03:20:00Z')).toBe('No reply since 8:50 AM')
  })

  it('gives the day for mail sent before today', () => {
    expect(since('2026-11-08T09:20:00Z')).toBe('No reply since Sun, Nov 8')
  })

  it('goes by the user zone where the day differs from UTC', () => {
    // Still the 8th in UTC, past midnight on the 9th in Kolkata.
    expect(since('2026-11-08T19:00:00Z')).toBe('No reply since 12:30 AM')
  })
})
