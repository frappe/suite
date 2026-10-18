import * as Y from 'yjs'

import { classifyRefusal, type AccessRoom } from './access'
import { readReply } from './answers'
import type { Device } from './device'
import { holdLock } from './locks'
import { ADOPT } from './origins'
import { Outbox } from './outbox'
import type { StoredEntry, StoredSession } from './store'
import type { Answer, Claim } from './types'

/** What claiming an ID and adopting other tabs' work use of the room. */
export interface LeftoverRoom extends AccessRoom {
  readonly doc: Y.Doc
  readonly device: Device | null
  readonly lineage: string
  readonly bound: boolean
  readonly closed: boolean
  readonly stopReason: string | null
  readonly restoreRev: number
  // Adopted outboxes go in ahead of this tab's own
  readonly outboxes: Outbox[]
  readonly sender: { scheduleSend(): void }
  lockName(sid: string): string
  onUnreachable(): void
  onUnsentChanged(): void
}

export const lostReason = (verdict: string) => (verdict === 'clash' ? 'id_clash' : verdict)

// Asks the server for a clientID chosen offline. `null` when the claim got no verdict this time; a refusal with a reason is final
export async function claimClientId(room: LeftoverRoom, box: Outbox): Promise<string | null> {
  const claim: Claim = { cid: box.cid, lineage: room.lineage }
  let answer: Answer
  try {
    answer = await room.options.endpoints.session(box.sid, claim)
  } catch {
    room.onUnreachable()
    return null
  }

  const reply = readReply(answer)
  if (reply.status === 200 && typeof reply.claim === 'string') {
    if (reply.claim === 'ok') {
      await bindOnDevice(room, box)
    }
    return reply.claim
  }

  const blocked = classifyRefusal(room, reply, 'lost_edit')
  if (blocked) {
    return null
  }

  return reply.collab ?? null
}

async function bindOnDevice(room: LeftoverRoom, box: Outbox) {
  if (!room.device) {
    return
  }

  const session = { doc: room.device.doc, sid: box.sid, lineage: room.lineage, cid: box.cid }
  await room.device.saveSession({ ...session, bound: true })
}

// The device copy with the work on top, when the copy is still the history the work was typed on
async function readableState(device: Device, lineage: string, entries: StoredEntry[]) {
  const copy = await device.copy()
  const updates = entries.map((entry) => entry.bytes)
  if (copy?.lineage !== lineage) {
    return Y.mergeUpdates(updates)
  }

  return Y.mergeUpdates([copy.bytes, ...updates])
}

// Unsent work other tabs of this document left on the device, once no live tab holds it
export async function adoptLeftovers(room: LeftoverRoom) {
  const device = room.device
  if (!device || room.stopReason || !room.writable) return

  const sessions = await device.sessions()
  for (const session of sessions) {
    const isOpen = await adoptSession(room, device, session)
    if (!isOpen) {
      return
    }
  }

  room.onUnsentChanged()
  if (room.unsent && room.bound) {
    room.sender.scheduleSend()
  }
}

function isAdoptable(room: LeftoverRoom, session: StoredSession) {
  const isHeldHere = room.outboxes.some((box) => box.sid === session.sid)
  return !isHeldHere && (session.bound || room.bound)
}

// One tab's leftover work, once no live tab holds it; false once the room closed or shut meanwhile
async function adoptSession(room: LeftoverRoom, device: Device, session: StoredSession) {
  if (!isAdoptable(room, session)) {
    return true
  }

  const release = await holdLock(room.lockName(session.sid))
  if (!release) {
    return true
  }

  if (room.closed || !room.writable) {
    release()
    return false
  }

  const entries = await device.entries(session.sid)
  if (!entries.length) {
    await device.release(session.sid)
    release()
    return true
  }

  return takeOver(room, device, session, release, entries)
}

// The work joins this tab's outboxes, or is kept aside when its claim is refused
async function takeOver(
  room: LeftoverRoom,
  device: Device,
  session: StoredSession,
  release: () => void,
  entries: StoredEntry[],
) {
  const box = new Outbox(session.sid, session.cid, release, true, entries)
  const claimVerdict = await claimVerdictOf(room, session, box)
  if (room.closed || !room.writable) {
    release()
    return false
  }

  if (claimVerdict !== 'ok') {
    await keepAside(device, session, claimVerdict, entries)
    release()
    return true
  }

  Y.applyUpdate(room.doc, Y.mergeUpdates(box.pending.map((entry) => entry.bytes)), ADOPT)
  room.outboxes.splice(-1, 0, box)
  return true
}

async function claimVerdictOf(room: LeftoverRoom, session: StoredSession, box: Outbox) {
  if (session.lineage !== room.lineage) {
    return 'lineage'
  }

  if (box.isStaleAfter(room.restoreRev)) {
    return 'restored'
  }

  if (session.bound) {
    return 'ok'
  }

  return claimClientId(room, box)
}

// A refused claim keeps the work as a recovery copy; no verdict leaves it for a later tab
async function keepAside(
  device: Device,
  session: StoredSession,
  claimVerdict: string | null,
  entries: StoredEntry[],
) {
  if (!claimVerdict) {
    return
  }

  const state = await readableState(device, session.lineage, entries)
  await device.recover([session.sid], lostReason(claimVerdict), [], state)
}
