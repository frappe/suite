import { digest } from 'lib0/hash/sha256'
import * as yjs from 'yjs'

import { hex } from './bytes'
import type { StoredEntry } from './store'

// Each sha adds 67 bytes to the push header, which the server's stage.HEADER_MAX caps at 4 KiB
const MAX_ENTRIES = 48
export const MAX_HEADER_BYTES = 4 * 1024
export const MAX_PUSH_BYTES = 256 * 1024
// Browsers refuse keepalive requests past 64 KiB in flight at once; 1 KiB stays for the URL and headers
export const KEEPALIVE_QUOTA = 63 * 1024
export const MAX_KEEPALIVE_BYTES = KEEPALIVE_QUOTA - MAX_HEADER_BYTES

// `sha` lets the server tell a resent seq from a different one under the same number;
// `seenRev` is the rev the tab had applied when it was typed; `restore` is the fence's token on a restore
export interface Entry {
  seq: number
  bytes: Uint8Array
  sha: string
  seenRev: number
  restore?: string
}

// One session's unsent work: this tab's own, or one adopted from a tab that closed
export class Outbox {
  pending: Entry[]
  nextSeq: number
  acked: number

  constructor(
    readonly sid: string,
    readonly cid: number,
    public release: () => void,
    readonly adopted = false,
    // What a closed tab left on the device
    stored: StoredEntry[] = [],
  ) {
    this.pending = stored.map(({ seq, bytes, sha, seenRev }) => ({ seq, bytes, sha, seenRev }))
    this.nextSeq = 1
    this.acked = 0
    if (stored.length) {
      this.nextSeq = stored[stored.length - 1].seq + 1
      this.acked = stored[0].seq - 1
    }
  }

  // The next seq's entry, not yet queued
  createEntry(bytes: Uint8Array, seenRev: number, restore?: string): Entry {
    const sha = hex(digest(bytes))
    const entry: Entry = { seq: this.nextSeq++, bytes, sha, seenRev }
    if (restore) {
      entry.restore = restore
    }

    return entry
  }

  add(bytes: Uint8Array, seenRev: number, restore?: string): Entry {
    const entry = this.createEntry(bytes, seenRev, restore)
    this.pending.push(entry)
    return entry
  }

  // The server holds everything up to `through`; returns what that newly committed, merged
  acknowledge(through: number): Uint8Array | null {
    this.acked = Math.max(this.acked, through)
    const committed = this.pending.filter((entry) => entry.seq <= this.acked)
    if (!committed.length) {
      return null
    }

    this.pending = this.pending.filter((entry) => entry.seq > this.acked)
    return yjs.mergeUpdates(committed.map((entry) => entry.bytes))
  }

  // Whether an unsent entry made the item `id`
  holds(id: yjs.ID) {
    return this.pending.some((entry) => {
      const { from, to } = yjs.parseUpdateMeta(entry.bytes)
      const first = from.get(id.client) ?? Infinity
      const end = to.get(id.client) ?? 0
      return first <= id.clock && id.clock < end
    })
  }

  // Holds work typed before the restore at `restoreRev`
  isStaleAfter(restoreRev: number) {
    return this.pending.some((entry) => !entry.restore && entry.seenRev < restoreRev)
  }

  // A restore the server refused changes nothing
  dropRestore() {
    this.pending = this.pending.filter((entry) => !entry.restore)
  }

  // Pending work no longer continues from what the server acknowledged
  get hasGap() {
    return this.pending.length > 0 && this.pending[0].seq !== this.acked + 1
  }

  // The longest leading run of pending entries after `afterSeq` that fits one push; a restore goes alone
  nextBatch(maxBytes: number, afterSeq = 0): Entry[] {
    const batch: Entry[] = []
    let size = 0
    const unsent = this.pending.filter((entry) => entry.seq > afterSeq)
    for (const entry of unsent) {
      const tooMany = batch.length >= MAX_ENTRIES
      const tooBig = size + entry.bytes.byteLength > maxBytes
      const otherKind = batch.length > 0 && entry.restore !== batch[0].restore
      if (batch.length && (tooMany || tooBig || otherKind)) {
        break
      }

      batch.push(entry)
      size += entry.bytes.byteLength
    }

    return batch
  }

  // A restore never outlives its tab: its fence lapses and nothing changed
  toStoredEntries(doc: string, entries: Entry[] = this.pending): StoredEntry[] {
    const withSession = (entry: Entry): StoredEntry => ({
      doc,
      sid: this.sid,
      ...entry,
    })
    return entries.filter((entry) => !entry.restore).map(withSession)
  }
}
