import { beforeAll, describe, expect, it } from 'vitest'

import { translate } from '@/boot/translation'
import dayjs from '@/apps/calendar/utils/dayjs'
import { eventLastDay, formatEventWhen, isAllDayEvent } from '@/apps/calendar/utils/eventTime'

// The formatter calls the global `__()` the translation boot installs at app start.
beforeAll(() => {
	window.__ = translate
})

// Fixed "today" so the Today / this-year branches assert something stable. In 2026 the 17th of
// August is a Monday and the 9th of January 2027 a Saturday.
const now = dayjs('2026-08-13T09:00:00')
const when = (start: string, duration?: string, options = {}) =>
	formatEventWhen(dayjs(start), duration, { now, ...options })
const allDay = (start: string, duration?: string, options = {}) =>
	when(start, duration, { allDay: true, ...options })

describe('isAllDayEvent', () => {
	it('trusts the flag', () => {
		expect(
			isAllDayEvent({ start: '2026-08-17T00:00:00', duration: 'P1D', show_without_time: 1 }),
		).toBe(true)
		// Some senders flag an all-day event without normalising the wall clock to midnight.
		expect(
			isAllDayEvent({ start: '2026-08-17T09:00:00', duration: 'PT1H', show_without_time: true }),
		).toBe(true)
	})

	it('reads an unflagged midnight-to-midnight span as all day', () => {
		expect(isAllDayEvent({ start: '2026-08-17T00:00:00', duration: 'P1D' })).toBe(true)
		expect(isAllDayEvent({ start: '2026-08-17T00:00:00', duration: 'P3D' })).toBe(true)
	})

	it('leaves timed events alone', () => {
		expect(isAllDayEvent({ start: '2026-08-17T15:00:00', duration: 'PT1H' })).toBe(false)
		// Starts at midnight but stops short of the next one.
		expect(isAllDayEvent({ start: '2026-08-17T00:00:00', duration: 'PT12H' })).toBe(false)
		expect(isAllDayEvent({ start: '2026-08-17T00:00:00' })).toBe(false)
	})
})

describe('eventLastDay', () => {
	// The strip draws a chip per end, so a wrong answer here shows up as a visible extra day.
	const lastDay = (start: string, duration?: string, allDay = false) => {
		const day = eventLastDay(dayjs(start), duration, allDay)
		return day && day.format('YYYY-MM-DD')
	}

	it('walks back the exclusive midnight end of an all-day span', () => {
		expect(lastDay('2026-08-17T00:00:00', 'P3D', true)).toBe('2026-08-19')
	})

	it('gives nothing to pair with when the event covers one day', () => {
		expect(lastDay('2026-08-17T00:00:00', 'P1D', true)).toBe(null)
		expect(lastDay('2026-08-17T15:00:00', 'PT1H')).toBe(null)
		expect(lastDay('2026-08-17T15:00:00')).toBe(null)
	})

	it('refuses a second chip for an evening that merely runs past midnight', () => {
		expect(lastDay('2026-08-17T23:00:00', 'PT3H')).toBe(null)
		// Still one sitting at the limit; a minute over and it is a span.
		expect(lastDay('2026-08-17T09:00:00', 'PT23H59M')).toBe(null)
		expect(lastDay('2026-08-17T09:00:00', 'PT24H1M')).toBe('2026-08-18')
	})

	it('uses the real end of a timed span', () => {
		expect(lastDay('2026-08-31T09:00:00', 'PT56H')).toBe('2026-09-02')
	})

	it('names every day an oddly shaped all-day event reaches into', () => {
		// A show_without_time event need not sit on midnight or run in whole days; the last
		// day is wherever its final moment falls, not a rounded count of days from its start.
		expect(lastDay('2026-08-17T14:00:00', 'PT12H', true)).toBe('2026-08-18')
		expect(lastDay('2026-08-17T14:00:00', 'P1DT10H', true)).toBe('2026-08-18')
		expect(lastDay('2026-08-17T14:00:00', 'PT0S', true)).toBe(null)
		expect(lastDay('2026-08-17T00:00:00', 'PT1M', true)).toBe(null)
	})
})

describe('formatEventWhen', () => {
	it('says all day instead of midnight to midnight', () => {
		expect(allDay('2026-08-17T00:00:00', 'P1D')).toBe('Mon, 17 Aug · All day')
	})

	it('counts a multi-day span from its inclusive last day', () => {
		// Stored as 17 Aug → 20 Aug, an exclusive end: the event does not run into Thursday.
		expect(allDay('2026-08-17T00:00:00', 'P3D')).toBe('Mon, 17 – Wed, 19 Aug · 3 days')
	})

	it('spells the month on both ends of a span that crosses one', () => {
		expect(allDay('2026-08-30T00:00:00', 'P3D')).toBe('Sun, 30 Aug – Tue, 1 Sep · 3 days')
	})

	it('prints one meridiem when the range stays inside it', () => {
		expect(when('2026-08-17T15:00:00', 'PT1H')).toBe('Mon, 17 Aug · 3:00 – 4:00 pm · 1 hr')
	})

	it('prints both when the range crosses noon', () => {
		expect(when('2026-08-17T11:00:00', 'PT2H')).toBe('Mon, 17 Aug · 11:00 am – 1:00 pm · 2 hr')
	})

	it('drops the date the reader is already living in', () => {
		expect(when('2026-08-13T15:00:00', 'PT1H')).toBe('Today · 3:00 – 4:00 pm · 1 hr')
	})

	it('keeps the year only when it is not this one', () => {
		expect(when('2027-01-09T15:00:00', 'PT1H')).toBe('Sat, 9 Jan 2027 · 3:00 – 4:00 pm · 1 hr')
	})

	it('keeps an overnight on one day, naming the second inline', () => {
		expect(when('2026-08-17T23:00:00', 'PT3H')).toBe('Mon, 17 Aug · 11:00 pm – 2:00 am Tue · 3 hr')
	})

	it('breaks a length into hours and minutes', () => {
		expect(when('2026-08-17T23:30:00', 'PT1H30M')).toBe(
			'Mon, 17 Aug · 11:30 pm – 1:00 am Tue · 1 hr 30 min',
		)
		expect(when('2026-08-17T23:45:00', 'PT30M')).toBe(
			'Mon, 17 Aug · 11:45 pm – 12:15 am Tue · 30 min',
		)
	})

	it('never compacts an overnight, so both weekdays share a register', () => {
		expect(when('2026-08-17T23:00:00', 'PT3H', { compact: true })).toBe(
			'Mon, 17 Aug · 11:00 pm – 2:00 am Tue · 3 hr',
		)
	})

	it('dates both ends of a timed span in full', () => {
		expect(when('2026-08-31T09:00:00', 'PT56H')).toBe(
			'Mon, 31 Aug, 9:00 am – Wed, 2 Sep, 5:00 pm',
		)
	})

	it('handles an event with no duration', () => {
		expect(when('2026-08-17T15:00:00')).toBe('Mon, 17 Aug · 3:00 pm')
	})

	describe('compact', () => {
		const compact = (start: string, duration?: string, options = {}) =>
			when(start, duration, { compact: true, ...options })

		// Abbreviated, not spelled out — and deliberately in both places that compact, mail's
		// invite strip as well as a search result. The chip beside the label has already said
		// `AUG 17`; `Monday` was the one long word on a line whose whole job is to be short.
		it('leaves only the weekday when a date chip carries the rest', () => {
			expect(compact('2026-08-17T00:00:00', 'P1D', { allDay: true })).toBe('Mon · All day')
			expect(compact('2026-08-17T15:00:00', 'PT1H')).toBe('Mon · 3:00 – 4:00 pm · 1 hr')
			expect(compact('2026-08-13T15:00:00', 'PT1H')).toBe('Today · 3:00 – 4:00 pm · 1 hr')
		})

		it('still spells out what a chip cannot carry', () => {
			// A chip shows one date and no year, so a span and another year keep their full label.
			expect(compact('2026-08-17T00:00:00', 'P3D', { allDay: true })).toBe(
				'Mon, 17 – Wed, 19 Aug · 3 days',
			)
			expect(compact('2027-01-09T15:00:00', 'PT1H')).toBe('Sat, 9 Jan 2027 · 3:00 – 4:00 pm · 1 hr')
		})
	})

	describe('length', () => {
		const noLength = (start: string, duration?: string, options = {}) =>
			when(start, duration, { length: false, ...options })

		it('leaves a timed event on its clock times', () => {
			expect(noLength('2026-08-17T15:00:00', 'PT1H')).toBe('Mon, 17 Aug · 3:00 – 4:00 pm')
			expect(when('2026-08-17T15:00:00', 'PT1H')).toBe('Mon, 17 Aug · 3:00 – 4:00 pm · 1 hr')
		})

		it('drops it from an overnight too, which the day names anyway', () => {
			expect(noLength('2026-08-17T23:00:00', 'PT2H')).toBe(
				'Mon, 17 Aug · 11:00 pm – 1:00 am Tue',
			)
		})

		it('keeps what says an event has no clock times at all', () => {
			// Nothing else on the line would say so once the times are gone.
			expect(allDay('2026-08-17T00:00:00', 'P1D', { length: false })).toBe('Mon, 17 Aug · All day')
			expect(allDay('2026-08-17T00:00:00', 'P3D', { length: false })).toBe(
				'Mon, 17 – Wed, 19 Aug · 3 days',
			)
		})

		it('changes nothing for an event with one instant and no span', () => {
			expect(noLength('2026-08-17T15:00:00', 'PT0S')).toBe(when('2026-08-17T15:00:00', 'PT0S'))
		})
	})
})
