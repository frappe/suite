// Tests for the live access recheck (§6.7).
//
// Time is injected, not mocked globally: `fakeTimers` is a tiny scheduler that
// runs the next due callback on demand. So a week of five-minute rechecks costs
// a millisecond, and every assertion is about the policy rather than about
// whether a real timer fired.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
	DEFAULT_RECHECK_MS,
	MAX_CONSECUTIVE_FAILURES,
	startAccessRecheck,
} from '../access-recheck.js'

function fakeTimers() {
	let now = 0
	let nextId = 1
	const pending = new Map()
	return {
		now: () => now,
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
			return true
		},
	}
}

function watcher(overrides = {}) {
	const timers = overrides.timers || fakeTimers()
	const events = { revoked: [], capability: [] }
	const handle = startAccessRecheck({
		check: async () => ({ canRead: true, canWrite: true }),
		onRevoke: (event) => events.revoked.push(event),
		onCapability: (event) => events.capability.push(event),
		canWrite: true,
		timers,
		...overrides,
	})
	return { handle, timers, events }
}

describe('cadence', () => {
	it('asks again five minutes after the connection opened', async () => {
		const asked = []
		const { timers } = watcher({
			check: async () => {
				asked.push('ask')
				return { canRead: true, canWrite: true }
			},
		})

		assert.deepEqual(asked, [], 'the opening check is onAuthenticate, not this')
		await timers.advance()
		assert.equal(timers.now(), DEFAULT_RECHECK_MS)
		assert.deepEqual(asked, ['ask'])

		await timers.advance()
		assert.equal(timers.now(), 2 * DEFAULT_RECHECK_MS)
		assert.equal(asked.length, 2)
	})

	it('is five minutes', () => {
		assert.equal(DEFAULT_RECHECK_MS, 5 * 60 * 1000)
	})

	it("takes the cadence from Frappe's answer so the two cannot drift", async () => {
		const { timers } = watcher({
			check: async () => ({ canRead: true, canWrite: true, recheckSeconds: 60 }),
		})
		await timers.advance()
		await timers.advance()
		assert.equal(timers.now(), DEFAULT_RECHECK_MS + 60 * 1000)
	})

	it('falls back rather than hot-looping on a nonsense cadence', async () => {
		const { timers } = watcher({
			check: async () => ({ canRead: true, canWrite: true, recheckSeconds: 0 }),
		})
		await timers.advance()
		await timers.advance()
		assert.equal(timers.now(), 2 * DEFAULT_RECHECK_MS)
	})

	it('stops asking once the connection is gone', async () => {
		const { handle, timers, events } = watcher()
		handle.stop()
		assert.equal(timers.pendingCount(), 0)
		assert.equal(await timers.advance(), false)
		assert.deepEqual(events.revoked, [])
	})
})

describe('revocation and expiry', () => {
	it('closes the socket when the grant is gone', async () => {
		const { handle, timers, events } = watcher({
			check: async () => ({ canRead: false, canWrite: false, reason: 'DriveNotFound' }),
		})
		await timers.advance()

		assert.deepEqual(events.revoked, [{ reason: 'DriveNotFound', error: undefined }])
		assert.equal(handle.stopped, true)
		assert.equal(timers.pendingCount(), 0, 'a closed connection asks nothing further')
	})

	it('closes the socket when the link behind it expired, and says so', async () => {
		const { events, timers } = watcher({
			check: async () => ({ canRead: false, canWrite: false, reason: 'DriveLinkExpired' }),
		})
		await timers.advance()
		assert.equal(events.revoked[0].reason, 'DriveLinkExpired')
	})

	it('survives a grant that is revoked only after several good rechecks', async () => {
		let answers = 0
		const { events, timers } = watcher({
			check: async () => {
				answers += 1
				return answers < 4
					? { canRead: true, canWrite: true }
					: { canRead: false, canWrite: false, reason: 'DriveNotFound' }
			},
		})
		for (let i = 0; i < 4; i++) await timers.advance()

		assert.equal(answers, 4)
		assert.deepEqual(events.revoked.map((e) => e.reason), ['DriveNotFound'])
	})
})

describe('downgrade and upgrade', () => {
	it('turns an open connection read-only when EDIT is taken away', async () => {
		let write = true
		const { handle, events, timers } = watcher({
			check: async () => ({ canRead: true, canWrite: write }),
		})
		await timers.advance()
		assert.deepEqual(events.capability, [], 'no change, no event')

		write = false
		await timers.advance()
		assert.deepEqual(events.capability, [{ canWrite: false }])
		assert.equal(handle.canWrite, false)
		assert.deepEqual(events.revoked, [], 'a downgrade is not a disconnect')
	})

	it('releases writes again when EDIT comes back', async () => {
		let write = false
		const { handle, events, timers } = watcher({
			canWrite: false,
			check: async () => ({ canRead: true, canWrite: write }),
		})
		await timers.advance()
		assert.deepEqual(events.capability, [])

		write = true
		await timers.advance()
		assert.deepEqual(events.capability, [{ canWrite: true }])
		assert.equal(handle.canWrite, true)
	})

	it('reports a capability change once, not on every recheck', async () => {
		let write = true
		const { events, timers } = watcher({
			check: async () => ({ canRead: true, canWrite: write }),
		})
		write = false
		for (let i = 0; i < 5; i++) await timers.advance()
		assert.deepEqual(events.capability, [{ canWrite: false }])
	})
})

describe('an unreachable Frappe', () => {
	it('leaves the connection alone on one failure', async () => {
		let fail = true
		const { handle, events, timers } = watcher({
			check: async () => {
				if (fail) throw new Error('ECONNREFUSED')
				return { canRead: true, canWrite: true }
			},
		})
		await timers.advance()
		assert.deepEqual(events.revoked, [])
		assert.equal(handle.stopped, false)

		fail = false
		await timers.advance()
		assert.deepEqual(events.revoked, [])
	})

	it(`closes after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`, async () => {
		const { handle, events, timers } = watcher({
			check: async () => {
				throw new Error('ECONNREFUSED')
			},
		})
		for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) await timers.advance()

		assert.equal(events.revoked.length, 1)
		assert.equal(events.revoked[0].reason, 'unreachable')
		assert.match(events.revoked[0].error.message, /ECONNREFUSED/)
		assert.equal(handle.stopped, true)
	})

	it('forgets the failures once an answer arrives', async () => {
		let fail = true
		const { events, timers } = watcher({
			check: async () => {
				if (fail) throw new Error('ECONNREFUSED')
				return { canRead: true, canWrite: true }
			},
		})
		await timers.advance()
		await timers.advance()
		fail = false
		await timers.advance()
		fail = true
		await timers.advance()
		await timers.advance()

		assert.deepEqual(events.revoked, [], 'the streak restarted at the good answer')
	})
})
