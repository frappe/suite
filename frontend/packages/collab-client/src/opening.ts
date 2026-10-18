import * as Y from 'yjs'

import type { Limits, RoomKeys, Row } from './frames'

export interface RoomInit {
  doc: Y.Doc
  lineage: string
  // The last quarantine this copy was built after
  epoch: number
  canWrite: boolean
  sid: string
  // False while a clientID chosen offline waits for the server to accept it
  bound: boolean
}

// What a room opens on: the checkpoint covering revs through `base`, then the rows after it
export interface Opening {
  base: number
  schema?: number
  checkpoint: Uint8Array | null
  rows: Row[]
  limits?: Limits
  rooms?: RoomKeys
  paceMs?: number
  restoringMs?: number
  restoreRev?: number
  // Opened from the device copy, so the server hasn't answered yet
  offline?: boolean
}
