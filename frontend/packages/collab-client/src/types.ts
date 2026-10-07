import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

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
  pull(since: number, epoch: number): Promise<Answer>
  push(body: Uint8Array<ArrayBuffer>, options?: { keepalive?: boolean }): Promise<Answer>
  // One piece of a change too big for one push, kept under `stage` until a push names it
  stage(stage: string, idx: number, body: Uint8Array<ArrayBuffer>): Promise<Answer>
  session(sid: string, claim?: Claim): Promise<Answer>
  // Rev `rev` failed to apply in this tab
  suspect(rev: number): Promise<Answer>
}

export interface OpenOptions {
  endpoints: CollabEndpoints
  principal: string
  // The schema of the editor that writes this document; the server refuses names its rows may not hold yet
  schema: number
  // Who the browser is signed in as now, or 'Guest'
  signedIn: () => string
  // Where unsent work and the last committed copy survive the tab; without it they live only in memory
  device?: { store: DeviceStore; doc: string } | null
  // The realtime socket rows and presence arrive on; without one the room polls
  socket?: LiveSocket | null
  pollMs?: number
  sendDelayMs?: number
  sendMaxDelayMs?: number
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

// Another tab in the document, named by the user the realtime service verified
export interface Peer {
  pid: number
  user: string
  color: string
}

export interface RoomPresence {
  // Carets for the cursor plugin; this tab's own state is client 0
  readonly awareness: Awareness
  readonly peers: Peer[]
  onChange(listener: () => void): () => void
}

export type SaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

// Why the server stopped hearing this tab. `offline` is only for a tab with no device store to keep work in.
// Only `signed_out`, `locked` and `offline` clear, once the server hears it again
export type Blocked =
  'signed_out' | 'locked' | 'offline' | 'stale_session' | 'other_user' | 'lost_edit' | 'lost_read'

export const recoverable = (blocked: Blocked) =>
  blocked === 'signed_out' || blocked === 'locked' || blocked === 'offline'

export interface CollabRoom {
  readonly doc: Y.Doc
  readonly canWrite: boolean
  readonly blocked: Blocked | null
  // Why the server asked this tab to wait before saving again, until a push is committed
  readonly paused: string | null
  // Why this tab's work can never be committed; its unsent work went to recovery
  readonly stopped: string | null
  // The document waits for an admin, so nobody edits it: `change` or `bad_checkpoint`
  readonly held: string | null
  // A newer editor wrote to the document; this tab follows and sends nothing more until reloaded
  readonly newerSchema: boolean
  // This copy may hold a change the server has since quarantined; it follows nothing more and is to be opened again
  readonly needsRebuild: boolean
  readonly saveState: SaveState
  readonly unsent: number
  // Whether unsent work outlives this tab
  readonly onDevice: boolean
  readonly appliedThrough: number
  // Null when the room was opened without a socket
  readonly live: LiveState | null
  readonly presence: RoomPresence | null
  // The sizes the server last published; null until it has, as in a tab opened offline
  readonly limits: Limits | null
  // The document holds all it may until a compaction shrinks it, so only deleting content saves
  readonly atLimit: boolean
  onChange(listener: () => void): () => void
  pull(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

export type Opened = { state: 'live'; room: CollabRoom } | { state: Exclude<OpenState, 'live'> }
