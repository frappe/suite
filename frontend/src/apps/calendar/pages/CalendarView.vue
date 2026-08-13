<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Calendar, Dialog, createResource, usePageMeta } from 'frappe-ui'

import { useScreenSize } from '@/composables/useScreenSize'
import { raiseToast } from '@/apps/calendar/utils'
import { fromEventZone } from '@/apps/calendar/utils/datetime'
import { userStore } from '@/apps/calendar/stores/user'
import AppSidebar from '@/apps/calendar/components/AppSidebar.vue'
import EventDetailSidebar from '@/apps/calendar/components/EventDetailSidebar.vue'
import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'

const dayjs = inject('$dayjs')

const store = userStore()
const { participantIdentities } = store
const { isMobile } = useScreenSize()

const route = useRoute()
const router = useRouter()

const calendarRef = useTemplateRef('calendar')

// Calendar's `activeView` is 'Month' | 'Week' | 'Day'; the suite router uses
// namespaced names 'calendar-month' | 'calendar-week' | 'calendar-day'.
const VIEW_TO_ROUTE = { Month: 'calendar-month', Week: 'calendar-week', Day: 'calendar-day' }
const ROUTE_TO_VIEW = { 'calendar-month': 'Month', 'calendar-week': 'Week', 'calendar-day': 'Day' }
const routeNameForView = (view) => VIEW_TO_ROUTE[view as keyof typeof VIEW_TO_ROUTE]
const viewForRouteName = (name) => ROUTE_TO_VIEW[name as keyof typeof ROUTE_TO_VIEW]

usePageMeta(() => ({ title: calendarRef.value?.currentMonthYear || __('Frappe Calendar') }))

watch(
	() => [
		calendarRef.value?.currentYear,
		calendarRef.value?.currentMonth,
		calendarRef.value?.currentDay,
	],
	([year, month], [oldYear, oldMonth]) => {
		if (year !== oldYear || month !== oldMonth) events.reload()
		setRoute()
	},
)

watch(
	() => calendarRef.value?.activeView,
	(view) => {
		if (view && routeNameForView(view) !== route.name) setRoute()
	},
)

watch(
	() => store.accountId,
	() => {
		calendars.reload()
		events.reload()
	},
)

const setRoute = () => {
	const year = calendarRef.value?.currentYear
	const month = calendarRef.value?.currentMonth
	const day = calendarRef.value?.currentDay

	const target = dayjs().year(year).month(month).date(day)
	const view = calendarRef.value?.activeView as 'Month' | 'Week' | 'Day'
	const name = routeNameForView(view)
	const accountId = route.params.accountId

	// Query carries the open event's deep link; date/view navigation keeps it.
	if (dayjs().isSame(target, view))
		router.replace({ name, params: { accountId }, query: route.query })
	else router.push({ name, params: { accountId, year, month: month + 1, day }, query: route.query })
}

onMounted(() => {
	const view = viewForRouteName(route.name)
	if (view && calendarRef.value) calendarRef.value.activeView = view

	const { year, month, day } = route.params
	if (year && month && day) {
		const date = dayjs(`${year}-${month}-${day}`, 'YYYY-M-D')
		if (date.isValid()) calendarRef.value.setCalendarDate(date)
	}
})

const transformEvent = (event) => {
	// The all-day heuristic reads the stored wall clock (midnight in the event's own zone).
	const rawStart = dayjs(event.start)
	const dur = dayjs.duration(event.duration || 'PT0S')
	const isAllDay =
		rawStart.hour() === 0 &&
		rawStart.minute() === 0 &&
		rawStart.second() === 0 &&
		dur.days() > 0 &&
		dur.hours() === 0 &&
		dur.minutes() === 0 &&
		dur.seconds() === 0

	// Timed events are placed in the viewer's zone; all-day events keep their calendar date.
	const start = isAllDay ? rawStart : fromEventZone(event.start, event.time_zone)
	const end = start.add(dur)

	return {
		...event,
		// The calendar pills render `title` verbatim (frappe-ui hardcodes an italic
		// '[No title]' fallback), so untitled events get their placeholder here.
		// actualTitle keeps the raw value; every path that writes back to the
		// server must restore it (withActualTitle) or the placeholder gets saved.
		title: event.title || __('Untitled event'),
		actualTitle: event.title,
		fromDate: start.format('YYYY-MM-DD'),
		toDate: end.format('YYYY-MM-DD'),
		fromTime: start.format('HH:mm'),
		toTime: end.format('HH:mm'),
		role: getEventRole(event),
		isAllDay,
	}
}

const getEventRole = (event) => {
	if (participantIdentities.data?.some((id) => id.email === event.organizer.replace('mailto:', '')))
		return 'Organizer'
	if (
		participantIdentities.data?.some((id) =>
			event.participants?.some((p) => p.email.replace('mailto:', '') === id.email),
		)
	)
		return 'Attendee'
	return 'Viewer'
}

const calendars = createResource({
	url: 'suite.calendar.api.get_calendars',
	makeParams: () => ({ account: store.accountId }),
	auto: true,
	onSuccess: (data) => (visibleCalendars.value = data.map((cal) => cal.name)),
	onError: (error) => raiseToast(error.message, 'error'),
})

const visibleCalendars = ref<string[]>([])

const events = createResource({
	url: 'suite.calendar.api.get_calendar_events',
	makeParams: () => {
		const date = dayjs()
			.year(calendarRef.value?.currentYear)
			.month(calendarRef.value?.currentMonth)
		return {
			account: store.accountId,
			from_date: date.startOf('month').subtract(37, 'day').utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			to_date: date.endOf('month').add(37, 'day').utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			time_zone: dayjs.tz.guess(),
		}
	},
	transform: (data) => data.map(transformEvent),
	onError: (error) => raiseToast(error.message, 'error'),
})

const visibleEvents = computed(
	() =>
		events.data?.filter((event) =>
			event.calendars
				.map((c) => c.calendar)
				.some((cal) => visibleCalendars.value.includes(cal)),
		) || [],
)

const showEditEvent = ref(false)

const event = reactive({})

const withActualTitle = (event) => ({ ...event, title: event.actualTitle })

const handleOpenEvent = (e) => {
	Object.assign(event, e, e.calendarEvent && { calendarEvent: withActualTitle(e.calendarEvent) })
	showEditEvent.value = true

	// Editing an existing event is addressable: ?event=<id>&edit=1 (never for
	// new-event drafts, which have no id and no restorable form state).
	const opened = e.calendarEvent
	if (opened?.id && (route.query.edit !== '1' || route.query.event !== opened.id))
		router.replace({
			query: {
				...route.query,
				event: opened.id,
				recurrence: opened.recurrence_id || undefined,
				edit: '1',
			},
		})
}

// --- Event detail sidebar ---

const selectedCalendarEvent = ref(null)

// The open event lives in the URL (?event=<id>, plus &recurrence=<id> for a
// recurring instance): clicking a pill writes it, closing clears it, and the
// selection is DERIVED from it below — so event links are shareable, survive
// reload, and back/forward toggles the panel. Deriving from events.data also
// keeps the sidebar in sync after edits/RSVPs (fresh copy swapped in, closed
// while the event is deleted or outside the fetched range).
const handleEventClick = ({ calendarEvent }) =>
	router.replace({
		query: {
			...route.query,
			event: calendarEvent.id,
			recurrence: calendarEvent.recurrence_id || undefined,
		},
	})

const closeEventDetail = () => {
	const { event: _event, recurrence: _recurrence, ...query } = route.query
	router.replace({ query })
}

// The calendar app has no compose surface of its own — hand over to mail's
// compose window via its deep link (mailto: would depend on the OS having a
// mail handler; the suite IS the mail client). Path, not route name: mail's
// routes register lazily on first navigation into /mail.
const emailParticipants = (emails: string[]) => {
	router.push({ path: '/mail', query: { compose: '1', to: emails.join(',') } })
}

// A deep link can only be built from the ids its author has. The grid's own
// events come out of a recurrence-expanded query, so each carries a synthetic
// per-instance id and wears the real event's id as `master_id` — but mail's
// invite strip resolves an invite's UID to that master id, which matches
// nothing here. So a link that misses on id falls back to the master, narrowed
// to the instance covering the routed day (the day the link itself picked).
const findLinkedEvent = (data, id, recurrence) => {
	if (!data || !id) return null

	const rec = (recurrence as string) ?? ''
	const exact = data.find((e) => e.id === id && (e.recurrence_id ?? '') === rec)
	if (exact) return exact

	const instances = data.filter((e) => e.master_id === id)
	if (!instances.length) return null
	if (rec) return instances.find((e) => (e.recurrence_id ?? '') === rec) ?? null

	const { year, month, day } = route.params
	const routed = year && month && day ? dayjs(`${year}-${month}-${day}`, 'YYYY-M-D') : null
	if (!routed?.isValid()) return instances[0]

	const routedDay = routed.format('YYYY-MM-DD')
	return instances.find((e) => e.fromDate <= routedDay && routedDay <= e.toDate) ?? instances[0]
}

watch(
	[() => events.data, () => route.query.event, () => route.query.recurrence],
	([data, id, recurrence]) => {
		selectedCalendarEvent.value = findLinkedEvent(data, id, recurrence)
	},
	{ immediate: true },
)

watch(
	() => showEditEvent.value,
	(val) => {
		if (val) return
		Object.keys(event).forEach((key) => delete event[key])
		// Closing the modal drops only `edit` — the detail sidebar (?event=) stays.
		if (route.query.edit) {
			const { edit: _edit, ...query } = route.query
			router.replace({ query })
		}
	},
)

// Restore the edit modal from ?edit=1 (reload, shared link), and close it when
// back/forward removes the param. Guards: never touch an already-open modal
// (events reloading in the background must not stomp form state), and never
// close a NEW-event draft (those carry no calendarEvent and own no query).
watch(
	[() => events.data, () => route.query.event, () => route.query.recurrence, () => route.query.edit],
	([data, id, recurrence, edit]) => {
		if (!edit || !id) {
			if (showEditEvent.value && event.calendarEvent) showEditEvent.value = false
			return
		}
		if (showEditEvent.value) return
		const match = findLinkedEvent(data, id, recurrence)
		if (match) handleOpenEvent({ calendarEvent: match })
	},
	{ immediate: true },
)

const eventToBeUpdated = reactive({})
const showRecurringEventModal = ref(false)
const isUpdateInstance = ref(false)
const showNotifyModal = ref(false)

const handleUpdate = (e) => {
	Object.assign(eventToBeUpdated, withActualTitle(e))
	if (e.recurrence_id) showRecurringEventModal.value = true
	else handleUpdateEvent()
}

const handleUpdateRecurringEvent = (updateInstance: boolean) => {
	isUpdateInstance.value = updateInstance
	showRecurringEventModal.value = false
	handleUpdateEvent()
}

const handleUpdateEvent = () => {
	if (hasParticipantsOtherThanUser.value) showNotifyModal.value = true
	else submitEvent(false)
}

const hasParticipantsOtherThanUser = computed(
	() =>
		eventToBeUpdated.participants?.some((p) =>
			participantIdentities.data.every((i) => i.email !== p.email),
		) ?? false,
)

const submitEvent = (sendEmail: boolean) => {
	if (isUpdateInstance.value) {
		return
	}

	eventToBeUpdated.start = dayjs(eventToBeUpdated.fromDateTime).format('YYYY-MM-DDTHH:mm:ss')
	if (!eventToBeUpdated.isAllDay) {
		// The dragged wall clock is in the viewer's zone; re-zone the event to match, or the
		// same numbers would be reinterpreted in the event's original zone.
		eventToBeUpdated.time_zone = dayjs.tz.guess()
		const start = dayjs(eventToBeUpdated.fromDateTime)
		const end = dayjs(eventToBeUpdated.toDateTime)
		const diff = dayjs.duration(end.diff(start))
		const hours = Math.floor(diff.asHours())
		const minutes = diff.minutes()
		eventToBeUpdated.duration = dayjs.duration({ hours, minutes }).toISOString()
	}
	editEvent.submit({ sendEmail })
}

const editEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		...eventToBeUpdated,
		// master_id is only set on recurring events; fall back to the event's own id
		id: eventToBeUpdated.master_id || eventToBeUpdated.id,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: () => {
		raiseToast(__('Event updated.'), 'success')
		events.reload()
	},
})

const RECURRING_EVENT_MODAL_OPTIONS = {
	title: __('Update Recurring Event'),
	icon: { name: 'repeat' },
	message: __('Do you want to update just this instance, or all events in the series?'),
}

const NOTIFY_MODAL_OPTIONS = {
	title: __('Notify Participants'),
	icon: { name: 'bell' },
	message: __('Send an email to let attendees know this event has been updated?'),
}
</script>

<template>
	<div class="flex h-screen min-h-0 w-full min-w-0 flex-col">
		<div class="flex min-h-0 min-w-0 flex-1">
			<AppSidebar
				:calendars="calendars?.data || []"
				:visible-calendars
				@update:visible-calendars="
					(name) =>
						visibleCalendars.includes(name)
							? visibleCalendars.splice(visibleCalendars.indexOf(name), 1)
							: visibleCalendars.push(name)
				"
			/>
			<div class="min-h-0 min-w-0 flex-1 p-4">
				<Calendar
					ref="calendar"
					:events="visibleEvents"
					:config="{ isEditMode: true }"
					:on-click="handleEventClick"
					:on-dbl-click="(event) => handleOpenEvent(event)"
					:on-cell-click="(event) => handleOpenEvent(event)"
					@update="handleUpdate"
				/>
			</div>
			<!-- Desktop only: it is a side panel with a fixed width, so on a phone it
			     covered the grid it is meant to sit beside. The selection still happens
			     (?event= stays in the URL, so a shared link still names its event),
			     there is just nowhere to show it until this gets a sheet of its own. -->
			<EventDetailSidebar
				v-if="selectedCalendarEvent && !isMobile"
				:key="selectedCalendarEvent.id + (selectedCalendarEvent.recurrence_id ?? '')"
				:calendar-event="selectedCalendarEvent"
				@close="closeEventDetail"
				@edit="handleOpenEvent({ calendarEvent: selectedCalendarEvent })"
				@reload-events="events.reload()"
				@email-participants="emailParticipants"
			/>
		</div>
	</div>
	<EventModal v-model="showEditEvent" :selected-event="event" @reload-events="events.reload()" />
	<Dialog v-model="showRecurringEventModal" :options="RECURRING_EVENT_MODAL_OPTIONS">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button @click="handleUpdateRecurringEvent(false)">
					{{ __('Entire series') }}
				</Button>
			</div>
		</template>
	</Dialog>
	<Dialog v-model="showNotifyModal" :options="NOTIFY_MODAL_OPTIONS">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button variant="outline" @click="submitEvent(false)"> {{ __('Skip') }} </Button>
				<Button variant="solid" @click="submitEvent(true)">
					{{ __('Send Email') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>
