import type { Blocked } from '@suite/collab-client'

import { describeFailure } from '@/platform/transport'

// What the page tells the person when the room stops saving, or never opens
export interface Banner {
  text: string
  // Read in the middle of the sentence: `text`, then the link, then `after`
  link?: { label: string; href: string }
  after?: string
}

export interface BannerState {
  blocked: Blocked | null
  // Why the room will never save this tab's work
  stopped: string | null
  // The document waits for an admin: one change, or its saved content
  held: string | null
  // A newer editor wrote to the document, so this tab only shows it
  newerSchema: boolean
  // The person may edit the document in an editor that can show it
  canEdit: boolean
  // Why saving waits
  paused: string | null
  // Saving stopped with work unsent
  failed: boolean
  // The document holds all it may, so only deletes save
  atLimit: boolean
  onDevice: boolean
  // The editor's HTML was kept in this browser as a recovery copy
  recoveryKept: boolean
  // An earlier room of this page set its unsent work aside as a recovery copy
  setAside: boolean
  unsent: number
  // No live updates reach this tab, so it polls
  polling: boolean
}

const STOP_MESSAGES: Record<string, string> = {
  poison: "This document can't hold a change made in this tab, so saving stopped.",
  browser: "This document can't be edited in this browser version.",
  too_large: 'A change in this tab is too large to save. Insert large images as files.',
  document_full: "This document is at its size limit, so a change in this tab couldn't be saved.",
}
// Stops a reload would only repeat
const LASTING_STOPS = new Set(['browser'])

// Waits that say why changes aren't saving yet; other pauses clear on their own too soon to mention
const PAUSE_MESSAGES: Record<string, string> = {
  upload_refused: 'Your network is refusing uploads',
}

// While saving goes on: a full document, or a rebuilt room after the stopped one's work went to a recovery copy
function savingBanner(atLimit: boolean, setAside: boolean): Banner | null {
  if (atLimit) {
    const setAsideNote = setAside ? ' Your latest changes went to a recovery copy.' : ''
    return {
      text: `This document is at its size limit.${setAsideNote} Delete content to free space.`,
    }
  }

  if (!setAside) return null

  return { text: "Your last edits couldn't be saved here and were kept as a recovery copy." }
}

export function bannerFor({
  blocked,
  stopped,
  held,
  newerSchema,
  canEdit,
  paused,
  failed,
  atLimit,
  onDevice,
  recoveryKept,
  setAside,
  unsent,
  polling,
}: BannerState): Banner | null {
  const pauseMessage =
    paused && Object.hasOwn(PAUSE_MESSAGES, paused) ? PAUSE_MESSAGES[paused] : null
  const interrupted = blocked || held || newerSchema || pauseMessage || failed
  if (!interrupted) {
    const pollingBanner = polling
      ? { text: "Live updates are unavailable, so others' changes show up late." }
      : null
    return savingBanner(atLimit, setAside) ?? pollingBanner
  }

  const recoveryNote = recoveryKept ? ' Unsent changes were kept as a recovery copy.' : ''
  // Without a device store the unsent changes live only in this tab
  const keepOpen = onDevice ? '' : ' Keep this tab open.'
  const unblocked = !blocked && !stopped
  if (newerSchema && unblocked) {
    const reloadTo = canEdit ? 'edit it' : 'see its latest changes'
    return { text: `This document was edited in a newer version of Writer. Reload to ${reloadTo}.` }
  }

  if (held && unblocked) {
    const text =
      held === 'bad_checkpoint'
        ? 'This document is in question and read-only while an admin reviews it.'
        : 'This document is read-only while an admin reviews a change to it.'
    if (!unsent) return { text }

    if (onDevice) {
      return {
        text: `${text} Your unsent changes are kept on this device and save once it is released.`,
      }
    }

    return { text: `${text} Your unsent changes save once it is released.${keepOpen}` }
  }

  if (pauseMessage && unblocked) {
    if (onDevice) {
      return {
        text: `${pauseMessage}, so your latest changes aren't saved. They're kept on this device.`,
      }
    }

    return { text: `${pauseMessage}, so your latest changes aren't saved.${keepOpen}` }
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
        text: `You signed in again in another tab.${onDevice ? '' : recoveryNote} Reload to keep saving.`,
      }
    case 'other_user':
      if (onDevice) {
        return {
          text: 'Someone else is now signed in here. Your unsent changes are kept on this device.',
        }
      }

      return { text: `Someone else is now signed in here.${recoveryNote} Reload to continue.` }
    case 'lost_edit':
      return { text: `You can no longer edit this document.${recoveryNote}` }
    case 'lost_read':
      return { text: `You can no longer open this document.${recoveryNote}` }
    default: {
      const knownStop = stopped && Object.hasOwn(STOP_MESSAGES, stopped) ? stopped : null
      const reason = knownStop ? STOP_MESSAGES[knownStop] : 'Saving stopped in this tab.'
      const reloadHint = knownStop && LASTING_STOPS.has(knownStop) ? '' : ' Reload to keep editing.'
      return { text: `${reason}${recoveryNote}${reloadHint}` }
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
