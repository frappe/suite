// Hocuspocus collab server — authoritative Y.Doc per sheet, durable in
// `Sheet Collab State`, fanned out over websocket.
//
// Boot sequence:
//   1. Load env config (fail fast on missing required values).
//   2. Build the Database extension wired to Frappe's load/persist endpoints.
//   3. Optionally add Redis pub/sub for multi-instance scale-out.
//   4. Start the server on $COLLAB_HOST:$COLLAB_PORT.
//
// Auth happens in `onAuthenticate`: the browser forwards its Frappe `sid`
// cookie and any link credentials as the connection token, we POST them to
// check_collab_access, and reject the socket if the caller can't read the
// sheet. Read-only callers stay connected (so they see updates and emit
// awareness) but their own updates are dropped server-side via
// `connection.readOnly = true`.
//
// Auth does not end there. §6.7 makes access a live question, so every
// accepted connection starts a recheck on the cadence Frappe states in its
// answer. A revoked grant or an expired link closes the socket; a downgrade
// across the EDIT line turns the open connection read-only. The policy is in
// `access-recheck.js` with the transport injected, so it is tested without a
// server; this file is only the binding.
//
// Identity is Frappe's answer, never the token's. A Guest comes back as
// "Guest" with no avatar, and the per-connection id below is what tells two
// Guests apart — generated here, so nothing a browser sends can name it.

import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { Redis } from '@hocuspocus/extension-redis'

import { randomUUID } from 'node:crypto'

import { config } from './env.js'
import { DEFAULT_RECHECK_MS, startAccessRecheck } from './access-recheck.js'
import { parseToken } from './connection-token.js'
import { checkAccess, loadState, persistState } from './frappe-client.js'

const extensions = [
	new Database({
		// Hocuspocus calls fetch() once per document on first open. We return
		// the persisted Y.Doc binary or null — null tells Hocuspocus to start
		// from an empty doc, and the first browser to connect hydrates it
		// from `sheets_data` (see frontend/src/collab/hocuspocus-client.js).
		fetch: async ({ documentName }) => {
			const { ydoc_state } = await loadState(documentName)
			return ydoc_state ? Buffer.from(ydoc_state, 'base64') : null
		},

		// Debounced by the extension — defaults are 2s debounce / 10s max
		// wait, plus a flush on last-disconnect. Each call is one HTTP POST
		// to Frappe with the full Y.Doc binary, so we don't want it hot.
		store: async ({ documentName, state }) => {
			const b64 = Buffer.from(state).toString('base64')
			await persistState(documentName, b64, state.byteLength)
		},
	}),
]

if (config.redisHost) {
	extensions.push(new Redis({
		host: config.redisHost,
		port: config.redisPort,
	}))
}

const server = new Server({
	port: config.port,
	extensions,

	async onAuthenticate({ token, documentName, connection }) {
		// `parseToken` refuses a token that carries neither a session nor a
		// link, so nothing below can turn into an unauthenticated hit.
		const credentials = parseToken(token)

		const access = await checkAccess(credentials, documentName)
		if (!access.canRead) throw new Error(`Forbidden: ${access.reason || 'no read access'}`)

		// Read-only caller: keep the connection (they receive updates and
		// publish awareness) but their own document updates are dropped
		// before fan-out. This is enforced inside Hocuspocus.
		connection.readOnly = !access.canWrite

		const recheck = startAccessRecheck({
			check: () => checkAccess(credentials, documentName),
			canWrite: access.canWrite,
			intervalMs: (access.recheckSeconds || DEFAULT_RECHECK_MS / 1000) * 1000,
			onCapability: ({ canWrite }) => {
				connection.readOnly = !canWrite
				// eslint-disable-next-line no-console
				console.log(`[collab-server] ${documentName}: write=${canWrite}`)
			},
			onRevoke: ({ reason }) => {
				// eslint-disable-next-line no-console
				console.log(`[collab-server] ${documentName}: closing (${reason})`)
				closeConnection(connection)
			},
		})

		// Attached to the connection context — used by awareness payloads,
		// surfaces in logs, and carries the recheck so `onDisconnect` can stop
		// it. `connectionId` is the server's own name for this socket: two
		// Guests share a user and are told apart by it, and neither can choose
		// it.
		return {
			user:         access.user,
			isGuest:      access.isGuest,
			connectionId: randomUUID(),
			fullName:     access.fullName,
			initials:     access.initials,
			userImage:    access.userImage,
			canWrite:     access.canWrite,
			recheck,
		}
	},

	async onDisconnect({ context }) {
		// A socket that is gone must not keep asking Frappe about itself.
		context?.recheck?.stop()
	},

	onListen({ port }) {
		// One line, easy to grep in supervisor logs.
		// eslint-disable-next-line no-console
		console.log(`[collab-server] listening on :${port}`)
	},
})

// Hocuspocus hands `onAuthenticate` a per-connection settings object. Closing
// one mid-session is not part of the hook contract, so this tries the methods
// the transport exposes and leaves the connection read-only if it finds none:
// a caller Drive has revoked must not keep writing, whatever the socket does.
//
// Read-only is not what §6.7 asks for. It asks for a disconnect, because a
// revoked reader keeps receiving the whole document until they close the tab.
// So the fallback is loud: an operator has to be able to see that the socket
// stayed open, and the deploy gate has to check this against the installed
// `@hocuspocus/server` rather than against this comment.
export function closeConnection(connection) {
	connection.readOnly = true
	for (const method of ['close', 'disconnect', 'terminate']) {
		if (typeof connection?.[method] === 'function') {
			connection[method]()
			return true
		}
	}
	// eslint-disable-next-line no-console
	console.error(
		'[collab-server] revoked connection could not be closed: the transport ' +
			'exposes no close/disconnect/terminate. It is read-only but still reading.',
	)
	return false
}

await server.listen()
