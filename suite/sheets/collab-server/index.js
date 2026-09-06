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
// awareness) but their own updates are dropped server-side.
//
// Auth does not end there. §6.7 makes access a live question, so every
// accepted connection starts a recheck on the cadence Frappe states in its
// answer. A revoked grant or an expired link closes the socket; a downgrade
// across the EDIT line turns the open connection read-only.
//
// The policy is in `access-recheck.js` with the transport injected. The
// binding is in `hooks.js`, with the Frappe call and the close injected, so
// `node --test` drives the whole connection lifecycle against the installed
// `@hocuspocus/server`. This file is boot and nothing else.

import { Server } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import { Redis } from '@hocuspocus/extension-redis'

import { config } from './env.js'
import { createHooks } from './hooks.js'
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
	...createHooks({ check: checkAccess }),
})

await server.listen()
