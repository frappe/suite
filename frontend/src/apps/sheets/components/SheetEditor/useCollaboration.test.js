import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCollaboration } from './useCollaboration.js'

/**
 * One socket shared by every editor in the test, standing in for the Frappe
 * realtime relay: `yjs_relay` calls are fanned out to every subscriber, the
 * way the server re-emits them to the sheet's room.
 */
function fakeRelay() {
  const handlers = new Map()
  const realtime = {
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event).add(handler)
    },
    off: (event, handler) => handlers.get(event)?.delete(handler),
    emit: () => {},
  }
  const callFn = async (method, { name, event, payload }) => {
    if (method !== 'suite.sheets.api.yjs_relay') throw new Error(`unexpected ${method}`)
    handlers.get(event)?.forEach((handler) => handler({ sheet: name, payload }))
  }
  return { realtime, callFn }
}

function openEditor(relay, user, cleanups) {
  return useCollaboration({
    sheetId: { value: 'SH-1' },
    currentSheet: { value: 'Sheet1' },
    repopulateGrid: () => {},
    _self: user,
    _realtime: relay.realtime,
    _callFn: relay.callFn,
    _watch: (source, callback) => callback(source.value),
    _onUnmounted: (stop) => cleanups.push(stop),
  })
}

describe('useCollaboration', () => {
  const cleanups = []

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanups.splice(0).forEach((stop) => stop())
    delete window.__COLLAB_V2__
    vi.useRealTimers()
  })

  it('shows each editor the other one and where their cursor is, over the relay', () => {
    const relay = fakeRelay()
    const alice = openEditor(relay, 'alice@example.com', cleanups)
    const bob = openEditor(relay, 'bob@example.com', cleanups)
    // Bob joined after Alice's first announcement; her keep-alive reaches him.
    vi.advanceTimersByTime(8_000)

    expect(alice.presentUsers.value.map((u) => u.user)).toEqual(['bob@example.com'])
    expect(bob.presentUsers.value.map((u) => u.user)).toEqual(['alice@example.com'])

    alice.broadcastCursor(3, 4, 'Sheet1', { r0: 3, c0: 4, r1: 5, c1: 6 })
    const cursor = bob.remoteCursors.value.get('alice@example.com')
    expect(cursor).toMatchObject({
      row: 3,
      col: 4,
      subSheet: 'Sheet1',
      range: { r0: 3, c0: 4, r1: 5, c1: 6 },
    })
    // A cursor move keeps the user slot: Bob still sees who Alice is.
    expect(bob.presentUsers.value.map((u) => u.user)).toEqual(['alice@example.com'])
  })

  it('stays on the relay when the old collab_v2 dev flag is set', () => {
    window.__COLLAB_V2__ = true
    const relay = fakeRelay()
    openEditor(relay, 'alice@example.com', cleanups)
    const bob = openEditor(relay, 'bob@example.com', cleanups)
    vi.advanceTimersByTime(8_000)

    expect(bob.presentUsers.value.map((u) => u.user)).toEqual(['alice@example.com'])
  })
})
