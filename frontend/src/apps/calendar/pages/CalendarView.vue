<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Calendar, Dialog, createResource, usePageMeta } from 'frappe-ui'

import { raiseToast } from '@/apps/calendar/utils'
import { userStore } from '@/apps/calendar/stores/user'
import AppSidebar from '@/apps/calendar/components/AppSidebar.vue'
import EventPopoverContent from '@/apps/calendar/components/EventPopoverContent.vue'
import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'

const dayjs = inject('$dayjs')

const store = userStore()
const { identities } = store

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
	() => store.account,
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

	if (dayjs().isSame(target, view)) router.replace({ name, params: { accountId } })
	else router.push({ name, params: { accountId, year, month: month + 1, day } })
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
	const start = dayjs(event.start)
	const dur = dayjs.duration(event.duration || 'PT0S')
	const end = start.add(dur)
	const isAllDay =
		start.hour() === 0 &&
		start.minute() === 0 &&
		start.second() === 0 &&
		dur.days() > 0 &&
		dur.hours() === 0 &&
		dur.minutes() === 0 &&
		dur.seconds() === 0

	return {
		...event,
		fromDate: start.format('YYYY-MM-DD'),
		toDate: end.format('YYYY-MM-DD'),
		fromTime: start.format('HH:mm'),
		toTime: end.format('HH:mm'),
		role: getEventRole(event),
		isAllDay,
	}
}

const getEventRole = (event) => {
	if (identities.data?.some((id) => id.email === event.organizer.replace('mailto:', '')))
		return 'Organizer'
	if (
		identities.data?.some((id) =>
			event.participants?.some((p) => p.email.replace('mailto:', '') === id.email),
		)
	)
		return 'Attendee'
	return 'Viewer'
}

const calendars = createResource({
	url: 'suite.calendar.api.get_calendars',
	makeParams: () => ({ account: store.account }),
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
			account: store.account,
			from_date: date.startOf('month').subtract(37, 'day').toDate(),
			to_date: date.endOf('month').add(37, 'day').toDate(),
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

const handleOpenEvent = (e) => {
	Object.assign(event, e)
	showEditEvent.value = true
}

watch(
	() => showEditEvent.value,
	(val) => {
		if (!val) Object.keys(event).forEach((key) => delete event[key])
	},
)

const eventToBeUpdated = reactive({})
const showRecurringEventModal = ref(false)
const isUpdateInstance = ref(false)
const showNotifyModal = ref(false)

const handleUpdate = (e) => {
	Object.assign(eventToBeUpdated, e)
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
			identities.data.every((i) => i.email !== p.email),
		) ?? false,
)

const submitEvent = (sendEmail: boolean) => {
	if (isUpdateInstance.value) {
		return
	}

	eventToBeUpdated.start = dayjs(eventToBeUpdated.fromDateTime).format('YYYY-MM-DDTHH:mm:ss')
	if (!eventToBeUpdated.isAllDay) {
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
	url: 'suite.mail.doctype.calendar_event.calendar_event.update_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		...eventToBeUpdated,
		id: eventToBeUpdated.master_id,
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
					:on-dbl-click="(event) => handleOpenEvent(event)"
					:on-cell-click="(event) => handleOpenEvent(event)"
					@update="handleUpdate"
				>
					<template #event-popover-content="{ calendarEvent, close }">
						<EventPopoverContent
							:calendar-event
							:close
							@edit="handleOpenEvent({ calendarEvent })"
							@reload-events="events.reload()"
						/>
					</template>
				</Calendar>
			</div>
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
