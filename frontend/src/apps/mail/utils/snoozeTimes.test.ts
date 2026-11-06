import { describe, expect, it, vi } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'

import { reminderChoices, snoozeChoices } from './snoozeTimes'

vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => 'UTC' }))

const at = (when: string) => dayjs.utc(when).tz('UTC')
const labels = (when: string) => snoozeChoices(at(when)).map((choice) => choice.label)
const shown = (when: string, label: string) =>
  snoozeChoices(at(when)).find((choice) => choice.label === label)

describe('snooze times', () => {
  // 2026-11-04 is a Wednesday.
  it('rounds later today up to the half hour, and says so', () => {
    expect(shown('2026-11-04T10:10:00Z', 'Later today')?.display).toBe('Wed, Nov 4, 1:30 PM')
    expect(shown('2026-11-04T10:30:00Z', 'Later today')?.display).toBe('Wed, Nov 4, 1:30 PM')
  })

  it('offers no later today late in the evening', () => {
    expect(labels('2026-11-04T17:30:00Z')).toContain('Later today')
    expect(labels('2026-11-04T17:31:00Z')).not.toContain('Later today')
    expect(labels('2026-11-04T23:00:00Z')).not.toContain('Later today')
  })

  it('takes tomorrow as nine in the morning, and sends that as UTC', () => {
    const tomorrow = shown('2026-11-04T10:10:00Z', 'Tomorrow')
    expect(tomorrow?.display).toBe('Thu, Nov 5, 9:00 AM')
    expect(tomorrow?.value).toBe('2026-11-05T09:00:00Z')
  })

  it('offers later this week from Monday to Wednesday only', () => {
    expect(labels('2026-11-02T10:00:00Z')).toContain('Later this week')
    expect(labels('2026-11-04T10:00:00Z')).toContain('Later this week')
    expect(labels('2026-11-05T10:00:00Z')).not.toContain('Later this week')
    expect(labels('2026-11-01T10:00:00Z')).not.toContain('Later this week')
  })

  it('takes next week as the coming Monday', () => {
    expect(shown('2026-11-04T10:00:00Z', 'Next week')?.display).toBe('Mon, Nov 9, 9:00 AM')
    expect(shown('2026-11-07T10:00:00Z', 'Next week')?.display).toBe('Mon, Nov 9, 9:00 AM')
    expect(shown('2026-11-02T10:00:00Z', 'Next week')?.display).toBe('Mon, Nov 9, 9:00 AM')
  })

  it('does not offer next week on a Sunday, when it is tomorrow', () => {
    expect(labels('2026-11-01T10:00:00Z')).not.toContain('Next week')
    expect(shown('2026-11-01T10:00:00Z', 'Tomorrow')?.display).toBe('Mon, Nov 2, 9:00 AM')
  })
})

describe('reminder times', () => {
  const reminders = (when: string) =>
    reminderChoices(at(when)).map((choice) => [choice.label, choice.display])

  it('counts days from when the mail goes out, each at nine in the morning', () => {
    expect(reminders('2026-11-04T16:45:00Z')).toEqual([
      ['Tomorrow', 'Thu, Nov 5, 9:00 AM'],
      ['In 3 days', 'Sat, Nov 7, 9:00 AM'],
      ['In a week', 'Wed, Nov 11, 9:00 AM'],
      ['In 2 weeks', 'Wed, Nov 18, 9:00 AM'],
    ])
  })

  it('starts from a scheduled send, not from now', () => {
    expect(reminders('2026-11-20T08:00:00Z')[0]).toEqual(['Tomorrow', 'Sat, Nov 21, 9:00 AM'])
  })
})
