import { createGuestCommentName, type GuestCommentName } from '@/apps/drive/client/guestName'
import { driveLinks } from '@/apps/drive/client/links'
import { useSession } from '@/platform/session'

/** The "Your name" field of a comment composer. Call it in a component's setup (spec §10.5). */
export function useDriveGuestName(): GuestCommentName {
  return createGuestCommentName(driveLinks, useSession())
}
