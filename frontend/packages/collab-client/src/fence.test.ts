import { afterEach, describe, expect, it, vi } from 'vitest'

import { fakeServer, fakeTime, join, text } from './test-support'
import type { CollabRoom } from './types'

const FENCE_MS = 120_000

function state(room: CollabRoom) {
  return [room.restoring, room.canWrite]
}

function type(room: CollabRoom, word: string) {
  const ytext = room.doc.getText('t')
  ytext.insert(ytext.length, word)
}

describe('collab room restore fence', () => {
  afterEach(() => vi.restoreAllMocks())

  // Before the pull a live tab spreads after any notice could run
  const HEARD_MS = 10

  it('a live tab stops editing the moment a restore begins and edits again once it lands', async () => {
    fakeTime()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const server = fakeServer()
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)

    server.fence(FENCE_MS)
    await vi.advanceTimersByTimeAsync(HEARD_MS)
    const whileRestoring = state(room)
    await vi.advanceTimersByTimeAsync(200)
    server.fence(null, 'restored')
    await vi.advanceTimersByTimeAsync(HEARD_MS)

    expect(whileRestoring).toEqual([true, false])
    expect(state(room)).toEqual([false, true])
  })

  it('a restore called off lets every tab edit again', async () => {
    fakeTime()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const server = fakeServer()
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.fence(FENCE_MS)
    await vi.advanceTimersByTimeAsync(200)

    server.fence(null)
    await vi.advanceTimersByTimeAsync(HEARD_MS)

    expect(state(room)).toEqual([false, true])
  })

  it('a tab opened during a restore waits, and edits again when the fence lapses unheard', async () => {
    fakeTime()
    const server = fakeServer()
    server.fence(FENCE_MS)
    const room = await join(server.endpoints())
    const opened = state(room)

    server.realtime.publishing = false
    await vi.advanceTimersByTimeAsync(FENCE_MS)

    expect(opened).toEqual([true, false])
    expect(state(room)).toEqual([false, true])
  })

  it('a tab without live updates learns of a restore and its end from its pulls', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints())

    server.fence(FENCE_MS)
    await room.pull()
    const whileRestoring = state(room)
    server.fence(null, 'restored')
    await room.pull()

    expect(whileRestoring).toEqual([true, false])
    expect(state(room)).toEqual([false, true])
  })

  it('work typed before a restore began waits on the tab and goes in once it is called off', async () => {
    fakeTime()
    const server = fakeServer()
    const room = await join(server.endpoints(), { socket: server.socket() })
    await vi.advanceTimersByTimeAsync(0)
    server.fence(FENCE_MS)
    await vi.advanceTimersByTimeAsync(200)
    type(room, 'kept')
    await vi.advanceTimersByTimeAsync(5_000)
    const whileRestoring = [room.paused, room.unsent > 0, server.rows.length]

    server.fence(null)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(whileRestoring).toEqual(['restoring', true, 0])
    expect([room.paused, room.unsent, server.rows.length, text(room)]).toEqual([null, 0, 1, 'kept'])
  })
})
