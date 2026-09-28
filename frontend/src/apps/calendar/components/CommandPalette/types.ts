/** A calendar event as the palette's search hands it over — `format_calendar_event`'s shape. */
export interface CalendarSearchResult {
	resultType: 'calendar-event'
	/** `account|id`: unique across the accounts a search reaches, unlike `id`. */
	name: string
	id: string
	account: string
	title?: string
	start: string
	duration?: string
	time_zone?: string
	show_without_time?: 0 | 1
	recurrence_id?: string
	recurrence_rule?: string | Record<string, unknown>
	master_id?: string
	calendars?: { calendar: string; calendar_name?: string; color?: string }[]
	locations?: { uid: string; _name?: string }[]
	links?: { uid: string; href?: string }[]
	participants?: { email: string; _name?: string }[]
	organizer?: string
}
