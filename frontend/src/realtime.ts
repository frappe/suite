import { io, type Socket } from 'socket.io-client'

import { resolveSiteName } from '@/platform/realtime'

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
  return io(socketUrl(), {
    withCredentials: true,
    reconnectionAttempts: 5,
    ...options,
  })
}
