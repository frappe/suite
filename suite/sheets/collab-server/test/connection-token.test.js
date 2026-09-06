// Tests for the one thing a browser tells the collab server about itself.
// Pure parsing, no network and no hocuspocus.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { LINK_LIMIT, InvalidToken, linkHeader, parseToken } from '../connection-token.js'

const LINK = 'abcdefghijklmnopqrstuv'

describe('parseToken', () => {
	it('reads a bare sid, the shape an already-open tab still sends', () => {
		assert.deepEqual(parseToken('SID-XYZ'), { sid: 'SID-XYZ', links: [] })
	})

	it('reads a sid and link credentials out of the JSON shape', () => {
		const token = JSON.stringify({ sid: 'SID-XYZ', links: [LINK, `${LINK}.99.${'a'.repeat(64)}`] })
		assert.deepEqual(parseToken(token), {
			sid: 'SID-XYZ',
			links: [LINK, `${LINK}.99.${'a'.repeat(64)}`],
		})
	})

	it('accepts a link with no session — that is what a Guest presents', () => {
		const token = JSON.stringify({ links: [LINK] })
		assert.deepEqual(parseToken(token), { sid: '', links: [LINK] })
	})

	it('refuses a token carrying neither a session nor a link', () => {
		assert.throws(() => parseToken(JSON.stringify({ sid: '  ', links: [] })), InvalidToken)
		assert.throws(() => parseToken(''), InvalidToken)
		assert.throws(() => parseToken(undefined), InvalidToken)
	})

	it('refuses malformed JSON rather than guessing at it', () => {
		assert.throws(() => parseToken('{not json'), /not valid JSON/)
		assert.throws(() => parseToken('{"a":'), /not valid JSON/)
	})

	it('reads anything not starting with { as a bare sid', () => {
		assert.deepEqual(parseToken('[]'), { sid: '[]', links: [] })
	})

	it(`refuses more than ${LINK_LIMIT} link credentials`, () => {
		const under = JSON.stringify({ links: Array(LINK_LIMIT).fill(LINK) })
		assert.equal(parseToken(under).links.length, LINK_LIMIT)

		const over = JSON.stringify({ links: Array(LINK_LIMIT + 1).fill(LINK) })
		assert.throws(() => parseToken(over), new RegExp(`more than ${LINK_LIMIT}`))
	})

	it('refuses a comma inside a credential, which would forge a second item', () => {
		const token = JSON.stringify({ links: [`${LINK},${LINK}`] })
		assert.throws(() => parseToken(token), /cannot contain a comma/)
	})

	it('refuses links that are not an array of strings', () => {
		assert.throws(() => parseToken(JSON.stringify({ sid: 'S', links: 'a' })), /must be an array/)
		assert.throws(() => parseToken(JSON.stringify({ sid: 'S', links: [1] })), /must be strings/)
	})

	it('drops empty entries and trims, so a trailing comma costs nothing', () => {
		const token = JSON.stringify({ sid: ' S ', links: [` ${LINK} `, '', '   '] })
		assert.deepEqual(parseToken(token), { sid: 'S', links: [LINK] })
	})
})

describe('linkHeader', () => {
	it('is the comma-separated grammar parse_link_header reads', () => {
		assert.equal(linkHeader({ links: [LINK, 'x'] }), `${LINK},x`)
	})

	it('is empty when the caller presented no link', () => {
		assert.equal(linkHeader({ links: [] }), '')
	})
})
