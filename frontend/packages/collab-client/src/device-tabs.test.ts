import { describe, expect, it, vi } from 'vitest'
import * as yjs from 'yjs'

import { Device } from './device'
import { ADOPT, APPLIED_UPDATE, MERGED_UPDATE } from './origins'
import {
  device,
  fakeLocks,
  fakeServer,
  fakeTime,
  heldPushes,
  idle,
  join,
  offlinePushes,
  text,
} from './test-support'

describe('collab room on a device', () => {
  it('a change on the device reaches every listener in another tab, until one stops listening', async () => {
    const kept = await device()
    const writer = new Device(kept)
    const reader = new Device(kept)
    const heard: string[] = []
    reader.onChanged(() => heard.push('room'))
    const stop = reader.onChanged(() => heard.push('second'))

    writer.changed()
    await vi.waitFor(() => expect(heard).toEqual(['room', 'second']))
    stop()
    writer.changed()
    await vi.waitFor(() => expect(heard).toEqual(['room', 'second', 'room']))
    writer.close()
    reader.close()
  })

  it('a tab counts the work another open tab holds as unsent, and shows Saved once it is committed', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const slow = heldPushes(server)
      const first = await join(slow.endpoints, { device: kept })
      first.doc.getText('t').insert(0, 'held in first')
      await vi.advanceTimersByTimeAsync(0)
      await idle()

      const second = await join(server.endpoints(), { device: kept })
      await idle()
      const seen = [
        second.status.unsentCount,
        second.status.othersUnsentCount,
        second.status.saveState,
        text(second),
      ]
      expect(seen).toEqual([0, 1, 'unsaved', ''])

      slow.release()
      await first.flush()
      await idle()
      expect([
        second.status.othersUnsentCount,
        second.status.saveState,
        first.status.saveState,
      ]).toEqual([0, 'clean', 'clean'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('work an open tab held when it closed is sent once by the tab still open', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      const second = await join(server.endpoints(), { device: kept })
      await idle()

      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()
      await second.flush()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      const seen = [
        text(second),
        server.rows.length,
        second.status.othersUnsentCount,
        second.status.saveState,
      ]
      expect(seen).toEqual(['left behind', 1, 0, 'clean'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('an open tab takes on a closed tab’s work in one transaction that carries the work it applies', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left')
      await vi.advanceTimersByTimeAsync(0)
      first.doc.getText('t').insert(4, ' behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      const second = await join(server.endpoints(), { device: kept })
      await idle()
      const adopted: (Uint8Array[] | undefined)[] = []
      second.doc.on('afterTransaction', (transaction: yjs.Transaction) => {
        if (transaction.origin === ADOPT) {
          adopted.push(transaction.meta.get(APPLIED_UPDATE))
        }
      })

      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      const applied = new yjs.Doc()
      for (const entry of adopted[0]!) {
        yjs.applyUpdate(applied, entry)
      }

      const taken = [adopted.length, adopted[0]!.length, applied.getText('t').toString()]
      expect(taken).toEqual([1, 2, 'left behind'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('hands removal watchers the merged update it adopted', async () => {
    fakeTime()
    fakeLocks()
    try {
      const server = fakeServer()
      const kept = await device()
      const first = await join(offlinePushes(server), { device: kept })
      first.doc.getText('t').insert(0, 'left')
      await vi.advanceTimersByTimeAsync(0)
      first.doc.getText('t').insert(4, ' behind')
      await vi.advanceTimersByTimeAsync(0)
      await idle()
      const second = await join(server.endpoints(), { device: kept })
      await idle()
      const adopted: [Uint8Array[], Uint8Array][] = []
      second.doc.on('afterTransaction', (transaction: yjs.Transaction) => {
        if (transaction.origin === ADOPT) {
          adopted.push([transaction.meta.get(APPLIED_UPDATE), transaction.meta.get(MERGED_UPDATE)])
        }
      })

      await first.close()
      await vi.advanceTimersByTimeAsync(60_000)
      await idle()

      const [[rows, merged]] = adopted
      const applied = new yjs.Doc()
      yjs.applyUpdate(applied, merged)
      const taken = [adopted.length, applied.getText('t').toString()]
      expect(taken).toEqual([1, 'left behind'])
      expect(merged).toEqual(yjs.mergeUpdates(rows))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
