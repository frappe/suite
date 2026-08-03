import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'

import { createWebrtcClient } from './webrtc-client.js'

// Stand-in for WebrtcProvider. Captures ctor args and lets tests fire the
// events the real provider emits ('status', 'synced').
function makeFakeProvider(awareness) {
	const ctorArgs = []
	class FakeProvider {
		constructor(room, doc, opts) {
			ctorArgs.push({ room, doc, opts })
			this.awareness = awareness || makeFakeAwareness()
			this.destroyed = false
			this._handlers = {}
		}
		on(event, fn) { (this._handlers[event] ||= []).push(fn) }
		emit(event, payload) { (this._handlers[event] || []).forEach(fn => fn(payload)) }
		destroy() { this.destroyed = true }
	}
	return { FakeProvider, ctorArgs }
}

function makeFakePersistence() {
	const instances = []
	class FakePersistence {
		constructor(room, doc) {
			this.room = room
			this.doc = doc
			this.destroyed = false
			this._handlers = {}
			instances.push(this)
		}
		on(event, fn) { (this._handlers[event] ||= []).push(fn) }
		emit(event, payload) { (this._handlers[event] || []).forEach(fn => fn(payload)) }
		destroy() { this.destroyed = true }
	}
	return { FakePersistence, instances }
}

function makeFakeAwareness(clientIds = []) {
	const states = new Map(clientIds.map(id => [id, {}]))
	return {
		getStates: () => states,
		setLocalStateField: vi.fn(),
		on: vi.fn(),
		_states: states,
	}
}

function baseOpts(overrides = {}) {
	return {
		doc:        new Y.Doc(),
		sheetId:    'SH-1',
		room:       'fsheet-SH-1',
		password:   'deadbeef',
		signaling:  ['wss://signal.frappe.cloud'],
		iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
		...overrides,
	}
}

describe('createWebrtcClient', () => {
	it('passes room, signaling, password and ICE config to the provider', () => {
		const { FakeProvider, ctorArgs } = makeFakeProvider()
		const { FakePersistence } = makeFakePersistence()
		const opts = baseOpts()
		createWebrtcClient({ ...opts, _Provider: FakeProvider, _Persistence: FakePersistence })

		expect(ctorArgs).toHaveLength(1)
		expect(ctorArgs[0].room).toBe('fsheet-SH-1')
		expect(ctorArgs[0].doc).toBe(opts.doc)
		expect(ctorArgs[0].opts.password).toBe('deadbeef')
		expect(ctorArgs[0].opts.signaling).toEqual(['wss://signal.frappe.cloud'])
		expect(ctorArgs[0].opts.peerOpts.config.iceServers).toEqual(opts.iceServers)
	})

	it('throws on missing required args', () => {
		expect(() => createWebrtcClient({})).toThrow(/doc, sheetId and room/)
	})

	// The access check for a P2P room *is* the encryption key — the signaling
	// server authenticates nobody. y-webrtc silently runs an unencrypted room
	// when `password` is absent, so failing loudly here is the difference
	// between "gated" and "world-readable to anyone who guesses the room".
	it('refuses to open a room without a password', () => {
		const { FakeProvider, ctorArgs } = makeFakeProvider()
		expect(() => createWebrtcClient({
			...baseOpts({ password: '' }),
			_Provider: FakeProvider,
			_Persistence: null,
		})).toThrow(/password is required/)
		expect(ctorArgs).toHaveLength(0)
	})

	it('creates local IndexedDB persistence keyed on the room', () => {
		const { FakeProvider } = makeFakeProvider()
		const { FakePersistence, instances } = makeFakePersistence()
		createWebrtcClient({ ...baseOpts(), _Provider: FakeProvider, _Persistence: FakePersistence })
		expect(instances).toHaveLength(1)
		expect(instances[0].room).toBe('fsheet-SH-1')
	})

	it('maps provider status to connected/disconnected', () => {
		const { FakeProvider } = makeFakeProvider()
		const seen = []
		const client = createWebrtcClient({
			...baseOpts(),
			onStatusChange: s => seen.push(s),
			_Provider: FakeProvider,
			_Persistence: null,
		})
		client.provider.emit('status', { connected: true })
		client.provider.emit('status', { connected: false })
		expect(seen).toEqual(['connected', 'disconnected'])
	})

	describe('bootstrap', () => {
		it('seeds an empty doc when this client is the leader', () => {
			const { FakeProvider } = makeFakeProvider(makeFakeAwareness())
			const doc = new Y.Doc()
			const client = createWebrtcClient({
				...baseOpts({ doc }),
				getSnapshot: () => ({ sheets: { Sheet1: { A1: 42 } }, current: 'Sheet1' }),
				_Provider: FakeProvider,
				_Persistence: null,
			})

			client.provider.emit('synced', { synced: true })

			expect(doc.getMap('__collab_meta').get('bootstrapped')).toBe(true)
			expect(doc.getMap('cells').get('Sheet1').get('A1')).toBe(42)
		})

		it('skips when the doc is already bootstrapped', () => {
			const { FakeProvider } = makeFakeProvider(makeFakeAwareness())
			const doc = new Y.Doc()
			doc.getMap('__collab_meta').set('bootstrapped', true)
			const getSnapshot = vi.fn(() => ({ sheets: { Sheet1: { A1: 1 } } }))
			const client = createWebrtcClient({
				...baseOpts({ doc }), getSnapshot,
				_Provider: FakeProvider, _Persistence: null,
			})

			client.provider.emit('synced', { synced: true })

			expect(getSnapshot).not.toHaveBeenCalled()
		})

		it('defers to the peer with the lower clientID', () => {
			const doc = new Y.Doc()
			// A peer with a clientID below ours is present, so it leads.
			const awareness = makeFakeAwareness([doc.clientID, doc.clientID - 1])
			const { FakeProvider } = makeFakeProvider(awareness)
			const getSnapshot = vi.fn(() => ({ sheets: { Sheet1: { A1: 1 } } }))
			const client = createWebrtcClient({
				...baseOpts({ doc }), getSnapshot,
				_Provider: FakeProvider, _Persistence: null,
			})

			client.provider.emit('synced', { synced: true })

			expect(getSnapshot).not.toHaveBeenCalled()
			expect(doc.getMap('__collab_meta').get('bootstrapped')).toBeUndefined()
		})

		it('also triggers off the local cache sync', () => {
			const { FakeProvider } = makeFakeProvider(makeFakeAwareness())
			const { FakePersistence, instances } = makeFakePersistence()
			const doc = new Y.Doc()
			createWebrtcClient({
				...baseOpts({ doc }),
				getSnapshot: () => ({ sheets: { Sheet1: { A1: 7 } }, current: 'Sheet1' }),
				_Provider: FakeProvider,
				_Persistence: FakePersistence,
			})

			instances[0].emit('synced')

			expect(doc.getMap('cells').get('Sheet1').get('A1')).toBe(7)
		})

		it('is idempotent across repeated sync events', () => {
			const { FakeProvider } = makeFakeProvider(makeFakeAwareness())
			const doc = new Y.Doc()
			const getSnapshot = vi.fn(() => ({ sheets: { Sheet1: { A1: 1 } }, current: 'Sheet1' }))
			const client = createWebrtcClient({
				...baseOpts({ doc }), getSnapshot,
				_Provider: FakeProvider, _Persistence: null,
			})

			client.provider.emit('synced', { synced: true })
			client.provider.emit('synced', { synced: true })
			client.provider.emit('synced', { synced: true })

			expect(getSnapshot).toHaveBeenCalledTimes(1)
		})
	})

	it('destroy() tears down both the provider and the local cache', () => {
		const { FakeProvider } = makeFakeProvider()
		const { FakePersistence, instances } = makeFakePersistence()
		const client = createWebrtcClient({
			...baseOpts(), _Provider: FakeProvider, _Persistence: FakePersistence,
		})

		client.destroy()

		expect(client.provider.destroyed).toBe(true)
		expect(instances[0].destroyed).toBe(true)
	})
})
