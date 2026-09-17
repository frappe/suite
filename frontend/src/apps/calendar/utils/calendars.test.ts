import { describe, expect, it } from 'vitest'

import { calendarColor, defaultCalendar, visibleAfterReload } from '@/apps/calendar/utils/calendars'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const cal = (name: string, extra: Partial<CalendarRow> = {}): CalendarRow => ({
	name: `acc|${name}`,
	id: name,
	_name: name,
	default: 0,
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
})

describe('visibleAfterReload', () => {
	it('ticks everything on the first load', () => {
		expect(visibleAfterReload([], [], [cal('a'), cal('b')])).toEqual(['acc|a', 'acc|b'])
	})

	it('keeps a calendar the reader switched off switched off', () => {
		const known = ['acc|a', 'acc|b']
		expect(visibleAfterReload(known, ['acc|a'], [cal('a'), cal('b')])).toEqual(['acc|a'])
	})

	it('ticks a calendar that is new, and drops one that is gone', () => {
		const known = ['acc|a', 'acc|b']
		expect(visibleAfterReload(known, ['acc|b'], [cal('b'), cal('c')])).toEqual(['acc|b', 'acc|c'])
	})
})
