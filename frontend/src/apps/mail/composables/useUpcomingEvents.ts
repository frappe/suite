import { effectScope, ref, watch } from 'vue'

import { userStore as calendarUserStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { userStore } from '@/apps/mail/stores/user'

// Module singletons: the invite strip opens an event while DefaultLayout hosts
// the detail card, so both need the same selection.
const selectedEvent = ref<any>(null)
let started = false

/**
 * What the card hangs on, and which side of it: the invite strip's button in
 * a message, beneath it. Set by whoever opens the event; an open that brings no
 * anchor — the strip handing over a fresh copy after an RSVP — keeps the one
 * the card already has.
 */
export type CardAnchor = { element: Element; side: 'right' | 'bottom' }
const cardAnchor = ref<CardAnchor | null>(null)

const timezone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone

// The detail card's "delete following instances" path reads `date` (the
// clicked instance's day, attached by the calendar grid in the calendar app);
// derive it from the instance start here.
const withInstanceDate = (event: any) => ({
  ...event,
  date: dayjs(event.start).format('YYYY-MM-DD'),
})

const openEvent = (event: any, { anchor }: { anchor?: CardAnchor } = {}) => {
  if (anchor) cardAnchor.value = anchor
  selectedEvent.value = withInstanceDate(event)
}

export function useUpcomingEvents() {
  if (!started) {
    started = true
    // Detached scope: the watchers must outlive whichever component happened
    // to touch the composable first.
    effectScope(true).run(() => {
      const store = userStore()

      // Another account's mail is another account's invites: close the card.
      watch(
        () => store.accountId,
        () => (selectedEvent.value = null),
      )

      // The detail card reads RSVP identity from the calendar app's user
      // store; initialize it on first open rather than on every mail load.
      // Closing lets go of the anchor too, so the next open cannot land on a
      // stale one.
      watch(selectedEvent, (event) => (event ? calendarUserStore() : (cardAnchor.value = null)))
    })
  }

  return { selectedEvent, openEvent, cardAnchor }
}

// Day view of the calendar app on the event's start date (1-indexed month),
// deep-linked to the event itself (?event=) so its detail card opens on
// arrival. The edit modal has its own address, ?edit=<id> (&editRecurrence=).
// By PATH, not route name: the suite router registers each app's routes
// lazily on the first navigation into its prefix, so a named push from mail
// finds no match until the calendar has been visited — and silently no-ops.
export const eventDayRoute = (event: any, accountId: string) => {
  // JSCalendar `start` is a wall clock in the event's own zone and the calendar draws it in the
  // reader's, so the day has to be converted too or the link lands a day off either side of
  // midnight. All-day events keep their own date — moving their midnight would slide them.
  // Mirrors @/apps/calendar/utils/datetime's fromEventZone, minus its calendar-store fallback:
  // this runs inside mail.
  const start =
    event.time_zone && !isAllDayEvent(event)
      ? dayjs.tz(event.start, event.time_zone).tz(timezone())
      : dayjs(event.start)
  const day = `${start.year()}/${start.month() + 1}/${start.date()}`
  return {
    path: `/calendar/account/${encodeURIComponent(accountId)}/day/${day}`,
    query: { event: event.id, recurrence: event.recurrence_id || undefined },
  }
}
