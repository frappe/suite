// Adapter between Frappe's socket.io-based realtime client and the
// `{ publish, on, off }` interface the Yjs provider/awareness expect.
//
// Frappe realtime gives us subscription (`realtime.on(event, cb)`) but no
// client-side publish — publishing goes through a whitelisted API method
// (`api.yjs_relay`) that calls `frappe.publish_realtime` on the server side
// so it can enforce permission checks. This adapter hides that split so
// the collab modules don't have to think about it.
//
// Server payloads arrive as `{ sheet, user, payload }`. We unwrap `payload`
// (a JSON string) before handing it to the consumer so they get the
// original `{ sheet, from, ... }` shape they published.

import { call } from '../utils/api.js'

/**
 * @param {object} opts
 * @param {string} opts.sheetId
 * @param {object} [opts.realtime]  - the socket.io client (defaults to window.frappe.realtime)
 * @param {(method:string, args:object) => Promise} [opts.callFn]
 */
export function createRealtimeAdapter({
	sheetId,
	realtime = window.frappe?.realtime,
	callFn   = call,
} = {}) {
	if (!sheetId) throw new Error('createRealtimeAdapter: sheetId is required')

	// Map<eventName, Map<originalCb, wrappedCb>> — needed so `off` can
	// remove the exact wrapped callback we registered on the socket.
	const wrapped = new Map()

	// The server relays into the sheet's document room and checks read
	// permission on join. A reconnect starts outside every room, so join on
	// each connect.
	const join = () => realtime?.emit?.('doc_subscribe', 'Sheet', sheetId)
	join()
	realtime?.on?.('connect', join)

	function close() {
		realtime?.off?.('connect', join)
		realtime?.emit?.('doc_unsubscribe', 'Sheet', sheetId)
	}

	function publish(event, payload) {
		// Fire-and-forget; the relay errors land in the console but never
		// block typing.
		return callFn('suite.sheets.api.yjs_relay', {
			name:    sheetId,
			event,
			payload: JSON.stringify(payload ?? {}),
		}).catch(err => {
			// eslint-disable-next-line no-console
			console.warn(`[yjs:${event}] relay failed`, err)
		})
	}

	function on(event, cb) {
		if (!realtime?.on) return
		const w = (msg) => {
			let inner = null
			try { inner = msg?.payload ? JSON.parse(msg.payload) : null } catch (_) { /* ignore */ }
			if (inner) cb(inner)
		}
		let bucket = wrapped.get(event)
		if (!bucket) { bucket = new Map(); wrapped.set(event, bucket) }
		bucket.set(cb, w)
		realtime.on(event, w)
	}

	function off(event, cb) {
		const bucket = wrapped.get(event)
		const w = bucket?.get(cb)
		if (w) {
			realtime?.off?.(event, w)
			bucket.delete(cb)
		}
	}

	return { publish, on, off, close }
}
