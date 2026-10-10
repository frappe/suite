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

export interface OpenHeader {
  state: OpenState
  proto: number
  lineage?: string
  can_write?: boolean
  pace_ms?: number
  // The rev the checkpoint covers; rows follow it
  base?: number
  q_epoch?: number
  // The highest editor schema the document's rows were written with
  schema?: number
  limits?: Limits
  rooms?: RoomKeys
}

export interface PullHeader {
  // `rebuild`: the tab may hold a change quarantined since
  state: 'live' | 'rebuild'
  proto: number
  q_epoch?: number
  // Rises with every verdict on a suspect document; `verdict` is the last one
  judged?: number
  verdict?: string
  // The document waits for an admin: `change` for one change, `bad_checkpoint` for its saved content
  held?: string
  schema?: number
  limits?: Limits
  rooms?: RoomKeys
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
    if (offset + length > bytes.byteLength) throw new RangeError('Truncated collab frame')
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
  header: Record<string, unknown>,
  update: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const body = new Uint8Array(4 + headerBytes.byteLength + update.byteLength)
  new DataView(body.buffer).setUint32(0, headerBytes.byteLength)
  body.set(headerBytes, 4)
  body.set(update, 4 + headerBytes.byteLength)
  return body
}
