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
		const options = scopeOptions()

		expect(values(options)).toEqual(['instance', 'following', 'series'])
		expect(options.every((option) => !option.disabled)).toBe(true)
	})

	it('drops "this and following" at the head of a series', () => {
		// There it reaches exactly what "all events" reaches, and a list does not ask the same
		// question twice.
		expect(values(scopeOptions({ isFirst: true }))).toEqual(['instance', 'series'])
	})

	it('greys out an answer the action cannot carry, rather than hiding it', () => {
		const options = scopeOptions({ unavailable: ['following'] })
		const following = options[1]

		expect(values(options)).toEqual(['instance', 'following', 'series'])
		expect(following.disabled).toBe(true)
		expect(options[0].disabled).toBe(false)
	})

	it('leaves out an unavailable answer that is also redundant', () => {
		// Greying out a row that would say the same thing as the one below it helps no one.
		expect(values(scopeOptions({ unavailable: ['following'], isFirst: true }))).toEqual([
			'instance',
			'series',
		])
	})
})
