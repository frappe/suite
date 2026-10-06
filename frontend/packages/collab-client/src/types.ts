import type * as Y from 'yjs'

import type { OpenState } from './frames'
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
  pull(since: number): Promise<Answer>
  push(body: Uint8Array<ArrayBuffer>, options?: { keepalive?: boolean }): Promise<Answer>
  session(sid: string, claim?: Claim): Promise<Answer>
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
  pollMs?: number
  sendDelayMs?: number
  sendMaxDelayMs?: number
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
  readonly saveState: SaveState
  readonly unsent: number
  // Whether unsent work outlives this tab
  readonly onDevice: boolean
  readonly appliedThrough: number
  onChange(listener: () => void): () => void
  pull(): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

export type Opened = { state: 'live'; room: CollabRoom } | { state: Exclude<OpenState, 'live'> }
