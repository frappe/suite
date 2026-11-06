import { useNow } from '@vueuse/core'
import { defineAsyncComponent, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import CalendarIcon from '@/apps/calendar/AreaIcon.vue'
import { showEventReminder, type EventReminder } from '@/apps/calendar/reminders'
import { holdNewEventDraft, type NewEventDraft } from '@/apps/calendar/utils/newEventDraft'
import type { AreaDefinition } from '@/platform/contracts'
import { realtime, type Realtime } from '@/platform/realtime'
import { hasCapabilities, useSession, type Session } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

/** Calendar scheduling controls and account context used by Meet's scheduler. */
export { default as ParticipantSelector } from './components/ParticipantSelector.vue'
export { userStore as useCalendarUserStore } from './stores/user'
export { default as calendarDayjs } from './utils/dayjs'
export { adjustScheduleEndTime, adjustScheduleStartTime } from './utils/scheduleTime'

export type { CalendarEvent } from '@/apps/calendar/client/events'
export { upcomingEventWindow } from './upcomingWindow'
export type { NewEventDraft } from '@/apps/calendar/utils/newEventDraft'

/**
 * Opens Calendar on a new event filled in from `draft`, for the reader to finish and save. Call it
 * in a component's setup.
 */
export function useNewCalendarEvent(): (draft: NewEventDraft) => Promise<unknown> {
  const router = useRouter()
  return (draft) => {
    holdNewEventDraft(draft)
    // By path: Calendar's routes load with the area, so from elsewhere its route names are unknown.
    return router.push({ path: calendarArea.to, query: { new: '1' } })
  }
}
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
  installable: true,
  phoneNav: defineAsyncComponent(
    () => import('@/apps/calendar/components/mobile/CalendarTabBar.vue'),
  ),
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

export interface EventReminderOptions {
  /** Takes the reader to the event, from the toast's Open action or the system notification. */
  open: (path: string) => void
  session?: Session
  connection?: Pick<Realtime, 'subscribe'>
}

/**
 * Shows each event reminder the server sends (`calendar_alert`) on every page, for a signed-in
 * reader who has Calendar. It listens on the shell's one realtime connection, so no Calendar page
 * has to be open and no area opens a connection of its own for it. Call it once at boot.
 */
export function installEventReminders({
  open,
  session = useSession(),
  connection = realtime,
}: EventReminderOptions): () => void {
  let stopListening: (() => void) | undefined
  const stopWatching = watch(
    () =>
      session.status.value === 'authenticated' && hasCapabilities(calendarArea.requires, session),
    (hasCalendar) => {
      stopListening?.()
      stopListening = hasCalendar
        ? connection.subscribe<EventReminder>('calendar_alert', (reminder) =>
            showEventReminder(reminder, open),
          )
        : undefined
    },
    { immediate: true },
  )
  return () => {
    stopWatching()
    stopListening?.()
  }
}

/** Calendar's Settings group. Loads when Settings opens. */
export const loadCalendarSettings = () =>
  import('@/apps/calendar/settings').then((module) => module.calendarSettings())
