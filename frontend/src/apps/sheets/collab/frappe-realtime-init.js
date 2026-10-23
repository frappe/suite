// Minimal `frappe.realtime` shim for the public www/sheets page.
//
// Frappe's full `socketio_client.js` is only loaded by Desk and the
// `frappe-web` bundle — neither of which runs on our SPA page. Without
// `window.frappe.realtime` the legacy collab path has no transport, so
// awareness packets publish into the void and presence never propagates.
// (Manifesting as: avatar pile stays empty even with two users on the
// same sheet.)
//
// We don't need the full client — just enough to back the contract
// `realtime-adapter.js` consumes:
//   * `on(event, cb)` / `off(event, cb)` for subscription
//   * a live socket so Frappe room-routing works (publish_realtime
//     fan-outs land on connected clients in the site namespace)
//   * `.connected` / `.id` for the diagnostic JSON
//
// Frappe scopes its socketio rooms by *site* via a socket.io namespace
// equal to the site name. The host / port discovery mirrors
// frappe/socketio_client.js:get_host() so production (same-origin via
// nginx proxy) and dev (separate :9001 port) both connect correctly.

import { io } from 'socket.io-client'

/**
 * Initialise `window.frappe.realtime` if it isn't already populated.
 *
 * @param {object} [boot]   - the frappe.boot shim — defaults to window.frappe.boot
 * @param {object} [opts]   - test seam: `{ ioFactory, window: stubWindow }`
 * @returns {object|null}   - the realtime shim, or null if init failed
 */
export function ensureFrappeRealtime(boot, opts = {}) {
  const w = opts.window ?? (typeof window !== 'undefined' ? window : null)
  if (!w) return null

  w.frappe = w.frappe || {}
  if (w.frappe.realtime && typeof w.frappe.realtime.on === 'function') {
    return w.frappe.realtime
  }

  const b = boot || w.frappe?.boot || {}

  // `disable_async` is Frappe's standard signal that socketio is off on
  // this site (Frappe's own `socketio_client.js` checks the same flag at
  // the top of its init). Mirror it so CI / disable_async sites don't
  // generate socket.io connect_error noise in the console.
  if (b.disable_async) return null

  const sitename = b.sitename
  if (!sitename) {
    // No sitename → no namespace to connect to. Stay silent rather
    // than warn — most "no sitename" cases are headless / smoke-test
    // environments where the noise hurts more than it helps.
    return null
  }

  const url = _resolveSocketUrl(w, b, sitename)
  const ioFactory = opts.ioFactory ?? io

  let socket
  try {
    socket = ioFactory(url, {
      withCredentials: true,
      reconnectionAttempts: 5,
      // Polling-then-websocket is the default and matches what
      // frappe/socketio_client.js uses — long-poll bootstrap survives
      // some restrictive corp proxies that drop the WS upgrade.
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[realtime] socket.io init threw', e)
    return null
  }

  // Socket.io's Emitter throws (and the browser logs an Error) when an
  // `error`/`connect_error` event fires with no listener attached, so we
  // register quiet no-op handlers. Real diagnostics live on the socket
  // itself — `window.frappe.realtime.socket.on('connect_error', ...)`
  // from the DevTools console — without polluting users' logs on sites
  // where the bench briefly hiccups or where socketio is unreachable.
  socket.on('connect_error', () => {})
  socket.on('error', () => {})

  const shim = {
    socket,
    get connected() {
      return !!socket.connected
    },
    get id() {
      return socket.id || ''
    },
    on: (event, cb) => socket.on(event, cb),
    off: (event, cb) => socket.off(event, cb),
    emit: (event, ...args) => socket.emit(event, ...args),
    // `publish` deliberately omitted — our collab adapter routes
    // publishes through whitelisted Frappe API methods (`yjs_relay`)
    // so server-side permission checks always run before fan-out.
  }
  w.frappe.realtime = shim
  return shim
}

// Mirrors frappe/public/js/frappe/socketio_client.js → get_host().
// On dev_server, the socketio server runs on a separate port and we have
// to splice it into the origin. In production the same-origin URL works
// because nginx proxies /socket.io/ to the socketio process on the box.
function _resolveSocketUrl(w, boot, sitename) {
  const origin = w.location?.origin || ''
  if (!origin) return '/' + sitename

  if (w.dev_server) {
    const port = __SOCKETIO_PORT__
    const parts = origin.split(':')
    const base = parts.length > 2 ? parts[0] + ':' + parts[1] : origin
    return `${base}:${port}/${sitename}`
  }
  return `${origin}/${sitename}`
}
