// `disabled`: collaboration is off on this site. `unconverted`: the document is not collaborative
export type OpenState = 'live' | 'disabled' | 'unconverted'

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
  let at = 0
  const need = (length: number) => {
    if (at + length > bytes.byteLength) throw new RangeError('Truncated collab frame')
  }
  const u32 = () => {
    need(4)
    at += 4
    return view.getUint32(at - 4)
  }
  const take = (length: number) => {
    need(length)
    at += length
    return bytes.slice(at - length, at)
  }
  const header = JSON.parse(new TextDecoder().decode(take(u32()))) as Header
  const checkpoint = take(u32())
  const rows: Row[] = []
  for (let count = u32(); count > 0; count--) {
    need(8)
    const rev = Number(view.getBigUint64(at))
    at += 8
    rows.push({ rev, bytes: take(u32()) })
  }
  return { header, checkpoint: checkpoint.byteLength ? checkpoint : null, rows }
}

export function encodePush(
  header: Record<string, unknown>,
  update: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const body = new Uint8Array(4 + json.byteLength + update.byteLength)
  new DataView(body.buffer).setUint32(0, json.byteLength)
  body.set(json, 4)
  body.set(update, 4 + json.byteLength)
  return body
}
