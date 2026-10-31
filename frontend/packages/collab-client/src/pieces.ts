import { digest } from 'lib0/hash/sha256'

import { HTTP_OK, readReply, type Reply } from './answers'
import { hex, randomHex } from './bytes'
import { encodePush, type PieceHeader, type PiecePlace, type PushHeader } from './frames'
import type { CollabEndpoints } from './types'

// The most update bytes one request carries; a larger change is staged in pieces of exactly this size, the last one shorter
export const PIECE_BYTES = 256 * 1024
const STAGE_ID_BYTES = 16

// A resent change goes to the stage it went to before, so pieces the server already holds cost nothing
export interface Staging {
  key: string
  id: string
}

export function stageFor(previous: Staging | null, { sid, from, to }: PushHeader): Staging {
  const key = `${sid}:${from}:${to}`
  if (previous?.key === key) {
    return previous
  }

  return { key, id: randomHex(STAGE_ID_BYTES) }
}

function pieceHeaderFor(place: PiecePlace, update: Uint8Array): PieceHeader {
  return {
    ...place,
    total_len: update.byteLength,
    sha_total: hex(digest(update)),
  }
}

// Stages every piece of `update`; the answer that stopped it, or null once the stage may be named
export async function putPieces(
  endpoints: CollabEndpoints,
  stageId: string,
  place: PiecePlace,
  update: Uint8Array,
): Promise<Reply | null> {
  const pieceHeader = pieceHeaderFor(place, update)
  for (
    let offset = 0, pieceIndex = 0;
    offset < update.byteLength;
    offset += PIECE_BYTES, pieceIndex++
  ) {
    const piece = update.subarray(offset, offset + PIECE_BYTES)
    const body = encodePush(pieceHeader, piece)
    const answer = await endpoints.stage(stageId, pieceIndex, body)
    const reply = readReply(answer)
    if (reply.status !== HTTP_OK) {
      return reply
    }

    // The server already committed the change, and says so again to the push
    if (reply.dup) {
      return null
    }
  }

  return null
}
