import { io, type Socket } from 'socket.io-client'

import { resolveSiteName } from '@/platform/realtime'
import { showCalendarAlert } from '@/utils/calendarAlert'

declare global {
  interface Window {
    site_name?: string
    socketio_port?: string
  }
}

const socketUrl = () => {
  const host = window.location.hostname
  const siteName = resolveSiteName(window)
  const socketio_port = window.socketio_port || __SOCKETIO_PORT__
  const port = window.location.port ? `:${socketio_port}` : ''
  const protocol = port ? 'http' : 'https'
  return `${protocol}://${host}${port}/${siteName}`
}

/**
 * One way to reach the site's socket.io server, shared by every app's socket
 * module — they each keep their own options (meet insists on websocket-first,
 * for one), but the URL arithmetic lives once.
 */
export function createSiteSocket(options: Parameters<typeof io>[1] = {}): Socket {
  ensureSuiteSocket()
  return io(socketUrl(), {
    withCredentials: true,
    reconnectionAttempts: 5,
    ...options,
  })
}

// The listeners the whole suite wants regardless of app — event reminders —
// live on one connection of their own. App layouts create a socket per mount
// and never dispose it, so putting these on every app socket would replay one
// alert once per accumulated connection. This socket is created once and
// reconnects without a cap: a reminder should survive a laptop lid.
let suiteSocket: Socket | null = null

function ensureSuiteSocket() {
  if (suiteSocket) return
  suiteSocket = io(socketUrl(), { withCredentials: true })
  suiteSocket.on('calendar_alert', showCalendarAlert)
}
