import { digest } from 'lib0/hash/sha256'

import { readReply, type Reply } from './answers'
import { encodePush } from './frames'
import { hex, randomHex } from './outbox'
import type { CollabEndpoints } from './types'

// The most update bytes one request carries; a larger change is staged in pieces of exactly this size, the last one shorter
export const PIECE_BYTES = 256 * 1024

export interface PieceHeader {
  lineage: string
  principal: string
  sid: string
  from: number
  to: number
}

// A resent change goes to the stage it went to before, so pieces the server already holds cost nothing
export interface Staging {
  key: string
  id: string
}

export function stageFor(previous: Staging | null, { sid, from, to }: PieceHeader): Staging {
  const key = `${sid}:${from}:${to}`
  if (previous?.key === key) return previous

  return { key, id: randomHex(16) }
}

// Stages every piece of `update`; the answer that stopped it, or null once the push may name the stage
export async function putPieces(
  endpoints: CollabEndpoints,
  stage: string,
  header: PieceHeader,
  update: Uint8Array,
): Promise<Reply | null> {
  const { lineage, principal, sid, from, to } = header
  const described = {
    lineage,
    principal,
    sid,
    from,
    to,
    total_len: update.byteLength,
    sha_total: hex(digest(update)),
  }

  for (let at = 0, idx = 0; at < update.byteLength; at += PIECE_BYTES, idx++) {
    const piece = update.subarray(at, at + PIECE_BYTES)
    const body = encodePush(described, piece)
    const answer = await endpoints.stage(stage, idx, body)
    const reply = readReply(answer)
    if (reply.status !== 200) return reply

    // The server already committed the change, and says so again to the push
    if (reply.dup) return null
  }

  return null
}
