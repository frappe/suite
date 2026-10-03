// Hocuspocus-backed Yjs provider. Replaces the bespoke `frappe-provider` +
// `realtime-adapter` + `awareness` triple with a single y-websocket
// connection to the collab server.
//
// Why this exists: the previous design relayed every CRDT update through
// `frappe.publish_realtime` and had no authoritative server-side Y.Doc, so
// a brief disconnect could leave a peer with a permanently divergent doc
// (no replay, no resync hook on reconnect). Hocuspocus solves both:
//
//   * Authoritative server-side Y.Doc — reconnects always rebase against
//     it, no silent divergence.
//   * y-protocols awareness on the same socket — presence/cursors get the
//     same reliability as document state.
//   * Read-only sharees stay connected (so they see updates) but the
//     server drops their write attempts before fan-out, enforced via
//     `connection.readOnly` in the collab server's onAuthenticate.
//
// Bootstrap (first-time-open of a sheet) is client-side: when the provider
// reports `synced=true` AND the Y.Doc has no `bootstrapped` flag in its
// `__collab_meta` map, we deterministically pick a leader (lowest active
// clientID) and hydrate from the engine's snapshot inside a transaction
// that sets the flag. Subsequent openers see the flag and skip — even if
// two clients race the first open, the leader rule picks one.

import { HocuspocusProvider } from '@hocuspocus/provider'

import { hydrateYDoc } from './ydoc.js'

const META_MAP = '__collab_meta'
const META_BOOT = 'bootstrapped'

/**
 * @param {object}   opts
 * @param {import('yjs').Doc} opts.doc       - existing (empty) Y.Doc to attach
 * @param {string}   opts.sheetId             - backend Sheet docname
 * @param {string}   opts.url                 - collab server ws URL, e.g. ws://host/collab
 * @param {string}   opts.token               - Frappe `sid` cookie value (auth)
 * @param {() => object} [opts.getSnapshot]   - returns the engine snapshot used
 *                                              to hydrate an empty doc on first
 *                                              open. Optional; if absent, an
 *                                              empty doc stays empty.
 * @param {(state: 'connected'|'disconnected'|'authentication-failed') => void}
 *           [opts.onStatusChange]            - status updates for UI badges
 * @param {typeof HocuspocusProvider} [opts._Provider] - test seam
 */
export function createHocuspocusClient({
  doc,
  sheetId,
  url,
  token,
  getSnapshot,
  onStatusChange,
  _Provider = HocuspocusProvider,
} = {}) {
  if (!doc || !sheetId || !url) {
    throw new Error('createHocuspocusClient: doc, sheetId and url are required')
  }

  const provider = new _Provider({
    url,
    name: sheetId,
    document: doc,
    token,
    onAuthenticationFailed({ reason }) {
      // eslint-disable-next-line no-console
      console.warn(`[collab] auth failed for ${sheetId}: ${reason}`)
      onStatusChange?.('authentication-failed')
    },
    onStatus({ status }) {
      // 'connected' | 'disconnected' | 'connecting'
      onStatusChange?.(status)
    },
    onSynced() {
      // Initial server state has been applied to `doc`. Now safe to
      // decide whether we need to seed the doc for the first time.
      _maybeBootstrap()
    },
  })

  function _maybeBootstrap() {
    const meta = doc.getMap(META_MAP)
    if (meta.get(META_BOOT)) return
    if (!getSnapshot) return // caller opted out

    // Leader election: the live client with the lowest Yjs clientID
    // among the currently-known awareness states (including self)
    // performs the seed. Everyone else waits and converges.
    //
    // Why this is enough: the only race is "two new clients open a
    // brand-new sheet within a few milliseconds of each other, before
    // any persisted state existed." The picked leader writes the
    // `bootstrapped` flag in the same transaction as the seed, so
    // the loser sees a non-empty doc + flag on its next change tick
    // and skips. In the degenerate case where awareness hasn't
    // converged yet, both sides may think they're the leader — they
    // then both seed into an empty doc with the same content,
    // producing exactly the same end state because the seed is
    // deterministic. Duplicated work, not duplicated data.
    const myId = doc.clientID
    const peers = Array.from(provider.awareness.getStates().keys())
    const allIds = peers.includes(myId) ? peers : peers.concat([myId])
    const leader = Math.min(...allIds)
    if (leader !== myId) return

    doc.transact(() => {
      if (meta.get(META_BOOT)) return
      meta.set(META_BOOT, true)
      const snap = getSnapshot()
      if (snap) hydrateYDoc(doc, { sheet: snap })
    }, 'bootstrap')
  }

  return {
    provider,
    awareness: provider.awareness,
    destroy() {
      provider.destroy()
    },
  }
}
