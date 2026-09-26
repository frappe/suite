import { describe, expect, it } from 'vitest'

import {
	calendarColor,
	canEditEvent,
	defaultCalendar,
	destinationOptions,
	isOnAShownCalendar,
	sharedCalendarVisible,
} from '@/apps/calendar/utils/calendars'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const cal = (name: string, extra: Partial<CalendarRow> = {}): CalendarRow => ({
	name: `acc|${name}`,
	account: 'acc',
	id: name,
	_name: name,
	default: 0,
	visible: 1,
	may_write_all: 1,
	may_delete: 1,
	...extra,
})

describe('calendarColor', () => {
	it('uses the colour the calendar carries', () => {
		expect(calendarColor([cal('a'), cal('b', { color: '#336699' })], 'acc|b')).toBe('#336699')
	})

	it('assigns a palette colour by position when the calendar has none', () => {
		const calendars = [cal('a'), cal('b', { color: null })]
		expect(calendarColor(calendars, 'acc|a')).toBe('green')
		expect(calendarColor(calendars, 'acc|b')).toBe('blue')
	})
})

describe('defaultCalendar', () => {
	it('is the one flagged default', () => {
		expect(defaultCalendar([cal('a'), cal('b', { default: 1 })])?.id).toBe('b')
	})

	it('falls back to the first, and to nothing before the list loads', () => {
		expect(defaultCalendar([cal('a'), cal('b')])?.id).toBe('a')
		expect(defaultCalendar(undefined)).toBeUndefined()
	})

	it('passes over a calendar the account cannot write to', () => {
		const shared = cal('shared', { default: 1, may_write_all: 0 })
		expect(defaultCalendar([shared, cal('b')])?.id).toBe('b')
		expect(defaultCalendar([shared])).toBeUndefined()
	})
})

describe('destinationOptions', () => {
	const options = [
		{ value: 'a', writable: true },
		{ value: 'shared', writable: false },
	]

	it('offers only the calendars that can be written to', () => {
		expect(destinationOptions(options).map((o) => o.value)).toEqual(['a'])
	})

	it('keeps the read-only calendar an event is already on', () => {
		expect(destinationOptions(options, 'shared').map((o) => o.value)).toEqual(['a', 'shared'])
	})
})

describe('canEditEvent', () => {
	const calendars = [cal('mine'), cal('shared', { may_write_all: 0 })]
	const on = (...names: string[]) => ({ calendars: names.map((name) => ({ calendar: `acc|${name}` })) })

	it('is false on a calendar shared read-only', () => {
		expect(canEditEvent(on('shared'), calendars)).toBe(false)
	})

	it('is true when any of its calendars can be written to', () => {
		expect(canEditEvent(on('mine'), calendars)).toBe(true)
		expect(canEditEvent(on('shared', 'mine'), calendars)).toBe(true)
	})

	it('is true on a calendar the list does not know', () => {
		expect(canEditEvent(on('elsewhere'), calendars)).toBe(true)
		expect(canEditEvent(on('shared'), undefined)).toBe(true)
	})
})

describe('sharedCalendarVisible', () => {
	it('draws a shared calendar until it is hidden', () => {
		const holidays = cal('holidays', { may_write_all: 0 })
		expect(sharedCalendarVisible(holidays, [], [])).toBe(true)
		expect(sharedCalendarVisible(holidays, ['acc|holidays'], [])).toBe(false)
	})

	it('leaves one that starts hidden undrawn until it is shown', () => {
		const celebrations = cal('celebrations', { may_write_all: 0, default_hidden: 1 })
		expect(sharedCalendarVisible(celebrations, [], [])).toBe(false)
		expect(sharedCalendarVisible(celebrations, [], ['acc|celebrations'])).toBe(true)
		// hidden is the other kind's list, and says nothing of this one
		expect(sharedCalendarVisible(celebrations, ['acc|celebrations'], ['acc|celebrations'])).toBe(true)
	})
})

describe('isOnAShownCalendar', () => {
	const rows = [cal('mine'), cal('celebrations', { may_write_all: 0, visible: 0 })]

	it('ticks a day whose event is on a calendar being drawn', () => {
		expect(isOnAShownCalendar({ calendars: ['acc|mine'] }, rows)).toBe(true)
	})

	it('leaves a switched-off calendar out of the ticks', () => {
		expect(isOnAShownCalendar({ calendars: ['acc|celebrations'] }, rows)).toBe(false)
	})

	it('ticks an event on a calendar the list does not know yet', () => {
		expect(isOnAShownCalendar({ calendars: ['acc|elsewhere'] }, rows)).toBe(true)
		expect(isOnAShownCalendar({ calendars: ['acc|celebrations'] }, undefined)).toBe(true)
	})

	it('ticks an event on two calendars where either is drawn', () => {
		expect(isOnAShownCalendar({ calendars: ['acc|celebrations', 'acc|mine'] }, rows)).toBe(true)
	})
})
