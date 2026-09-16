import { effectScope, ref, watch } from 'vue'
import { createResource } from 'frappe-ui'

import dayjs from '@/apps/calendar/utils/dayjs'
import { isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { userStore as calendarUserStore } from '@/apps/calendar/stores/user'
import { userStore } from '@/apps/mail/stores/user'

// Module singletons: the sidebar widget renders the list while DefaultLayout
// hosts the detail card, so both need the same resource and selection.
const selectedEvent = ref<any>(null)
let events: any = null

/**
 * What the card hangs on, and which side of it: the row in the sidebar's
 * Upcoming events widget, to its right, or the invite strip's button in a
 * message, beneath it. Set by whoever opens the event; an open that brings no
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

// The widget's own list is a today-only slice of the calendar, so an event
// picked from it can be kept in step with the resource below. An event opened
// from anywhere else — mail's invite strip, whose event sits on whatever date
// the invite names — usually isn't in that slice at all, and `tracked: false`
// stops a reload from reading its absence as "deleted" and closing the card.
const openEvent = (
	event: any,
	{ tracked = true, anchor }: { tracked?: boolean; anchor?: CardAnchor } = {},
) => {
	if (anchor) cardAnchor.value = anchor
	selectedEvent.value = { ...withInstanceDate(event), _tracked: tracked }
}

export function useUpcomingEvents() {
	if (!events) {
		// Detached scope: the resource and watchers must outlive whichever
		// component happened to touch the composable first.
		effectScope(true).run(() => {
			const store = userStore()

			events = createResource({
				url: 'suite.calendar.api.get_calendar_events',
				makeParams: () => ({
					account: store.accountId,
					from_date: dayjs().startOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
					to_date: dayjs().endOf('day').format('YYYY-MM-DD[T]HH:mm:ss'),
					time_zone: timezone(),
				}),
			})

			// The layout's setup can run before the user resource has resolved an
			// account, so fetch on accountId becoming available, not on creation.
			watch(
				() => store.accountId,
				(id) => {
					selectedEvent.value = null
					if (id) events.reload()
				},
				{ immediate: true },
			)

			// The detail card reads RSVP identity from the calendar app's user
			// store; initialize it on first open rather than on every mail load.
			// Closing lets go of the anchor too, so the next open cannot land on a
			// stale one.
			watch(selectedEvent, (event) => (event ? calendarUserStore() : (cardAnchor.value = null)))

			// Keep the detail card in sync after edits/RSVPs (mirrors
			// CalendarView): swap in the fresh copy of the selected event, or close
			// it if the event no longer exists.
			watch(
				() => events.data,
				(data) => {
					if (!selectedEvent.value?._tracked || !data) return
					const fresh = data.find(
						(e: any) =>
							e.id === selectedEvent.value.id &&
							e.recurrence_id === selectedEvent.value.recurrence_id,
					)
					selectedEvent.value = fresh ? { ...withInstanceDate(fresh), _tracked: true } : null
				},
			)
		})
	}

	return { events, selectedEvent, openEvent, cardAnchor }
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
