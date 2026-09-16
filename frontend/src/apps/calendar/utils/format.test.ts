import { beforeAll, describe, expect, it } from 'vitest'

import { formatAlertPhrase, getRepeatMessage } from './format'

// The app's translation helper is a global installed at boot. The placeholder form is what
// the assertions read, so it substitutes rather than translating.
beforeAll(() => {
	;(globalThis as any).__ = (text: string, args?: (string | number)[]) =>
		args ? text.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) : text
})

describe('getRepeatMessage', () => {
	it('describes an ordinary rule', () => {
		expect(getRepeatMessage({ frequency: 'weekly', interval: 1 } as any)).toBe('Every week')
	})

	// The days arrive in whatever order the rule stored them — a series set up on a
	// Tuesday put Tuesday first — and a week is read in week order.
	it('names the days of a weekly rule in week order', () => {
		const byDay = ['tu', 'we', 'mo', 'th', 'fr'].map((day) => ({ day }))
		expect(getRepeatMessage({ frequency: 'weekly', interval: 1, byDay } as any)).toBe(
			'Every week on Monday, Tuesday, Wednesday, Thursday, Friday',
		)
	})

	it('starts the week on Sunday, as the grid does', () => {
		const byDay = ['sa', 'su'].map((day) => ({ day }))
		expect(getRepeatMessage({ frequency: 'weekly', interval: 1, byDay } as any)).toBe(
			'Every week on Sunday, Saturday',
		)
	})

	// Sorting must not become a way to lose a day.
	it('keeps a day it does not recognise, at the end', () => {
		const byDay = [{ day: 'xx' }, { day: 'mo' }]
		expect(getRepeatMessage({ frequency: 'weekly', interval: 1, byDay } as any)).toContain(
			'Monday',
		)
	})

	it('is unchanged for a rule naming one nth day', () => {
		expect(
			getRepeatMessage({
				frequency: 'monthly',
				interval: 1,
				byDay: [{ day: 'tu', nthOfPeriod: 2 }],
			} as any),
		).toBe('Every month on the 2nd Tuesday')
	})

	it('says nothing about a rule it cannot read', () => {
		// An occurrence can outlive the rule that made it: a series whose rule was cleared keeps
		// the occurrences the server had already expanded, and they still carry a recurrence id.
		// This used to assert its way to a frequency and throw out of the panel rendering it.
		expect(getRepeatMessage({} as any)).toBe('')
		expect(getRepeatMessage(undefined as any)).toBe('')
		expect(getRepeatMessage({ interval: 1 } as any)).toBe('')
	})
})

describe('formatAlertPhrase', () => {
	const offset = (number: number, unit: string, extra = {}) => ({
		type: 'OffsetTrigger',
		number,
		unit,
		direction: -1,
		relative_to: 'Start',
		...extra,
	})

	it('reads an offset as a phrase, singular and plural', () => {
		expect(formatAlertPhrase(offset(10, 'minutes'))).toBe('Notification 10 minutes before start')
		expect(formatAlertPhrase(offset(1, 'days'))).toBe('Notification 1 day before start')
		expect(formatAlertPhrase(offset(2, 'days'))).toBe('Notification 2 days before start')
	})

	// The desktop's row shows Start or End on every alert, so the phrase standing in
	// for that row names the anchor both ways round.
	it('keeps direction and anchor', () => {
		expect(formatAlertPhrase(offset(1, 'hours', { direction: 1 }))).toBe('Notification 1 hour after start')
		expect(formatAlertPhrase(offset(15, 'minutes', { relative_to: 'End' }))).toBe(
			'Notification 15 minutes before end',
		)
	})

	// The other thing that row shows, named on every alert: without it the absolute
	// case read "on 8 Sep at 9:00 am", which says when without saying what.
	it('names how the reader is told', () => {
		expect(formatAlertPhrase(offset(10, 'minutes', { action: 'Email' }))).toBe(
			'Email 10 minutes before start',
		)
		expect(formatAlertPhrase(offset(10, 'minutes', { action: 'Display' }))).toBe(
			'Notification 10 minutes before start',
		)
	})

	// A zero offset is the event's own start; "0 min before" would be a clumsy way to say so.
	it('names the event start rather than a zero offset', () => {
		expect(formatAlertPhrase(offset(0, 'minutes'))).toBe('Notification at time of event')
	})

	it('spells an absolute trigger the way the row reads it', () => {
		expect(
			formatAlertPhrase({ type: 'AbsoluteTrigger', date: '2026-09-08', time: '09:00' }),
		).toBe('Notification on 8 Sep at 9:00 am')
	})
})
