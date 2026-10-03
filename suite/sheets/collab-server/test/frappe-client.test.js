// Tests for the Frappe HTTP wrapper. We stub global `fetch` and assert
// what each helper sends — URL, headers, body — and how it handles errors.
//
// Env vars are seeded before importing the module under test because
// `env.js` validates them at import time.

process.env.FRAPPE_BASE_URL ||= 'http://localhost:8000/'
process.env.COLLAB_SERVER_SECRET ||= 'test-secret'

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const { checkAccess, loadState, persistState } = await import('../frappe-client.js')

function stubFetch(responder) {
	const calls = []
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init })
		return responder({ url, init })
	}
	return calls
}

function jsonOk(body) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('checkAccess', () => {
	beforeEach(() => { delete globalThis.fetch })

	it('forwards sid as a Cookie header and returns the unwrapped message', async () => {
		const calls = stubFetch(() => jsonOk({ message: { canRead: true, canWrite: true } }))
		const out = await checkAccess({ sid: 'SID-XYZ', links: [] }, 'SH-1')

		assert.equal(out.canRead, true)
		assert.equal(out.canWrite, true)
		assert.equal(calls.length, 1)
		assert.equal(
			calls[0].url,
			'http://localhost:8000/api/method/suite.sheets.collab.check_collab_access',
		)
		assert.equal(calls[0].init.headers.Cookie, 'sid=SID-XYZ')
		// No shared secret on the user-auth call: it must carry the caller's
		// own authority and nothing of the server's.
		assert.equal(calls[0].init.headers['X-Collab-Secret'], undefined)
		// No link header when the caller presented no link.
		assert.equal(calls[0].init.headers['X-Drive-Links'], undefined)
		assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'SH-1' })
	})

	it('forwards link credentials as one comma-separated X-Drive-Links header', async () => {
		const calls = stubFetch(() => jsonOk({ message: { canRead: true, canWrite: false } }))
		await checkAccess({ sid: 'SID', links: ['aaa', 'bbb.9.cc'] }, 'SH-1')

		assert.equal(calls[0].init.headers['X-Drive-Links'], 'aaa,bbb.9.cc')
	})

	it('sends the link header with no cookie for a Guest holding only a link', async () => {
		const calls = stubFetch(() => jsonOk({ message: { canRead: true, canWrite: false } }))
		await checkAccess({ sid: '', links: ['aaa'] }, 'SH-1')

		assert.equal(calls[0].init.headers.Cookie, undefined)
		assert.equal(calls[0].init.headers['X-Drive-Links'], 'aaa')
	})

	it('refuses to call with no credentials at all (a silent guest hit)', async () => {
		await assert.rejects(() => checkAccess({ sid: '', links: [] }, 'SH-1'), /no credentials/)
		await assert.rejects(() => checkAccess(undefined, 'SH-1'), /no credentials/)
	})

	it('throws a helpful error on non-2xx, which is how the 20-link refusal arrives', async () => {
		stubFetch(() => new Response('X-Drive-Links accepts at most 20 items', { status: 417 }))
		await assert.rejects(
			() => checkAccess({ sid: 'SID', links: [] }, 'SH-1'),
			/417 X-Drive-Links accepts at most 20 items/,
		)
	})
})

describe('loadState / persistState', () => {
	beforeEach(() => { delete globalThis.fetch })

	it('loadState sends the shared secret header and never a cookie', async () => {
		const calls = stubFetch(() =>
			jsonOk({ message: { sheet: 'SH-1', ydoc_state: null, byte_size: 0 } }))
		const out = await loadState('SH-1')

		assert.equal(out.ydoc_state, null)
		assert.equal(calls[0].init.headers['X-Collab-Secret'], 'test-secret')
		assert.equal(calls[0].init.headers.Cookie, undefined)
	})

	it('persistState posts the base64 blob + byte size', async () => {
		const calls = stubFetch(() => jsonOk({ message: { sheet: 'SH-1', byte_size: 42 } }))
		await persistState('SH-1', 'AAAA', 42)

		assert.equal(calls[0].init.headers['X-Collab-Secret'], 'test-secret')
		assert.deepEqual(JSON.parse(calls[0].init.body), {
			name: 'SH-1', ydoc_state: 'AAAA', byte_size: 42,
		})
	})
})
