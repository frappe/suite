// What the spreadsheet tells the person about saving, from the room's status
// (collab-client RoomStatus). Same rules and order as Writer's
// (writer/surface/collabMessages.ts), worded for a sheet:
// - saving / saved / not saved in the header (saveStateOf);
// - offline keeps editing while the browser keeps the edits, and sends them
//   when back; only a browser that can't keep them pauses editing;
// - a full sheet (4 MiB) takes only deletes;
// - lost edit access turns the sheet read-only, lost read access closes it.

import type { Blocked, RoomStatus } from '@/platform/collab'

export interface Banner {
  text: string
  /** Read in the middle of the sentence: `text`, then the link, then `after`. */
  link?: { label: string; href: string }
  after?: string
  /** Offers Reload beside the text. */
  canReload?: boolean
}

export type SaveState = 'clean' | 'saving' | 'unsaved' | 'failed'

/** The header's save state: unsent work this tab or another tab of this sheet holds counts as unsaved. */
export function saveStateOf(status: RoomStatus): SaveState {
  if (status.saveState === 'failed') return 'failed'
  if (status.saveState === 'saving') return 'saving'
  if (status.saveState === 'unsaved' || status.unsentCount + status.othersUnsentCount > 0)
    return 'unsaved'
  return 'clean'
}

/** 'editing', 'paused' for a reason that clears, 'closed' when the person can't edit (any more). */
export function editingStateOf(status: RoomStatus): 'editing' | 'paused' | 'closed' {
  if (status.blockReason === 'lost_edit' || status.blockReason === 'lost_read') return 'closed'
  if (status.saveState === 'failed' || status.blockReason === 'offline') return 'paused'
  if (status.canWrite) return 'editing'
  if (status.blockReason || status.pauseReason || status.holdReason || status.isRestoring)
    return 'paused'
  return 'closed'
}

const STOP_MESSAGES: Record<string, string> = {
  poison: "This spreadsheet can't hold a change made in this tab, so saving stopped.",
  browser: "This spreadsheet can't be edited in this browser version.",
  too_large: 'A change in this tab is too large to save. Make it in smaller parts.',
  document_full: 'This sheet is full, so a change in this tab couldn’t be saved.',
  disabled: 'Editing together was switched off for Sheets, so saving stopped in this tab.',
  schema:
    'This spreadsheet was edited in a newer version of Sheets, so saving stopped in this tab.',
  restored:
    "A version of this spreadsheet was restored, so changes made in this tab before it weren't saved.",
  clock_gap: 'This tab fell out of step with the server, so saving stopped.',
}
// Stops a reload would only repeat
const LASTING_STOPS = new Set(['browser'])

const PAUSE_MESSAGES: Record<string, string> = {
  upload_refused: 'Your network is refusing uploads',
}

const isSafeOnDevice = (s: RoomStatus) => s.isKeptOnDevice && !s.hasCopyFailed

// Unsent work no device store holds, so a reload would lose it.
function keepOpen(s: RoomStatus): string {
  if (!s.unsentCount || isSafeOnDevice(s)) return ''
  if (s.hasCopyFailed)
    return " Unsent changes couldn't be kept on this device, so keep this tab open."
  return ' Keep this tab open.'
}

function signedOut(s: RoomStatus): Banner {
  const signIn = {
    label: 'Sign in',
    href: `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
  }
  if (!s.unsentCount)
    return { text: "You're signed out. ", link: signIn, after: ' to keep editing.' }
  return {
    text: "You're signed out, so changes aren't saved. ",
    link: signIn,
    after: ` to save them.${keepOpen(s)}`,
  }
}

const BLOCKED: Record<Blocked, (s: RoomStatus) => Banner> = {
  signed_out: signedOut,
  locked: (s) => ({
    text: `This spreadsheet was locked, so changes aren't saved. Unlock it to save them.${keepOpen(s)}`,
  }),
  offline: (s) => ({
    text: `You're offline and this browser can't keep changes, so editing is paused.${keepOpen(s)}`,
  }),
  stale_session: (s) => ({
    text: keepOpen(s)
      ? `You signed in again in another tab.${keepOpen(s)}`
      : 'You signed in again in another tab. Reload to keep saving.',
    canReload: !keepOpen(s),
  }),
  other_user: (s) => ({
    text: keepOpen(s)
      ? `Someone else is now signed in here.${keepOpen(s)}`
      : 'Someone else is now signed in here. Reload to continue.',
    canReload: !keepOpen(s),
  }),
  lost_edit: (s) => ({ text: `You can no longer edit this spreadsheet.${keepOpen(s)}` }),
  lost_read: (s) => ({ text: `You can no longer open this spreadsheet.${keepOpen(s)}` }),
}

function stopped(s: RoomStatus): Banner {
  const reason =
    (s.stopReason && Object.hasOwn(STOP_MESSAGES, s.stopReason) && STOP_MESSAGES[s.stopReason]) ||
    'Saving stopped in this tab.'
  if (keepOpen(s)) return { text: `${reason}${keepOpen(s)}` }
  if (s.stopReason && LASTING_STOPS.has(s.stopReason)) return { text: reason }
  return { text: `${reason} Reload to keep editing.`, canReload: true }
}

/** The strip under the header, or null while saving goes on as usual. Refusals and stops outrank waits. */
export function bannerFor(s: RoomStatus): Banner | null {
  if (s.blockReason) return BLOCKED[s.blockReason](s)
  if (s.stopReason) return stopped(s)
  if (s.hasNewerSchema) {
    return keepOpen(s)
      ? { text: `This spreadsheet was edited in a newer version of Sheets.${keepOpen(s)}` }
      : {
          text: 'This spreadsheet was edited in a newer version of Sheets. Reload to keep editing.',
          canReload: true,
        }
  }
  if (s.holdReason) {
    const text = 'This spreadsheet is read-only while an admin checks it.'
    if (!s.unsentCount) return { text }
    if (isSafeOnDevice(s))
      return {
        text: `${text} Your unsent changes are saved on this device and will be added once it's editable again.`,
      }
    return {
      text: `${text} Your unsent changes will be added once it's editable again.${keepOpen(s)}`,
    }
  }
  if (s.isRestoring)
    return {
      text: 'Someone is restoring a version of this spreadsheet. You can edit again once it is done.',
    }
  const pause = s.pauseReason && Object.hasOwn(PAUSE_MESSAGES, s.pauseReason)
  if (pause) {
    const text = `${PAUSE_MESSAGES[s.pauseReason!]}, so your latest changes aren't saved.`
    return {
      text: isSafeOnDevice(s) ? `${text} They're kept on this device.` : `${text}${keepOpen(s)}`,
    }
  }
  if (s.saveState === 'failed') return stopped(s)
  if (s.isAtLimit) return { text: 'This sheet is full: delete some data to keep editing.' }
  if (s.liveState === 'polling')
    return { text: "Live updates are unavailable, so others' changes show up late." }
  return null
}

/** An old spreadsheet waiting for its conversion, read-only until then. */
export const UPGRADING_BANNER: Banner = {
  text: 'This spreadsheet is being upgraded for editing together. It is read-only until then.',
}
