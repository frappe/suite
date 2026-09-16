<template>
	<!-- The calendar at phone width: the same four views the desktop has — a day,
	     a week, the month, and an agenda, which is home — each of them the
	     library's own, told to draw no header and one mode. They are one set of
	     events read at four ranges.

	     The week was the last of them to arrive. Seven columns at 390px leave a
	     pill some 40px wide, which is nothing to write a title in until the pills
	     give up what the grid around them already says — their time, which is
	     where they are drawn, and their colour bar, which is their fill. -->
	<div class="flex min-h-0 flex-1 flex-col">
		<!-- A flat h-14 title row on mail's geometry — hamburger, then the period,
		     then actions — so on a phone the two apps share one top edge. The
		     hamburger opens the view switcher, where mail's opens its folders:
		     which list you are looking at is the same question in both.

		     The rule under it is the bar's own, drawn where the bar meets content:
		     the day and the agenda, whose views draw none at their top (`noBorder`
		     sees to that). The week and the month open with a row of weekday
		     names, which is the bar's second line — a title, then its dates, then
		     one rule under both, which the grid already draws along its top. A
		     rule between the title and the dates as well put the dates between
		     two lines, and they read as a band of their own. -->
		<div
			class="flex h-14 items-center gap-1 border-outline-gray-1 px-1"
			:class="{ 'border-b': !isMonth && !isWeek }"
		>
			<button
				:aria-label="__('Switch view')"
				class="text-ink-gray-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
				@click="openViewSheet"
			>
				<!-- 20px at the 1.5 the app draws its icons at, as mail's is: the
				     title's own size, so glyph and word stand the same height. -->
				<Menu class="size-5" />
			</button>
			<!-- The title is also the way to a date: the month card is a tap on it
			     away, which is the one navigation the arrows beside it cannot do — they
			     step, and a month away is twelve steps. The chevron is what says so. -->
			<button
				type="button"
				:aria-label="__('Pick a date')"
				class="flex min-w-0 flex-1 items-center gap-1 text-xl font-medium text-ink-gray-9"
				@click="isPickerOpen = true"
			>
				<span class="min-w-0 truncate">
					<!-- A month names itself and a week names its days — "Sep 7 – 13" —
					     both with the year behind them in lighter ink, which is the part
					     of a date a reader checks rather than reads. -->
					<template v-if="isMonth || isWeek">
						{{ title.label }}
						<span class="text-ink-gray-4 font-normal">{{ title.year }}</span>
					</template>
					<!-- A day names itself, weekday first: it is the one view whose title a
					     reader checks against the day they meant to open. -->
					<template v-else-if="isDay">{{ dayTitle }}</template>
					<!-- The agenda names the span it is showing, which is the library's own
					     label for it — "Sep - Nov 2026". -->
					<template v-else>{{ agendaTitle }}</template>
				</span>
				<ChevronDown class="size-4 shrink-0 text-ink-gray-5" />
			</button>
			<!-- The view's own navigation, on the row that names what it is showing: a
			     step back, a step on, and the way home — by whatever the view is showing,
			     a month or a week or a day. Today is not hidden when the anchor is
			     already today: a list scrolls, so "on today" and "looking at today" are
			     different things, and it is the second one this answers. -->
			<!-- 40px targets, round, the size the hamburger opposite them is: a 28px
			     icon button sat its glyph 10px from the screen's edge against the
			     hamburger's 15px on the other side, and read as pushed against it. The
			     same size on both ends puts the two glyphs the same distance in, and
			     gives the arrows a target a thumb can hit. -->
			<div class="flex shrink-0 items-center">
				<Button
					variant="ghost"
					class="!size-10 !rounded-full"
					:aria-label="__('Previous')"
					@click="step(-1)"
				>
					<ChevronLeft class="size-4 text-ink-gray-7" />
				</Button>
				<Button
					variant="ghost"
					class="!h-10 !rounded-full"
					:label="__('Today')"
					@click="goToToday"
				/>
				<Button
					variant="ghost"
					class="!size-10 !rounded-full"
					:aria-label="__('Next')"
					@click="step(1)"
				>
					<ChevronRight class="size-4 text-ink-gray-7" />
				</Button>
			</div>
		</div>


		<!-- All four views are the library's own, the ones the desktop reads: the
		     list of days under the week they fall in, the single column with its hours
		     down the side, the seven of those columns the week draws narrow, and the
		     month grid.

		     The phone brings its own header, so the Calendar's header slot is filled
		     with nothing and every mode but the one wanted is turned off. Its date is
		     this view's, pushed in whenever the header moves.

		     The month used to be a grid of this app's own with the selected day's list
		     under it: a second month view to keep in step with the one the desktop
		     draws, which had already started to drift.

		     Keyed on the view: the mode a Calendar opens in is the one it is built with,
		     so switching between them is a new Calendar rather than a message to the old
		     one. -->
		<Calendar
			:key="view"
			ref="agenda"
			class="min-h-0 flex-1"
			:events="events"
			:config="config"
			:loading="loading"
			:on-click="({ calendarEvent }) => emit('selectEvent', calendarEvent, calendarEvent.fromDate)"
			:on-cell-click="(slot) => emit('selectSlot', slot)"
		>
			<!-- The header this list would draw for itself — a month picker, a switcher
			     between four views — is the row above and the tab bar's sheet. Passing the
			     slot empty is how that is said. -->
			<template #header />
			<!-- The agenda's rows say what the desktop's do, from the same helper:
			     the line under the title. Who is coming is the count the calendar
			     prints itself at the row's far end, from the event's `participant`. -->
			<template #event-description="{ calendarEvent, date }">
				{{ eventRowDescription(calendarEvent, calendarDaySpan(calendarEvent, date)) }}
			</template>
		</Calendar>
		<!-- The date picker: the sidebar's own month card, in a sheet. A picker is
		     the same object on either device — a month, two arrows and a day to tap —
		     and a header of this view's own meant two copies of the paging and the
		     title, free to drift apart. `touch` is the one thing the two do
		     differently.

		     Its density is its own fetch, so a month paged past the window this view
		     has loaded still says which of its days are busy. -->
		<BottomSheet v-model:open="isPickerOpen">
			<div class="px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
				<!-- The circle marks the day the view is anchored on, whatever the view:
				     the day itself, the day the week is drawn around, the day the month
				     or the agenda was opened on and paging moves. -->
				<MiniMonth
					:month="pickerMonth.month"
					:year="pickerMonth.year"
					:calendar-color="calendarColor"
					:selected="dayjs(selected).toDate()"
					touch
					@select="(date) => pickDate(dayjs(date).format('YYYY-MM-DD'))"
				/>
			</div>
		</BottomSheet>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { BottomSheet, Button } from 'frappe-ui'
import { Calendar, calendarDaySpan } from 'frappe-ui/experimental'
import { ChevronDown, ChevronLeft, ChevronRight, Menu } from 'lucide-vue-next'

import dayjs from '@/apps/calendar/utils/dayjs'
import { useViewSheet } from '@/apps/calendar/composables/useViewSheet'
import { modeForView, viewForMode } from '@/apps/calendar/utils/mobileView'
import { weekSpanLabel } from '@/apps/calendar/utils/format'
import { eventRowDescription } from '@/apps/calendar/utils/eventMeta'
import MiniMonth from '@/apps/calendar/components/MiniMonth.vue'

import type { MobileView } from '@/apps/calendar/utils/mobileView'

const props = defineProps<{
	events: any[]
	/** The day both views are on, `YYYY-MM-DD`. */
	selected: string
	view: MobileView
	now: Date
	/** Whether the events for the visible range are still on their way. */
	loading?: boolean
	/** Palette colour per calendar id, for the picker's density ticks. */
	calendarColor: (calendar: string) => string
}>()

const emit = defineEmits<{
	selectDate: [date: string]
	selectEvent: [event: any, date: string]
	/** An empty slot in the day grid: the hour tapped, or its all-day row. */
	selectSlot: [slot: { date: Date | string; time: string; isFullDay: boolean }]
	/** The library moved to another of its views, and the route should follow. */
	selectView: [view: MobileView]
}>()

// The sheet itself is mounted by the tab bar, which is also allowed to open it.
const { openViewSheet } = useViewSheet()

const isMonth = computed(() => props.view === 'month')
const isWeek = computed(() => props.view === 'week')
const isDay = computed(() => props.view === 'day')

/**
 * The date picker, and the month it is showing — its own, so paging through it
 * moves nothing until a date is picked. It opens on the month of the day the
 * view is on, however far the picker was last paged.
 */
const isPickerOpen = ref(false)
const pickerMonth = ref({ month: 0, year: 0 })

watch(isPickerOpen, (open) => open && (pickerMonth.value = viewedMonth.value))

const pickDate = (date: string) => {
	isPickerOpen.value = false
	emit('selectDate', date)
}

/**
 * One mode, and nothing the phone already draws.
 *
 * The other modes go because the view switcher is the tab bar's sheet, the shortcuts
 * go because there is no keyboard, and editing goes because a tap is how the phone
 * scrolls and opens rather than how it creates — the + button is where creating
 * lives, a tapped event opens the same sheet the agenda opens, and a tapped hour
 * opens the same event screen the + button does — `onCellClick` takes the tap
 * before the library's own modal can have it, which is what leaves editing off
 * while the day grid still creates. noBorder leaves the view its top rule and no
 * box: it is the page here, not a pane on one.
 */
const config = computed(() => {
	const mode = modeForView(props.view)
	return {
		defaultMode: mode,
		disableModes: (['Agenda', 'Day', 'Week', 'Month'] as const).filter(
			(other) => other !== mode,
		),
		enableShortcuts: false,
		isEditMode: false,
		noBorder: true,
	}
})

// Whichever of the library's views is mounted.
const agenda = useTemplateRef<{
	setCalendarDate: (date: string) => void
	currentMonthYear: string
	activeView: 'Day' | 'Week' | 'Month' | 'Agenda'
	decrement: () => void
	increment: () => void
}>('agenda')

/**
 * The library switching views on its own account, which is this shell's business:
 * on a phone the view is the route, and the route is what the tab bar, the title
 * and the fetch window read.
 *
 * It happens where a view offers a way into another — the month's "+n more" and
 * its date numbers open the day, and so does a tap on the week's own date heads.
 * Left alone, the Calendar drew a day while everything round it still said month.
 */
watch(
	() => agenda.value?.activeView,
	(mode) => {
		const view = mode && viewForMode(mode)
		if (view && view !== props.view) emit('selectView', view)
	},
)

// The library's own name for the span it is listing. Empty for the first tick, before
// the list has mounted to be asked — the month's own title stands in until then.
// Today twice over: the anchor, so the strip-less month title follows, and the list
// itself, which is scrolled and would otherwise stay where it was left when the anchor
// it is already on is set again.
const goToToday = () => {
	emit('selectDate', todayKey.value)
	agenda.value?.setCalendarDate(todayKey.value)
}

const agendaTitle = computed(() => agenda.value?.currentMonthYear || title.value.label)

/** "Wednesday, 9 Sep" — the day this view is one of. */
const dayTitle = computed(() => dayjs(props.selected).format('dddd, D MMM'))

/**
 * A step back or on, by whatever the view is showing: a month, a week, a day —
 * and a month for the list, which is anchored on one and shows three.
 *
 * All four step by moving the date this view is on, not by asking the Calendar
 * to increment itself — the date is what the route, the title and the fetch
 * window all read, and a Calendar that walked off on its own left the three of
 * them behind: the list paged past the window fetched for the day it opened on
 * and drew its months empty.
 */
const step = (delta: number) => {
	const unit = isWeek.value ? 'week' : isDay.value ? 'day' : 'month'
	emit('selectDate', dayjs(props.selected).add(delta, unit).format('YYYY-MM-DD'))
}

// This view owns the date; the library's follows it. Immediate, because a Calendar
// mounts on its own today and this view may already be somewhere else — a reload
// lands on the day in the URL, not on this morning. The view is watched alongside
// the date for the same reason: switching between the list and the day mounts a
// second Calendar, on today again, with a date beside it that has not changed and
// so would not be pushed.
watch(
	[() => props.selected, () => props.view],
	([date]) => agenda.value?.setCalendarDate(date),
	{ immediate: true, flush: 'post' },
)

const todayKey = computed(() => dayjs(props.now).format('YYYY-MM-DD'))

const viewedMonth = computed(() => {
	const day = dayjs(props.selected)
	return { month: day.month(), year: day.year() }
})

/**
 * The period named, and its year, which the header sets in lighter ink.
 *
 * The week names its days rather than the month it is mostly in — the desktop's
 * header does the same, from the same helper, so a week is read the same way on
 * either device. It is worked out from the day the view is on rather than asked
 * of the library: the date is what this shell owns, and the library's week is
 * the one that date falls in.
 */
const title = computed(() => {
	const day = dayjs(props.selected)
	if (isWeek.value)
		return weekSpanLabel(day.startOf('week').toDate(), day.endOf('week').toDate())
	return { label: day.format('MMMM'), year: day.format('YYYY') }
})

</script>
