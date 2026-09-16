<template>
	<!-- The rows themselves live with the calendar app, which shows the same
	     list in its own sidebar; this is mail's data and click behaviour on top. -->
	<UpcomingEventsList :events="upcoming" :is-collapsed :is-open @select="handleClick" />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'

import dayjs from '@/apps/calendar/utils/dayjs'
import UpcomingEventsList from '@/apps/calendar/components/UpcomingEvents.vue'
import { eventDayRoute, useUpcomingEvents } from '@/apps/mail/composables/useUpcomingEvents'
import { userStore } from '@/apps/mail/stores/user'
import { useScreenSize } from '@/apps/mail/utils/composables'

const { isCollapsed } = defineProps<{ isCollapsed: boolean }>()

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

// The row whose card is open renders like the active nav tab.
const isOpen = (event: any) =>
	!!selectedEvent.value &&
	selectedEvent.value.id === event.id &&
	selectedEvent.value.recurrence_id === event.recurrence_id

// Desktop toggles the event's card, hung on the row (hosted by DefaultLayout);
// mobile has no room for it, so it falls back to the calendar app's day view.
const handleClick = (event: any, e: MouseEvent) => {
	if (isMobile.value) router.push(eventDayRoute(event, store.accountId))
	else if (isOpen(event)) selectedEvent.value = null
	else if (e.currentTarget instanceof Element)
		openEvent(event, { anchor: { element: e.currentTarget, side: 'right' } })
}

// A row's card goes with its row: an event that ends, or is deleted, leaves the
// list, and a card with nothing to hang on would drift to the corner.
watch(upcoming, (list) => {
	if (selectedEvent.value?._tracked && !list.some(isOpen)) selectedEvent.value = null
})
</script>
