import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@/apps/calendar'
import { formatEventTime, groupHomeEvents } from '@/composition/home/homeTime'

describe('Home upcoming dates', () => {
  it('filters ended events from the cached day while keeping ongoing meetings', () => {
    const now = new Date(2026, 9, 6, 14, 30)
    const events = [
      { id: 'ended', start: localIso(2026, 9, 6, 12, 0), duration: 'PT1H' },
      { id: 'ongoing', start: localIso(2026, 9, 6, 14, 0), duration: 'PT1H' },
      { id: 'next', start: localIso(2026, 9, 6, 16, 0), duration: 'PT1H' },
    ]
    expect(
      groupHomeEvents(events, now).flatMap((group) => group.events.map((event) => event.id)),
    ).toEqual(['ongoing', 'next'])
  })

  it('shows afternoon times in 12-hour format', () => {
    expect(formatEventTime({ start: localIso(2026, 9, 6, 14, 30), duration: 'PT1H' })).toMatch(
      /2:30\s*PM\s*–\s*3:30\s*PM/i,
    )
  })

  it('groups Today and Tomorrow around midnight', () => {
    const now = new Date(2026, 8, 15, 23, 59, 30)
    const events: Pick<CalendarEvent, 'id' | 'title' | 'start'>[] = [
      {
        id: 'later',
        title: 'Tomorrow later',
        start: localIso(2026, 8, 16, 9, 0),
      },
      {
        id: 'today',
        title: 'Before midnight',
        start: localIso(2026, 8, 15, 23, 59, 45),
      },
      {
        id: 'midnight',
        title: 'At midnight',
        start: localIso(2026, 8, 16, 0, 0),
      },
      { id: 'outside', title: 'Day after', start: localIso(2026, 8, 17, 0, 0) },
    ]

    expect(groupHomeEvents(events, now)).toEqual([
      { day: 'Today', events: [events[1]] },
      { day: 'Tomorrow', events: [events[2], events[0]] },
    ])
  })
})

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): string {
  return new Date(year, month, day, hour, minute, second).toISOString()
}
