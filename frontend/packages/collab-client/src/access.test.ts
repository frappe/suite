import { describe, expect, it, vi } from 'vitest'

import { CollabOpenError } from './answers'
import { openRoom } from './open'
import { adapterAt, browser, fakeServer, join, reply, text } from './test-support'

describe('collab room', () => {
  it('a viewer follows the document but nothing they do is sent', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    server.access.canWrite = false
    const viewer = await join(server.endpoints())

    writer.doc.getText('t').insert(0, 'news')
    await writer.flush()
    await viewer.pull()
    viewer.doc.getText('t').insert(0, 'mine ')

    expect([viewer.status.canWrite, viewer.status.unsentCount, text(viewer)]).toEqual([
      false,
      0,
      'mine news',
    ])
    expect(server.rows).toHaveLength(1)
  })

  it('a signed-out tab keeps its typing and sends it once the same person signs back in', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(401, { collab: 'signed_out' })
    browser.signedIn = 'Guest'

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(0)
    expect([
      room.status.blockReason,
      room.status.canWrite,
      room.status.unsentCount,
      server.rows.length,
    ]).toEqual(['signed_out', true, 1, 0])

    server.access.refuse = null
    browser.signedIn = 'a@x.com'
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.status.blockReason, room.status.saveState, server.rows.length]).toEqual([
      null,
      'clean',
      1,
    ])
  })

  it('a tab whose browser signed in as someone else stops and says so', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(409, { collab: 'user_changed' })
    browser.signedIn = 'b@x.com'

    room.doc.getText('t').insert(0, 'unsent')
    await room.flush()
    room.doc.getText('t').insert(0, 'more ')

    expect([
      room.status.blockReason,
      room.status.canWrite,
      room.status.saveState,
      room.status.unsentCount,
    ]).toEqual(['other_user', false, 'failed', 1])
  })

  it('a writer whose edit access is taken away is told so on the next push', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(403, { collab: 'forbidden' })

    room.doc.getText('t').insert(0, 'late')
    await room.flush()

    expect([room.status.blockReason, room.status.canWrite, room.status.saveState]).toEqual([
      'lost_edit',
      false,
      'failed',
    ])
  })

  it('a change the server refuses for good says why saving stopped', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    expect(room.status.stopReason).toBe(null)
    server.access.refuse = reply(409, { collab: 'poison' })

    room.doc.getText('t').insert(0, 'bad')
    await room.flush()

    expect([room.status.stopReason, room.status.saveState, room.status.blockReason]).toEqual([
      'poison',
      'failed',
      null,
    ])
  })

  it('a refusal that turns out to be a sign-out is not taken as lost access', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(404, { collab: 'not_found' })
    browser.signedIn = 'Guest'

    await room.pull()

    expect([room.status.blockReason, room.status.canWrite]).toEqual(['signed_out', true])
  })

  it('a document locked again keeps its typing and is not taken for a sign-out', async () => {
    vi.useFakeTimers()
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(401, { collab: 'locked' })

    room.doc.getText('t').insert(0, 'kept')
    await vi.advanceTimersByTimeAsync(0)
    expect([room.status.blockReason, room.status.canWrite, room.status.unsentCount]).toEqual([
      'locked',
      true,
      1,
    ])

    server.access.refuse = null
    await room.pull()
    await vi.advanceTimersByTimeAsync(0)

    expect([room.status.blockReason, room.status.saveState, server.rows.length]).toEqual([
      null,
      'clean',
      1,
    ])
  })

  it('a tab whose sign-in went stale stops and asks for a reload', async () => {
    const server = fakeServer()
    const endpoints = server.endpoints()
    endpoints.push = async () => reply(400, { exc_type: 'CSRFTokenError' })
    const room = await join(endpoints)

    room.doc.getText('t').insert(0, 'unsent')
    await room.flush()
    await room.pull()

    expect([
      room.status.blockReason,
      room.status.canWrite,
      room.status.saveState,
      room.status.unsentCount,
    ]).toEqual(['stale_session', false, 'failed', 1])
  })

  it('opening with a stale sign-in asks for a reload', async () => {
    const endpoints = fakeServer().endpoints()
    endpoints.session = async () => reply(400, { exc_type: 'CSRFTokenError' })

    const opened = openRoom({
      endpoints,
      expectedUser: 'a@x.com',
      adapter: adapterAt(1),
      signedIn: () => 'a@x.com',
    })

    await expect(opened).rejects.toEqual(new CollabOpenError(400, 'stale_session'))
  })

  it('a writer who loses edit and then read access is told the larger loss', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(403, { collab: 'forbidden' })

    room.doc.getText('t').insert(0, 'late')
    await room.flush()
    await room.pull()

    expect(room.status.blockReason).toBe('lost_read')
  })
})
