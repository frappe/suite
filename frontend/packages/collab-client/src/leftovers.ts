import * as yjs from 'yjs'

import { classifyRefusal, type AccessRoom } from './access'
import { planAdoption, type Step } from './adoption'
import { HTTP_OK, readReply } from './answers'
import type { Device } from './device'
import { holdLock } from './locks'
import { ADOPT, APPLIED_UPDATE, MERGED_UPDATE } from './origins'
import { Outbox } from './outbox'
import type { StoredEntry, StoredSession } from './store'
import type { Answer, Claim } from './types'

/** What claiming an ID and adopting other tabs' work use of the room. */
export interface LeftoverRoom extends AccessRoom {
  readonly doc: yjs.Doc
  readonly device: Device | null
  readonly lineage: string
  readonly bound: boolean
  readonly closed: boolean
  readonly stopReason: string | null
  readonly restoreRev: number
  // Each writer's next clock in what the server committed, as this tab knew it before adopting anything
  readonly committed: ReadonlyMap<number, number>
  // Sessions a claim with no answer left on the device
  unclaimed: ReadonlySet<string>
  // Adopted outboxes go in ahead of this tab's own
  readonly outboxes: Outbox[]
  readonly ownClients: Set<number>
  readonly sender: { scheduleSend(): void }
  lockName(sid: string): string
  onUnreachable(): void
  onUnsentChanged(): void
}

export function lostReason(verdict: string) {
  return verdict === 'clash' ? 'id_clash' : verdict
}

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
  if (reply.status === HTTP_OK && typeof reply.claim === 'string') {
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
    return yjs.mergeUpdates(updates)
  }

  return yjs.mergeUpdates([copy.bytes, ...updates])
}

// What one adoption pass did with the sessions it met
class Pass {
  // Locked by an open tab, outside `only`, or needing one of those: left for a later pass
  readonly left = new Set<string>()
  // A claim with no answer, and every session that needs it: asked again before the next pull
  readonly unanswered = new Set<string>()
  readonly refused: RefusedChain[] = []

  constructor(private readonly only?: ReadonlySet<string>) {}

  isOutside(sids: string[]) {
    const only = this.only
    return !!only && sids.some((sid) => !only.has(sid))
  }

  // Marks the sessions and goes on with the pass
  leave(into: Set<string>, sids: string[]) {
    for (const sid of sids) {
      into.add(sid)
    }

    return true
  }
}

function releaseAll(releases: (() => void)[]) {
  for (const release of releases) {
    release()
  }
}

// A refused session and every session that needs its unsent work, kept aside as one copy; locks held until it is written
interface RefusedChain {
  reason: string
  lineage: string
  sids: string[]
  releases: (() => void)[]
}

// Never a server answer: offline, the box waits for the claim the reconnect makes
const AWAITS_CLAIM = 'awaits_claim'

// Unsent work other tabs of this document left on the device, once no live tab holds it, in an order the server takes;
// `only` limits the pass to the sessions a claim with no answer left
export async function adoptLeftovers(room: LeftoverRoom, only?: ReadonlySet<string>) {
  const device = room.device
  if (!device || room.stopReason || !room.writable) return

  const sessions = await device.sessions()
  const leftovers = await Promise.all(
    sessions.map(async (session) => ({ session, entries: await device.entries(session.sid) })),
  )
  const pass = new Pass(only)
  let isOpen = true
  for (const step of planAdoption(leftovers, room.committed)) {
    isOpen = await takeStep(room, device, pass, step)
    if (!isOpen) break
  }

  isOpen = await keepRefused(room, device, pass)
  room.unclaimed = pass.unanswered
  if (!isOpen) return

  room.onUnsentChanged()
  if (room.unsent && room.bound) {
    room.sender.scheduleSend()
  }
}

// One step of the plan; false once the room closed or shut meanwhile
async function takeStep(room: LeftoverRoom, device: Device, pass: Pass, step: Step) {
  const sids = step.leftovers.map((leftover) => leftover.session.sid)
  const needs = [...step.needs]
  if (room.outboxes.some((box) => sids.includes(box.sid))) {
    return true
  }

  if (pass.isOutside(sids)) {
    return pass.leave(pass.left, sids)
  }

  // Work on a refused session's unsent clocks, or a cycle, can't commit in any order
  const chains = pass.refused.filter((chain) => chain.sids.some((sid) => step.needs.has(sid)))
  if (chains.length || sids.length > 1) {
    return keepWith(room, pass, step, chains)
  }

  if (needs.some((sid) => pass.unanswered.has(sid))) {
    return pass.leave(pass.unanswered, sids)
  }

  if (needs.some((sid) => pass.left.has(sid))) {
    return pass.leave(pass.left, sids)
  }

  return adoptSession(room, device, pass, step.leftovers[0].session)
}

// Every lock, or none when one is held elsewhere
async function holdLocks(room: LeftoverRoom, sids: string[]) {
  const releases: (() => void)[] = []
  for (const sid of sids) {
    const release = await holdLock(room.lockName(sid))
    if (!release) {
      releaseAll(releases)
      return null
    }

    releases.push(release)
  }

  return releases
}

// The step's locks, held until its chain is written; false once the room closed or shut meanwhile
async function keepWith(room: LeftoverRoom, pass: Pass, step: Step, chains: RefusedChain[]) {
  const sids = step.leftovers.map((leftover) => leftover.session.sid)
  const releases = await holdLocks(room, sids)
  if (!releases) {
    return pass.leave(pass.left, sids)
  }

  if (room.closed || !room.writable) {
    releaseAll(releases)
    return false
  }

  joinChains(pass, step, chains, releases)
  return true
}

// The step joins the chains it needs, merged into one, or starts its own as a cycle
function joinChains(pass: Pass, step: Step, chains: RefusedChain[], releases: (() => void)[]) {
  const sids = step.leftovers.map((leftover) => leftover.session.sid)
  const [into, ...merged] = chains
  if (!into) {
    // The server's own word for work that needs clocks it hasn't committed
    const lineage = step.leftovers[0].session.lineage
    pass.refused.push({ reason: 'missing_dep', lineage, sids, releases })
    return
  }

  for (const chain of merged) {
    into.sids.push(...chain.sids)
    into.releases.push(...chain.releases)
    pass.refused.splice(pass.refused.indexOf(chain), 1)
  }

  into.sids.push(...sids)
  into.releases.push(...releases)
}

// One tab's leftover work, once no live tab holds it; false once the room closed or shut meanwhile
async function adoptSession(
  room: LeftoverRoom,
  device: Device,
  pass: Pass,
  session: StoredSession,
) {
  const release = await holdLock(room.lockName(session.sid))
  if (!release) {
    pass.left.add(session.sid)
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

  return takeOver(room, pass, session, release, entries)
}

function adoptBox(room: LeftoverRoom, box: Outbox) {
  const pending = box.pending.map((entry) => entry.bytes)
  const merged = yjs.mergeUpdates(pending)
  room.ownClients.add(box.cid)
  room.doc.transact((transaction) => {
    transaction.meta.set(APPLIED_UPDATE, pending)
    transaction.meta.set(MERGED_UPDATE, merged)
    yjs.applyUpdate(room.doc, merged, ADOPT)
  }, ADOPT)
  room.outboxes.splice(-1, 0, box)
}

// The work joins this tab's outboxes, or waits with its lock held to be kept aside with its chain
async function takeOver(
  room: LeftoverRoom,
  pass: Pass,
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

  if (claimVerdict === null) {
    release()
    pass.unanswered.add(session.sid)
    return true
  }

  if (claimVerdict !== 'ok' && claimVerdict !== AWAITS_CLAIM) {
    const sids = [session.sid]
    pass.refused.push({ reason: claimVerdict, lineage: session.lineage, sids, releases: [release] })
    return true
  }

  box.awaitsClaim = claimVerdict === AWAITS_CLAIM
  adoptBox(room, box)
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

  if (!room.bound) {
    return AWAITS_CLAIM
  }

  return claimClientId(room, box)
}

// Each refused chain as one recovery copy that reads on its own, built before any of its work leaves the store;
// once the room closed or shut, the locks go and a later tab asks again
async function keepRefused(room: LeftoverRoom, device: Device, pass: Pass) {
  const isOpen = !room.closed && room.writable
  for (const chain of pass.refused) {
    if (isOpen) {
      const entries = await Promise.all(chain.sids.map((sid) => device.entries(sid)))
      const state = await readableState(device, chain.lineage, entries.flat())
      await device.recover(chain.sids, lostReason(chain.reason), [], state)
    }

    releaseAll(chain.releases)
  }

  return isOpen
}
