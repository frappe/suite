import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

import { upcomingEventWindow, type CalendarEvent } from '@/apps/calendar'

dayjs.extend(duration)

export interface HomeEventGroup<Event = CalendarEvent> {
  day: string
  events: Event[]
}

export function homeEventWindow(now = new Date()): {
  from: string
  to: string
} {
  const { from, to } = upcomingEventWindow(now)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function groupHomeEvents<
  Event extends Pick<CalendarEvent, 'start'> & Partial<Pick<CalendarEvent, 'duration'>>,
>(events: readonly Event[], now = new Date()): HomeEventGroup<Event>[] {
  const today = localDayKey(now)
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrow = localDayKey(tomorrowDate)
  const window = upcomingEventWindow(now)
  const groups = new Map<string, Event[]>()

  for (const event of events) {
    const start = parseDate(event.start)
    if (!start) continue
    if (event.duration) {
      const milliseconds = dayjs.duration(event.duration).asMilliseconds()
      if (
        Number.isFinite(milliseconds) &&
        milliseconds > 0 &&
        start.getTime() + milliseconds <= now.getTime()
      )
        continue
    }
    if (start < window.from || start > window.to) continue
    const key = localDayKey(start)
    const day = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : key
    const group = groups.get(day) ?? []
    group.push(event)
    groups.set(day, group)
  }

  return [...groups]
    .map(([day, events]) => ({ day, events: events.sort(compareEventStart) }))
    .sort((left, right) => compareEventStart(left.events[0], right.events[0]))
}

export function formatEventTime(
  event: Pick<CalendarEvent, 'start'> &
    Partial<Pick<CalendarEvent, 'duration' | 'show_without_time'>>,
): string {
  if (event.show_without_time) return 'All day'
  const start = parseDate(event.start)
  if (!start) return ''
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const startTime = formatter.format(start)
  if (!event.duration) return startTime
  const milliseconds = dayjs.duration(event.duration).asMilliseconds()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return startTime
  const end = new Date(start.getTime() + milliseconds)
  return `${startTime} – ${formatter.format(end)}`
}

export function toLocalDateTimeInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function compareEventStart(
  left: Pick<CalendarEvent, 'start'>,
  right: Pick<CalendarEvent, 'start'>,
): number {
  return (parseDate(left.start)?.getTime() ?? 0) - (parseDate(right.start)?.getTime() ?? 0)
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function localDayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
}
