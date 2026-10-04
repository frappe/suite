// Custom Yjs provider that syncs over Frappe's `socketio` realtime.
//
// Frappe Cloud / on-prem benches already expose `frappe.realtime` (a socket.io
// client) wired to the same site the user authenticated against, with auth +
// room semantics built in. Building on it means:
//
//   * Zero extra infrastructure — no y-websocket server to deploy.
//   * Permission checks land naturally inside whitelisted endpoints.
//   * Presence + ops + persistence share one transport.
//
// Wire format (server-relayed event):
//   event: 'yjs_update'
//   payload: { sheet: <docName>, update: <base64 Y.encodeStateAsUpdate>,
//              from: <session.user> }
//
// Two messages on connect: state-sync (each peer sends a state vector and
// receives missing updates) is collapsed into a single fire-and-replay: the
// new peer requests a full state from the room via `yjs_state_request`, any
// online peer replies with `yjs_state` carrying a full doc update.

import * as Y from 'yjs'

import { REMOTE_ORIGIN } from './cells-binding.js'

const EVT_UPDATE = 'yjs_update'
const EVT_STATE_REQUEST = 'yjs_state_request'
const EVT_STATE = 'yjs_state'

/**
 * @param {object}  opts
 * @param {Y.Doc}   opts.doc
 * @param {string}  opts.sheetId        - backend Sheet docname (= room key)
 * @param {object}  opts.realtime       - the global frappe.realtime client
 *                                        (window.frappe.realtime in prod;
 *                                        tests inject a mock)
 * @param {string}  [opts.selfTag]      - identifier echoed in payloads so we
 *                                        ignore our own broadcasts (defaults
 *                                        to a fresh random id per client)
 */
export function createFrappeProvider({
  doc,
  sheetId,
  realtime,
  selfTag,
  // Coalescing knobs — see _flushLocalUpdates below. Wider window means
  // fewer POSTs during bulk ops but a slightly later remote paint for
  // normal typing. 16 ms ≈ one frame: invisible to a typist, kills the
  // connection-exhaustion under split-text/paste/fill on 1000+ rows.
  flushIntervalMs = 16,
  maxQueuedUpdates = 256,
  _setTimeout = setTimeout,
  _clearTimeout = clearTimeout,
} = {}) {
  if (!doc || !sheetId || !realtime) {
    throw new Error('createFrappeProvider: doc, sheetId and realtime are required')
  }

  const tag = selfTag || `cli-${Math.random().toString(36).slice(2, 10)}`
  let stopped = false

  // Outbound coalescing. Frappe Cloud's www path publishes each Yjs update
  // as a separate HTTP POST through `yjs_relay`, so a split-text on 1100
  // rows × 5 columns produced ~5500 POSTs in a few seconds and Chrome
  // returned ERR_INSUFFICIENT_RESOURCES (out of concurrent connection
  // slots). Buffering local updates and flushing a single merged payload
  // on a short debounce collapses bulk ops into one POST while keeping
  // normal typing's wall-clock latency well under one frame.
  let _pendingUpdates = []
  let _flushTimer = null

  function _flushLocalUpdates() {
    if (_flushTimer) {
      _clearTimeout(_flushTimer)
      _flushTimer = null
    }
    if (stopped || _pendingUpdates.length === 0) return
    // One update is the common typing case — skip the merge cost and
    // any micro-overhead it adds.
    const merged =
      _pendingUpdates.length === 1 ? _pendingUpdates[0] : Y.mergeUpdates(_pendingUpdates)
    _pendingUpdates = []
    realtime.publish?.(EVT_UPDATE, {
      sheet: sheetId,
      from: tag,
      update: _bytesToBase64(merged),
    })
  }

  const _onLocalUpdate = (update, origin) => {
    if (stopped) return
    // Echoes of updates we just applied locally would re-enter the
    // network, so guard against the REMOTE_ORIGIN tag.
    if (origin === REMOTE_ORIGIN) return
    _pendingUpdates.push(update)
    // Drain immediately when the queue is suspiciously large so a
    // pathological loop (no event-loop yield, no microtask break) can't
    // grow it without bound.
    if (_pendingUpdates.length >= maxQueuedUpdates) {
      _flushLocalUpdates()
      return
    }
    if (!_flushTimer) {
      _flushTimer = _setTimeout(_flushLocalUpdates, flushIntervalMs)
    }
  }

  const _onRemoteUpdate = (payload) => {
    if (stopped) return
    if (!payload || payload.sheet !== sheetId) return
    if (payload.from === tag) return
    const bytes = _base64ToBytes(payload.update)
    Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
  }

  const _onStateRequest = (payload) => {
    if (stopped) return
    if (!payload || payload.sheet !== sheetId) return
    if (payload.from === tag) return // don't reply to ourselves
    // Flush any pending local updates first — a peer just asked for
    // state, and the state they'd compute is "ours through the last
    // flushed publish". Sending unflushed updates as part of the state
    // dump is fine (they're in the doc) but means the new peer also
    // receives them again via the deferred publish — harmless but
    // wasteful. Draining here keeps the wire clean.
    _flushLocalUpdates()
    const full = Y.encodeStateAsUpdate(doc)
    realtime.publish?.(EVT_STATE, {
      sheet: sheetId,
      from: tag,
      to: payload.from,
      update: _bytesToBase64(full),
    })
  }

  const _onState = (payload) => {
    if (stopped) return
    if (!payload || payload.sheet !== sheetId) return
    if (payload.from === tag) return
    // Optional point-to-point — if `to` is set and isn't us, ignore.
    if (payload.to && payload.to !== tag) return
    const bytes = _base64ToBytes(payload.update)
    Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
  }

  // Wire it up.
  doc.on('update', _onLocalUpdate)
  realtime.on?.(EVT_UPDATE, _onRemoteUpdate)
  realtime.on?.(EVT_STATE_REQUEST, _onStateRequest)
  realtime.on?.(EVT_STATE, _onState)

  // Announce ourselves so any online peer replays us their state.
  realtime.publish?.(EVT_STATE_REQUEST, { sheet: sheetId, from: tag })

  function destroy() {
    // Flush before the `stopped` guard kicks in — we want the last
    // in-flight typing burst to actually land at peers when the user
    // navigates away. After this, `stopped` short-circuits everything.
    _flushLocalUpdates()
    stopped = true
    if (_flushTimer) {
      _clearTimeout(_flushTimer)
      _flushTimer = null
    }
    doc.off('update', _onLocalUpdate)
    realtime.off?.(EVT_UPDATE, _onRemoteUpdate)
    realtime.off?.(EVT_STATE_REQUEST, _onStateRequest)
    realtime.off?.(EVT_STATE, _onState)
  }

  // `flush` is exposed so callers that need a strict ordering guarantee
  // before doing something else (e.g. fire-and-navigate) can force the
  // debounce window to close synchronously. Most code paths shouldn't
  // touch this.
  return { destroy, tag, flush: _flushLocalUpdates }
}

// ── byte ↔ base64 (browser-safe, chunked to avoid stack overflows) ─────

function _bytesToBase64(bytes) {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

function _base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
