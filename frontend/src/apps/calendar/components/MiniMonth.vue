<template>
	<!-- The month at a glance, on the sidebar's own type scale: nothing louder
	     than the month's own name, which heads it. A day with something on it
	     wears a dot per calendar, today is circled, and clicking a day takes the calendar there. Paging
	     here only turns this card: the calendar itself moves when a day is
	     picked, and the card follows the calendar whenever that changes month.

	     The days are MonthDayCell, the same cell the phone's month draws, so the
	     two cannot drift apart in how they mark today or how they show a day's
	     load. `relative` on each, so the buttons keep painting over the week
	     band behind their row.

	     No card around it: a bordered white panel on the sidebar's own ground
	     read as something laid on the sidebar rather than part of it, and the
	     rail holds nothing else that is boxed. What is left is the padding, so
	     the grid keeps its distance from the rail's edges and its left edge
	     lands on the section labels under it. -->
	<!-- On a phone the card is the sheet's width, and its side padding is where
	     the dates are held off the edge. Not a fixed-width grid centred in the
	     sheet: that put the dates wherever the centring left them, and no padding
	     could move them — every pixel added was a pixel taken from the slack.
	     Fluid columns and a wider gutter set the edge directly and the spread
	     follows from what is left. In the sidebar the rail sets the width. -->
	<div class="py-2" :class="touch ? 'px-4' : 'px-2'">
		<!-- On a phone the columns are wider than what is in them, so a title on
		     the grid's edge sat left of the first column's letter and the arrows
		     right of the last. Inset to what is drawn: on the left half a column
		     less half a two-digit date (8px, at this size), so the title starts
		     where the widest numeral in the column does; on the right half a
		     column less half the 40px arrow, so the chevron sits on the last
		     column's axis. A column is
		     a seventh of the width less the six 2px gaps. In the sidebar a column
		     is barely wider than its circle and the edges already agree. -->
		<div
			class="flex items-center gap-1.5"
			:class="touch ? 'mb-3 pl-[calc((100%-0.75rem)/14-0.5rem)] pr-[calc((100%-0.75rem)/14-1.25rem)]' : 'mb-1'"
		>
			<!-- The month is the card's heading and reads as one: a step up the
			     scale, with the year left where it is. Level with the weekday letters
			     and the dates it named nothing — a card whose loudest thing was the
			     circle round today. -->
			<span class="text-base font-medium leading-5 text-ink-gray-9">{{ monthName }}</span>
			<span class="text-sm leading-5 text-ink-gray-4">{{ viewed.year }}</span>
			<span class="flex-1" />
			<!-- On a phone the arrows are 40px circles, as every icon button there
			     is — a thumb needs the target even where the row does not need the
			     height, so `-my-2` gives the row back the 8px either side and leaves
			     the hit area where it was. -->
			<Button
				variant="ghost"
				size="sm"
				icon="lucide-chevron-left"
				:class="touch && '-my-2 !size-10 !rounded-full'"
				@click="page(-1)"
			/>
			<Button
				variant="ghost"
				size="sm"
				icon="lucide-chevron-right"
				:class="touch && '-my-2 !size-10 !rounded-full'"
				@click="page(1)"
			/>
		</div>
		<div class="grid grid-cols-7 gap-0.5">
			<span
				v-for="letter in weekdays"
				:key="letter"
				class="pb-1 pt-1 text-center text-xs text-ink-gray-4"
			>
				{{ letter }}
			</span>
			<MonthDayCell
				v-for="day in days"
				:key="day.key"
				:day="day"
				:touch
				@select="(picked) => emit('select', picked.date.toDate())"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { Button } from 'frappe-ui'

import MonthDayCell from '@/apps/calendar/components/MonthDayCell.vue'
import { monthDays } from '@/apps/calendar/composables/useMonthGrid'
import { useEventDensity } from '@/apps/calendar/composables/useEventDensity'

const dayjs = inject('$dayjs')

const props = defineProps<{
	/** The month the calendar shows; the card starts here and resyncs when it changes. */
	month: number
	year: number
	/**
	 * Palette colour per calendar id, for the ticks. The events themselves are the
	 * card's own — see useEventDensity — since it is paged independently of the
	 * calendar and has to know about months the main view never fetched.
	 */
	calendarColor: (calendar: string) => string
	/** The day the calendar is on, marked whatever the view. */
	selected?: Date
	/** Drawn for a thumb rather than a pointer: the phone's picker sheet. */
	touch?: boolean
}>()

const emit = defineEmits<{ select: [date: Date] }>()

// The month on the card, which the arrows turn without touching the calendar.
const viewed = ref({ month: props.month, year: props.year })

watch(
	() => [props.month, props.year],
	([month, year]) => (viewed.value = { month, year }),
)

const page = (months: number) => {
	const date = new Date(viewed.value.year, viewed.value.month + months, 1)
	viewed.value = { month: date.getMonth(), year: date.getFullYear() }
}

const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const monthName = computed(() => dayjs().month(viewed.value.month).format('MMMM'))

const selectedKey = computed(() =>
	props.selected ? dayjs(props.selected).format('YYYY-MM-DD') : '',
)

// The card, the phone's month and the phone's week strip are the same six rows
// of days with the same density on them — only the size they are drawn at
// differs. The day the calendar is on is marked in every view: it is the day
// the view is anchored on, the one paging moves and a tap here replaces, and a
// card that showed it in some views and not others left the reader to work out
// which kind of view they were in before reading the card.
const { events } = useEventDensity(
	() => viewed.value.month,
	() => viewed.value.year,
	(calendar) => props.calendarColor(calendar),
)

const days = monthDays(
	() => viewed.value.month,
	() => viewed.value.year,
	() => events.value,
	() => selectedKey.value,
)
</script>
