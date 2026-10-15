import * as Y from 'yjs'

import { block } from './access'
import { readReply } from './answers'
import { Copier } from './copier'
import { Device } from './device'
import { RestoreFence } from './fence'
import type { Limits } from './frames'
import { adoptLeftovers, claimClientId, lostReason } from './leftovers'
import { Live, type LiveHooks } from './live'
import { hasLocks, holdLock } from './locks'
import type { Opening, RoomInit } from './opening'
import { ADOPT, REMOTE, RESTORE } from './origins'
import { Outbox } from './outbox'
import { Puller } from './puller'
import { Sender } from './sender'
import type { StoredEntry, StoredSession } from './store'
import {
  isRecoverable,
  type Blocked,
  type CollabRoom,
  type Held,
  type LiveState,
  type OpenOptions,
  type RestoreOutcome,
  type RestoreResult,
  type SaveState,
} from './types'
import { SuspectReport } from './verdict'

const PERSIST_AFTER_MS = 60_000
// Without live updates a tab pulls every tick while others are editing or work waits, and every sixth tick otherwise
const QUIET_TICKS = 6
const CO_EDITING_MS = 60_000

// Each collaborator below reads and changes this state through its own narrow interface
export class Room implements CollabRoom {
  readonly doc: Y.Doc
  blocked: Blocked | null = null
  paused: string | null = null
  held: Held | null = null
  newerSchema = false
  appliedThrough = 0
  // The rev of the last restore this tab heard of
  restoreRev = 0
  // The fence's token while this tab's own restore is on its way
  private restoreToken: string | null = null
  limits: Limits | null = null
  needsRebuild = false
  readonly lineage: string
  readonly epoch: number
  writable: boolean
  bound: boolean
  readonly ownOutbox: Outbox
  // Tabs' leftovers come first and this tab's own stays last
  outboxes: Outbox[]
  closed = false
  // Set once this tab's work can never be committed; the reason it was kept as a recovery copy
  stopReason: string | null = null
  copiesKept = 0
  copyFailed = false
  // Typing after the stop that no device copy holds
  private lateTypingKeptNowhere = 0
  failed = false
  unheard = false
  // Changes other tabs of this document keep on the device and have yet to see committed
  othersUnsent = 0
  device: Device | null
  realtime: Live | null = null
  readonly sender: Sender = new Sender(this)
  readonly puller = new Puller(this)
  readonly suspect: SuspectReport = new SuspectReport(this)
  readonly copier = new Copier(this)
  readonly fence = new RestoreFence(() => this.notifyListeners())
  private connecting: Promise<void> | null = null
  private unsentSince = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<() => void>()
  private persisted = false
  private ticks = 0
  private lastRemoteAt = 0
  private deviceStale = false
  private deviceRead: Promise<void> | null = null

  constructor(
    init: RoomInit,
    readonly options: OpenOptions,
  ) {
    this.doc = init.doc
    this.lineage = init.lineage
    this.epoch = init.epoch
    this.writable = init.canWrite
    this.bound = init.bound
    this.device = options.device ? new Device(options.device) : null
    this.ownOutbox = new Outbox(init.sid, init.doc.clientID, () => {})
    this.outboxes = [this.ownOutbox]
  }

  async start(opening: Opening) {
    this.doc.on('update', this.onDocUpdate)
    if (this.device && this.writable && this.bound) {
      const session = this.ownSession(this.device)
      await this.device.store.saveSession(session).catch(() => this.dropDeviceStore())
    }

    const ownLockName = this.lockName(this.ownOutbox.sid)
    const releaseOwnLock = await holdLock(ownLockName)
    this.ownOutbox.release = releaseOwnLock ?? (() => {})

    this.appliedThrough = opening.base
    this.sender.setPace(opening.paceMs)
    this.unheard = !!opening.offline
    this.limits = opening.limits ?? null
    this.fence.follow(opening.restoringMs)
    this.restoreRev = opening.restoreRev ?? 0
    this.follow(opening.schema)
    this.puller.applyRows(opening.rows, opening)
    if (this.writable) {
      await adoptLeftovers(this)
    }

    if (this.options.socket && !this.closed) {
      const liveHooks: LiveHooks = {
        heardRows: this.puller.heardRows,
        pull: () => void this.pull(),
        changed: () => this.notifyListeners(),
        appliedThrough: () => this.appliedThrough,
        showsCaret: () => this.canWrite && this.bound && !this.closed,
        position: this.options.adapter.position,
        controlHeard: (heard) => this.controlHeard(heard),
        reconnected: () => this.options.threadsChanged?.(),
      }
      this.realtime = new Live(this.options.socket, this.lineage, liveHooks)
      if (opening.rooms) {
        this.realtime.setRoomKeys(opening.rooms)
      }
    }

    this.pollTimer = setInterval(() => void this.tick(), this.options.pollMs ?? 5000)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('pagehide', this.sender.sendNow)
    this.device?.onChanged(() => this.refreshDevice())
    this.refreshDevice()
  }

  get canWrite() {
    return this.writable && !this.suspect.isJudging && !this.held && !this.restoring
  }

  // Typing before the restore's row is applied would be made against what it replaced
  private get holdsRestore() {
    return this.appliedThrough >= this.restoreRev
  }

  get restoring() {
    return this.fence.standing || !!this.restoreToken || !this.holdsRestore
  }

  get live(): LiveState | null {
    return this.realtime?.state ?? null
  }

  get presence() {
    return this.realtime?.presence ?? null
  }

  get stopped() {
    return this.stopReason
  }

  get onDevice() {
    return !!this.device
  }

  get atLimit() {
    const limits = this.limits
    if (!limits) {
      return false
    }

    return limits.state_bytes + limits.tail_bound >= limits.state_max
  }

  get unsent() {
    const pending = this.outboxes.reduce((sum, box) => sum + box.pending.length, 0)
    return pending + this.lateTypingKeptNowhere
  }

  // A stopped tab stays failed while it holds work; once a refusal leaves nothing unsent there is nothing to fail
  get saveState(): SaveState {
    const refusedWithNothingUnsent = !!this.blocked && !this.unsent
    if (this.failed && !refusedWithNothingUnsent) {
      return 'failed'
    }

    if (this.sender.inFlight) {
      return 'saving'
    }

    if (this.unsent || this.othersUnsent) {
      return 'unsaved'
    }

    return 'clean'
  }

  get readBlocked() {
    return this.blocked === 'other_user' || this.blocked === 'lost_read'
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  pull(): Promise<void> {
    if (this.closed || this.needsRebuild || this.readBlocked) {
      return Promise.resolve()
    }

    if (!this.bound) {
      if (this.stopReason) {
        return Promise.resolve()
      }

      return this.claimAndBind()
    }

    return this.connecting ?? this.puller.pullNow()
  }

  // Waits out each retry delay rather than pushing again at once
  async flush() {
    while (this.canFlush) {
      await (this.sender.inFlight ?? this.sender.retrying ?? this.sender.send())
    }
  }

  async close() {
    if (this.closed) return

    if (this.sender.inFlight) {
      await this.sender.inFlight
    }
    if (this.bound && this.unsent && this.saveState !== 'failed') {
      this.clearTimers()
      await this.sender.send({ keepalive: true })
    }

    this.closed = true
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('pagehide', this.sender.sendNow)
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
    }
    this.realtime?.close()
    this.fence.close()
    this.clearTimers()
    this.doc.off('update', this.onDocUpdate)
    this.listeners.clear()
    for (const box of this.outboxes) {
      box.release()
    }
    if (this.device && !this.ownOutbox.pending.length && !this.stopReason) {
      void this.device.release(this.ownOutbox.sid)
    }

    this.device?.close()
  }

  // The work this tab holds can never be committed: keep it as a recovery copy and stop
  async stopForGood(reason: string) {
    this.writable = false
    this.failed = true
    const recovered = this.moveToRecovery(reason)
    this.notifyListeners()
    await recovered
  }

  async moveToRecovery(reason: string) {
    if (this.stopReason) return

    this.stopReason = reason
    if (!this.device) return

    // One copy for the tab, under its own session, holding what it adopted too
    const boxes = [this.ownOutbox, ...this.outboxes.filter((box) => box !== this.ownOutbox)]
    const sids = boxes.map((box) => box.sid)
    const doc = this.device.doc
    const stored = boxes.flatMap((box) => box.toStoredEntries(doc))
    await this.keepCopy(this.device, sids, reason, stored)
  }

  private async keepCopy(device: Device, sids: string[], reason: string, stored: StoredEntry[]) {
    const isKept = await device.recover(sids, reason, stored, Y.encodeStateAsUpdate(this.doc))
    this.copyFailed = !isKept
    if (isKept) {
      this.copiesKept++
    }

    this.notifyListeners()
    return isKept
  }

  // Without a device store nothing typed offline would survive the tab, so editing stops until the server answers
  onUnreachable() {
    this.unheard = true
    if (this.device) {
      if (this.unsent) {
        this.requestPersistentStorage()
      }
    } else if (!this.blocked) {
      block(this, 'offline')
    }
  }

  markNeedsRebuild() {
    if (this.needsRebuild) return

    this.needsRebuild = true
    this.notifyListeners()
  }

  updateLimits(limits: Limits) {
    const wasAtLimit = this.atLimit
    this.limits = limits
    if (this.atLimit !== wasAtLimit) {
      this.notifyListeners()
    }
  }

  setPaused(reason: string | null) {
    if (this.paused === reason) return

    this.paused = reason
    this.notifyListeners()
  }

  // An editor older than the document's rows may drop what it can't show; nothing it does from now on is sent.
  // Work typed before still goes out, as the server takes older schemas
  follow(schema = 0) {
    if (this.newerSchema) {
      return false
    }

    if (schema <= this.options.adapter.features.schema) {
      return true
    }

    this.newerSchema = true
    this.writable = false
    this.notifyListeners()
    return false
  }

  controlHeard(heard: Record<string, unknown>) {
    if (heard.kind === 'restoring') {
      this.fence.follow(heard.fence_ms)
    } else if (heard.kind === 'restored') {
      this.followRestore(heard.restore_rev)
      this.fence.lift()
    } else if (heard.kind === 'restore_ended') {
      this.fence.lift()
    } else if (heard.kind === 'threads') {
      this.options.threadsChanged?.()
    }
  }

  // A restore this tab's unsent work predates stops it: the work becomes a recovery copy and
  // the tab is rebuilt from the server. False when it stopped the tab
  followRestore(rev: unknown) {
    if (typeof rev !== 'number' || rev <= this.restoreRev) {
      return true
    }

    this.restoreRev = rev
    if (!this.outboxes.some((box) => box.isStaleAfter(rev))) {
      return true
    }

    void this.setAsideForRestore()
    return false
  }

  private async setAsideForRestore() {
    await this.stopForGood('restored')
    this.markNeedsRebuild()
  }

  // Makes `edit` this tab's restore under the fence `token` and sends it alone. Editing stays
  // locked until the server answers, so nothing is typed against a document it may not take
  async restore(token: string, edit: () => void): Promise<RestoreOutcome> {
    if (this.unsent || this.sender.inFlight) {
      return 'unsent'
    }

    if (!this.writable || !this.bound || this.closed) {
      return 'refused'
    }

    const landedBefore = this.restoreRev
    this.restoreToken = token
    try {
      this.doc.transact(edit, RESTORE)
      if (!this.unsent) {
        return 'unchanged'
      }

      await this.flush()
    } finally {
      this.restoreToken = null
      this.notifyListeners()
    }

    return this.restoreRev > landedBefore ? 'landed' : 'refused'
  }

  async restoreVersion(version: number, edit: () => void): Promise<RestoreResult> {
    if (this.unsent || this.sender.inFlight) {
      return { outcome: 'unsent' }
    }

    const { endpoints } = this.options
    let reply = readReply(await endpoints.beginRestore(this.appliedThrough, version))
    if (reply.collab === 'behind') {
      await this.pull()
      reply = readReply(await endpoints.beginRestore(this.appliedThrough, version))
    }

    if (reply.status !== 200 || typeof reply.token !== 'string') {
      return { outcome: 'refused', refusal: reply.collab ?? 'failed', retryS: reply.retry_s }
    }

    let outcome: RestoreOutcome = 'refused'
    try {
      outcome = await this.restore(reply.token, edit)
    } finally {
      if (outcome !== 'landed') {
        // A fence nobody calls off lapses at its deadline
        endpoints.cancelRestore(reply.token).catch(() => null)
      }
    }

    return { outcome }
  }

  // This tab held every row before its restore, so the restore's row is the next it applies;
  // the fence went with it, whether or not the notice comes
  restoreLanded(rev: number, bytes: Uint8Array) {
    this.restoreRev = Math.max(this.restoreRev, rev)
    this.puller.applyRows([{ rev, bytes }])
    this.fence.lift()
  }

  // The fence lifted, lapsed or was taken over first: the restore changes nothing,
  // and the tab is opened again from the server
  async restoreLost() {
    this.ownOutbox.dropRestore()
    await this.stopForGood('restore_lost')
    this.markNeedsRebuild()
  }

  // A held document's pushes wait minutes between tries, so its release sends at once
  setHeld(held: Held | null) {
    if (this.held === held) return

    const released = !held
    this.held = held
    this.notifyListeners()
    if (released) {
      this.sender.retryNow()
    }
  }

  // Work held while the server was out of reach goes out on the first answer, not after the retry wait
  onServerHeard() {
    const wasUnheard = this.unheard
    this.unheard = false
    if (this.blocked && !isRecoverable(this.blocked)) return

    const wasBlocked = this.blocked !== null
    if (wasBlocked) {
      this.blocked = null
      this.notifyListeners()
    }
    if (wasBlocked || wasUnheard) {
      this.sender.retryNow()
    }
  }

  committedCovers(items: readonly Y.ID[]) {
    return items.every((id) => this.isCommitted(id))
  }

  // In this copy, and not waiting to be sent by this tab or one it adopted
  private isCommitted(id: Y.ID) {
    const isHere = Y.getState(this.doc.store, id.client) > id.clock
    return isHere && !this.outboxes.some((box) => box.holds(id))
  }

  acknowledge(box: Outbox, through: number) {
    const committed = box.acknowledge(through)
    if (!committed) return

    if (this.device) {
      void this.device.acknowledge(box.sid, box.acked, committed, this.lineage, this.epoch)
      if (box.adopted && !box.pending.length) {
        void this.device.release(box.sid)
        box.release()
        this.outboxes = this.outboxes.filter((other) => other !== box)
      }
    }
    this.onUnsentChanged()
  }

  onUnsentChanged() {
    if (!this.unsent) {
      this.unsentSince = 0
    } else if (!this.unsentSince) {
      this.unsentSince = Date.now()
    }
    this.notifyListeners()
  }

  lockName(sid: string) {
    return `suite-collab:${this.device?.doc}:${sid}`
  }

  notifyListeners() {
    this.copier.sendWhenClean()
    for (const listener of this.listeners) {
      listener()
    }
  }

  private get canFlush() {
    const hasWork = this.sender.inFlight || this.unsent
    const canSend = this.bound && !this.suspect.isJudging && this.saveState !== 'failed'
    return !this.closed && canSend && !!hasWork
  }

  private tick() {
    this.refreshDevice()
    const unsentForLong = !!this.unsentSince && Date.now() - this.unsentSince > PERSIST_AFTER_MS
    if (this.unsent && unsentForLong) {
      this.requestPersistentStorage()
    }
    if (this.realtime?.live) return

    this.realtime?.reconnect()
    const coEditing =
      document.visibilityState === 'visible' && Date.now() - this.lastRemoteAt < CO_EDITING_MS
    // Work held while the server is out of reach goes out on the first tick that reaches it
    const hasWorkWaiting = this.unsent || this.unheard || !this.bound
    if (coEditing || hasWorkWaiting || ++this.ticks % QUIET_TICKS === 0) {
      void this.pull()
    }
  }

  // Claim the clientID chosen offline, send what was typed, and only then take anyone else's rows
  private claimAndBind(): Promise<void> {
    const bindAfterClaim = async (answer: string | null) => {
      if (answer === null || this.closed) return

      if (answer !== 'ok') {
        // Other tabs' work never used this clientID, so a later tab can still send it
        for (const box of this.outboxes) {
          if (box.adopted) {
            box.release()
          }
        }
        this.outboxes = [this.ownOutbox]
        const reason = lostReason(answer)
        await this.stopForGood(reason)
        return
      }

      this.bound = true
      this.onServerHeard()
      await adoptLeftovers(this)
      await this.flush()
      await this.puller.pullNow()
    }
    this.connecting ??= claimClientId(this, this.ownOutbox)
      .then(bindAfterClaim)
      .finally(() => (this.connecting = null))
    return this.connecting
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) {
      this.lastRemoteAt = Date.now()
    }
    const fromElsewhere = origin === REMOTE || origin === ADOPT
    if (fromElsewhere || this.closed) return

    // The editor turns read-only a moment after the verdict, so typing can still arrive
    if (this.stopReason) {
      void this.recoverLateTyping(update, this.stopReason)
      return
    }

    if (!this.writable) return

    if (origin === RESTORE && this.restoreToken) {
      this.ownOutbox.add(update, this.appliedThrough, this.restoreToken)
      this.onUnsentChanged()
      return
    }

    const entry = this.ownOutbox.add(update, this.appliedThrough)
    if (this.device) {
      const session = this.ownSession(this.device)
      const stored = this.ownOutbox.toStoredEntries(this.device.doc, [entry])
      void this.captureOnDevice(this.device, session, stored)
    }
    this.onUnsentChanged()
    if (this.bound) {
      this.sender.scheduleSend()
    } else {
      this.requestPersistentStorage()
    }
  }

  // Late typing no device copy holds lives only in the editor, so it counts as unsent and fails the tab
  private async recoverLateTyping(update: Uint8Array, reason: string) {
    if (this.device) {
      const entry = this.ownOutbox.createEntry(update, this.appliedThrough)
      const stored = this.ownOutbox.toStoredEntries(this.device.doc, [entry])
      const isKept = await this.keepCopy(this.device, [this.ownOutbox.sid], reason, stored)
      if (isKept) return
    }

    this.lateTypingKeptNowhere++
    this.failed = true
    this.notifyListeners()
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.sender.sendNow()
      this.copier.pageHidden()
    } else {
      this.refreshDevice()
    }
  }

  private async captureOnDevice(device: Device, session: StoredSession, stored: StoredEntry[]) {
    try {
      await device.store.capture(session, stored)
    } catch {
      this.dropDeviceStore()
      return
    }

    device.changed()
  }

  // Other tabs' work counts as unsent here too, so no tab shows Saved over it (spec I1). One read at a time
  private refreshDevice() {
    this.deviceStale = true
    this.deviceRead ??= this.readDeviceUntilFresh().finally(() => {
      this.deviceRead = null
    })
  }

  private async readDeviceUntilFresh() {
    while (this.deviceStale && this.device && !this.closed) {
      this.deviceStale = false
      await this.readDevice(this.device)
    }
  }

  // Work a tab left when it closed is free to take on, and goes out from here
  private async readDevice(device: Device) {
    if (this.writable && hasLocks()) {
      await adoptLeftovers(this)
    }

    const held = this.outboxes.map((box) => box.sid)
    const othersUnsent = await device.othersUnsent(held)
    if (othersUnsent !== this.othersUnsent && !this.closed) {
      this.othersUnsent = othersUnsent
      this.notifyListeners()
    }
  }

  private dropDeviceStore() {
    if (!this.device) return

    this.device.close()
    this.device = null
    this.notifyListeners()
  }

  private requestPersistentStorage() {
    if (this.persisted || !this.device) return

    this.persisted = true
    void globalThis.navigator?.storage?.persist?.().catch(() => {})
  }

  private ownSession(device: Device): StoredSession {
    return {
      doc: device.doc,
      sid: this.ownOutbox.sid,
      lineage: this.lineage,
      cid: this.ownOutbox.cid,
      bound: this.bound,
    }
  }

  private clearTimers() {
    this.sender.clearTimers()
    this.suspect.clearTimer()
  }
}
