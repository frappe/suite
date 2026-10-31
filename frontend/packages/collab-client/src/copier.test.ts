import { describe, expect, it, vi } from 'vitest'
import type * as yjs from 'yjs'

import { fakeServer, fakeTime, idle, join } from './test-support'

// An editor whose readable copy is its text in one paragraph
const rendering = {
  app: 'test',
  schemaVersion: 1,
  toPeerPosition: (raw: unknown) => raw as object,
  toHtml: (doc: yjs.Doc) => {
    const content = doc.getText('t').toString()
    return `<p>${content}</p>`
  },
}

describe('readable copy', () => {
  it('a push answer that asks for the copy gets a render of the document at the rev the tab holds', async () => {
    const server = fakeServer()
    server.copy.wanted = true
    const room = await join(server.endpoints(), { adapter: rendering })

    room.doc.getText('t').insert(0, 'one')
    await room.flush()
    await idle()

    const [sid] = server.sessions.keys()
    expect(server.copy.renders).toEqual([
      { rev: 1, q_epoch: 0, sid, lineage: 'L', html: '<p>one</p>' },
    ])
  })

  it('a tab renders nothing while push answers do not ask', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints(), { adapter: rendering })

    room.doc.getText('t').insert(0, 'one')
    await room.flush()
    await idle()

    expect(server.copy.renders).toEqual([])
  })

  it('a render waits until typing done during the push is saved too', async () => {
    const server = fakeServer()
    server.copy.wanted = true
    server.pace.ms = 60_000
    const endpoints = server.endpoints()
    const push = endpoints.push
    const room = await join(endpoints, { adapter: rendering })
    endpoints.push = async (body, options) => {
      if (server.rows.length === 0) {
        room.doc.getText('t').insert(3, ' two')
      }

      return push(body, options)
    }

    room.doc.getText('t').insert(0, 'one')
    await vi.waitFor(() => expect(server.rows).toHaveLength(1))
    await idle()
    expect([room.status.unsentCount, server.copy.renders]).toEqual([1, []])

    await room.flush()
    await idle()

    expect(server.copy.renders.map(({ rev, html }) => [rev, html])).toEqual([[2, '<p>one two</p>']])
  })

  it('a render waits until the tab holds the rows before its own commit', async () => {
    const server = fakeServer()
    server.copy.wanted = true
    const writer = await join(server.endpoints())
    const endpoints = server.endpoints()
    const room = await join(endpoints, { adapter: rendering })
    writer.doc.getText('t').insert(0, 'theirs ')
    await writer.flush()
    const pull = endpoints.pull
    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    endpoints.pull = async (since, epoch) => {
      await held
      return pull(since, epoch)
    }

    room.doc.getText('t').insert(0, 'mine')
    await room.flush()
    await idle()
    expect(server.copy.renders).toEqual([])

    release()
    await vi.waitFor(() => expect(server.copy.renders).toHaveLength(1))
    expect(server.copy.renders[0].rev).toBe(2)
    expect(server.copy.renders[0].html).toContain('theirs')
  })

  it('a repeat answer to a resent push makes the render wait for the head it names', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    server.copy.wanted = true
    const writer = await join(server.endpoints())
    const endpoints = server.endpoints()
    const room = await join(endpoints, { adapter: rendering })
    writer.doc.getText('t').insert(0, 'theirs ')
    await writer.flush()
    await room.pull()
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

    const pull = endpoints.pull
    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    endpoints.pull = async (since, epoch) => {
      await held
      return pull(since, epoch)
    }

    room.doc.getText('t').insert(7, 'mine')
    await vi.advanceTimersByTimeAsync(31_000)
    expect([server.rows.length, server.copy.renders]).toEqual([2, []])

    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(server.copy.renders.map(({ rev, html }) => [rev, html])).toEqual([
      [2, '<p>theirs mine</p>'],
    ])
  })

  it('a tab renders at most once a minute however often pushes ask', async () => {
    fakeTime()
    const server = fakeServer()
    server.copy.wanted = true
    const room = await join(server.endpoints(), { adapter: rendering })
    async function typeAndSave(words: string) {
      room.doc.getText('t').insert(room.doc.getText('t').length, words)
      await room.flush()
      await idle()
    }

    await typeAndSave('one')
    await typeAndSave(' two')
    expect(server.copy.renders).toHaveLength(1)

    vi.advanceTimersByTime(60_000)
    await typeAndSave(' three')

    expect(server.copy.renders.map(({ rev }) => rev)).toEqual([1, 3])
  })

  it('a tab that hides renders what it holds without being asked, once per change', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints(), { adapter: rendering })
    room.doc.getText('t').insert(0, 'one')
    await room.flush()
    async function hideAndSettle() {
      await hidePage()
      await idle()
    }

    await hideAndSettle()
    await hideAndSettle()
    room.doc.getText('t').insert(3, ' two')
    await hideAndSettle()

    expect(server.copy.renders.map(({ rev, html }) => [rev, html])).toEqual([
      [1, '<p>one</p>'],
      [2, '<p>one two</p>'],
    ])
  })
})

async function hidePage() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  try {
    document.dispatchEvent(new Event('visibilitychange'))
  } finally {
    delete (document as { visibilityState?: string }).visibilityState
  }
}
