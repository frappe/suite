import { describe, expect, it } from 'vitest'

import dayjs from '@/apps/mail/utils/dayjs'
import {
  dateRangeDays,
  dateRangeLabel,
  dateRangeQuery,
  heldDates,
  singleDayQuery,
} from '@/apps/mail/utils/phoneSearch'

// The search takes mail from `after` on and from before `before`: a range's last day is in it.
describe("a phone search's custom date range", () => {
  it('keeps mail from the last day picked', () => {
    expect(dateRangeQuery('2026-11-03', '2026-11-09')).toEqual({
      after: '2026-11-03',
      before: '2026-11-10',
    })
  })

  it('reads back as the days that were picked, in the chip and the picker', () => {
    const route = dateRangeQuery('2026-10-28', '2026-11-02')
    const today = dayjs('2026-11-23')

    expect(dateRangeDays(route)).toEqual({ from: '2026-10-28', to: '2026-11-02' })
    expect(dateRangeLabel(route, today)).toBe('28 Oct – 2 Nov')
  })

  it('leaves the day itself out of mail before or after it, and names that day back', () => {
    const today = dayjs('2026-11-23')
    const after = singleDayQuery('after', '2026-11-03')
    const before = singleDayQuery('before', '2025-12-31')

    expect(after).toEqual({ after: '2026-11-04' })
    expect(before).toEqual({ before: '2025-12-31' })
    expect(dateRangeLabel(after, today)).toBe('After 3 Nov')
    expect(dateRangeLabel(before, today)).toBe('Before 31 Dec 2025')
    expect(heldDates(after)).toMatchObject({ mode: 'after', single: '2026-11-03' })
  })
})
