/**
 * How far into a series an action reaches.
 *
 * Editing, deleting and answering an invitation all ask the same question of a
 * recurring event — this occurrence, this one and the rest, or every one of
 * them — so they ask it in the same words, from one list, and name the answer
 * the same way when they carry it to the server.
 */
export type RecurringScope = 'instance' | 'following' | 'series'

export interface RecurringScopeOption {
	value: RecurringScope
	label: string
	/** Shown under the label only where the consequence isn't obvious from it. */
	description?: string
	/** Offered but not available here — the row explains itself in `description`. */
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
 * rather than offering the same answer twice — and the server, asked anyway, edits the series
 * whole instead of cutting a first half with nothing in it.
 */
export const isFirstOccurrence = (event?: {
	recurrence_id?: string
	master_start?: string
}): boolean => !!event?.recurrence_id && event.recurrence_id === event.master_start

/**
 * The answers a recurring edit or delete offers this occurrence.
 *
 * @param isFirst - Whether this is the series' first occurrence, which drops "this and
 *   following" from the list.
 * @param splitBlockedReason - Why the reader may not split the series here, if they may not.
 *   The row stays, greyed out and saying so, rather than disappearing without explanation.
 */
export const scopeOptions = ({
	isFirst = false,
	splitBlockedReason,
}: { isFirst?: boolean; splitBlockedReason?: string } = {}): RecurringScopeOption[] => {
	const labels = scopeLabels()

	return [
		{ value: 'instance', label: labels.instance },
		...(isFirst
			? []
			: [
					{
						value: 'following' as const,
						label: labels.following,
						disabled: !!splitBlockedReason,
						description: splitBlockedReason,
					},
				]),
		{ value: 'series', label: labels.series },
	]
}
