import { afterEach, describe, expect, it, vi } from 'vitest'

import { Presence } from './presence'

const OWN_ROOMS = ['sc:mine-now', 'sc:mine-next']
const OWN_PID = 2 ** 31 + 1
const PEER_PID = 2 ** 31 + 2

function setup({ sends = true, at = 4 } = {}) {
  type Handler = (message: unknown) => void
  const handlers = new Map<string, Handler>()
  const emitted: { rooms: string[]; state: { cursor: unknown; at: number } }[] = []
  const ahead: number[] = []
  const socket = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (_: string, payload: (typeof emitted)[number]) => emitted.push(payload),
  }
  const hooks = {
    isOwnRoom: (room: string) => OWN_ROOMS.includes(room),
    appliedThrough: () => at,
    showsCaret: () => sends,
    peerAhead: (beyond: number) => ahead.push(beyond),
  }
  const presence = new Presence(socket, hooks)
  const hear = (event: string, message: object) =>
    handlers.get(`suite_collab_presence${event}`)!(message)
  const answer = (roster: object[] = [], carets: object[] = [], rooms = OWN_ROOMS) => {
    const ack = {
      rooms,
      pid: OWN_PID,
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

afterEach(() => vi.useRealTimers())

describe('collab presence', () => {
  it('lists the other tabs the realtime service answers with, by the user it verified', () => {
    const { presence, answer } = setup()

    answer([
      { room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' },
      { room: OWN_ROOMS[1], pid: PEER_PID, user: 'b@x.com' },
      { room: OWN_ROOMS[0], pid: OWN_PID, user: 'a@x.com' },
      { room: 'sc:other-document', pid: PEER_PID + 1, user: 'c@x.com' },
    ])

    expect(presence.peers).toEqual([
      { pid: PEER_PID, user: 'b@x.com', color: expect.stringMatching(/^#/) },
    ])
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
    expect(state?.user.id).toBe('b@x.com')
    expect(state?.user.color).toMatch(/^#[0-9A-F]{6}$/)
    expect(state?.cursor).toEqual({ anchor: caret.anchor, head: caret.anchor })
    expect(presence.awareness.getLocalState()).toEqual({})
  })

  it('a caret that is not a position draws nothing, and its stray fields never reach the cursor plugin', () => {
    const { hear, answer, remoteStates } = setup()
    answer([{ room: OWN_ROOMS[0], pid: PEER_PID, user: 'b@x.com' }])
    const malformedCursors = [
      { anchor: { item: { client: 'x', clock: 1 } }, head: caret.anchor },
      { anchor: { type: null, tname: null, item: null }, head: caret.anchor },
      { anchor: caret.anchor },
      'here',
    ]

    const drawnFor = (malformedCursor: unknown, index: number) => {
      const batch = {
        room: OWN_ROOMS[0],
        states: [{ pid: PEER_PID, user: 'b', n: index + 1, state: { cursor: malformedCursor } }],
      }
      hear('', batch)
      return remoteStates().get(PEER_PID)?.cursor
    }
    const drawn = malformedCursors.map(drawnFor)
    const stray = {
      pid: PEER_PID,
      user: 'b',
      n: 9,
      state: { cursor: { anchor: { ...caret.anchor, evil: 1 }, head: caret.anchor } },
    }
    hear('', { room: OWN_ROOMS[0], states: [stray] })

    expect(drawn).toEqual([null, null, null, null])
    expect(remoteStates().get(PEER_PID)?.cursor.anchor).toEqual(caret.anchor)
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
    expect(emitted.at(-1)).toEqual({ rooms: OWN_ROOMS, state: { cursor: { step: 49 }, at: 12 } })
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
