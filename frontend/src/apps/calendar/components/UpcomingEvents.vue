<template>
	<!-- Variant B of the Sidebar Events design doc: flat two-line rows at nav
	     rhythm — no card chrome, surface-gray-2 hover like every other row, and
	     the row whose detail card is open gets the active-nav-item treatment.
	     No horizontal padding: the sidebar body already provides it (p-2), so the
	     label's own px-2 lands on the same 16px inset as the nav group labels.
	     Stays mounted while the sidebar collapses, fading like frappe-ui's own
	     sidebar labels do (they animate w-0/opacity-0; height is our axis).

	     The list is presentation only — mail and calendar each hand it the
	     events they already hold and decide what a click means. -->
	<div
		v-if="events.length"
		class="flex flex-col transition-all duration-300 ease-in-out"
		:class="isCollapsed ? 'max-h-0 overflow-hidden py-0 opacity-0' : 'max-h-96 py-2 opacity-100'"
	>
		<!-- Mirrors the section labels and unread suffixes of the sidebar's nav groups.
		     leading-4 on every truncating line: the preset's 1.15 line-height is
		     shorter than Inter's glyph box, so truncate's overflow-hidden shaves
		     the descenders. 16px is what frappe-ui pins its own section label to. -->
		<div class="flex items-center justify-between px-2 py-1.5">
			<span class="truncate text-sm leading-4 text-ink-gray-5">{{ __('Upcoming events') }}</span>
			<!-- The list shows three rows before scrolling, so a count only says
			     something new once there are events hidden below the fold. -->
			<span v-if="events.length > 3" class="shrink-0 text-sm text-ink-gray-4">
				{{ events.length }}
			</span>
		</div>
		<!-- Four rows tall, then scrolls. -m/p on all four sides keeps the clip
		     edge off the active row's ring and shadow, same trick as the sidebar
		     body — the top included: without it the first row's ring is cut along
		     its top edge, which reads as a box missing a side. -->
		<div class="-m-1 flex max-h-49 flex-col gap-1 overflow-y-auto p-1">
			<button
				v-for="event in events"
				:key="event.id + (event.recurrence_id ?? '')"
				type="button"
				class="flex w-full items-center gap-2.5 rounded-4 px-2 py-1.5 text-left transition-shadow"
				:class="
					isOpen(event)
						? 'bg-surface-elevation-3 shadow-sm ring-1 ring-outline-gray-2'
						: 'hover:bg-surface-gray-2'
				"
				@click="emit('select', event, $event)"
			>
				<div
					class="w-0.5 shrink-0 self-stretch rounded-full"
					:style="{ backgroundColor: eventColor(event) }"
				/>
				<div class="min-w-0 flex-1">
					<div class="truncate text-xs leading-4 text-ink-gray-5">{{ formatEventTime(event) }}</div>
					<div class="mt-0.5 truncate text-sm leading-4 text-ink-gray-8">
						{{ event.title || __('Untitled event') }}
					</div>
				</div>
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import dayjs from '@/apps/calendar/utils/dayjs'
import { isAllDayEvent } from '@/apps/calendar/utils/eventTime'

// frappe-ui's calendar renders events without a color as green; falling back to
// the same hex keeps the strip consistent with the calendar app.
const DEFAULT_EVENT_COLOR = '#30a66d'

const {
	events,
	isCollapsed,
	isOpen = () => false,
	// Events carry the color of the calendars they belong to; the first one paints
	// the strip, matching what other clients do for multi-calendar events.
	eventColor = (event: any) =>
		event.calendars?.find((c: any) => c.color)?.color || DEFAULT_EVENT_COLOR,
} = defineProps<{
	/** Already filtered to what is still to come, earliest first. */
	events: any[]
	isCollapsed: boolean
	/** Whether the event's detail card is open — that row reads as the active nav item. */
	isOpen?: (event: any) => boolean
	/** The colour of the strip beside a row, as CSS. */
	eventColor?: (event: any) => string
}>()

/** The click goes with the event: the host hangs the event's card on the row. */
const emit = defineEmits<{ select: [event: any, e: MouseEvent] }>()

const formatEventTime = (event: any) => {
	if (isAllDayEvent(event)) return __('All day')

	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	const sameMeridiem = start.format('A') === end.format('A')
	return `${start.format(sameMeridiem ? 'h:mm' : 'h:mm A')} – ${end.format('h:mm A')}`
}
</script>
