// A real `Hocuspocus` over a fake socket.
//
// Nothing here is a stand-in for the library: the server, the `Connection`,
// the document, and the wire format are all the installed
// `@hocuspocus/server`. Only the socket is fake, so a test needs no port and
// no service. Used by `hocuspocus-contract.test.js` to pin the library's
// behaviour and by `hooks.test.js` to drive the real binding against it.

import { Hocuspocus, OutgoingMessage } from '@hocuspocus/server'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'

// The client's first frame: address, MessageType.Auth, submessage type, token.
export function authMessage(documentName, token) {
	const encoder = encoding.createEncoder()
	encoding.writeVarString(encoder, documentName)
	encoding.writeVarUint(encoder, 2)
	encoding.writeVarUint(encoder, 0)
	encoding.writeVarString(encoder, token)
	return encoding.toUint8Array(encoder)
}

// A sync frame carrying a whole Y.Doc as an update, which is what a browser
// sends when someone types.
export function updateMessage(documentName, text) {
	const source = new Y.Doc()
	source.getText('t').insert(0, text)
	return new OutgoingMessage(documentName)
		.createSyncMessage()
		.writeUpdate(Y.encodeStateAsUpdate(source))
		.toUint8Array()
}

export function fakeSocket() {
	return {
		readyState: 1,
		sent: [],
		closed: null,
		send(message) {
			this.sent.push(message)
		},
		close(code, reason) {
			this.closed = { code, reason }
			this.readyState = 3
		},
	}
}

// The auth path crosses several awaits and a hook chain before the connection
// exists. A macrotask turn is enough and costs nothing.
export function settle() {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

// Boots a Hocuspocus with the given hooks, opens one authenticated connection
// to `documentName`, and returns the handles a test needs.
//
// `teardown()` is not optional: `ClientConnection` holds a ping interval that
// keeps `node --test` alive otherwise.
export async function openConnection({
	hooks = {},
	documentName = 'sheet-1',
	token = 'a-session-id',
} = {}) {
	const payloads = {}
	const wrapped = {}
	for (const name of ['onAuthenticate', 'connected', 'onDisconnect']) {
		wrapped[name] = async (payload) => {
			payloads[name] = payload
			return hooks[name]?.(payload)
		}
	}

	const server = new Hocuspocus({ extensions: [], ...wrapped })
	const socket = fakeSocket()
	const client = server.handleConnection(socket, new Request('http://localhost/collab'))
	client.handleMessage(authMessage(documentName, token))
	await settle()

	const connection = payloads.connected?.connection
	const document = server.documents.get(documentName)

	return {
		server,
		client,
		socket,
		payloads,
		connection,
		document,
		text: () => document?.getText('t').toString() ?? '',
		// Type as the browser would, then wait for the server to finish with it.
		async send(text) {
			client.handleMessage(updateMessage(documentName, text))
			await connection?.waitForPendingMessages()
			await settle()
		},
		teardown() {
			client.handleClose({ code: 1000, reason: 'test over' })
		},
	}
}
