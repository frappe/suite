<template>
	<!-- The phone's answer to the desktop detail column. Same component inside —
	     RSVP, participants, the ⋯ menu — hosted in a sheet rather than a column,
	     so it opens over the agenda instead of taking the width the agenda needs.
	     The sheet caps itself at 90dvh and scrolls, which is what the design's
	     "drag up for the rest" amounts to.

	     What it draws is the last event it was given, not the one it is being
	     given: closing clears the event — that is what closes the sheet — and the
	     sheet then had nothing to draw for the length of its own slide, so it went
	     blank on the way down. Holding the last one keeps the card whole until it
	     is gone, and the next open replaces it. -->
	<BottomSheet :open="!!calendarEvent" @update:open="(open) => !open && emit('close')">
		<EventDetail
			v-if="shown"
			:key="shown.id + (shown.recurrence_id ?? '')"
			:calendar-event="shown"
			variant="sheet"
			@close="emit('close')"
			@edit="emit('edit')"
			@reload-events="emit('reloadEvents')"
			@email-participants="(emails: string[]) => emit('emailParticipants', emails)"
		/>
	</BottomSheet>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { BottomSheet } from 'frappe-ui'

import EventDetail from '@/apps/calendar/components/EventDetail.vue'

const props = defineProps<{ calendarEvent: any | null }>()

/** The event on screen: the last one opened, held through the slide down. */
const shown = ref(props.calendarEvent)

watch(
	() => props.calendarEvent,
	(event) => event && (shown.value = event),
)

const emit = defineEmits<{
	close: []
	edit: []
	reloadEvents: []
	emailParticipants: [emails: string[]]
}>()
</script>
