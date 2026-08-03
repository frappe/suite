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

		// Second flush while the first is still open — should reuse it.
		p.flush()
		expect(callFn).toHaveBeenCalledTimes(1)

		resolve({})
	})
})
