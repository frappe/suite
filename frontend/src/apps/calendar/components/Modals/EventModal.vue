<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch } from 'vue'
import {
	AlignLeft,
	Bell,
	Briefcase,
	CalendarDays,
	ChevronDown,
	Clock,
	Copy,
	MapPin,
	MoreHorizontal,
	Pencil,
	Users,
	X,
} from 'lucide-vue-next'
import {
	Button,
	Dialog,
	Dropdown,
	FormControl,
	Switch,
	Tooltip,
	createResource,
	toast,
	useCall,
} from 'frappe-ui'

import meetLogo from '@/assets/app-logos/meet.png'
import { submit as submitCall } from '@/apps/meet/utils/request'
import { getMeetUrl, getReorderedParticipants } from '@/apps/calendar/utils'
import {
	fromEventZone,
	fromWallClock,
	inUserTimeZone,
	shiftedMasterStart,
} from '@/apps/calendar/utils/datetime'
import { getRepeatMessage } from '@/apps/calendar/utils/format'
import { VISIBILITY_OPTIONS } from '@/apps/calendar/utils/eventOptions'
import { reanchoredRule } from '@/apps/calendar/utils/recurrence'
import { defaultCalendar } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import { isFirstOccurrence, scopeOptions } from '@/apps/calendar/utils/recurringScope'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import { useScreenSize } from '@/composables/useScreenSize'
import { userStore } from '@/apps/calendar/stores/user'
import type { ParticipantIdentity } from '@/apps/calendar/types/doctypes'
import { useEventDelete } from '@/apps/calendar/composables/useEventDelete'
import RecurringScopeModal from '@/apps/calendar/components/Modals/RecurringScopeModal.vue'
import EventAlertList from '@/apps/calendar/components/EventAlertList.vue'
import ParticipantSelector from '@/apps/calendar/components/ParticipantSelector.vue'
import EventRepeatSettingsModal from '@/apps/calendar/components/Modals/EventRepeatSettingsModal.vue'
import MobileEventForm from '@/apps/calendar/components/mobile/MobileEventForm.vue'

const show = defineModel<boolean>()
const { selectedEvent } = defineProps<{ selectedEvent: any }>()
const emit = defineEmits(['reloadEvents'])

const user = inject('$user')
const dayjs = inject('$dayjs')
const store = userStore()
const { participantIdentities, calendars } = store
const { isMobile } = useScreenSize()

const isNew = computed(() => !selectedEvent?.calendarEvent)
// A saved draft: the server holds it but has sent nothing. Only a new event can become
// one (the server refuses to turn a published event back into a draft), and saving it
// as a draft again or publishing it are the two ways out of the modal.
const isDraft = computed(() => !!selectedEvent?.calendarEvent?.isDraft)
// Set for the length of one save: the resources read it into `draft`.
const savingDraft = ref(false)

// The lead title reads as plain bold text until you click it, so a pencil sits beside
// it as the affordance; clicking it puts the caret in the field. Once the field has the
// caret the hint has done its job and would only sit there restating it, so it goes.
// Hovering the row dotted-underlines the title instead of tinting the pencil: the cue
// belongs on the thing you are about to edit, and it stays out of the way while typing.
// The underline colour goes through the raw token var — ink-gray-* are frappe-ui CSS
// classes, not Tailwind palette colours, so `decoration-ink-gray-4` generates nothing
// and the rule would silently fall back to the title's own near-black.
const titleInput = ref<HTMLInputElement | null>(null)
const isTitleFocused = ref(false)

// --- Event initialization ---

// The occurrence's own start, as the form reads it. Timed events edit in the viewer's zone
// (saving re-zones them to it, see eventParams); all-day events keep their calendar date.
const occurrenceStart = (ev: any) =>
	ev.isAllDay ? dayjs(ev.start) : fromEventZone(ev.start, ev.time_zone)

const getEventData = () => {
	if (isNew.value) return getDefaultEventData()

	const { calendarEvent: ev } = selectedEvent
	const start = occurrenceStart(ev)
	const end = start.add(dayjs.duration(ev.duration))
	const displayEnd = ev.isAllDay ? end.subtract(1, 'day') : end

	return {
		title: ev.title || '',
		organizer: ev.organizer,
		// Every calendar it is on: an event on two stays on both unless the picker moves it.
		calendar_ids: ev.calendars?.map((c) => c.calendar_id) ?? [],
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
		// True only while the server follows its defaults without spelling them out
		// as alert rows — an empty list then means "no rows shown", not "cleared".
		followsDefaults: !!ev.use_default_alerts && !ev.alerts?.length,
		description: ev.description || '',
		participants: [...ev.participants],
		recurrence_rule: ev.recurrence_rule,
		addMeetLink: hasMeetLink(ev),
	}
}

// How long an event runs when the end hasn't been set by hand.
const DEFAULT_DURATION_MINUTES = 60

// The calendar's default reminder, pre-filled as an ordinary row the user can
// edit or remove (removing it means no reminder at all): ten minutes before a
// timed event, at nine in the morning on the day of an all-day one — spelled
// as a concrete date and time, which reads better than '9 hours after start'.
const defaultAlert = (isAllDay: boolean, startDate: string) =>
	isAllDay
		? { type: 'AbsoluteTrigger', action: 'Display', date: startDate, time: '09:00' }
		: {
				type: 'OffsetTrigger',
				action: 'Display',
				number: 10,
				unit: 'minutes',
				direction: -1,
				relative_to: 'Start',
			}

// When an event on this day starts, absent a slot to put it in: the next full hour today,
// ten in the morning on any other day.
const defaultStartTime = (date: string) =>
	dayjs(date).isToday() ? dayjs().add(1, 'hour').startOf('hour').format('HH:mm') : '10:00'

// The formats a tapped slot arrives in. The grid hands back the hour it was read
// in — "7 am" or "07:00" — and the half hour where the tap landed in the lower
// half of the row, which the whole-hour formats cannot parse: 'h a' against
// "7:30 am" reads the 7 and stops.
const SLOT_TIME_FORMATS = ['h:mm a', 'h a', 'HH:mm']

const getDefaultEventData = () => {
	const startTime = selectedEvent?.time
		? dayjs(selectedEvent.time, SLOT_TIME_FORMATS).format('HH:mm')
		: defaultStartTime(selectedEvent.date)

	// A new event is a timed one. Only a click in the all-day lane says otherwise — that is
	// the reader pointing at the all-day row, not the absence of a time: a month cell and the
	// New Event button carry no time either, and neither is a statement that the event runs
	// all day. Off by default, and a switch away when it isn't.
	const isAllDay = selectedEvent?.isFullDay === true

	const identity = store.organizerIdentity

	return {
		title: '',
		organizer: identity?.email,
		// Empty until the list has loaded, and then the server puts it in the default.
		calendar_ids: [defaultCalendar(calendars.data)?.id].filter(Boolean),
		isAllDay,
		repeat: false,
		startDate: dayjs(selectedEvent.date).format('YYYY-MM-DD'),
		startTime,
		endDate: dayjs(selectedEvent.date).format('YYYY-MM-DD'),
		endTime: dayjs(startTime, 'HH:mm').add(DEFAULT_DURATION_MINUTES, 'minute').format('HH:mm'),
		locations: [],
		links: [],
		alerts: [defaultAlert(isAllDay, dayjs(selectedEvent.date).format('YYYY-MM-DD'))],
		followsDefaults: false,
		description: '',
		free_busy_status: 'Busy',
		privacy: 'Public',
		participants: identity ? [organizerParticipant(identity)] : [],
		recurrence_rule: {},
		addMeetLink: false,
	}
}

// The organizer row of a new event: the participant identity the store picked, which
// can differ from the login user. Without one the event has no organizer at all.
const organizerParticipant = (identity: ParticipantIdentity) => ({
	email: identity.email,
	user_image: user.data.user_image,
	_name: identity._name || user.data.full_name,
	participation_status: 'ACCEPTED',
})

const event = reactive({})
let originalParams = {}

// A new event cannot be saved, or kept as a draft, without an organizer, and only an
// identity the account can both send from and attend as provides one (see the store).
// Editing keeps the organizer the event already has.
const missingOrganizer = computed(() => isNew.value && !event.organizer)

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
		// Without this the server sees a timed midnight event and applies the
		// wrong default alert (10 mins before instead of 9am day-of).
		show_without_time: event.isAllDay,
	}

	if (event.title) params.title = event.title
	// Updates are a full replace: an event saved without its calendars lands in the default one.
	if (event.calendar_ids?.length) params.calendar_ids = event.calendar_ids
	if (dayjs?.tz) params.time_zone = dayjs.tz.guess()

	// Saving the whole series from one of its occurrences. The start on screen belongs to that
	// occurrence, so what reaches the master is the shift the reader made to it — nothing at all
	// when they made none, which is how the anchor used to pass through untouched. It keeps the
	// master's zone either way: pairing the master's wall clock with the browser's zone would
	// move the series on its own.
	const ev = selectedEvent?.calendarEvent
	if (ev?.recurrence_id && editScope.value === 'series') {
		// An unresolved master (no master_start) is already past saving — the update is addressed by
		// master_id too, and falls back to an id the server won't take — so it is left exactly as it
		// was rather than given a start of this occurrence's, or of now.
		params.start = ev.master_start
			? shiftedMasterStart(ev.master_start, occurrenceStart(ev), startsAt.value)
			: ev.master_start
		params.time_zone = ev.time_zone || params.time_zone
	}
	if (event.recurrence_rule && Object.keys(event.recurrence_rule).length) {
		// A rule names its days by reading them off the start, and does not re-read them when the
		// anchor moves. Left alone, a Monday series edited onto a Wednesday starts on Wednesday
		// and repeats on Mondays — so the occurrence just edited matches nothing the rule
		// generates and is not drawn at all. Which start was the anchor depends on what is being
		// written: the series is anchored at the master's start, the half a split begins at the
		// occurrence the reader opened.
		// Both ends read the same way. A split is anchored where the form opened this occurrence
		// and starts where the form now says — both the viewer's clock. The series is anchored
		// at the master's start and moves to the one computed from it — both the event's.
		const anchorWas =
			editScope.value === 'following' ? occurrenceStart(ev) : dayjs(ev?.master_start)
		params.recurrence_rule =
			ev?.recurrence_id && anchorWas?.isValid() && !anchorWas.isSame(dayjs(params.start), 'day')
				? reanchoredRule(event.recurrence_rule, anchorWas, dayjs(params.start))
				: event.recurrence_rule
	}
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
	} else if (event.followsDefaults) {
		// updates send these params whole, so an unrelated edit must say the
		// event still follows the calendar's defaults.
		params.use_default_alerts = true
	} else {
		// An empty list is a choice: removing the pre-filled default row means
		// no reminder at all, so the clear must reach the server.
		params.alerts = []
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
	// Alert edits must also switch a defaults-following event off useDefaultAlerts,
	// or the server would keep overriding them with the calendar's defaults.
	if ('alerts' in changed) changed.use_default_alerts = false
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
// detail card's description.
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

// Identities can land after the modal opened; give the new event its organizer then,
// ahead of any attendee already added.
watch(
	() => store.organizerIdentity,
	(identity) => {
		if (!show.value || !identity || !isNew.value || event.organizer) return
		event.organizer = identity.email
		event.participants = [organizerParticipant(identity), ...(event.participants ?? [])]
	},
)

watch(
	() => [event.startDate, event.startTime],
	([startDate, startTime]) => {
		const previous = previousStart
		previousStart = { date: startDate, time: startTime }

		if (!previous?.date || !startDate) return
		if (previous.date === startDate && previous.time === startTime) return

		// An untouched default reminder follows the event to its new day.
		if (
			event.isAllDay &&
			event.alerts?.length === 1 &&
			JSON.stringify(event.alerts[0]) === JSON.stringify(defaultAlert(true, previous.date))
		)
			event.alerts = [defaultAlert(true, startDate)]

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

watch(
	() => [event.endDate, event.endTime],
	([endDate, endTime]) => {
		if (event.isAllDay || !endDate || !endTime) return
		const end = dayjs(`${endDate}T${endTime}`)
		if (!end.isValid() || end.isAfter(startsAt.value)) return
		const start = end.subtract(DEFAULT_DURATION_MINUTES, 'minute')
		event.startDate = start.format('YYYY-MM-DD')
		event.startTime = start.format('HH:mm')
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

// One size for every glyph in the field column, so a row is found by its label
// rather than by how big its icon happens to draw. 16 rather than the 18 the
// column carried: at 18 the boxy glyphs — the calendar, the briefcase — filled
// their frame corner to corner and read a size above the round ones beside them.
const FIELD_ICON_SIZE = 16

const eventCalendar = computed({
	get: () => event.calendar_ids?.[0],
	set: (id: string) => (event.calendar_ids = [id]),
})

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
		draft: savingDraft.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const createMeetEventCall = useCall({
	url: '/api/v2/method/suite.meet.api.schedule.create_scheduled_meeting',
	method: 'POST',
	immediate: false,
	onSuccess: handleSuccess,
})
const createMeetEvent = {
	get loading() {
		return createMeetEventCall.loading
	},
	submit: ({ sendEmail }: { sendEmail: boolean }) =>
		submitCall(createMeetEventCall, {
			account: store.accountId,
			...eventParams.value,
			send_scheduling_messages: sendEmail,
		}),
}

// One occurrence's override keeps the series' zone. An occurrence is keyed by the start it was
// expanded at, and a zone in the patch makes the server re-key it into that zone while the
// override stays under the old key — the two stop matching, and the occurrence is left with
// nothing the series says about it. So the edited wall clock is converted into the event's own
// zone and the zone itself is not sent.
const instancePatch = computed(() => {
	// Nor its calendars: an override can't move one occurrence to another calendar.
	const { time_zone: zone, calendar_ids: _, ...rest } = patch.value
	const eventZone = selectedEvent.calendarEvent?.time_zone
	// An all-day start is a date, held and shown in the event's own terms — there is no viewer
	// clock to translate, and translating anyway moves the occurrence off its day.
	if (!('start' in rest) || !eventZone || !dayjs?.tz || event.isAllDay) return rest

	return {
		...rest,
		start: dayjs
			.tz(rest.start, zone || dayjs.tz.guess())
			.tz(eventZone)
			.format('YYYY-MM-DD[T]HH:mm:ss'),
	}
})

const editEventInstance = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		master_id: selectedEvent.calendarEvent.master_id,
		recurrence_id: selectedEvent.calendarEvent.recurrence_id,
		patch: instancePatch.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

// "This and following" is neither of the other two writes: JSCalendar can say "this date" or
// "the series" and nothing in between, so the server cuts the series in two and this edit
// starts the second half.
const splitSeries = createResource({
	url: 'suite.calendar.api.split_calendar_event_series',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		master_id: selectedEvent.calendarEvent.master_id,
		recurrence_id: selectedEvent.calendarEvent.recurrence_id,
		...eventParams.value,
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
		draft: savingDraft.value,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: handleSuccess,
})

const createMeetLink = useCall<{ meeting_url: string }>({
	url: '/api/v2/method/suite.meet.api.schedule.create_meet_link',
	method: 'POST',
	immediate: false,
})

// How far the save reaches. A one-off event is its own series, so nothing asks and nothing
// else reads this.
const editScope = ref<RecurringScope>('series')

const submitEvent = (sendEmail: boolean) => {
	const recurring = !!selectedEvent.calendarEvent?.recurrence_id
	const resource = isNew.value
		? event.addMeetLink
			? createMeetEvent
			: createEvent
		: recurring && editScope.value === 'instance'
			? editEventInstance
			: recurring && editScope.value === 'following'
				? splitSeries
				: editEvent
	const messages = isDraft.value
		? { loading: __('Sending event...'), success: __('Event sent.') }
		: isNew.value
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
			const { meeting_url } = await submitCall(createMeetLink, {
				account: store.accountId,
				title: event.title,
			})
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

// --- Leaving the modal ---
//
// Draft is not a button; it is what happens when you leave without sending,
// the way mail's compose keeps what you typed. Cancel means "throw this away"
// and asks first only if there is something to throw away — and the question it
// asks carries the draft as an answer, which on a phone is the only place the
// offer is made at all: there is no ✕ there, and no Save split. ✕, Escape and a
// click outside mean "keep": a new event or a draft is saved as a draft with
// a toast that can undo it. A published event cannot go back to being a
// draft, so unsent edits there get the same question Cancel asks.

const isDirty = computed(
	() => Object.keys(patch.value).length > 0 || pendingMeetAttach.value,
)

const showDiscardModal = ref(false)

const cancel = () => {
	if (isDirty.value) showDiscardModal.value = true
	else show.value = false
}

// The draft is only ever offered where it can actually be written: a published event
// cannot go back to being one, and without an organizer there is nothing to save it as.
const canKeepAsDraft = computed(() => canSaveDraft.value && !missingOrganizer.value)

const saveDraftFromDiscard = () => {
	showDiscardModal.value = false
	// Puts the question back up itself when the dates don't hold, so this closing it first
	// is not the last word.
	saveDraftAndLeave()
}

const discardChanges = () => {
	showDiscardModal.value = false
	show.value = false
}

const leave = () => {
	if (!isDirty.value) {
		show.value = false
		return
	}
	if (canSaveDraft.value && !missingOrganizer.value) saveDraftAndLeave()
	else showDiscardModal.value = true
}

const discardDraft = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events',
	makeParams: ({ id }: { id: string }) => ({
		account: store.accountId,
		ids: [id],
		send_scheduling_messages: false,
	}),
	onSuccess: () => {
		toast.success(__('Draft discarded.'))
		emit('reloadEvents')
	},
})

const saveDraftAndLeave = async () => {
	if (!isDateTimeValid.value) {
		// Nothing the server would keep; the form's own validation says why.
		showDiscardModal.value = true
		return
	}
	savingDraft.value = true
	try {
		// The plain create/update: a draft has no Meet room and no per-instance edit.
		const result = await (isNew.value ? createEvent : editEvent).submit({ sendEmail: false })
		const id = isNew.value
			? result
			: selectedEvent.calendarEvent.master_id || selectedEvent.calendarEvent.id
		toast.success(__('Draft saved.'), {
			action: { label: __('Discard'), onClick: () => discardDraft.submit({ id }) },
		})
	} catch {
		toast.error(__('Could not save the draft. Please try again.'))
	} finally {
		savingDraft.value = false
	}
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

const handleSaveRecurringEvent = (scope: RecurringScope) => {
	editScope.value = scope
	showRecurringEventModal.value = false
	handleSave()
}

const shouldShowRecurringEventModal = computed(
	() =>
		selectedEvent?.calendarEvent?.recurrence_id &&
		!Object.keys(patch.value).includes('recurrence_rule'),
)

// --- Alerts ---

// Touching the alert UI is a choice about reminders: from here on an empty
// list means cleared, not "still following the calendar's defaults".
const addAlert = (alert: object) => {
	event.followsDefaults = false
	event.alerts.push(alert)
}

// The phone's alert picker replaces a row outright, or drops it: same statement as
// addAlert's, about a list it rewrites rather than appends to.
const setAlerts = (alerts: object[]) => {
	event.followsDefaults = false
	event.alerts = alerts
}

const addAlertOptions = computed(() => [
	{
		label: __('Relative to Event'),
		onClick: () =>
			addAlert({
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
			addAlert({
				type: 'AbsoluteTrigger',
				action: 'Display',
				date: dayjs(event.startDate).subtract(1, 'day').format('YYYY-MM-DD'),
				time: '09:00',
			}),
	},
])

// Flipping All Day swaps an untouched default reminder for the other mode's;
// a reminder the user has edited is theirs and stays put.
const setAllDay = (isAllDay: boolean) => {
	const untouched =
		event.alerts?.length === 1 &&
		JSON.stringify(event.alerts[0]) === JSON.stringify(defaultAlert(event.isAllDay, event.startDate))
	event.isAllDay = isAllDay
	if (untouched) event.alerts = [defaultAlert(isAllDay, event.startDate)]

	// A saved all-day event carries midnight at both ends of the same day: its duration counts
	// whole days, so taking the exclusive last day off the end lands it back on the start. As a
	// timed event that is a zero-length range, which the form won't save — and the reader is left
	// with a disabled Save and nothing saying why. Give it the slot a new event on that day would
	// get; the end follows an hour later, dragged along by the start watcher (the gap it reads is
	// zero, so it falls back to the default duration). A range that already spans days is a real
	// one and keeps its own hours.
	if (!isAllDay && !endsAt.value.isAfter(startsAt.value))
		event.startTime = defaultStartTime(event.startDate)
}

// --- Delete ---
//
// Only a saved event has something to delete; a new one is thrown away by
// Cancel. Deleting leaves straight away — there is nothing left to keep, so
// the unsaved-changes question would be noise.

const {
	deleteOption,
	isDeleting,
	showScopeModal: showDeleteScopeModal,
	deleteScopeModalProps,
	deleteScope,
	showNotifyModal: showNotifyDeleteModal,
	pendingDelete,
	NOTIFY_DELETE_OPTIONS,
} = useEventDelete(
	() => selectedEvent?.calendarEvent,
	() => {
		show.value = false
		emit('reloadEvents')
	},
)

const eventOptions = computed(() => [deleteOption.value])

// --- Dialog options ---

const isSaving = computed(
	() =>
		createEvent.loading ||
		editEvent.loading ||
		editEventInstance.loading ||
		splitSeries.loading ||
		createMeetEvent.loading,
)

const disableSave = computed(() => {
	if (isSaving.value || missingOrganizer.value) return true
	if (!isDateTimeValid.value) return true
	// Publishing a draft is a change in itself, even with nothing else edited.
	if (isDraft.value) return false
	if (!isNew.value && !Object.keys(patch.value).length && !pendingMeetAttach.value) return true
	return false
})

// The primary always reads "Save": whether anything is sent is the next
// question, asked by the Notify Participants prompt behind it, and a button
// that already said "Send" made that prompt look like a second one.
//
// A new event or a draft can also be kept as a draft — the split beside the
// primary, as mail's compose has it; a published event cannot go back to
// being one, so it gets a plain button.
const canSaveDraft = computed(() => isNew.value || isDraft.value)
const draftOptions = computed(() => [
	{ label: __('Save as draft'), icon: 'lucide-file-pen-line', onClick: saveDraftAndLeave },
])

const handleSaveClick = () => {
	if (shouldShowRecurringEventModal.value) return (showRecurringEventModal.value = true)
	// Nothing to ask, so nothing may be left over from the last time it was asked: an answer
	// standing from an earlier event would send this one's edit somewhere it never chose.
	editScope.value = 'series'
	handleSave()
}

const dialogTitle = computed(() =>
	isNew.value ? __('New Event') : isDraft.value ? __('Edit Draft') : __('Edit Event'),
)

const AVAILABILITY_OPTIONS = [
	{ label: __('Free'), value: 'Free' },
	{ label: __('Busy'), value: 'Busy' },
]

const showNotifyParticipantsOptions = computed(() => ({
	title: __('Notify Participants'),
	icon: 'lucide-bell',
	message:
		isNew.value || isDraft.value
			? __("Send an email to let attendees know they've been invited?")
			: __('Send an email to let attendees know this event has been updated?'),
}))

const DISCARD_MODAL_OPTIONS = computed(() => ({
	title: __('Discard changes?'),
	icon: 'lucide-trash-2',
	message: isNew.value
		? __('This event has not been saved and will be lost.')
		: __('Your unsaved edits to this event will be lost.'),
}))

const recurringScopeModalProps = computed(() => ({
	title: __('Update repeating event'),
	// At the head of a series "this and following" reaches exactly what "all events"
	// reaches, so the list does not ask the same question twice.
	options: scopeOptions({
		isFirst: isFirstOccurrence(selectedEvent?.calendarEvent),
		// An occurrence can't sit on a calendar its series is not on, so a move takes more than one.
		unavailable: 'calendar_ids' in patch.value ? ['instance'] : [],
	}),
	confirmLabel: __('Update'),
	loading: isSaving.value,
}))
</script>

<template>
	<!-- Two trees rather than one restyled, as useScreenSize has it: the phone's form is a
	     screen with its own header and its own pickers, not this dialog at 390px. Everything
	     behind both — the form state, the save path, the modals below — is this component's,
	     so the two presentations cannot drift apart on what saving an event means. -->
	<Dialog
		v-if="!isMobile"
		:open="show"
		size="4xl"
		bare
		@update:open="(open) => (open ? (show = true) : leave())"
	>
		<template #default>
			<!-- On a phone the dialog is the screen: 85vh of a 4xl box left the form in
			     a letterbox with its own scrollbar inside the page's. -->
			<div class="flex max-h-[85vh] flex-col text-ink-gray-8 max-sm:h-dvh max-sm:max-h-none">
				<!-- header -->
				<div class="flex items-center border-b px-6 py-4">
					<span class="text-md font-semibold">{{ dialogTitle }}</span>
					<div class="ml-auto flex items-center gap-1">
						<Dropdown v-if="!isNew" :options="eventOptions">
							<Button variant="ghost" :disabled="isDeleting" :aria-label="__('Event options')">
								<template #icon>
									<MoreHorizontal :size="18" class="icon text-ink-gray-5" />
								</template>
							</Button>
						</Dropdown>
						<Button variant="ghost" @click="leave">
							<template #icon><X :size="18" class="icon text-ink-gray-5" /></template>
						</Button>
					</div>
				</div>

				<!-- Two columns become one below sm: at 390px the participants column left
				     the details column too narrow to put a label and its field on the same
				     line, and every row wrapped to one word deep. Stacked, the form keeps
				     its order — details, then who is coming — and the whole thing scrolls
				     as one surface rather than two side by side. -->
				<div class="flex min-h-0 flex-1 max-sm:flex-col max-sm:overflow-y-auto">
					<!-- left: event details -->
					<div class="min-w-0 flex-1 overflow-y-auto px-6 py-5">
						<!-- lead title. The field sizes to its own text — a mirror span shares
						     the grid cell and sets the width — so the pencil sits against the
						     title instead of adrift at the column's edge. The mirror falls back
						     to the placeholder so an empty title still leaves something to read,
						     and max-w-full keeps a long one inside the column, where the input
						     scrolls internally as it did at full width. The click is on the row
						     rather than its two children, which is what makes the gap between
						     title and pencil live rather than dead space — and the row runs the
						     width of the column, so the whole line answers, not just the words:
						     an empty title is a short word to aim at, and the line beside it read
						     as dead. The underline still only spans the title, since it is the
						     input that carries it and the input is only as wide as its text. The
						     pb sits on a wrapper so the band below the title stays outside the
						     target. -->
						<div class="pb-4">
							<div
								class="group flex w-full items-center gap-2"
								:class="{ 'cursor-pointer': !isTitleFocused }"
								@click="titleInput?.focus()"
							>
								<div class="grid min-w-0 max-w-full">
									<span
										aria-hidden="true"
										class="invisible col-start-1 row-start-1 whitespace-pre text-xl font-semibold tracking-tight"
									>{{ event.title || __('Add title') }}</span>
									<input
										ref="titleInput"
										v-model="event.title"
										size="1"
										:autofocus="isNew"
										:placeholder="__('Add title')"
										class="col-start-1 row-start-1 w-full border-none bg-transparent p-0 text-xl font-semibold tracking-tight text-ink-gray-8 decoration-[--ink-gray-4] decoration-dotted underline-offset-4 outline-none placeholder:text-ink-gray-4 focus:ring-0"
										:class="{ 'cursor-pointer group-hover:underline': !isTitleFocused }"
										@focus="isTitleFocused = true"
										@blur="isTitleFocused = false"
									/>
								</div>
								<button
									v-if="event.title && !isTitleFocused"
									class="shrink-0 cursor-pointer text-ink-gray-4"
									:title="__('Edit title')"
								>
									<Pencil class="icon size-4" />
								</button>
							</div>
						</div>

						<!-- date & time — one grouped card -->
						<div class="rounded-7 border border-outline-gray-2">
							<div class="flex items-center gap-3 border-b px-3.5 py-3">
								<Clock :size="FIELD_ICON_SIZE" class="icon shrink-0 text-ink-gray-5" />
								<span class="flex-1 text-base font-medium">
									{{ __('Date & Time') }}
								</span>
								<FormControl
									:model-value="event.isAllDay"
									:label="__('All Day')"
									type="checkbox"
									class="dark:[&_input:not(:checked)]:bg-surface-gray-2"
									@update:model-value="setAllDay"
								/>
							</div>
							<div class="flex gap-3 p-3.5">
								<div class="min-w-0 flex-1 space-y-1.5">
									<label class="block text-xs text-ink-gray-5">
										{{ __('Starts') }}
									</label>
									<!-- 7:6, the ratio of what the two actually need: "2026-09-08" and
									     "12:45 AM" against the same chevron and padding either side. An even
									     split clipped the date; 3:2 clipped the time to "12:45 AN". -->
									<div class="flex gap-2">
										<FormControl
											v-model="event.startDate"
											type="date"
											format="MMM D, YYYY"
											:placeholder="__('Select date')"
											class="min-w-0 flex-[7]"
										/>
										<FormControl
											v-if="!event.isAllDay"
											v-model="event.startTime"
											type="time"
											:interval="15"
											format="h:mm A"
											:placeholder="__('Select time')"
											class="min-w-0 flex-[6]"
										/>
									</div>
								</div>
								<div class="min-w-0 flex-1 space-y-1.5">
									<label class="block text-xs text-ink-gray-5">
										{{ __('Ends') }}
									</label>
									<div class="flex gap-2">
										<FormControl
											v-model="event.endDate"
											type="date"
											format="MMM D, YYYY"
											:placeholder="__('Select date')"
											class="min-w-0 flex-[7]"
										/>
										<FormControl
											v-if="!event.isAllDay"
											v-model="event.endTime"
											type="time"
											:interval="15"
											format="h:mm A"
											:placeholder="__('Select time')"
											class="min-w-0 flex-[6]"
										/>
									</div>
								</div>
							</div>
							<div class="px-3.5 pb-3.5">
								<div
									class="group -mx-1.5 flex cursor-pointer items-center gap-2 rounded-6 px-1.5 py-1.5 hover:bg-surface-gray-2"
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
						<div class="mt-4 flex items-center gap-3 rounded-6 border border-outline-gray-2 px-3.5 py-3">
							<template v-if="meetUrl">
								<img :src="meetLogo" :alt="__('Frappe Meet')" class="size-7 shrink-0" />
								<div class="min-w-0 flex-1">
									<div class="text-sm font-medium text-ink-gray-8 mb-0.5">
										{{ __('Frappe Meet') }}
									</div>
									<div class="truncate text-xs text-ink-gray-5">{{ meetLinkDisplay }}</div>
								</div>
								<Button variant="ghost" :tooltip="__('Copy Frappe Meet link')" @click="copyMeetLink">
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
									:size="FIELD_ICON_SIZE"
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
									<Button icon="lucide-x" class="mt-auto" @click="event.locations.splice(i, 1)" />
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
									:size="FIELD_ICON_SIZE"
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

							<!-- calendar -->
							<!-- Only where there is a choice: with one calendar the row would name it and do nothing. -->
							<div v-if="store.calendarOptions.length > 1" class="flex gap-3">
								<CalendarDays :size="FIELD_ICON_SIZE" class="icon mt-7 shrink-0 text-ink-gray-5" />
								<FormControl
									v-model="eventCalendar"
									type="select"
									:label="__('Calendar')"
									:options="store.calendarOptions"
									class="min-w-0 flex-1"
								>
									<template #item-prefix="{ item }">
										<span
											class="size-2.5 shrink-0 rounded-full"
											:style="{ background: eventColor(item.color) }"
										/>
									</template>
								</FormControl>
							</div>

							<!-- availability & visibility -->
							<div class="flex gap-3">
								<Briefcase :size="FIELD_ICON_SIZE" class="icon mt-7 shrink-0 text-ink-gray-5" />
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
								<AlignLeft :size="FIELD_ICON_SIZE" class="icon mt-7 shrink-0 text-ink-gray-5" />
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
					<div
						class="w-[300px] shrink-0 overflow-y-auto border-l px-5 py-5 max-sm:w-full max-sm:overflow-visible max-sm:border-l-0 max-sm:border-t"
					>
						<div class="mb-3 flex items-baseline gap-2">
							<Users :size="FIELD_ICON_SIZE" class="icon self-center text-ink-gray-5" />
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
					<Button :label="__('Cancel')" variant="outline" @click="cancel" />
					<!-- Split button, as mail's compose: one pill, the 1px gap shows the
					     footer background as the divider. The tooltip sits on the wrapper:
					     a disabled button doesn't get the hover events it would need. -->
					<Tooltip
						:text="
							__(
								'No identity to organize the event. Add a participant identity in Calendar Settings whose email is also one of the account\'s mail identities.',
							)
						"
						:disabled="!missingOrganizer"
					>
						<div class="flex items-center gap-px">
							<Button
								:label="__('Save')"
								variant="solid"
								:disabled="disableSave"
								class="min-w-16"
								:class="canSaveDraft && '!rounded-r-none'"
								@click="handleSaveClick"
							/>
							<Dropdown v-if="canSaveDraft" :options="draftOptions">
								<Button
									variant="solid"
									class="!rounded-l-none"
									:disabled="isSaving || !isDateTimeValid || missingOrganizer"
									:aria-label="__('More save options')"
								>
									<template #icon><ChevronDown class="h-4 w-4" /></template>
								</Button>
							</Dropdown>
						</div>
					</Tooltip>
				</div>
			</div>
		</template>
	</Dialog>
	<MobileEventForm
		v-else-if="show"
		:event="event"
		:title="dialogTitle"
		:is-new="isNew"
		:disable-save="disableSave"
		:participants="participants"
		:meet-url="meetUrl"
		:meet-link-display="meetLinkDisplay"
		@cancel="cancel"
		@save="handleSaveClick"
		@toggle-repeat="toggleRepeat"
		@set-all-day="setAllDay"
		@set-alerts="setAlerts"
		@join-meet="joinMeet"
	/>
	<EventRepeatSettingsModal
		v-if="event?.startDate"
		v-model="showRepeatSettings"
		:start-date="event.startDate"
		:r-rule="event?.recurrence_rule"
		@update-recurrence-rule="(val) => (event.recurrence_rule = val)"
	/>
	<Dialog v-model:open="showDiscardModal" v-bind="DISCARD_MODAL_OPTIONS">
		<template #actions>
			<!-- Two answers: keep what was typed, or throw it away. Keeping it means the
			     draft where there can be one, and only otherwise means staying in the form —
			     "Keep editing" beside "Save as draft" offered the same thing twice, and the
			     dialog's ✕ is already the way back. Stacked on a phone, where two buttons in
			     a row leave each too narrow to read; least destructive first either way. -->
			<div class="flex justify-end gap-2 max-sm:flex-col">
				<Button
					v-if="canKeepAsDraft"
					:label="__('Save as draft')"
					variant="solid"
					@click="saveDraftFromDiscard"
				/>
				<Button v-else :label="__('Keep editing')" @click="showDiscardModal = false" />
				<Button :label="__('Discard')" variant="subtle" theme="red" @click="discardChanges" />
			</div>
		</template>
	</Dialog>
	<RecurringScopeModal
		v-model="showRecurringEventModal"
		v-bind="recurringScopeModalProps"
		@confirm="handleSaveRecurringEvent"
	/>
	<RecurringScopeModal
		v-model="showDeleteScopeModal"
		v-bind="deleteScopeModalProps"
		@confirm="deleteScope"
	/>
	<Dialog v-model:open="showNotifyDeleteModal" v-bind="NOTIFY_DELETE_OPTIONS">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button variant="outline" @click="pendingDelete?.(false)">
					{{ __('Skip') }}
				</Button>
				<Button variant="solid" @click="pendingDelete?.(true)">
					{{ __('Send Email') }}
				</Button>
			</div>
		</template>
	</Dialog>
	<Dialog v-model:open="showNotifyParticipantsModal" v-bind="showNotifyParticipantsOptions">
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
