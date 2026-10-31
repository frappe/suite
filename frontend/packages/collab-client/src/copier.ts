import type * as yjs from 'yjs'

import { randomHex } from './bytes'
import type { Outbox } from './outbox'
import { putPieces } from './pieces'
import type { Blocked, OpenOptions, SaveState } from './types'

// The server asks on every push until a checked copy lands, so a tab renders at most once a minute
const RENDER_GAP_MS = 60_000
const STAGE_ID_BYTES = 16

/** What rendering the readable copy reads on the room. */
export interface CopierRoom {
  readonly doc: yjs.Doc
  readonly options: OpenOptions
  readonly lineage: string
  readonly epoch: number
  readonly bound: boolean
  readonly closed: boolean
  readonly canWrite: boolean
  readonly needsRebuild: boolean
  readonly blocked: Blocked | null
  readonly appliedThrough: number
  readonly saveState: SaveState
  readonly ownOutbox: Pick<Outbox, 'sid'>
}

// Renders the document as its readable copy when the server asks, once the tab is at a clean moment
export class Copier {
  private asked = false
  private committedRev = 0
  private sending = false
  private lastSentAt = -Infinity
  private renderedRev = 0

  constructor(private readonly room: CopierRoom) {}

  // A push of this tab's work committed through `rev`; `copy`: the server asks for a render
  committed(rev: number, copy: boolean | undefined) {
    this.committedRev = Math.max(this.committedRev, rev)
    if (copy && Date.now() - this.lastSentAt >= RENDER_GAP_MS) {
      this.asked = true
    }
  }

  // A hidden tab may not come back, so the copy takes what it holds that no render of its own has
  pageHidden() {
    const room = this.room
    if (room.saveState !== 'clean' || room.appliedThrough > this.renderedRev) {
      this.asked = true
      this.sendWhenClean()
    }
  }

  sendWhenClean() {
    if (!this.asked || this.sending || !this.isClean) return

    this.asked = false
    this.sending = true
    this.lastSentAt = Date.now()
    void this.send()
      .catch(() => {})
      .finally(() => {
        this.sending = false
      })
  }

  // Nothing waits to be sent, and the rows applied here cover this tab's last committed one
  private get isClean() {
    const room = this.room
    const covered = room.appliedThrough >= Math.max(this.committedRev, 1)
    const settled = room.saveState === 'clean' && covered
    const canRender = room.bound && room.canWrite && !room.closed && !room.needsRebuild
    return settled && canRender && !room.blocked
  }

  private async send() {
    const room = this.room
    const html = new TextEncoder().encode(room.options.adapter.toHtml?.(room.doc) ?? '')
    if (!html.byteLength) return

    const { endpoints, expectedUser } = room.options
    const stageId = randomHex(STAGE_ID_BYTES)
    const rev = room.appliedThrough
    const place = {
      lineage: room.lineage,
      expected_user: expectedUser,
      sid: room.ownOutbox.sid,
      purpose: 'render' as const,
      rev,
      q_epoch: room.epoch,
    }
    const refused = await putPieces(endpoints, stageId, place, html)
    if (!refused) {
      await endpoints.render(stageId)
      this.renderedRev = rev
    }
  }
}
