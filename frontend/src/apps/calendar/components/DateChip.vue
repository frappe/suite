<template>
	<!-- Month over day in a bordered box: the date as a glyph, readable at a glance down a list.
	     Uncoloured, the band takes the sender avatar's fallback ground, so the two filled shapes
	     flanking a message read as one family.

	     The month is ink-gray-7 rather than the avatar's own ink-gray-5: that pair came to 3.4:1
	     in dark mode on text this small, where gray-7 on the same ground is 6.6:1. On a tinted
	     band it holds ~6:1 in both themes, the day above 9:1, because the tint is mixed into
	     `surface-base` and so is dark where the page is. -->
	<div
		class="border-outline-gray-2 bg-surface-base shrink-0 overflow-hidden rounded-4 border text-center"
		:class="small ? 'w-9' : 'w-10'"
	>
		<!-- Both rows are sized by leading rather than by padding around the text's own line box:
		     16 + 20, a hairline of breathing room each, and the borders lands the chip at ~43px
		     against 40px of width — near enough square, and close to the two-line title/subtitle
		     block it stands beside rather than overhanging it at both ends. `small` is the same
		     shape a step down, 16 + 16 against 36. -->
		<div
			class="border-outline-gray-1 border-b py-px uppercase leading-4"
			:class="[
				small ? 'text-[10px]' : 'text-[11px]',
				'text-ink-gray-7',
				color ? '' : 'bg-surface-gray-2',
			]"
			:style="band"
		>
			{{ month }}
		</div>
		<div
			class="text-ink-gray-8 py-px tabular-nums"
			:class="small ? 'text-sm-semibold leading-4' : 'text-md-semibold leading-5'"
		>
			{{ day }}
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * A calendar date as a chip. Callers pass the already-formatted parts rather than an event, so
 * the chip never has to know how a start is read into a zone — that stays with the caller, which
 * is the only place that knows whether the event is all-day (see `@/apps/calendar/utils/eventTime`).
 *
 * `color` tints the month band in the calendar the event is on, for a list holding events from
 * several. Left out — as mail's invite strip leaves it, where there is one event and no list to
 * tell apart — the band keeps the avatar's gray.
 */
const props = defineProps<{
	month: string
	day: string
	color?: string
	/**
	 * A step down, for a chip standing beside two tight lines rather than the invite strip's
	 * three: ~38px against ~43px, and 36 wide, which is still the width `JUL '25` needs.
	 */
	small?: boolean
}>()

/**
 * The band is a wash of the calendar's colour rather than the colour itself: the month sits on
 * it at 10–11px, and the same ink the calendar draws the event in has to stay legible on top.
 * The mix is against `surface-base`, so the tint follows the theme without knowing there is one
 * — the way the library derives a pill's fill from a calendar's own colour.
 *
 * The month stays gray on it. Colouring the letters as well made each chip read as its own
 * little badge, where the fill alone says which calendar and leaves the date to be read as a
 * date — and one ink down a column of chips is what lets them be scanned rather than sorted.
 * A step under the day's `ink-gray-8` rather than two: on a tinted ground the lighter gray the
 * band carried while it was `surface-gray-2` washed out.
 */
const band = computed(() =>
	props.color
		? { backgroundColor: `color-mix(in srgb, ${props.color} 20%, var(--surface-base))` }
		: undefined,
)
</script>
