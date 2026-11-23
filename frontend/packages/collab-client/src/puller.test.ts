import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { APPLIED_UPDATE, REMOTE } from './origins'
import { breaksOn, device, fakeServer, join, text } from './test-support'

describe('collab room', () => {
  it('keeps a checkpoint it opened from on the device, so the document reopens offline', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    server.compact()
    writer.doc.getText('t').insert(4, 'two')
    await writer.flush()
    const kept = await device()
    await (await join(server.endpoints(), { device: kept })).close()
    server.access.online = false

    const offline = await join(server.endpoints(), { device: kept })

    expect(text(offline)).toBe('one two')
  })

  it('opens from the checkpoint plus the rows after it, and pulls on from there', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    server.compact()
    writer.doc.getText('t').insert(4, 'two ')
    await writer.flush()

    const opened = await join(server.endpoints())
    expect(text(opened)).toBe('one two ')

    writer.doc.getText('t').insert(8, 'three')
    await writer.flush()
    server.pulls.length = 0
    await opened.pull()
    expect(server.pulls).toEqual([2])
    expect(text(opened)).toBe('one two three')
  })

  it('a quarantined rev holds its place in the order and applies nothing', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one ')
    await writer.flush()
    const behind = await join(server.endpoints())
    writer.doc.getText('t').insert(4, 'two ')
    await writer.flush()
    // The server keeps the rev and drops its payload
    server.rows[1].bytes = new Uint8Array()

    const opened = await join(server.endpoints())
    expect([text(opened), opened.appliedThrough]).toEqual(['one ', 2])
    opened.doc.getText('t').insert(0, 'zero ')
    await opened.flush()

    await behind.pull()
    expect([text(behind), behind.appliedThrough]).toEqual(['zero one ', 3])
  })

  it('a tab that may hold a quarantined change stops following and asks to be rebuilt', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    const reader = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'bad')
    await writer.flush()
    await reader.pull()
    expect([text(reader), reader.status.isReopenNeeded]).toEqual(['bad', false])
    server.quarantine(1)
    const heard = vi.fn()
    reader.onChange(heard)

    await reader.pull()

    expect([
      reader.status.isReopenNeeded,
      heard.mock.calls.length > 0,
      server.epoch.sent.at(-1),
    ]).toEqual([true, true, 0])
    server.calls.length = 0
    await reader.pull()
    expect(server.calls).toEqual([])
    const rebuilt = await join(server.endpoints())
    const later = await join(server.endpoints())
    later.doc.getText('t').insert(0, 'ok ')
    await later.flush()
    await rebuilt.pull()
    expect([text(rebuilt), rebuilt.status.isReopenNeeded, server.epoch.sent.at(-1)]).toEqual([
      'ok ',
      false,
      1,
    ])
  })

  it('applies a pull in one transaction that carries the update it applied', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'one two')
    await writer.flush()
    const reader = await join(server.endpoints())
    const transactions: [boolean, unknown][] = []
    reader.doc.on('afterTransaction', (transaction: yjs.Transaction) => {
      transactions.push([transaction.origin === REMOTE, transaction.meta.get(APPLIED_UPDATE)])
    })

    writer.doc.getText('t').delete(0, 4)
    await writer.flush()
    await reader.pull()
    expect(text(reader)).toBe('two')
    expect(transactions).toEqual([[true, [server.rows[1].bytes]]])
  })

  it('carries each row a pull applies together on its own', async () => {
    const server = fakeServer()
    const writer = await join(server.endpoints())
    const reader = await join(server.endpoints())
    const applied: unknown[] = []
    reader.doc.on('afterTransaction', (transaction: yjs.Transaction) => {
      applied.push(transaction.meta.get(APPLIED_UPDATE))
    })

    writer.doc.getText('t').insert(0, 'one')
    await writer.flush()
    writer.doc.getText('t').insert(3, ' two')
    await writer.flush()
    await reader.pull()

    expect(text(reader)).toBe('one two')
    expect(applied).toEqual([server.rows.map((row) => row.bytes)])
  })

  it('tells listeners of a pulled row that throws only once the room cannot write', async () => {
    const server = fakeServer()
    const reader = await join(server.endpoints())
    breaksOn(reader, 'boom')
    let isApplied = false
    reader.doc.on('afterTransaction', (transaction: yjs.Transaction) => {
      isApplied ||= transaction.meta.has(APPLIED_UPDATE)
    })
    const canWriteWhenTold: boolean[] = []
    reader.onChange(() => {
      if (isApplied) {
        canWriteWhenTold.push(reader.status.canWrite)
      }
    })
    const writer = await join(server.endpoints())
    writer.doc.getText('t').insert(0, 'boom')
    await writer.flush()

    await reader.pull()

    expect([text(reader), new Set(canWriteWhenTold)]).toEqual(['boom', new Set([false])])
  })

  it('two writers converge on the server order after a poll', async () => {
    const server = fakeServer()
    const [first, second] = [await join(server.endpoints()), await join(server.endpoints())]

    first.doc.getText('t').insert(0, 'alpha ')
    second.doc.getText('t').insert(0, 'beta ')
    await Promise.all([first.flush(), second.flush()])
    await Promise.all([first.pull(), second.pull()])

    expect(text(first)).toBe(text(second))
    expect(text(first)).toContain('alpha ')
    expect(text(first)).toContain('beta ')
    expect(server.rows.map((row) => row.rev)).toEqual([1, 2])
    expect([first.status.saveState, second.status.saveState, first.appliedThrough]).toEqual([
      'clean',
      'clean',
      2,
    ])
  })
})
