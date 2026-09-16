// Tests for the one thing a browser tells the collab server about itself.
// Pure parsing, no network and no hocuspocus.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
	LINK_LIMIT,
	MAX_LINK_LENGTH,
	MAX_SID_LENGTH,
	InvalidToken,
	linkHeader,
	parseToken,
} from '../connection-token.js'

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

// ── Adversarial: what the header must never carry ────────────────────────────
//
// The parsed links become one `X-Drive-Links` header value and the sid becomes
// a `Cookie` header. Anything that can end a header line or start a second one
// is a forged request. Anything unbounded is a header this process builds
// before Frappe can refuse it.

describe('parseToken refuses a forged header', () => {
	// Embedded, not trailing: `trim()` already removes a trailing CR or LF, so
	// that one is a clean credential by the time the check sees it. The forgery
	// is a control character with a payload behind it.
	const FORGERIES = [
		['a CR', `${LINK}\rX-Collab-Secret: stolen`],
		['an LF', `${LINK}\nX-Collab-Secret: stolen`],
		['a CRLF pair', `${LINK}\r\nX-Collab-Secret: stolen`],
		['a NUL', `${LINK}\u0000${LINK}`],
		['a DEL', `${LINK}\u007f${LINK}`],
		['a bare tab', `${LINK}\tX-Collab-Secret: stolen`],
	]
	for (const [label, bad] of FORGERIES) {
		it(`refuses ${label} in a link credential`, () => {
			assert.throws(
				() => parseToken(JSON.stringify({ sid: 'SID-XYZ', links: [bad] })),
				/control character/,
			)
		})
	}

	it('refuses a link credential longer than the grammar allows', () => {
		const long = 'a'.repeat(MAX_LINK_LENGTH + 1)
		assert.throws(
			() => parseToken(JSON.stringify({ links: [long] })),
			/longer than the grammar allows/,
		)
	})

	it('accepts one exactly at the bound, so the check is not off by one', () => {
		const edge = 'a'.repeat(MAX_LINK_LENGTH)
		assert.deepEqual(parseToken(JSON.stringify({ links: [edge] })), { sid: '', links: [edge] })
	})

	it('refuses a session id carrying a control character', () => {
		assert.throws(
			() => parseToken(JSON.stringify({ sid: 'SID\r\nCookie: other', links: [] })),
			/not a session id/,
		)
	})

	it('refuses a session id longer than any session id', () => {
		assert.throws(
			() => parseToken(JSON.stringify({ sid: 'a'.repeat(MAX_SID_LENGTH + 1) })),
			/not a session id/,
		)
	})

	it('refuses a bare sid carrying a control character too', () => {
		// Not `{`-prefixed, so it takes the bare-sid arm — which has to be
		// checked the same way, because it becomes the same Cookie header.
		assert.throws(() => parseToken('SID\r\nX-Collab-Secret: stolen'), /not a session id/)
	})

	it('still refuses a 21st credential, the limit Frappe enforces', () => {
		const links = Array.from({ length: LINK_LIMIT + 1 }, () => LINK)
		assert.throws(() => parseToken(JSON.stringify({ links })), /more than 20/)
	})

	it('trims a trailing CR rather than refusing it', () => {
		// It cannot forge anything: the credential that reaches the header has
		// already lost it. Refusing here would drop a legitimate caller over
		// whitespace.
		assert.deepEqual(parseToken(JSON.stringify({ links: [`${LINK}\r\n`] })), {
			sid: '',
			links: [LINK],
		})
	})

	it('builds a header with nothing in it that could split a line', () => {
		const token = JSON.stringify({
			sid: 'SID-XYZ',
			links: [LINK, `${LINK}.99.${'a'.repeat(64)}`],
		})
		assert.equal(/[\u0000-\u001f\u007f]/.test(linkHeader(parseToken(token))), false)
	})
})
