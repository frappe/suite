<template>
	<!--
		One day of a month grid: its number in a circle, and inside the circle
		under the number a dot per calendar with something on it.

		The same cell in the sidebar's card and on the phone's month, because it is
		the same thing being asked in both — which day, and how busy. Drawn twice it
		drifted: the phone marked today with a filled circle round the numeral and
		kept the calendar colours under it, the card filled the whole cell and had
		to recolour the mark to survive its own dark ground. The circle is the one
		that reads, and one cell is the only way it stays that way.
	-->
	<!-- 28px a row in the sidebar, the numeral's own circle with the dots inside
	     it. Nothing else — a card of six rows spends every pixel six times over,
	     and the sidebar has a list of calendars to fit under it; with the circle
	     as the hit area there is nothing a taller row would add. Under a thumb
	     the circle is 32 and the row 36: a finger wants more circle than a
	     pointer, and the rows breathe a little on a screen that has the height.

	     28, where the numeral alone sat in 22: the circle holds the dots now as
	     well as the number, and at 22 the two touched. A step on the scale,
	     since the number no longer has to fill the disc — the dots under it are
	     what the room is for. -->
	<button
		type="button"
		class="group flex flex-col items-center"
		:class="touch ? 'py-0.5' : 'py-0'"
		:aria-current="day.isSelected ? 'date' : undefined"
		@click="emit('select', day)"
	>
		<!-- Every mark a day can wear is the same mark: a circle the size of the
		     numeral's own line. Today's is filled dark and the numeral reverses out
		     of it; the day the calendar is on wears the same circle in gray; a
		     pointed-at day wears it lighter still.

		     A filled *cell* said the same things at a different shape — a rounded
		     box behind the numeral and its tick — so a marked day and a marked
		     today were two unrelated things happening in one column. It also put
		     the tick on a dark ground, where a calendar's colour cannot be read,
		     which made the mark that says whose into a second mark saying today. -->
		<!-- pb-1 lifts the numeral 2px off centre, which is the room the dots under
		     it take: they sit inside the circle rather than under it, so the mark
		     and what it marks are one thing, and the row is the circle's own
		     height. -->
		<span
			class="relative flex items-center justify-center rounded-full pb-1 text-sm"
			:class="[
				touch ? 'size-8' : 'size-7',
				day.isToday
					? 'bg-surface-gray-10 text-ink-gray-1'
					: day.isSelected
						? 'bg-surface-gray-4 text-ink-gray-8'
						: day.inMonth
							? 'text-ink-gray-8 group-hover:bg-surface-gray-3'
							: 'text-ink-gray-4 group-hover:bg-surface-gray-3',
			]"
		>
			{{ day.date.date() }}
			<!-- A 4px dot per calendar with something on the day, in that calendar's
			     colour, and nothing under a day with nothing on it. It used to be a
			     rule that widened with the day's load: on a month where most days have
			     something, a mark under nearly every one that also varied in width
			     read as noise. The dots say what is worth saying at this size — there
			     is something here, and whose — and leave the numerals to be read. Three
			     at most, 2px apart: a fourth would run past the circle's edge, and a
			     pixel apart they read as one broken line. Days of the
			     neighbouring months stay bare: their number is orientation, not an
			     invitation to read what is on them.

			     Absolute at the circle's foot, so an empty row costs the numeral nothing. -->
			<span class="absolute inset-x-0 bottom-1 flex h-1 items-center justify-center gap-0.5">
				<template v-if="day.inMonth">
					<span
						v-for="color in day.colors"
						:key="color"
						class="size-1 rounded-full"
						:style="{ backgroundColor: eventColor(color) }"
					/>
				</template>
			</span>
		</span>
	</button>
</template>

<script setup lang="ts">
import { eventColor } from '@/apps/calendar/utils/color'

import type { GridDay } from '@/apps/calendar/composables/useMonthGrid'

defineProps<{
	day: GridDay
	/** Under a thumb: the row gets the height a finger needs. */
	touch?: boolean
}>()

const emit = defineEmits<{ select: [day: GridDay] }>()
</script>
