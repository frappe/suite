/**
 * Whether time is already taken: the writer's own, from their events, and the people they invite,
 * from the mail server's busy periods. See specs/calendar/002-availability.md.
 */
import dayjs from '@/apps/calendar/utils/dayjs'
import { isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { userTimeZone } from '@/platform/time-zone'

type Dayjs = ReturnType<typeof dayjs>

/** A stretch of time, from its first instant up to (not including) its last. */
export interface Span {
  start: Dayjs
  end: Dayjs
}

/** What the conflict check reads off an event as the server sends it. */
export interface BusyCandidate {
  uid?: string | null
  account: string
  start: string
  duration?: string | null
  time_zone?: string | null
  show_without_time?: boolean | 0 | 1 | null
  status?: string | null
  free_busy_status?: string | null
  organizer?: string | null
  participants?: { email?: string | null; participation_status?: string | null }[] | null
  calendars?: { calendar: string }[] | null
}

/** What the conflict check reads off a calendar. */
export interface AvailabilityCalendar {
  name: string
  include_in_availability?: 'All' | 'Attending' | 'None'
}

/** The times a form holds, as `EventForm` has them. */
export interface FormTimes {
  isAllDay?: boolean
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
}

const address = (email?: string | null) => (email ?? '').replace(/^mailto:/i, '').toLowerCase()

/**
 * The time the form describes, in `zone`. An all-day event runs to the start of the day after
 * its last. Null while the form holds no valid range.
 */
export function formSpan(form: FormTimes, zone = userTimeZone()): Span | null {
  if (!form.startDate || !form.endDate) return null
  if (form.isAllDay) {
    const start = dayjs.tz(form.startDate, zone)
    const end = dayjs.tz(form.endDate, zone).add(1, 'day')
    return start.isValid() && end.isAfter(start) ? { start, end } : null
  }
  if (!form.startTime || !form.endTime) return null
  const start = dayjs.tz(`${form.startDate}T${form.startTime}`, zone)
  const end = dayjs.tz(`${form.endDate}T${form.endTime}`, zone)
  return start.isValid() && end.isAfter(start) ? { start, end } : null
}

/**
 * When an event takes place. A timed event is read in its own zone; an all-day event, or a
 * floating one, on the reader's own days.
 */
export function eventSpan(event: BusyCandidate, zone = userTimeZone()): Span {
  const allDay = isAllDayEvent({ ...event, show_without_time: !!event.show_without_time })
  const wallClock = allDay ? event.start.slice(0, 10) : event.start
  const start = dayjs.tz(wallClock, allDay || !event.time_zone ? zone : event.time_zone)
  return { start, end: start.add(dayjs.duration(event.duration || 'PT0S')) }
}

/** One starts before the other ends: two that only touch do not overlap. */
export const overlaps = (a: Span, b: Span) =>
  a.start.valueOf() < b.end.valueOf() && b.start.valueOf() < a.end.valueOf()

const isOn = (event: BusyCandidate, emails: Set<string>) =>
  emails.has(address(event.organizer)) ||
  !!event.participants?.some((p) => emails.has(address(p.email)))

const declinedBy = (event: BusyCandidate, emails: Set<string>) =>
  !!event.participants?.some(
    (p) => p.participation_status === 'DECLINED' && emails.has(address(p.email)),
  )

/** Whether its calendar lets the event count, by the calendar's `includeInAvailability`. */
function countedByCalendar(
  event: BusyCandidate,
  calendars: Map<string, AvailabilityCalendar>,
  emails: Set<string>,
) {
  const rules = (event.calendars ?? []).map(
    (cal) => calendars.get(cal.calendar)?.include_in_availability ?? 'All',
  )
  if (!rules.length || rules.includes('All')) return true
  if (!rules.includes('Attending')) return false
  return !event.participants?.length || isOn(event, emails)
}

export interface OwnBusyContext {
  /** The account the form writes to: only its own calendars are the writer's. */
  account: string
  /** The writer's addresses, which say what they declined and what they are on. */
  ownEmails: string[]
  calendars: AvailabilityCalendar[]
  /** The event being edited, which never conflicts with itself or its other occurrences. */
  uid?: string | null
}

/** Whether an event makes the writer busy, wherever it falls. */
export function makesBusy(event: BusyCandidate, context: OwnBusyContext): boolean {
  const emails = new Set(context.ownEmails.map(address))
  const calendars = new Map(context.calendars.map((cal) => [cal.name, cal]))
  if (event.account !== context.account) return false
  if (context.uid && event.uid === context.uid) return false
  if (event.status === 'Cancelled') return false
  // JMAP reads an event that does not say as busy.
  if (event.free_busy_status === 'Free') return false
  if (declinedBy(event, emails)) return false
  return countedByCalendar(event, calendars, emails)
}

/** The writer's events that take up any of `span`, earliest first. */
export function ownConflicts<T extends BusyCandidate>(
  events: T[],
  span: Span,
  context: OwnBusyContext,
  zone = userTimeZone(),
): T[] {
  const found = events.flatMap((event) => {
    const at = eventSpan(event, zone)
    return overlaps(at, span) && makesBusy(event, context) ? [{ event, at }] : []
  })
  found.sort((a, b) => a.at.start.valueOf() - b.at.start.valueOf())
  return found.map(({ event }) => event)
}

/** A person's busy time as the mail server answers it, in UTC. */
export interface PersonBusy {
  email: string
  busy: { utc_start: string; utc_end: string }[]
}

/** The addresses of the people busy at some point of `span`. */
export function busyEmails(answer: PersonBusy[], span: Span): Set<string> {
  return new Set(
    answer.flatMap((person) =>
      person.busy.some((period) =>
        overlaps({ start: dayjs.utc(period.utc_start), end: dayjs.utc(period.utc_end) }, span),
      )
        ? [address(person.email)]
        : [],
    ),
  )
}

/**
 * The Availability a new event starts with: a day marked on the calendar does not take the day,
 * a meeting takes its time.
 */
export const defaultFreeBusy = (isAllDay?: boolean) => (isAllDay ? 'Free' : 'Busy')
