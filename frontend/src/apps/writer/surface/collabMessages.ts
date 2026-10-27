import type { Blocked, RoomStatus } from '@/platform/collab'
import { describeFailure } from '@/platform/open-failure'

// What the page tells the person when the room stops saving, or never opens
export interface Banner {
  text: string
  // Read in the middle of the sentence: `text`, then the link, then `after`
  link?: { label: string; href: string }
  after?: string
  // Offers Reload beside the text
  canReload?: boolean
}

export type BannerState = Pick<
  RoomStatus,
  | 'blockReason'
  | 'stopReason'
  | 'holdReason'
  | 'isRestoring'
  | 'hasNewerSchema'
  | 'pauseReason'
  | 'isAtLimit'
  | 'isKeptOnDevice'
  | 'unsentCount'
  | 'hasCopyFailed'
> & {
  // The person may edit the document in an editor that can show it
  canEdit: boolean
  // Saving stopped with work unsent
  hasFailed: boolean
  // The editor's HTML was kept in this browser as a recovery copy
  isRecoveryKept: boolean
  // Why an earlier room of this page set its unsent work aside as a recovery copy
  setAside: string | null
  // Someone else's edit removed text typed here, and whether this device kept it as a recovery copy
  removedWork: 'kept' | 'unkept' | null
  // No live updates reach this tab, so it polls
  isPolling: boolean
  // The newer-schema banner showed before this tab's last reload too
  isNewerAfterReload: boolean
  // The editor met content it can't show and takes no edits
  isFrozen: boolean
}

const STOP_MESSAGES: Record<string, string> = {
  poison: "This document can't hold a change made in this tab, so saving stopped.",
  browser: "This document can't be edited in this browser version.",
  too_large: 'A change in this tab is too large to save. Insert large images as files.',
  document_full: "This document is at its size limit, so a change in this tab couldn't be saved.",
  disabled: 'Collaboration was switched off for this app, so saving stopped in this tab.',
  schema: 'This document was edited in a newer version of Writer, so saving stopped in this tab.',
  restored:
    "A version of this document was restored, so changes made in this tab before it weren't saved.",
  clock_gap: 'This tab fell out of step with the server, so saving stopped.',
}
// Stops a reload would only repeat
const LASTING_STOPS = new Set(['browser'])

// Waits that say why changes aren't saving yet; other pauses clear on their own too soon to mention
const PAUSE_MESSAGES: Record<string, string> = {
  upload_refused: 'Your network is refusing uploads',
}

function recoveryNote(state: BannerState) {
  if (state.isRecoveryKept) {
    return ' Unsent changes were kept as a recovery copy.'
  }

  return ''
}

// The device store holds the unsent changes, unless its write failed
export function isSafeOnDevice(status: Pick<RoomStatus, 'isKeptOnDevice' | 'hasCopyFailed'>) {
  return status.isKeptOnDevice && !status.hasCopyFailed
}

// The one ask for the tab to stay open, while its unsent work is kept nowhere
function keepOpenAsk(state: BannerState) {
  if (!isKeptNowhere(state, state.isRecoveryKept)) {
    return ''
  }

  if (state.hasCopyFailed) {
    return " Unsent changes couldn't be kept on this device, so keep this tab open."
  }

  return ' Keep this tab open.'
}

function messageFor(messages: Record<string, string>, reason: string | null) {
  if (reason === null || !Object.hasOwn(messages, reason)) {
    return null
  }

  return messages[reason]
}

function setAsideBanner(setAside: string): Banner {
  if (setAside === 'restored') {
    return {
      text: 'A version of this document was restored. Your edits from before it were kept as a recovery copy.',
    }
  }

  return { text: "Your last edits couldn't be saved here and were kept as a recovery copy." }
}

function removedWorkBanner(removedWork: 'kept' | 'unkept'): Banner {
  if (removedWork === 'kept') {
    return { text: "Someone else's edit removed text you typed. It was kept as a recovery copy." }
  }

  return {
    text: "Someone else's edit removed text you typed, and it couldn't be kept on this device.",
  }
}

// While saving goes on: a full document, a rebuilt room whose old work went to a recovery copy, or polling
function savingBanner(state: BannerState): Banner | null {
  if (state.isAtLimit) {
    const setAsideNote = state.setAside ? ' Your latest changes went to a recovery copy.' : ''
    return {
      text: `This document is at its size limit.${setAsideNote} Delete content to free space.`,
    }
  }

  if (state.setAside) {
    return setAsideBanner(state.setAside)
  }

  if (state.removedWork) {
    return removedWorkBanner(state.removedWork)
  }

  if (state.isPolling) {
    return { text: "Live updates are unavailable, so others' changes show up late." }
  }

  return null
}

function newerSchemaBanner(state: BannerState): Banner {
  const keepOpen = keepOpenAsk(state)
  if (state.isNewerAfterReload && keepOpen) {
    return {
      text: `This document needs a newer version of Writer than this site has. Ask your admin.${keepOpen}`,
    }
  }

  // A reload that still loads this Writer can't help, so it isn't offered again
  if (state.isNewerAfterReload) {
    return {
      text: 'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.',
    }
  }

  if (keepOpen) {
    return { text: `This document was edited in a newer version of Writer.${keepOpen}` }
  }

  const reloadTo = state.canEdit ? 'edit it' : 'see its latest changes'
  return { text: `This document was edited in a newer version of Writer. Reload to ${reloadTo}.` }
}

function heldBanner(state: BannerState): Banner {
  const text = 'This document is read-only while an admin checks it.'
  if (!state.unsentCount) {
    return { text }
  }

  if (isSafeOnDevice(state)) {
    return {
      text: `${text} Your unsent changes are saved on this device and will be added once it's editable again.`,
    }
  }

  const keepOpen = keepOpenAsk(state)
  return { text: `${text} Your unsent changes will be added once it's editable again.${keepOpen}` }
}

function pauseBanner(pauseMessage: string, state: BannerState): Banner {
  const text = `${pauseMessage}, so your latest changes aren't saved.`
  if (isSafeOnDevice(state)) {
    return { text: `${text} They're kept on this device.` }
  }

  const keepOpen = keepOpenAsk(state)
  return { text: `${text}${keepOpen}` }
}

function signedOutBanner(state: BannerState): Banner {
  const redirectTo = encodeURIComponent(location.pathname)
  const signIn = { label: 'Sign in', href: `/login?redirect-to=${redirectTo}` }
  if (!state.unsentCount) {
    return { text: "You're signed out. ", link: signIn, after: ' to keep editing.' }
  }

  const keepOpen = keepOpenAsk(state)
  const after = ` to save them.${keepOpen}`
  return { text: "You're signed out, so changes aren't saved. ", link: signIn, after }
}

function lockedBanner(state: BannerState): Banner {
  const text = "This document was locked, so changes aren't saved. Unlock it to save them."
  return { text, after: keepOpenAsk(state) }
}

function offlineBanner(state: BannerState): Banner {
  const text = "You're offline and this browser can't keep changes, so editing is paused."
  const keepOpen = keepOpenAsk(state)
  return { text: `${text}${keepOpen}` }
}

function staleSessionBanner(state: BannerState): Banner {
  const note = recoveryNote(state)
  if (isKeptNowhere(state, state.isRecoveryKept)) {
    const keepOpen = keepOpenAsk(state)
    return { text: `You signed in again in another tab.${note}${keepOpen}` }
  }

  return { text: `You signed in again in another tab.${note} Reload to keep saving.` }
}

function otherUserBanner(state: BannerState): Banner {
  const recovery = recoveryNote(state)
  if (isKeptNowhere(state, state.isRecoveryKept)) {
    const keepOpen = keepOpenAsk(state)
    return { text: `Someone else is now signed in here.${recovery}${keepOpen}` }
  }

  if (isSafeOnDevice(state)) {
    return {
      text: 'Someone else is now signed in here. Your unsent changes are kept on this device.',
    }
  }

  return { text: `Someone else is now signed in here.${recovery} Reload to continue.` }
}

function lostEditBanner(state: BannerState): Banner {
  const recovery = recoveryNote(state)
  const keepOpen = keepOpenAsk(state)
  return { text: `You can no longer edit this document.${recovery}${keepOpen}` }
}

function lostReadBanner(state: BannerState): Banner {
  const recovery = recoveryNote(state)
  const keepOpen = keepOpenAsk(state)
  return { text: `You can no longer open this document.${recovery}${keepOpen}` }
}

const BLOCKED_BANNERS: Record<Blocked, (state: BannerState) => Banner> = {
  signed_out: signedOutBanner,
  locked: lockedBanner,
  offline: offlineBanner,
  stale_session: staleSessionBanner,
  other_user: otherUserBanner,
  lost_edit: lostEditBanner,
  lost_read: lostReadBanner,
}

// Unsent work no device store or recovery copy holds, so a reload would lose it and no strip
// offers one
export function isKeptNowhere(
  status: Pick<RoomStatus, 'unsentCount' | 'isKeptOnDevice' | 'hasCopyFailed'>,
  isRecoveryKept: boolean,
) {
  return (
    status.unsentCount > 0 && (!status.isKeptOnDevice || status.hasCopyFailed) && !isRecoveryKept
  )
}

// A frozen tab freezes again after a reload, so its stop offers the reload for saving only
function frozenStopBanner(state: BannerState, reason: string, isLasting: boolean): Banner {
  const recovery = recoveryNote(state)
  const frozenText = `${reason}${recovery} Part of this document can't be shown here, so editing stays paused.`
  if (isKeptNowhere(state, state.isRecoveryKept)) {
    const keepOpen = keepOpenAsk(state)
    return { text: `${frozenText}${keepOpen}` }
  }

  if (isLasting) {
    return { text: frozenText }
  }

  return { text: `${frozenText} Reload to try saving again.`, canReload: true }
}

function stoppedBanner(state: BannerState): Banner {
  const reason = messageFor(STOP_MESSAGES, state.stopReason) ?? 'Saving stopped in this tab.'
  const isLasting = state.stopReason !== null && LASTING_STOPS.has(state.stopReason)
  if (state.isFrozen) {
    return frozenStopBanner(state, reason, isLasting)
  }

  const recovery = recoveryNote(state)
  if (isKeptNowhere(state, state.isRecoveryKept)) {
    const keepOpen = keepOpenAsk(state)
    return { text: `${reason}${recovery}${keepOpen}` }
  }

  const reloadHint = isLasting ? '' : ' Reload to keep editing.'
  return { text: `${reason}${recovery}${reloadHint}` }
}

// A reload can only help once a newer Writer is live, which the newer-schema banner covers, so the
// text promises nothing
export const FROZEN_MESSAGE =
  "Part of this document can't be shown here, so editing is paused to keep it safe."

// `keepOpen`: the ask for a tab whose unsent work a reload would lose
export function frozenBanner(keepOpen = ''): Banner {
  if (keepOpen) {
    return { text: `${FROZEN_MESSAGE}${keepOpen}` }
  }

  return { text: FROZEN_MESSAGE, canReload: true }
}

const UNREADABLE_LINE = " Its saved body couldn't be read, so this is its last saved copy."

// Why every old document waits, as the server names it to System Managers
const WAIT_REASONS: Record<string, string> = {
  node: 'the server has no Node 22.13 or newer',
  scheduler: 'the scheduler is off',
}

// An old document the next conversion run makes collaborative, read-only until then
export function upgradingBanner(reason: string | null, isUnreadable: boolean): Banner {
  const unreadable = isUnreadable ? UNREADABLE_LINE : ''
  let text = 'This document is being upgraded for editing together. It is read-only until then.'
  if (reason) {
    const shown = WAIT_REASONS[reason] ?? reason
    text += ` Reason: ${shown}.`
  }

  return { text: `${text}${unreadable}` }
}

// An old document the converter refused; `reason` only reaches System Managers
export function notUpgradedBanner(reason: string | null, isUnreadable: boolean): Banner {
  const unreadable = isUnreadable ? UNREADABLE_LINE : ''
  let text = "This document couldn't be upgraded, so it stays read-only."
  if (reason) {
    text += ` Reason: ${reason}.`
  }

  return { text: `${text}${unreadable}` }
}

// The old editor's whole-body save, refused once the document saves as it is edited
export function refusedSaveBanner(isRecoveryKept: boolean): Banner {
  const recovery = isRecoveryKept ? ' Unsent changes were kept as a recovery copy.' : ''
  const reason = 'This document now saves as you edit, so saving stopped in this tab.'
  return { text: `${reason}${recovery} Reload to keep editing.` }
}

function waitingBanner(state: BannerState): Banner | null {
  if (state.holdReason) {
    return heldBanner(state)
  }

  if (state.isRestoring) {
    return {
      text: 'Someone is restoring a version of this document. You can edit again once it is done.',
    }
  }

  const pauseMessage = messageFor(PAUSE_MESSAGES, state.pauseReason)
  if (pauseMessage) {
    return pauseBanner(pauseMessage, state)
  }

  return null
}

// A refusal or a stop outranks a wait, since a wait ends on its own
export function bannerFor(state: BannerState): Banner | null {
  if (state.blockReason) {
    return BLOCKED_BANNERS[state.blockReason](state)
  }

  if (state.stopReason || (state.isFrozen && state.hasFailed)) {
    return stoppedBanner(state)
  }

  if (state.hasNewerSchema) {
    return newerSchemaBanner(state)
  }

  if (state.isFrozen) {
    return frozenBanner(keepOpenAsk(state))
  }

  const waitBanner = waitingBanner(state)
  if (waitBanner) {
    return waitBanner
  }

  if (state.hasFailed) {
    return stoppedBanner(state)
  }

  return savingBanner(state)
}

const OPEN_FAILURES: Record<string, string> = {
  signed_out: "You're signed out. Sign in to open this document.",
  locked: 'This document is locked. Unlock it to open it.',
  stale_session: 'You signed in again in another tab. Reload to open this.',
  user_changed: 'Someone else is now signed in here. Reload to open this document.',
}

export function openFailureFor(reason: string | null, status: number | null = null) {
  return (
    OPEN_FAILURES[reason ?? ''] ?? describeFailure(status) ?? "This document couldn't be opened."
  )
}
