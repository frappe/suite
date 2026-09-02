import { beforeAll, describe, expect, it } from 'vitest'

import { isFirstOccurrence, scopeOptions } from './recurringScope'

// The app's translation helper is a global installed at boot; the labels are not what is
// under test here, only which of them the list offers.
beforeAll(() => {
	;(globalThis as any).__ = (text: string) => text
})

const values = (options: ReturnType<typeof scopeOptions>) => options.map((option) => option.value)

describe('isFirstOccurrence', () => {
	it('is true when the occurrence starts where its series does', () => {
		expect(
			isFirstOccurrence({ recurrence_id: '2026-09-07T08:00:00', master_start: '2026-09-07T08:00:00' }),
		).toBe(true)
	})

	it('is false for a later occurrence', () => {
		expect(
			isFirstOccurrence({ recurrence_id: '2026-09-14T08:00:00', master_start: '2026-09-07T08:00:00' }),
		).toBe(false)
	})

	it('is false for a one-off, which has no occurrence to be the first of', () => {
		expect(isFirstOccurrence({ master_start: '2026-09-07T08:00:00' })).toBe(false)
		expect(isFirstOccurrence(undefined)).toBe(false)
	})
})

describe('scopeOptions', () => {
	it('offers all three answers in the middle of a series', () => {
		expect(values(scopeOptions())).toEqual(['instance', 'following', 'series'])
	})

	it('drops "this and following" at the head of a series', () => {
		// There it reaches exactly what "all events" reaches, and a list does not ask the same
		// question twice.
		expect(values(scopeOptions({ isFirst: true }))).toEqual(['instance', 'series'])
	})

	it('keeps a blocked split visible, greyed out and saying why', () => {
		const following = scopeOptions({ splitBlockedReason: 'Only the organizer can split a series' })[1]

		expect(following.disabled).toBe(true)
		expect(following.description).toBe('Only the organizer can split a series')
	})

	it('says nothing under a split that is simply available', () => {
		expect(scopeOptions()[1].disabled).toBe(false)
		expect(scopeOptions()[1].description).toBeUndefined()
	})
})
