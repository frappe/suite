<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
	Bell,
	Briefcase,
	Copy,
	Globe,
	Lock,
	Mail,
	MapPin,
	MoreHorizontal,
	Repeat,
	SquarePen,
	Text,
	Trash2,
	Users,
	X,
} from 'lucide-vue-next'
import { Badge, Button, Dialog, Dropdown, TabButtons, createResource, toast } from 'frappe-ui'
import DOMPurify from 'dompurify'

import meetLogo from '@/assets/app-logos/meet.png'

import { getMeetUrl, getReorderedParticipants, isUrl } from '@/apps/calendar/utils'
import { fromEventZone, inUserTimeZone } from '@/apps/calendar/utils/datetime'
import { eventLastDay, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { getRepeatMessage } from '@/apps/calendar/utils/format'
import { userStore } from '@/apps/calendar/stores/user'
import EventParticipantList from '@/apps/calendar/components/EventParticipantList.vue'
import LinkifiedText from '@/components/LinkifiedText.vue'

const { calendarEvent } = defineProps<{ calendarEvent: any }>()

const emit = defineEmits(['close', 'edit', 'reloadEvents', 'emailParticipants'])

const dayjs = inject('$dayjs')

const store = userStore()
const { participantIdentities } = store

// --- User / RSVP ---

const userParticipant = computed(() =>
	calendarEvent.participants.find((p) => participantIdentities.data?.some((id) => id.email === p.email)),
)
const userResponse = computed(() => userParticipant.value?.participation_status)

const RSVP_OPTIONS = [
	{ label: __('Yes'), value: 'ACCEPTED' },
	{ label: __('No'), value: 'DECLINED' },
	{ label: __('Maybe'), value: 'TENTATIVE' },
]

// RSVPs go through the dedicated endpoint rather than a whole-event edit: it patches only the
// caller's own participationStatus, and routes the organizer's notification through the custom
// event_response template when custom event invites are enabled.
const rsvpEvent = createResource({
	url: 'suite.calendar.api.rsvp_calendar_event',
	makeParams: (response: string) => ({
		account: store.accountId,
		// master_id is only set on recurring events; fall back to the event's own id
		id: calendarEvent.master_id || calendarEvent.id,
		response: response.toLowerCase(),
	}),
	onSuccess: () => emit('reloadEvents'),
})

const handleSetResponse = (response: string) => {
	if (!response || response === userResponse.value) return
	toast.promise(rsvpEvent.submit(response), {
		loading: __('Sending response...'),
		success: __('Response sent.'),
		error: __('Action failed. Please try again in some time.'),
	})
}

// --- Calendar (colour + account) ---

const DEFAULT_EVENT_COLOR = '#30a66d'

const eventCalendar = computed(
	() => calendarEvent.calendars?.find((c: any) => c.color) ?? calendarEvent.calendars?.[0],
)

// The organizer beats the viewer's own address (redundant in their own panel);
// for self-organized events they coincide. Fall back to the account's address
// (from participantIdentities — the calendar id only carries an opaque JMAP account id),
// then the calendar's display name.
const calendarOwnerLabel = computed(
	() =>
		calendarEvent.organizer?.replace('mailto:', '') ||
		participantIdentities.data?.[0]?.email ||
		eventCalendar.value?.calendar_name,
)

// --- Date / time label ---

const dateLabel = computed(() => {
	// Full-day events keep their own calendar date (the stored wall clock); timed events are
	// shown in the viewer's zone.
	const isFullDay = isAllDayEvent(calendarEvent)
	const start = isFullDay
		? dayjs(calendarEvent.start)
		: fromEventZone(calendarEvent.start, calendarEvent.time_zone)
	const end = start.add(dayjs.duration(calendarEvent.duration))

	const currentYear = dayjs().year()
	const showYear = start.year() !== currentYear || end.year() !== currentYear
	const dateFormat = showYear ? 'ddd, D MMM YYYY' : 'ddd, D MMM'

	if (isFullDay) {
		const lastDay = eventLastDay(start, calendarEvent.duration, true)
		if (!lastDay) return start.format(dateFormat)
		return `${start.format(dateFormat)} - ${lastDay.format(dateFormat)}`
	}

	const isSameDay = start.isSame(end, 'day')
	if (isSameDay)
		return `${start.format('h:mm a')} - ${end.format('h:mm a')} · ${start.format(dateFormat)}`
	return `${start.format(`${dateFormat}, h:mm a`)} - ${end.format(`${dateFormat}, h:mm a`)}`
})

// --- Participants ---

const participantSummary = computed(() => {
	const total = new Set(calendarEvent.participants.map((p) => p.email)).size
	return total === 1 ? __('{0} person', [total]) : __('{0} people', [total])
})

const responseSummary = computed(() => {
	const count = (status: string) =>
		calendarEvent.participants.filter((p) => p.participation_status === status).length

	// No "awaiting": with the total right next to it, pending = total − responses.
	const parts = [
		count('ACCEPTED') && __('{0} yes', [count('ACCEPTED')]),
		count('DECLINED') && __('{0} no', [count('DECLINED')]),
		count('TENTATIVE') && __('{0} maybe', [count('TENTATIVE')]),
	].filter(Boolean)

	return parts.join(', ')
})

const orderedParticipants = computed(() => {
	const ordered = getReorderedParticipants(calendarEvent.participants, calendarEvent.organizer)

	// The organizer isn't always among the participants (e.g. some external invites).
	// The popover had a dedicated organizer row; keep that info visible by prepending
	// a synthetic entry so the list always leads with the organizer.
	if (!ordered.some((p) => p.isOrganizer) && calendarEvent.organizer)
		return [
			{ email: calendarEvent.organizer.replace('mailto:', ''), isOrganizer: true },
			...ordered,
		]

	return ordered
})

const VISIBLE_PARTICIPANT_COUNT = 4
const showAllParticipants = ref(false)

const visibleParticipants = computed(() =>
	showAllParticipants.value
		? orderedParticipants.value
		: orderedParticipants.value.slice(0, VISIBLE_PARTICIPANT_COUNT),
)

// Everyone except the viewer; the host decides what "email them" means (mail
// opens its compose window, the calendar app falls back to mailto).
const participantEmails = computed(() =>
	calendarEvent.participants
		.map((p) => p.email)
		.filter((email) => email && participantIdentities.data?.every((id) => id.email !== email)),
)

// --- Alerts ---

const formatAlert = (a: any) => {
	if (a.type === 'AbsoluteTrigger') return inUserTimeZone(a.when).format('D MMM, h:mm a')

	const d = dayjs.duration(a.offset).$d
	const units = {
		weeks: [__('week'), __('weeks')],
		days: [__('day'), __('days')],
		hours: [__('hour'), __('hours')],
		minutes: [__('min'), __('min')],
	}
	const unit = Object.keys(units).find((u) => d[u]) ?? 'minutes'
	const number = Math.abs(d[unit])
	const label = units[unit][number === 1 ? 0 : 1]

	if (!number) return __('At time of event')
	return a.offset.startsWith('-')
		? __('{0} {1} before', [number, label])
		: __('{0} {1} after', [number, label])
}

// --- Description ---

// Tags a description can reasonably carry. No <img> (remote assets in an invite from an external
// organizer are a tracking vector) and no <style>/<script>: this renders inline in our page rather
// than in an iframe, so it must not be able to restyle the app.
const ALLOWED_TAGS = [
	'a', 'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's',
	'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]

// Descriptions arrive either as plain text or as HTML, depending on what the organizer's client put
// in the invite. Plain text goes through <LinkifiedText>; HTML is sanitized and rendered below.
// Derived from ALLOWED_TAGS so the two can't drift.
const HTML_TAG_RE = new RegExp(`<(${ALLOWED_TAGS.join('|')})\\b[^>]*>`, 'i')

const isHtmlDescription = computed(() => HTML_TAG_RE.test(calendarEvent.description ?? ''))

const sanitizedDescription = computed(() => {
	const clean = DOMPurify.sanitize(calendarEvent.description ?? '', {
		ALLOWED_TAGS,
		ALLOWED_ATTR: ['href', 'title'],
	})
	// Force links to open safely. Done after sanitizing rather than with DOMPurify.addHook, which is
	// global and would leak into every other caller (notably mail's <EmailContent>).
	const doc = new DOMParser().parseFromString(clean, 'text/html')
	doc.querySelectorAll('a').forEach((anchor) => {
		anchor.setAttribute('target', '_blank')
		anchor.setAttribute('rel', 'noopener noreferrer')
	})
	return doc.body.innerHTML
})

// --- Meet link ---

// Same fallback as the event modal: prefer the sanitized same-origin path, but
// keep a raw foreign-origin link joinable rather than hiding the section.
const meetUrl = computed(() => {
	const href =
		calendarEvent.links?.find((item: any) => item?.href?.includes('/meet/'))?.href ||
		calendarEvent.description?.match(
			/https?:\/\/\S+\/meet\/[a-zA-Z0-9-]+|\/meet\/[a-zA-Z0-9-]+/,
		)?.[0]
	if (!href) return ''
	return getMeetUrl(href) || href.replace(/\W+$/, '')
})

const meetLinkDisplay = computed(() =>
	meetUrl.value
		? new URL(meetUrl.value, window.location.origin).href.replace(/^https?:\/\//, '')
		: '',
)

const copyMeetLink = async () => {
	await navigator.clipboard.writeText(new URL(meetUrl.value, window.location.origin).href)
	toast.success(__('Frappe Meet link copied.'))
}

const joinMeet = () => {
	if (!meetUrl.value) return
	// Same-origin paths stay in-app; foreign links open in a new tab.
	if (meetUrl.value.startsWith('/')) window.location.href = meetUrl.value
	else window.open(meetUrl.value, '_blank', 'noopener')
}

// --- Details block ---

// Every row of it is individually optional, so an event with nothing but a
// title and a time has none of them — and the block would otherwise render as
// a hollow band of padding between two dividers.
const hasDetails = computed(
	() =>
		!!calendarEvent.recurrence_id ||
		!!meetUrl.value ||
		!!calendarEvent.locations?.length ||
		!!calendarEvent.alerts?.length ||
		!!calendarEvent.free_busy_status ||
		!!calendarEvent.privacy,
)

// --- Actions dropdown (delete) ---

const dropdownOptions = computed(() => {
	const editOption = { label: __('Edit'), icon: SquarePen, onClick: () => emit('edit') }

	if (calendarEvent.recurrence_id)
		return [
			editOption,
			{
				label: __('Delete'),
				icon: Trash2,
				submenu: [
					{ label: __('This instance'), onClick: () => handleDeleteEventInstance() },
					{
						label: __('This and following instances'),
						onClick: () => handleDeleteFollowingEventInstances(),
					},
					{ label: __('Entire series'), onClick: () => handleDeleteEvent() },
				],
			},
		]
	return [
		editOption,
		{ label: __('Delete'), icon: Trash2, onClick: () => handleDeleteEvent() },
	]
})

// --- Server calls ---

const editEvent = createResource({
	url: 'suite.calendar.api.edit_calendar_event',
	makeParams: ({ patch }) => ({
		account: store.accountId,
		// master_id is only set on recurring events; fall back to the event's own id
		id: calendarEvent.master_id || calendarEvent.id,
		...patch,
		send_scheduling_messages: true,
	}),
	onSuccess: () => emit('reloadEvents'),
})

// When the organizer deletes an event with other participants, offer to email a cancellation
// (mirrors the "Notify Participants" prompt shown when creating/editing an event).
const isOrganizer = computed(
	() =>
		participantIdentities.data?.some(
			(id) => id.email === (calendarEvent.organizer || '').replace('mailto:', ''),
		) ?? false,
)
const hasParticipantsOtherThanUser = computed(
	() =>
		calendarEvent.participants?.some((p) => participantIdentities.data?.every((i) => i.email !== p.email)) ??
		false,
)

const showNotifyModal = ref(false)
const pendingDelete = ref<((sendEmail: boolean) => void) | null>(null)

const confirmDelete = (submit: (sendEmail: boolean) => Promise<any>, recurring: boolean) => {
	const run = (sendEmail: boolean) => {
		showNotifyModal.value = false
		toast.promise(submit(sendEmail), {
			loading: recurring ? __('Deleting events...') : __('Deleting event...'),
			success: recurring ? __('Events deleted.') : __('Event deleted.'),
			error: __('Action failed. Please try again in some time.'),
		})
	}

	// A draft never sent its invitations, so there is no one to tell it is gone.
	if (isOrganizer.value && hasParticipantsOtherThanUser.value && !calendarEvent.isDraft) {
		pendingDelete.value = run
		showNotifyModal.value = true
	} else {
		run(false)
	}
}

const handleDeleteEventInstance = () =>
	confirmDelete((sendEmail) => deleteEventInstance.submit({ sendEmail }), false)

const handleDeleteFollowingEventInstances = () => {
	const recurrenceRule = { ...calendarEvent.recurrence_rule }
	recurrenceRule.until = `${calendarEvent.date}T00:00:00Z`
	const patch = { recurrence_rule: JSON.stringify(recurrenceRule) }

	toast.promise(
		editEvent.submit({ patch }).then(() => emit('close')),
		{
			loading: __('Deleting events...'),
			success: __('Events deleted.'),
			error: __('Action failed. Please try again in some time.'),
		},
	)
}

const handleDeleteEvent = () =>
	confirmDelete((sendEmail) => deleteEvent.submit({ sendEmail }), !!calendarEvent.recurrence_id)

const deleteEventInstance = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_event_instance',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		master_id: calendarEvent.master_id,
		recurrence_id: calendarEvent.recurrence_id,
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: () => {
		emit('reloadEvents')
		emit('close')
	},
})

const deleteEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.delete_calendar_events',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: store.accountId,
		ids: [calendarEvent.master_id || calendarEvent.id],
		send_scheduling_messages: sendEmail,
	}),
	onSuccess: () => {
		emit('reloadEvents')
		emit('close')
	},
})

const NOTIFY_DELETE_OPTIONS = {
	title: __('Notify Participants'),
	icon: { name: 'lucide-bell' },
	message: __('Send a cancellation email to let attendees know this event was deleted?'),
}

const openUrl = (location: string) => {
	if (isUrl(location)) window.open(location, '_blank')
}
</script>

<template>
	<div
		class="bg-surface-base flex h-full w-[352px] shrink-0 flex-col overflow-hidden border-l text-left"
	>
		<!-- Header -->
		<!-- h-12 matches the mail header bar's 48px, so when mail hosts this panel
		     the two headers read as one row. Instead of a static title, it names
		     the calendar the event belongs to: its colour dot + the organizer. -->
		<div class="flex h-12 items-center gap-3 px-4.5">
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<span
					class="size-2.5 shrink-0 rounded-full"
					:style="{ backgroundColor: eventCalendar?.color || DEFAULT_EVENT_COLOR }"
				/>
				<span class="text-ink-gray-6 truncate text-sm">
					{{ calendarOwnerLabel }}
				</span>
			</div>
			<div class="flex items-center gap-1">
				<Dropdown :options="dropdownOptions">
					<Button
						variant="ghost"
						:disabled="deleteEventInstance.loading || deleteEvent.loading"
					>
						<MoreHorizontal class="icon text-ink-gray-7" />
					</Button>
				</Dropdown>
				<Button variant="ghost" :tooltip="__('Close')" @click="emit('close')">
					<X class="icon text-ink-gray-7" />
				</Button>
			</div>
		</div>

		<!-- -mt-2 eats the header's centering slack so the visual gap above the
		     title (which also includes the header text's own centering slack and
		     the title's half-leading) matches the pb below the date; it sits on
		     the scroll wrapper because a negative margin on the first child of an
		     overflow-y-auto box would only clip. -->
		<div class="-mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
			<!-- Title and time. No top padding — what's left of the header's
			     centering slack is the gap above the title; pb balances it below
			     the date and keeps breathing room when a long title wraps (the
			     block just grows). Single-line, -mt + block sum to 49px, so
			     header (48) + block + divider match the mail header bar +
			     screener banner (49px each) and the divider lands on the
			     banner's border when mail hosts the panel. -->
			<div class="flex flex-col px-4.5 pb-3">
				<!-- leading-6 keeps wrapped titles readable while leaving the
				     title–date gap clearly wider than the title's own line gap; the
				     date keeps text-sm's default 1.15 line-height (14.95px), so
				     -8 + 24 + 6 + 14.95 + 12 sums to 49 within a subpixel. -->
				<div class="min-w-0 space-y-1.5">
					<h3 class="text-ink-gray-8 break-words text-md font-semibold leading-6">
						{{ calendarEvent.title || __('Untitled event') }}
					</h3>
					<div class="flex items-center gap-2 text-sm text-ink-gray-6">
						<Badge v-if="calendarEvent.isDraft" theme="gray" :label="__('Draft')" />
						<span class="break-words">{{ dateLabel }}</span>
					</div>
				</div>
			</div>

			<div class="border-t" />

			<!-- Details. The block goes, trailing divider included, when the event
			     carries none of these rows — the divider above it stays, so the
			     panel reads title / date / participants. -->
			<div v-if="hasDetails" class="flex flex-col py-2">
				<!-- Recurrence -->
				<div
					v-if="calendarEvent.recurrence_id"
					class="flex items-center gap-2.5 px-4.5 py-2"
				>
					<Repeat class="icon text-ink-gray-5 size-4 shrink-0" />
					<span class="text-ink-gray-7 min-w-0 break-words text-sm">
						{{ getRepeatMessage(calendarEvent.recurrence_rule) }}
					</span>
				</div>

				<!-- Meet link -->
				<template v-if="meetUrl">
					<div class="flex items-center gap-2.5 px-4.5 py-2">
						<img :src="meetLogo" :alt="__('Frappe Meet')" class="size-7 shrink-0" />
						<div class="min-w-0 flex-1">
							<div class="text-ink-gray-8 text-sm font-medium">
								{{ __('Frappe Meet') }}
							</div>
							<div class="text-ink-gray-5 truncate text-xs">{{ meetLinkDisplay }}</div>
						</div>
						<button
							class="text-ink-gray-5 hover:text-ink-gray-7 shrink-0"
							:title="__('Copy Frappe Meet link')"
							@click="copyMeetLink"
						>
							<Copy class="icon size-4" />
						</button>
					</div>
					<div class="px-4.5 py-2">
						<button
					class="bg-surface-gray-2 hover:bg-surface-gray-3 text-ink-gray-7 flex w-full items-center justify-center gap-2 rounded-4 py-1.5 text-sm"
							@click="joinMeet"
						>
							{{ __('Join') }}
						</button>
					</div>
				</template>

				<!-- Locations -->
				<div
					v-for="location in calendarEvent.locations"
					:key="location.uid"
					class="flex items-center gap-2.5 px-4.5 py-2"
				>
					<component
						:is="isUrl(location._name) ? Globe : MapPin"
						class="icon text-ink-gray-5 size-4 shrink-0"
					/>
					<span
						class="text-ink-gray-7 min-w-0 break-words text-sm"
						:class="{ 'text-ink-blue-6 cursor-pointer hover:underline': isUrl(location._name) }"
						@click="openUrl(location._name)"
					>
						{{ location._name }}
					</span>
				</div>

				<!-- Alerts. Every reminder is the same kind of thing, so the bell is
				     drawn once and the rows below it keep the text column — the group
				     reads as one list rather than as several details. -->
				<div
					v-if="calendarEvent.alerts?.length"
					class="flex flex-col gap-1 px-4.5 py-2"
				>
					<div
						v-for="(alert, i) in calendarEvent.alerts"
						:key="i"
						class="flex items-center gap-2.5"
					>
						<Bell v-if="i === 0" class="icon text-ink-gray-5 size-4 shrink-0" />
						<span v-else class="size-4 shrink-0" />
						<span class="text-ink-gray-7 min-w-0 break-words text-sm">
							{{ formatAlert(alert) }}
						</span>
					</div>
				</div>

				<!-- Availability -->
				<div v-if="calendarEvent.free_busy_status" class="flex items-center gap-2.5 px-4.5 py-2">
					<Briefcase class="icon text-ink-gray-5 size-4 shrink-0" />
					<span class="text-ink-gray-7 text-sm">{{ __(calendarEvent.free_busy_status) }}</span>
				</div>

				<!-- Visibility -->
				<div v-if="calendarEvent.privacy" class="flex items-center gap-2.5 px-4.5 py-2">
					<Lock class="icon text-ink-gray-5 size-4 shrink-0" />
					<span class="text-ink-gray-7 text-sm">{{ __(calendarEvent.privacy) }}</span>
				</div>
			</div>

			<div v-if="hasDetails" class="border-t" />

			<!-- Participants: the section's own y padding matches the header row's
			     py-2, so it reads as evenly spaced. Counting the row's padding
			     towards the top instead left the section 8px/16px — the row's
			     padding belongs to the row, not to the section. -->
			<div class="flex flex-col py-2">
				<div class="flex items-center gap-2.5 px-4.5 py-2">
					<Users class="icon text-ink-gray-5 size-4 shrink-0" />
					<div class="text-ink-gray-7 min-w-0 flex-1 truncate text-sm">
						{{ participantSummary
						}}<span v-if="responseSummary" class="text-ink-gray-6">
							({{ responseSummary }})</span
						>
					</div>
					<!-- -my keeps the 28px ghost button from inflating the row. -->
					<Button
						v-if="participantEmails.length"
						variant="ghost"
						class="-my-1.5 shrink-0"
						:tooltip="__('Email participants')"
						@click="emit('emailParticipants', participantEmails)"
					>
						<Mail class="icon text-ink-gray-7 size-4" />
					</Button>
				</div>
				<!-- Indented to the header row's text axis (gutter + icon + gap): the
				     list is the "2 people" line's expansion, so they read as one
				     block with the icon hanging in the gutter. -->
				<div class="space-y-3 py-2 pl-11 pr-4.5">
					<EventParticipantList
						:participants="visibleParticipants"
						:dont-show-remove="true"
					/>
					<button
						v-if="!showAllParticipants && orderedParticipants.length > VISIBLE_PARTICIPANT_COUNT"
						class="text-ink-gray-6 hover:text-ink-gray-8 flex items-center gap-2.5 py-0.5 text-sm"
						@click="showAllParticipants = true"
					>
						<MoreHorizontal class="icon size-3.5 shrink-0" />
						{{ __('See all participants') }}
					</button>
				</div>
			</div>

			<template v-if="calendarEvent.description">
				<div class="border-t" />

				<!-- Description: no label — the icon in the gutter with the body on
				     the text axis says it, like the panel's other icon rows. -->
				<div class="flex items-start gap-2.5 px-4.5 py-4">
					<Text class="icon text-ink-gray-5 mt-0.5 size-4 shrink-0" />
					<div class="text-ink-gray-7 min-w-0 flex-1 text-sm leading-normal">
						<div
							v-if="isHtmlDescription"
							class="break-words [&_a]:text-ink-blue-6 [&_a]:hover:underline [&_p]:m-0"
							v-html="sanitizedDescription"
						/>
						<LinkifiedText v-else :text="calendarEvent.description" />
					</div>
				</div>
			</template>
		</div>

		<!-- RSVP -->
		<div v-if="userParticipant?.expect_reply" class="flex flex-col gap-2 px-4.5 pb-3 pt-2">
			<span class="text-ink-gray-6 text-sm">{{ __('Going?') }}</span>
			<TabButtons
				class="w-full [&>div>[data-slot=tab-button]]:flex-1 [&>div]:w-full [&_[data-slot=tab-button]>span]:w-full"
				:model-value="userResponse"
				:options="RSVP_OPTIONS"
				@update:model-value="handleSetResponse"
			/>
		</div>

		<Dialog v-model:open="showNotifyModal" v-bind="NOTIFY_DELETE_OPTIONS">
			<template #actions>
				<div class="flex justify-end space-x-2">
					<Button variant="outline" @click="pendingDelete?.(false)"> {{ __('Skip') }} </Button>
					<Button variant="solid" @click="pendingDelete?.(true)">
						{{ __('Send Email') }}
					</Button>
				</div>
			</template>
		</Dialog>
	</div>
</template>
