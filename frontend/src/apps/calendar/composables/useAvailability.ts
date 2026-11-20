import { computed } from 'vue'

import { api, useQuery } from '@/api'
import {
  eventSpan,
  formSpan,
  ownConflicts,
  type AvailabilityCalendar,
  type BusyCandidate,
  type FormTimes,
} from '@/apps/calendar/utils/availability'
import { utcDayEnd, utcDayStart } from '@/apps/calendar/utils/datetime'
import { isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { userTimeZone } from '@/platform/time-zone'

export interface AvailabilitySource {
  form: () => FormTimes
  /** The account the form writes to. */
  account: () => string | undefined
  /** The event being edited, which never conflicts with itself. */
  uid: () => string | undefined
  calendars: () => AvailabilityCalendar[] | undefined
  ownEmails: () => string[]
}

/**
 * The writer's own events in the time the event form holds. See
 * specs/calendar/002-availability.md.
 */
export function useAvailability(source: AvailabilitySource) {
  const span = computed(() => formSpan(source.form()))

  // Whole days around the time, so moving it within a day asks for nothing new.
  const ownWindow = computed(() => {
    const form = source.form()
    const account = source.account()
    if (!account || !span.value) return false
    return {
      account,
      from_date: utcDayStart(form.startDate),
      to_date: utcDayEnd(form.endDate),
      time_zone: userTimeZone(),
    }
  })
  const ownEvents = useQuery(api.calendar.events.window, () => ownWindow.value)

  const conflicts = computed(() => {
    const account = source.account()
    if (!account || !span.value || !ownEvents.data) return []
    return ownConflicts(ownEvents.data, span.value, {
      account,
      ownEmails: source.ownEmails(),
      calendars: source.calendars() ?? [],
      uid: source.uid(),
    })
  })

  return { conflicts }
}

/** When a conflict is, on the writer's own clock: its hours, or "all day". */
export function conflictWhen(event: BusyCandidate) {
  if (isAllDayEvent({ ...event, show_without_time: !!event.show_without_time }))
    return __('all day')
  const span = eventSpan(event)
  const start = span.start.tz(userTimeZone())
  const end = span.end.tz(userTimeZone())
  const format = start.isSame(end, 'day') ? 'h:mm A' : 'MMM D, h:mm A'
  return `${start.format(format)} – ${end.format(format)}`
}
