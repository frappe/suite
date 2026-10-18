import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { openCollabRoom } from './open'
import { adapterAt, fakeServer, heldPushes, idle, join, offlinePushes, text } from './test-support'

describe('collab room', () => {
  it('a tab stops following a document a newer editor wrote to, and goes read-only', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'new')
    await writer.flush()
    server.schema.now = 2

    await room.pull()
    room.doc.getText('t').insert(0, 'mine')
    writer.doc.getText('t').insert(0, 'later')
    await writer.flush()
    await room.pull()

    expect([room.newerSchema, room.canWrite, text(room), room.unsent]).toEqual([
      true,
      false,
      'mine',
      0,
    ])
  })

  it('typing from before a newer editor wrote is still saved', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, 'kept')
    server.schema.now = 2

    await room.pull()
    await vi.advanceTimersByTimeAsync(1500)

    expect([room.newerSchema, room.saveState, text(await join(server.endpoints()))]).toEqual([
      true,
      'clean',
      'kept',
    ])
  })

  it('a tab opened on a document a newer editor wrote to shows it and sends nothing', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'new')
    await writer.flush()
    server.schema.now = 2

    const room = await join(server.endpoints())
    room.doc.getText('t').insert(0, 'x')
    await room.flush()

    expect([room.newerSchema, room.canWrite, text(room), room.unsent, server.rows.length]).toEqual([
      true,
      false,
      'xnew',
      0,
      1,
    ])
  })

  it('a tab learns how full the document is when it opens, and again on every pull', async () => {
    const server = fakeServer()
    const [writer, reader] = [await join(server.endpoints()), await join(server.endpoints())]
    writer.doc.getText('t').insert(0, 'alpha ')
    await writer.flush()
    const opened = (await join(server.endpoints())).limits

    await reader.pull()

    const row = server.rows[0].bytes.byteLength
    expect([opened?.tail_bound, reader.limits?.tail_bound, reader.limits?.edit_max]).toEqual([
      row,
      row,
      4 * 2 ** 20,
    ])
  })

  it('a tab opened later sees everything typed before', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'kept')
    await writer.flush()

    expect(text(await join(server.endpoints()))).toBe('kept')
  })

  it('opens nothing while collaboration is off or the document is not collaborative', async () => {
    for (const state of ['disabled', 'unconverted']) {
      const opened = openCollabRoom({
        endpoints: fakeServer(state).endpoints(),
        principal: 'a@x.com',
        adapter: adapterAt(1),
        signedIn: () => 'a@x.com',
      })
      await expect(opened).resolves.toEqual({
        state,
      })
    }
  })
})

// The items a comment on `word` would hang from: its first and its last character
function endsOf(doc: Y.Doc, word: string) {
  const typed = doc.getText('t')
  const at = typed.toString().indexOf(word)
  const first = Y.createRelativePositionFromTypeIndex(typed, at, 0)
  const last = Y.createRelativePositionFromTypeIndex(typed, at + word.length, -1)
  return [first.item!, last.item!]
}

describe('committed text', () => {
  it('counts only once the server holds it', async () => {
    const server = fakeServer()
    const slow = heldPushes(server)
    const room = await join(slow.endpoints)
    room.doc.getText('t').insert(0, 'hello')
    const ends = endsOf(room.doc, 'hello')

    const whileSending = ends.map((end) => room.committedCovers([end]))
    slow.release()
    await room.flush()

    expect([whileSending, room.committedCovers(ends)]).toEqual([[false, false], true])
  })

  it('never counts text that cannot reach the server', async () => {
    const room = await join(offlinePushes(fakeServer()))
    room.doc.getText('t').insert(0, 'offline words')

    await idle()

    expect(room.committedCovers(endsOf(room.doc, 'words'))).toBe(false)
  })

  it("counts another tab's committed text once it arrives here, and its later typing only once that is committed", async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'first')
    await writer.flush()
    const reader = await join(server.endpoints())
    writer.doc.getText('t').insert(5, ' second')
    const secondEnds = endsOf(writer.doc, 'second')

    const beforeArriving = reader.committedCovers(secondEnds)
    await writer.flush()
    await reader.pull()

    expect([
      reader.committedCovers(endsOf(reader.doc, 'first')),
      beforeArriving,
      reader.committedCovers(secondEnds),
    ]).toEqual([true, false, true])
  })
})
