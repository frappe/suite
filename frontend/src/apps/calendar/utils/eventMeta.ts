import { getRepeatMessage } from '@/apps/calendar/utils/format'

/**
 * What a listed event says about itself beyond its title.
 *
 * The phone's agenda, the desktop agenda and the day view's schedule rail all
 * show an event as a row, and a row has a second line. This is what goes on it,
 * kept in one place so the three surfaces cannot drift into describing the same
 * event three different ways.
 *
 * frappe-ui derives what it can from its own generic event shape; everything
 * here needs suite's — locations, participants, meet links, recurrence — and so
 * reaches the calendar through its `#event-description` and `#event-suffix`
 * slots.
 */

interface MetaEvent {
	locations?: Array<{ _name?: string }>
	links?: Array<{ href?: string }>
	recurrence_rule?: { frequency?: string }
	organizer?: string
	participants?: Array<{
		participation_status?: string
		email?: string
		_name?: string
		user_image?: string
	}>
}

/** Where it is: the location, else the meeting it happens in. */
export const eventPlace = (event: MetaEvent): string => {
	const place = event.locations?.find((l) => l._name)?._name
	if (place) return place
	if (event.links?.some((l) => l?.href?.includes('/meet/'))) return __('Frappe Meet')
	return ''
}

/** How often it comes round, as the formatter writes it — "Every week on Thursday". */
const eventRepeat = (event: MetaEvent): string => {
	if (!event.recurrence_rule?.frequency) return ''
	return getRepeatMessage(event.recurrence_rule) || ''
}

const people = (event: MetaEvent) => event.participants ?? []

/**
 * How many are in it — everyone invited, whatever they answered: a row says
 * who the event is with, and the answers are the card's to show. Worth saying
 * only once it is a crowd rather than a pair. The row's far end shows this.
 * Not faces: three 24px faces and a "+N" took the width of a title to say
 * what two words say, and on a tinted block they were three more discs
 * competing with the one mark the block is.
 */
export const eventPeople = (event: MetaEvent): string => {
	const count = people(event).length
	return count > 1 ? __('{0} people', [String(count)]) : ''
}

/**
 * The line, in reading order: how often, then where. The rule first because it
 * says what kind of thing the event is — a standing one — where the place is a
 * detail of this occurrence; "Every week on Thursday · Frappe Meet" reads as a
 * fact and then its venue, and the other way round the venue led on a line
 * that was mostly the rule. Not how many: that is a count, and the row sets it
 * at its far end from `participant` — see the event transform in CalendarView
 * — where the counts of a day's rows line up. `eventRowDescription` below sets
 * it before the calendar's own note about an event running on past the day.
 */
export const eventDescription = (event: MetaEvent): string =>
	[eventRepeat(event), eventPlace(event)].filter(Boolean).join(' · ')

/**
 * The whole second line of an agenda row: the description above, then the
 * calendar's own note about which day of a stay the row is — "Day 2/3" — which
 * the host passes in, having asked the calendar for it. Composed here so the
 * desktop's rows and the phone's read one line, in one order.
 */
export const eventRowDescription = (event: MetaEvent, daySpan?: string | null): string =>
	[eventDescription(event), daySpan].filter(Boolean).join(' · ')
