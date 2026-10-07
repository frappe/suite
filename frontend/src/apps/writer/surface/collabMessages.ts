import type { Blocked } from '@suite/collab-client'

import { describeFailure } from '@/platform/transport'

// What the page tells the person when the room stops saving, or never opens
export interface Banner {
  text: string
  // Read in the middle of the sentence: `text`, then the link, then `after`
  link?: { label: string; href: string }
  after?: string
}

interface Standing {
  blocked: Blocked | null
  // Why the room will never save this tab's work
  stopped: string | null
  onDevice: boolean
  // The editor's HTML was kept in this browser as a recovery copy
  kept: boolean
  unsent: number
}

const STOPS: Record<string, string> = {
  poison: "This document can't hold a change made in this tab, so saving stopped.",
}

export function bannerFor({ blocked, stopped, onDevice, kept, unsent }: Standing): Banner {
  const copy = kept ? ' Unsent changes were kept as a recovery copy.' : ''
  // Without a device store the unsent changes live only in this tab
  const keepOpen = onDevice ? '' : ' Keep this tab open.'
  switch (blocked) {
    case 'signed_out':
      return {
        text: unsent ? "You're signed out, so changes aren't saved. " : "You're signed out. ",
        link: {
          label: 'Sign in',
          href: `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
        },
        after: unsent ? ` to save them.${keepOpen}` : ' to keep editing.',
      }
    case 'locked':
      return {
        text: "This document was locked, so changes aren't saved. Unlock it to save them.",
        after: keepOpen,
      }
    case 'offline':
      return { text: "You're offline and this browser can't keep changes, so editing is paused." }
    case 'stale_session':
      return {
        text: `You signed in again in another tab.${onDevice ? '' : copy} Reload to keep saving.`,
      }
    case 'other_user':
      return {
        text: onDevice
          ? 'Someone else is now signed in here. Your unsent changes are kept on this device.'
          : `Someone else is now signed in here.${copy} Reload to continue.`,
      }
    case 'lost_edit':
      return { text: `You can no longer edit this document.${copy}` }
    case 'lost_read':
      return { text: `You can no longer open this document.${copy}` }
    default:
      return {
        text: `${STOPS[stopped ?? ''] ?? 'Saving stopped in this tab.'}${copy} Reload to keep editing.`,
      }
  }
}

const OPEN_FAILURES: Record<string, string> = {
  signed_out: "You're signed out. Sign in to open this document.",
  locked: 'This document is locked. Unlock it to open it.',
  stale_session: 'You signed in again in another tab. Reload to open this.',
  principal_changed: 'Someone else is now signed in here. Reload to open this document.',
}

export const openFailureFor = (reason: string | null, status: number | null = null) =>
  OPEN_FAILURES[reason ?? ''] ?? describeFailure(status) ?? "This document couldn't be opened."
