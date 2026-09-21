/** A calendar as `get_calendars` sends it. */
export type CalendarRow = {
	/** `account|id` — what events name their calendar by. */
	name: string
	account: string
	id: string
	_name: string
	color?: string | null
	default: 0 | 1
	/** Whether its events are drawn: JMAP's `isVisible`, so the choice follows the user. */
	visible: 0 | 1
	/**
	 * Whether the account may change the calendar and what is on it. Only false on a
	 * calendar shared with it read-only: Stalwart asks for this right to rename or
	 * recolour one, and to add an event to it.
	 */
	may_write_all: 0 | 1
	may_delete: 0 | 1
	/**
	 * A shared calendar that starts out unticked, like the company's birthdays: the reader
	 * switches it on, rather than everyone having to switch it off.
	 */
	default_hidden?: 0 | 1
}

/**
 * Whether a calendar shared read-only is drawn in this browser. Most are until hidden; one
 * that starts hidden is not until shown — so each has the list that records the choice made
 * against its default.
 */
export const sharedCalendarVisible = (
	calendar: CalendarRow,
	hidden: string[],
	shown: string[],
): boolean =>
	calendar.default_hidden ? shown.includes(calendar.name) : !hidden.includes(calendar.name)

/**
 * The colours a calendar can be given here, as the hex saved on it.
 *
 * A hex, not the palette's name: the colour lives on the JMAP calendar, and every
 * other client reading it expects CSS — `amber` is not a colour anywhere but here.
 * These are the hexes frappe-ui's Calendar already reads back as its own palette
 * (`legacyColorNamesByHex` in its useEventBase), so the pills still draw in the
 * theme's tokens, dark mode included, rather than in the raw hex.
 *
 * In order: a calendar with no colour saved wears the one at its position.
 */
export const CALENDAR_COLORS = [
	{ name: 'green', hex: '#30a66d' },
	{ name: 'blue', hex: '#0289f7' },
	{ name: 'violet', hex: '#6846e3' },
	{ name: 'amber', hex: '#db7706' },
	{ name: 'pink', hex: '#e34aa6' },
	{ name: 'cyan', hex: '#3bbde5' },
	{ name: 'orange', hex: '#e86c13' },
] as const

// Where a calendar has no colour of its own, one from the palette by position.
const PALETTE = CALENDAR_COLORS.map(({ name }) => name)

/**
 * The colour a calendar is drawn in: its own, set wherever its owner set it, and
 * only where it has none one assigned by position. Its events and its dot in the
 * sidebar share whichever it is.
 */
export const calendarColor = (calendars: CalendarRow[] | undefined, name: string): string => {
	const index = calendars?.findIndex((cal) => cal.name === name) ?? -1
	return calendars?.[index]?.color || PALETTE[Math.max(index, 0) % PALETTE.length]
}

/**
 * Where a new event goes unless the reader picks another: the account's default, else its
 * first — among the calendars it can write to, since the server refuses an event anywhere else.
 */
export const defaultCalendar = (calendars: CalendarRow[] | undefined): CalendarRow | undefined => {
	const writable = calendars?.filter((cal) => cal.may_write_all)
	return writable?.find((cal) => cal.default) ?? writable?.[0]
}

/**
 * The calendars an event can be put on: those the account can write to. The one it is
 * already on stays offered even when read-only, so the picker still names where it is.
 */
export const destinationOptions = <T extends { value: string; writable: boolean }>(
	options: T[],
	current?: string,
): T[] => options.filter((option) => option.writable || option.value === current)

/**
 * Whether the user can change an event: it sits on a calendar they can write to. An event on a
 * calendar the list does not know — before it loads, or opened from mail — is left editable,
 * and the server has the last word either way.
 */
export const canEditEvent = (
	event: { calendars?: { calendar: string }[] },
	calendars: CalendarRow[] | undefined,
): boolean => {
	const rows = (event.calendars ?? []).map((c) => calendars?.find((cal) => cal.name === c.calendar))
	return !rows.length || rows.some((row) => !row || row.may_write_all)
}
