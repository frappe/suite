import { describe, expect, it } from 'vitest'

import dayjs from '@/apps/calendar/utils/dayjs'
import { reanchoredRule } from '@/apps/calendar/utils/recurrence'

import type { RecurrenceRule } from '@/apps/calendar/utils/format'

const d = (iso: string) => dayjs(iso)

const weekly = (byDay?: { day: string; nthOfPeriod?: number }[]): RecurrenceRule => ({
	frequency: 'weekly',
	interval: 1,
	...(byDay ? { byDay } : {}),
})

const monthly = (rest: Partial<RecurrenceRule>): RecurrenceRule => ({
	frequency: 'monthly',
	interval: 1,
	...rest,
})

describe('reanchoredRule', () => {
	it('leaves the rule alone when the anchor did not move', () => {
		const rule = weekly([{ day: 'mo' }])
		expect(reanchoredRule(rule, d('2026-09-07'), d('2026-09-07T18:00'))).toBe(rule)
	})

	describe('weekly', () => {
		// The reported bug: a Monday series moved to a Wednesday kept repeating on
		// Mondays, so the occurrence the reader had just edited was never drawn.
		it('moves the ticked day to the day the anchor landed on', () => {
			expect(
				reanchoredRule(weekly([{ day: 'mo' }]), d('2026-09-07'), d('2026-09-09')),
			).toEqual(weekly([{ day: 'we' }]))
		})

		it('keeps the days the reader chose and moves only the anchor', () => {
			expect(
				reanchoredRule(
					weekly([{ day: 'mo' }, { day: 'th' }]),
					d('2026-09-07'),
					d('2026-09-09'),
				),
			).toEqual(weekly([{ day: 'we' }, { day: 'th' }]))
		})

		it('collapses the pair when the anchor moves onto a day already ticked', () => {
			expect(
				reanchoredRule(
					weekly([{ day: 'mo' }, { day: 'th' }]),
					d('2026-09-07'),
					d('2026-09-10'),
				),
			).toEqual(weekly([{ day: 'th' }]))
		})

		it('leaves an unpinned rule to read the start itself', () => {
			const rule = weekly()
			expect(reanchoredRule(rule, d('2026-09-07'), d('2026-09-09'))).toBe(rule)
		})

		// The reader unticked the anchor's own day; that is their arrangement, and
		// moving the date is not the moment to overrule it.
		it('leaves days that never included the anchor', () => {
			const rule = weekly([{ day: 'th' }])
			expect(reanchoredRule(rule, d('2026-09-07'), d('2026-09-09'))).toBe(rule)
		})
	})

	describe('monthly', () => {
		it('moves a day-of-month to the new date', () => {
			expect(
				reanchoredRule(monthly({ byMonthDay: [7] }), d('2026-09-07'), d('2026-09-09')),
			).toEqual(monthly({ byMonthDay: [9] }))
		})

		it('does not turn a plain day-of-month into "the last day"', () => {
			// The 30th is September's last date, but the rule said "the 7th", not
			// "the end of the month".
			expect(
				reanchoredRule(monthly({ byMonthDay: [7] }), d('2026-09-07'), d('2026-09-30')),
			).toEqual(monthly({ byMonthDay: [30] }))
		})

		it('keeps "last day of the month" when the anchor is still one', () => {
			const rule = monthly({ byMonthDay: [-1] })
			expect(reanchoredRule(rule, d('2026-09-30'), d('2026-10-31'))).toBe(rule)
		})

		it('gives up "last day" only once the anchor is not one', () => {
			expect(
				reanchoredRule(monthly({ byMonthDay: [-1] }), d('2026-09-30'), d('2026-10-09')),
			).toEqual(monthly({ byMonthDay: [9] }))
		})

		it('moves an nth-weekday to the week the anchor now falls in', () => {
			// First Monday → third Wednesday.
			expect(
				reanchoredRule(
					monthly({ byDay: [{ day: 'mo', nthOfPeriod: 1 }] }),
					d('2026-09-07'),
					d('2026-09-16'),
				),
			).toEqual(monthly({ byDay: [{ day: 'we', nthOfPeriod: 3 }] }))
		})

		it('keeps "the last one" when the anchor is still the last of its weekday', () => {
			// 2026-09-29 is the last Tuesday of September.
			expect(
				reanchoredRule(
					monthly({ byDay: [{ day: 'mo', nthOfPeriod: -1 }] }),
					d('2026-09-28'),
					d('2026-09-29'),
				),
			).toEqual(monthly({ byDay: [{ day: 'tu', nthOfPeriod: -1 }] }))
		})

		it('gives up "the last one" when the anchor no longer is', () => {
			expect(
				reanchoredRule(
					monthly({ byDay: [{ day: 'mo', nthOfPeriod: -1 }] }),
					d('2026-09-28'),
					d('2026-09-09'),
				),
			).toEqual(monthly({ byDay: [{ day: 'we', nthOfPeriod: 2 }] }))
		})
	})

	it('leaves daily and yearly rules to the start date', () => {
		const daily: RecurrenceRule = { frequency: 'daily', interval: 1 }
		const yearly: RecurrenceRule = { frequency: 'yearly', interval: 1 }
		expect(reanchoredRule(daily, d('2026-09-07'), d('2026-09-09'))).toBe(daily)
		expect(reanchoredRule(yearly, d('2026-09-07'), d('2026-09-09'))).toBe(yearly)
	})
})
