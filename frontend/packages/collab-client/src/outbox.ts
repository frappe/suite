import { digest } from 'lib0/hash/sha256'
import * as Y from 'yjs'

import type { StoredEntry } from './store'

// Each sha adds 67 bytes to the push header, which the server caps at 4 KiB
const MAX_ENTRIES = 48
export const MAX_PUSH_BYTES = 256 * 1024
// Browsers refuse keepalive bodies over 64 KiB
export const MAX_KEEPALIVE_BYTES = 60 * 1024

// `sha` lets the server tell a resent seq from a different one under the same number
export type Entry = { seq: number; bytes: Uint8Array; sha: string }

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
    this.pending = stored.map(({ seq, bytes, sha }) => ({ seq, bytes, sha }))
    this.nextSeq = stored.length ? stored[stored.length - 1].seq + 1 : 1
    this.acked = stored.length ? stored[0].seq - 1 : 0
  }

  // The next seq's entry, not yet queued
  mint(bytes: Uint8Array): Entry {
    return { seq: this.nextSeq++, bytes, sha: hex(digest(bytes)) }
  }

  add(bytes: Uint8Array): Entry {
    const entry = this.mint(bytes)
    this.pending.push(entry)
    return entry
  }

  // The server holds everything up to `through`; returns what that newly committed, merged
  ack(through: number): Uint8Array | null {
    this.acked = Math.max(this.acked, through)
    const committed = this.pending.filter((entry) => entry.seq <= this.acked)
    if (!committed.length) return null
    this.pending = this.pending.filter((entry) => entry.seq > this.acked)
    return Y.mergeUpdates(committed.map((entry) => entry.bytes))
  }

  // Pending work no longer continues from what the server acknowledged
  get gap() {
    return this.pending.length > 0 && this.pending[0].seq !== this.acked + 1
  }

  // The longest leading run of pending entries that fits one push
  batch(maxBytes: number): Entry[] {
    const run: Entry[] = []
    let size = 0
    for (const entry of this.pending) {
      if (run.length && (run.length >= MAX_ENTRIES || size + entry.bytes.byteLength > maxBytes))
        break
      run.push(entry)
      size += entry.bytes.byteLength
    }
    return run
  }

  stored(doc: string, entries: Entry[] = this.pending): StoredEntry[] {
    return entries.map((entry) => ({ doc, sid: this.sid, ...entry }))
  }
}

// Web Locks only cut duplicate sends between tabs; where they are missing, every session counts as free
export function holdLock(name: string): Promise<(() => void) | null> {
  const locks = globalThis.navigator?.locks
  if (!locks) return Promise.resolve(() => {})
  return new Promise((resolve) => {
    void locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(null)
        return new Promise<void>((release) => resolve(release))
      })
      .catch(() => resolve(() => {}))
  })
}

export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)))
