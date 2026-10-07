import { computed } from 'vue'

import { api, useQuery } from '@/api'
import type { GridEvent } from '@/apps/calendar/composables/useMonthGrid'
import { userStore } from '@/apps/calendar/stores/user'
import { fromEventZone } from '@/apps/calendar/utils/datetime'
import dayjs from '@/apps/calendar/utils/dayjs'
import { eventLastDay, isAllDayEvent } from '@/apps/calendar/utils/eventTime'

/**
 * The density behind the sidebar's mini month.
 *
 * That card is a navigation aid: paged to any month, it has to know which of its
 * days have something on them. Reading the main view's events tied it to the
 * window that view happened to fetch, so the ticks simply stopped a month or two
 * out — the days looked empty when they were not.
 *
 * So it asks for its own, from an endpoint that returns only what a tick is made
 * of. One month at a time, cached by month: paging back and forth over the same
 * few months costs one request each, ever.
 */

/** What `get_calendar_event_density` returns per event. */
interface DensityRow {
  start: string
  duration?: string
  time_zone?: string
  show_without_time?: boolean | 0 | 1
  calendars: string[]
  is_declined?: boolean
}

/**
 * The day span an event covers, worked out the same way the grid works it out —
 * the helpers here are the ones `transformEvent` uses, rather than a second
 * reading of all-day-ness and inclusive ends that could disagree with it.
 */
const toGridEvent = (row: DensityRow, color: (calendar: string) => string): GridEvent => {
  const isAllDay = isAllDayEvent(row)
  const start = isAllDay ? dayjs(row.start) : fromEventZone(row.start, row.time_zone)
  const last = isAllDay
    ? (eventLastDay(start, row.duration, true) ?? start)
    : start.add(dayjs.duration(row.duration || 'PT0S'))

  return {
    fromDate: start.format('YYYY-MM-DD'),
    toDate: last.format('YYYY-MM-DD'),
    color: color(row.calendars[0] ?? ''),
    isDeclined: !!row.is_declined,
  }
}

export const useEventDensity = (
  month: () => number,
  year: () => number,
  color: (calendar: string) => string,
) => {
  const store = userStore()

  const density = useQuery(api.calendar.events.density, () => {
    if (!store.accountId) return false
    const first = dayjs(new Date(year(), month(), 1))
    return {
      account: store.accountId,
      from_date: first.subtract(7, 'day').utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
      to_date: first.endOf('month').add(7, 'day').utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
      time_zone: dayjs.tz.guess(),
    }
  })

  return {
    events: computed(() => (density.data ?? []).map((row) => toGridEvent(row, color))),
  }
}
