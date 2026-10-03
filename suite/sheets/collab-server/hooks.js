// The hocuspocus binding: what this server does at connect, once connected,
// and at disconnect. `index.js` boots a server around it; this file holds no
// process state, so `node --test` drives the whole lifecycle.
//
// It is written against the installed `@hocuspocus/server` 4.6.0, read rather
// than remembered. `test/hocuspocus-contract.test.js` asserts every fact below
// against the installed package, so a version bump that moves one fails there
// instead of in production.
//
//   * `onAuthenticate` is handed `connectionConfig`, not `connection`. There
//     is no `Connection` object yet: the payload is `onAuthenticatePayload`
//     (`src/types.ts:320`) and hocuspocus builds the connection afterwards,
//     copying `connectionConfig.readOnly` into it
//     (`src/ClientConnection.ts:271`). Setting `readOnly` here is what makes a
//     READ or COMMENT caller read-only from its first message.
//
//   * `connected` is the first hook that carries the live `Connection`
//     (`connectedPayload`, `src/types.ts:367`). The recheck starts here,
//     because only here is there an object whose capability can be changed.
//
//   * `connection.readOnly` is read per message, at `src/MessageReceiver.ts`
//     217 and 259, so flipping it mid-session drops the caller's next update.
//     A downgrade needs nothing else.
//
//   * `connection.close(event)` is the only close on the object: `disconnect`
//     and `terminate` do not exist on `Connection`. It removes the connection
//     from the document (no more fan-out, awareness dropped), fires the
//     `onDisconnect` hook, and drops the route in `ClientConnection`, so the
//     caller can neither read nor write afterwards.
//
//   * `connection.webSocket.close(code, reason)` ends the socket itself.
//     §6.7 says disconnect, and `Connection.close` alone leaves the TCP
//     connection open, so a revoke does both.

import { randomUUID } from 'node:crypto'

import { DEFAULT_RECHECK_MS, startAccessRecheck } from './access-recheck.js'
import { parseToken } from './connection-token.js'

// `Forbidden` in `@hocuspocus/common/src/CloseEvents.ts`. Copied rather than
// imported: that package is a transitive dependency of `@hocuspocus/server`,
// not one this server declares.
export const REVOKED = { code: 4403, reason: 'Forbidden' }

// A revoked or expired caller must stop reading and stop writing (§6.7).
//
// Three steps, in this order, because each one is useful on its own if a later
// one fails:
//   1. `readOnly` stops the next update even if nothing else works.
//   2. `close()` removes the connection from the document and drops the route,
//      so no further broadcast reaches it and no further message is applied.
//   3. `webSocket.close()` ends the socket, which is the disconnect §6.7 asks
//      for. The browser opens one provider per socket
//      (`frontend/src/apps/sheets/collab/hocuspocus-client.js`), so this drops
//      exactly the one document whose access was revoked.
//
// Returns true when the socket is gone. A false return means the caller is
// read-only and cut off from the document but the socket survived; it is
// logged as an error, because that is the state §6.7 does not accept.
export function closeConnection(connection, reason = REVOKED.reason) {
	if (!connection) return false

	connection.readOnly = true

	let detached = false
	try {
		connection.close({ code: REVOKED.code, reason })
		detached = true
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('[collab-server] Connection.close failed', error)
	}

	let socketClosed = false
	try {
		const socket = connection.webSocket
		if (typeof socket?.close === 'function') {
			socket.close(REVOKED.code, reason)
			socketClosed = true
		}
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('[collab-server] websocket close failed', error)
	}

	if (!socketClosed) {
		// eslint-disable-next-line no-console
		console.error(
			'[collab-server] revoked connection: the socket is still open. ' +
				`It is read-only and ${detached ? 'detached from the document' : 'STILL ATTACHED'}.`,
		)
	}
	return socketClosed
}

// Builds the hooks. `check` is the one required argument — it is
// `frappe-client.checkAccess` in `index.js` and a fake in the tests, and
// injecting it keeps this file free of `env.js`, which validates env vars at
// import time. The rest is what the tests steer.
export function createHooks({
	check,
	close = closeConnection,
	newConnectionId = randomUUID,
	timers = globalThis,
	log = console,
} = {}) {
	if (typeof check !== 'function') {
		throw new TypeError('collab-server: createHooks needs a check function')
	}

	return {
		async onAuthenticate({ token, documentName, connectionConfig }) {
			// `parseToken` refuses a token that carries neither a session nor a
			// link, so nothing below can turn into an unauthenticated hit.
			const credentials = parseToken(token)

			// Fail closed, and loudly. A hocuspocus version that stops handing
			// this hook a `connectionConfig` would otherwise leave every caller
			// read-write, which is the exact failure this whole file exists to
			// stop. Refuse the connection instead.
			if (!connectionConfig) {
				throw new Error(
					'collab-server: onAuthenticate got no connectionConfig. The ' +
						'installed @hocuspocus/server does not match this binding; ' +
						'read-only cannot be enforced, so the connection is refused.',
				)
			}

			const access = await check(credentials, documentName)
			if (!access.canRead) throw new Error(`Forbidden: ${access.reason || 'no read access'}`)

			// Read-only caller: keep the connection (they receive updates and
			// publish awareness) but their own document updates are dropped
			// before fan-out. Hocuspocus copies this into the `Connection` it
			// is about to build.
			connectionConfig.readOnly = !access.canWrite

			// Becomes the connection context. `connectionId` is the server's own
			// name for this socket: two Guests share a user and are told apart
			// by it, and neither can choose it.
			return {
				user:         access.user,
				isGuest:      access.isGuest,
				connectionId: newConnectionId(),
				fullName:     access.fullName,
				initials:     access.initials,
				userImage:    access.userImage,
				canWrite:     access.canWrite,
				recheck:      null,
				recheckSeconds: access.recheckSeconds,
				// The recheck re-asks with the credentials the connection opened
				// with. It travels as a bound call, not as the credentials
				// themselves: the context is passed to every extension and to
				// every later hook, and the `sid` in it is the caller's whole
				// session. It stays in this closure, where it already was.
				askAgain: () => check(credentials, documentName),
			}
		},

		// First hook with the live connection, so the first place a later
		// answer can be applied to anything (§6.7).
		async connected({ documentName, context, connection }) {
			if (!context?.askAgain || !connection) return

			const recheck = startAccessRecheck({
				check: context.askAgain,
				canWrite: context.canWrite,
				intervalMs: (context.recheckSeconds || DEFAULT_RECHECK_MS / 1000) * 1000,
				timers,
				onCapability: ({ canWrite }) => {
					connection.readOnly = !canWrite
					log.log(`[collab-server] ${documentName}: write=${canWrite}`)
				},
				onRevoke: ({ reason }) => {
					log.log(`[collab-server] ${documentName}: closing (${reason})`)
					close(connection, reason)
				},
			})

			context.recheck = recheck

			// The reliable stop. `onDisconnect` reads the context hocuspocus
			// holds, which a later `onTokenSync` may replace; this callback is
			// held by the connection itself and fires on every close path,
			// including a dropped socket.
			connection.onClose(() => recheck.stop())
		},

		async onDisconnect({ context }) {
			// A socket that is gone must not keep asking Frappe about itself.
			context?.recheck?.stop()
		},

		onListen({ port }) {
			// One line, easy to grep in supervisor logs.
			log.log(`[collab-server] listening on :${port}`)
		},
	}
}
