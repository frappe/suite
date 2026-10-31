// Yjs-style awareness over the Frappe realtime transport.
//
// Yjs ships a separate `y-protocols/awareness` package that defines the
// "Awareness" concept — per-client volatile state (cursor, selection,
// presence) with TTL and merge-on-publish semantics. We don't want the
// extra dependency, so we re-implement the same shape with the bare
// minimum the sheets app needs:
//
//   awareness.setLocalState({ cursor: {r, c, subSheet}, user: {...} })
//   awareness.getStates()  →  Map<clientId, state>
//   awareness.on('change', cb)
//
// The transport is Frappe realtime; payloads go through the same socket
// as the y-update / state-request events.
//
// State expires after `CLIENT_TTL_MS` of silence — peers send a keep-alive
// every `KEEPALIVE_MS` to refresh their entry.

const EVT_AWARENESS = 'yjs_awareness'
const EVT_AWARENESS_BYE = 'yjs_awareness_bye'

const KEEPALIVE_MS = 8_000
const CLIENT_TTL_MS = 25_000

/**
 * @param {object} opts
 * @param {string} opts.sheetId
 * @param {object} opts.realtime   - frappe.realtime client (or test mock)
 * @param {string} opts.clientId   - unique per-tab id; reuse the provider's tag
 * @param {object} [opts.initial]  - initial local state
 */
export function createAwareness({ sheetId, realtime, clientId, initial = {} } = {}) {
  if (!sheetId || !realtime || !clientId) {
    throw new Error('createAwareness: sheetId, realtime and clientId are required')
  }

  const states = new Map() // clientId → state object
  const expiries = new Map() // clientId → timeout id
  const listeners = new Set()
  let localState = { ...initial }

  function setLocalState(patch) {
    localState = { ...localState, ...patch }
    _publish()
    _setSelf(localState)
  }

  function getLocalState() {
    return localState
  }

  function getStates() {
    // Returns a shallow copy excluding ourselves — most callers want
    // "other peers", and tests can still see us via getLocalState().
    const out = new Map()
    for (const [id, s] of states.entries()) {
      if (id !== clientId) out.set(id, s)
    }
    return out
  }

  function on(event, cb) {
    if (event !== 'change') return () => {}
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function destroy() {
    clearInterval(keepaliveTimer)
    realtime.off?.(EVT_AWARENESS, _onRemote)
    realtime.off?.(EVT_AWARENESS_BYE, _onBye)
    realtime.publish?.(EVT_AWARENESS_BYE, { sheet: sheetId, from: clientId })
    for (const t of expiries.values()) clearTimeout(t)
    expiries.clear()
    states.clear()
    listeners.clear()
  }

  function _setSelf(state) {
    states.set(clientId, state)
    _emitChange()
  }

  function _publish() {
    realtime.publish?.(EVT_AWARENESS, {
      sheet: sheetId,
      from: clientId,
      state: localState,
    })
  }

  function _onRemote(payload) {
    if (!payload || payload.sheet !== sheetId) return
    if (payload.from === clientId) return
    states.set(payload.from, payload.state || {})
    _resetExpiry(payload.from)
    _emitChange()
  }

  function _onBye(payload) {
    if (!payload || payload.sheet !== sheetId) return
    if (payload.from === clientId) return
    _drop(payload.from)
  }

  function _resetExpiry(id) {
    const prev = expiries.get(id)
    if (prev) clearTimeout(prev)
    expiries.set(
      id,
      setTimeout(() => _drop(id), CLIENT_TTL_MS),
    )
  }

  function _drop(id) {
    states.delete(id)
    const t = expiries.get(id)
    if (t) clearTimeout(t)
    expiries.delete(id)
    _emitChange()
  }

  function _emitChange() {
    for (const cb of listeners) cb()
  }

  realtime.on?.(EVT_AWARENESS, _onRemote)
  realtime.on?.(EVT_AWARENESS_BYE, _onBye)

  // First publish + heartbeats so other peers see us; also forces a
  // roundtrip that surfaces any peers that joined before us.
  _setSelf(localState)
  _publish()
  const keepaliveTimer = setInterval(_publish, KEEPALIVE_MS)

  return { setLocalState, getLocalState, getStates, on, destroy }
}
