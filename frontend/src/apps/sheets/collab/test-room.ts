// Test kit: a content-layer server in memory, handing out fake rooms. A
// room's own updates wait in its outbox until deliver(), which applies them to
// every other room's doc as the client applies pulled rows. Each room's status
// can be set, as the server's answers would set it.
//
// Imported by tests only.

import { vi } from 'vitest'
import * as Y from 'yjs'

import type { CollabRoom, Opened, RoomStatus } from '@/platform/collab'

export const SERVER = Symbol('server')

export const CLEAN: RoomStatus = {
  canWrite: true,
  saveState: 'clean',
  liveState: 'live',
  limits: null,
  restoreRev: 0,
  blockReason: null,
  pauseReason: null,
  stopReason: null,
  holdReason: null,
  isRestoring: false,
  hasNewerSchema: false,
  isReopenNeeded: false,
  isKeptOnDevice: true,
  isAtLimit: false,
  hasCopyFailed: false,
  unsentCount: 0,
  othersUnsentCount: 0,
  keptCopyCount: 0,
}

export interface FakeRoom extends CollabRoom {
  outbox: Uint8Array[]
  setStatus(patch: Partial<RoomStatus>): void
}

export function fakeServer(start?: Y.Doc) {
  const rooms: FakeRoom[] = []
  const state = start ? Y.encodeStateAsUpdate(start) : null

  function makeRoom(): FakeRoom {
    const doc = new Y.Doc()
    if (state) Y.applyUpdate(doc, state, SERVER)
    const outbox: Uint8Array[] = []
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== SERVER) outbox.push(u)
    })
    const listeners = new Set<() => void>()
    let status = CLEAN
    const room = {
      doc,
      outbox,
      lineage: 'test',
      presence: null,
      ownClients: new Set([doc.clientID]),
      get status() {
        return status
      },
      setStatus(patch: Partial<RoomStatus>) {
        status = { ...status, ...patch }
        for (const cb of listeners) cb()
      },
      onChange(cb: () => void) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      pull: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      restoreVersion: vi.fn(async (_version: number, edit: () => void) => {
        doc.transact(edit)
        return { outcome: 'landed' as const }
      }),
      loseAccess: vi.fn(async () => {}),
      regainAccess: vi.fn(async () => {}),
      isCommitted: () => true,
    }
    return room as unknown as FakeRoom
  }

  function open(): Promise<Opened> {
    const room = makeRoom()
    rooms.push(room)
    return Promise.resolve({ state: 'live', room })
  }

  function deliver() {
    for (const from of rooms) {
      for (const u of from.outbox.splice(0)) {
        for (const to of rooms) if (to !== from) Y.applyUpdate(to.doc, u, SERVER)
      }
    }
  }

  return { open, deliver, rooms }
}
