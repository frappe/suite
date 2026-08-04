import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'

import { createPersistence, toBase64, fromBase64, SAVE_DEBOUNCE_MS } from './persistence.js'

function setup(overrides = {}) {
	const doc = new Y.Doc()
	const callFn = vi.fn().mockResolvedValue({ skipped: false })
	const p = createPersistence({ doc, sheetId: 'SH-1', callFn, ...overrides })
	return { doc, callFn, p }
}

describe('base64 helpers', () => {
	it('round-trips binary data', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255, 42])
		expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes))
	})

	// String.fromCharCode(...bigArray) overflows the call stack; the chunked
	// encoder exists specifically so a real workbook's Y.Doc doesn't crash the
	// save path.
	it('handles payloads larger than the chunk size', () => {
		const bytes = new Uint8Array(200_000).map((_, i) => i % 256)
		const round = fromBase64(toBase64(bytes))
		expect(round.length).toBe(bytes.length)
		expect(round[199_999]).toBe(bytes[199_999])
	})

	it('round-trips a real Y.Doc update', () => {
		const doc = new Y.Doc()
		doc.getMap('cells').set('A1', 'hello')
		const encoded = toBase64(Y.encodeStateAsUpdate(doc))

		const restored = new Y.Doc()
		Y.applyUpdate(restored, fromBase64(encoded))
		expect(restored.getMap('cells').get('A1')).toBe('hello')
	})
})

describe('createPersistence', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it('requires doc, sheetId and callFn', () => {
		expect(() => createPersistence({})).toThrow(/doc, sheetId and callFn/)
	})

	it('debounces a save after a local edit', async () => {
		const { doc, callFn } = setup()

		doc.getMap('cells').set('A1', 1)
		expect(callFn).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

		expect(callFn).toHaveBeenCalledTimes(1)
		expect(callFn.mock.calls[0][0]).toBe('suite.sheets.collab.save_collab_state')
		expect(callFn.mock.calls[0][1].name).toBe('SH-1')
	})

	it('coalesces a burst of edits into one save', async () => {
		const { doc, callFn } = setup()

		for (let i = 0; i < 20; i++) doc.getMap('cells').set(`A${i}`, i)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

		expect(callFn).toHaveBeenCalledTimes(1)
	})

	it('sends the full doc state, not just the last delta', async () => {
		const { doc, callFn } = setup()

		doc.getMap('cells').set('A1', 'first')
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

		const restored = new Y.Doc()
		Y.applyUpdate(restored, fromBase64(callFn.mock.calls[0][1].update))
		expect(restored.getMap('cells').get('A1')).toBe('first')
	})

	// Applying stored state must not immediately bounce it straight back to
	// the server — otherwise every open costs a redundant write.
	it('does not save state that came from the server', async () => {
		const source = new Y.Doc()
		source.getMap('cells').set('A1', 'stored')
		const encoded = toBase64(Y.encodeStateAsUpdate(source))

		const { doc, callFn, p } = setup()
		p.applyServerState(encoded)

		expect(doc.getMap('cells').get('A1')).toBe('stored')
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2)
		expect(callFn).not.toHaveBeenCalled()
	})

	it('applyServerState is a no-op for empty state', () => {
		const { p } = setup()
		expect(p.applyServerState(null)).toBe(false)
		expect(p.applyServerState('')).toBe(false)
	})

	// P2P can't stop a viewer from joining the room, so the client-side gate
	// and the server-side re-check both matter. This is the client half.
	it('never saves when the user lacks write access', async () => {
		const { doc, callFn, p } = setup({ canWrite: false })

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2)
		await p.flush()

		expect(callFn).not.toHaveBeenCalled()
	})

	it('surfaces save failures without throwing into the update handler', async () => {
		const onError = vi.fn()
		const callFn = vi.fn().mockRejectedValue(new Error('boom'))
		const doc = new Y.Doc()
		createPersistence({ doc, sheetId: 'SH-1', callFn, onError })

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)

		expect(onError).toHaveBeenCalledTimes(1)
		expect(onError.mock.calls[0][0].message).toBe('boom')
	})

	it('flushes the pending state on dispose', async () => {
		const { doc, callFn, p } = setup()

		doc.getMap('cells').set('A1', 'unsaved')
		await p.dispose()

		expect(callFn).toHaveBeenCalledTimes(1)
		const restored = new Y.Doc()
		Y.applyUpdate(restored, fromBase64(callFn.mock.calls[0][1].update))
		expect(restored.getMap('cells').get('A1')).toBe('unsaved')
	})

	// Without keepalive the browser cancels an in-flight request when the
	// document goes away, so the teardown flush would silently drop whatever
	// was typed since the last debounce fired.
	it('marks the teardown flush keepalive, but not routine saves', async () => {
		const { doc, callFn, p } = setup()

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		expect(callFn.mock.calls[0][2]).toEqual({ keepalive: false })

		doc.getMap('cells').set('A2', 2)
		await p.dispose()
		expect(callFn.mock.calls[1][2]).toEqual({ keepalive: true })
	})

	it('can skip the final flush', async () => {
		const { doc, callFn, p } = setup()
		doc.getMap('cells').set('A1', 1)
		await p.dispose({ finalFlush: false })
		expect(callFn).not.toHaveBeenCalled()
	})

	it('stops saving after dispose', async () => {
		const { doc, callFn, p } = setup()
		await p.dispose({ finalFlush: false })

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2)

		expect(callFn).not.toHaveBeenCalled()
	})

	it('does not stack a second save behind one in flight', async () => {
		let resolve
		const callFn = vi.fn(() => new Promise(r => { resolve = r }))
		const doc = new Y.Doc()
		const p = createPersistence({ doc, sheetId: 'SH-1', callFn })

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		expect(callFn).toHaveBeenCalledTimes(1)

		// Second flush while the first is still open — should not fire yet.
		p.flush()
		expect(callFn).toHaveBeenCalledTimes(1)

		resolve({})
	})

	// The coalesced save must not be *dropped*, only deferred. The first
	// request's payload was encoded before these edits existed, so if the
	// follow-up never fires they live nowhere but this browser — and nothing
	// re-arms the debounce until the user types again.
	it('sends edits made while a save was in flight', async () => {
		let resolve
		const callFn = vi.fn(() => new Promise(r => { resolve = r }))
		const doc = new Y.Doc()
		createPersistence({ doc, sheetId: 'SH-1', callFn })

		doc.getMap('cells').set('A1', 'first')
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		expect(callFn).toHaveBeenCalledTimes(1)

		// Typed while the first POST is still open.
		doc.getMap('cells').set('A2', 'during')
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		expect(callFn).toHaveBeenCalledTimes(1)  // still queued behind the open one

		resolve({})
		await vi.advanceTimersByTimeAsync(0)

		expect(callFn).toHaveBeenCalledTimes(2)
		const restored = new Y.Doc()
		Y.applyUpdate(restored, fromBase64(callFn.mock.calls[1][1].update))
		expect(restored.getMap('cells').get('A2')).toBe('during')
	})

	// Teardown has no next debounce window to fall back on, so it must issue
	// its own request rather than riding on one encoded seconds earlier.
	it('does not coalesce the teardown flush onto an in-flight save', async () => {
		const resolvers = []
		const callFn = vi.fn(() => new Promise(r => resolvers.push(r)))
		const doc = new Y.Doc()
		const p = createPersistence({ doc, sheetId: 'SH-1', callFn })

		doc.getMap('cells').set('A1', 'first')
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		expect(callFn).toHaveBeenCalledTimes(1)

		doc.getMap('cells').set('A2', 'last words')
		p.dispose()

		expect(callFn).toHaveBeenCalledTimes(2)
		expect(callFn.mock.calls[1][2]).toEqual({ keepalive: true })
		const restored = new Y.Doc()
		Y.applyUpdate(restored, fromBase64(callFn.mock.calls[1][1].update))
		expect(restored.getMap('cells').get('A2')).toBe('last words')

		resolvers.forEach(r => r({}))
	})

	// A save queued behind an in-flight request must not fire after teardown:
	// the final flush already sent full state, and the caller is free to
	// destroy the doc the moment dispose() returns.
	it('drops a queued save when disposal happens first', async () => {
		const resolvers = []
		const callFn = vi.fn(() => new Promise(r => resolvers.push(r)))
		const doc = new Y.Doc()
		const p = createPersistence({ doc, sheetId: 'SH-1', callFn })

		doc.getMap('cells').set('A1', 1)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
		doc.getMap('cells').set('A2', 2)
		await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)  // queues a follow-up
		expect(callFn).toHaveBeenCalledTimes(1)

		p.dispose()                      // forced teardown save — call 2
		resolvers.forEach(r => r({}))    // now let the queued follow-up wake up
		await vi.advanceTimersByTimeAsync(0)

		expect(callFn).toHaveBeenCalledTimes(2)
	})
})
