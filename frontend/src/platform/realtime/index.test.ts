import { describe, expect, it, vi } from 'vitest'

import { createRealtime, type SocketLike } from './index'

class FakeSocket implements SocketLike {
  connected = false
  handlers = new Map<string, Set<(...args: any[]) => void>>()
  emitted: Array<[string, ...any[]]> = []

  on(event: string, handler: (...args: any[]) => void) {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
    return this
  }
  off(event: string, handler?: (...args: any[]) => void) {
    if (handler) this.handlers.get(event)?.delete(handler)
    else this.handlers.delete(event)
    return this
  }
  emit(event: string, ...args: any[]) {
    this.emitted.push([event, ...args])
    return this
  }
  trigger(event: string, ...args: any[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }
}

describe('realtime', () => {
  it('creates one lazy credentialed socket and cleans subscriptions', () => {
    const socket = new FakeSocket()
    const factory = vi.fn<(url: string, options: Record<string, unknown>) => SocketLike>(() => socket)
    const realtime = createRealtime({
      io: factory,
      siteName: 'slides.localhost',
      socketioPort: 9000,
      window,
    })
    const handler = vi.fn()
    const cleanup = realtime.subscribe('doc_update', handler)
    realtime.subscribe('list_update', vi.fn())

    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0]?.[0]).toContain('/slides.localhost')
    expect(factory.mock.calls[0]?.[1]).toMatchObject({ withCredentials: true, reconnection: true })
    socket.trigger('doc_update', { name: 'n1' })
    expect(handler).toHaveBeenCalledOnce()
    cleanup()
    socket.trigger('doc_update', { name: 'n1' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('reference-counts rooms and rejoins them before reconnect callbacks', () => {
    const socket = new FakeSocket()
    const realtime = createRealtime({ io: () => socket, siteName: 'site', window })
    const first = realtime.joinDoc('Drive Node', 'n1')
    const second = realtime.joinDoc('Drive Node', 'n1')
    const reconnect = vi.fn()
    realtime.onReconnect(reconnect)

    socket.connected = true
    socket.trigger('connect')
    expect(socket.emitted.filter(([event]) => event === 'doc_subscribe')).toEqual([
      ['doc_subscribe', 'Drive Node', 'n1'],
    ])
    first()
    expect(socket.emitted.some(([event]) => event === 'doc_unsubscribe')).toBe(false)
    second()
    expect(socket.emitted.at(-1)).toEqual(['doc_unsubscribe', 'Drive Node', 'n1'])

    const leave = realtime.joinDoctype('Drive Node')
    socket.trigger('connect')
    expect(reconnect).toHaveBeenCalledOnce()
    expect(socket.emitted).toContainEqual(['doctype_subscribe', 'Drive Node'])
    leave()
  })
})
