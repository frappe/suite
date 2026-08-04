// Peer-to-peer Yjs provider — the collab transport Suite's Writer uses.
//
// Where the Hocuspocus client talks to a server that owns an authoritative
// Y.Doc, this one has no server in the data plane at all. Peers exchange
// updates directly over WebRTC; `signal.frappe.cloud` only introduces them to
// each other, and TURN relays the media when a NAT won't let two peers connect
// directly. Nothing about the document passes through Frappe until a peer
// flushes state via `collab/persistence.js`.
//
// What that buys: no process to deploy, monitor, or scale — the reason Suite's Writer
// ships collaboration without any per-product infrastructure.
//
// What it costs, stated plainly because the trade is real:
//
//   * No authoritative server doc. Two peers who can never reach each other
//     (both behind a NAT TURN can't traverse) edit in parallel and only
//     reconcile through the backend merge on save.
//   * No read-only enforcement, and no backstop behind it. Any peer can send
//     to any other, so a viewer who joins the room can publish updates into the
//     session — and those updates become durable. `save_collab_state` re-checks
//     write permission, but it checks who is *posting*, not whose edits are in
//     the payload: a writer saves `encodeStateAsUpdate(doc)`, the whole
//     document, viewer's edits included. Filtering at save time is not
//     available as a fix; full state is what makes concurrent saves mergeable.
//
//     Net effect: a user shared read-only on a sheet can land a permanent edit
//     whenever a writer is connected. Accepted, matching Writer, which ships
//     the same exposure with unencrypted rooms. Closing it means either
//     withholding room keys from viewers (costing them live view entirely) or
//     a signed-update layer above y-webrtc. Room encryption still bounds the
//     blast radius to people already shared on the sheet.
//
// Room access is gated by encryption, not by the signaling server, which
// authenticates nobody: `password` is a per-sheet key handed out by
// `sheets.collab.get_collab_session` only to users who pass a read check.
// y-webrtc derives a symmetric key from it and encrypts all room traffic, so a
// peer who guesses the room name without the key sees ciphertext. Writer runs
// its rooms unencrypted; we don't, because a spreadsheet is likelier to hold
// data worth reading than a document is.

import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'

import { hydrateYDoc } from './ydoc.js'

const META_MAP  = '__collab_meta'
const META_BOOT = 'bootstrapped'

/**
 * @param {object}   opts
 * @param {import('yjs').Doc} opts.doc   - Y.Doc to attach (server state may
 *                                         already have been applied to it)
 * @param {string}   opts.sheetId         - backend Sheet docname
 * @param {string}   opts.room            - signaling room id
 * @param {string}   opts.password        - per-sheet room encryption key
 * @param {string[]} opts.signaling       - signaling server URLs
 * @param {object[]} [opts.iceServers]    - STUN/TURN config
 * @param {() => object} [opts.getSnapshot] - engine snapshot used to seed a
 *                                            never-opened sheet
 * @param {(state: 'connected'|'disconnected') => void} [opts.onStatusChange]
 * @param {typeof WebrtcProvider} [opts._Provider]        - test seam
 * @param {typeof IndexeddbPersistence|null} [opts._Persistence] - test seam;
 *                                            pass null to skip local caching
 */
export function createWebrtcClient({
	doc,
	sheetId,
	room,
	password,
	signaling,
	iceServers,
	getSnapshot,
	onStatusChange,
	_Provider = WebrtcProvider,
	_Persistence = IndexeddbPersistence,
} = {}) {
	if (!doc || !sheetId || !room) {
		throw new Error('createWebrtcClient: doc, sheetId and room are required')
	}
	if (!password) {
		// Refusing here is deliberate. y-webrtc treats a missing password as
		// "unencrypted room", which would silently turn the access check into
		// nothing at all — the one failure mode this design can't tolerate.
		throw new Error('createWebrtcClient: room password is required')
	}

	// Local cache. Also what makes a reopened sheet paint instantly instead of
	// waiting on a peer or the backend round-trip.
	const local = _Persistence ? new _Persistence(room, doc) : null

	const provider = new _Provider(room, doc, {
		signaling,
		password,
		peerOpts: { config: { iceServers } },
	})

	provider.on('status', ({ connected }) => {
		onStatusChange?.(connected ? 'connected' : 'disconnected')
	})

	// Two independent triggers, because either can be the moment we first know
	// whether this sheet has ever been opened: the local cache finishing its
	// read, or the first peer completing a sync. Both funnel into the same
	// idempotent check.
	provider.on('synced', _maybeBootstrap)
	local?.on('synced', _maybeBootstrap)

	function _maybeBootstrap() {
		const meta = doc.getMap(META_MAP)
		if (meta.get(META_BOOT)) return
		if (!getSnapshot) return  // caller opted out

		// Leader election: the live client with the lowest Yjs clientID among
		// currently-known awareness states (including self) performs the seed.
		//
		// This matters more here than on the websocket path — peer discovery
		// is slower, so "nobody has converged yet" is the common case rather
		// than a rare race. The degenerate outcome is still benign: if two
		// clients both believe they're the leader, they seed the same empty
		// doc from the same deterministic snapshot and land on identical
		// state. Duplicated work, not duplicated data.
		const myId   = doc.clientID
		const peers  = Array.from(provider.awareness.getStates().keys())
		const allIds = peers.includes(myId) ? peers : peers.concat([myId])
		if (Math.min(...allIds) !== myId) return

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
			local?.destroy()
		},
	}
}
