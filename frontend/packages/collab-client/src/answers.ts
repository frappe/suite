import type { Answer, OpenOptions } from './types'

// What the server's JSON answers carry: `collab` names a refusal, the rest is per route
export interface Body {
  collab?: string
  exc_type?: string
  client_id?: number
  claim?: string
  dup?: boolean
  acked?: number
  head?: number
  reason?: string
  retry_ms?: number
}

export type Reply = Body & { status: number }

// An answer that is not JSON reads as a bare status
export function readReply(answer: Answer): Reply {
  try {
    const body = JSON.parse(new TextDecoder().decode(answer.bytes))
    return {
      ...(body && typeof body === 'object' ? body : {}),
      status: answer.status,
    }
  } catch {
    return { status: answer.status }
  }
}

// Frappe refuses a token from before the browser signed in again; only a reload brings the new one
export const staleSession = (reply: Reply) => reply.status === 400 && reply.exc_type === 'CSRFTokenError'

export class CollabOpenError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`Could not open the collaborative document (${reason ?? status})`)
    this.name = 'CollabOpenError'
  }
}

export function openError(answer: Answer, options: OpenOptions) {
  const reply = readReply(answer)
  if (staleSession(reply)) return new CollabOpenError(reply.status, 'stale_session')
  const reason = reply.collab ?? null
  if (reply.status !== 403 && reply.status !== 404) return new CollabOpenError(reply.status, reason)
  const now = options.signedIn()
  if (now === 'Guest') return new CollabOpenError(401, 'signed_out')
  return new CollabOpenError(reply.status, now === options.principal ? reason : 'principal_changed')
}
