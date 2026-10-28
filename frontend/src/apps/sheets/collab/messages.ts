// What the spreadsheet tells the person about saving, from the room's status
// (collab-client RoomStatus). Same rules and order as Writer's
// (writer/surface/collabMessages.ts), worded for a sheet:
// - saving / saved / not saved in the header (saveStateOf);
// - offline keeps editing while the browser keeps the edits, and sends them
//   when back; only a browser that can't keep them pauses editing;
// - a full sheet (4 MiB) takes only deletes;
// - lost edit access turns the sheet read-only, lost read access closes it.

import type { Blocked, RoomStatus } from '@/platform/collab'
import { translate as __ } from '@/platform/translation'

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

// Source strings; each is translated when a banner is built.
const STOP_MESSAGES: Record<string, string> = {
  poison: "This spreadsheet can't hold a change made in this tab, so saving stopped.",
  browser: "This spreadsheet can't be edited in this browser version.",
  too_large: 'A change in this tab is too large to save. Make it in smaller parts.',
  document_full: "This sheet is full, so a change in this tab couldn't be saved.",
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
  upload_refused: "Your network is refusing uploads, so your latest changes aren't saved.",
}

const isSafeOnDevice = (s: RoomStatus) => s.isKeptOnDevice && !s.hasCopyFailed

// Unsent work no device store holds, so a reload would lose it.
function keepOpen(s: RoomStatus): string {
  if (!s.unsentCount || isSafeOnDevice(s)) return ''
  if (s.hasCopyFailed)
    return ' ' + __("Unsent changes couldn't be kept on this device, so keep this tab open.")
  return ' ' + __('Keep this tab open.')
}

// `text` translated, then the ask to keep the tab open when unsent work is kept nowhere.
const withKeepOpen = (text: string, s: RoomStatus): Banner => ({ text: __(text) + keepOpen(s) })

function signedOut(s: RoomStatus): Banner {
  const signIn = {
    label: __('Sign in'),
    href: `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
  }
  if (!s.unsentCount)
    return {
      text: __("You're signed out.") + ' ',
      link: signIn,
      after: ' ' + __('to keep editing.'),
    }
  return {
    text: __("You're signed out, so changes aren't saved.") + ' ',
    link: signIn,
    after: ' ' + __('to save them.') + keepOpen(s),
  }
}

// Unsent work kept nowhere: ask to keep the tab open; else offer the reload `reload` names.
function keepOpenOrReload(text: string, reload: string, s: RoomStatus): Banner {
  if (keepOpen(s)) return withKeepOpen(text, s)
  return { text: `${__(text)} ${__(reload)}`, canReload: true }
}

const BLOCKED: Record<Blocked, (s: RoomStatus) => Banner> = {
  signed_out: signedOut,
  locked: (s) =>
    withKeepOpen(
      "This spreadsheet was locked, so changes aren't saved. Unlock it to save them.",
      s,
    ),
  offline: (s) =>
    withKeepOpen("You're offline and this browser can't keep changes, so editing is paused.", s),
  stale_session: (s) =>
    keepOpenOrReload('You signed in again in another tab.', 'Reload to keep saving.', s),
  other_user: (s) =>
    keepOpenOrReload('Someone else is now signed in here.', 'Reload to continue.', s),
  lost_edit: (s) => withKeepOpen('You can no longer edit this spreadsheet.', s),
  lost_read: (s) => withKeepOpen('You can no longer open this spreadsheet.', s),
}

function stopped(s: RoomStatus): Banner {
  const known = s.stopReason && Object.hasOwn(STOP_MESSAGES, s.stopReason)
  const reason = known ? STOP_MESSAGES[s.stopReason!]! : 'Saving stopped in this tab.'
  if (keepOpen(s) || (s.stopReason && LASTING_STOPS.has(s.stopReason)))
    return withKeepOpen(reason, s)
  return keepOpenOrReload(reason, 'Reload to keep editing.', s)
}

function held(s: RoomStatus): Banner {
  const text = __('This spreadsheet is read-only while an admin checks it.')
  if (!s.unsentCount) return { text }
  if (isSafeOnDevice(s))
    return {
      text: `${text} ${__("Your unsent changes are saved on this device and will be added once it's editable again.")}`,
    }
  return {
    text: `${text} ${__("Your unsent changes will be added once it's editable again.")}${keepOpen(s)}`,
  }
}

/** The strip under the header, or null while saving goes on as usual. Refusals and stops outrank waits. */
export function bannerFor(s: RoomStatus): Banner | null {
  if (s.blockReason) return BLOCKED[s.blockReason](s)
  if (s.stopReason) return stopped(s)
  if (s.hasNewerSchema)
    return keepOpenOrReload(
      'This spreadsheet was edited in a newer version of Sheets.',
      'Reload to keep editing.',
      s,
    )
  if (s.holdReason) return held(s)
  if (s.isRestoring)
    return {
      text: __(
        'Someone is restoring a version of this spreadsheet. You can edit again once it is done.',
      ),
    }
  if (s.pauseReason && Object.hasOwn(PAUSE_MESSAGES, s.pauseReason)) {
    const text = __(PAUSE_MESSAGES[s.pauseReason]!)
    if (isSafeOnDevice(s)) return { text: `${text} ${__("They're kept on this device.")}` }
    return { text: text + keepOpen(s) }
  }
  if (s.saveState === 'failed') return stopped(s)
  if (s.isAtLimit) return { text: __('This sheet is full: delete some data to keep editing.') }
  if (s.liveState === 'polling')
    return { text: __("Live updates are unavailable, so others' changes show up late.") }
  return null
}

/** An old spreadsheet waiting for its conversion, read-only until then. */
export function upgradingBanner(): Banner {
  return {
    text: __(
      'This spreadsheet is being upgraded for editing together. It is read-only until then.',
    ),
  }
}
