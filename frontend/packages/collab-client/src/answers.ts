import type { Answer, OpenOptions } from './types'

// What the server's JSON answers carry: `collab` names a refusal, the rest is per route
export interface Body {
  collab?: string
  exc_type?: string
  client_id?: number
  claim?: string
  dup?: boolean
  acked?: number
  // The rev a push was committed as
  rev?: number
  head?: number
  reason?: string
  retry_ms?: number
  judged?: number
  verdict?: string
}

export type Reply = Body & { status: number }

// An answer that is not JSON reads as a bare status
export function readReply(answer: Answer): Reply {
  try {
    const text = new TextDecoder().decode(answer.bytes)
    const body = JSON.parse(text)
    return {
      ...(body && typeof body === 'object' ? body : {}),
      status: answer.status,
    }
  } catch {
    return { status: answer.status }
  }
}

// Frappe refuses a token from before the browser signed in again; only a reload brings the new one
export const staleSession = (reply: Reply) =>
  reply.status === 400 && reply.exc_type === 'CSRFTokenError'

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
  if (staleSession(reply)) {
    return new CollabOpenError(reply.status, 'stale_session')
  }

  const reason = reply.collab ?? null
  if (reply.status !== 403 && reply.status !== 404) {
    return new CollabOpenError(reply.status, reason)
  }

  // A refusal can mean the tab's user signed out or changed since it opened
  const signedIn = options.signedIn()
  if (signedIn === 'Guest') {
    return new CollabOpenError(401, 'signed_out')
  }
  if (signedIn !== options.principal) {
    return new CollabOpenError(reply.status, 'principal_changed')
  }
  return new CollabOpenError(reply.status, reason)
}
