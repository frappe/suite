/** A calendar as `get_calendars` sends it. */
export type CalendarRow = {
	/** `account|id` — what events name their calendar by. */
	name: string
	id: string
	_name: string
	color?: string | null
	default: 0 | 1
	may_delete: 0 | 1
}

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

/** Where a new event goes unless the reader picks another: the account's default, else its first. */
export const defaultCalendar = (calendars: CalendarRow[] | undefined): CalendarRow | undefined =>
	calendars?.find((cal) => cal.default) ?? calendars?.[0]

/**
 * Which calendars are ticked once the list comes back.
 *
 * The list reloads after every rename, recolour or new calendar, and a reload
 * that ticked everything again undid whatever the reader had switched off. So a
 * calendar keeps its tick, and only one the reader has not seen before arrives
 * ticked — a calendar just created is one they want to see.
 */
export const visibleAfterReload = (
	known: string[],
	visible: string[],
	calendars: CalendarRow[],
): string[] =>
	calendars
		.map((cal) => cal.name)
		.filter((name) => !known.includes(name) || visible.includes(name))
