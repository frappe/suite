import { describe, expect, it, vi } from 'vitest'

import { breaksOn, browser, fakeServer, join, judgedOnce, reply } from './test-support'

describe('collab room', () => {
  it('a row that fails to apply is reported, and the tab sends nothing until the verdict', async () => {
    const server = fakeServer('live', 'apply-1')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()

    expect([server.judge.reports, room.canWrite, room.paused, room.appliedThrough]).toEqual([
      [1],
      false,
      'suspect',
      0,
    ])
    room.doc.getText('t').insert(0, 'mine ')
    server.calls.length = 0
    await room.flush()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await room.pull()
    expect([server.calls, room.unsent, room.needsRebuild]).toEqual([['pull'], 1, false])
    server.judge.judged++
    server.judge.verdict = 'clean'
    await room.pull()
    expect([room.needsRebuild, room.stopped]).toEqual([true, null])
    // Work held nowhere else goes out from this copy before it is rebuilt
    await vi.waitFor(() =>
      expect([room.unsent, room.paused, server.rows.length]).toEqual([0, null, 2]),
    )
  })

  it('a server failing to answer the report is asked again, and never counts against this browser', async () => {
    vi.useFakeTimers()
    const server = fakeServer('live', 'apply-20')
    const failing = () => ({
      status: 502,
      bytes: new TextEncoder().encode('<html>Bad Gateway</html>'),
    })
    server.judge.answer = () =>
      server.judge.reports.length <= 3 ? failing() : reply(202, { collab: 'judging', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.advanceTimersByTimeAsync(3 * 31_000)
    const waiting = [server.judge.reports.length, room.needsRebuild, room.stopped, room.paused]
    server.judge.judged++
    server.judge.verdict = 'quarantined'
    await room.pull()

    expect([waiting, room.needsRebuild]).toEqual([[4, false, null, 'suspect'], true])
  })

  it('a report refused for a lapsed sign-in is made again once the person signs back in', async () => {
    vi.useFakeTimers()
    const server = fakeServer('live', 'apply-21')
    server.judge.answer = () =>
      browser.signedIn === 'Guest'
        ? reply(401, { collab: 'signed_out' })
        : reply(202, { collab: 'judging', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    browser.signedIn = 'Guest'

    await room.pull()
    const blockedWhileSignedOut = room.blocked
    browser.signedIn = 'a@x.com'
    await vi.advanceTimersByTimeAsync(31_000)
    server.judge.judged++
    server.judge.verdict = 'quarantined'
    await room.pull()

    expect([blockedWhileSignedOut, server.judge.reports.length, room.needsRebuild]).toEqual([
      'signed_out',
      2,
      true,
    ])
  })

  it('a verdict from before the report is not taken for this one', async () => {
    const server = fakeServer('live', 'apply-2')
    server.judge.judged = 4
    server.judge.verdict = 'clean'
    // Another tab reported a moment ago, so this report waits and learns no count
    server.judge.answer = () => reply(423, { collab: 'busy', retry_ms: 60_000 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await room.pull()

    expect([room.needsRebuild, room.canWrite]).toEqual([false, false])
  })

  it('a quarantined row rebuilds the tab', async () => {
    const server = fakeServer('live', 'apply-3')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.quarantine(1)
    server.judge.judged++
    server.judge.verdict = 'quarantined'

    await room.pull()

    expect([room.needsRebuild, room.stopped]).toEqual([true, null])
  })

  it('a held verdict keeps the tab locked and waiting', async () => {
    const room = await judgedOnce(fakeServer('live', 'apply-4'), 'held')
    expect([room.needsRebuild, room.canWrite, room.stopped]).toEqual([false, false, null])
  })

  it('a row the server already compacted is clean at once', async () => {
    const server = fakeServer('live', 'apply-5')
    server.judge.answer = () => reply(200, { verdict: 'clean', judged: 0 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.waitFor(() => expect(room.needsRebuild).toBe(true))
  })

  it('a report another tab made a moment ago is made again after the wait', async () => {
    const server = fakeServer('live', 'apply-6')
    server.judge.answer = () =>
      server.judge.reports.length < 2
        ? reply(423, { collab: 'busy', retry_ms: 5 })
        : reply(202, { collab: 'judging', judged: 0 })
    const room = await judgedOnce(server, 'clean')
    expect(server.judge.reports).toEqual([1])
    await vi.waitFor(() => expect(server.judge.reports).toEqual([1, 1]))
    server.judge.judged++
    await room.pull()
    expect(room.needsRebuild).toBe(true)
  })

  it('a third clean verdict in ten minutes stops editing in this browser', async () => {
    const server = fakeServer('live', 'apply-7')
    for (const _ of [1, 2]) expect((await judgedOnce(server, 'clean')).needsRebuild).toBe(true)
    const third = await judgedOnce(server, 'clean')
    await vi.waitFor(() => expect(third.stopped).toBe('browser'))
    expect([third.needsRebuild, third.canWrite]).toEqual([false, false])
  })

  it('a held document locks the tab, keeps its typing and sends it once released', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'change'

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(1500)
    expect([room.held, room.canWrite, room.unsent, server.rows.length]).toEqual([
      'change',
      false,
      1,
      0,
    ])

    server.judge.held = undefined
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.held, room.canWrite, room.saveState, server.rows.length]).toEqual([
      null,
      true,
      'clean',
      1,
    ])
  })

  it('a pull tells a tab with nothing to send that the document is held, and when it is not', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'bad_checkpoint'

    await room.pull()
    expect([room.held, room.canWrite]).toEqual(['bad_checkpoint', false])
    server.judge.held = undefined
    await room.pull()

    expect([room.held, room.canWrite]).toEqual([null, true])
  })

  it('a refused push does not hide that the whole document is in question', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.judge.held = 'bad_checkpoint'
    await room.pull()

    room.doc.getText('t').insert(0, 'x')
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.held, room.paused]).toEqual(['bad_checkpoint', 'suspect'])
  })

  it('a report answered with a hold locks the tab as held', async () => {
    const server = fakeServer('live', 'apply-11')
    server.judge.answer = () =>
      reply(423, { collab: 'paused', reason: 'suspect', retry_ms: 300_000 })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()
    await vi.waitFor(() => expect(room.held).toBe('change'))
  })

  it('a tab tells its listeners why it stopped when it stops', async () => {
    const server = fakeServer('live', 'apply-10')
    for (const _ of [1, 2]) await judgedOnce(server, 'clean')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const seen: (string | null)[] = []
    room.onChange(() => room.saveState === 'failed' && seen.push(room.stopped))
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.judge.judged++
    server.judge.verdict = 'clean'

    await room.pull()

    expect(seen[0]).toBe('browser')
  })

  it('a quarantine is not counted against this browser', async () => {
    const server = fakeServer('live', 'apply-9')
    await judgedOnce(server, 'clean')
    await judgedOnce(server, 'clean')
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()
    await room.pull()
    server.judge.judged++
    server.judge.verdict = 'quarantined'

    await room.pull()

    expect([room.needsRebuild, room.stopped]).toEqual([true, null])
  })

  it('clean verdicts older than ten minutes are not counted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const server = fakeServer('live', 'apply-8')
    await judgedOnce(server, 'clean')
    await judgedOnce(server, 'clean')
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    const third = await judgedOnce(server, 'clean')
    expect([third.needsRebuild, third.stopped]).toEqual([true, null])
  })
})
