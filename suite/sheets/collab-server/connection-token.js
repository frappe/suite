// The one thing a browser tells the collab server about itself.
//
// A websocket has no cookie jar we can trust and no headers of its own, so
// every credential arrives inside the y-provider's `token` option. Two shapes
// are accepted:
//
//   "SID-VALUE"                        a bare Frappe session id (pre-Drive)
//   {"sid":"...","links":["ab..","..."]}  a session id and/or link credentials,
//                                       JSON-encoded
//
// The bare form is kept because an already-open tab keeps sending it across a
// deploy. Both shapes end in the same `{ sid, links }`.
//
// A link credential is opaque here. Its grammar, its proof, and its 20-item
// limit belong to `suite.drive._core.principals.parse_link_header`, which is
// the one place Drive enforces them (§6.7). This module only refuses what it
// must refuse before it can forward anything: a token it cannot parse, and a
// list so long that building the header would be the attack.
//
// Nothing here names the connected person. Identity comes back from Frappe,
// which decides it from the session — a link proves a capability, never an
// identity.

// The same number `suite.drive._core.principals.LINK_HEADER_LIMIT` enforces.
// Frappe is the authority and refuses a 21st item itself; refusing here as
// well only saves a round trip on an obviously bad token, and the two cannot
// drift apart without this comment being wrong.
export const LINK_LIMIT = 20

export class InvalidToken extends Error {}

export function parseToken(token) {
	if (typeof token !== 'string' || !token.trim()) {
		throw new InvalidToken('Missing auth token')
	}
	// Only a `{`-prefixed token is read as JSON. Anything else is a bare sid,
	// including a string that happens to be valid JSON of another type.
	const raw = token.trim()
	const parsed = raw.startsWith('{') ? asJson(raw) : { sid: raw }

	const sid = typeof parsed.sid === 'string' ? parsed.sid.trim() : ''
	const links = asLinks(parsed.links)
	if (!sid && links.length === 0) {
		// Neither a session nor a link is not an anonymous caller: it is a
		// caller with nothing to check. Frappe would answer Guest-with-no-grant
		// for it, so refuse before the round trip.
		throw new InvalidToken('Auth token carries neither a session nor a link')
	}
	return { sid, links }
}

// The value of the `X-Drive-Links` header for one parsed token, or '' when the
// caller presented no link. The grammar is one comma-separated list
// (§6.7) and Frappe parses it back.
export function linkHeader({ links }) {
	return links.join(',')
}

// `JSON.parse` of a `{`-prefixed string is an object or an error, never a
// scalar, so parsing is the whole check.
function asJson(raw) {
	try {
		return JSON.parse(raw)
	} catch {
		throw new InvalidToken('Auth token is not valid JSON')
	}
}

function asLinks(value) {
	if (value === undefined || value === null) return []
	if (!Array.isArray(value)) throw new InvalidToken('Auth token links must be an array')
	if (value.length > LINK_LIMIT) {
		throw new InvalidToken(`Auth token carries more than ${LINK_LIMIT} link credentials`)
	}
	const links = []
	for (const item of value) {
		if (typeof item !== 'string') throw new InvalidToken('Auth token links must be strings')
		const trimmed = item.trim()
		// A comma would forge a second item inside the header Frappe parses.
		if (trimmed.includes(',')) throw new InvalidToken('A link credential cannot contain a comma')
		if (trimmed) links.push(trimmed)
	}
	return links
}
