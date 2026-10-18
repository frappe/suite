import type { Held } from './types'

// `disabled`: collaboration is off on this site. `unconverted`: the document is not collaborative
export type OpenState = 'live' | 'disabled' | 'unconverted'

// The sizes the server checks a change against: the most one change may be, and how full the document is
export interface Limits {
  fragment: number
  edit_max: number
  state_max: number
  state_bytes: number
  tail_bound: number
}

// The realtime rooms a document's rows go out on: this epoch's and the next
export interface RoomKeys {
  epoch: number
  keys: string[]
  epoch_seconds: number
  server_time: number
}

// What both an open and a pull answer carry about the document
interface DocumentHeader {
  proto: number
  q_epoch?: number
  // The highest editor schema the document's rows were written with
  schema?: number
  limits?: Limits
  rooms?: RoomKeys
  // The rev of the last restored version; work made before it is refused
  restore_rev?: number
  // How long a restore under way still holds the document
  restoring_ms?: number
}

export interface OpenHeader extends DocumentHeader {
  state: OpenState
  lineage?: string
  can_write?: boolean
  pace_ms?: number
  // The rev the checkpoint covers; rows follow it
  base?: number
}

export interface PullHeader extends DocumentHeader {
  // `rebuild`: the tab may hold a change quarantined since
  state: 'live' | 'rebuild'
  // Rises with every verdict on a suspect document; `verdict` is the last one
  judged?: number
  verdict?: string
  // The document waits for an admin: `change` for one change, `bad_checkpoint` for its saved content
  held?: unknown
}

// Any held reason other than `bad_checkpoint` is a held change
export function parseHeld(held: unknown): Held | null {
  if (!held) {
    return null
  }

  return held === 'bad_checkpoint' ? 'bad_checkpoint' : 'change'
}

// One session's seqs `from` through `to`, as one change
export interface PushHeader {
  proto: number
  lineage: string
  principal: string
  schema: number
  sid: string
  from: number
  to: number
  cid: number
  seen_rev: number
  shas: string[]
  // The tab is hiding or closing, so the server may compact now
  final: boolean
  // Names the staged pieces that hold the change, which then travels empty
  stage_id?: string
  // The restore fence's token, on the push that lands the restore
  restore?: string
}

// What places a staged piece: a push's seq range, or the rev and quarantine epoch a render was made at
export type PiecePlace = Pick<PushHeader, 'lineage' | 'principal' | 'sid'> &
  (Pick<PushHeader, 'from' | 'to'> | { purpose: 'render'; rev: number; q_epoch: number })

// One staged piece, with the length and sha the whole is checked against
export type PieceHeader = PiecePlace & {
  total_len: number
  sha_total: string
}

export interface Row {
  rev: number
  bytes: Uint8Array
}

// `u32 hlen | header JSON | u32 checkpoint len | checkpoint | u32 n | (u64 rev | u32 len | bytes)*`
export function decodeFrame<Header>(bytes: Uint8Array): {
  header: Header
  checkpoint: Uint8Array | null
  rows: Row[]
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  const requireBytes = (length: number) => {
    if (offset + length > bytes.byteLength) {
      throw new RangeError('Truncated collab frame')
    }
  }

  const readUint32 = () => {
    requireBytes(4)
    offset += 4
    return view.getUint32(offset - 4)
  }

  const readBytes = (length: number) => {
    requireBytes(length)
    offset += length
    return bytes.slice(offset - length, offset)
  }

  const headerBytes = readBytes(readUint32())
  const headerText = new TextDecoder().decode(headerBytes)
  // Trusted as the collab server's own reply, not checked field by field
  const header = JSON.parse(headerText) as Header

  const checkpoint = readBytes(readUint32())

  const rows: Row[] = []
  for (let count = readUint32(); count > 0; count--) {
    requireBytes(8)
    const rev = Number(view.getBigUint64(offset))
    offset += 8
    rows.push({
      rev,
      bytes: readBytes(readUint32()),
    })
  }

  return {
    header,
    checkpoint: checkpoint.byteLength ? checkpoint : null,
    rows,
  }
}

export function encodePush(
  header: PushHeader | PieceHeader,
  update: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const body = new Uint8Array(4 + headerBytes.byteLength + update.byteLength)
  new DataView(body.buffer).setUint32(0, headerBytes.byteLength)
  body.set(headerBytes, 4)
  body.set(update, 4 + headerBytes.byteLength)
  return body
}
