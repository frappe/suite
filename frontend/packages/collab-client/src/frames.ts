import type { Held } from './types'

const UINT32_BYTES = 4
const UINT64_BYTES = 8

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

export interface LiveOpenHeader extends DocumentHeader {
  state: 'live'
  lineage: string
  can_write?: boolean
  pace_ms?: number
  // The rev the checkpoint covers; rows follow it
  base?: number
}

interface UnavailableOpenHeader extends DocumentHeader {
  state: Exclude<OpenState, 'live'>
}

export type OpenHeader = LiveOpenHeader | UnavailableOpenHeader

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
  expected_user: string
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
export type PiecePlace = Pick<PushHeader, 'lineage' | 'expected_user' | 'sid'> &
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

class FrameReader {
  private readonly view: DataView
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private requireBytes(length: number) {
    if (this.offset + length > this.bytes.byteLength) {
      throw new RangeError('Truncated collab frame')
    }
  }

  readUint32() {
    this.requireBytes(UINT32_BYTES)
    this.offset += UINT32_BYTES
    return this.view.getUint32(this.offset - UINT32_BYTES)
  }

  readUint64() {
    this.requireBytes(UINT64_BYTES)
    const value = Number(this.view.getBigUint64(this.offset))
    this.offset += UINT64_BYTES
    return value
  }

  readBytes(length: number) {
    this.requireBytes(length)
    this.offset += length
    return this.bytes.slice(this.offset - length, this.offset)
  }
}

// `u32 hlen | header JSON | u32 checkpoint len | checkpoint | u32 n | (u64 rev | u32 len | bytes)*`
export function decodeFrame<Header>(bytes: Uint8Array): {
  header: Header
  checkpoint: Uint8Array | null
  rows: Row[]
} {
  const reader = new FrameReader(bytes)
  const headerBytes = reader.readBytes(reader.readUint32())
  const headerText = new TextDecoder().decode(headerBytes)
  // Trusted as the collab server's own reply, not checked field by field
  const header = JSON.parse(headerText) as Header

  const checkpoint = reader.readBytes(reader.readUint32())

  const rows: Row[] = []
  for (let count = reader.readUint32(); count > 0; count--) {
    const rev = reader.readUint64()
    rows.push({
      rev,
      bytes: reader.readBytes(reader.readUint32()),
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
  const body = new Uint8Array(UINT32_BYTES + headerBytes.byteLength + update.byteLength)
  new DataView(body.buffer).setUint32(0, headerBytes.byteLength)
  body.set(headerBytes, UINT32_BYTES)
  body.set(update, UINT32_BYTES + headerBytes.byteLength)
  return body
}
