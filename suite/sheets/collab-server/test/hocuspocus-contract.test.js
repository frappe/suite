// The deploy gate for ticket 19 step 7b, as executable tests.
//
// `hooks.js` binds to four facts about `@hocuspocus/server`. Every one is
// asserted here against the installed package, driven through the real
// `Hocuspocus` class with a fake socket. No network, no listening port, no
// service touched.
//
//   1. `onAuthenticate` is handed no `connection`, only a `connectionConfig`.
//   2. `connected` is handed the live `Connection`.
//   3. `connection.readOnly`, set after connect, blocks the next update.
//   4. `connection.close()` exists, detaches the connection from the document,
//      and does NOT end the websocket. `disconnect` and `terminate` do not
//      exist, so the socket has to be closed through `connection.webSocket`.
//
// If a dependency bump breaks one of these, this file fails and `hooks.js`
// has to be re-read against the new source. That is the point of it.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { Connection } from '@hocuspocus/server'

import { openConnection, settle, updateMessage } from './support/hocuspocus.js'

const installed = JSON.parse(
	readFileSync(new URL('../node_modules/@hocuspocus/server/package.json', import.meta.url)),
)

// Opens a connection whose only hook work is to set the initial capability.
function open(readOnly = false) {
	return openConnection({
		hooks: {
			onAuthenticate: ({ connectionConfig }) => {
				connectionConfig.readOnly = readOnly
				return { marker: 'from-onAuthenticate' }
			},
		},
	})
}

describe('the installed @hocuspocus/server', () => {
	it('is the version hooks.js was written against', () => {
		// Not a pin for its own sake. Every assertion below was read out of
		// this version's `src/`, and the lockfile holds it.
		assert.equal(installed.version, '4.6.0')
	})

	it('never hands onAuthenticate a connection, only a connectionConfig', async () => {
		const session = await open()
		try {
			const payload = session.payloads.onAuthenticate
			// The bug this file exists to catch: `connection` is undefined here,
			// so `connection.readOnly = …` throws and refuses every caller.
			assert.equal('connection' in payload, false)
			assert.equal(payload.connection, undefined)
			assert.deepEqual(Object.keys(payload.connectionConfig).sort(), [
				'isAuthenticated',
				'readOnly',
			])
		} finally {
			session.teardown()
		}
	})

	it('copies connectionConfig.readOnly into the connection it builds', async () => {
		const session = await open(true)
		try {
			assert.equal(session.connection.readOnly, true)
			await session.send('a read-only caller types')
			assert.equal(session.text(), '')
		} finally {
			session.teardown()
		}
	})

	it('hands connected the live Connection and the onAuthenticate context', async () => {
		const session = await open()
		try {
			assert.ok(session.connection instanceof Connection)
			assert.equal(session.payloads.connected.context.marker, 'from-onAuthenticate')
			assert.equal(session.payloads.connected.documentName, 'sheet-1')
		} finally {
			session.teardown()
		}
	})

	it('reads connection.readOnly per message, so a downgrade lands mid-session', async () => {
		const session = await open()
		try {
			await session.send('written')
			assert.equal(session.text(), 'written')

			// The downgrade §6.7 asks for: EDIT drops to READ while the tab is open.
			session.connection.readOnly = true
			await session.send('BLOCKED')
			assert.equal(session.text(), 'written')

			// And the upgrade back, because the answer is Drive's either way.
			session.connection.readOnly = false
			await session.send('again')
			assert.notEqual(session.text(), 'written')
		} finally {
			session.teardown()
		}
	})

	it('exposes close() on the connection, and nothing named disconnect or terminate', async () => {
		const session = await open()
		try {
			assert.equal(typeof session.connection.close, 'function')
			assert.equal(typeof session.connection.disconnect, 'undefined')
			assert.equal(typeof session.connection.terminate, 'undefined')
			// The socket underneath is where the disconnect has to happen.
			assert.equal(typeof session.connection.webSocket.close, 'function')
		} finally {
			session.teardown()
		}
	})

	it('close() detaches the connection: no more fan-out, no more writes', async () => {
		const session = await open()
		try {
			await session.send('written')
			assert.equal(session.document.hasConnection(session.connection), true)

			session.connection.close({ code: 4403, reason: 'Forbidden' })
			await settle()

			assert.equal(session.document.hasConnection(session.connection), false)
			assert.equal(session.document.getConnectionsCount(), 0)
			// The route is gone, so a later frame on the same socket is dropped.
			session.client.handleMessage(updateMessage('sheet-1', 'AFTER CLOSE'))
			await settle()
			assert.equal(session.text(), 'written')
		} finally {
			session.teardown()
		}
	})

	it('close() fires onDisconnect with the same context object', async () => {
		const session = await open()
		try {
			session.connection.close({ code: 4403, reason: 'Forbidden' })
			await settle()
			assert.ok(session.payloads.onDisconnect)
			// `hooks.js` stores the recheck on the context in `connected` and
			// stops it here, which only works while it is one object.
			assert.equal(
				session.payloads.onDisconnect.context,
				session.payloads.connected.context,
			)
		} finally {
			session.teardown()
		}
	})

	it('close() leaves the websocket open — §6.7 needs the socket closed too', async () => {
		const session = await open()
		try {
			session.connection.close({ code: 4403, reason: 'Forbidden' })
			await settle()
			// This is why `closeConnection` does not stop at `Connection.close`.
			assert.equal(session.socket.closed, null)
			assert.equal(session.socket.readyState, 1)

			session.connection.webSocket.close(4403, 'Forbidden')
			assert.deepEqual(session.socket.closed, { code: 4403, reason: 'Forbidden' })
		} finally {
			session.teardown()
		}
	})
})
