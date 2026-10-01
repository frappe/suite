import { describe, expect, it } from 'vitest'
import { createRealtimeAdapter } from './realtime-adapter.js'

function fakeRealtime() {
  const handlers = new Map<string, Set<() => void>>()
  const emitted: unknown[][] = []
  return {
    emitted,
    on: (event: string, cb: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(cb)
    },
    off: (event: string, cb: () => void) => handlers.get(event)?.delete(cb),
    emit: (...args: unknown[]) => emitted.push(args),
    reconnect: () => handlers.get('connect')?.forEach((cb) => cb()),
  }
}

describe('realtime adapter', () => {
  it("joins the sheet's room on start and after every reconnect, and leaves on close", () => {
    const realtime = fakeRealtime()
    const adapter = createRealtimeAdapter({ sheetId: 'SH-1', realtime, callFn: async () => {} })
    realtime.reconnect()

    expect(realtime.emitted).toEqual([
      ['doc_subscribe', 'Sheet', 'SH-1'],
      ['doc_subscribe', 'Sheet', 'SH-1'],
    ])

    adapter.close()
    realtime.reconnect()
    expect(realtime.emitted.at(-1)).toEqual(['doc_unsubscribe', 'Sheet', 'SH-1'])
    expect(realtime.emitted).toHaveLength(3)
  })
})
