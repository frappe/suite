import { classifyRefusal, isDisabled, type AccessRoom } from './access'
import { HTTP_ACCEPTED, HTTP_LOCKED, HTTP_OK, readReply, type Reply } from './answers'
import { backoffMs } from './backoff'
import type { PullHeader } from './frames'
import { BUSY_RETRY_MS } from './sender'
import { isRecoverable, type Held } from './types'

/** What a suspect report reads and changes on the room. */
export interface VerdictRoom extends AccessRoom {
  readonly lineage: string
  readonly closed: boolean
  readonly held: Held | null
  readonly sender: { scheduleSend(): void }
  setPaused(reason: string | null): void
  setHeld(held: Held | null): void
  markNeedsRebuild(): void
  stopForGood(reason: string): Promise<void>
  onUnreachable(): void
}

const STRIKE_WINDOW_MS = 10 * 60_000
const MAX_STRIKES = 3

// When rows were judged clean and still failed to apply in this page, per lineage
const strikes = new Map<string, number[]>()

function recordStrike(lineage: string) {
  const now = Date.now()
  const strikeTimes = strikes.get(lineage) ?? []
  const recent = strikeTimes.filter((strikeTime) => now - strikeTime < STRIKE_WINDOW_MS)
  recent.push(now)
  strikes.set(lineage, recent)
  return recent.length
}

// The rev reported, and the `judged` count its verdict comes after
interface Judging {
  rev: number
  seen: number | null
}

// Rows that failed to apply here are reported, and the room follows nothing more until the server judges them
export class SuspectReport {
  private judging: Judging | null = null
  private reportTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly room: VerdictRoom) {}

  get isJudging() {
    return this.judging !== null
  }

  mark(rev: number) {
    this.judging = { rev, seen: null }
    this.room.setPaused('suspect')
    void this.report()
  }

  async check(header: PullHeader) {
    const judging = this.judging
    const judgedCount = header.judged ?? 0
    if (!judging || judging.seen === null || judgedCount <= judging.seen) return

    judging.seen = judgedCount
    await this.apply(header.verdict ?? 'unjudged')
  }

  clearTimer() {
    if (this.reportTimer) {
      clearTimeout(this.reportTimer)
    }

    this.reportTimer = null
  }

  private async report() {
    const judging = this.judging
    const room = this.room
    if (!judging || room.closed) return

    let reply: Reply
    try {
      const answer = await room.options.endpoints.suspect(judging.rev)
      reply = readReply(answer)
    } catch {
      room.onUnreachable()
      return this.reportAfter(backoffMs())
    }

    await this.takeReply(judging, reply)
  }

  private async takeReply(judging: Judging, reply: Reply) {
    const room = this.room
    if (reply.status === HTTP_ACCEPTED && typeof reply.judged === 'number') {
      judging.seen = reply.judged
    } else if (reply.status === HTTP_LOCKED) {
      if (reply.reason === 'suspect') {
        room.setHeld(room.held ?? 'change')
      }

      this.reportAfter(reply.retry_ms ?? BUSY_RETRY_MS)
    } else if (reply.status === HTTP_OK && reply.verdict) {
      await this.apply(reply.verdict)
    } else {
      // Only a verdict counts against this browser; a failing server or a lapsed sign-in is asked again
      const blocked = classifyRefusal(room, reply, 'lost_read')
      if (isDisabled(reply)) {
        await room.stopForGood('disabled')
      } else if (!blocked || isRecoverable(blocked)) {
        this.reportAfter(backoffMs())
      }
    }
  }

  private reportAfter(delayMs: number) {
    if (this.room.closed) return

    const reportAgain = () => {
      this.reportTimer = null
      void this.report()
    }

    this.reportTimer = setTimeout(reportAgain, delayMs)
  }

  // A held document waits for an admin. Anything but a quarantine means this browser failed on rows the server takes
  private async apply(verdict: string) {
    if (verdict === 'held') return

    const room = this.room
    if (verdict !== 'quarantined' && recordStrike(room.lineage) >= MAX_STRIKES) {
      return room.stopForGood('browser')
    }

    // Unsent work kept nowhere else is sent from this copy before it is rebuilt
    this.judging = null
    room.setPaused(null)
    room.markNeedsRebuild()
    if (room.unsent) {
      room.sender.scheduleSend()
    }
  }
}
