import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'

import type { CalendarEvent } from '@/apps/calendar'

dayjs.extend(duration)

export interface HomeEventGroup<Event = CalendarEvent> {
  day: 'Today' | 'Tomorrow'
  events: Event[]
}

export function homeEventWindow(now = new Date()): {
  from: string
  to: string
} {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
  end.setMilliseconds(-1)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: start.toISOString(), to: end.toISOString() }
}

export function groupHomeEvents<
  Event extends Pick<CalendarEvent, 'start'> & Partial<Pick<CalendarEvent, 'duration'>>,
>(events: readonly Event[], now = new Date()): HomeEventGroup<Event>[] {
  const today = localDayKey(now)
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrow = localDayKey(tomorrowDate)
  const groups: Record<HomeEventGroup['day'], Event[]> = {
    Today: [],
    Tomorrow: [],
  }

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
    const key = localDayKey(start)
    if (key === today) groups.Today.push(event)
    if (key === tomorrow) groups.Tomorrow.push(event)
  }

  return (['Today', 'Tomorrow'] as const)
    .map((day) => ({
      day,
      events: groups[day].sort(compareEventStart),
    }))
    .filter((group) => group.events.length > 0)
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
