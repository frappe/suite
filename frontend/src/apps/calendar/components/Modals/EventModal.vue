<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch } from 'vue'
import { AlignLeft, Bell, Briefcase, Clock, Copy, MapPin, Users, X } from 'lucide-vue-next'
import { Button, Dialog, Dropdown, FormControl, Switch, createResource, toast } from 'frappe-ui'

import meetLogo from '@/assets/app-logos/meet.png'
import { getMeetUrl, getReorderedParticipants } from '@/apps/calendar/utils'
import { fromEventZone, fromWallClock, inUserTimeZone } from '@/apps/calendar/utils/datetime'
import { getRepeatMessage } from '@/apps/calendar/utils/format'
import { userStore } from '@/apps/calendar/stores/user'
import EventAlertList from '@/apps/calendar/components/EventAlertList.vue'
import ParticipantSelector from '@/apps/calendar/components/ParticipantSelector.vue'
import EventRepeatSettingsModal from '@/apps/calendar/components/Modals/EventRepeatSettingsModal.vue'

const show = defineModel<boolean>()
const { selectedEvent } = defineProps<{ selectedEvent: any }>()
const emit = defineEmits(['reloadEvents'])

const user = inject('$user')
const dayjs = inject('$dayjs')
const store = userStore()
const { participantIdentities } = store

const isNew = computed(() => !selectedEvent?.calendarEvent)

// --- Event initialization ---

const getEventData = () => {
	if (isNew.value) return getDefaultEventData()

	const { calendarEvent: ev } = selectedEvent
	// Timed events edit in the viewer's zone (saving re-zones them to it, see eventParams);
	// all-day events keep their calendar date.
	const start = ev.isAllDay ? dayjs(ev.start) : fromEventZone(ev.start, ev.time_zone)
	const end = start.add(dayjs.duration(ev.duration))
	const displayEnd = ev.isAllDay ? end.subtract(1, 'day') : end

	return {
		title: ev.title || '',
		organizer: ev.organizer,
		isAllDay: ev.isAllDay,
		repeat: !!ev.recurrence_rule?.frequency,
		startDate: start.format('YYYY-MM-DD'),
		startTime: start.format('HH:mm'),
		endDate: displayEnd.format('YYYY-MM-DD'),
		endTime: end.format('HH:mm'),
		free_busy_status: ev.free_busy_status,
		privacy: ev.privacy || 'Public',
		locations: ev.locations.map((l) => l._name),
		links: ev.links ? [...ev.links] : [],
		alerts: ev.alerts?.map(parseAlert) ?? [],
		description: ev.description || '',
		participants: [...ev.participants],
		recurrence_rule: ev.recurrence_rule,
		addMeetLink: hasMeetLink(ev),
	}
}

// How long an event runs when the end hasn't been set by hand.
const DEFAULT_DURATION_MINUTES = 60

const getDefaultEventData = () => {
	const startTime = selectedEvent?.time
		? dayjs(selectedEvent.time, 'h a').format('HH:mm')
		: dayjs(selectedEvent.date).isToday()
			? dayjs().add(1, 'hour').startOf('hour').format('HH:mm')
			: '10:00'

	return {
		title: '',
		organizer: user.data.name,
		isAllDay: !selectedEvent?.time,
		repeat: false,
		startDate: dayjs(selectedEvent.date).format('YYYY-MM-DD'),
		startTime,
		endDate: dayjs(selectedEvent.date).format('YYYY-MM-DD'),
		endTime: dayjs(startTime, 'HH:mm').add(DEFAULT_DURATION_MINUTES, 'minute').format('HH:mm'),
		locations: [],
		links: [],
		alerts: [],
		description: '',
		free_busy_status: 'Busy',
		privacy: 'Public',
		participants: [
			{
				email: user.data.name,
				user_image: user.data.user_image,
				_name: user.data.full_name,
				participation_status: 'ACCEPTED',
			},
		],
		recurrence_rule: {},
		addMeetLink: false,
	}
}

const event = reactive({})
let originalParams = {}

// --- Computed params ---

const duration = computed(() => {
	if (event.isAllDay) {
		const days = dayjs(event.endDate).diff(dayjs(event.startDate), 'day') + 1
		return dayjs.duration({ days }).toISOString()
	}

	const start = dayjs(`${event.startDate}T${event.startTime}`)
	const end = dayjs(`${event.endDate}T${event.endTime}`)
	const diff = dayjs.duration(end.diff(start))
	const hours = Math.floor(diff.asHours())
	const minutes = diff.minutes()
	return dayjs.duration({ hours, minutes }).toISOString()
})

const startsAt = computed(() =>
	dayjs(`${event.startDate}T${event.isAllDay ? '00:00' : event.startTime}`),
)
const endsAt = computed(() => dayjs(`${event.endDate}T${event.isAllDay ? '00:00' : event.endTime}`))

const isDateTimeValid = computed(() => {
	if (!event.startDate || !event.endDate) return false
	if (!event.isAllDay && (!event.startTime || !event.endTime)) return false
	if (!startsAt.value.isValid() || !endsAt.value.isValid()) return false
	if (event.isAllDay) return !endsAt.value.isBefore(startsAt.value, 'day')
	return endsAt.value.isAfter(startsAt.value)
})

const participants = computed(() =>
	getReorderedParticipants(
		event.participants,
		event.organizer,
		selectedEvent?.calendarEvent?.participants,
	),
)

const eventParams = computed(() => {
	const params: Record<string, any> = {
		user: user.data.name,
		organizer: event.organizer,
		start: startsAt.value.format('YYYY-MM-DD[T]HH:mm:ss'),
		duration: duration.value,
	}

	if (event.title) params.title = event.title
	if (dayjs?.tz) params.time_zone = dayjs.tz.guess()

	if (selectedEvent.calendarEvent?.recurrence_id && !isUpdateInstance.value) {
		// The master's start passes through unchanged, so it must keep the master's zone —
		// pairing it with the browser's would silently shift the whole series.
		params.start = selectedEvent.calendarEvent.master_start
		params.time_zone = selectedEvent.calendarEvent.time_zone || params.time_zone
	}
	if (event.recurrence_rule && Object.keys(event.recurrence_rule).length)
		params.recurrence_rule = event.recurrence_rule
	if (event.privacy) params.privacy = event.privacy
	if (event.free_busy_status) params.free_busy_status = event.free_busy_status
	if (event.description) params.description = event.description
	if (event.locations?.some((l) => l?.trim()))
		params.locations = event.locations.filter((l) => l?.trim()).map((name) => ({ name }))
	// Always carry existing links on updates — the JMAP update is a full replace,
	// so omitting them would strip Meet links from the event.
	if (event.links?.length) params.links = event.links
	if (event.participants?.length) params.participants = event.participants
	if (event.alerts?.length) {
		params.alerts = event.alerts.map((a) => {
			const base = { action: a.action, type: a.type }
			if (a.type === 'AbsoluteTrigger')
				return {
					...base,
					// The date/time inputs are a wall clock in the user's zone; the API takes UTC.
					when: fromWallClock(`${a.date}T${a.time}`),
				}

			return {
				...base,
				offset: dayjs.duration({ [a.unit]: a.number * a.direction }).toISOString(),
				relative_to: a.relative_to,
			}
		})
	}

	return params
})

const patch = computed(() => {
	const changed = Object.fromEntries(
		[...new Set([...Object.keys(eventParams.value), ...Object.keys(originalParams)])]
			.filter((k) => JSON.stringify(eventParams.value[k]) !== JSON.stringify(originalParams[k]))
			.map((k) => [k, eventParams.value[k]]),
	)
	// A changed start is a wall clock in the viewer's zone; without the zone alongside it the
	// server would reinterpret those numbers in the event's stored zone.
	if ('start' in changed && !('time_zone' in changed)) changed.time_zone = eventParams.value.time_zone
	return changed
})

// --- Helpers ---

const parseAlert = (a: any) => {
	if (a.type === 'AbsoluteTrigger')
		return {
			type: a.type,
			action: a.action,
			date: inUserTimeZone(a.when).format('YYYY-MM-DD'),
			time: inUserTimeZone(a.when).format('HH:mm'),
		}

	const d = dayjs.duration(a.offset).$d
	const units = ['weeks', 'days', 'hours', 'minutes']
	const unit = units.find((u) => d[u]) ?? 'minutes'
	const number = d[unit]

	return {
		type: a.type,
		action: a.action,
		number: Math.abs(number),
		unit,
		direction: a.offset.startsWith('-') ? -1 : 1,
		relative_to: a.relative_to,
	}
}

const hasParticipantsOtherThanUser = (participants: any[]) =>
	participants?.some((p) => participantIdentities.data.every((i) => i.email !== p.email)) ?? false

const hasMeetLink = (ev: any) =>
	(ev?.links || []).some((link: any) => link?.href?.includes('/meet/')) ||
	!!ev?.description?.includes('/meet/')

// Prefer the sanitized same-origin path, but fall back to the raw URL so events
// whose Meet link lives on another origin (e.g. created against a different site
// URL) still get a Join affordance — the same link is already clickable in the
// detail sidebar's description.
const meetUrl = computed(() => {
	const href =
		event.links?.find((item: any) => item?.href?.includes('/meet/'))?.href ||
		event.description?.match(/https?:\/\/\S+\/meet\/[a-zA-Z0-9-]+|\/meet\/[a-zA-Z0-9-]+/)?.[0]
	if (!href) return ''
	return getMeetUrl(href) || href.replace(/\W+$/, '')
})

const joinMeet = () => {
	if (meetUrl.value) window.open(meetUrl.value, '_blank', 'noopener')
}

// Toggling Meet on an existing event isn't part of eventParams/patch, so it
// must count as a pending change on its own (both for Save and for submit).
const pendingMeetAttach = computed(
	() => !isNew.value && event.addMeetLink && !hasMeetLink(selectedEvent?.calendarEvent),
)

const copyMeetLink = async () => {
	await navigator.clipboard.writeText(new URL(meetUrl.value, window.location.origin).href)
	toast.success(__('Frappe Meet link copied.'))
}

const meetLinkDisplay = computed(() =>
	meetUrl.value
		? new URL(meetUrl.value, window.location.origin).href.replace(/^https?:\/\//, '')
		: '',
)

// --- Watchers ---

// Moving the start drags the end along, keeping the gap the user set. A gap that
// hasn't been set — or one the start has overtaken — falls back to the default.
let previousStart = null

watch(show, (val) => {
	if (!val) return
	Object.assign(event, getEventData())
	// Reopening the same event leaves the start untouched, so the watcher below
	// won't fire — seed the baseline here or the first edit has nothing to move from.
	previousStart = { date: event.startDate, time: event.startTime }
	originalParams = JSON.parse(JSON.stringify(eventParams.value))
})

watch(
	() => [event.startDate, event.startTime],
	([startDate, startTime]) => {
		const previous = previousStart
		previousStart = { date: startDate, time: startTime }

		if (!previous?.date || !startDate) return
		if (previous.date === startDate && previous.time === startTime) return

		if (event.isAllDay) {
			const days = dayjs(event.endDate).diff(dayjs(previous.date), 'day')
			event.endDate = dayjs(startDate).add(Math.max(days, 0), 'day').format('YYYY-MM-DD')
			return
		}

		const start = dayjs(`${startDate}T${startTime}`)
		if (!start.isValid()) return

		const gap = dayjs(`${event.endDate}T${event.endTime}`).diff(
			dayjs(`${previous.date}T${previous.time}`),
			'minute',
		)
		const end = start.add(gap > 0 ? gap : DEFAULT_DURATION_MINUTES, 'minute')
		event.endDate = end.format('YYYY-MM-DD')
		event.endTime = end.format('HH:mm')
	},
)

const showRepeatSettings = ref(false)
watch(showRepeatSettings, (val) => {
	if (!val && !event.recurrence_rule?.frequency) event.repeat = false
})

const locationsEl = ref<HTMLElement | null>(null)

const addLocation = async () => {
	event.locations.push('')
	await nextTick()
	const inputs = locationsEl.value?.querySelectorAll('input')
	inputs?.[inputs.length - 1]?.focus()
}

// With a rule applied the row is an entry point to the settings — unchecking
// only happens through Remove Repeat in the modal.
const toggleRepeat = () => {
	if (event.recurrence_rule?.frequency) {
		showRepeatSettings.value = true
		return
	}
	event.repeat = !event.repeat
	if (event.repeat) showRepeatSettings.value = true
	else event.recurrence_rule = {}
}

const repeatLabel = computed(() => {
	if (!event.recurrence_rule?.frequency) return __('Repeat')
	const message = getRepeatMessage(event.recurrence_rule)
	return __('Repeats {0}', [message.charAt(0).toLowerCase() + message.slice(1)])
})

// --- Save logic ---

const handleSuccess = () => {
	show.value = false
	emit('reloadEvents')
}

const createEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.add_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		...eventParams.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const createMeetEvent = createResource({
	url: 'suite.meet.api.schedule.create_scheduled_meeting',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		...eventParams.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const editEventInstance = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		master_id: selectedEvent.calendarEvent.master_id,
		recurrence_id: selectedEvent.calendarEvent.recurrence_id,
		patch: patch.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const editEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		// master_id is only set on recurring events; fall back to the event's own id
		id: selectedEvent.calendarEvent.master_id || selectedEvent.calendarEvent.id,
		uid: selectedEvent.calendarEvent.uid,
		...eventParams.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const createMeetLink = createResource({
	url: 'suite.meet.api.schedule.create_meet_link',
	makeParams: () => ({ account: store.accountId, title: event.title }),
})

const isUpdateInstance = ref(false)

const submitEvent = (sendEmail: boolean) => {
	const isInstance = isUpdateInstance.value && selectedEvent.calendarEvent?.recurrence_id
	const resource = isNew.value
		? event.addMeetLink
			? createMeetEvent
			: createEvent
		: isInstance
			? editEventInstance
			: editEvent
	const messages = isNew.value
		? { loading: __('Creating event...'), success: __('Event created.') }
		: { loading: __('Updating event...'), success: __('Event updated.') }

	// Attaching a Meet link to an existing event: mint the room first, then send the
	// regular update with the link included (creation bundles this server-side).
	const attachMeetLink = pendingMeetAttach.value
	const submit = async () => {
		// A failed update leaves the minted room in event.links only — reuse it on
		// retry rather than creating an orphaned duplicate.
		const alreadyMinted = (event.links || []).some((l: any) => l?.href?.includes('/meet/'))
		if (attachMeetLink && !alreadyMinted) {
			const { meeting_url } = await createMeetLink.submit()
			event.links = [...(event.links || []), { href: meeting_url, content_type: 'text/html' }]
		}
		return resource.submit({ sendEmail })
	}

	toast.promise(submit(), {
		...messages,
		error: __('Action failed. Please try again in some time.'),
	})
	showNotifyParticipantsModal.value = false
}

const showNotifyParticipantsModal = ref(false)
const showRecurringEventModal = ref(false)

const handleSave = () => {
	if (!isDateTimeValid.value) {
		toast.error(__('Enter a valid date and an end time after the start time.'))
		return
	}

	const needsEmail =
		hasParticipantsOtherThanUser(selectedEvent?.calendarEvent?.participants) ||
		hasParticipantsOtherThanUser(event.participants)
	if (needsEmail) showNotifyParticipantsModal.value = true
	else submitEvent(false)
}

const handleSaveRecurringEvent = (updateInstance: boolean) => {
	isUpdateInstance.value = updateInstance
	showRecurringEventModal.value = false
	handleSave()
}

const shouldShowRecurringEventModal = computed(
	() =>
		selectedEvent?.calendarEvent?.recurrence_id &&
		!Object.keys(patch.value).includes('recurrence_rule'),
)

// --- Alerts ---

const addAlertOptions = computed(() => [
	{
		label: __('Relative to Event'),
		onClick: () =>
			event.alerts.push({
				type: 'OffsetTrigger',
				action: 'Display',
				number: 10,
				unit: 'minutes',
				direction: -1,
				relative_to: 'Start',
			}),
	},
	{
		label: __('On Specific Date'),
		onClick: () =>
			event.alerts.push({
				type: 'AbsoluteTrigger',
				action: 'Display',
				date: dayjs(event.startDate).subtract(1, 'day').format('YYYY-MM-DD'),
				time: '09:00',
			}),
	},
])

// --- Dialog options ---

const disableSave = computed(() => {
	if (createEvent.loading || editEvent.loading || editEventInstance.loading) return true
	if (createMeetEvent.loading) return true
	if (!isDateTimeValid.value) return true
	if (!isNew.value && !Object.keys(patch.value).length && !pendingMeetAttach.value) return true
	return false
})

const handleSaveClick = () => {
	if (shouldShowRecurringEventModal.value) showRecurringEventModal.value = true
	else handleSave()
}

const dialogTitle = computed(() => (isNew.value ? __('Add Event') : __('Edit Event')))

const AVAILABILITY_OPTIONS = [
	{ label: __('Free'), value: 'Free' },
	{ label: __('Busy'), value: 'Busy' },
]

const VISIBILITY_OPTIONS = [
	{ label: __('Public'), value: 'Public' },
	{ label: __('Private'), value: 'Private' },
]

const showNotifyParticipantsOptions = computed(() => ({
	title: __('Notify Participants'),
	icon: { name: 'bell' },
	message: isNew.value
		? __("Send an email to let attendees know they've been invited?")
		: __('Send an email to let attendees know this event has been updated?'),
}))

const SHOW_RECURRING_EVENT_MODAL_OPTIONS = {
	title: __('Update Recurring Event'),
	icon: { name: 'repeat' },
	message: __('Do you want to update just this instance, or all events in the series?'),
}
</script>

<template>
	<Dialog v-model="show" size="4xl" bare>
		<template #default="{ close }">
			<div class="flex max-h-[85vh] flex-col text-ink-gray-8">
				<!-- header -->
				<div class="flex items-center border-b px-6 py-4">
					<span class="text-lg font-semibold">{{ dialogTitle }}</span>
					<Button variant="ghost" class="ml-auto" @click="close">
						<template #icon><X :size="18" class="icon text-ink-gray-5" /></template>
					</Button>
				</div>

				<div class="flex min-h-0 flex-1">
					<!-- left: event details -->
					<div class="min-w-0 flex-1 overflow-y-auto px-6 py-5">
						<!-- lead title -->
						<input
							v-model="event.title"
							:autofocus="isNew"
							:placeholder="__('Add title')"
							class="w-full border-none bg-transparent p-0 pb-4 text-2xl font-semibold tracking-tight text-ink-gray-8 outline-none placeholder:text-ink-gray-4 focus:ring-0"
						/>

						<!-- date & time — one grouped card -->
						<div class="rounded-xl border border-outline-gray-2">
							<div class="flex items-center gap-3 border-b px-3.5 py-3">
								<Clock :size="18" class="icon shrink-0 text-ink-gray-5" />
								<span class="flex-1 text-base font-medium">
									{{ __('Date & Time') }}
								</span>
								<FormControl
									v-model="event.isAllDay"
									:label="__('All Day')"
									type="checkbox"
									class="dark:[&_input:not(:checked)]:bg-surface-gray-2"
								/>
							</div>
							<div class="flex gap-3 p-3.5">
								<div class="min-w-0 flex-1 space-y-1.5">
									<label class="block text-xs text-ink-gray-5">
										{{ __('Starts') }}
									</label>
									<div class="flex gap-2">
										<FormControl v-model="event.startDate" type="date" class="w-full" />
										<FormControl
											v-if="!event.isAllDay"
											v-model="event.startTime"
											type="time"
											class="w-full"
										/>
									</div>
								</div>
								<div class="min-w-0 flex-1 space-y-1.5">
									<label class="block text-xs text-ink-gray-5">
										{{ __('Ends') }}
									</label>
									<div class="flex gap-2">
										<FormControl v-model="event.endDate" type="date" class="w-full" />
										<FormControl
											v-if="!event.isAllDay"
											v-model="event.endTime"
											type="time"
											class="w-full"
										/>
									</div>
								</div>
							</div>
							<div class="px-3.5 pb-3.5">
								<div
									class="group -mx-1.5 flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-surface-gray-2"
									@click="toggleRepeat"
								>
									<FormControl
										v-model="event.repeat"
										type="checkbox"
										class="pointer-events-none dark:[&_input:not(:checked)]:bg-surface-gray-2"
									/>
									<span class="min-w-0 flex-1 truncate text-base text-ink-gray-8">
										{{ repeatLabel }}
									</span>
								</div>
							</div>
						</div>

						<!-- meet link -->
						<div class="mt-4 flex items-center gap-3 rounded-lg border border-outline-gray-2 px-3.5 py-3">
							<template v-if="meetUrl">
								<img :src="meetLogo" :alt="__('Frappe Meet')" class="size-7 shrink-0" />
								<div class="min-w-0 flex-1">
									<div class="text-sm font-medium text-ink-gray-8 mb-0.5">
										{{ __('Frappe Meet') }}
									</div>
									<div class="truncate text-xs text-ink-gray-5">{{ meetLinkDisplay }}</div>
								</div>
								<Button variant="ghost" :title="__('Copy Frappe Meet link')" @click="copyMeetLink">
									<template #icon><Copy :size="14" class="icon text-ink-gray-5" /></template>
								</Button>
								<Button :label="__('Join')" @click="joinMeet" />
							</template>
							<template v-else>
								<img :src="meetLogo" :alt="__('Frappe Meet')" class="size-[18px] shrink-0" />
								<span class="flex-1 text-base">{{ __('Add Frappe Meet video call') }}</span>
								<Switch v-model="event.addMeetLink" />
							</template>
						</div>



						<div class="mt-4 flex flex-col gap-4">
							<!-- locations -->
							<div class="flex gap-3">
								<MapPin
									:size="18"
									class="icon shrink-0 text-ink-gray-5"
									:class="event.locations?.length ? 'mt-7' : 'mt-2'"
								/>
								<div ref="locationsEl" class="min-w-0 flex-1 space-y-2">
									<div v-for="(_, i) in event.locations" :key="i" class="flex gap-2">
										<FormControl
											v-model="event.locations[i]"
											:label="
												i === 0
													? event.locations?.length > 1
														? __('Locations')
														: __('Location')
													: ''
											"
											:placeholder="__('Meeting location {0}', [i + 1])"
											class="w-full"
										/>
										<Button icon="x" class="mt-auto" @click="event.locations.splice(i, 1)" />
									</div>
									<Button
										v-if="(event.locations?.length ?? 0) < 3"
										:label="__('Add Location')"
										@click="addLocation"
									/>
								</div>
							</div>

							<!-- alerts -->
							<div class="flex gap-3">
								<Bell
									:size="18"
									class="icon shrink-0 text-ink-gray-5"
									:class="event.alerts?.length ? 'mt-7' : 'mt-2'"
								/>
								<div class="min-w-0 flex-1 space-y-2">
									<EventAlertList v-model:alerts="event.alerts" />
									<Dropdown
										v-if="event.alerts?.length < 3"
										:button="{ label: __('Add Alert') }"
										:options="addAlertOptions"
									/>
								</div>
							</div>

							<!-- availability & visibility -->
							<div class="flex gap-3">
								<Briefcase :size="18" class="icon mt-7 shrink-0 text-ink-gray-5" />
								<div class="flex min-w-0 flex-1 gap-3">
									<FormControl
										v-model="event.free_busy_status"
										type="select"
										:label="__('Availability')"
										:options="AVAILABILITY_OPTIONS"
										class="w-full"
									/>
									<FormControl
										v-model="event.privacy"
										type="select"
										:label="__('Visibility')"
										:options="VISIBILITY_OPTIONS"
										class="w-full"
									/>
								</div>
							</div>

							<!-- description -->
							<div class="flex gap-3">
								<AlignLeft :size="18" class="icon mt-7 shrink-0 text-ink-gray-5" />
								<FormControl
									v-model="event.description"
									:label="__('Description')"
									type="textarea"
									:placeholder="__('Add description')"
									class="min-w-0 flex-1"
								/>
							</div>
						</div>
					</div>

					<!-- right: guests rail -->
					<div class="w-[300px] shrink-0 overflow-y-auto border-l px-5 py-5">
						<div class="mb-3 flex items-baseline gap-2">
							<Users :size="15" class="icon self-center text-ink-gray-5" />
							<span class="text-base font-medium">{{ __('Participants') }}</span>
							<span class="text-sm text-ink-gray-4">{{ participants.length }}</span>
						</div>
						<ParticipantSelector
							v-model="event.participants"
							:account="store.accountId"
							:display-participants="participants"
							label=""
						/>
					</div>
				</div>

				<!-- footer -->
				<div class="flex justify-end gap-2 border-t px-6 py-3.5">
					<Button :label="__('Cancel')" variant="outline" @click="close" />
					<Button
						:label="__('Save')"
						variant="solid"
						:disabled="disableSave"
						class="w-16"
						@click="handleSaveClick"
					/>
				</div>
			</div>
		</template>
	</Dialog>
	<EventRepeatSettingsModal
		v-if="event?.startDate"
		v-model="showRepeatSettings"
		:start-date="event.startDate"
		:r-rule="event?.recurrence_rule"
		@update-recurrence-rule="(val) => (event.recurrence_rule = val)"
	/>
	<Dialog v-model="showRecurringEventModal" :options="SHOW_RECURRING_EVENT_MODAL_OPTIONS">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button @click="handleSaveRecurringEvent(false)">{{ __('Entire Series') }}</Button>
			</div>
		</template>
	</Dialog>
	<Dialog v-model="showNotifyParticipantsModal" :options="showNotifyParticipantsOptions">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button variant="outline" @click="submitEvent(false)">
					{{ __('Skip') }}
				</Button>
				<Button variant="solid" @click="submitEvent(true)">
					{{ __('Send Email') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>
