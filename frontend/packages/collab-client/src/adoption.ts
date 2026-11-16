import * as yjs from 'yjs'

import type { StoredEntry, StoredSession } from './store'

/** A session on the device with the entries it still keeps. */
export interface Leftover {
  session: StoredSession
  entries: StoredEntry[]
}

/** Sessions taken together, in an order the server accepts: one, or a cycle no order can send. */
export interface Step {
  leftovers: Leftover[]
  // The sessions outside the step whose unsent clocks it refers to
  needs: Set<string>
}

// A run of one writer's clocks, end exclusive
interface Clocks {
  client: number
  from: number
  to: number
}

// The clocks the session made that `committed` doesn't hold. A stored entry may have committed with its answer lost
function pendingOf({ session, entries }: Leftover, committed: ReadonlyMap<number, number>): Clocks {
  let from = Infinity
  let to = 0
  for (const entry of entries) {
    const meta = yjs.parseUpdateMeta(entry.bytes)
    from = Math.min(from, meta.from.get(session.cid) ?? Infinity)
    to = Math.max(to, meta.to.get(session.cid) ?? 0)
  }

  return { client: session.cid, from: Math.max(from, committed.get(session.cid) ?? 0), to }
}

// What the server needs committed before it takes the update: each origin, right origin, parent named by id, and deleted clock
function referencesOf(bytes: Uint8Array): Clocks[] {
  const { structs, ds } = yjs.decodeUpdate(bytes)
  const references: Clocks[] = []
  for (const struct of structs) {
    if (!(struct instanceof yjs.Item)) continue

    const ids = [struct.origin, struct.rightOrigin, struct.parent].filter(
      (id): id is yjs.ID => id instanceof yjs.ID,
    )
    references.push(...ids.map((id) => ({ client: id.client, from: id.clock, to: id.clock + 1 })))
  }

  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      references.push({ client, from: clock, to: clock + len })
    }
  }

  return references
}

function overlaps(left: Clocks, right: Clocks) {
  return left.client === right.client && left.from < right.to && right.from < left.to
}

// For each session, the others whose unsent clocks its entries refer to; committed clocks never count, whoever wrote them
function needsOf(leftovers: Leftover[], committed: ReadonlyMap<number, number>) {
  const pending = leftovers.map((leftover) => ({
    sid: leftover.session.sid,
    clocks: pendingOf(leftover, committed),
  }))
  const needs = new Map<string, Set<string>>()
  for (const { session, entries } of leftovers) {
    const references = entries.flatMap((entry) => referencesOf(entry.bytes))
    const needed = pending.filter(
      (other) =>
        other.sid !== session.sid && references.some((clocks) => overlaps(clocks, other.clocks)),
    )
    needs.set(session.sid, new Set(needed.map((other) => other.sid)))
  }

  return needs
}

// Tarjan's strongly connected components, which come out with every step after the ones it needs
class Planner {
  readonly steps: Step[] = []
  private readonly visits = new Map<string, { index: number; low: number }>()
  private readonly stack: string[] = []

  constructor(
    private readonly needs: Map<string, Set<string>>,
    private readonly bySid: Map<string, Leftover>,
  ) {}

  hasVisited(sid: string) {
    return this.visits.has(sid)
  }

  connect(sid: string) {
    const mark = { index: this.visits.size, low: this.visits.size }
    this.visits.set(sid, mark)
    this.stack.push(sid)
    for (const needed of this.needs.get(sid)!) {
      const visit = this.visits.get(needed)
      if (!visit) {
        this.connect(needed)
        mark.low = Math.min(mark.low, this.visits.get(needed)!.low)
      } else if (this.stack.includes(needed)) {
        mark.low = Math.min(mark.low, visit.index)
      }
    }

    if (mark.low === mark.index) {
      this.takeStep(sid)
    }
  }

  private takeStep(sid: string) {
    const members = this.stack.splice(this.stack.indexOf(sid))
    const outside = members.flatMap((member) => [...this.needs.get(member)!])
    this.steps.push({
      leftovers: members.map((member) => this.bySid.get(member)!),
      needs: new Set(outside.filter((needed) => !members.includes(needed))),
    })
  }
}

export function planAdoption(
  leftovers: Leftover[],
  committed: ReadonlyMap<number, number>,
): Step[] {
  const bySid = new Map(leftovers.map((leftover) => [leftover.session.sid, leftover]))
  const planner = new Planner(needsOf(leftovers, committed), bySid)
  // Sorted, so sessions that need nothing of each other keep one order
  for (const sid of [...bySid.keys()].sort()) {
    if (!planner.hasVisited(sid)) {
      planner.connect(sid)
    }
  }

  return planner.steps
}
