import { describe, expect, it, vi } from 'vitest'

import { createRealtimeAdapter } from './realtime-adapter.js'

/** A socket stand-in: records what the client emits and lets the test fire events. */
function fakeRealtime() {
  const handlers = new Map<string, Set<(message?: unknown) => void>>()
  const emitted: unknown[][] = []
  return {
    emitted,
    on: (event: string, handler: (message?: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off: (event: string, handler: (message?: unknown) => void) =>
      handlers.get(event)?.delete(handler),
    emit: (...args: unknown[]) => emitted.push(args),
    fire: (event: string, message?: unknown) =>
      handlers.get(event)?.forEach((handler) => handler(message)),
  }
}

describe('Sheets realtime adapter', () => {
  it("joins the sheet's own room, again after a reconnect, and leaves it on close", () => {
    const realtime = fakeRealtime()
    const adapter = createRealtimeAdapter({
      sheetId: 'SH-1',
      realtime,
      callFn: vi.fn(async () => {}),
    })
    expect(realtime.emitted).toEqual([['doc_subscribe', 'Sheet', 'SH-1']])

    realtime.fire('connect')
    expect(realtime.emitted).toHaveLength(2)

    adapter.close()
    expect(realtime.emitted.at(-1)).toEqual(['doc_unsubscribe', 'Sheet', 'SH-1'])
    realtime.fire('connect')
    expect(realtime.emitted).toHaveLength(3)
  })

  it("hands on only this sheet's messages", () => {
    const realtime = fakeRealtime()
    const adapter = createRealtimeAdapter({
      sheetId: 'SH-1',
      realtime,
      callFn: vi.fn(async () => {}),
    })
    const received: unknown[] = []
    adapter.on('yjs_update', (message: unknown) => received.push(message))

    realtime.fire('yjs_update', { sheet: 'SH-2', payload: JSON.stringify({ n: 2 }) })
    realtime.fire('yjs_update', { sheet: 'SH-1', payload: JSON.stringify({ n: 1 }) })
    expect(received).toEqual([{ n: 1 }])
  })
})
