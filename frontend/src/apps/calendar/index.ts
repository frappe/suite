import CalendarIcon from '@/apps/calendar/AreaIcon.vue'
import type { AreaDefinition } from '@/platform/contracts'
import { translate as __ } from '@/platform/translation'

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
  // Ticket 010 owns shell adoption. The existing CalendarLayout keeps its full frame for now.
  loadRoutes: () => import('@/apps/calendar/routes'),
}

/** Calendar's Settings group. Loads when Settings opens. */
export const loadCalendarSettings = () =>
  import('@/apps/calendar/settings').then((module) => module.calendarSettings())
