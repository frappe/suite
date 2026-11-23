import type { DeviceCopy, DeviceStore, StoredEntry, StoredSession } from './store'
import type { DeviceDoc } from './types'

// One document in the device store. A write that fails is let go: the room carries on from what it holds in memory
export class Device {
  readonly store: DeviceStore
  readonly doc: string
  private readonly title?: () => string
  // Tells this document's other tabs on the device that its stored work changed; a hint, as each tab reads the store
  private notices: BroadcastChannel | null = null

  constructor({ store, doc, title }: DeviceDoc) {
    this.store = store
    this.doc = doc
    this.title = title
    if (globalThis.BroadcastChannel) {
      this.notices = new BroadcastChannel(`suite-collab:${doc}`)
    }
  }

  sessions(): Promise<StoredSession[]> {
    return this.store.sessions(this.doc).catch(() => [])
  }

  entries(sid: string): Promise<StoredEntry[]> {
    return this.store.entries(this.doc, sid).catch(() => [])
  }

  copy(): Promise<DeviceCopy | null> {
    return this.store.copy(this.doc).catch(() => null)
  }

  saveSession(session: StoredSession): Promise<void> {
    return this.store.saveSession(session).catch(() => {})
  }

  async acknowledge(
    sid: string,
    through: number,
    bytes: Uint8Array,
    lineage: string,
    epoch: number,
  ) {
    const acknowledged = this.store.acknowledge(this.doc, sid, through, bytes, lineage, epoch)
    await acknowledged.catch(() => {})
    this.changed()
  }

  commit(copy: Omit<DeviceCopy, 'bytes'>, bytes: Uint8Array | null): Promise<void> {
    return this.store.commit(this.doc, copy, bytes).catch(() => {})
  }

  // `state` is the whole document holding the work, so the copy reads on its own. Resolves whether it was written
  async recover(sids: string[], reason: string, extra?: StoredEntry[], state?: Uint8Array) {
    const snapshot = state && { state, title: this.title?.() }
    try {
      await this.store.recover(this.doc, sids, reason, extra, snapshot)
      return true
    } catch {
      return false
    } finally {
      this.changed()
    }
  }

  async release(sid: string) {
    await this.store.release(this.doc, sid).catch(() => {})
    this.changed()
  }

  // Entries the sessions not in `held` keep on the device, which their tabs have yet to see committed
  async othersUnsent(held: string[]) {
    const sessions = await this.sessions()
    const others = sessions.filter((session) => !held.includes(session.sid))
    const counts = await Promise.all(
      others.map(async (session) => (await this.entries(session.sid)).length),
    )
    return counts.reduce((sum, count) => sum + count, 0)
  }

  changed() {
    this.notices?.postMessage(null)
  }

  // Returns the function that stops listening
  onChanged(listener: () => void) {
    const notices = this.notices
    notices?.addEventListener('message', listener)
    return () => notices?.removeEventListener('message', listener)
  }

  close() {
    this.notices?.close()
    this.notices = null
  }
}
