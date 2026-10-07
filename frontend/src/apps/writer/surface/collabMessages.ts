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
  // The document waits for an admin: one change, or its saved content
  held: string | null
  // A newer editor wrote to the document, so this tab only shows it
  newerSchema: boolean
  // Why saving waits; `doc_full` lasts until the document gets smaller
  paused: string | null
  onDevice: boolean
  // The editor's HTML was kept in this browser as a recovery copy
  kept: boolean
  unsent: number
}

const STOPS: Record<string, string> = {
  poison: "This document can't hold a change made in this tab, so saving stopped.",
  browser: "This document can't be edited in this browser version.",
  too_large: 'A change in this tab is too large to save. Insert large images as files.',
}
// Stops a reload would only repeat
const LASTING = new Set(['browser'])

// Shown in a rebuilt room once the stopped room's unsent work went to a recovery copy
export const SET_ASIDE: Banner = {
  text: "Your last edits couldn't be saved here and were kept as a recovery copy.",
}

export function bannerFor({
  blocked,
  stopped,
  held,
  newerSchema,
  paused,
  onDevice,
  kept,
  unsent,
}: Standing): Banner {
  const copy = kept ? ' Unsent changes were kept as a recovery copy.' : ''
  // Without a device store the unsent changes live only in this tab
  const keepOpen = onDevice ? '' : ' Keep this tab open.'
  if (newerSchema && !blocked && !stopped)
    return { text: 'This document was edited in a newer version of Writer. Reload to edit it.' }
  if (held && !blocked && !stopped) {
    const text =
      held === 'bad_checkpoint'
        ? 'This document is in question and read-only while an admin reviews it.'
        : 'This document is read-only while an admin reviews a change to it.'
    if (!unsent) return { text }
    return {
      text: onDevice
        ? `${text} Your unsent changes are kept on this device and save once it is released.`
        : `${text} Your unsent changes save once it is released.${keepOpen}`,
    }
  }
  if (paused === 'doc_full' && !blocked && !stopped)
    return {
      text: onDevice
        ? "This document has reached its size limit, so your latest changes aren't saved. They're kept on this device."
        : `This document has reached its size limit, so your latest changes aren't saved.${keepOpen}`,
    }
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
    default: {
      const known = stopped && Object.hasOwn(STOPS, stopped) ? stopped : null
      const reload = known && LASTING.has(known) ? '' : ' Reload to keep editing.'
      return { text: `${known ? STOPS[known] : 'Saving stopped in this tab.'}${copy}${reload}` }
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
