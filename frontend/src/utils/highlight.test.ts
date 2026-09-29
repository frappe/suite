import { describe, expect, it } from 'vitest'

import { highlightSegments } from './highlight'

describe('highlightSegments', () => {
	it('marks each word of the term, ignoring case', () => {
		expect(highlightSegments('Board Meeting: the board', 'board meeting')).toEqual([
			{ text: 'Board', hit: true },
			{ text: ' ', hit: false },
			{ text: 'Meeting', hit: true },
			{ text: ': the ', hit: false },
			{ text: 'board', hit: true },
		])
	})

	it('leaves the text whole when the term has no words', () => {
		expect(highlightSegments('Holi party', '  ')).toEqual([{ text: 'Holi party', hit: false }])
		expect(highlightSegments('', 'holi')).toEqual([])
	})

	it('takes the longer word where a shorter one is inside it', () => {
		expect(highlightSegments('meeting', 'meet meeting')).toEqual([{ text: 'meeting', hit: true }])
	})

	it('reads regex characters in the term as characters', () => {
		expect(highlightSegments('Q3 (draft)', '(draft)')).toEqual([
			{ text: 'Q3 ', hit: false },
			{ text: '(draft)', hit: true },
		])
	})
})
