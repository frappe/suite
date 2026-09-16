import { CalendarColorMap } from 'frappe-ui/experimental'

/**
 * The CSS colour to draw an event or a calendar in.
 *
 * A calendar carries its own colour — set wherever its owner set it, and handed
 * over on every event — and where it has none, the app assigns it one of the
 * library's palette names by position. So a colour arriving here is either a
 * name to look up or a colour to use as it stands, and every surface that draws
 * one (the pills, the sidebar's dots, the month ticks, the phone's rows) has to
 * accept both. They each carried their own copy of this and each fell back to
 * green on anything they did not recognise, which is how a user's blue calendar
 * came out green in four different places at once.
 */
export const eventColor = (color?: string): string => {
	const named = color ? CalendarColorMap[color] : undefined
	if (named) return named.color
	// Anything the palette does not name is a colour in its own right: a hex from
	// the server, or a function like `rgb()` or `var()`.
	if (color && /^(#|rgb|hsl|oklch|var\()/i.test(color)) return color
	return CalendarColorMap.green.color
}
