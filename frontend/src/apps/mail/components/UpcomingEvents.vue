<template>
	<!-- Variant B of the Sidebar Events design doc: flat two-line rows at nav
	     rhythm — no card chrome, surface-gray-2 hover like every other row, and
	     the row whose detail panel is open gets the active-nav-item treatment.
	     No horizontal padding: the sidebar body already provides it (p-2), so the
	     label's own px-2 lands on the same 16px inset as the nav group labels.
	     Stays mounted while the sidebar collapses, fading like frappe-ui's own
	     sidebar labels do (they animate w-0/opacity-0; height is our axis). -->
	<div
		v-if="upcoming.length"
		class="flex flex-col transition-all duration-300 ease-in-out"
		:class="isCollapsed ? 'max-h-0 overflow-hidden py-0 opacity-0' : 'max-h-96 py-2 opacity-100'"
	>
		<!-- Mirrors the section labels and unread suffixes of the sidebar's nav groups. -->
		<div class="flex items-center justify-between px-2 py-1.5">
			<span class="truncate text-sm text-ink-gray-5">{{ __('Upcoming events') }}</span>
			<span class="shrink-0 text-sm text-ink-gray-4">{{ upcoming.length }}</span>
		</div>
		<!-- Four rows tall, then scrolls. -mx/px (and -mb/pb at scroll end) keep
		     the clip edge off the active row's shadow, same trick as the sidebar
		     body. -->
		<div class="-mx-1 -mb-1 flex max-h-49 flex-col gap-1 overflow-y-auto px-1 pb-1">
			<button
				v-for="event in upcoming"
				:key="event.id + (event.recurrence_id ?? '')"
				type="button"
				class="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-shadow"
				:class="
					isOpen(event)
						? 'bg-surface-elevation-3 shadow-sm ring-1 ring-outline-gray-2'
						: 'hover:bg-surface-gray-2'
				"
				@click="handleClick(event)"
			>
				<div
					class="w-0.5 shrink-0 self-stretch rounded-full"
					:style="{ backgroundColor: eventColor(event) }"
				/>
				<div class="min-w-0 flex-1">
					<div class="truncate text-xs text-ink-gray-5">{{ formatEventTime(event) }}</div>
					<div class="mt-0.5 truncate text-sm text-ink-gray-8">
						{{ event.title || __('Untitled event') }}
					</div>
				</div>
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'

import dayjs from '@/apps/calendar/utils/dayjs'
import { eventDayRoute, useUpcomingEvents } from '@/apps/mail/composables/useUpcomingEvents'
import { userStore } from '@/apps/mail/stores/user'
import { useScreenSize } from '@/apps/mail/utils/composables'

const { isCollapsed } = defineProps<{ isCollapsed: boolean }>()

// frappe-ui's calendar renders events without a color as green; falling back to
// the same hex keeps the strip consistent with the calendar app.
const DEFAULT_EVENT_COLOR = '#30a66d'

const router = useRouter()
const store = userStore()
const { isMobile } = useScreenSize()
const { events, selectedEvent, openEvent } = useUpcomingEvents()
const now = useNow({ interval: 30_000 })

const upcoming = computed(() => {
	const currentTime = dayjs(now.value)
	return [...(events.data || [])]
		.filter((event: any) => {
			if (event.status === 'Cancelled') return false
			const start = dayjs(event.start)
			const end = start.add(dayjs.duration(event.duration || 'PT0S'))
			return end.isAfter(currentTime)
		})
		.sort((left: any, right: any) => dayjs(left.start).valueOf() - dayjs(right.start).valueOf())
})

// The row whose detail panel is open renders like the active nav tab.
const isOpen = (event: any) =>
	!!selectedEvent.value &&
	selectedEvent.value.id === event.id &&
	selectedEvent.value.recurrence_id === event.recurrence_id

// Events carry the color of the calendars they belong to; the first one paints
// the strip, matching what other clients do for multi-calendar events.
const eventColor = (event: any) =>
	event.calendars?.find((c: any) => c.color)?.color || DEFAULT_EVENT_COLOR

const isAllDayEvent = (event: any) => {
	const start = dayjs(event.start)
	const duration = dayjs.duration(event.duration || 'PT0S')
	return (
		event.show_without_time ||
		(start.hour() === 0 &&
			start.minute() === 0 &&
			start.second() === 0 &&
			duration.asDays() >= 1 &&
			duration.asDays() % 1 === 0)
	)
}

const formatEventTime = (event: any) => {
	if (isAllDayEvent(event)) return __('All day')

	const start = dayjs(event.start)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	const sameMeridiem = start.format('A') === end.format('A')
	return `${start.format(sameMeridiem ? 'h:mm' : 'h:mm A')} – ${end.format('h:mm A')}`
}

// Desktop toggles the event detail sidebar in place (hosted by DefaultLayout);
// mobile has no room for it, so it falls back to the calendar app's day view.
const handleClick = (event: any) => {
	if (isMobile.value) router.push(eventDayRoute(event, store.accountId))
	else if (isOpen(event)) selectedEvent.value = null
	else openEvent(event)
}

</script>
