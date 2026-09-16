import { io, type Socket } from 'socket.io-client'

export interface SocketLike {
  connected?: boolean
  on(event: string, handler: (...args: any[]) => void): this
  off(event: string, handler?: (...args: any[]) => void): this
  emit(event: string, ...args: any[]): this
  connect?(): this
  disconnect?(): this
}

export type Room =
  | { type: 'doc'; doctype: string; name: string }
  | { type: 'doctype'; doctype: string }

export interface Realtime {
  subscribe<T = unknown>(event: string, handler: (payload: T) => void): () => void
  onReconnect(handler: () => void): () => void
  join(room: Room): () => void
  joinDoc(doctype: string, name: string): () => void
  joinDoctype(doctype: string): () => void
  socket(): SocketLike
  close(): void
}

export interface CreateRealtimeOptions {
  io?: (url: string, options: Record<string, unknown>) => SocketLike
  window?: Window
  siteName?: string
  socketioPort?: string | number
}

type RoomEntry = { room: Room; count: number }

export function createRealtime(options: CreateRealtimeOptions = {}): Realtime {
  let instance: SocketLike | null = null
  let connectedOnce = false
  const reconnectHandlers = new Set<() => void>()
  const rooms = new Map<string, RoomEntry>()

  function socket(): SocketLike {
    if (instance) return instance
    const targetWindow = options.window ?? window
    const definedSite = typeof __SITE_NAME__ === 'undefined' ? targetWindow.location.hostname : __SITE_NAME__
    const siteName = options.siteName ?? targetWindow.site_name ?? definedSite
    const factory = options.io ?? (io as unknown as CreateRealtimeOptions['io'])!
    instance = factory(resolveSocketUrl(targetWindow, siteName, options.socketioPort), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    })
    instance.on('connect_error', noop)
    instance.on('error', noop)
    instance.on('connect', () => {
      for (const entry of rooms.values()) emitJoin(instance!, entry.room)
      if (connectedOnce) for (const handler of reconnectHandlers) handler()
      connectedOnce = true
    })
    return instance
  }

  function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
    const active = socket()
    active.on(event, handler as (...args: any[]) => void)
    return once(() => active.off(event, handler as (...args: any[]) => void))
  }

  function onReconnect(handler: () => void): () => void {
    reconnectHandlers.add(handler)
    socket()
    return once(() => reconnectHandlers.delete(handler))
  }

  function join(room: Room): () => void {
    const key = roomKey(room)
    const current = rooms.get(key)
    if (current) current.count += 1
    else {
      rooms.set(key, { room, count: 1 })
      const active = socket()
      if (active.connected) emitJoin(active, room)
    }
    return once(() => {
      const entry = rooms.get(key)
      if (!entry) return
      entry.count -= 1
      if (entry.count > 0) return
      rooms.delete(key)
      if (instance) emitLeave(instance, room)
    })
  }

  function close(): void {
    instance?.disconnect?.()
    instance = null
    connectedOnce = false
    rooms.clear()
    reconnectHandlers.clear()
  }

  return {
    subscribe,
    onReconnect,
    join,
    joinDoc: (doctype, name) => join({ type: 'doc', doctype, name }),
    joinDoctype: (doctype) => join({ type: 'doctype', doctype }),
    socket,
    close,
  }
}

export function resolveSocketUrl(
  targetWindow: Pick<Window, 'location'> & Partial<Window>,
  siteName: string,
  configuredPort: string | number =
    targetWindow.socketio_port ?? (typeof __SOCKETIO_PORT__ === 'undefined' ? 9000 : __SOCKETIO_PORT__),
): string {
  const origin = targetWindow.location.origin
  if (!targetWindow.location.port) return `${origin}/${siteName}`
  const protocol = targetWindow.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${targetWindow.location.hostname}:${configuredPort}/${siteName}`
}

function roomKey(room: Room): string {
  return room.type === 'doc' ? `doc:${room.doctype}/${room.name}` : `doctype:${room.doctype}`
}

function emitJoin(socket: SocketLike, room: Room): void {
  if (room.type === 'doc') socket.emit('doc_subscribe', room.doctype, room.name)
  else socket.emit('doctype_subscribe', room.doctype)
}

function emitLeave(socket: SocketLike, room: Room): void {
  if (room.type === 'doc') socket.emit('doc_unsubscribe', room.doctype, room.name)
  else socket.emit('doctype_unsubscribe', room.doctype)
}

function once(cleanup: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    cleanup()
  }
}

function noop(): void {}

const singleton = createRealtime()

export const subscribe = singleton.subscribe
export const onReconnect = singleton.onReconnect
export const joinRoom = singleton.join
export const joinDoc = singleton.joinDoc
export const joinDoctype = singleton.joinDoctype
export const getRealtimeSocket = singleton.socket
export const realtime = singleton

export type { Socket }
