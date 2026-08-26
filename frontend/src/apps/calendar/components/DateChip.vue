<template>
	<!-- Month over day in a bordered box: the date as a glyph, readable at a glance down a list.
	     The month band takes the sender avatar's fallback pair (surface-gray-2 / ink-gray-5), so
	     the two filled shapes flanking a message read as one family. Caveat: that lands at 3.6:1
	     in dark mode, and this text is 11px. -->
	<div
		class="border-outline-gray-2 bg-surface-base w-10 shrink-0 overflow-hidden rounded-4 border text-center"
	>
		<!-- Both rows are sized by leading rather than by padding around the text's own line box:
		     16 + 20, a hairline of breathing room each, and the borders lands the chip at ~43px
		     against 40px of width — near enough square, and close to the two-line title/subtitle
		     block it stands beside rather than overhanging it at both ends. -->
		<div
			class="border-outline-gray-1 bg-surface-gray-2 text-ink-gray-5 border-b py-px text-[11px] uppercase leading-4"
		>
			{{ month }}
		</div>
		<div class="text-ink-gray-8 text-md-semibold py-px leading-5 tabular-nums">{{ day }}</div>
	</div>
</template>

<script setup lang="ts">
/**
 * A calendar date as a chip. Callers pass the already-formatted parts rather than an event, so
 * the chip never has to know how a start is read into a zone — that stays with the caller, which
 * is the only place that knows whether the event is all-day (see `@/apps/calendar/utils/eventTime`).
 */
defineProps<{ month: string; day: string }>()
</script>
