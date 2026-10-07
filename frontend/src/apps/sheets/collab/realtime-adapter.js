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
//
// The server publishes to the sheet's own room, `doc:Sheet/<name>`. The
// adapter joins it with `doc_subscribe`, which the socket server grants only
// after a read check on the sheet, and joins again after every reconnect
// because a new socket starts in no rooms. `close()` leaves it.

import { relay } from '../utils/relay.js'

/**
 * @param {object} opts
 * @param {string} opts.sheetId
 * @param {object} [opts.realtime]  - the socket.io client (defaults to window.frappe.realtime)
 * @param {(method:string, args:object) => Promise} [opts.callFn]
 */
export function createRealtimeAdapter({
  sheetId,
  realtime = window.frappe?.realtime,
  callFn = relay,
} = {}) {
  if (!sheetId) throw new Error('createRealtimeAdapter: sheetId is required')

  // Map<eventName, Map<originalCb, wrappedCb>> — needed so `off` can
  // remove the exact wrapped callback we registered on the socket.
  const wrapped = new Map()

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
      name: sheetId,
      event,
      payload: JSON.stringify(payload ?? {}),
    }).catch((err) => {
      console.warn(`[yjs:${event}] relay failed`, err)
    })
  }

  function on(event, cb) {
    if (!realtime?.on) return
    const w = (msg) => {
      if (msg?.sheet !== sheetId) return
      let inner = null
      try {
        inner = msg?.payload ? JSON.parse(msg.payload) : null
      } catch (_) {
        /* ignore */
      }
      if (inner) cb(inner)
    }
    let bucket = wrapped.get(event)
    if (!bucket) {
      bucket = new Map()
      wrapped.set(event, bucket)
    }
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
