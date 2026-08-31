import { io, type Socket } from 'socket.io-client'

import { showCalendarAlert } from '@/utils/calendarAlert'

declare global {
	interface Window {
		site_name?: string
		socketio_port?: string
	}
}

/**
 * One way to reach the site's socket.io server, shared by every app's socket
 * module — they each keep their own options (meet insists on websocket-first,
 * for one), but the URL arithmetic lives once, and so do the listeners the
 * whole suite wants regardless of app, like event reminders.
 */
export function createSiteSocket(options: Parameters<typeof io>[1] = {}): Socket {
	const host = window.location.hostname
	const siteName = window.site_name || host
	const socketio_port = window.socketio_port || __SOCKETIO_PORT__
	const port = window.location.port ? `:${socketio_port}` : ''
	const protocol = port ? 'http' : 'https'
	const socket = io(`${protocol}://${host}${port}/${siteName}`, {
		withCredentials: true,
		reconnectionAttempts: 5,
		...options,
	})
	attachSuiteListeners(socket)
	return socket
}

/** Listeners every suite app subscribes to, whichever one is open. */
export function attachSuiteListeners(socket: Socket) {
	socket.on('calendar_alert', showCalendarAlert)
}
