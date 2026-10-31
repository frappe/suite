import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { breaksOn, device, fakeServer, idle, join, reply, text } from './test-support'

describe('collab room on a device', () => {
  it('typing that lands after the server refused a change is kept aside too', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'seq_conflict' })
    room.doc.getText('t').insert(0, 'refused')
    await room.flush()

    room.doc.getText('t').insert(7, ' late')
    await idle()

    const entries = (await kept.store.recovery('D')).flatMap((record) => record.entries)
    const aside = new yjs.Doc()
    for (const entry of entries) {
      yjs.applyUpdate(aside, entry.bytes)
    }

    expect(aside.getText('t').toString()).toBe('refused late')
  })

  it('a refused change goes to the device’s recovery copies, not back into the next tab', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(0, 'refused')
    await room.flush()
    server.access.refuse = null

    expect([room.status.saveState, (await kept.store.recovery('D'))[0]?.reason]).toEqual([
      'failed',
      'seq_conflict',
    ])
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('')
  })

  it('a refused tab keeps one copy that reads as the whole document under its title, late typing included', async () => {
    const server = fakeServer()
    const kept = { ...(await device()), title: () => 'Plan' }
    const room = await join(server.endpoints(), { device: kept })
    room.doc.getText('t').insert(0, 'saved')
    await room.flush()
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(5, ' refused')
    await room.flush()
    room.doc.getText('t').insert(13, ' late')
    await idle()

    const copies = await kept.store.recovery('D')
    const readable = new yjs.Doc()
    yjs.applyUpdate(readable, copies[0].state!)
    expect([copies.length, copies[0].title, readable.getText('t').toString()]).toEqual([
      1,
      'Plan',
      'saved refused late',
    ])
    expect(room.status.keptCopyCount).toBe(2)
  })

  it('a recovery copy the device could not write is never counted as kept', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    kept.store.recover = () =>
      Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
    server.access.refuse = reply(409, { collab: 'seq_conflict' })

    room.doc.getText('t').insert(0, 'refused')
    await room.flush()
    await idle()

    expect([room.status.saveState, room.status.keptCopyCount, room.status.hasCopyFailed]).toEqual([
      'failed',
      0,
      true,
    ])
  })

  it('a change from a session the server closed is kept aside and the tab asks to be rebuilt', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'client_closed' })

    room.doc.getText('t').insert(0, 'after the quarantine')
    await room.flush()

    expect([room.status.stopReason, room.status.isReopenNeeded, room.status.saveState]).toEqual([
      'client_closed',
      true,
      'failed',
    ])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['client_closed'])
  })

  it('a tab told collaboration is off keeps its unsent work as a recovery copy and stops', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(409, { collab: 'disabled' })

    room.doc.getText('t').insert(0, 'typed before the switch')
    await room.flush()

    expect([room.status.stopReason, room.status.saveState, room.status.canWrite]).toEqual([
      'disabled',
      'failed',
      false,
    ])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['disabled'])
  })

  it('a tab with nothing unsent stops once a pull says collaboration is off', async () => {
    const server = fakeServer()
    const room = await join(server.endpoints())
    server.access.refuse = reply(409, { collab: 'disabled' })

    await room.pull()

    expect([room.status.stopReason, room.status.canWrite]).toEqual(['disabled', false])
  })

  it('a tab whose suspect report is answered that collaboration is off stops', async () => {
    const server = fakeServer('live', 'apply-1')
    server.judge.answer = () => reply(409, { collab: 'disabled' })
    const room = await join(server.endpoints())
    breaksOn(room, 'boom')
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await room.pull()

    await vi.waitFor(() =>
      expect([server.judge.reports, room.status.stopReason, room.status.canWrite]).toEqual([
        [1],
        'disabled',
        false,
      ]),
    )
  })

  it('a change refused by a full document is kept aside and the tab asks to be rebuilt', async () => {
    const server = fakeServer()
    const kept = await device()
    const room = await join(server.endpoints(), { device: kept })
    server.access.refuse = reply(423, { collab: 'doc_full', retry_ms: 300_000 })

    room.doc.getText('t').insert(0, 'one line too many')
    await room.flush()
    server.access.refuse = null

    expect([room.status.stopReason, room.status.isReopenNeeded, room.status.pauseReason]).toEqual([
      'document_full',
      true,
      null,
    ])
    expect((await kept.store.recovery('D')).map((copy) => copy.reason)).toEqual(['document_full'])
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('')
  })

  it('a tab knows the document is at its limit from the open, and that it has room again from a pull', async () => {
    const server = fakeServer()
    server.counted.state = 4 * 2 ** 20
    const room = await join(server.endpoints())
    const opened = room.status.isAtLimit
    let changeCount = 0
    room.onChange(() => changeCount++)

    server.counted.state = null
    await room.pull()

    expect([opened, room.status.isAtLimit, changeCount > 0]).toEqual([true, false, true])
  })

  it('a document is at its limit once its saved changes fill what its state leaves', async () => {
    const server = fakeServer()
    server.counted.state = 4 * 2 ** 20 - 10
    const room = await join(server.endpoints())
    const opened = room.status.isAtLimit
    room.doc.getText('t').insert(0, 'more than ten bytes')
    await room.flush()
    await room.pull()

    expect([opened, room.status.isAtLimit]).toEqual([false, true])
  })

  it('a rebuild leaves no quarantined change in the device copy', async () => {
    const server = fakeServer()
    const kept = await device()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    const reader = await join(server.endpoints(), { device: kept })
    writer.doc.getText('t').insert(4, 'bad')
    await writer.flush()
    await reader.pull()
    expect(text(reader)).toBe('one bad')
    server.quarantine(2)
    await reader.pull()
    await reader.close()

    expect(text(await join(server.endpoints(), { device: kept }))).toBe('one ')
    server.access.online = false
    expect(text(await join(server.endpoints(), { device: kept }))).toBe('one ')
  })

  it('work left from before the document was replaced is kept as a recovery copy, not applied', async () => {
    const server = fakeServer()
    const kept = await device()
    const stale = new yjs.Doc()
    let bytes: Uint8Array = new Uint8Array()
    stale.on('update', (update: Uint8Array) => {
      bytes = update
    })
    stale.getText('t').insert(0, 'old')
    const old = { doc: 'D', sid: 'old', lineage: 'GONE', cid: 99, bound: true }
    await kept.store.capture(old, [{ doc: 'D', sid: 'old', seq: 1, bytes, sha: 'x', seenRev: 0 }])

    const room = await join(server.endpoints(), { device: kept })

    expect([
      text(room),
      room.status.unsentCount,
      (await kept.store.recovery('D'))[0]?.reason,
    ]).toEqual(['', 0, 'lineage'])
  })
})
