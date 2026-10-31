import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '@/apps/calendar'
import { formatEventTime, groupHomeEvents, homeEventWindow } from '@/composition/home/homeTime'

describe('Home upcoming dates', () => {
  it.each([
    ['2026-10-29', '2026-10-30'],
    ['2026-10-30', '2026-11-02'],
    ['2026-10-31', '2026-11-02'],
    ['2026-11-01', '2026-11-02'],
    ['2027-12-31', '2028-01-03'],
  ])('keeps all local days from %s through %s', (today, lastDay) => {
    const now = new Date(`${today}T08:00:00`)
    const window = homeEventWindow(now)
    expect(new Date(window.from)).toEqual(new Date(`${today}T00:00:00`))
    expect(new Date(window.to)).toEqual(new Date(`${lastDay}T23:59:59.999`))
    const events = [
      { id: 'last', start: `${lastDay}T23:59:59.999` },
      { id: 'today', start: `${today}T12:00:00` },
      { id: 'outside', start: new Date(new Date(window.to).getTime() + 1).toISOString() },
    ]
    expect(
      groupHomeEvents(events, now).flatMap((group) => group.events.map((event) => event.id)),
    ).toEqual(['today', 'last'])
  })

  it('retains weekend events between Friday and Monday in date order', () => {
    const events = ['2026-11-02', '2026-11-01', '2026-10-31'].map((start) => ({
      start: `${start}T12:00:00`,
    }))
    expect(
      groupHomeEvents(events, new Date(2026, 9, 30, 8)).flatMap((group) => group.events),
    ).toEqual([events[2], events[1], events[0]])
  })

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
