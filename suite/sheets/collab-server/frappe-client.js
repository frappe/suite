// Thin wrapper around the three Frappe endpoints that back collab:
//
//   * checkAccess(credentials, sheet)
//                                — POST /api/method/suite.sheets.collab.check_collab_access
//                                forwarding the user's session cookie and any
//                                link credentials the browser presented
//   * loadState(sheet)         — GET-equivalent for the persisted Y.Doc binary
//   * persistState(sheet, b64) — debounced write of the Y.Doc binary
//
// The first call uses cookie auth (so it inherits the user's permissions) plus
// the `X-Drive-Links` header Drive reads link grants from; the last two use the
// shared secret in the X-Collab-Secret header. The secret never travels on the
// access call: that call must carry exactly the caller's own authority and
// nothing of the server's.
//
// We deliberately *don't* retry — the caller (Hocuspocus) treats a failed
// auth check as a connection refusal, and a failed persist is fine to drop
// (the next debounce window will write the latest state again).

import { config } from './env.js'

async function call(method, params = {}, { headers = {} } = {}) {
	const url = `${config.frappeBaseUrl}/api/method/${method}`
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(params),
	})
	if (!res.ok) {
		const body = await res.text().catch(() => '')
		throw new Error(
			`collab-server: ${method} → ${res.status} ${body.slice(0, 200)}`,
		)
	}
	const json = await res.json()
	return json.message
}

// `credentials` is a parsed connection token: { sid, links }. A caller may
// present either — a signed-in user has a sid, a link holder may have only a
// link — but never neither, which `parseToken` already refuses.
export async function checkAccess(credentials, sheetName) {
	const { sid = '', links = [] } = credentials || {}
	if (!sid && links.length === 0) throw new Error('checkAccess: no credentials')
	const headers = {}
	if (sid) headers.Cookie = `sid=${sid}`
	// One comma-separated list, the grammar
	// `suite.drive._core.principals.parse_link_header` reads. It is the one
	// place the 20-item limit is enforced, so an over-long list is refused
	// there and this call fails with its message.
	if (links.length) headers['X-Drive-Links'] = links.join(',')
	return call('suite.sheets.collab.check_collab_access', { name: sheetName }, { headers })
}

export async function loadState(sheetName) {
	return call(
		'suite.sheets.collab.load_collab_state',
		{ name: sheetName },
		{ headers: { 'X-Collab-Secret': config.collabSecret } },
	)
}

export async function persistState(sheetName, ydocStateB64, byteSize) {
	return call(
		'suite.sheets.collab.persist_collab_state',
		{ name: sheetName, ydoc_state: ydocStateB64, byte_size: byteSize },
		{ headers: { 'X-Collab-Secret': config.collabSecret } },
	)
}
