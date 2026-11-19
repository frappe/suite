import { describe, expect, it } from 'vitest'

import {
  busyEmails,
  defaultFreeBusy,
  formSpan,
  ownConflicts,
  type BusyCandidate,
  type OwnBusyContext,
} from '@/apps/calendar/utils/availability'

const ZONE = 'Asia/Kolkata'
const ME = 'me@example.com'

const context: OwnBusyContext = {
  account: 'a1',
  ownEmails: [ME],
  calendars: [
    { name: 'a1|work', include_in_availability: 'All' },
    { name: 'a1|quiet', include_in_availability: 'None' },
    { name: 'a1|team', include_in_availability: 'Attending' },
  ],
}

let n = 0
const event = (overrides: Partial<BusyCandidate> = {}): BusyCandidate & { title: string } => ({
  title: `event ${++n}`,
  uid: `uid-${n}`,
  account: 'a1',
  start: '2026-11-24T14:00:00',
  duration: 'PT1H',
  time_zone: ZONE,
  status: 'Confirmed',
  free_busy_status: 'Busy',
  calendars: [{ calendar: 'a1|work' }],
  ...overrides,
})

// 14:00–15:00 on 24 November, where the writer is.
const span = formSpan(
  { startDate: '2026-11-24', startTime: '14:00', endDate: '2026-11-24', endTime: '15:00' },
  ZONE,
)!
const conflicts = (events: BusyCandidate[], ctx = context) => ownConflicts(events, span, ctx, ZONE)

describe('ownConflicts', () => {
  it('finds a busy event in the same time', () => {
    const meeting = event({ start: '2026-11-24T14:30:00' })
    expect(conflicts([meeting])).toEqual([meeting])
  })

  it('does not count an event that only touches the time', () => {
    expect(conflicts([event({ start: '2026-11-24T13:00:00' })])).toEqual([])
    expect(conflicts([event({ start: '2026-11-24T15:00:00' })])).toEqual([])
  })

  it('reads a timed event in its own zone', () => {
    // 10:00 in Vienna is 14:30 in Kolkata in November.
    const vienna = event({ start: '2026-11-24T10:00:00', time_zone: 'Europe/Vienna' })
    expect(conflicts([vienna])).toEqual([vienna])
    // 08:00 in Vienna is 12:30 in Kolkata: over before the writer's time starts.
    expect(
      conflicts([event({ start: '2026-11-24T08:00:00', time_zone: 'Europe/Vienna' })]),
    ).toEqual([])
  })

  it('counts a busy all-day event for every hour of its days, on the writer’s own days', () => {
    const away = event({ start: '2026-11-24T00:00:00', duration: 'P1D', show_without_time: 1 })
    expect(conflicts([away])).toEqual([away])
    const dayBefore = event({ start: '2026-11-23T00:00:00', duration: 'P1D', show_without_time: 1 })
    expect(conflicts([dayBefore])).toEqual([])
  })

  it('leaves out what does not take the writer’s time', () => {
    expect(
      conflicts([
        event({ free_busy_status: 'Free' }),
        event({ status: 'Cancelled' }),
        event({
          participants: [{ email: `mailto:${ME.toUpperCase()}`, participation_status: 'DECLINED' }],
        }),
        // Someone else's calendar shared with the writer, and the site's own holiday calendar.
        event({ account: 'a2', calendars: [{ calendar: 'a2|cal' }] }),
        event({ account: 'external', calendars: [{ calendar: 'external|holidays' }] }),
        event({ calendars: [{ calendar: 'a1|quiet' }] }),
      ]),
    ).toEqual([])
  })

  it('counts an event that does not say whether it is busy', () => {
    const unsaid = event({ free_busy_status: '' })
    expect(conflicts([unsaid])).toEqual([unsaid])
  })

  it('never has the event being edited conflict with itself', () => {
    const editing = event({ uid: 'series' })
    expect(conflicts([editing], { ...context, uid: 'series' })).toEqual([])
  })

  it('counts only what the writer is on from a calendar that counts their attendance', () => {
    const team = { calendars: [{ calendar: 'a1|team' }] }
    const theirs = event({ ...team, participants: [{ email: 'other@example.com' }] })
    const mine = event({
      ...team,
      participants: [
        { email: 'other@example.com' },
        { email: ME, participation_status: 'ACCEPTED' },
      ],
    })
    const nobody = event(team)
    expect(conflicts([theirs, mine, nobody])).toEqual([mine, nobody])
  })

  it('lists the earliest first', () => {
    const later = event({ start: '2026-11-24T14:45:00' })
    const earlier = event({ start: '2026-11-24T13:30:00' })
    expect(conflicts([later, earlier])).toEqual([earlier, later])
  })
})

describe('formSpan', () => {
  it('runs an all-day event to the start of the day after its last', () => {
    const days = formSpan({ isAllDay: true, startDate: '2026-11-24', endDate: '2026-11-25' }, ZONE)!
    expect(days.start.toISOString()).toBe('2026-11-23T18:30:00.000Z')
    expect(days.end.toISOString()).toBe('2026-11-25T18:30:00.000Z')
  })

  it('has no span while the form holds no valid range', () => {
    const at = { startDate: '2026-11-24', endDate: '2026-11-24' }
    expect(formSpan({ ...at, startTime: '15:00', endTime: '14:00' }, ZONE)).toBeNull()
    expect(formSpan({ ...at, startTime: '15:00' }, ZONE)).toBeNull()
    expect(
      formSpan({ isAllDay: true, startDate: '2026-11-24', endDate: '2026-11-23' }, ZONE),
    ).toBeNull()
  })
})

describe('busyEmails', () => {
  it('names the people busy at some point of the time, and no one else', () => {
    const answer = [
      // 14:30–15:30 in Kolkata.
      {
        email: 'Busy@Example.com',
        busy: [{ utc_start: '2026-11-24T09:00:00Z', utc_end: '2026-11-24T10:00:00Z' }],
      },
      // Ends at 14:00 in Kolkata, as the event starts.
      {
        email: 'touching@example.com',
        busy: [{ utc_start: '2026-11-24T07:30:00Z', utc_end: '2026-11-24T08:30:00Z' }],
      },
      { email: 'empty@example.com', busy: [] },
    ]
    expect([...busyEmails(answer, span)]).toEqual(['busy@example.com'])
  })
})

describe('defaultFreeBusy', () => {
  it('starts a new all-day event as free and a timed one as busy', () => {
    expect(defaultFreeBusy(true)).toBe('Free')
    expect(defaultFreeBusy(false)).toBe('Busy')
  })
})
