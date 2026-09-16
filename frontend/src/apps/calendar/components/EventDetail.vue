<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
	Bell,
	Briefcase,
	ChevronLeft,
	ChevronRight,
	Copy,
	Globe,
	Lock,
	Mail,
	MapPin,
	MoreHorizontal,
	SquarePen,
	Text,
	User,
	Users,
	X,
} from 'lucide-vue-next'
import {
	Avatar,
	Button,
	Dialog,
	Dropdown,
	TabButtons,
	Tooltip,
	createResource,
	toast,
} from 'frappe-ui'
import { eventColor } from '@/apps/calendar/utils/color'
import DOMPurify from 'dompurify'

import meetLogo from '@/assets/app-logos/meet.png'

import {
	getMeetUrl,
	getReorderedParticipants,
	isUrl,
	participationStatusDisplay,
} from '@/apps/calendar/utils'
import { fromEventZone, inUserTimeZone } from '@/apps/calendar/utils/datetime'
import { eventLastDay, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { getRepeatMessage } from '@/apps/calendar/utils/format'
import { scopeOptions } from '@/apps/calendar/utils/recurringScope'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import { userStore } from '@/apps/calendar/stores/user'
import { useEventDelete } from '@/apps/calendar/composables/useEventDelete'
import EventParticipantList from '@/apps/calendar/components/EventParticipantList.vue'
import RecurringScopeModal from '@/apps/calendar/components/Modals/RecurringScopeModal.vue'
import LinkifiedText from '@/components/LinkifiedText.vue'

const { calendarEvent, variant = 'popover' } = defineProps<{
	calendarEvent: any
	/**
	 * Where the card is hosted. `popover` is the desktop's card, hung on the pill
	 * or row that opened it: its own width, the popover shell's surface and
	 * border, and a height bounded by the room reka reports beside the anchor so
	 * the details scroll inside the card rather than the card running off the
	 * screen. `sheet` is the phone's bottom sheet, which owns the width and the
	 * border but not the scroll: the sheet would scroll the card whole, carrying
	 * the RSVP off the bottom the moment the participants list was expanded.
	 * Bounded here instead — to the sheet's own 90dvh — so the details scroll
	 * inside it and the answer stays where a thumb left it. Floored at half the
	 * screen as well: an event with little to say made a sheet too short to
	 * read as one.
	 */
	variant?: 'popover' | 'sheet'
}>()
const router = useRouter()

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
	makeParams: ({ response, scope }: { response: string; scope: RecurringScope }) => ({
		account: store.accountId,
		// master_id is only set on recurring events; fall back to the event's own id
		id: calendarEvent.master_id || calendarEvent.id,
		response: response.toLowerCase(),
		// One occurrence answered on its own is an override on the series, addressed by this
		// occurrence's recurrence id. The whole series is the same call without one.
		recurrence_id: scope === 'instance' ? calendarEvent.recurrence_id : null,
	}),
	onSuccess: () => emit('reloadEvents'),
})

// A recurring event asks the same question an edit or a delete asks — a standup you miss one
// week is not a standup you have left. Only the series-wide answer reaches the server so far,
// so the other is greyed out rather than absent. The tab buttons stay where they were until
// the server confirms, so cancelling the question leaves the shown answer alone.
const showRsvpScopeModal = ref(false)
const pendingResponse = ref('')

const submitResponse = (response: string, scope: RecurringScope) => {
	showRsvpScopeModal.value = false
	toast.promise(rsvpEvent.submit({ response, scope }), {
		loading: __('Sending response...'),
		success: __('Response sent.'),
		error: __('Action failed. Please try again in some time.'),
	})
}

const handleSetResponse = (response: string) => {
	if (!response || response === userResponse.value) return
	if (!calendarEvent.recurrence_id) return submitResponse(response, 'series')
	pendingResponse.value = response
	showRsvpScopeModal.value = true
}

// An event this account organizes is one whose series it can write an override on; an
// invitation delivered from elsewhere is not, whoever else is on it.
const isOwnEvent = computed(
	() =>
		!calendarEvent.organizer ||
		(participantIdentities.data?.some(
			(id) => id.email === calendarEvent.organizer.replace('mailto:', ''),
		) ??
			false),
)

const rsvpScopeModalProps = computed(() => ({
	title: __('Respond to repeating event'),
	// The answer about to be sent, drawn as the participant list draws it: the dialog is
	// about this yes or this no, not about responding in general.
	icon: participationStatusDisplay(pendingResponse.value).name,
	iconTheme: participationStatusDisplay(pendingResponse.value).theme,
	// No "this and following": ending a series partway is the organizer's act, and an attendee
	// answering an invitation is not editing the event at all.
	//
	// And no "this event only" on an event this account did not call. An invitation can arrive
	// as a set of separate occurrences beside a copy that holds nothing but the answer, and
	// answering one date of one of those is what makes it so: the server finds no series on the
	// copy to hang the status on and gives it to the whole event, which then reads onto every
	// occurrence. The copy only loses its rule at that moment, so nothing about the event before
	// the answer tells the two apart — only whose event it is.
	options: scopeOptions({
		unavailable: isOwnEvent.value ? [] : ['instance'],
	}).filter((option) => option.value !== 'following'),
	confirmLabel: __('Send response'),
	loading: rsvpEvent.loading,
}))

// An occurrence whose series has no readable rule left has nothing to say here,
// and the row goes with the sentence rather than standing empty beside an icon.
const repeatMessage = computed(() =>
	calendarEvent.recurrence_id ? getRepeatMessage(calendarEvent.recurrence_rule) : '',
)

// --- Calendar (colour + account) ---

const eventCalendar = computed(
	() => calendarEvent.calendars?.find((c: any) => c.color) ?? calendarEvent.calendars?.[0],
)

/**
 * The dot beside the account, in the colour the event is drawn in everywhere
 * else.
 *
 * The calendar app hands each calendar a palette colour by position and paints
 * its pills, rows and sidebar dot with it — so the card has to read that, not
 * the colour the server happens to carry, which had the same event green in the
 * list and blue in the card beside it.
 *
 * Mail opens this card on events it never transformed, which have no palette
 * colour of their own; those still fall back to the calendar's own.
 */
const dotColor = computed(() =>
	eventColor((calendarEvent.color as string) || eventCalendar.value?.color),
)

// The organizer beats the viewer's own address (redundant in their own card);
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

/**
 * Which page the sheet is on. The participants have a page of their own,
 * opened from the "N people" row, rather than unfolding under it: a list that
 * grows in place pushes the description and everything after it down, and a
 * reader who tapped to see who is coming had to scroll back up to find the
 * rest of the event. The page takes the sheet over — same sheet, its content
 * swapped, a back control at the top — and Back returns to the event where
 * the reader left it. The sheet is rebuilt on every open, so it always opens
 * on the event.
 */
const sheetPage = ref<'event' | 'participants'>('event')

/** The faces on the sheet's participants row: the first three, organizer first. */
const ROW_AVATAR_COUNT = 3
const rowParticipants = computed(() => orderedParticipants.value.slice(0, ROW_AVATAR_COUNT))

/**
 * The sheet's height as the page turns, held until it turns back. The sheet
 * is sized to its content below the cap, so a list of four names came out
 * shorter than the event and a list of forty came out at the cap: the page
 * turned and the sheet jumped. Held at the event's height, the list scrolls
 * inside what the event took, and the sheet stays where the thumb knows it.
 */
const rootRef = ref<HTMLElement | null>(null)
const heldHeight = ref<number | null>(null)

/**
 * The popover takes focus as a whole, not through its first control. reka's
 * focus scope puts focus on the first tabbable thing in a popover as it opens —
 * the More button here — and a pill's popover opens 200ms after the click, far
 * enough from it that the browser no longer reads the focus as the pointer's and
 * draws the button's keyboard ring. Focus set here, in the card's own mount,
 * lands before the scope looks, and a scope that finds focus already inside
 * leaves it be. The root is made focusable for it and its outline turned off,
 * so nothing is lit; Escape still closes and Tab still reaches the controls.
 */
onMounted(() => {
	if (variant === 'popover') rootRef.value?.focus({ preventScroll: true })
})

/** Which way the page slides — see the Transition in the template. */
const pageSlide = ref<'slide-forward' | 'slide-back'>('slide-forward')

const openParticipants = () => {
	heldHeight.value = rootRef.value?.offsetHeight ?? null
	pageSlide.value = 'slide-forward'
	sheetPage.value = 'participants'
}
const backToEvent = () => {
	pageSlide.value = 'slide-back'
	sheetPage.value = 'event'
}
// The height is let go once the list has slid away, not when Back is tapped:
// released then, the sheet snapped to the event's height under a list still
// on its way out.
const onPageLeft = () => {
	if (sheetPage.value === 'event') heldHeight.value = null
}

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

/**
 * The event as something to paste into a chat: what it is, when it is, and the link
 * to join it.
 *
 * The link alone answers "where do I click" and nothing else — pasted into a thread
 * a day early it is a URL with no claim about when to use it. This is the same copy
 * with what makes it an invitation, in the reader's own zone, spelled as plain lines
 * because everywhere it lands is plain text.
 *
 * The rule is there when the event has one: without it a weekly standup pastes as a
 * single date, which is a claim that it happens once. Room and link both, when both
 * exist — one is where the event is and the other is how to attend it, and an event
 * can want either answered. What is left out is what a reader would not act on: the
 * participants, the description, and who organized it, all of which are a tap away in
 * the event the paste points at.
 */
const copyInvite = async () => {
	const link = meetUrl.value && new URL(meetUrl.value, window.location.origin).href
	const where = calendarEvent.locations
		?.map((location) => location._name)
		.filter(Boolean)
		.join(', ')

	const lines = [
		calendarEvent.title || __('Untitled event'),
		dateLabel.value,
		repeatMessage.value,
		where,
		link,
	]
	await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'))
	toast.success(__('Invite copied.'))
}

const joinMeet = () => {
	if (!meetUrl.value) return
	// Same-origin paths stay in-app; foreign links open in a new tab.
	if (meetUrl.value.startsWith('/')) router.push(meetUrl.value)
	else window.open(meetUrl.value, '_blank', 'noopener')
}

// --- Actions dropdown (delete) ---

const {
	deleteOption,
	isDeleting,
	showScopeModal: showDeleteScopeModal,
	deleteScopeModalProps,
	deleteScope,
	showNotifyModal,
	pendingDelete,
	NOTIFY_DELETE_OPTIONS,
} = useEventDelete(
	() => calendarEvent,
	() => {
		emit('reloadEvents')
		emit('close')
	},
)

const dropdownOptions = computed(() => [
	{ label: __('Edit'), icon: SquarePen, onClick: () => emit('edit') },
	// Beside Edit rather than beside the Meet row's copy: that button copies the link,
	// which is a property of the call, where this copies the event.
	{ label: __('Copy Invite'), icon: Copy, onClick: copyInvite },
	deleteOption.value,
])

const openUrl = (location: string) => {
	if (isUrl(location)) window.open(location, '_blank')
}
</script>

<template>
	<div
		ref="rootRef"
		:tabindex="variant === 'popover' ? -1 : undefined"
		:style="heldHeight ? { height: `${heldHeight}px` } : undefined"
		:class="
			variant === 'sheet'
				? 'relative flex max-h-[90dvh] min-h-[50dvh] w-full flex-col overflow-hidden text-left'
				: 'relative flex max-h-[min(var(--reka-popover-content-available-height),40rem)] w-[352px] flex-col overflow-hidden text-left outline-none'
		"
	>
		<!-- The two pages, one in the flow at a time, the other sliding through:
		     forward, the list comes in from the right as the event goes out to the
		     left; back, the reverse. The leaving page is lifted out of the flow for
		     the slide so the arriving one takes its place at once, and the root
		     clips the pair — see the style block. Only the sheet turns pages; the
		     card stays on the event, and the wrapper is inert there.

		     The sheet's bottom padding, which clears the home indicator, is on
		     each page rather than on the root: a lifted page is sized to the root's
		     edges, padding and all, so with the padding on the root it grew by that
		     much the moment it left the flow, and its pinned footer dropped by the
		     same — under the home indicator, on a phone. -->
		<Transition :name="pageSlide" @after-leave="onPageLeft">
			<!-- flex-1 in the sheet too: the sheet has a floor now, and a page that did
			     not fill it left the RSVP adrift above blank sheet rather than pinned
			     to its bottom edge. -->
			<div
				v-if="sheetPage === 'event'"
				key="event"
				class="flex min-h-0 flex-1 flex-col"
				:class="variant === 'sheet' && 'pb-[calc(env(safe-area-inset-bottom)+0.5rem)]'"
			>
				<!-- Header -->
				<!-- h-12, the height of the app's header bars. The event's name leads it, where
				     a name belongs; the row is a fixed height, so a long one truncates rather
				     than growing it and the tooltip carries the whole of it. -->
				<div class="flex h-12 shrink-0 items-center gap-3 px-4.5">
					<!-- The calendar's colour before the name it belongs to: it is the one mark
					     shared with the pills in the grid, so it answers "which of these is the one
					     I clicked" before the name has to be read.

					     A draft draws it as a ring rather than a disc, the way the agenda's rows
					     do: unsent is a state of the event, and the mark that stands for the event
					     is where a state of it belongs. It said so as a "Draft" badge on the date
					     line under the title, which spent a line of a 49px block on a word the
					     dot can say by being hollow.

					     2px of ring against the rows' 1.5: the dot here is 10px to their 8, and a
					     stroke that does not grow with the circle it is drawn on reads thinner on
					     the larger one. Unbroken, as the rows draw it — at this size a dashed
					     circle reads as a badly drawn one. Boxes are border-box, so the ring is
					     drawn inside the dot's own 10px. -->
					<div class="flex min-w-0 items-center gap-2">
						<span
							class="size-2.5 shrink-0 rounded-full"
							:style="
								calendarEvent.isDraft
									? { border: `2px solid ${dotColor}` }
									: { backgroundColor: dotColor }
							"
						/>
						<Tooltip :text="calendarEvent.title || __('Untitled event')" class="min-w-0">
							<h3 class="text-ink-gray-8 truncate text-md font-semibold">
								{{ calendarEvent.title || __('Untitled event') }}
							</h3>
						</Tooltip>
					</div>
					<!-- ml-auto rather than flex-1 on the title beside it: the title is wrapped in
					     a Tooltip, and the growing is the wrapper's to do or not — pushing from
					     this side puts the actions on the edge whatever it decides. -->
					<div class="ml-auto flex shrink-0 items-center gap-1">
						<Dropdown :options="dropdownOptions">
							<Button
								variant="ghost"
								:disabled="isDeleting"
							>
								<MoreHorizontal class="icon size-3.5 text-ink-gray-7" />
							</Button>
						</Dropdown>
						<!-- A sheet is dismissed by dragging it down or tapping outside, so a
						     close button would be a third way to do what the surface already
						     says it does. -->
						<Button
							v-if="variant !== 'sheet'"
							variant="ghost"
							:tooltip="__('Close')"
							@click="emit('close')"
						>
							<X class="icon size-3.5 text-ink-gray-7" />
						</Button>
					</div>
				</div>

				<!-- When it is and whose calendar it is on — outside the scroll, under the name
				     in the header: what the card is about stays put while what it says about it
				     moves.

				     No negative top margin: it was there to pull a title tight under the header,
				     and the title is in the header now. The block is a fixed 49px — two 15px
				     lines where there used to be a 24px title and a 15px date — and the numbers
				     below are solved against that. -->
				<div class="-mt-0.5 flex shrink-0 flex-col px-4.5 pb-[15px]">
					<!-- The three numbers are solved together, not chosen. text-md is 15px at 1.15,
					     so the title's line box is 17.25 and the header's 48 leaves 15.4 under it —
					     more than the 12 a pb-3 put below the block, which is what left the pair
					     sitting low. Balanced means the bottom padding equals that slack, and the
					     49px the block has to be says the same numbers can only add to 49. Both
					     hold at -2 / 6 / 15: -2 + 14.95 + 6 + 14.95 + 15. 15px is not a step on the
					     scale, and is spelled out rather than rounded to 14 or 16 because it is the
					     one value that matches a slack the header's own height fixes at 15.4. -->
					<div class="min-w-0 space-y-1.5">
						<div class="flex items-center gap-2 text-sm text-ink-gray-6">
							<span class="break-words">{{ dateLabel }}</span>
						</div>
						<!-- How often, under when: "every week on Thursday" is the rest of the
						     sentence the date line starts, not a property of the event to be read
						     among Busy and Public. No icon, for the same reason — the line above it
						     has none, and one here would indent this line 22px past the start of
						     the sentence it continues. The words name themselves. Truncated rather
						     than wrapped: the block is a fixed 49px. -->
						<div v-if="repeatMessage" class="min-w-0 truncate text-sm text-ink-gray-6">
							{{ repeatMessage }}
						</div>
					</div>
				</div>

				<div class="shrink-0 border-t" />

				<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">

					<!-- Details. Every row here is optional but the calendar's: an event is
					     always on one, which is what the block is guaranteed to carry and why it
					     no longer asks whether it has anything to show. -->
					<!-- pt only in the sheet, where the participants row follows as one more
					     row of this block: its bottom padding stacked on the rows' own put
					     that row 24px under the owner where the rest sit 16 apart. The
					     participants section carries the padding to the rule below. -->
					<div class="flex flex-col" :class="variant === 'sheet' ? 'pt-2' : 'py-2'">
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
								<!-- The same button the row below it uses to mail the participants, and
								     the one the header closes with: a ghost Button rather than a bare
								     one, which is what carries the hover fill, the focus ring, a hit
								     area worth aiming at, and a tooltip instead of a title attribute. -->
								<Button
									variant="ghost"
									class="-my-1.5 shrink-0"
									:tooltip="__('Copy Frappe Meet link')"
									@click="copyMeetLink"
								>
									<Copy class="icon text-ink-gray-7 size-4" />
								</Button>
							</div>
							<!-- The subtle Button, as the participants page's email action is, so
							     the two full-width actions the sheet offers are one button: md in the
							     sheet, 32px under a thumb, and sm in the card under a pointer. -->
							<div class="px-4.5 py-2">
								<Button
									variant="subtle"
									:size="variant === 'sheet' ? 'md' : 'sm'"
									class="w-full"
									:label="__('Join')"
									@click="joinMeet"
								/>
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

						<!-- Whose event it is, last: the row that is always here, and the one a
						     reader is least often after — what it is and when comes first. A person,
						     not a calendar: the label is the organizer's address, falling back to
						     the account's own, and only names a calendar when an event carries no
						     organizer at all. The colour it draws in is up beside the name, where
						     matching it against the grid starts. -->
						<div class="flex items-center gap-2.5 px-4.5 py-2">
							<User class="icon text-ink-gray-5 size-4 shrink-0" />
							<span class="text-ink-gray-7 min-w-0 truncate text-sm">{{ calendarOwnerLabel }}</span>
						</div>
					</div>

					<!-- No rule above the participants in the sheet: there the section is one
					     row, and a row ruled off from the rows above it read as a section of
					     its own with nothing in it. The card keeps the rule over its list. -->
					<div v-if="variant !== 'sheet'" class="border-t" />

					<!-- Participants: the section's own y padding matches the header row's
					     py-2, so it reads as evenly spaced. Counting the row's padding
					     towards the top instead left the section 8px/16px — the row's
					     padding belongs to the row, not to the section. -->
					<!-- pb only in the sheet: with no rule above it, the section's top
					     padding would hold its row off the owner row by more than the rows
					     above it are held off each other. -->
					<div class="flex flex-col" :class="variant === 'sheet' ? 'pb-2' : 'py-2'">
						<!-- In the sheet, the row is the whole of it: one line that says how
						     many and how they answered, and opens the list as a page of the
						     sheet — see `sheetPage`. The chevron says there is more behind
						     it; the email action goes with the list. -->
						<button
							v-if="variant === 'sheet'"
							class="active:bg-surface-gray-1 flex items-center gap-2.5 px-4.5 py-2 text-left"
							@click="openParticipants"
						>
							<Users class="icon text-ink-gray-5 size-4 shrink-0" />
							<div class="text-ink-gray-7 min-w-0 flex-1 truncate text-sm">
								{{ participantSummary
								}}<span v-if="responseSummary" class="text-ink-gray-6">
									({{ responseSummary }})</span
								>
							</div>
							<!-- The first few faces, stacked, before the chevron: a count says
							     how many, a face says who, and the row has room for both. The
							     stack the mobile event form draws on its Participants row, to
							     the class: 20px faces, which sit inside the row's line, each
							     ringed in an outline colour rather than the page's — see the
							     note there — and overlapped by 8. -->
							<div class="flex shrink-0 items-center">
								<Avatar
									v-for="p in rowParticipants"
									:key="p.email"
									:image="p.user_image"
									:label="p._name || p.email"
									size="sm"
									class="-ml-2 ring-1 ring-outline-gray-2 first:ml-0"
								/>
							</div>
							<ChevronRight class="icon text-ink-gray-5 size-4 shrink-0" />
						</button>
						<template v-else>
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
							<!-- pt-1, not pt-2: the gap under the "N people" line is measured from its
							     text, while a row's gap is measured from its box — which stands taller
							     than the avatar in it. Equal padding therefore read as 21px under the
							     header against 16px between the faces. -->
							<div class="space-y-2 pb-2 pl-11 pr-4.5 pt-1">
								<EventParticipantList
									:participants="visibleParticipants"
									:dont-show-remove="true"
								/>
								<!-- pt-1 on top of the list's 8px step, for the same reason in reverse:
								     this row is one line of text where the others are two-line boxes, so
								     the shared step leaves it 12px below the last face instead of 16. -->
								<button
									v-if="!showAllParticipants && orderedParticipants.length > VISIBLE_PARTICIPANT_COUNT"
									class="text-ink-gray-6 hover:text-ink-gray-8 flex items-center gap-2.5 pb-0.5 pt-1 text-sm"
									@click="showAllParticipants = true"
								>
									<MoreHorizontal class="icon size-3.5 shrink-0" />
									{{ __('See all participants') }}
								</button>
							</div>
						</template>
					</div>

					<template v-if="calendarEvent.description">
						<div class="border-t" />

						<!-- Description: no label — the icon in the gutter with the body on
						     the text axis says it, like the card's other icon rows. -->
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

				<!-- RSVP. Ruled off the way the title above is: both sit outside the scroll,
				     and a pinned block with nothing between it and moving content reads as
				     the end of that content rather than as a shelf of its own. -->
				<div v-if="userParticipant?.expect_reply" class="shrink-0 border-t" />
				<!-- The page's own bottom padding clears the home indicator, so the block
				     inside it carries none of its own; the column, which ends at the window
				     edge, still does. -->
				<div
					v-if="userParticipant?.expect_reply"
					class="flex shrink-0 flex-col gap-2 px-4.5 pt-3"
					:class="variant === 'sheet' ? 'pb-1' : 'pb-3'"
				>
					<span class="text-ink-gray-6 text-sm">{{ __('Going?') }}</span>
					<!-- md in the sheet, the size its other full-width actions take. -->
					<TabButtons
						class="w-full [&>div>[data-slot=tab-button]]:flex-1 [&>div]:w-full [&_[data-slot=tab-button]>span]:w-full"
						:size="variant === 'sheet' ? 'md' : 'sm'"
						:model-value="userResponse"
						:options="RSVP_OPTIONS"
						@update:model-value="handleSetResponse"
					/>
				</div>

			</div>

		<!-- The participants page: the same sheet with its content swapped. The
		     header keeps the event header's height and gutter, so the swap reads
		     as a page turned rather than a sheet replaced; the back chevron sits
		     where the event's colour dot did. The list steps by 12 rather than
		     the card's 8, since a thumb lands on a row where a pointer lands on
		     a face. -->
			<div
				v-else
				key="participants"
				class="flex min-h-0 flex-1 flex-col pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
			>
				<div class="flex h-12 shrink-0 items-center gap-2 px-3">
					<Button variant="ghost" :tooltip="__('Back')" @click="backToEvent">
						<ChevronLeft class="icon size-3.5 text-ink-gray-7" />
					</Button>
					<h3 class="text-ink-gray-8 min-w-0 truncate text-md font-semibold">
						{{ __('Participants') }}
					</h3>
					<span v-if="responseSummary" class="text-ink-gray-6 truncate text-sm">
						({{ responseSummary }})
					</span>
				</div>
				<!-- The last 16px of the scroll fade out, so a row running under the
				     pinned button dissolves rather than being cut through its face, which
				     read as clipping. A mask on the content rather than a scrim over it:
				     it fades whatever is there, in either theme, and draws nothing when
				     the list stops short of the edge. pb-4, the fade's own height, so the
				     last row scrolls clear of it. -->
				<div
					class="min-h-0 flex-1 overflow-y-auto px-4.5 pb-4 pt-1 [mask-image:linear-gradient(to_bottom,black_calc(100%-16px),transparent)]"
				>
					<div class="space-y-3">
						<EventParticipantList :participants="orderedParticipants" :dont-show-remove="true" />
					</div>
				</div>
				<!-- Outside the scroll, the way the event page pins its RSVP: the one
				     action the list has stays under the thumb however long the list is.
				     No rule over it and none under the header: the other sheets draw
				     neither, and a rule the card needs to mark its pinned blocks reads
				     as a frame in a sheet. The page's own bottom padding clears the home
				     indicator, so the block carries the pb-1 the RSVP does. -->
				<template v-if="participantEmails.length">
					<div class="shrink-0 px-4.5 pb-1 pt-2">
						<Button
							variant="subtle"
							size="md"
							class="w-full"
							@click="emit('emailParticipants', participantEmails)"
						>
							<template #prefix>
								<Mail class="size-4" />
							</template>
							{{ __('Email participants') }}
						</Button>
					</div>
				</template>
			</div>
		</Transition>

		<RecurringScopeModal
			v-model="showDeleteScopeModal"
			v-bind="deleteScopeModalProps"
			@confirm="deleteScope"
		/>
		<RecurringScopeModal
			v-model="showRsvpScopeModal"
			v-bind="rsvpScopeModalProps"
			@confirm="(scope) => submitResponse(pendingResponse, scope)"
		/>
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

<style scoped>
/* The page slide. A push, not a crossfade: both pages move at once, the leaving
   one lifted out of the flow so the arriving one has the sheet from the first
   frame. 200ms is long enough to read as a page turned and short enough not to
   be waited for. */
.slide-forward-enter-active,
.slide-forward-leave-active,
.slide-back-enter-active,
.slide-back-leave-active {
	transition: transform 200ms ease;
}
.slide-forward-leave-active,
.slide-back-leave-active {
	position: absolute;
	inset: 0;
}
.slide-forward-enter-from {
	transform: translateX(100%);
}
.slide-forward-leave-to {
	transform: translateX(-100%);
}
.slide-back-enter-from {
	transform: translateX(-100%);
}
.slide-back-leave-to {
	transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
	.slide-forward-enter-active,
	.slide-forward-leave-active,
	.slide-back-enter-active,
	.slide-back-leave-active {
		transition: none;
	}
}
</style>
