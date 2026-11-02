import type { Awareness } from 'y-protocols/awareness'
import type * as yjs from 'yjs'

import type { Limits, OpenState } from './frames'
import type { DeviceStore } from './store'

export interface Answer {
  status: number
  bytes: Uint8Array
}

// A clientID a tab chose itself offline, offered to the server before it is used anywhere
export interface Claim {
  cid: number
  lineage: string
}

// The product's routes for one document. Each answers every status as it came;
// a network failure throws
export interface CollabEndpoints {
  open(): Promise<Answer>
  // `epoch`: the last quarantine this tab heard of, so the server can tell it to rebuild
  pull(sinceRev: number, epoch: number): Promise<Answer>
  push(body: Uint8Array<ArrayBuffer>, options?: { keepalive?: boolean }): Promise<Answer>
  // One piece of a change too big for one push, kept under `stageId` until a push names it
  stage(stageId: string, pieceIndex: number, body: Uint8Array<ArrayBuffer>): Promise<Answer>
  session(sid: string, claim?: Claim): Promise<Answer>
  // Rev `rev` failed to apply in this tab
  suspect(rev: number): Promise<Answer>
  // A render staged under `stageId`, to be checked as the readable copy
  render(stageId: string): Promise<Answer>
  // Fences the document for a restore of `version` made from a copy holding every row through `seenRev`
  beginRestore(seenRev: number, version: number): Promise<Answer>
  // Lifts the fence `token` set, when the restore won't be sent
  cancelRestore(token: string): Promise<Answer>
}

// What an app declares in the browser. The layer gives the rest: room opening, sync, the device store,
// offline and signed-out state, and who is here
export interface CollabAdapter {
  // The app the document belongs to, which names its device store
  app: string
  // The schema version in the file the server's fast check reads; it stamps every push
  schemaVersion: number
  // A peer's position, kept to what the app draws, or null when it is not one
  toPeerPosition(raw: unknown): object | null
  // The readable copy search, export, preview and publishing use; without it the room sends none
  toHtml?(doc: yjs.Doc): string
}

// A device store and the name this document has in it
export interface DeviceDoc {
  store: DeviceStore
  doc: string
  // The document's name, kept with a recovery copy so the copy reads after access is gone
  title?: () => string
}

export interface OpenOptions {
  endpoints: CollabEndpoints
  expectedUser: string
  adapter: CollabAdapter
  // Who the browser is signed in as now, or 'Guest'
  signedIn: () => string
  // Where unsent work and the last committed copy survive the tab; without it they live only in memory
  device?: DeviceDoc | null
  // The realtime socket rows and presence arrive on; without one the room polls
  socket?: LiveSocket | null
  pollMs?: number
  // Told when the document's comment threads may have changed: another tab's notice, or a reconnect that missed some
  threadsChanged?: () => void
  // Given the room before it applies anything, so a watcher sees the opening rows and the work it takes on
  watch?: (room: CollabRoom) => void
}

export interface LiveSocket {
  connected?: boolean
  on(event: string, handler: (message: unknown) => void): unknown
  off(event: string, handler?: (message: unknown) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  connect?(): unknown
}

// `polling`: no answer from the realtime service, or this tab's own rows stopped coming back over it
export type LiveState = 'joining' | 'live' | 'polling'

// Another tab in the document, named by the user the realtime service verified. `arrival` ranks when
// it connected, the same for every tab; null from a service that doesn't count arrivals. `idleSince` is
// when the tab went idle, on this tab's clock, or null while it is in use
export interface Peer {
  pid: number
  user: string
  arrival: number | null
  idleSince: number | null
}

export interface RoomPresence {
  // Carets for the cursor plugin; this tab's own state is client 0
  readonly awareness: Awareness
  readonly peers: Peer[]
  // This tab, as the realtime service knows it
  readonly ownPid: number
  readonly ownArrival: number | null
  onChange(listener: () => void): () => void
}

export type SaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

// Why the server stopped hearing this tab. `offline` is only for a tab with no device store to keep work in
// Only `signed_out`, `locked` and `offline` clear, once the server hears it again
export type Blocked =
  'signed_out' | 'locked' | 'offline' | 'stale_session' | 'other_user' | 'lost_edit' | 'lost_read'

// The right a 403 or 404 takes away: to edit, refused a push or a claim, or to read, refused a pull or a report
export type LostAccess = 'lost_edit' | 'lost_read'

// Why the document waits for an admin: one change, or its saved content
export type Held = 'change' | 'bad_checkpoint'

// How a restore went: `unsent` when work still waited to go first, `unchanged` when the document
// already was the version, `refused` when the server didn't take it (`stopped` says why)
export type RestoreOutcome = 'landed' | 'unsent' | 'unchanged' | 'refused'

// `refusal` names why the server wouldn't begin it, and `retryS` how long to wait when it says
export interface RestoreResult {
  outcome: RestoreOutcome
  refusal?: string
  retryS?: number
}

export function isRecoverable(blocked: Blocked) {
  return blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline'
}

// What a room shows now. A new object replaces it on each change, so a reader can compare by identity
export interface RoomStatus {
  readonly canWrite: boolean
  readonly saveState: SaveState
  // Null when the room was opened without a socket
  readonly liveState: LiveState | null
  // The sizes the server last published; null until it has, as in a tab opened offline
  readonly limits: Limits | null
  // The rev of the last restore this tab applied or heard of
  readonly restoreRev: number
  readonly blockReason: Blocked | null
  // Why the server asked this tab to wait before saving again, until a push is committed
  readonly pauseReason: string | null
  // Why this tab's work can never be committed; its unsent work went to recovery
  readonly stopReason: string | null
  // The document waits for an admin, so nobody edits it
  readonly holdReason: Held | null
  // A version is being restored, so nobody edits until it lands or is called off
  readonly isRestoring: boolean
  // A newer editor wrote to the document; this tab follows and sends nothing more until reloaded
  readonly hasNewerSchema: boolean
  // This copy may hold a change the server has since quarantined; it follows nothing more and is to be opened again
  readonly isReopenNeeded: boolean
  // Whether unsent work outlives this tab
  readonly isKeptOnDevice: boolean
  // The document holds all it may until a compaction shrinks it, so only deleting content saves
  readonly isAtLimit: boolean
  // The latest recovery copy could not be written to the device, so the work is only in this tab
  readonly hasCopyFailed: boolean
  readonly unsentCount: number
  // Changes other tabs of this document keep on the device and have yet to see committed; counted, never applied here
  readonly othersUnsentCount: number
  // How many times this tab has written its recovery copy to the device
  readonly keptCopyCount: number
}

export interface CollabRoom {
  readonly doc: yjs.Doc
  readonly lineage: string
  readonly presence: RoomPresence | null
  readonly status: RoomStatus
  // The clientIDs whose work this tab sends: its own and each closed tab's it took on, kept once sent
  readonly ownClients: ReadonlySet<number>
  onChange(listener: () => void): () => void
  pull(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
  // Fences the document, makes `edit` the restore of `version` and sends it; calls the fence off unless it lands
  restoreVersion(version: number, edit: () => void): Promise<RestoreResult>
  // The app shut this tab for a lost right: it sends what it can within a bound, then keeps the rest as a recovery copy
  loseAccess(lostAccess: LostAccess): Promise<void>
  // The app opened the tab again: one shut with nothing kept takes edits once `mayEdit` still holds after the bound
  regainAccess(mayEdit: () => boolean): Promise<void>
  // Whether the server holds each of these items, as committed text does, so a comment on them can post
  isCommitted(items: readonly yjs.ID[]): boolean
}

export type Opened = { state: 'live'; room: CollabRoom } | { state: Exclude<OpenState, 'live'> }
