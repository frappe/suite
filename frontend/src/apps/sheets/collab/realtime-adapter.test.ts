import { describe, expect, it, vi } from 'vitest'

import { createRealtime, type SocketLike } from '@/platform/realtime'

import { createRealtimeAdapter } from './realtime-adapter.js'

/** A connected socket stand-in: records what the client emits and lets the test fire events. */
function fakeSocket() {
  const handlers = new Map<string, Set<(message?: unknown) => void>>()
  const emitted: unknown[][] = []
  const socket = {
    connected: true,
    emitted,
    on(event: string, handler: (message?: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
      return socket
    },
    off(event: string, handler?: (message?: unknown) => void) {
      if (handler) handlers.get(event)?.delete(handler)
      return socket
    },
    emit(...args: unknown[]) {
      emitted.push(args)
      return socket
    },
    fire: (event: string, message?: unknown) =>
      handlers.get(event)?.forEach((handler) => handler(message)),
  }
  return socket
}

function sharedRealtime(socket: ReturnType<typeof fakeSocket>) {
  return createRealtime({
    io: () => socket as unknown as SocketLike,
    siteName: 'suite.localhost',
    window,
  })
}

describe('Sheets realtime adapter', () => {
  it("joins the sheet's room on the shared socket, again after a reconnect, and leaves it on close", () => {
    const socket = fakeSocket()
    const adapter = createRealtimeAdapter({
      sheetId: 'SH-1',
      realtime: sharedRealtime(socket),
      callFn: vi.fn(async () => {}),
    })
    expect(socket.emitted).toEqual([['doc_subscribe', 'Sheet', 'SH-1']])

    socket.fire('connect')
    expect(socket.emitted).toHaveLength(2)

    adapter.close()
    expect(socket.emitted.at(-1)).toEqual(['doc_unsubscribe', 'Sheet', 'SH-1'])
    socket.fire('connect')
    expect(socket.emitted).toHaveLength(3)
  })

  it("hands on only this sheet's messages", () => {
    const socket = fakeSocket()
    const adapter = createRealtimeAdapter({
      sheetId: 'SH-1',
      realtime: sharedRealtime(socket),
      callFn: vi.fn(async () => {}),
    })
    const received: unknown[] = []
    const saved: unknown[] = []
    adapter.on('yjs_update', (message: unknown) => received.push(message))
    adapter.onSheet('sheet_saved', (message: unknown) => saved.push(message))

    socket.fire('yjs_update', { sheet: 'SH-2', payload: JSON.stringify({ n: 2 }) })
    socket.fire('yjs_update', { sheet: 'SH-1', payload: JSON.stringify({ n: 1 }) })
    socket.fire('sheet_saved', { sheet: 'SH-2', head_seq: 4 })
    socket.fire('sheet_saved', { sheet: 'SH-1', head_seq: 9 })
    expect(received).toEqual([{ n: 1 }])
    expect(saved).toEqual([{ sheet: 'SH-1', head_seq: 9 }])
  })

  it('says once, loudly, when the socket cannot connect', () => {
    const socket = fakeSocket()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    createRealtimeAdapter({
      sheetId: 'SH-1',
      realtime: sharedRealtime(socket),
      callFn: vi.fn(async () => {}),
    })

    socket.fire('connect_error', new Error('refused'))
    socket.fire('connect_error', new Error('refused'))
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
