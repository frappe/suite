// The binding, driven end to end against the installed `@hocuspocus/server`.
//
// `access-recheck.test.js` covers the policy with everything injected.
// `hocuspocus-contract.test.js` pins what the library does. This file is the
// join: a real `Hocuspocus`, a real `Connection`, the real hooks from
// `hooks.js`, a fake Frappe, and a fake clock. Every §6.7 outcome — downgrade,
// upgrade, revoke, expiry, an unreachable Frappe — is asserted on the document
// and on the socket, not on a spy.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createHooks, closeConnection, REVOKED } from '../hooks.js'
import { openConnection, settle, updateMessage } from './support/hocuspocus.js'

// A scheduler a test steps by hand, so a five-minute cadence costs nothing.
function fakeTimers() {
	let now = 0
	let nextId = 1
	const pending = new Map()
	return {
		pendingCount: () => pending.size,
		setTimeout(fn, delay) {
			const id = nextId++
			pending.set(id, { fn, due: now + delay })
			return id
		},
		clearTimeout(id) {
			pending.delete(id)
		},
		// Run the single next due callback and await whatever it started.
		async advance() {
			let soonest = null
			for (const [id, entry] of pending) {
				if (soonest === null || entry.due < pending.get(soonest).due) soonest = id
			}
			if (soonest === null) return false
			const entry = pending.get(soonest)
			pending.delete(soonest)
			now = entry.due
			await entry.fn()
			await settle()
			return true
		},
		dueIn: () => (pending.size ? [...pending.values()][0].due - now : null),
	}
}

const WRITER = {
	canRead: true,
	canWrite: true,
	user: 'editor@example.com',
	isGuest: false,
	fullName: 'An Editor',
	initials: 'AE',
	userImage: null,
	recheckSeconds: 300,
}
const READER = { ...WRITER, canWrite: false }
const GUEST = {
	canRead: true,
	canWrite: false,
	user: 'Guest',
	isGuest: true,
	fullName: 'Guest',
	initials: 'G',
	userImage: null,
	recheckSeconds: 300,
}

// A Frappe that answers from a queue. The last answer repeats, so a test only
// states the answers it cares about.
function frappe(...answers) {
	const calls = []
	let index = 0
	const check = async (credentials, documentName) => {
		calls.push({ credentials, documentName })
		const answer = answers[Math.min(index, answers.length - 1)]
		index += 1
		if (answer instanceof Error) throw answer
		return answer
	}
	return { check, calls }
}

// Opens one authenticated connection through the real hooks.
async function session({ answers = [WRITER], token = 'a-session-id', close } = {}) {
	const timers = fakeTimers()
	const backend = frappe(...answers)
	const logged = []
	const hooks = createHooks({
		check: backend.check,
		timers,
		close,
		newConnectionId: () => 'fixed-connection-id',
		log: { log: (line) => logged.push(line) },
	})
	const opened = await openConnection({ hooks, token })
	return { ...opened, timers, backend, logged, hooks }
}

describe('onAuthenticate', () => {
	it('lets a writer through read-write and starts the recheck', async () => {
		const run = await session()
		try {
			assert.equal(run.connection.readOnly, false)
			await run.send('an editor types')
			assert.equal(run.text(), 'an editor types')
			assert.equal(run.timers.pendingCount(), 1)
			// The cadence Frappe stated, not a local default.
			assert.equal(run.timers.dueIn(), 300_000)
		} finally {
			run.teardown()
		}
	})

	it('connects a READ or COMMENT caller read-only', async () => {
		const run = await session({ answers: [READER] })
		try {
			assert.equal(run.connection.readOnly, true)
			await run.send('a reader types')
			assert.equal(run.text(), '')
			// Still connected: they receive updates and publish awareness.
			assert.equal(run.document.hasConnection(run.connection), true)
		} finally {
			run.teardown()
		}
	})

	it('refuses a caller below READ, so no connection is ever built', async () => {
		const run = await session({ answers: [{ canRead: false, reason: 'no grant' }] })
		try {
			assert.equal(run.connection, undefined)
			assert.equal(run.payloads.connected, undefined)
			// Nothing scheduled for a connection that does not exist.
			assert.equal(run.timers.pendingCount(), 0)
		} finally {
			run.teardown()
		}
	})

	it('keeps the caller\'s sid out of the connection context', async () => {
		// The context reaches every extension and every later hook. The `sid`
		// is the caller's whole session, so only a bound call travels.
		const run = await session({ token: '{"sid":"a-real-session","links":["l1"]}' })
		try {
			const context = run.payloads.connected.context
			assert.equal(typeof context.askAgain, 'function')
			assert.equal(JSON.stringify(context).includes('a-real-session'), false)
			assert.equal(JSON.stringify(context).includes('l1'), false)
		} finally {
			run.teardown()
		}
	})

	it('gives a Guest a server-controlled identity and connection id', async () => {
		const run = await session({ answers: [GUEST], token: '{"links":["abc"]}' })
		try {
			const context = run.payloads.connected.context
			assert.equal(context.user, 'Guest')
			assert.equal(context.isGuest, true)
			assert.equal(context.connectionId, 'fixed-connection-id')
			// The token named no user; Frappe's answer did.
			assert.deepEqual(run.backend.calls[0].credentials, { sid: '', links: ['abc'] })
		} finally {
			run.teardown()
		}
	})

	it('refuses the connection when the payload carries no connectionConfig', async () => {
		// A hocuspocus that stopped handing this hook a `connectionConfig`
		// would leave every caller read-write. Fail closed instead.
		const hooks = createHooks({ check: async () => READER })
		await assert.rejects(
			() => hooks.onAuthenticate({ token: 'sid', documentName: 'sheet-1' }),
			/does not match this binding/,
		)
	})

	it('refuses a token carrying neither a session nor a link, before any call', async () => {
		const backend = frappe(WRITER)
		const hooks = createHooks({ check: backend.check })
		await assert.rejects(
			() => hooks.onAuthenticate({ token: '{"links":[]}', documentName: 'sheet-1', connectionConfig: {} }),
			/neither a session nor a link/,
		)
		assert.equal(backend.calls.length, 0)
	})
})

describe('the recheck applied to a live connection (§6.7)', () => {
	it('turns an open connection read-only on a downgrade across the EDIT line', async () => {
		const run = await session({ answers: [WRITER, READER] })
		try {
			await run.send('written while EDIT')
			assert.equal(run.text(), 'written while EDIT')

			await run.timers.advance()

			assert.equal(run.connection.readOnly, true)
			await run.send('BLOCKED')
			assert.equal(run.text(), 'written while EDIT')
			// Downgraded, not disconnected: they still read.
			assert.equal(run.document.hasConnection(run.connection), true)
			assert.equal(run.socket.closed, null)
			assert.ok(run.logged.some((line) => line.includes('write=false')))
		} finally {
			run.teardown()
		}
	})

	it('releases writes again on an upgrade', async () => {
		const run = await session({ answers: [READER, WRITER] })
		try {
			assert.equal(run.connection.readOnly, true)
			await run.timers.advance()
			assert.equal(run.connection.readOnly, false)

			await run.send('writes again')
			assert.equal(run.text(), 'writes again')
		} finally {
			run.teardown()
		}
	})

	it('disconnects a revoked grant: read-only, detached, and socket closed', async () => {
		const run = await session({ answers: [WRITER, { canRead: false, reason: 'grant revoked' }] })
		try {
			await run.send('written while EDIT')
			await run.timers.advance()

			assert.equal(run.connection.readOnly, true)
			assert.equal(run.document.hasConnection(run.connection), false)
			assert.equal(run.document.getConnectionsCount(), 0)
			assert.deepEqual(run.socket.closed, { code: REVOKED.code, reason: 'grant revoked' })
			assert.equal(run.socket.readyState, 3)

			// Nothing this caller sends after the revoke reaches the document.
			run.client.handleMessage(updateMessage('sheet-1', 'AFTER REVOKE'))
			await settle()
			assert.equal(run.text(), 'written while EDIT')
			assert.ok(run.logged.some((line) => line.includes('closing (grant revoked)')))
		} finally {
			run.teardown()
		}
	})

	it('disconnects an expired link the same way', async () => {
		const run = await session({
			answers: [GUEST, { canRead: false, reason: 'link expired' }],
		})
		try {
			await run.timers.advance()
			assert.equal(run.document.hasConnection(run.connection), false)
			assert.deepEqual(run.socket.closed, { code: REVOKED.code, reason: 'link expired' })
			assert.ok(run.logged.some((line) => line.includes('link expired')))
		} finally {
			run.teardown()
		}
	})

	it('rechecks with the credentials the connection opened with', async () => {
		const run = await session({ answers: [WRITER], token: '{"sid":"s1","links":["l1","l2"]}' })
		try {
			await run.timers.advance()
			assert.equal(run.backend.calls.length, 2)
			for (const call of run.backend.calls) {
				assert.deepEqual(call.credentials, { sid: 's1', links: ['l1', 'l2'] })
				assert.equal(call.documentName, 'sheet-1')
			}
		} finally {
			run.teardown()
		}
	})

	it('holds the connection through a blip and closes it after three failures', async () => {
		const run = await session({ answers: [WRITER, new Error('ECONNREFUSED')] })
		try {
			await run.timers.advance()
			assert.equal(run.document.hasConnection(run.connection), true)
			await run.timers.advance()
			assert.equal(run.document.hasConnection(run.connection), true)

			await run.timers.advance()
			assert.equal(run.document.hasConnection(run.connection), false)
			assert.deepEqual(run.socket.closed, { code: REVOKED.code, reason: 'unreachable' })
		} finally {
			run.teardown()
		}
	})
})

describe('timer cleanup', () => {
	it('stops the recheck when the socket drops, with no hook of ours involved', async () => {
		const run = await session()
		assert.equal(run.timers.pendingCount(), 1)

		// The browser closes the tab.
		run.teardown()
		await settle()

		assert.equal(run.timers.pendingCount(), 0)
		assert.equal(run.payloads.connected.context.recheck.stopped, true)
	})

	it('stops the recheck when a revoke closes the connection', async () => {
		const run = await session({ answers: [WRITER, { canRead: false, reason: 'grant revoked' }] })
		try {
			await run.timers.advance()
			assert.equal(run.timers.pendingCount(), 0)
			assert.equal(run.payloads.connected.context.recheck.stopped, true)
		} finally {
			run.teardown()
		}
	})

	it('stops the recheck even if the context object was replaced mid-session', async () => {
		// `onTokenSync` re-spreads the context, which would orphan a watcher
		// held only there. The connection's own onClose callback is what makes
		// this safe.
		const run = await session()
		const recheck = run.payloads.connected.context.recheck
		run.connection.context = { ...run.connection.context, recheck: null }

		run.teardown()
		await settle()

		assert.equal(recheck.stopped, true)
		assert.equal(run.timers.pendingCount(), 0)
	})

	it('onDisconnect stops a watcher on its own', async () => {
		const run = await session()
		try {
			const context = run.payloads.connected.context
			await run.hooks.onDisconnect({ context })
			assert.equal(context.recheck.stopped, true)
			assert.equal(run.timers.pendingCount(), 0)
		} finally {
			run.teardown()
		}
	})

	it('onDisconnect tolerates a context with no watcher', async () => {
		const hooks = createHooks({ check: async () => WRITER })
		await hooks.onDisconnect({ context: undefined })
		await hooks.onDisconnect({ context: {} })
	})

	it('connected does nothing when there is no connection to bind to', async () => {
		const timers = fakeTimers()
		const hooks = createHooks({ check: async () => WRITER, timers })
		await hooks.connected({ documentName: 'sheet-1', context: { askAgain: async () => WRITER } })
		await hooks.connected({ documentName: 'sheet-1', connection: {} })
		// A context from some other hook, with no bound recheck on it.
		await hooks.connected({ documentName: 'sheet-1', context: {}, connection: {} })
		assert.equal(timers.pendingCount(), 0)
	})
})

describe('closeConnection', () => {
	it('reports true and closes both the connection and the socket', async () => {
		const run = await session()
		try {
			assert.equal(closeConnection(run.connection, 'grant revoked'), true)
			assert.equal(run.connection.readOnly, true)
			assert.equal(run.document.hasConnection(run.connection), false)
			assert.deepEqual(run.socket.closed, { code: REVOKED.code, reason: 'grant revoked' })
		} finally {
			run.teardown()
		}
	})

	it('still closes the socket when Connection.close throws', async () => {
		const run = await session()
		try {
			// Once only: `ClientConnection.handleClose` calls `close` on every
			// connection before it clears its ping interval, so a permanently
			// throwing stub would leak that interval out of the test.
			const real = run.connection.close.bind(run.connection)
			run.connection.close = () => {
				run.connection.close = real
				throw new Error('close blew up')
			}
			assert.equal(closeConnection(run.connection, 'grant revoked'), true)
			assert.equal(run.connection.readOnly, true)
			assert.deepEqual(run.socket.closed, { code: REVOKED.code, reason: 'grant revoked' })
		} finally {
			run.teardown()
		}
	})

	it('reports false when the socket cannot be closed, leaving the caller cut off', async () => {
		const run = await session()
		try {
			// A transport with no close: the one state §6.7 does not accept, so
			// it has to be visible rather than silent.
			run.connection.webSocket = { readyState: 1, send() {} }
			assert.equal(closeConnection(run.connection, 'grant revoked'), false)
			assert.equal(run.connection.readOnly, true)
			// Detached even so: no fan-out, no writes.
			assert.equal(run.document.hasConnection(run.connection), false)
		} finally {
			run.teardown()
		}
	})

	it('reports false when the socket close throws', async () => {
		const run = await session()
		try {
			run.connection.webSocket = {
				readyState: 1,
				send() {},
				close() {
					throw new Error('socket close blew up')
				},
			}
			assert.equal(closeConnection(run.connection, 'grant revoked'), false)
			assert.equal(run.document.hasConnection(run.connection), false)
		} finally {
			run.teardown()
		}
	})

	it('reports false for no connection at all', () => {
		assert.equal(closeConnection(undefined), false)
		assert.equal(closeConnection(null), false)
	})

	it('is what a revoke uses, so an injected close is what runs', async () => {
		const seen = []
		const run = await session({
			answers: [WRITER, { canRead: false, reason: 'grant revoked' }],
			close: (connection, reason) => seen.push(reason),
		})
		try {
			await run.timers.advance()
			assert.deepEqual(seen, ['grant revoked'])
		} finally {
			run.teardown()
		}
	})
})
