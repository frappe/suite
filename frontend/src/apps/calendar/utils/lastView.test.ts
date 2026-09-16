import { beforeEach, describe, expect, it, vi } from 'vitest'

import { lastCalendarView, rememberCalendarView } from './lastView'

const KEY = 'calendar-view'

describe('rememberCalendarView', () => {
	beforeEach(() => localStorage.clear())

	it('remembers a view route', () => {
		rememberCalendarView('calendar-week')
		expect(localStorage.getItem(KEY)).toBe('calendar-week')
	})

	// The calendar has routes that are not views — the profile page, the shortcut
	// records the guard expands — and landing on one is not a change of view.
	it('ignores anything that is not a view', () => {
		rememberCalendarView('calendar-week')
		for (const name of ['calendar-profile', 'calendar-root-shortcut', 'mail-inbox', undefined])
			rememberCalendarView(name)
		expect(localStorage.getItem(KEY)).toBe('calendar-week')
	})

	// Every view is drawn on both devices, each on the route it is named after —
	// a view remembered on one opens on the other.
	it('hands back any of the four views', () => {
		for (const name of [
			'calendar-agenda',
			'calendar-day',
			'calendar-week',
			'calendar-month',
		]) {
			rememberCalendarView(name)
			expect(lastCalendarView()).toBe(name)
		}
	})
})

describe('lastCalendarView', () => {
	beforeEach(() => localStorage.clear())

	it('has nothing to say before a view has been opened', () => {
		expect(lastCalendarView()).toBeNull()
	})

	it('returns what was remembered', () => {
		rememberCalendarView('calendar-day')
		expect(lastCalendarView()).toBe('calendar-day')
	})

	// Storage is shared with whatever else runs on the origin, and a key can
	// outlive the routes it named.
	it('declines a value that is not a view', () => {
		localStorage.setItem(KEY, 'calendar-timeline')
		expect(lastCalendarView()).toBeNull()
	})

	// A private window, or a browser set to block site data: the accessor itself
	// throws, and a calendar that will not open is worse than one that forgets.
	it('falls back when storage cannot be read or written', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied')
		})
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied')
		})

		expect(() => rememberCalendarView('calendar-week')).not.toThrow()
		expect(lastCalendarView()).toBeNull()

		getItem.mockRestore()
		setItem.mockRestore()
	})
})
