import dayjs from '@/apps/calendar/utils/dayjs'

import type { Dayjs } from 'dayjs'
import type { RecurrenceRule } from '@/apps/calendar/utils/format'

/**
 * Keeping a recurrence rule pointed at the event it belongs to.
 *
 * A rule says which days of a week or a month an event falls on, and those are
 * read off the start date when the event is written. The start can move
 * afterwards — the reader edits the date on the series — and the rule does not
 * follow on its own. A weekly series anchored on a Monday, dragged to a
 * Wednesday, becomes an event that starts on Wednesday and repeats on Mondays:
 * the anchor matches nothing the rule generates, so the very occurrence that
 * was edited is not drawn at all.
 *
 * So when the anchor moves, the selectors that were reading it move with it.
 * Only the part that named the old anchor is rewritten — a reader who ticked
 * Monday and Thursday keeps both, with whichever of them was the anchor moved
 * to the new day.
 */

/** The two-letter day code a JSCalendar rule uses: `mo`, `tu`, … */
const dayCode = (date: Dayjs) => date.format('dd').toLowerCase()

/** Which occurrence of its weekday the date is within its month: 1st, 2nd, … */
const weekOfMonth = (date: Dayjs) => Math.ceil(date.date() / 7)

/** Whether no later date in the month shares the weekday — the last Tuesday, say. */
const isLastWeekdayOfMonth = (date: Dayjs) => date.add(1, 'week').month() !== date.month()

const isLastDayOfMonth = (date: Dayjs) => date.date() === date.daysInMonth()

/**
 * `rule` with its day selectors read off `to` instead of `from`.
 *
 * Returns the rule untouched when nothing was anchored to the old date, so a
 * save that changed neither the rule nor the anchor still sends the rule it
 * arrived with — and a dirty check sees no difference.
 *
 * Daily and yearly rules carry no selectors here: the server reads their day
 * off the start, so they follow it without help.
 */
export const reanchoredRule = (
	rule: RecurrenceRule,
	from: Dayjs,
	to: Dayjs,
): RecurrenceRule => {
	if (!rule || from.isSame(to, 'day')) return rule

	if (rule.frequency === 'weekly') return reanchoredWeekly(rule, from, to)
	if (rule.frequency === 'monthly') return reanchoredMonthly(rule, from, to)

	return rule
}

const reanchoredWeekly = (rule: RecurrenceRule, from: Dayjs, to: Dayjs): RecurrenceRule => {
	// No byDay at all means the day was never pinned; the start already says it.
	if (!rule.byDay?.length) return rule

	const wasAnchor = dayCode(from)
	if (!rule.byDay.some((entry) => entry.day === wasAnchor)) return rule

	const nowAnchor = dayCode(to)
	const moved = rule.byDay.map((entry) =>
		entry.day === wasAnchor ? { ...entry, day: nowAnchor } : entry,
	)

	// Moving onto a day already ticked collapses two entries into one.
	return {
		...rule,
		byDay: moved.filter(
			(entry, i) => moved.findIndex((other) => other.day === entry.day) === i,
		),
	}
}

const reanchoredMonthly = (rule: RecurrenceRule, from: Dayjs, to: Dayjs): RecurrenceRule => {
	// "The last Tuesday", "the second Friday" — the weekday and which one it is
	// both come off the anchor.
	if (rule.byDay?.length) {
		const entry = rule.byDay[0]
		if (entry.day !== dayCode(from)) return rule
		return {
			...rule,
			byDay: [
				{
					day: dayCode(to),
					// A rule set to the last such weekday stays "last" as long as the new
					// anchor is one; otherwise it becomes the week it actually falls in.
					nthOfPeriod:
						entry.nthOfPeriod === -1 && isLastWeekdayOfMonth(to)
							? -1
							: weekOfMonth(to),
				},
			],
		}
	}

	if (!rule.byMonthDay?.length) return rule

	const [day] = rule.byMonthDay
	// "The last day of the month" survives a move to another month's last day;
	// anywhere else it is the date the anchor now falls on.
	if (day === -1) return isLastDayOfMonth(to) ? rule : { ...rule, byMonthDay: [to.date()] }
	// A day-of-month that named the old anchor names the new one. It is not
	// turned into "the last day" just because the date happens to be a 31st —
	// that is a different rule, and the reader did not ask for it.
	if (day !== from.date()) return rule
	return { ...rule, byMonthDay: [to.date()] }
}
