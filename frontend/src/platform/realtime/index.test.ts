import { describe, expect, it, vi } from 'vitest'

import { createRealtime, resolveSocketUrl, type SocketLike } from './index'

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
  disconnect() {
    this.connected = false
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

  it('discovers production and development socket URLs', () => {
    expect(resolveSocketUrl({
      location: {
        origin: 'https://suite.example.com', protocol: 'https:', hostname: 'suite.example.com', port: '',
      } as Location,
    } as Window, 'suite.example.com', 9000)).toBe('https://suite.example.com/suite.example.com')
    expect(resolveSocketUrl({
      location: {
        origin: 'https://slides.localhost:8080', protocol: 'https:', hostname: 'slides.localhost', port: '8080',
      } as Location,
    } as Window, 'slides.localhost', 9000)).toBe('https://slides.localhost:9000/slides.localhost')
  })

  it('closes the tab connection and creates a fresh lazy socket on demand', () => {
    const first = new FakeSocket()
    const second = new FakeSocket()
    const factory = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const realtime = createRealtime({ io: factory, siteName: 'site', window })
    expect(factory).not.toHaveBeenCalled()
    expect(realtime.socket()).toBe(first)
    realtime.close()
    expect(first.connected).toBe(false)
    expect(realtime.socket()).toBe(second)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
