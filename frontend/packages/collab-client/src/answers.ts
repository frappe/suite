import type { Answer, OpenOptions } from './types'

export const HTTP_OK = 200
export const HTTP_ACCEPTED = 202
export const HTTP_BAD_REQUEST = 400
export const HTTP_UNAUTHORIZED = 401
export const HTTP_FORBIDDEN = 403
export const HTTP_NOT_FOUND = 404
export const HTTP_CONFLICT = 409
export const HTTP_TOO_LARGE = 413
export const HTTP_LOCKED = 423

// What the server's JSON answers carry: `collab` names a refusal, the rest is per route
export interface ReplyBody {
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
  pace_ms?: number
  // The readable copy lags, so a push asks this tab for a render
  copy?: boolean
  judged?: number
  verdict?: string
  // The fence a restore begins under, and how long to wait when one just ran
  token?: string
  retry_s?: number
}

export type Reply = ReplyBody & { status: number }

// An answer that is not JSON reads as a bare status
export function readReply(answer: Answer): Reply {
  try {
    const text = new TextDecoder().decode(answer.bytes)
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object') {
      return { status: answer.status }
    }

    return { ...body, status: answer.status }
  } catch {
    return { status: answer.status }
  }
}

// Frappe refuses a token from before the browser signed in again; only a reload brings the new one
export function isStaleSession(reply: Reply) {
  return reply.status === HTTP_BAD_REQUEST && reply.exc_type === 'CSRFTokenError'
}

export class CollabOpenError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    const cause = reason ?? status
    super(`Could not open the collaborative document (${cause})`)
    this.name = 'CollabOpenError'
  }
}

// A refusal can mean the tab's user signed out or changed since it opened
export function signInChange(options: OpenOptions): 'signed_out' | 'other_user' | null {
  const signedIn = options.signedIn()
  if (signedIn === 'Guest') {
    return 'signed_out'
  }

  if (signedIn !== options.expectedUser) {
    return 'other_user'
  }

  return null
}

export function toOpenError(answer: Answer, options: OpenOptions) {
  const reply = readReply(answer)
  if (isStaleSession(reply)) {
    return new CollabOpenError(reply.status, 'stale_session')
  }

  const reason = reply.collab ?? null
  if (reply.status !== HTTP_FORBIDDEN && reply.status !== HTTP_NOT_FOUND) {
    return new CollabOpenError(reply.status, reason)
  }

  const change = signInChange(options)
  if (change === 'signed_out') {
    return new CollabOpenError(HTTP_UNAUTHORIZED, 'signed_out')
  }

  if (change === 'other_user') {
    return new CollabOpenError(reply.status, 'user_changed')
  }

  return new CollabOpenError(reply.status, reason)
}
