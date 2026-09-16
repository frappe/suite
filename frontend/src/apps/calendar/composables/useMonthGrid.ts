import { computed, toValue } from 'vue'

import dayjs from '@/apps/calendar/utils/dayjs'

import type { MaybeRefOrGetter } from 'vue'

/**
 * The day model behind the MiniMonth card, in the sidebar and in the phone's
 * date picker. What differs between the two is how big a day is drawn; which
 * days there are, and whose calendars have something on each, is one answer.
 */

export interface GridEvent {
	/** Inclusive day span, `YYYY-MM-DD`. */
	fromDate: string
	toDate: string
	color?: string
	isDeclined?: boolean
}

export interface GridDay {
	/** YYYY-MM-DD. */
	key: string
	date: dayjs.Dayjs
	inMonth: boolean
	isToday: boolean
	isSelected: boolean
	/** Palette names of the calendars with something on the day, first seen first. */
	colors: string[]
}

/** Dots under a day: a fourth would run past the circle's edge. */
const MAX_DOTS = 3

/**
 * Whose calendars have something on the day. A draft claims the time, so it
 * counts; a decline gives it back, so it does not.
 */
const dayColors = (events: GridEvent[], key: string) => {
	const colors: string[] = []
	for (const event of events) {
		if (event.isDeclined) continue
		if (event.fromDate > key || event.toDate < key) continue
		const color = event.color || 'green'
		if (!colors.includes(color) && colors.length < MAX_DOTS) colors.push(color)
	}
	return colors
}

/**
 * Six rows of the month `month`/`year`, Sunday first, padded with the
 * neighbouring months — a fixed height, so paging never resizes the grid.
 */
export const monthDays = (
	month: MaybeRefOrGetter<number>,
	year: MaybeRefOrGetter<number>,
	events: MaybeRefOrGetter<GridEvent[]>,
	selectedKey: MaybeRefOrGetter<string> = '',
) =>
	computed<GridDay[]>(() => {
		const viewedMonth = toValue(month)
		const first = dayjs(new Date(toValue(year), viewedMonth, 1))
		const start = first.subtract(first.day(), 'day')
		return buildDays(start, 42, viewedMonth, toValue(events), toValue(selectedKey))
	})

const buildDays = (
	start: dayjs.Dayjs,
	count: number,
	month: number,
	events: GridEvent[],
	selectedKey: string,
): GridDay[] => {
	const today = dayjs().format('YYYY-MM-DD')
	return Array.from({ length: count }, (_, i) => {
		const date = start.add(i, 'day')
		const key = date.format('YYYY-MM-DD')
		return {
			key,
			date,
			inMonth: date.month() === month,
			isToday: key === today,
			isSelected: key === selectedKey,
			colors: dayColors(events, key),
		}
	})
}
