// Y.Doc ⇄ Frappe persistence for the peer-to-peer collab path.
//
// In the websocket design the collab server owned persistence: it held the
// authoritative doc and flushed it on a debounce. With P2P there is no server
// in the data plane, so the browsers are responsible for getting state back to
// Frappe — the same shape Writer uses, where `useYjs`'s `save()` posts the
// encoded doc from whichever client happens to be editing.
//
// Every writer flushes its own view of the document. That's safe because the
// backend merges instead of overwriting (see `sheets.collab.save_collab_state`),
// so two peers flushing concurrently union rather than clobber. A failed save
// costs nothing either: the next debounce window sends the full state again.
//
// "The next window" is doing real work in that sentence, so the two places
// where there isn't one are handled explicitly below — a save requested while
// another is open queues a follow-up rather than riding on the open request's
// older payload, and the teardown flush skips coalescing altogether.
//
// Viewers never flush at all — `canWrite` gates the whole path, and the
// endpoint re-checks write permission regardless. Note what that does *not*
// buy: it stops a viewer saving, not a viewer's edits being saved. Those reach
// the backend inside the next full-state flush from any connected writer. See
// the trade-offs listed in webrtc-client.js.

import * as Y from 'yjs'

// Writer debounces its save at 5s. Matching it keeps the request rate
// predictable for a shared backend: one POST per active editor per 5s of
// continuous typing, plus a flush when the editor closes.
export const SAVE_DEBOUNCE_MS = 5000

// `btoa` needs a binary string, and spreading a large Uint8Array into
// String.fromCharCode overflows the call stack somewhere around 100k
// elements — well within reach for a real workbook. Chunking keeps each
// call small while still being a single pass.
const B64_CHUNK = 0x8000

export function toBase64(bytes) {
	let binary = ''
	for (let i = 0; i < bytes.length; i += B64_CHUNK) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK))
	}
	return btoa(binary)
}

export function fromBase64(b64) {
	const binary = atob(b64)
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
	return out
}

/**
 * @param {object} opts
 * @param {import('yjs').Doc} opts.doc
 * @param {string}   opts.sheetId
 * @param {boolean}  [opts.canWrite]   - viewers never persist
 * @param {Function} opts.callFn       - (method, args) => Promise
 * @param {number}   [opts.debounceMs]
 * @param {(err: Error) => void} [opts.onError]
 */
export function createPersistence({
	doc,
	sheetId,
	canWrite = true,
	callFn,
	debounceMs = SAVE_DEBOUNCE_MS,
	onError,
	_setTimeout = setTimeout,
	_clearTimeout = clearTimeout,
} = {}) {
	if (!doc || !sheetId || !callFn) {
		throw new Error('createPersistence: doc, sheetId and callFn are required')
	}

	let timer = null
	let disposed = false
	let inFlight = null
	let queued = null

	function _schedule() {
		if (disposed || !canWrite || timer) return
		timer = _setTimeout(() => {
			timer = null
			flush()
		}, debounceMs)
	}

	// Applied with the 'server' origin so the doc's own update handler can tell
	// "state that came back from Frappe" apart from a local edit and skip
	// scheduling a save for it — otherwise opening a sheet would immediately
	// write back the exact bytes we just read.
	function applyServerState(b64) {
		if (!b64) return false
		Y.applyUpdate(doc, fromBase64(b64), 'server')
		return true
	}

	// `keepalive` matters only for the flush on teardown: without it the browser
	// cancels the request as soon as the document goes away, silently losing
	// everything edited since the last debounce fired. See the note in
	// utils/api.js — frappe-ui's call() has no keepalive option, so that path
	// drops to a raw fetch.
	function _send({ keepalive }) {
		const update = toBase64(Y.encodeStateAsUpdate(doc))
		const req = callFn(
			'suite.sheets.collab.save_collab_state',
			{ name: sheetId, update },
			{ keepalive },
		)
			.catch((err) => {
				// A failed save is recoverable — the next edit re-arms the
				// debounce and resends the full state. Surface it so the UI
				// can decide whether to warn, but never throw into the
				// caller's update handler.
				onError?.(err)
				return null
			})
			.finally(() => {
				// Identity-checked: a forced teardown save can start while this
				// one is still open, and the older request settling must not
				// clear the newer one's slot.
				if (inFlight === req) inFlight = null
			})
		inFlight = req
		return req
	}

	// `force` skips coalescing entirely — used only for the teardown flush,
	// where the tab is going away and there is no "next debounce" to fall back
	// on. Two overlapping POSTs are safe: the backend merges under a row lock.
	async function flush({ keepalive = false, force = false } = {}) {
		if (disposed || !canWrite) return null
		if (inFlight && !force) {
			// Don't hand back the in-flight request. Its payload was encoded
			// before the edits that triggered this call existed, so awaiting it
			// would report them as saved while they sit only in this browser —
			// and nothing re-arms the debounce until the user types again.
			// Chain one follow-up instead: it encodes after the open request
			// settles, so it picks up everything since, and repeat calls
			// collapse onto the same queued save rather than stacking.
			queued = queued || inFlight.then(() => {
				queued = null
				// Disposal in the meantime means teardown already forced a
				// full-state save and the caller is free to destroy the doc —
				// encoding it here would be both redundant and unsafe.
				if (disposed) return null
				return _send({ keepalive })
			})
			return queued
		}
		return _send({ keepalive })
	}

	function _onUpdate(_update, origin) {
		if (origin === 'server') return
		_schedule()
	}

	doc.on('update', _onUpdate)

	function dispose({ finalFlush = true } = {}) {
		if (disposed) return null
		doc.off('update', _onUpdate)
		if (timer) {
			_clearTimeout(timer)
			timer = null
		}
		// Grab the last flush before flipping `disposed`, otherwise the guard
		// at the top of flush() swallows it and the final few seconds of
		// edits only survive in whichever peer is still open. This is the
		// unload path, hence keepalive — and `force`, because coalescing onto
		// a save that was encoded seconds ago would lose exactly the edits
		// this flush exists to rescue.
		const pending = finalFlush && canWrite
			? flush({ keepalive: true, force: true })
			: null
		disposed = true
		return pending
	}

	return { applyServerState, flush, dispose }
}
