import { describe, expect, it } from 'vitest'

import { neighbourAfterRemoval } from './listNavigation'

const rows = ['a', 'b', 'c', 'd']
const leaving =
	(...gone: string[]) =>
	(id: string) =>
		!gone.includes(id)

describe('neighbourAfterRemoval', () => {
	it('takes the next one down', () => {
		expect(neighbourAfterRemoval(rows, 1, leaving('b'))).toBe('c')
	})

	it('turns around at the end of the list', () => {
		// The bottom-up triage pass: every verdict is on the last row, and there is never
		// anything below it to advance to.
		expect(neighbourAfterRemoval(rows, 3, leaving('d'))).toBe('c')
	})

	it('skips the others leaving in the same action, in both directions', () => {
		expect(neighbourAfterRemoval(rows, 1, leaving('b', 'c'))).toBe('d')
		expect(neighbourAfterRemoval(rows, 3, leaving('c', 'd'))).toBe('b')
	})

	it('has nothing to hand back when the whole list is going', () => {
		expect(neighbourAfterRemoval(rows, 2, leaving(...rows))).toBeUndefined()
		expect(neighbourAfterRemoval([], 0, leaving())).toBeUndefined()
	})

	it('searches the whole list forwards when the item is no longer in it', () => {
		expect(neighbourAfterRemoval(rows, -1, leaving())).toBe('a')
	})
})
