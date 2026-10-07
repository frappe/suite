import { afterEach, describe, expect, it, vi } from 'vitest'

import { Presence } from './presence'

const MINE = ['sc:mine-now', 'sc:mine-next']
const ME = 2 ** 31 + 1
const PEER = 2 ** 31 + 2

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
    mine: (room: string) => MINE.includes(room),
    at: () => at,
    sends: () => sends,
    ahead: (beyond: number) => ahead.push(beyond),
  }
  const presence = new Presence(socket, hooks)
  const hear = (event: string, message: object) =>
    handlers.get(`suite_collab_presence${event}`)!(message)
  const answer = (roster: object[] = [], carets: object[] = [], rooms = MINE) =>
    presence.answered({ rooms, pid: ME, roster, count: roster.length, carets }, rooms)
  const remote = () => new Map([...presence.awareness.getStates()].filter(([id]) => id !== 0))
  return { presence, hear, answer, emitted, ahead, handlers, remote }
}

const caret = { anchor: { type: null, tname: 'f', item: { client: 7, clock: 3 }, assoc: 0 } }
const cursor = { ...caret, head: caret.anchor }

afterEach(() => vi.useRealTimers())

describe('collab presence', () => {
  it('lists the other tabs the realtime service answers with, by the user it verified', () => {
    const { presence, answer } = setup()

    answer([
      { room: MINE[0], pid: PEER, user: 'b@x.com' },
      { room: MINE[1], pid: PEER, user: 'b@x.com' },
      { room: MINE[0], pid: ME, user: 'a@x.com' },
      { room: 'sc:other-document', pid: PEER + 1, user: 'c@x.com' },
    ])

    expect(presence.peers).toEqual([
      { pid: PEER, user: 'b@x.com', color: expect.stringMatching(/^#/) },
    ])
  })

  it('keeps a peer until it has left every room this tab shares with it', () => {
    const { presence, answer, hear, remote } = setup()
    answer()
    hear('_join', { room: MINE[0], pid: PEER, user: 'b@x.com' })
    hear('_join', { room: MINE[1], pid: PEER, user: 'b@x.com' })
    hear('', { room: MINE[0], states: [{ pid: PEER, user: 'b@x.com', n: 1, state: { cursor } }] })

    hear('_gone', { room: MINE[0], pid: PEER })
    const halfway = [presence.peers.length, remote().size]
    hear('_gone', { room: MINE[1], pid: PEER })

    expect(halfway).toEqual([1, 1])
    expect([presence.peers, remote().size]).toEqual([[], 0])
  })

  it('draws a peer’s caret under its pid with the verified user, whatever user the tab claimed', () => {
    const { hear, answer, remote, presence } = setup()
    answer([{ room: MINE[0], pid: PEER, user: 'b@x.com' }])

    hear('', {
      room: MINE[0],
      states: [{ pid: PEER, user: 'b@x.com', n: 2, state: { cursor, user: { id: 'admin' } } }],
    })

    const state = remote().get(PEER)
    expect(state?.user.id).toBe('b@x.com')
    expect(state?.user.color).toMatch(/^#[0-9A-F]{6}$/)
    expect(state?.cursor).toEqual({ anchor: caret.anchor, head: caret.anchor })
    expect(presence.awareness.getLocalState()).toEqual({})
  })

  it('a caret that is not a position draws nothing, and its stray fields never reach the cursor plugin', () => {
    const { hear, answer, remote } = setup()
    answer([{ room: MINE[0], pid: PEER, user: 'b@x.com' }])
    const weird = [
      { anchor: { item: { client: 'x', clock: 1 } }, head: caret.anchor },
      { anchor: { type: null, tname: null, item: null }, head: caret.anchor },
      { anchor: caret.anchor },
      'here',
    ]

    const drawn = weird.map((bad, n) => {
      hear('', {
        room: MINE[0],
        states: [{ pid: PEER, user: 'b', n: n + 1, state: { cursor: bad } }],
      })
      return remote().get(PEER)?.cursor
    })
    hear('', {
      room: MINE[0],
      states: [
        {
          pid: PEER,
          user: 'b',
          n: 9,
          state: { cursor: { anchor: { ...caret.anchor, evil: 1 }, head: caret.anchor } },
        },
      ],
    })

    expect(drawn).toEqual([null, null, null, null])
    expect(remote().get(PEER)?.cursor.anchor).toEqual(caret.anchor)
  })

  it('ignores a batch for another document’s room and a tab it has not heard join', () => {
    const { hear, answer, remote } = setup()
    answer()

    hear('', {
      room: 'sc:other-document',
      states: [{ pid: PEER, user: 'b@x.com', n: 1, state: { cursor } }],
    })
    hear('', { room: MINE[0], states: [{ pid: ME, user: 'a@x.com', n: 1, state: { cursor } }] })

    expect(remote().size).toBe(0)
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
    expect(emitted.at(-1)).toEqual({ rooms: MINE, state: { cursor: { step: 49 }, at: 12 } })
  })

  it('a viewer, a tab in no room and a hidden tab send nothing', async () => {
    vi.useFakeTimers()
    const viewer = setup({ sends: false })
    viewer.answer()
    const outside = setup()
    const hidden = setup()
    hidden.answer()
    hidden.emitted.length = 0

    for (const tab of [viewer, outside]) tab.presence.awareness.setLocalStateField('cursor', 1)
    await vi.advanceTimersByTimeAsync(200)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    hidden.presence.awareness.setLocalStateField('cursor', 1)
    await vi.advanceTimersByTimeAsync(200)
    visibility.mockRestore()

    expect([viewer.emitted, outside.emitted, hidden.emitted]).toEqual([[], [], []])
  })

  it('a peer that has applied more than this tab asks for a repair', () => {
    const { hear, answer, ahead } = setup({ at: 4 })
    answer([{ room: MINE[0], pid: PEER, user: 'b@x.com' }])

    hear('', { room: MINE[0], states: [{ pid: PEER, user: 'b@x.com', n: 1, state: { at: 9 } }] })

    expect(ahead).toEqual([9])
  })

  it('a dropped socket forgets every peer and caret, and a closed one stops listening', () => {
    const { presence, hear, answer, remote, handlers } = setup()
    answer([{ room: MINE[0], pid: PEER, user: 'b@x.com' }])
    hear('', { room: MINE[0], states: [{ pid: PEER, user: 'b@x.com', n: 1, state: { cursor } }] })

    presence.clear()
    const cleared = [presence.peers, remote().size]
    presence.close()

    expect(cleared).toEqual([[], 0])
    expect([...handlers.keys()]).toEqual([])
  })
})
