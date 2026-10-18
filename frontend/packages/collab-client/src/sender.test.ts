import { describe, expect, it, vi } from 'vitest'

import { adapterAt, BIG, browser, fakeServer, join, joinMidPace, reply, text } from './test-support'

describe('collab room', () => {
  it('stamps every push with the schema of the editor that wrote it', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints(), { adapter: adapterAt(3) })
    room.doc.getText('t').insert(0, 'one')
    await room.flush()
    room.doc.getText('t').insert(3, ' two')
    await room.flush()

    expect(server.schemas).toEqual([3, 3])
  })

  it('marks only the push of a closing tab as final', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, 'kept ')
    await room.flush()
    room.doc.getText('t').insert(5, 'on close')

    await room.close()

    expect(server.finals).toEqual([false, true])
    expect(server.rows).toHaveLength(2)
  })

  it('a lost answer is sent again and committed once', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let dropNextAnswer = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (dropNextAnswer) {
        dropNextAnswer = false
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'once')
    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.rows).toHaveLength(1)
    expect([room.saveState, room.unsent]).toEqual(['clean', 0])
  })

  it('a resend that differs from what the server committed stops saving instead of overwriting', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let dropNextAnswer = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (dropNextAnswer) {
        dropNextAnswer = false
        for (const session of server.sessions.values()) session.shas[1] = 'f'.repeat(64)
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'once')
    await vi.advanceTimersByTimeAsync(31_000)

    expect([server.rows.length, room.saveState, room.unsent]).toEqual([1, 'failed', 1])
  })

  it('the unsent count each listener sees follows typing and drops to zero once committed', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    const seen: number[] = []
    room.onChange(() => seen.push(room.unsent))

    room.doc.getText('t').insert(0, 'a')
    room.doc.getText('t').insert(1, 'b')
    room.doc.getText('t').insert(2, 'c')
    await room.flush()

    expect([seen.slice(0, 3), seen.at(-1)]).toEqual([[1, 2, 3], 0])
  })

  it('a long queue of typing behind a busy document is still saved', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let busyAnswersLeft = 5
    endpoints.push = async (body, options) =>
      busyAnswersLeft-- > 0 ? reply(423, { collab: 'busy', retry_ms: 1000 }) : push(body, options)
    const room = await join(endpoints)

    for (let at = 0; at < 130; at++) room.doc.getText('t').insert(at, 'x')
    await vi.advanceTimersByTimeAsync(20_000)

    expect([room.saveState, room.unsent, text(await join(server.endpoints())).length]).toEqual([
      'clean',
      0,
      130,
    ])
  })

  it('a server that forgot what it acknowledged stops saving instead of resending in a loop', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let calls = 0
    endpoints.push = async (body, options) => {
      calls++
      for (const session of server.sessions.values()) session.acked = 0
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'one')
    await vi.advanceTimersByTimeAsync(0)
    for (const session of server.sessions.values()) session.acked = 1
    room.doc.getText('t').insert(3, 'two')
    await vi.advanceTimersByTimeAsync(1000)

    expect([room.saveState, calls < 5]).toEqual(['failed', true])
  })

  it('work committed after access was lost is not reported as unsaved', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      await held
      return answer
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'kept')
    const flushed = room.flush()
    await Promise.resolve()
    server.access.refuse = reply(403, { collab: 'forbidden' })
    await room.pull()
    release()
    await flushed

    expect([room.blocked, room.unsent, room.saveState]).toEqual(['lost_read', 0, 'clean'])
  })

  it('a pause ends when the server answers with anything else', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const answers = [
      reply(423, { collab: 'busy', retry_ms: 1000 }),
      reply(401, { collab: 'signed_out' }),
    ]
    endpoints.push = async () => answers.shift() ?? reply(401, { collab: 'signed_out' })
    const room = await join(endpoints)
    browser.signedIn = 'Guest'

    room.doc.getText('t').insert(0, 'x')
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.blocked, room.paused]).toEqual(['signed_out', null])
  })

  it('a busy document is pushed to again only after the delay it asks for', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let busyAnswersLeft = 2
    let calls = 0
    endpoints.push = async (body, options) => {
      calls++
      if (busyAnswersLeft-- > 0) return reply(423, { collab: 'busy', retry_ms: 1000 })
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'later')

    const flushed = room.flush()
    await vi.advanceTimersByTimeAsync(500)
    expect([calls, room.paused]).toEqual([1, 'busy'])
    await vi.advanceTimersByTimeAsync(2000)
    await flushed

    expect([calls, server.rows.length, room.saveState, room.paused]).toEqual([3, 1, 'clean', null])
  })

  it('a change too big for one push is staged in pieces and committed once', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, BIG)

    await room.flush()

    expect(server.pieces.map((piece) => piece.idx)).toEqual([0, 1, 2])
    expect([server.rows.length, server.stages.size, room.saveState, room.unsent]).toEqual([
      1,
      0,
      'clean',
      0,
    ])
    expect(text(await join(server.endpoints()))).toBe(BIG)
  })

  it('pieces the server lost are staged again into the same stage, and the change commits', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let loseStagedPiece = true
    endpoints.push = async (body, options) => {
      if (loseStagedPiece) server.stages.forEach((staged) => staged.delete(1))
      loseStagedPiece = false
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.pieces).toHaveLength(6)
    expect(new Set(server.pieces.map((piece) => piece.stage)).size).toBe(1)
    expect([server.rows.length, room.saveState]).toEqual([1, 'clean'])
  })

  it('a stage the server refuses is replaced by a new one', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    const ids: string[] = []
    endpoints.stage = async (id, idx, body) => {
      ids.push(id)
      if (ids.length > 1) return stage(id, idx, body)
      return reply(409, { collab: 'stage_conflict' })
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    const [refused, ...rest] = ids
    expect([rest.length, rest.includes(refused), new Set(rest).size]).toEqual([3, false, 1])
    expect([server.rows.length, room.saveState]).toEqual([1, 'clean'])
  })

  it('a document with too many pieces staged is pushed to again after the wait it asks for', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    let stageFull = true
    endpoints.stage = async (id, idx, body) => {
      if (!stageFull) return stage(id, idx, body)
      stageFull = false
      return reply(423, { collab: 'stage_full', retry_ms: 60_000 })
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(59_000)
    expect([room.paused, server.rows.length]).toEqual(['stage_full', 0])
    await vi.advanceTimersByTimeAsync(2_000)

    expect([room.paused, server.rows.length, room.saveState]).toEqual([null, 1, 'clean'])
  })

  it('a change the server finds too large stops saving and says why', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    endpoints.stage = async () => reply(413, { collab: 'too_large' })
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await room.flush()

    expect([room.stopped, room.saveState, server.rows.length]).toEqual(['too_large', 'failed', 0])
  })

  it('a change a proxy refuses for its size stays unsent and saves once uploads get through', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const stage = endpoints.stage
    let proxyRefuses = true
    endpoints.stage = async (id, idx, body) =>
      proxyRefuses
        ? {
            status: 413,
            bytes: new TextEncoder().encode('<html>413 Request Entity Too Large</html>'),
          }
        : stage(id, idx, body)
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(500)
    const refused = [room.paused, room.stopped, room.unsent, server.rows.length]
    proxyRefuses = false
    await vi.advanceTimersByTimeAsync(31_000)

    expect([refused, [room.paused, room.saveState, server.rows.length]]).toEqual([
      ['upload_refused', null, 1, 0],
      [null, 'clean', 1],
    ])
  })

  it('a staged change whose answer was lost is acknowledged without staging it again', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let dropNextAnswer = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (dropNextAnswer) {
        dropNextAnswer = false
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, BIG)

    await vi.advanceTimersByTimeAsync(31_000)

    expect(server.pieces).toHaveLength(4)
    expect([server.rows.length, room.saveState, room.unsent]).toEqual([1, 'clean', 0])
  })

  it('leaving the page with a big change unsent stages it without keepalive', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const room = await joinMidPace(server, endpoints)
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    room.doc.getText('t').insert(0, BIG)

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(room.unsent).toBe(0))

    expect([sent, server.pieces.length]).toEqual([[undefined], 3])
  })

  it('typing after a lost answer is sent from where the server stopped', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let dropNextAnswer = true
    endpoints.push = async (body, options) => {
      const answer = await push(body, options)
      if (dropNextAnswer) {
        dropNextAnswer = false
        throw new TypeError('connection reset')
      }
      return answer
    }
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'one ')
    await vi.advanceTimersByTimeAsync(0)
    room.doc.getText('t').insert(4, 'two')
    await vi.advanceTimersByTimeAsync(31_000)

    expect([server.rows.length, room.saveState, room.unsent]).toEqual([2, 'clean', 0])
    expect(text(await join(server.endpoints()))).toBe('one two')
  })

  it('closing while a push is in flight still sends what was typed meanwhile', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let holdFirstPush = true
    endpoints.push = async (body, options) => {
      if (holdFirstPush) {
        holdFirstPush = false
        await held
      }
      return push(body, options)
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'first ')
    const sending = room.flush()
    room.doc.getText('t').insert(6, 'second')

    const closing = room.close()
    release()
    await Promise.all([sending, closing])

    expect(text(await join(server.endpoints()))).toBe('first second')
  })

  it('hiding the tab sends what was typed at once, and showing it sends nothing', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const room = await joinMidPace(server, endpoints)
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    room.doc.getText('t').insert(0, 'typed before hiding')

    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toEqual([])

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(room.unsent).toBe(0))
    } finally {
      delete (document as { visibilityState?: string }).visibilityState
    }

    expect(sent).toEqual([true])
    expect(text(await join(server.endpoints()))).toBe('typed before hiding')
  })

  it('leaving the page sends what was typed at once', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const room = await joinMidPace(server, endpoints)
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return push(body, options)
    }
    room.doc.getText('t').insert(0, 'typed before leaving')

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(room.unsent).toBe(0))

    expect(sent).toEqual([true])
    expect(text(await join(server.endpoints()))).toBe('typed before leaving')
  })

  it('leaving the page while a failed save waits to retry still sends what was typed', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      return sent.length === 1 ? Promise.resolve(reply(500, {})) : push(body, options)
    }
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'typed before a failed save')
    await vi.waitFor(() => expect(sent).toEqual([undefined]))

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sent).toEqual([undefined, true]))
    vi.restoreAllMocks()

    expect(text(await join(server.endpoints()))).toBe('typed before a failed save')
  })

  it('leaving the page while a save is still on its way sends it again', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const sent: (boolean | undefined)[] = []
    const push = endpoints.push
    let failFirstPush = () => {}
    endpoints.push = (body, options) => {
      sent.push(options?.keepalive)
      if (sent.length > 1) return push(body, options)
      return new Promise(
        (_, reject) => (failFirstPush = () => reject(new TypeError('Failed to fetch'))),
      )
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'typed during a slow save')
    await vi.waitFor(() => expect(sent).toEqual([undefined]))

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sent).toEqual([undefined, true]))
    failFirstPush()

    expect(text(await join(server.endpoints()))).toBe('typed during a slow save')
  })

  it('leaving the page before a committed save is answered still sends what was typed after it', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    let keepalive: ReturnType<typeof push> | null = null
    let readAnswer!: () => void
    const answerRead = new Promise<void>((resolve) => (readAnswer = resolve))
    endpoints.push = async (body, options) => {
      if (options?.keepalive) {
        keepalive = push(body, options)
        return keepalive
      }

      const answer = await push(body, options)
      // The page goes before it reads the answer
      await answerRead
      return answer
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'first ')
    await vi.waitFor(() => expect(server.rows).toHaveLength(1))
    room.doc.getText('t').insert(6, 'second')

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(keepalive).not.toBeNull())
    await keepalive
    const stored = text(await join(server.endpoints()))
    readAnswer()

    expect(stored).toBe('first second')
  })

  it('leaving the page while a save that never arrives is on its way sends it with what was typed after it', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    const keepalives: ReturnType<typeof push>[] = []
    let failFirstPush: (() => void) | null = null
    endpoints.push = (body, options) => {
      if (options?.keepalive) {
        const answer = push(body, options)
        keepalives.push(answer)
        return answer
      }

      return new Promise(
        (_, reject) => (failFirstPush = () => reject(new TypeError('Failed to fetch'))),
      )
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'first ')
    await vi.waitFor(() => expect(failFirstPush).not.toBeNull())
    room.doc.getText('t').insert(6, 'second')

    window.dispatchEvent(new Event('pagehide'))
    await Promise.all(keepalives)
    const stored = text(await join(server.endpoints()))
    failFirstPush!()

    expect([keepalives.length, stored]).toEqual([1, 'first second'])
  })

  it('leaving the page during a save after a long burst of typing keeps both last pushes within the keepalive quota', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    const keepalives: ReturnType<typeof push>[] = []
    const keepaliveBytes: number[] = []
    let failFirstPush: (() => void) | null = null
    endpoints.push = (body, options) => {
      if (options?.keepalive) {
        keepaliveBytes.push(body.byteLength)
        const answer = push(body, options)
        keepalives.push(answer)
        return answer
      }

      return new Promise(
        (_, reject) => (failFirstPush = () => reject(new TypeError('Failed to fetch'))),
      )
    }
    const room = await join(endpoints)
    room.doc.getText('t').insert(0, 'first ')
    await vi.waitFor(() => expect(failFirstPush).not.toBeNull())
    for (let index = 0; index < 20; index++) {
      room.doc.getText('t').insert(6, 'x'.repeat(4000))
    }

    window.dispatchEvent(new Event('pagehide'))
    await Promise.all(keepalives)
    const stored = text(await join(server.endpoints()))
    failFirstPush!()

    expect(keepaliveBytes).toHaveLength(2)
    expect(keepaliveBytes[0] + keepaliveBytes[1]).toBeLessThanOrEqual(65_536)
    expect(stored.startsWith('first x')).toBe(true)
  })

  it('leaving the page while a big paste that never arrives is on its way still sends the paste', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    const keepalives: ReturnType<typeof push>[] = []
    let failFirstPush: (() => void) | null = null
    endpoints.push = (body, options) => {
      if (options?.keepalive) {
        const answer = push(body, options)
        keepalives.push(answer)
        return answer
      }

      return new Promise(
        (_, reject) => (failFirstPush = () => reject(new TypeError('Failed to fetch'))),
      )
    }
    const room = await join(endpoints)
    const paste = 'p'.repeat(40_000)
    room.doc.getText('t').insert(0, paste)
    await vi.waitFor(() => expect(failFirstPush).not.toBeNull())
    room.doc.getText('t').insert(40_000, ' after')

    window.dispatchEvent(new Event('pagehide'))
    await Promise.all(keepalives)
    const stored = text(await join(server.endpoints()))
    failFirstPush!()

    expect(stored).toBe(`${paste} after`)
  })

  it('leaving the page while a save that never arrives is on its way sends it alone when it and what followed are too big for two', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    const keepalives: ReturnType<typeof push>[] = []
    let failFirstPush: (() => void) | null = null
    endpoints.push = (body, options) => {
      if (options?.keepalive) {
        const answer = push(body, options)
        keepalives.push(answer)
        return answer
      }

      return new Promise(
        (_, reject) => (failFirstPush = () => reject(new TypeError('Failed to fetch'))),
      )
    }
    const room = await join(endpoints)
    const saved = 's'.repeat(30_000)
    const typedAfter = 't'.repeat(20_000)
    room.doc.getText('t').insert(0, saved)
    await vi.waitFor(() => expect(failFirstPush).not.toBeNull())
    room.doc.getText('t').insert(30_000, typedAfter)

    window.dispatchEvent(new Event('pagehide'))
    await Promise.all(keepalives)
    const stored = text(await join(server.endpoints()))
    failFirstPush!()

    expect(stored).toBe(saved + typedAfter)
  })

  it('leaving the page before a big committed save is answered still sends what was typed after it', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    const push = endpoints.push
    const keepalives: ReturnType<typeof push>[] = []
    let readAnswer!: () => void
    const answerRead = new Promise<void>((resolve) => (readAnswer = resolve))
    endpoints.push = async (body, options) => {
      if (options?.keepalive) {
        const answer = push(body, options)
        keepalives.push(answer)
        return answer
      }

      const answer = await push(body, options)
      await answerRead
      return answer
    }
    const room = await join(endpoints)
    const saved = 's'.repeat(30_000)
    const typedAfter = 't'.repeat(20_000)
    room.doc.getText('t').insert(0, saved)
    await vi.waitFor(() => expect(server.rows).toHaveLength(1))
    room.doc.getText('t').insert(30_000, typedAfter)

    window.dispatchEvent(new Event('pagehide'))
    await Promise.all(keepalives)
    const stored = text(await join(server.endpoints()))
    readAnswer()

    expect(stored).toBe(saved + typedAfter)
  })

  it('the first edit after a pause is sent at once', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, 'one')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)

    room.doc.getText('t').insert(3, ' two')
    await vi.advanceTimersByTimeAsync(0)

    expect([server.rows.length, room.unsent]).toEqual([2, 0])
  })

  it('steady typing is sent at most once per pace, half a second when the server names none', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const endpoints = server.endpoints()
    const room = await join(endpoints)
    const startedAt = Date.now()
    const pushedAt: number[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      pushedAt.push(Date.now() - startedAt)
      return push(body, options)
    }

    for (let key = 0; key < 20; key++) {
      room.doc.getText('t').insert(key, 'x')
      await vi.advanceTimersByTimeAsync(100)
    }
    await room.flush()

    expect(pushedAt).toEqual([0, 500, 1000, 1500, 2000])
    expect(text(await join(server.endpoints()))).toBe('xxxxxxxxxxxxxxxxxxxx')
  })

  it('a pace the server changes in a push reply sets the gap from then on', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    server.pace.ms = 2000
    const endpoints = server.endpoints()
    const room = await join(endpoints)
    const startedAt = Date.now()
    const pushedAt: number[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      pushedAt.push(Date.now() - startedAt)
      return push(body, options)
    }

    room.doc.getText('t').insert(0, 'a')
    await vi.advanceTimersByTimeAsync(100)
    room.doc.getText('t').insert(1, 'b')
    server.pace.ms = 300
    await vi.advanceTimersByTimeAsync(2000)
    room.doc.getText('t').insert(2, 'c')
    await vi.advanceTimersByTimeAsync(1000)

    expect(pushedAt).toEqual([0, 2000, 2300])
  })

  it('typing already waiting goes out by a pace a reply shortens', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    server.pace.ms = 5000
    const endpoints = server.endpoints()
    const room = await join(endpoints)
    const startedAt = Date.now()
    const pushedAt: number[] = []
    const push = endpoints.push
    endpoints.push = async (body, options) => {
      pushedAt.push(Date.now() - startedAt)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return push(body, options)
    }

    room.doc.getText('t').insert(0, 'a')
    await vi.advanceTimersByTimeAsync(100)
    room.doc.getText('t').insert(1, 'b')
    server.pace.ms = 2000
    await vi.advanceTimersByTimeAsync(3000)

    expect(pushedAt).toEqual([0, 2000])
  })

  it('a pace above ten seconds is held to ten seconds', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    server.pace.ms = 2 ** 31
    const endpoints = server.endpoints()
    const room = await join(endpoints)
    const startedAt = Date.now()
    const pushedAt: number[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      pushedAt.push(Date.now() - startedAt)
      return push(body, options)
    }

    room.doc.getText('t').insert(0, 'a')
    await vi.advanceTimersByTimeAsync(100)
    room.doc.getText('t').insert(1, 'b')
    await vi.advanceTimersByTimeAsync(20_000)

    expect(pushedAt).toEqual([0, 10_000])
  })

  it('a pace that is not a number falls back to half a second', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    server.pace.ms = 'soon' as unknown as number
    const endpoints = server.endpoints()
    const room = await join(endpoints)
    const startedAt = Date.now()
    const pushedAt: number[] = []
    const push = endpoints.push
    endpoints.push = (body, options) => {
      pushedAt.push(Date.now() - startedAt)
      return push(body, options)
    }

    room.doc.getText('t').insert(0, 'a')
    await vi.advanceTimersByTimeAsync(100)
    room.doc.getText('t').insert(1, 'b')
    await vi.advanceTimersByTimeAsync(2000)

    expect(pushedAt).toEqual([0, 500])
  })
})
