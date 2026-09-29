import { computed, reactive, watch } from 'vue'

import { utcDayEnd, utcDayStart } from '@/apps/calendar/utils/datetime'

export interface CalendarSearchFilter {
	/** A calendar as `account|id`, which says both which account to ask and which calendar. */
	calendar: string
	attendee: string
	organizer: string
	/** Plain dates as the reader picked them; widened to instants only on the way out. */
	after: string
	before: string
}

export interface CalendarFilterBadge {
	key: keyof CalendarSearchFilter
	label: string
	value: string
}

// Every field, in the order the badges read, with the word a badge names it by.
const FIELDS: { key: keyof CalendarSearchFilter; label: string }[] = [
	{ key: 'calendar', label: 'Calendar' },
	{ key: 'attendee', label: 'Attendee' },
	{ key: 'organizer', label: 'Organiser' },
	{ key: 'after', label: 'From' },
	{ key: 'before', label: 'To' },
]

const emptyFilter = () =>
	Object.fromEntries(FIELDS.map(({ key }) => [key, ''])) as CalendarSearchFilter

/**
 * The advanced filters behind the palette's sliders button, and the badges that say which of
 * them are on.
 *
 * Only filters the server actually indexes are offered. Stalwart *ignores* a condition it does
 * not know rather than refusing it, so a filter for something unindexed — who is invited beyond
 * the organizer and attendees, whether an event is a draft, its status or its privacy — would
 * read as working while quietly widening the search instead of narrowing it.
 */
export function useCalendarSearchFilters() {
	const filter = reactive<CalendarSearchFilter>(emptyFilter())

	// The two dates are the ends of one range rather than two filters of their own, because
	// only a closed range lets a series answer as the occurrence the reader is looking for:
	// the server will not expand a recurrence without both ends, and a half-filled one would
	// hand back a weekly standup dated the year it was first entered. So filling one end fills
	// the other with the same day — in the field, where the reader can see it and move it. The
	// same day rather than a year off: a single-day range is plainly a placeholder to widen,
	// where a date a year away read as something the reader had chosen. Clearing one end
	// leaves the other: a reader who drops "from" and keeps "to" has asked for everything up
	// to that day, and taking the day away with it answered a question they had not asked.
	watch(
		() => filter.after,
		(after) => {
			if (after && !filter.before) filter.before = after
		},
		{ flush: 'sync' },
	)

	watch(
		() => filter.before,
		(before) => {
			if (before && !filter.after) filter.after = before
		},
		{ flush: 'sync' },
	)

	const reset = () => Object.assign(filter, emptyFilter())

	const removeFilter = (key: keyof CalendarSearchFilter) => {
		filter[key] = ''
	}

	/** What is set, blank space aside: a filter is a word, not the room around one. */
	const setFields = () => FIELDS.filter(({ key }) => filter[key].trim())

	/** Labels the reader can read back, given the calendar names the panel knows. */
	const badges = (calendarLabel: (value: string) => string): CalendarFilterBadge[] =>
		setFields().map(({ key, label }) => ({
			key,
			label,
			value: key === 'calendar' ? calendarLabel(filter.calendar) : filter[key].trim(),
		}))

	/**
	 * The filters as the API takes them. A date is widened to the whole of that day in the
	 * reader's zone here, where the zone is known — "3 July" begins and ends at different
	 * instants for different readers, and the server is holding neither.
	 */
	const params = computed(() => ({
		calendar: filter.calendar || undefined,
		attendee: filter.attendee.trim() || undefined,
		organizer: filter.organizer.trim() || undefined,
		after: filter.after ? utcDayStart(filter.after) : undefined,
		before: filter.before ? utcDayEnd(filter.before) : undefined,
	}))

	/** Whether anything is narrowed — a filter-only search is a search, an empty one is not. */
	const isNarrowed = computed(() => setFields().length > 0)

	return { filter, badges, params, isNarrowed, removeFilter, reset }
}
