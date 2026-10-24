import { describe, expect, it } from 'vitest'

import {
	calendarColor,
	calendarLabel,
	canEditEvent,
	defaultCalendar,
	destinationOptions,
	onShownCalendar,
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
	const holidays = cal('holidays', { may_write_all: 0 })

	it('leaves a shared calendar undrawn until the reader switches it on', () => {
		expect(sharedCalendarVisible(holidays, {})).toBe(false)
		expect(sharedCalendarVisible(holidays, { 'acc|holidays': 1 })).toBe(true)
	})

	it("is the reader's last word", () => {
		expect(sharedCalendarVisible(holidays, { 'acc|holidays': 0 })).toBe(false)
		// a choice about another calendar says nothing of this one
		expect(sharedCalendarVisible(holidays, { 'acc|other': 1 })).toBe(false)
	})
})

describe('calendarLabel', () => {
	it('takes the account off a calendar named after it', () => {
		expect(calendarLabel('Frappe Calendar (akash@frappe.io)')).toEqual({
			label: 'Frappe Calendar',
			email: 'akash@frappe.io',
		})
	})

	it('leaves any other name as it is', () => {
		expect(calendarLabel('Holiday List 2026')).toEqual({
			label: 'Holiday List 2026',
			email: '',
		})
		expect(calendarLabel('Team (Sales)')).toEqual({ label: 'Team (Sales)', email: '' })
		expect(calendarLabel(undefined)).toEqual({ label: '', email: '' })
	})
})

describe('onShownCalendar', () => {
	const drawn = onShownCalendar([
		cal('mine'),
		cal('celebrations', { may_write_all: 0, visible: 0 }),
	])

	it('draws an event on a calendar being shown, named or carried', () => {
		expect(drawn({ calendars: ['acc|mine'] })).toBe(true)
		expect(drawn({ calendars: [{ calendar: 'acc|mine' }] })).toBe(true)
	})

	it('leaves a switched-off calendar out', () => {
		expect(drawn({ calendars: ['acc|celebrations'] })).toBe(false)
		expect(drawn({ calendars: [{ calendar: 'acc|celebrations' }] })).toBe(false)
	})

	it('draws nothing until the calendar list is known, and nothing the list does not have', () => {
		expect(onShownCalendar(undefined)({ calendars: ['acc|mine'] })).toBe(false)
		expect(onShownCalendar([])({ calendars: ['acc|mine'] })).toBe(false)
		expect(drawn({ calendars: ['acc|elsewhere'] })).toBe(false)
	})

	it('draws an event on two calendars where either is shown', () => {
		expect(drawn({ calendars: ['acc|celebrations', 'acc|mine'] })).toBe(true)
	})
})
