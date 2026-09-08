import dayjs from '@/apps/calendar/utils/dayjs'

/**
 * Turning an event's timing into the sentence a reader wants. The one rule behind every
 * branch below: drop what the reader can infer. No year unless it isn't this one, no times on
 * an all-day event, no repeated month or meridiem inside a range, weekday always — it's the
 * cheapest orientation there is.
 *
 * Kept apart from `@/apps/calendar/utils/datetime` (which resolves zones through the calendar
 * user store) so any app can format an event without pulling that store in. Callers hand in a
 * start already read into the zone they want; this module only turns it into words.
 */

type Dayjs = ReturnType<typeof dayjs>

/**
 * The timing fields every formatted calendar event carries (the backend's
 * `format_calendar_event`): a JSCalendar wall clock, an ISO-8601 duration, and the all-day flag.
 */
interface EventTiming {
	start: string
	duration?: string | null
	show_without_time?: boolean | 0 | 1
}

/**
 * All-day-ness is a property of the event, not of the reader, so this reads the event's own wall
 * clock — never a zone-converted copy, which would slide the midnight test into the previous or
 * next day. The flag is authoritative when set; the midnight-to-midnight fallback catches the
 * invites that arrive as a whole-day span without one (an ICS `DTSTART;VALUE=DATE` is exactly
 * that: midnight to midnight, with the end an *exclusive* boundary on the following day).
 */
export const isAllDayEvent = (event: EventTiming): boolean => {
	const start = dayjs(event.start)
	const duration = dayjs.duration(event.duration || 'PT0S')
	return Boolean(
		event.show_without_time ||
			(start.hour() === 0 &&
				start.minute() === 0 &&
				start.second() === 0 &&
				duration.asDays() >= 1 &&
				duration.asDays() % 1 === 0),
	)
}

/** The moment an event stops, from its start and ISO-8601 duration. */
const eventEnd = (start: Dayjs, duration?: string | null): Dayjs =>
	start.add(dayjs.duration(duration || 'PT0S'))

/**
 * The last calendar day an all-day event touches: the day its final instant falls on. The
 * stored end is the midnight *after* the last day, so stepping back a moment lands on it;
 * and an end that is not on midnight (a `show_without_time` event of some odd shape) still
 * names the day it actually reaches into, where rounding the duration would drop it.
 */
const allDayLast = (start: Dayjs, duration?: string | null): Dayjs => {
	const end = eventEnd(start, duration)
	if (!end.isAfter(start)) return start.startOf('day')
	return end.subtract(1, 'millisecond').startOf('day')
}

/** Whole days an all-day event covers, first to last inclusive. */
const allDayCount = (start: Dayjs, duration?: string | null): number =>
	allDayLast(start, duration).diff(start.startOf('day'), 'day') + 1

/**
 * Under this, an event that passes midnight is one sitting rather than a span — an evening that
 * runs late, not a second day. A day is the natural line: anything shorter fits in one go.
 */
const OVERNIGHT_LIMIT_HOURS = 24

/** Whether a timed event runs past midnight without being long enough to count as a span. */
const isOvernight = (start: Dayjs, end: Dayjs) =>
	!end.isSame(start, 'day') && end.diff(start, 'hour', true) < OVERNIGHT_LIMIT_HOURS

/**
 * The inclusive last day an event covers, or `null` when it reads as living on a single one —
 * which is also the question of whether the strip draws one date chip or two.
 *
 * All-day spans store an *exclusive* end — the midnight after the last day — so this walks that
 * back; printing it raw is what told readers a 17–19 August event ran into the 20th. An
 * overnight gets `null`: two calendar days, but a chip for the second would sell one evening as
 * a two-day event, so the label names that day inline instead.
 */
export const eventLastDay = (
	start: Dayjs,
	duration?: string | null,
	allDay = false,
): Dayjs | null => {
	if (allDay) {
		const last = allDayLast(start, duration)
		return last.isSame(start, 'day') ? null : last
	}
	const end = eventEnd(start, duration)
	if (end.isSame(start, 'day') || isOvernight(start, end)) return null
	return end
}

/** Years are worth printing only when they aren't the one the reader is living in. */
const yearFormat = (day: Dayjs, now: Dayjs) => (day.year() === now.year() ? '' : ' YYYY')

/**
 * A single day: `Today`, `Sun, 17 Aug`, or `Sat, 9 Jan 2027`. `compact` is for callers that
 * already print the month and day beside the label (the invite strip's date chip does), leaving
 * only the weekday to say — but a year no chip carries still spells itself out. Spans never
 * compact: `dayRangeLabel` pairs each weekday with its date, which is the whole point of it.
 */
const dayLabel = (day: Dayjs, now: Dayjs, compact = false) => {
	if (day.isSame(now, 'day')) return __('Today')
	if (day.year() !== now.year()) return day.format(`ddd, D MMM${yearFormat(day, now)}`)
	return day.format(compact ? 'dddd' : 'ddd, D MMM')
}

/** A span of days: `Mon, 17 – Wed, 19 Aug`, dropping the month from the first end when shared. */
const dayRangeLabel = (first: Dayjs, last: Dayjs, now: Dayjs) => {
	const sharesMonth = first.isSame(last, 'month')
	const from = first.format(sharesMonth ? 'ddd, D' : `ddd, D MMM${yearFormat(first, now)}`)
	return `${from} – ${last.format(`ddd, D MMM${yearFormat(last, now)}`)}`
}

/** `3:00 – 4:00 pm`, keeping the first meridiem only when the span crosses one. */
const timeRangeLabel = (start: Dayjs, end: Dayjs) => {
	if (end.isSame(start)) return start.format('h:mm a')
	const sharesMeridiem = start.format('a') === end.format('a')
	return `${start.format(sharesMeridiem ? 'h:mm' : 'h:mm a')} – ${end.format('h:mm a')}`
}

/** How long an all-day event runs: `All day`, or `3 days` once it spans more than one. */
const allDayLabel = (days: number) =>
	days === 1 ? __('All day') : __('{0} days', [String(days)])

/** How long a timed event runs: `3 hr`, `1 hr 30 min`, `45 min`. */
const lengthLabel = (start: Dayjs, end: Dayjs) => {
	const minutes = end.diff(start, 'minute')
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (!hours) return __('{0} min', [String(rest)])
	if (!rest) return __('{0} hr', [String(hours)])
	return __('{0} hr {1} min', [String(hours), String(rest)])
}

/**
 * The whole sentence — when the event is, then how long it runs: `Sun, 17 Aug · All day`,
 * `Mon, 17 – Wed, 19 Aug · 3 days`, `Today · 3:00 – 4:00 pm`.
 *
 * `now` is injectable for tests; `compact` is passed through to {@link dayLabel}.
 */
export const formatEventWhen = (
	start: Dayjs,
	duration?: string | null,
	options: { allDay?: boolean; compact?: boolean; now?: Dayjs } = {},
): string => {
	const { allDay = false, compact = false, now = dayjs() } = options

	if (allDay) {
		const last = eventLastDay(start, duration, true)
		const when = last ? dayRangeLabel(start, last, now) : dayLabel(start, now, compact)
		return `${when} · ${allDayLabel(allDayCount(start, duration))}`
	}

	const end = eventEnd(start, duration)

	// A genuine span carries a time at each end, so both dates spell themselves out in full and
	// the `·` separator — which reads as "on this day, at this time" — goes.
	if (eventLastDay(start, duration)) {
		const from = `${dayLabel(start, now)}, ${start.format('h:mm a')}`
		return `${from} – ${dayLabel(end, now)}, ${end.format('h:mm a')}`
	}

	// An overnight stays one day's entry, with the second day named after the closing time.
	// Never compacted: the inline `Tue` sets the register, and `Monday · … Tue` mixes two.
	if (isOvernight(start, end)) {
		const times = `${start.format('h:mm a')} – ${end.format('h:mm a ddd')}`
		return `${dayLabel(start, now)} · ${times} · ${lengthLabel(start, end)}`
	}

	// Every `·` sentence closes on a length — `All day`, `3 days`, `1 hr`. Whether the reader
	// *could* subtract two clock times isn't a rule they can see, so a length that came and went
	// between events would read as missing data rather than as inference.
	const times = timeRangeLabel(start, end)
	if (end.isSame(start)) return `${dayLabel(start, now, compact)} · ${times}`
	return `${dayLabel(start, now, compact)} · ${times} · ${lengthLabel(start, end)}`
}
