import { describe, expect, it, vi } from 'vitest'

import { adapterAt, base64, fakeServer, fakeTime, idle, join, text } from './test-support'
import type { CollabRoom } from './types'

describe('collab room live', () => {
  const type = (room: CollabRoom, word: string) => {
    const ytext = room.doc.getText('t')
    ytext.insert(ytext.length, word)
    return room.flush()
  }
  const row = (server: ReturnType<typeof fakeServer>, rev: number, extra: object = {}) => ({
    lineage: 'L',
    rev,
    schema: 1,
    u: base64(server.rows[rev - 1].bytes),
    ...extra,
  })

  it('two tabs see each other’s edits without waiting for a poll', async () => {
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await idle()
    const pulls = server.pulls.length

    await type(writer, 'hello')

    expect([reader.live, text(reader), reader.appliedThrough]).toEqual(['live', 'hello', 1])
    expect(server.pulls.length).toBe(pulls)
  })

  it('a realtime service that never answers the room set leaves the tab collaborating by polling', async () => {
    fakeTime()
    const server = fakeServer()
    server.realtime.answers = false
    const reader = await join(server.endpoints(), { socket: server.socket(), pollMs: 1000 })
    const writer = await join(server.endpoints(), { socket: server.socket(), pollMs: 1000 })
    const before = reader.live
    await vi.advanceTimersByTimeAsync(5000)

    await type(writer, 'polled')
    await vi.advanceTimersByTimeAsync(6000)

    expect([before, reader.live, text(reader)]).toEqual(['joining', 'polling', 'polled'])
  })

  it('a realtime restart drops tabs to polling and they catch up once it is back', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    server.realtime.sockets.forEach((socket) => socket.drop())
    await type(writer, 'missed')
    await vi.advanceTimersByTimeAsync(5000)
    const whileDown = [reader.live, text(reader)]
    server.realtime.sockets.forEach((socket) => socket.back())
    await vi.advanceTimersByTimeAsync(100)

    expect(whileDown).toEqual(['polling', ''])
    expect([reader.live, text(reader)]).toEqual(['live', 'missed'])
  })

  it('a tab left alone through a long realtime outage goes live again once it is back', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket(), pollMs: 5000 })
    const writer = await join(server.endpoints(), { socket: server.socket(), pollMs: 5000 })
    await vi.advanceTimersByTimeAsync(0)

    server.realtime.sockets.forEach((socket) => socket.drop())
    await vi.advanceTimersByTimeAsync(120_000)
    for (const socket of server.realtime.sockets) socket.connect = () => socket.back()
    await vi.advanceTimersByTimeAsync(6000)
    await type(writer, 'back')
    await vi.advanceTimersByTimeAsync(100)

    expect([reader.live, writer.live, text(reader)]).toEqual(['live', 'live', 'back'])
  })

  it('a writer whose own rows stop coming back three times falls back to polling until one does', async () => {
    fakeTime()
    const server = fakeServer()
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.realtime.publishing = false

    const states = []
    for (const word of ['a', 'b', 'c']) {
      await type(writer, word)
      await vi.advanceTimersByTimeAsync(2000)
      states.push(writer.live)
    }
    server.realtime.publishing = true
    await type(writer, 'd')

    expect(states).toEqual(['live', 'live', 'polling'])
    expect([writer.live, text(writer), writer.appliedThrough]).toEqual(['live', 'abcd', 4])
  })

  it('rows heard out of order wait for the missing one, and a hole that stays open is pulled', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    const writer = await join(server.endpoints())
    await vi.advanceTimersByTimeAsync(0)
    server.realtime.publishing = false
    for (const word of ['a', 'b', 'c', 'd']) await type(writer, word)
    const pulls = server.pulls.length

    socket.hear('suite_collab_row', row(server, 2))
    const waiting = text(reader)
    socket.hear('suite_collab_row', row(server, 1))
    const ordered = text(reader)
    socket.hear('suite_collab_row', row(server, 4))
    await vi.advanceTimersByTimeAsync(900)
    const whileHeld = [text(reader), server.pulls.length - pulls]
    await vi.advanceTimersByTimeAsync(200)

    expect([waiting, ordered, whileHeld]).toEqual(['', 'ab', ['ab', 0]])
    expect([text(reader), server.pulls.length - pulls]).toEqual(['abcd', 1])
  })

  it('a row too big to carry inline is pulled', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    await type(writer, 'x'.repeat(40_000))
    await vi.advanceTimersByTimeAsync(100)

    expect(text(reader).length).toBe(40_000)
  })

  it('a row of another lineage of the document is ignored', async () => {
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    const writer = await join(server.endpoints())
    server.realtime.publishing = false
    await type(writer, 'old copy')

    socket.hear('suite_collab_row', row(server, 1, { lineage: 'other' }))

    expect([text(reader), reader.appliedThrough]).toEqual(['', 0])
  })

  it('a row written by a newer editor is not applied live and the tab follows as an older editor', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints(), {
      socket: server.socket(),
      adapter: adapterAt(2),
    })
    await vi.advanceTimersByTimeAsync(0)
    server.schema.now = 2

    await type(writer, 'newer')
    await vi.advanceTimersByTimeAsync(100)

    expect([text(reader), reader.newerSchema]).toEqual(['', true])
  })

  it('a quarantine heard live sends the tab to be opened again', async () => {
    fakeTime()
    const server = fakeServer()
    const reader = await join(server.endpoints(), { socket: server.socket() })
    const writer = await join(server.endpoints())
    await type(writer, 'bad')
    await vi.advanceTimersByTimeAsync(0)

    server.quarantine(1)
    await vi.advanceTimersByTimeAsync(100)

    expect(reader.needsRebuild).toBe(true)
  })

  it('a live tab learns at once that the document is held, and when it is released, without polling', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    server.hold('change')
    await vi.advanceTimersByTimeAsync(200)
    const whileHeld = [room.held, room.canWrite]
    server.hold()
    await vi.advanceTimersByTimeAsync(200)

    expect(room.live).toBe('live')
    expect(whileHeld).toEqual(['change', false])
    expect([room.held, room.canWrite]).toEqual([null, true])
  })

  it('a socket that gave up reconnecting is asked again when the browser comes online', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    await join(server.endpoints(), { socket })
    socket.connected = false

    window.dispatchEvent(new Event('online'))

    expect(socket.connects).toBe(1)
  })

  it('a tab moves to the next epoch’s rooms early in it and leaves its rooms when closed', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const room = await join(server.endpoints(), { socket })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(300_000)
    const moved = [[...socket.joined], room.live]
    const now = server.roomKeys().keys
    vi.mocked(Math.random).mockRestore()
    await room.close()

    expect(moved).toEqual([now, 'live'])
    expect([...socket.joined]).toEqual([])
  })

  it('a peer’s caret saying it has applied a row this tab never heard makes the tab pull it', async () => {
    fakeTime()
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    const writer = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.realtime.publishing = false
    await type(writer, 'unheard')
    const [key] = server.roomKeys().keys
    const pid = 2 ** 31 + 5

    socket.hear('suite_collab_presence_join', { room: key, pid, user: 'b@x.com' })
    socket.hear('suite_collab_presence', {
      room: key,
      states: [{ pid, user: 'b@x.com', n: 1, state: { at: 1 } }],
    })
    await vi.advanceTimersByTimeAsync(1100)

    expect([reader.live, text(reader), reader.presence?.peers]).toEqual([
      'live',
      'unheard',
      [{ pid, user: 'b@x.com', arrival: null, idleSince: null }],
    ])
  })

  it('a peer’s caret claiming rows that don’t exist makes the tab pull at most once in ten seconds', async () => {
    fakeTime()
    // An epoch has just begun, so the room-key refresh pull comes long after the test ends
    vi.setSystemTime(1_800_000_000_000)
    const server = fakeServer()
    const socket = server.socket()
    const reader = await join(server.endpoints(), { socket })
    await vi.advanceTimersByTimeAsync(0)
    const [key] = server.roomKeys().keys
    const pid = 2 ** 31 + 5
    socket.hear('suite_collab_presence_join', { room: key, pid, user: 'b@x.com' })
    const claim = (n: number, at: unknown) =>
      socket.hear('suite_collab_presence', {
        room: key,
        states: [{ pid, user: 'b@x.com', n, state: { at } }],
      })

    server.pulls.length = 0
    for (let n = 1; n <= 20; n++) {
      claim(n, [2.5, -3, 2 ** 60][n % 3])
      await vi.advanceTimersByTimeAsync(100)
    }
    const oddPulls = server.pulls.length
    for (let n = 21; n <= 270; n++) {
      claim(n, 1e9)
      await vi.advanceTimersByTimeAsync(100)
    }

    expect([reader.live, oddPulls, server.pulls.length]).toEqual(['live', 0, 3])
  })
  it("tells the app when another tab changes the document's comments, and only for this document", async () => {
    fakeTime()
    const server = fakeServer()
    const threadsChanged = vi.fn()
    await join(server.endpoints(), { socket: server.socket(), threadsChanged })
    await vi.advanceTimersByTimeAsync(0)
    threadsChanged.mockClear()

    server.threadsChanged()
    server.realtime.sockets[0].hear('suite_collab_ctl', { lineage: 'another', kind: 'threads' })
    await vi.advanceTimersByTimeAsync(0)

    expect(threadsChanged).toHaveBeenCalledTimes(1)
  })

  it('tells the app to read the comments again once the socket is back, since notices sent meanwhile are lost', async () => {
    fakeTime()
    const server = fakeServer()
    const threadsChanged = vi.fn()
    await join(server.endpoints(), { socket: server.socket(), threadsChanged })
    await vi.advanceTimersByTimeAsync(0)
    threadsChanged.mockClear()

    server.realtime.sockets[0].drop()
    server.threadsChanged()
    await vi.advanceTimersByTimeAsync(5000)
    const whileDown = threadsChanged.mock.calls.length
    server.realtime.sockets[0].back()
    await vi.advanceTimersByTimeAsync(100)

    expect([whileDown, threadsChanged.mock.calls.length]).toEqual([0, 1])
  })
})
