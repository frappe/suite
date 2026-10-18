import { afterEach, describe, expect, it, vi } from 'vitest'

import { Presence } from './presence'

const OWN_ROOMS = ['sc:mine-now', 'sc:mine-next']
const OWN_PID = 2 ** 31 + 1
const PEER_PID = 2 ** 31 + 2
const OWN_ARRIVAL = 5

const presences: Presence[] = []

interface Emitted {
  rooms: string[]
  state: Record<string, unknown>
}

function setup({ sends = true, at = 4 } = {}) {
  type Handler = (message: unknown) => void
  const handlers = new Map<string, Handler>()
  const emitted: Emitted[] = []
  const ahead: number[] = []
  const socket = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (_: string, payload: Emitted) => emitted.push(payload),
  }
  const hooks = {
    isOwnRoom: (room: string) => OWN_ROOMS.includes(room),
    appliedThrough: () => at,
    showsCaret: () => sends,
    peerAhead: (beyond: number) => ahead.push(beyond),
    // The app reads a position as a caret only when it has both ends
    position: (raw: unknown) => {
      const { anchor, head } = (raw ?? {}) as { anchor?: unknown; head?: unknown }
      return anchor && head ? { anchor, head } : null
    },
  }
  const presence = new Presence(socket, hooks)
  presences.push(presence)
  const hear = (event: string, message: object) =>
    handlers.get(`suite_collab_presence${event}`)!(message)
  const answer = (roster: object[] = [], carets: object[] = [], rooms = OWN_ROOMS) => {
    const ack = {
      rooms,
      pid: OWN_PID,
      arrival: OWN_ARRIVAL,
      roster,
      count: roster.length,
      carets,
    }
    presence.answered(ack, rooms)
  }
  const remoteStates = () => {
    const states = [...presence.awareness.getStates()]
    return new Map(states.filter(([id]) => id !== 0))
  }
  return { presence, hear, answer, emitted, ahead, handlers, remoteStates }
}

const caret = {
  anchor: {
    type: null,
    tname: 'f',
    item: { client: 7, clock: 3 },
    assoc: 0,
  },
}
const cursor = {
  ...caret,
  head: caret.anchor,
}

afterEach(() => {
  for (const presence of presences.splice(0)) {
    presence.close()
  }

  vi.useRealTimers()
  vi.restoreAllMocks()
})

const IDLE_MS = 5 * 60_000
const HIDDEN_IDLE_MS = 60_000
const CARET_KEPT_MS = 30_000
const RENEW_MS = 15_000
const SEND_WAIT_MS = 200

function turn(visibility: 'hidden' | 'visible') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('collab presence', () => {
  it('lists the other tabs the realtime service answers with, by the user it verified', () => {
    const { presence, answer } = setup()

    answer([
      { room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com', arrival: 3 },
      { room: OWN_ROOMS[1], pid: PEER_PID, user: 'b@x.com', arrival: 3 },
      { room: OWN_ROOMS[0], pid: OWN_PID, user: 'a@x.com', arrival: OWN_ARRIVAL },
      { room: 'sc:other-document', pid: PEER_PID + 1, user: 'c@x.com', arrival: 4 },
    ])

    expect(presence.peers).toEqual([
      { pid: PEER_PID, user: 'b@x.com', arrival: 3, idleSince: null },
    ])
    expect([presence.ownPid, presence.ownArrival]).toEqual([OWN_PID, OWN_ARRIVAL])
  })

  it('keeps a peer until it has left every room this tab shares with it', () => {
    const { presence, answer, hear, remoteStates } = setup()
    answer()
    hear('_join', { room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' })
    hear('_join', { room: OWN_ROOMS[1], pid: PEER_PID, user: 'b@x.com' })
    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { cursor } }],
    })

    hear('_gone', { room: OWN_ROOMS[0], pid: PEER_PID })
    const halfway = [presence.peers.length, remoteStates().size]
    hear('_gone', { room: OWN_ROOMS[1], pid: PEER_PID })

    expect(halfway).toEqual([1, 1])
    expect([presence.peers, remoteStates().size]).toEqual([[], 0])
  })

  it('draws a peer’s caret under its pid with the verified user, whatever user the tab claimed', () => {
    const { hear, answer, remoteStates, presence } = setup()
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])

    const claimed = {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 2, state: { cursor, user: { id: 'admin' } } }],
    }
    hear('', claimed)

    const state = remoteStates().get(PEER_PID)
    expect(state?.user).toEqual({ id: 'b@x.com' })
    expect(state?.cursor).toEqual({ anchor: caret.anchor, head: caret.anchor })
    expect(presence.awareness.getLocalState()).toEqual({})
  })

  it('ranks a peer by the arrival the service stamped, never one its tab claims, and keeps the first one heard', () => {
    const { presence, answer, hear } = setup()
    answer()

    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { cursor, arrival: 1 } }],
    })
    const beforeStamp = presence.peers[0].arrival
    hear('_join', { room: OWN_ROOMS[1], pid: PEER_PID, user: 'b@x.com', arrival: 7 })
    hear('_join', { room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com', arrival: 2 })

    expect(beforeStamp).toBeNull()
    expect(presence.peers).toEqual([
      { pid: PEER_PID, user: 'b@x.com', arrival: 7, idleSince: null },
    ])
  })

  it('draws a peer’s position only as the app reads it', () => {
    const { hear, answer, remoteStates } = setup()
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])

    const drawnFor = (sent: unknown, index: number) => {
      const batch = {
        room: OWN_ROOMS[0],
        states: [{ pid: PEER_PID, user: 'b', n: index + 1, state: { cursor: sent } }],
      }
      hear('', batch)
      return remoteStates().get(PEER_PID)?.cursor
    }
    const sent = [{ anchor: 1 }, { anchor: 1, head: 2, stray: 3 }]

    expect(sent.map(drawnFor)).toEqual([null, { anchor: 1, head: 2 }])
  })

  it('ignores a batch for another document’s room and a tab it has not heard join', () => {
    const { hear, answer, remoteStates } = setup()
    answer()

    const elsewhere = {
      room: 'sc:other-document',
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { cursor } }],
    }
    hear('', elsewhere)
    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: OWN_PID, user: 'a@x.com', n: 1, state: { cursor } }],
    })

    expect(remoteStates().size).toBe(0)
  })

  it('sends this tab’s caret at most ten times a second, the latest one last, with what it has applied', async () => {
    vi.useFakeTimers()
    const { presence, answer, emitted } = setup({ at: 12 })
    answer()
    emitted.length = 0

    for (let step = 0; step < 50; step++) {
      presence.awareness.setLocalStateField('cursor', { step })
      await vi.advanceTimersByTimeAsync(10)
    }
    await vi.advanceTimersByTimeAsync(200)

    expect(emitted.length).toBeGreaterThanOrEqual(5)
    expect(emitted.length).toBeLessThanOrEqual(6)
    expect(emitted.at(-1)).toEqual({
      rooms: OWN_ROOMS,
      state: { cursor: { step: 49 }, typed: 0, at: 12, idleFor: null, hiddenFor: null },
    })
  })

  it('carries a tab’s typing count to its peers, so they see it typing while its caret stays put', async () => {
    vi.useFakeTimers()
    const { presence, hear, answer, emitted, remoteStates } = setup()
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])

    presence.awareness.setLocalStateField('typed', 3)
    await vi.advanceTimersByTimeAsync(200)
    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { cursor, typed: 4 } }],
    })

    expect(emitted.at(-1)?.state).toEqual({
      cursor: null,
      typed: 3,
      at: 4,
      idleFor: null,
      hiddenFor: null,
    })
    expect(remoteStates().get(PEER_PID)?.typed).toBe(4)
  })

  it('a viewer, a tab in no room and a hidden tab send nothing', async () => {
    vi.useFakeTimers()
    const viewer = setup({ sends: false })
    viewer.answer()
    const outside = setup()
    const hidden = setup()
    hidden.answer()
    hidden.emitted.length = 0

    for (const tab of [viewer, outside]) {
      tab.presence.awareness.setLocalStateField('cursor', 1)
    }
    await vi.advanceTimersByTimeAsync(200)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    hidden.presence.awareness.setLocalStateField('cursor', 1)
    await vi.advanceTimersByTimeAsync(200)
    visibility.mockRestore()

    expect([viewer.emitted, outside.emitted, hidden.emitted]).toEqual([[], [], []])
  })

  it('sends one message when a tab goes idle and one when it is back, a viewer’s too', async () => {
    vi.useFakeTimers()
    const { answer, emitted } = setup({ sends: false })
    answer()

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    const beforeIdle = emitted.length
    await vi.advanceTimersByTimeAsync(1)
    const idle = emitted.at(-1)?.state
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    window.dispatchEvent(new Event('pointermove'))
    window.dispatchEvent(new Event('keydown'))

    expect(beforeIdle).toBe(0)
    expect(emitted.map(({ state }) => state.idleFor)).toEqual([IDLE_MS, null])
    expect(idle).toMatchObject({ cursor: null, hiddenFor: null })
  })

  it('sends one message when a tab is hidden, its caret with it, and one when it shows again', async () => {
    vi.useFakeTimers()
    const { presence, answer, emitted } = setup()
    answer()
    presence.awareness.setLocalStateField('cursor', cursor)
    await vi.advanceTimersByTimeAsync(SEND_WAIT_MS)
    emitted.length = 0

    turn('hidden')
    await vi.advanceTimersByTimeAsync(CARET_KEPT_MS)
    turn('hidden')
    turn('visible')

    expect(emitted.map(({ state }) => [state.cursor, state.hiddenFor])).toEqual([
      [cursor, 0],
      [cursor, null],
    ])
  })

  it('reads a peer as idle once it reports five minutes without input, or a minute after it was hidden', async () => {
    vi.useFakeTimers()
    const { presence, hear, answer } = setup()
    answer([
      { room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' },
      { room: OWN_ROOMS[0], pid: PEER_PID + 1, user: 'c@x.com' },
    ])
    let changes = 0
    presence.onChange(() => changes++)
    const startedAt = Date.now()
    const hiddenFor = 20_000
    function idleSince() {
      return presence.peers.map((peer) => peer.idleSince)
    }

    hear('', {
      room: OWN_ROOMS[0],
      states: [
        { pid: PEER_PID, user: 'b@x.com', n: 1, state: { idleFor: IDLE_MS } },
        { pid: PEER_PID + 1, user: 'c@x.com', n: 1, state: { hiddenFor } },
      ],
    })
    const heard = idleSince()
    await vi.advanceTimersByTimeAsync(HIDDEN_IDLE_MS - hiddenFor - 1)
    const changesBeforeTheMinute = changes
    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toEqual([startedAt - IDLE_MS, null])
    expect(changes - changesBeforeTheMinute).toBe(1)
    expect(idleSince()).toEqual([startedAt - IDLE_MS, startedAt - hiddenFor])
  })

  it('keeps renewing a shown tab’s caret for others and stops once the tab is hidden', async () => {
    vi.useFakeTimers()
    const { presence, answer, emitted } = setup()
    answer()
    presence.awareness.setLocalStateField('cursor', cursor)
    await vi.advanceTimersByTimeAsync(SEND_WAIT_MS)
    emitted.length = 0
    // What the awareness does every 15 s so others don't drop the caret after 30 s
    async function renew() {
      presence.awareness.setLocalState(presence.awareness.getLocalState())
      await vi.advanceTimersByTimeAsync(RENEW_MS)
    }

    await renew()
    turn('hidden')
    await renew()
    await renew()

    expect(emitted.map(({ state }) => [state.cursor, state.hiddenFor])).toEqual([
      [cursor, null],
      [cursor, 0],
    ])
  })

  it('a peer that has applied more than this tab asks for a repair', () => {
    const { hear, answer, ahead } = setup({ at: 4 })
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])

    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { at: 9 } }],
    })

    expect(ahead).toEqual([9])
  })

  it('a dropped socket forgets every peer and caret, and a closed one stops listening', () => {
    const { presence, hear, answer, remoteStates, handlers } = setup()
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])
    hear('', {
      room: OWN_ROOMS[0],
      states: [{ pid: PEER_PID, user: 'b@x.com', n: 1, state: { cursor } }],
    })

    presence.clear()
    const cleared = [presence.peers, remoteStates().size]
    presence.close()

    expect(cleared).toEqual([[], 0])
    expect([...handlers.keys()]).toEqual([])
  })
})
