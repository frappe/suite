import { describe, expect, it } from 'vitest'

import { groupPlainText, splitPlainText } from '@/apps/mail/utils/plainTextBlocks'

const kinds = (text: string) => splitPlainText(text).map((block) => `${block.kind}:${block.depth}`)

describe('quote levels', () => {
	it('separates a reply from what it quotes', () => {
		expect(kinds('Agreed.\n\n> Ship Friday?')).toEqual(['body:0', 'quote:1'])
	})

	it('reads nesting depth', () => {
		expect(kinds('>> deep')).toEqual(['quote:2'])
	})

	it('treats spaced markers as the same nesting', () => {
		expect(kinds('> > spaced')).toEqual(['quote:2'])
	})

	it('strips the markers so the text renders as prose', () => {
		expect(splitPlainText('> Ship Friday?')[0].text).toBe('Ship Friday?')
	})

	it('keeps consecutive lines of one depth together', () => {
		const blocks = splitPlainText('> one\n> two')
		expect(blocks).toHaveLength(1)
		expect(blocks[0].text).toBe('one\ntwo')
	})

	it('splits when the depth changes', () => {
		expect(kinds('> outer\n>> inner\n> outer again')).toEqual(['quote:1', 'quote:2', 'quote:1'])
	})

	it('keeps blank lines inside a quote', () => {
		expect(splitPlainText('> one\n>\n> two')[0].text).toBe('one\n\ntwo')
	})

	it('drops the blank line between body and quote', () => {
		// It is the gap around the quote, not something anyone wrote.
		expect(kinds('Agreed.\n\n\n> Ship Friday?')).toEqual(['body:0', 'quote:1'])
	})
})

describe('signature', () => {
	it('starts at the separator', () => {
		expect(kinds('Bye\n-- \nAlex')).toEqual(['body:0', 'signature:0'])
	})

	it('accepts the separator without its trailing space', () => {
		// RFC 3676 wants "-- ", but clients trim it often enough to matter.
		expect(kinds('Bye\n--\nAlex')).toEqual(['body:0', 'signature:0'])
	})

	it('takes the last separator, so a typed dash does not swallow the real one', () => {
		const blocks = splitPlainText('Bye\n--\nstill body\n-- \nAlex')
		expect(blocks.map((b) => b.kind)).toEqual(['body', 'signature'])
		expect(blocks[1].text).toBe('-- \nAlex')
	})

	it('ignores a quoted separator, which belongs to the message being quoted', () => {
		expect(kinds('Agreed.\n\n> Bye\n> -- \n> Jane')).toEqual(['body:0', 'quote:1'])
	})

	it('runs to the end even over blank lines', () => {
		expect(kinds('Bye\n-- \nAlex\n\nSupport')).toEqual(['body:0', 'signature:0'])
	})
})

describe('plain bodies', () => {
	it('returns nothing for empty text', () => {
		expect(splitPlainText('')).toEqual([])
	})

	it('leaves an unstructured body as one block', () => {
		expect(kinds('Just a note.\nNothing special.')).toEqual(['body:0'])
	})

	it('does not mistake a greater-than in prose for a quote', () => {
		// The marker has to open the line; "a > b" mid-sentence is arithmetic.
		expect(kinds('2 > 1 is true')).toEqual(['body:0'])
	})

	it('normalises CRLF', () => {
		expect(kinds('Agreed.\r\n\r\n> Ship Friday?')).toEqual(['body:0', 'quote:1'])
	})
})

describe('grouping for the reader', () => {
	const shape = (text: string) =>
		groupPlainText(text).map((s) => `${s.kind}(${s.blocks.map((b) => b.depth).join(',')})`)

	it('folds a whole trail into one segment whatever its depths', () => {
		// One control for the trail, not one per level.
		expect(shape('Agreed.\n\n> one\n>> two\n> three')).toEqual(['body(0)', 'quote(1,2,1)'])
	})

	it('keeps body, trail and signature apart', () => {
		expect(shape('Agreed.\n\n> Ship Friday?\n\n-- \nAlex')).toEqual([
			'body(0)',
			'quote(1)',
			'signature(0)',
		])
	})

	it('starts a new segment when body interrupts a trail', () => {
		expect(shape('> one\ninline reply\n> two')).toEqual(['quote(1)', 'body(0)', 'quote(1)'])
	})

	it('returns nothing for empty text', () => {
		expect(groupPlainText('')).toEqual([])
	})
})
