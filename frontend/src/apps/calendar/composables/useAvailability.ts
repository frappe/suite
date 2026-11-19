import { refDebounced } from '@vueuse/core'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import {
  busyEmails,
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

/** The mail server's own cap on an event's attendees, and the longest stretch looked up. */
const MAX_PEOPLE = 20
const MAX_SPAN_DAYS = 14

const UTC = 'YYYY-MM-DDTHH:mm:ss[Z]'

export interface AvailabilitySource {
  form: () => FormTimes & { participants?: { email: string }[] }
  /** The account the form writes to. */
  account: () => string | undefined
  /** The event being edited, which never conflicts with itself. */
  uid: () => string | undefined
  calendars: () => AvailabilityCalendar[] | undefined
  ownEmails: () => string[]
}

/**
 * What the event form says about time already taken: the writer's own events in it, and which
 * of the people invited are busy then. See specs/calendar/002-availability.md.
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

  const lookup = computed(() => {
    const account = source.account()
    if (!account || !span.value) return false
    if (span.value.end.diff(span.value.start, 'day', true) > MAX_SPAN_DAYS) return false
    const own = new Set(source.ownEmails().map((email) => email.toLowerCase()))
    const emails = [
      ...new Set((source.form().participants ?? []).map((p) => p.email.toLowerCase())),
    ].filter((email) => !own.has(email))
    if (!emails.length || emails.length > MAX_PEOPLE) return false
    return JSON.stringify({
      account,
      emails: emails.sort(),
      utc_start: span.value.start.utc().format(UTC),
      utc_end: span.value.end.utc().format(UTC),
    })
  })
  // Asked once the time and the people stop changing, not on every step of a picker.
  const settled = refDebounced(lookup, 500)
  const people = useQuery(api.calendar.availability.participants, () =>
    settled.value && settled.value === lookup.value ? JSON.parse(settled.value) : false,
  )

  const busy = computed(() =>
    span.value && people.data && lookup.value
      ? busyEmails(people.data, span.value)
      : new Set<string>(),
  )

  return { conflicts, busy }
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
