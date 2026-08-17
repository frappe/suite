<template>
	<!-- Variant B of the Invite strip design doc: the generic calendar glyph carries no
	     information, so it becomes the date itself — scannable down a thread at a glance — and
	     the RSVP trio becomes a segmented control, the one thing three outline buttons can't do:
	     hold a selection. -->
	<div
		v-if="invite"
		class="border-outline-gray-2 bg-surface-base mb-3 flex flex-col gap-3 rounded-4 border px-4 py-3 sm:flex-row sm:items-center"
	>
		<!-- Opening the event is the first thing anyone tries to tap, so the target is the dates and
		     the text together rather than the title alone — but it stops at the content: no flex-1,
		     or the empty space between the strip's two halves would answer to a click. Only offered
		     once the event is on a calendar of the reader's: the detail panel is a view of a real
		     event, not of a parsed preview. -->
		<component
			:is="canViewEvent ? 'button' : 'div'"
			:type="canViewEvent ? 'button' : undefined"
			class="flex min-w-0 max-w-full items-center gap-3.5 self-start text-left sm:self-center"
			@click="openEventDetail"
		>
			<!-- A span gets a chip per end: one chip can only ever claim one date. The arrow between
			     them is what keeps 17 → 19 from reading as two unrelated events. -->
			<div class="flex shrink-0 items-center gap-1.5">
				<template v-for="(chip, index) in chips" :key="index">
					<ArrowRight v-if="index" class="text-ink-gray-4 size-3 shrink-0 stroke-1.5" />
					<DateChip :month="chip.month" :day="chip.day" />
				</template>
			</div>
			<div class="min-w-0 flex-1">
				<!-- The strip is the only place the event is named, so at 393px — where a real title
				     rarely fits on one line — it wraps to two rather than truncating. -->
				<span class="text-ink-gray-8 text-base-medium line-clamp-2 sm:line-clamp-1">
					{{ invite.event.title || __('Untitled event') }}
				</span>
				<span v-if="whenLabel" class="text-ink-gray-5 mt-0.5 block truncate text-sm">
					{{ whenLabel }}
				</span>
				<span v-if="locationLabel" class="text-ink-gray-5 block truncate text-sm">
					{{ locationLabel }}
				</span>
			</div>
		</component>
		<div class="flex shrink-0 items-center justify-end sm:ml-auto">
			<!-- On mobile the answers get the width the row was already spending: full-bleed, and
			     40px tall inside a 44px control, against the ~26px the intrinsic-width version gave
			     them. Same overrides the calendar app's event detail sidebar uses, held to max-sm so
			     the desktop strip keeps its compact right-aligned control. -->
			<TabButtons
				v-if="invite.participant"
				class="max-sm:w-full max-sm:[&>div>[data-slot=tab-button]]:flex-1 max-sm:[&>div]:w-full max-sm:[&>div]:p-0.5 max-sm:[&_[data-slot=tab-button]>span]:h-10 max-sm:[&_[data-slot=tab-button]>span]:w-full"
				:options="RSVP_OPTIONS"
				:model-value="selectedResponse"
				@update:model-value="handleRsvp"
			/>
			<!-- The single-button states take the same mobile treatment as the RSVP control they
			     stand in for: whichever one the strip shows, it is the row's one action and gets the
			     full width and the 40px height. -->
			<Button
				v-else-if="!invite.exists"
				class="max-sm:!h-10 max-sm:w-full"
				:label="__('Add to Calendar')"
				:loading="addInvite.loading"
				@click="addInvite.submit()"
			/>
			<Button
				v-else
				class="max-sm:!h-10 max-sm:w-full"
				variant="outline"
				:label="__('View in Calendar')"
				@click="viewInCalendar"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'
import { Button, TabButtons, createResource } from 'frappe-ui'

import DateChip from '@/apps/calendar/components/DateChip.vue'
import dayjs from '@/apps/calendar/utils/dayjs'
import { eventLastDay, formatEventWhen, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { eventDayRoute, useUpcomingEvents } from '@/apps/mail/composables/useUpcomingEvents'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'

import type { Attachment } from '@/apps/mail/types'

// The slice of the formatted calendar event the banner reads; the full shape comes from the
// backend's format_calendar_event, identical for a parsed preview and an existing event.
interface InviteEvent {
	id: string
	title: string
	start: string
	duration: string
	time_zone: string
	show_without_time: 0 | 1
	recurrence_id?: string | null
	locations: { _name?: string }[]
}

interface InviteDetails {
	uid: string
	method: string
	exists: boolean
	event: InviteEvent
	// The viewer's own entry on the event — present when they're invited, carrying their
	// current response (e.g. 'ACCEPTED', or '' when they haven't answered yet).
	participant: { uid: string; email: string; status: string } | null
}

const { attachment, account } = defineProps<{ attachment: Attachment; account: string }>()

const router = useRouter()
const { isMobile } = useScreenSize()
const { events: calendarEvents, selectedEvent, openEvent } = useUpcomingEvents()

const details = createResource({
	url: 'suite.calendar.api.invites.get_invite_details',
	params: { account, blob_id: attachment.blob_id },
	auto: true,
})

// Only an invitation (or a plain published event) is addable — a cancellation or an attendee's
// reply also travels as text/calendar, and a banner offering to add those would be nonsense.
const invite = computed<InviteDetails | null>(() => {
	const data = details.data
	if (!data?.event) return null
	if (data.method && !['request', 'publish'].includes(data.method)) return null
	return data
})

// JSCalendar start/duration are a wall clock in the event's own zone; render them in the
// reader's, mirroring the calendar app (see @/apps/calendar/utils/datetime).
const localZone = () => dayjs.tz?.guess?.() || Intl.DateTimeFormat().resolvedOptions().timeZone

const isAllDay = computed(() => !!invite.value?.event && isAllDayEvent(invite.value.event))

const start = computed(() => {
	const event = invite.value?.event
	if (!event?.start) return null
	// An all-day event falls on the same calendar date for everyone, so it keeps its own wall
	// clock — moving its midnight into the reader's zone would slide it a day either way.
	if (isAllDay.value) return dayjs(event.start)
	if (!event.time_zone) return dayjs(event.start)
	return dayjs.tz(event.start, event.time_zone).tz(localZone())
})

// One chip for a single day, two for a span — the last day coming from the formatter rather than
// the raw end, so the exclusive midnight boundary is walked back in exactly one place.
const chips = computed(() => {
	if (!start.value) return []
	const duration = invite.value?.event.duration
	const last = eventLastDay(start.value, duration, isAllDay.value)
	return [start.value, ...(last ? [last] : [])].map((day) => ({
		month: day.format('MMM'),
		day: day.format('D'),
	}))
})

const whenLabel = computed(() =>
	start.value
		? formatEventWhen(start.value, invite.value?.event.duration, {
				allDay: isAllDay.value,
				compact: true,
			})
		: '',
)

const locationLabel = computed(() =>
	(invite.value?.event.locations || [])
		.map((location) => location._name)
		.filter(Boolean)
		.join(', '),
)

const addInvite = createResource({
	url: 'suite.calendar.api.invites.add_invite_to_calendar',
	makeParams: () => ({ account, blob_id: attachment.blob_id }),
	onSuccess: (event: InviteEvent) => {
		// Flip to the "added" state with the created copy (which has the id the deep link needs)
		// instead of refetching — the server's uid index updates asynchronously, so an immediate
		// refetch could still report the event as missing.
		details.data = { ...details.data, exists: true, event }
		raiseToast(__('Event added to your calendar.'))
		calendarEvents.reload()
	},
	onError: (error: { message?: string }) => raiseToast(error.message || '', 'error'),
})

// --- RSVP (the same segmented control the calendar app's event detail sidebar uses) ---

const RSVP_OPTIONS = [
	{ label: __('Yes'), value: 'ACCEPTED' },
	{ label: __('Maybe'), value: 'TENTATIVE' },
	{ label: __('No'), value: 'DECLINED' },
]

const currentResponse = computed(() => invite.value?.participant?.status || '')
const pendingResponse = ref('')

const rsvp = createResource({
	url: 'suite.calendar.api.invites.rsvp_to_invite',
	makeParams: (response: string) => ({ account, blob_id: attachment.blob_id, response }),
	onSuccess: (event: InviteEvent) => {
		details.data = {
			...details.data,
			exists: true,
			event,
			participant: { ...details.data.participant, status: pendingResponse.value },
		}
		raiseToast(__('Response sent.'))
		calendarEvents.reload()
		// The panel isn't fed by that resource when it was opened from here (untracked), so hand it
		// the fresh copy directly or it would keep showing the previous answer.
		if (isOpen.value) openEvent(event, { tracked: false })
	},
	onError: (error: { message?: string }) => raiseToast(error.message || '', 'error'),
})

// An RSVP is a state, so the control shows the answer as soon as it's tapped, and falls back to
// the stored one if the request fails.
const selectedResponse = computed(() =>
	rsvp.loading ? pendingResponse.value : currentResponse.value,
)

const handleRsvp = (response?: string | number) => {
	if (typeof response !== 'string' || rsvp.loading || response === currentResponse.value) return
	pendingResponse.value = response
	rsvp.submit(response.toLowerCase())
}

// Opening the event — in the panel or in the calendar — needs its own id, which only a copy on
// one of the reader's calendars has; a parsed preview of an invite they haven't added yet has none.
const canViewEvent = computed(() => !!invite.value?.exists && !!invite.value.event.id)

const viewInCalendar = () => {
	const event = invite.value?.event
	if (canViewEvent.value && event) router.push(eventDayRoute(event, account))
}

// Whether the detail panel is currently showing this strip's event.
const isOpen = computed(
	() => !!selectedEvent.value && selectedEvent.value.id === invite.value?.event.id,
)

// Reading an invite and leaving the thread to read the event are different things: the strip
// opens the same detail panel the sidebar's Upcoming events widget uses, hosted by DefaultLayout,
// so the message stays where it is. Mobile has no room for that panel (DefaultLayout only mounts
// it on desktop), so there it still hands over to the calendar app's day view.
const openEventDetail = () => {
	const event = invite.value?.event
	if (!canViewEvent.value || !event) return
	if (isMobile.value) router.push(eventDayRoute(event, account))
	else if (isOpen.value) selectedEvent.value = null
	else openEvent(event, { tracked: false })
}
</script>
