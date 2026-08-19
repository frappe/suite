// PROTOTYPE — remove. Fake calendar data for the throwaway shell prototype.
// Nothing here persists or talks to the backend.
//
// Kept out of fixtures.ts on purpose: the Calendar screen needs start/end
// times and a calendar colour, which the flat `UPCOMING_EVENTS` list on Home
// does not carry.
//
// Every date is generated from the real today, so the week grid always opens on
// a live week and "today" highlights correctly.
import dayjs from 'dayjs'

import { ISO, toMinutes } from './calendarDates'

export type CalendarId = 'work' | 'personal' | 'focus' | 'travel'

// Ink-first: an event carries no fill of its own, so the calendar's colour has
// to survive in a 6px dot. `dot` and `text` are literal classes, not built
// strings — Tailwind only ships the classes it can see in the source.
export const CALENDARS: {
  id: CalendarId
  label: string
  dot: string
  text: string
}[] = [
  { id: 'work', label: 'Work', dot: 'bg-surface-blue-5', text: 'text-ink-blue-6' },
  { id: 'personal', label: 'Personal', dot: 'bg-surface-green-5', text: 'text-ink-green-6' },
  { id: 'focus', label: 'Focus', dot: 'bg-surface-violet-5', text: 'text-ink-violet-6' },
  { id: 'travel', label: 'Travel', dot: 'bg-surface-amber-5', text: 'text-ink-amber-6' },
]

const DOT: Record<CalendarId, string> = Object.fromEntries(
  CALENDARS.map((c) => [c.id, c.dot]),
) as Record<CalendarId, string>

export interface CalEvent {
  id: string
  title: string
  calendar: CalendarId
  dot: string
  /** First day, 'YYYY-MM-DD'. */
  start: string
  /** Last day, inclusive. Same as `start` for a timed event. */
  end: string
  /** Minutes from midnight. `null` on both marks an all-day event. */
  startMin: number | null
  endMin: number | null
  venue: string
  participant: string
}

export function isAllDay(event: CalEvent): boolean {
  return event.startMin === null
}

interface EventSeed {
  id: string
  title: string
  calendar: CalendarId
  /** Days from today; negative is the past. */
  day: number
  /** 'HH:mm'. Omit both times for an all-day event. */
  from?: string
  to?: string
  /** Length in days for an all-day event. 1 = a single day. */
  days?: number
  venue?: string
  participant?: string
}

function build(seed: EventSeed): CalEvent {
  const start = dayjs().add(seed.day, 'day')
  const allDay = !seed.from

  return {
    id: seed.id,
    title: seed.title,
    calendar: seed.calendar,
    dot: DOT[seed.calendar],
    start: start.format(ISO),
    end: start.add(allDay ? (seed.days ?? 1) - 1 : 0, 'day').format(ISO),
    startMin: allDay ? null : toMinutes(seed.from as string),
    endMin: allDay ? null : toMinutes(seed.to as string),
    venue: seed.venue ?? '',
    participant: seed.participant ?? '',
  }
}

// This week carries the density: overlaps on the busy days, gaps on the quiet
// ones, so the week grid is worth looking at. The rest of the month and the
// year exist to give the Month and Year views something to render.
const SEEDS: EventSeed[] = [
  // — Two days back —
  { id: 'c01', title: 'Design review', calendar: 'work', day: -2, from: '10:00', to: '11:00', participant: 'Neha Kulkarni' },
  { id: 'c02', title: 'Deep work', calendar: 'focus', day: -2, from: '14:00', to: '16:30' },

  // — Yesterday —
  { id: 'c03', title: 'Standup', calendar: 'work', day: -1, from: '09:30', to: '09:45' },
  { id: 'c04', title: 'Suite launch dry run', calendar: 'work', day: -1, from: '11:00', to: '12:30', venue: 'Meet' },
  { id: 'c05', title: 'Gym', calendar: 'personal', day: -1, from: '18:30', to: '19:30' },

  // — Today: the busy one, with a deliberate three-way overlap at 14:00 —
  { id: 'c06', title: 'Standup', calendar: 'work', day: 0, from: '09:30', to: '09:45' },
  { id: 'c07', title: 'Shell prototype walkthrough', calendar: 'work', day: 0, from: '10:00', to: '11:00', participant: 'Rushabh Mehta', venue: 'Meet' },
  { id: 'c08', title: 'Deep work — calendar screen', calendar: 'focus', day: 0, from: '11:30', to: '13:30' },
  { id: 'c09', title: '1:1 Faris / Rushabh', calendar: 'work', day: 0, from: '14:00', to: '14:30', participant: 'Rushabh Mehta', venue: 'Meet' },
  { id: 'c10', title: 'Token audit sync', calendar: 'work', day: 0, from: '14:00', to: '15:00', participant: 'Aditya Verma' },
  { id: 'c11', title: 'Design critique', calendar: 'work', day: 0, from: '14:15', to: '15:15', participant: 'Neha Kulkarni' },
  // A fourth event in the same slot: the case the overlap variants disagree on.
  { id: 'c30', title: 'Support escalation', calendar: 'work', day: 0, from: '14:20', to: '15:00', participant: 'Priya Nair' },
  { id: 'c12', title: 'Dentist', calendar: 'personal', day: 0, from: '17:00', to: '18:00', venue: 'Koramangala' },

  // — Tomorrow —
  { id: 'c13', title: 'Sprint planning', calendar: 'work', day: 1, from: '09:30', to: '10:30' },
  { id: 'c14', title: 'Interview — frontend', calendar: 'work', day: 1, from: '15:00', to: '16:00', participant: 'Priya Nair' },
  { id: 'c15', title: 'Grocery run', calendar: 'personal', day: 1, from: '19:00', to: '20:00' },

  // — Rest of the week, including a span that starts mid-week —
  { id: 'c16', title: 'Public holiday', calendar: 'personal', day: 2 },
  { id: 'c17', title: 'Offsite planning', calendar: 'work', day: 3, from: '11:00', to: '12:00' },
  { id: 'c18', title: 'Deep work', calendar: 'focus', day: 3, from: '14:00', to: '17:00' },
  { id: 'c19', title: 'Design sprint', calendar: 'work', day: 3, days: 3 },
  { id: 'c20', title: 'Family dinner', calendar: 'personal', day: 4, from: '20:00', to: '22:00' },

  // — Later in the month —
  { id: 'c21', title: 'Bengaluru → Delhi', calendar: 'travel', day: 9, days: 3 },
  { id: 'c22', title: 'Customer workshop', calendar: 'work', day: 10, from: '10:00', to: '16:00', venue: 'Delhi' },
  { id: 'c23', title: 'Quarterly review', calendar: 'work', day: 16, from: '15:00', to: '17:00' },
  { id: 'c24', title: 'Renew passport', calendar: 'personal', day: 21 },

  // — Across the year, so the Year view has something to show —
  { id: 'c25', title: 'Conference', calendar: 'travel', day: 45, days: 4 },
  { id: 'c26', title: 'Product week', calendar: 'work', day: 78, days: 5 },
  { id: 'c27', title: 'Leave', calendar: 'personal', day: 120, days: 7 },
  { id: 'c28', title: 'Annual planning', calendar: 'work', day: -35, from: '10:00', to: '18:00' },
  { id: 'c29', title: 'Team offsite', calendar: 'travel', day: -60, days: 3 },
]

export const CALENDAR_EVENTS: CalEvent[] = SEEDS.map(build)

/** Events touching any day in `[from, to]`, both inclusive. */
export function eventsBetween(from: string, to: string): CalEvent[] {
  return CALENDAR_EVENTS.filter((e) => e.start <= to && e.end >= from)
}

/** Event count per 'YYYY-MM-DD'; a span counts on every day it covers. */
export const EVENT_COUNT_BY_DATE: Record<string, number> = (() => {
  const counts: Record<string, number> = {}
  for (const event of CALENDAR_EVENTS) {
    let day = dayjs(event.start)
    while (day.format(ISO) <= event.end) {
      const key = day.format(ISO)
      counts[key] = (counts[key] ?? 0) + 1
      day = day.add(1, 'day')
    }
  }
  return counts
})()
