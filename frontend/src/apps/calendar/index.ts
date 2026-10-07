import { useNow } from '@vueuse/core'

import { api, useQuery } from '@/api'
import CalendarIcon from '@/apps/calendar/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

/** Calendar scheduling controls and account context used by Meet's scheduler. */
export { default as ParticipantSelector } from './components/ParticipantSelector.vue'
export { userStore as useCalendarUserStore } from './stores/user'
export { default as calendarDayjs } from './utils/dayjs'
export { adjustScheduleEndTime, adjustScheduleStartTime } from './utils/scheduleTime'

export type { CalendarEvent } from '@/apps/calendar/client/events'
export { useUpcomingEvents } from '@/apps/calendar/client/useUpcomingEvents'
/** Shared upcoming-event presentation; callers supply their own event window and actions. */
export { default as UpcomingEventList } from '@/apps/calendar/components/UpcomingEventList.vue'
export type { UpcomingEventRow } from '@/apps/calendar/components/upcomingEventRow'

export const calendarArea: AreaDefinition = {
  id: 'calendar',
  label: () => __('Calendar'),
  icon: CalendarIcon,
  to: '/calendar',
  requires: ['jmap'],
  badgeNoun: () => __('upcoming'),
  // Ticket 010 owns shell adoption. The existing CalendarLayout keeps its full frame for now.
  loadRoutes: () => import('@/apps/calendar/routes'),
}

// How often the rail asks again. The window starts at "now", so each step is a new question —
// a finished meeting drops out, and the day's last one takes the dot with it.
const SUMMARY_STEP_MS = 5 * 60_000

/**
 * What is left of the reader's day — not cancelled, not declined — across their accounts, for
 * the rail's dot on Calendar. The window is now to the end of the reader's own day, in UTC.
 */
export function useUpcomingSummary(enabled: () => boolean = () => true) {
  const now = useNow({ interval: SUMMARY_STEP_MS })
  return useQuery(api.calendar.events.upcoming, () => {
    if (!enabled()) return false
    const from = new Date(Math.floor(now.value.getTime() / SUMMARY_STEP_MS) * SUMMARY_STEP_MS)
    const to = new Date(from)
    to.setHours(23, 59, 59, 999)
    return { from: from.toISOString(), to: to.toISOString() }
  })
}

/** Calendar's Settings group. Loads when Settings opens. */
export const loadCalendarSettings = () =>
  import('@/apps/calendar/settings').then((module) => module.calendarSettings())
