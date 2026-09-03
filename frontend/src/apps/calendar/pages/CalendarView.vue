<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Dialog, TabButtons, createResource, usePageMeta } from 'frappe-ui'
import { Calendar } from 'frappe-ui/experimental'

import { useScreenSize } from '@/composables/useScreenSize'
import { appPageMeta } from '@/utils/documentTitle'
import { raiseToast } from '@/apps/calendar/utils'
import { fromEventZone } from '@/apps/calendar/utils/datetime'
import { eventLastDay, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { scopeOptions } from '@/apps/calendar/utils/recurringScope'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import { userStore } from '@/apps/calendar/stores/user'
import AppSidebar from '@/apps/calendar/components/AppSidebar.vue'
import EventDetailSidebar from '@/apps/calendar/components/EventDetailSidebar.vue'
import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'
import RecurringScopeModal from '@/apps/calendar/components/Modals/RecurringScopeModal.vue'

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

usePageMeta(() => appPageMeta(calendarRef.value?.currentMonthYear || __('Frappe Calendar'), 'Calendar'))

watch(
	() => [
		calendarRef.value?.currentYear,
		calendarRef.value?.currentMonth,
		calendarRef.value?.currentDay,
	],
	([year, month], [oldYear, oldMonth]) => {
		// Nothing to write while the calendar is not mounted (a hot reload unmounts it).
		if (year == null || month == null) return
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

	// Today's period gets the bare URL. Query carries the open event's deep
	// link; date/view navigation keeps it.
	const location = dayjs().isSame(target, view)
		? { name, params: { accountId }, query: route.query }
		: { name, params: { accountId, year, month: month + 1, day }, query: route.query }

	// Every change of view or period is a history entry, so Back retraces it.
	// The one exception is when the URL already shows this view and period —
	// e.g. a dated URL for today's month collapsing to the bare one — which
	// only re-forms the current entry rather than adding a copy of it.
	const { year: y, month: m, day: d } = route.params
	const current = y && m && d ? dayjs(`${y}-${m}-${d}`, 'YYYY-M-D') : dayjs()
	if (viewForRouteName(route.name) === view && current.isSame(target, view)) router.replace(location)
	else router.push(location)
}

// The URL is the source of truth for view and date. All three view routes
// render this one component, so Back/Forward change the route without a
// remount — the calendar has to be told each time, not just on mount. Only
// what differs is written, which is what keeps this and setRoute (which
// writes the route from the calendar) from chasing each other.
const applyRoute = () => {
	const calendar = calendarRef.value
	if (!calendar) return

	const view = viewForRouteName(route.name)
	if (view && calendar.activeView !== view) calendar.activeView = view

	// A route without a date is today's, the way setRoute writes it.
	const { year, month, day } = route.params
	const date = year && month && day ? dayjs(`${year}-${month}-${day}`, 'YYYY-M-D') : dayjs()
	if (!date.isValid()) return
	if (
		date.year() !== calendar.currentYear ||
		date.month() !== calendar.currentMonth ||
		date.date() !== calendar.currentDay
	)
		calendar.setCalendarDate(date)
}

onMounted(applyRoute)

watch(
	() => [route.name, route.params.year, route.params.month, route.params.day],
	() => applyRoute(),
)

const transformEvent = (event) => {
	// All-day-ness is the event's own flag, or the midnight-to-midnight shape of an invite
	// that arrived without one; either way it is read off the stored wall clock.
	const isAllDay = isAllDayEvent(event)

	// Timed events are placed in the viewer's zone; all-day events keep their calendar date.
	const start = isAllDay ? dayjs(event.start) : fromEventZone(event.start, event.time_zone)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	// The calendar reads `toDate` inclusively, so an all-day event hands over its last day
	// rather than the midnight after it that the stored end points at.
	const lastDay = isAllDay ? (eventLastDay(start, event.duration, true) ?? start) : end

	return {
		...event,
		// The calendar pills render `title` verbatim (frappe-ui hardcodes an italic
		// '[No title]' fallback), so untitled events get their placeholder here.
		// actualTitle keeps the raw value; every path that writes back to the
		// server must restore it (withActualTitle) or the placeholder gets saved.
		title: event.title || __('Untitled event'),
		actualTitle: event.title,
		fromDate: start.format('YYYY-MM-DD'),
		toDate: lastDay.format('YYYY-MM-DD'),
		fromTime: start.format('HH:mm'),
		toTime: end.format('HH:mm'),
		role: getEventRole(event),
		isAllDay,
		isFullDay: isAllDay,
		// The server's `draft` (JMAP isDraft): saved, but nothing sent. The pill draws it
		// as an outline.
		isDraft: !!event.draft,
		// The viewer declined: struck through in the grid.
		isDeclined: !!event.participants?.some(
			(p) => p.participation_status === 'DECLINED' && isOwnEmail(p.email),
		),
	}
}

const isOwnEmail = (email: string) =>
	!!participantIdentities.data?.some((id) => id.email === email?.replace('mailto:', ''))

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

// Calendars carry no colour of their own, so each takes one from the palette by
// position; its events and its dot in the sidebar share it.
const PALETTE = ['green', 'blue', 'violet', 'amber', 'pink', 'cyan', 'orange']
const calendarColor = (name: string) => {
	const index = calendars.data?.findIndex((cal) => cal.name === name) ?? -1
	return PALETTE[Math.max(index, 0) % PALETTE.length]
}
const coloredCalendars = computed(
	() => calendars.data?.map((cal) => ({ ...cal, color: calendarColor(cal.name) })) || [],
)

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
		events.data
			?.filter((event) =>
				event.calendars
					.map((c) => c.calendar)
					.some((cal) => visibleCalendars.value.includes(cal)),
			)
			.map((event) => ({ ...event, color: calendarColor(event.calendars[0]?.calendar) })) || [],
)

const showEditEvent = ref(false)

const event = reactive({})

const withActualTitle = (event) => ({ ...event, title: event.actualTitle })

const handleOpenEvent = (e) => {
	Object.assign(event, e, e.calendarEvent && { calendarEvent: withActualTitle(e.calendarEvent) })
	showEditEvent.value = true

	// Editing an existing event is addressable: ?edit=<id> (never for new-event
	// drafts, which have no id and no restorable form state). Its own key, apart
	// from the detail sidebar's ?event=: the sidebar is derived from that one,
	// so sharing it would open the sidebar under every double-clicked pill.
	const opened = e.calendarEvent
	if (opened?.id && route.query.edit !== opened.id)
		router.replace({
			query: {
				...route.query,
				edit: opened.id,
				editRecurrence: opened.recurrence_id || undefined,
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

/** "August 2026" → the month and its year apart, so the year can be set in a lighter ink. */
const splitYear = (title: string) => {
	const match = /^(.*?)[,\s]*(\d{4})$/.exec(title || '')
	return match ? { label: match[1], year: match[2] } : { label: title, year: '' }
}

// The period the calendar is showing, as it reports it on every change of view or date.
const visibleRange = ref<{ view: string; startDate: string; endDate: string } | null>(null)

// The header names the period in view: the month for Month, the day for Day (the
// calendar's own title serves both), and for Week the days themselves — "Aug 23 – 29",
// or "Aug 30 – Sep 5" when the week straddles two months — rather than a month the
// week only partly belongs to.
const headerTitle = (title: string) => {
	const range = visibleRange.value
	if (range?.view !== 'Week') return splitYear(title)
	const start = dayjs(range.startDate)
	const end = dayjs(range.endDate)
	const endLabel = end.isSame(start, 'month') ? end.format('D') : end.format('MMM D')
	return { label: `${start.format('MMM D')} – ${endLabel}`, year: end.format('YYYY') }
}

// The header's "+ Event" opens on the period in view: starting an event while
// looking at next week should land in next week. Today wins whenever it is on
// screen, so the ordinary case still gets the modal's next-hour default.
const newEventDate = () => {
	const range = visibleRange.value
	if (!range) return new Date()

	const today = dayjs().format('YYYY-MM-DD')
	if (today >= range.startDate && today <= range.endDate) return new Date()

	// The Month strip's first week reaches back into the month before it, so a
	// month in view opens on its own 1st rather than on the strip's first day.
	const start = dayjs(range.startDate)
	return range.view === 'Month' ? start.add(1, 'week').startOf('month').toDate() : start.toDate()
}

// A pill in the grid and a row in the sidebar's upcoming list toggle the
// detail panel the way mail's does: a second click on the open event closes it.
const toggleEventDetail = (calendarEvent) => {
	const open = selectedCalendarEvent.value
	if (
		open &&
		open.id === calendarEvent.id &&
		(open.recurrence_id ?? '') === (calendarEvent.recurrence_id ?? '')
	)
		closeEventDetail()
	else handleEventClick({ calendarEvent })
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
		// Closing the modal drops only its own keys — the detail sidebar (?event=) stays.
		if (route.query.edit) {
			const { edit: _edit, editRecurrence: _rec, ...query } = route.query
			router.replace({ query })
		}
	},
)

// Restore the edit modal from ?edit=<id> (reload, shared link), and close it
// when back/forward removes the param. Guards: never touch an already-open
// modal (events reloading in the background must not stomp form state), and
// never close a NEW-event draft (those carry no calendarEvent and own no query).
watch(
	[() => events.data, () => route.query.edit, () => route.query.editRecurrence],
	([data, id, recurrence]) => {
		if (!id) {
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
const updateScope = ref<RecurringScope>('series')
const showNotifyModal = ref(false)

// The calendar draws a move or resize before it is confirmed here. Until a
// dialog button answers, the change is only on screen: a dialog closed by its
// X or a click outside, or a save that fails, puts the pill back where it was
// by re-syncing the calendar's copy of the events from ours.
let confirmed = false
const revertUpdate = () => calendarRef.value?.reloadEvents()

watch([showRecurringEventModal, showNotifyModal], ([recurring, notify]) => {
	if (!recurring && !notify && !confirmed) revertUpdate()
})

const handleUpdate = (e) => {
	Object.assign(eventToBeUpdated, withActualTitle(e))
	// The series path re-zones the event to the viewer's before it submits; an occurrence's
	// override has to keep the zone the event arrived with.
	eventToBeUpdated.masterTimeZone = e.time_zone
	confirmed = false
	// Each drag asks again. Left standing, the last drag's answer would decide this one — and a
	// one-off event dragged after an instance edit would be written as an override of a series
	// it isn't part of.
	updateScope.value = 'series'
	if (e.recurrence_id) showRecurringEventModal.value = true
	else handleUpdateEvent()
}

const handleUpdateRecurringEvent = (scope: RecurringScope) => {
	updateScope.value = scope
	showRecurringEventModal.value = false
	handleUpdateEvent()
}

const handleUpdateEvent = () => {
	// A draft has sent nothing, so there is no one to notify of a move.
	if (hasParticipantsOtherThanUser.value && !eventToBeUpdated.isDraft) showNotifyModal.value = true
	else submitEvent(false)
}

const hasParticipantsOtherThanUser = computed(
	() =>
		eventToBeUpdated.participants?.some((p) =>
			participantIdentities.data.every((i) => i.email !== p.email),
		) ?? false,
)

const submitEvent = (sendEmail: boolean) => {
	confirmed = true
	showNotifyModal.value = false
	// Splitting a series is still to come, and the dialog greys that answer out. If it is
	// reached anyway the move is undone rather than left on screen as if it had been saved.
	if (updateScope.value === 'following') return revertUpdate()

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

	// One occurrence moved on its own: the series keeps its rule and this date gets an
	// override. The series is addressed by master_id and the occurrence within it by its
	// recurrence id — the start it was expanded at, which the drag leaves alone. The id the
	// grid holds is no use for that: the server derives it from the occurrence's position in
	// the expansion, and a later override renumbers it onto a different date.
	if (updateScope.value === 'instance') return editEventInstance.submit({ sendEmail })

	editEvent.submit({ sendEmail })
}

// The dragged numbers are a wall clock in the viewer's zone; an occurrence keeps the series'
// zone, so the instant is re-expressed in it. An all-day occurrence has no clock to convert.
const instanceStart = () => {
	const eventZone = eventToBeUpdated.masterTimeZone || eventToBeUpdated.time_zone
	if (eventToBeUpdated.isAllDay || !eventZone || !dayjs?.tz) return eventToBeUpdated.start
	return dayjs
		.tz(eventToBeUpdated.fromDateTime, dayjs.tz.guess())
		.tz(eventZone)
		.format('YYYY-MM-DD[T]HH:mm:ss')
}

// Both writes land the same way: the calendar has already drawn the move, so success only has
// to confirm it and refresh, and a failure has to put the pill back where it was.
const onEventSaved = {
	onSuccess: () => {
		raiseToast(__('Event updated.'), 'success')
		events.reload()
	},
	onError: (error) => {
		revertUpdate()
		raiseToast(error.message, 'error')
	},
}

const editEventInstance = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: eventToBeUpdated.account,
		master_id: eventToBeUpdated.master_id,
		recurrence_id: eventToBeUpdated.recurrence_id,
		// Only what a drag can change, and never the zone: an occurrence is keyed by the start
		// it was expanded at, and a zone here makes the server re-key it into that zone while
		// the override stays under the old key — the two stop matching and the occurrence
		// keeps nothing the series says. The dragged wall clock is converted instead.
		patch: {
			start: instanceStart(),
			duration: eventToBeUpdated.duration,
		},
		send_scheduling_messages: sendEmail,
	}),
	...onEventSaved,
})

const editEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		...eventToBeUpdated,
		// master_id is only set on recurring events; fall back to the event's own id
		id: eventToBeUpdated.master_id || eventToBeUpdated.id,
		send_scheduling_messages: sendEmail,
	}),
	...onEventSaved,
})

const recurringScopeModalProps = computed(() => ({
	title: __('Update repeating event'),
	// Splitting a series is the one answer nothing can carry yet.
	options: scopeOptions({ unavailable: ['following'] }),
	confirmLabel: __('Update'),
	loading: editEvent.loading || editEventInstance.loading,
}))

const NOTIFY_MODAL_OPTIONS = {
	title: __('Notify Participants'),
	icon: { name: 'lucide-bell' },
	message: __('Send an email to let attendees know this event has been updated?'),
}
</script>

<template>
	<div class="flex h-screen min-h-0 w-full min-w-0 flex-col">
		<div class="flex min-h-0 min-w-0 flex-1">
			<AppSidebar
				:calendars="coloredCalendars"
				:visible-calendars
				:month="calendarRef?.currentMonth"
				:year="calendarRef?.currentYear"
				:day="calendarRef?.currentDay"
				:view="calendarRef?.activeView"
				:events="visibleEvents"
				:selected-event="selectedCalendarEvent"
				@update:visible-calendars="
					(name) =>
						visibleCalendars.includes(name)
							? visibleCalendars.splice(visibleCalendars.indexOf(name), 1)
							: visibleCalendars.push(name)
				"
				@select-date="(date) => calendarRef?.setCalendarDate(date)"
				@select-event="toggleEventDetail"
			/>
			<div class="min-h-0 min-w-0 flex-1 p-4">
				<Calendar
					ref="calendar"
					:events="visibleEvents"
					:config="{ isEditMode: true }"
					:on-click="({ calendarEvent }) => toggleEventDetail(calendarEvent)"
					:on-dbl-click="(event) => handleOpenEvent(event)"
					:on-cell-click="(event) => handleOpenEvent(event)"
					@update="handleUpdate"
					@range-change="(range) => (visibleRange = range)"
				>
					<!-- The month is a label, not a picker: the sidebar's mini month is
					     where a date gets chosen. The year sits beside it, muted. -->
					<template
						#header="{ currentMonthYear, enabledModes, activeView, decrement, increment, updateActiveView, setCalendarDate }"
					>
						<!-- Navigation leads: back, Today, forward, then the title they change,
						     so the title's length moves nothing. New event sits at the far
						     right, past the view switcher. -->
						<div class="mb-2 flex items-center justify-between">
							<div class="flex items-center gap-x-1">
								<Button variant="ghost" icon="lucide-chevron-left" @click="decrement" />
								<Button variant="ghost" :label="__('Today')" @click="setCalendarDate()" />
								<Button variant="ghost" icon="lucide-chevron-right" @click="increment" />
								<div class="flex items-baseline gap-1.5 px-2 text-lg leading-5">
									<span class="font-medium text-ink-gray-9">{{ headerTitle(currentMonthYear).label }}</span>
									<span v-if="headerTitle(currentMonthYear).year" class="text-ink-gray-4">
										{{ headerTitle(currentMonthYear).year }}
									</span>
								</div>
							</div>
							<div class="flex items-center gap-x-2">
								<TabButtons
									:options="enabledModes"
									:model-value="activeView"
									@update:model-value="(view) => updateActiveView(view)"
								/>
								<Button
									variant="solid"
									icon-left="lucide-calendar-plus"
									:label="__('Event')"
									@click="handleOpenEvent({ date: newEventDate() })"
								/>
							</div>
						</div>
					</template>
				</Calendar>
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
	<RecurringScopeModal
		v-model="showRecurringEventModal"
		v-bind="recurringScopeModalProps"
		@confirm="handleUpdateRecurringEvent"
	/>
	<Dialog v-model:open="showNotifyModal" v-bind="NOTIFY_MODAL_OPTIONS">
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
