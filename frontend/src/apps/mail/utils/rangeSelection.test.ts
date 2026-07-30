import { describe, expect, it } from 'vitest'

import { rangeSelection } from './rangeSelection'

const order = ['t1', 't2', 't3', 't4', 't5']

describe('rangeSelection', () => {
	it('spans both ends of the range', () => {
		expect(rangeSelection(order, ['t2'], ['t4'])).toEqual(['t2', 't3', 't4'])
	})

	it('reads the same in either direction', () => {
		expect(rangeSelection(order, ['t4'], ['t2'])).toEqual(['t2', 't3', 't4'])
	})

	// The bug: walking up then back down used to drop two rows per step, because each step toggled the
	// row it left as well as the row it entered. Recomputing from the anchor gives back exactly one.
	it('gives back one row per step when the cursor walks back', () => {
		const anchor = ['t4']
		expect(rangeSelection(order, anchor, ['t3'])).toEqual(['t3', 't4'])
		expect(rangeSelection(order, anchor, ['t2'])).toEqual(['t2', 't3', 't4'])
		expect(rangeSelection(order, anchor, ['t3'])).toEqual(['t3', 't4'])
		expect(rangeSelection(order, anchor, ['t4'])).toEqual(['t4'])
	})

	it('takes the whole run an end stands for', () => {
		expect(rangeSelection(order, ['t3', 't4', 't5'], ['t2'])).toEqual(['t2', 't3', 't4', 't5'])
	})

	it('keeps what was already selected when the range began', () => {
		expect(rangeSelection(order, ['t4'], ['t3'], ['t1'])).toEqual(['t1', 't3', 't4'])
		// ...including rows inside the range, which shrinking must not clear.
		expect(rangeSelection(order, ['t4'], ['t4'], ['t3'])).toEqual(['t3', 't4'])
	})

	it('ignores an end that is no longer loaded', () => {
		expect(rangeSelection(order, ['gone'], ['t2'])).toEqual(['t2'])
		expect(rangeSelection(order, ['gone'], ['also-gone'], ['t1'])).toEqual(['t1'])
	})
})
