import { describe, expect, it, vi } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'

import { snoozeChoices } from './snoozeTimes'

vi.mock('@/platform/time-zone', () => ({ userTimeZone: () => 'UTC' }))

const at = (when: string) => dayjs.utc(when).tz('UTC')
const labels = (when: string) => snoozeChoices(at(when)).map((choice) => choice.label)
const shown = (when: string, label: string) =>
  snoozeChoices(at(when)).find((choice) => choice.label === label)

describe('snooze times', () => {
  // 2026-11-04 is a Wednesday.
  it('leads with an hour from now, to the minute', () => {
    const first = snoozeChoices(at('2026-11-04T10:12:40Z'))[0]
    expect(first.label).toBe('In 1 hour')
    expect(first.display).toBe('11:12 AM')
    expect(first.value).toBe('2026-11-04T11:12:00Z')
  })

  it('takes later today as six in the evening', () => {
    expect(shown('2026-11-04T10:10:00Z', 'Later today')?.display).toBe('6:00 PM')
    expect(shown('2026-11-04T10:10:00Z', 'Later today')?.value).toBe('2026-11-04T18:00:00Z')
  })

  it('offers no later today once it is within two hours of an hour from now', () => {
    expect(labels('2026-11-04T15:00:00Z')).toContain('Later today')
    expect(labels('2026-11-04T15:01:00Z')).not.toContain('Later today')
    expect(labels('2026-11-04T23:00:00Z')).not.toContain('Later today')
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
