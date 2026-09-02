/**
 * How far into a series an action reaches.
 *
 * Editing and deleting ask the same question of a recurring event — this
 * occurrence, this one and the rest, or every one of them — so they ask it in
 * the same words, from one list, and name the answer the same way when they
 * carry it to the server.
 */
export type RecurringScope = 'instance' | 'following' | 'series'

export interface RecurringScopeOption {
	value: RecurringScope
	label: string
	/** Offered but not available yet — the row is there, greyed out. */
	disabled?: boolean
}

/**
 * The wording every scope list starts from.
 *
 * A function rather than a constant: `__` reads the loaded translations, and at
 * module scope they are not loaded yet.
 */
export const scopeLabels = (): Record<RecurringScope, string> => ({
	instance: __('This event only'),
	following: __('This and following events'),
	series: __('All events in the series'),
})

/**
 * Whether an occurrence is the first of its series.
 *
 * There "this and following" reaches exactly what "all events" reaches, so the list drops it
 * rather than offering the same answer twice.
 */
export const isFirstOccurrence = (event?: {
	recurrence_id?: string
	master_start?: string
}): boolean => !!event?.recurrence_id && event.recurrence_id === event.master_start

/**
 * The answers a recurring action offers this occurrence.
 *
 * Not every answer reaches the server yet, and the ones that don't are shown greyed out
 * rather than left out: the question has three answers whatever we can currently carry, and
 * a list that quietly changes length between actions reads as a different question.
 *
 * @param unavailable - Answers this action cannot carry yet.
 * @param isFirst - Whether this is the series' first occurrence, where "this and following"
 *   is the same answer as "all events" and is left out rather than greyed out.
 */
export const scopeOptions = ({
	unavailable = [],
	isFirst = false,
}: { unavailable?: RecurringScope[]; isFirst?: boolean } = {}): RecurringScopeOption[] =>
	(['instance', 'following', 'series'] as const)
		.filter((value) => !(isFirst && value === 'following'))
		.map((value) => ({
			value,
			label: scopeLabels()[value],
			disabled: unavailable.includes(value),
		}))
