import {
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
  isStaleSession,
  signInChange,
  type Reply,
} from './answers'
import { isRecoverable, type Blocked, type LostAccess, type OpenOptions } from './types'

/** What a refusal changes on the room. */
export interface AccessRoom {
  blocked: Blocked | null
  writable: boolean
  failed: boolean
  readonly options: OpenOptions
  readonly unsent: number
  moveToRecovery(reason: string): Promise<void>
  notifyListeners(): void
}

function isLostAccess(reason: Blocked) {
  return reason === 'lost_edit' || reason === 'lost_read'
}

// The app's collaboration was switched off, so no request of this room will be taken again
export function isDisabled(reply: Reply) {
  return reply.status === HTTP_CONFLICT && reply.collab === 'disabled'
}

// Losing edit access can still turn out to be losing read access or a switched account
function replaces(next: Blocked, current: Blocked) {
  return (
    isRecoverable(current) ||
    (current === 'lost_edit' && (next === 'lost_read' || next === 'other_user'))
  )
}

// A lost right keeps the unsent work only as a recovery copy; another person's or a stale sign-in leaves it for a later tab
export function block(room: AccessRoom, reason: Blocked) {
  const sameReason = room.blocked === reason
  const outranked = !!room.blocked && !replaces(reason, room.blocked)
  if (sameReason || outranked) return

  if (!isRecoverable(reason)) {
    room.writable = false
    if (room.unsent) {
      room.failed = true
    }

    if (isLostAccess(reason)) {
      void room.moveToRecovery('lost_access')
    }
  }

  room.blocked = reason
  room.notifyListeners()
}

// A refusal about who is asking, or a lost right once the signed-in person is confirmed unchanged
export function classifyRefusal(
  room: AccessRoom,
  reply: Reply,
  lostAccess: LostAccess,
): Blocked | null {
  let blocked: Blocked | null = null
  if (
    reply.status === HTTP_UNAUTHORIZED &&
    (reply.collab === 'signed_out' || reply.collab === 'locked')
  ) {
    blocked = reply.collab
  } else if (isStaleSession(reply)) {
    blocked = 'stale_session'
  } else if (reply.status === HTTP_CONFLICT && reply.collab === 'user_changed') {
    blocked = 'other_user'
  } else if (reply.status === HTTP_FORBIDDEN || reply.status === HTTP_NOT_FOUND) {
    blocked = signInChange(room.options) ?? lostAccess
  }

  if (blocked) {
    block(room, blocked)
  }

  return blocked
}
