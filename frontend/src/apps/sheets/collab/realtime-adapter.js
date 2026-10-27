// Adapter between the suite's shared realtime client (`@/platform/realtime`)
// and the `{ publish, on, off }` interface the Yjs provider/awareness expect.
//
// The socket gives us subscription but no client-side publish — publishing
// goes through a whitelisted API method (`api.yjs_relay`) that calls
// `frappe.publish_realtime` on the server side so it can enforce permission
// checks. This adapter hides that split so the collab modules don't have to
// think about it.
//
// Server payloads arrive as `{ sheet, user, payload }`. We unwrap `payload`
// (a JSON string) before handing it to the consumer so they get the
// original `{ sheet, from, ... }` shape they published.
//
// The server publishes to the sheet's own room, `doc:Sheet/<name>`. The
// shared client joins it with `doc_subscribe` (the socket server grants it
// only after a read check on the sheet), joins again after every reconnect,
// and counts joins so leaving here never drops another listener's room.

import { realtime as sharedRealtime } from '@/platform/realtime'

import { relay } from '../utils/relay.js'

/**
 * @param {object} opts
 * @param {string} opts.sheetId
 * @param {import('@/platform/realtime').Realtime} [opts.realtime]
 * @param {(method:string, args:object) => Promise} [opts.callFn]
 */
export function createRealtimeAdapter({ sheetId, realtime = sharedRealtime, callFn = relay } = {}) {
  if (!sheetId) throw new Error('createRealtimeAdapter: sheetId is required')

  // Map<eventName, Map<originalCb, unsubscribe>> — so `off` removes the
  // exact wrapped callback we registered on the socket.
  const subscriptions = new Map()
  const leave = realtime.joinDoc('Sheet', sheetId)
  const stopReporting = reportConnectionFailure(realtime.socket(), sheetId)

  function close() {
    for (const bucket of subscriptions.values())
      for (const unsubscribe of bucket.values()) unsubscribe()
    subscriptions.clear()
    stopReporting()
    leave()
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

  // Messages for this sheet only, as sent; the room can carry other events.
  function onSheet(event, cb) {
    return realtime.subscribe(event, (msg) => {
      if (msg?.sheet === sheetId) cb(msg)
    })
  }

  function on(event, cb) {
    const unsubscribe = onSheet(event, (msg) => {
      let inner = null
      try {
        inner = msg.payload ? JSON.parse(msg.payload) : null
      } catch (_) {
        /* ignore */
      }
      if (inner) cb(inner)
    })
    if (!subscriptions.has(event)) subscriptions.set(event, new Map())
    subscriptions.get(event).set(cb, unsubscribe)
  }

  function off(event, cb) {
    const bucket = subscriptions.get(event)
    bucket?.get(cb)?.()
    bucket?.delete(cb)
  }

  return { publish, on, off, onSheet, close }
}

// Without a socket, co-editors never see each other's saves and only the
// save conflict check stops an overwrite. Say so once, instead of failing
// silently the way the old page-local shim did.
function reportConnectionFailure(socket, sheetId) {
  let reported = false
  const report = (err) => {
    if (reported) return
    reported = true
    console.error(
      `[sheets] realtime connection failed for ${sheetId}; live collaboration is off`,
      err,
    )
  }
  socket.on('connect_error', report)
  return () => socket.off('connect_error', report)
}
