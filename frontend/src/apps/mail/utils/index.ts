import * as cheerio from 'cheerio'
import { toast } from 'frappe-ui'
import { File, Paperclip } from 'lucide-vue-next'

import AudioIcon from '@/apps/mail/components/Icons/AudioIcon.vue'
import ImageIcon from '@/apps/mail/components/Icons/ImageIcon.vue'
import PDFIcon from '@/apps/mail/components/Icons/PDFIcon.vue'
import VideoIcon from '@/apps/mail/components/Icons/VideoIcon.vue'
import { FOLDER_ICON_MAP } from '@/apps/mail/constants'
import type { ComposeMailData, Mail, MailboxData, Recipient } from '@/apps/mail/types'
import dayjs from '@/apps/mail/utils/dayjs'
import { preserveEditorColors } from '@/apps/mail/utils/editorColors'
import { flattenMentions } from '@/apps/mail/utils/mentions'
import {
  forgetRemoval,
  rememberRemoval,
  sendRemoval,
  type PendingRemoval,
} from '@/apps/mail/utils/pendingRemovals'
import { reportMutationError } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

export const toTitleCase = (str: string) =>
  str
    ?.toLowerCase()
    .split(' ')
    .map(function (word: string) {
      return word.charAt(0).toUpperCase().concat(word.substr(1))
    })
    .join(' ') || ''

// A quota or allotment in gigabytes as the dashboard prints it; unknown reads as a dash.
export const formatGb = (gb?: number | null) =>
  gb == null ? '—' : __('{0} GB', [String(Math.round(gb * 100) / 100)])

export const formatBytes = (bytes: number) => {
  if (!+bytes) return '0 Bytes'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export const raiseToast = (
  message: string,
  type = 'success',
  action?: { label: string; onClick: () => void },
  duration?: number,
  // A toast can carry two buttons: `action` is the urgent one, `secondaryAction` the aside. The
  // second is sonner's `cancel` slot — named for its usual job, but it is just a second button, and
  // frappe-ui already styles it (ToastProvider's `cancelButton`). Sonner dismisses the toast when
  // it is pressed, which suits anything that navigates away.
  secondaryAction?: { label: string; onClick: () => void },
) => {
  if (type === 'success') {
    const options: NonNullable<Parameters<typeof toast.success>[1]> = {
      action,
      duration,
      cancel: secondaryAction,
    }
    if (action && secondaryAction) {
      // The cancel slot takes the auto margin when both buttons share a toast.
      options.classes = {
        cancelButton: '!ml-auto mr-1 h-7 shrink-0 rounded-4 bg-transparent !transition-colors',
        actionButton: '!ml-0',
      }
    }
    return toast.success(message, action || duration || secondaryAction ? options : undefined)
  }

  const div = document.createElement('div')
  div.innerHTML = message
  // strip html tags
  const text =
    div.textContent || div.innerText || __('Could not perform the action. Try again later.')
  toast.error(text)
}

/** Report a refusal once, whether it came from the engine or an owner workflow. */
export function raiseError(error: unknown): void {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
    return
  const cause =
    error instanceof Error
      ? error
      : new Error(
          typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof error.message === 'string'
            ? error.message
            : typeof error === 'string'
              ? error
              : __('Could not complete the action. Try again later.'),
        )
  reportMutationError(
    (cause instanceof TransportError && cause.type !== 'NetworkError') ||
      (typeof error === 'object' && error !== null && 'messages' in error)
      ? cause
      : new Error(__('Could not complete the action')),
  )
}

export const raisePromiseToast = async (
  action: () => Promise<unknown>,
  loading: string,
  success: string,
  undoAction?: () => void,
) => {
  toast.dismiss()
  const id = toast.loading(loading)
  try {
    const result = await action()
    toast.dismiss(id)
    toast.success(
      success,
      undoAction ? { action: { label: __('Undo'), onClick: undoAction } } : undefined,
    )
    return result
  } catch (error) {
    toast.dismiss(id)
    raiseError(error)
  }
}

/**
 * The Undo for a write still in flight: it runs once the write has landed, and not at all if the
 * write was refused. Sent alongside the write, the inverse could land first and be overtaken by it,
 * leaving the change in place under a toast that says it was taken back.
 */
export const afterLanding = (forward: Promise<unknown>, undo: () => void) => () =>
  void forward.then(undo, () => {})

// Every Undo's inverse still to be sent or still in flight: see `undoOnClick`.
let undoing: Promise<unknown> = Promise.resolve()

/**
 * The Undo for a write still in flight, in two halves. `restore` puts the screen back on the click.
 * `inverse` is sent only once the write has landed, as `afterLanding`'s is; `restore` is handed its
 * promise, which settles once the inverse has, at once and without it if the write was refused (that
 * left everything as it was), and is rejected if the inverse is. The inverse is sent as it is,
 * never through `afterUndoing`, which would have it wait for itself.
 */
export const undoOnClick =
  (
    forward: Promise<unknown>,
    restore: (inverted: Promise<void>) => void,
    inverse: () => Promise<unknown>,
  ) =>
  () => {
    const inverted = forward.then(
      () => inverse().then(() => {}),
      () => {},
    )
    // Chained: a second Undo made while the first's inverse waits must not let new writes past it.
    undoing = Promise.all([undoing, inverted.catch(() => {})])
    restore(inverted)
  }

/**
 * Sends a write once the last Undo's inverse has gone. An Undo puts rows back before that inverse is
 * sent, so they can be acted on again in the meantime; the new write, sent first, would be
 * overturned by the inverse landing after it.
 */
export const afterUndoing = <T>(send: () => Promise<T>): Promise<T> => undoing.then(send)

/**
 * When an action's toast shows, which its caller says. `onClick`: the screen already shows the change
 * and the message doesn't hang on the answer, so it shows at once, with its Undo, and comes down with
 * the error if the write is refused. `onAnswer`: it waits for the write to land, its message given or
 * read off the answer.
 */
export type ToastTiming<T = unknown> =
  { onClick: string } | { onAnswer: string | ((result: T) => string) }

export const raiseOptimisticToast = <T>(
  forward: Promise<T>,
  timing: ToastTiming<T>,
  undoAction?: () => void,
  refused: (error: unknown) => void = raiseError,
) => {
  toast.dismiss()
  const options = undoAction ? { action: { label: __('Undo'), onClick: undoAction } } : undefined
  if ('onClick' in timing) {
    const shown = toast.success(timing.onClick, options)
    void forward.catch((error) => {
      toast.dismiss(shown)
      refused(error)
    })
    return
  }
  const { onAnswer } = timing
  void forward.then(
    (result) => toast.success(typeof onAnswer === 'string' ? onAnswer : onAnswer(result), options),
    refused,
  )
}

/**
 * One action carried out in several accounts, told as one toast with one Undo, timed as a single
 * write's is. Every account refusing says why; some refusing says why and still offers the Undo, which
 * takes back the accounts that went through.
 */
export const raisePerAccountToast = <T>(
  settled: Promise<PromiseSettledResult<T>[]>,
  timing: ToastTiming<T[]>,
  undoAction: () => void,
) => {
  let someLanded = false
  const forward = settled.then((results) => {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    someLanded = results.some((r) => r.status === 'fulfilled')
    if (failure) throw failure.reason
    return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  })
  raiseOptimisticToast(forward, timing, undoAction, (error) => {
    if (!someLanded) return raiseError(error)
    toast.error(
      (error instanceof TransportError &&
      error.type !== 'NetworkError' &&
      error.type !== 'AbortError'
        ? __(error.message)
        : null) || __('Could not complete the action'),
      { action: { label: __('Undo'), onClick: undoAction } },
    )
  })
}

/**
 * A removal the server cannot take back, offered with an Undo all the same: the caller has already
 * taken the rows off screen, and the request waits out the toast. Undo puts them back and nothing is
 * sent; the toast going sends it. The removal is written down meanwhile, so a page closed inside the
 * window has it sent on the next start rather than silently kept (see pendingRemovals).
 */
export const commitAfterUndo = ({
  message,
  removal,
  restore,
  onSent,
  onFailed = raiseError,
  undoSlot,
}: {
  message: string
  removal: PendingRemoval
  restore: () => void
  /** After the server has carried it out: refresh whatever lists or counts it touched. */
  onSent?: () => void
  /** Says the server refused, where the refusal has more to offer than its message. */
  onFailed?: (error: unknown) => void
  /** The app's Cmd/Ctrl+Z, offered the same Undo for as long as the toast is: `useUndo`'s slot. */
  undoSlot?: { set: (action: () => void) => void; retire: (action: () => void) => void }
}) => {
  const remembered = rememberRemoval(removal)
  let settled = false
  const settle = (keep: boolean) => {
    if (settled) return
    settled = true
    undoSlot?.retire(undo)
    if (keep) {
      forgetRemoval(remembered)
      toast.dismiss(shown)
      return restore()
    }
    void sendRemoval(removal)
      .then(onSent, (error) => {
        restore()
        onFailed(error)
      })
      .finally(() => forgetRemoval(remembered))
  }
  const undo = () => settle(true)
  toast.dismiss()
  undoSlot?.set(undo)
  const shown = toast.success(message, {
    action: { label: __('Undo'), onClick: undo },
    // Gone on its own, closed by hand, or pushed out by the next toast: the removal stands.
    onAutoClose: () => settle(false),
    onDismiss: () => settle(false),
  })
}

export const copyToClipBoard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    raiseToast(__('Copied to clipboard'))
  } catch {
    raiseToast(__('Could not copy'), 'error')
  }
}

export function getGroupedRecipients(
  recipients: Recipient[],
  formatToString: false,
  showEmail?: boolean,
): { to: Recipient[]; cc: Recipient[]; bcc: Recipient[] }
export function getGroupedRecipients(
  recipients: Recipient[],
  formatToString?: true,
  showEmail?: boolean,
): { to: string; cc: string; bcc: string }
export function getGroupedRecipients(
  recipients: Recipient[],
  formatToString = true,
  showEmail = false,
) {
  const to = []
  const cc = []
  const bcc = []

  for (const r of recipients) {
    if (r.type === 'To') to.push(formatToString ? r : { ...r })
    else if (r.type === 'Cc') cc.push(formatToString ? r : { ...r })
    else if (r.type === 'Bcc') bcc.push(formatToString ? r : { ...r })
  }

  if (!formatToString) return { to, cc, bcc }

  const format = (list: Recipient[]) =>
    list
      ?.map(({ display_name, email }) =>
        showEmail && display_name ? `${display_name} <${email}>` : display_name || email,
      )
      .join(', ')

  return {
    to: format(to),
    cc: format(cc),
    bcc: format(bcc),
  }
}

export const getFormattedRecipients = (mailRecipients: Recipient[]) => {
  const groupedRecipients = getGroupedRecipients(mailRecipients)

  let formattedRecipients = ''
  if (groupedRecipients.to) formattedRecipients += __('To:') + ` ${groupedRecipients.to} `
  if (groupedRecipients.cc) formattedRecipients += __('Cc:') + ` ${groupedRecipients.cc} `
  if (groupedRecipients.bcc) formattedRecipients += __('Bcc:') + ` ${groupedRecipients.bcc} `
  return formattedRecipients
}

export const getFormattedDate = (date: Date | string, omitDate = false) => {
  const dateObj = dayjs(date)
  const isCurrentYear = dateObj.year() === dayjs().year()
  if (omitDate) return dateObj.format(isCurrentYear ? 'MMMM' : 'MMMM YYYY')
  if (dateObj.isToday()) return __('Today')
  if (dateObj.isYesterday()) return __('Yesterday')
  return dateObj.format(isCurrentYear ? 'D MMMM' : 'D MMMM YYYY')
}

export const getTheme = (status: string | null | undefined) => {
  switch (status) {
    case 'Draft':
      return 'gray'
    case 'Completed':
      return 'green'
    case 'Failed':
    case 'Cancelled':
      return 'red'
    default:
      return 'blue'
  }
}

export const extractQuotedContent = (htmlBody?: string) => {
  if (!htmlBody) return { quoted_content: '', html_body: '' }

  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlBody, 'text/html')

  const topLevelDiv = Array.from(doc.body.children).find(
    (el) =>
      el.tagName.toLowerCase() === 'div' &&
      (el.classList.contains('frappe_mail_quote') || el.classList.contains('frappe_mail_fwd')),
  )

  let quoted_content = ''
  if (topLevelDiv) {
    quoted_content = topLevelDiv.outerHTML
    topLevelDiv.remove()
  }

  return { quoted_content, html_body: doc.body.innerHTML }
}

/**
 * A saved draft as a composer takes it up again: who it goes to, what it says in the editor, and
 * what it quotes kept apart, as it was written.
 */
export const composeOfDraft = (mail: Mail): ComposeMailData => {
  const { to, cc, bcc } = getGroupedRecipients(mail.recipients, false)
  const asDraft = (recipients: Recipient[]) =>
    recipients.map(({ email, display_name }) => ({
      email,
      display_name: display_name ?? undefined,
    }))
  return {
    name: mail.name,
    id: mail.id,
    from_email: mail.from_email,
    to: asDraft(to),
    cc: asDraft(cc),
    bcc: asDraft(bcc),
    subject: mail.subject || '',
    in_reply_to: mail.message_id,
    in_reply_to_id: mail.id,
    attachments: mail.attachments || [],
    ...extractQuotedContent(mail.html_body),
  }
}

export const isMac = navigator.platform.toUpperCase().includes('MAC')

export const isOverlayPresent = () =>
  !!document.querySelector(
    '[role="dialog"]:not([role="alert"]), [role="alertdialog"], .modal-open, [data-state="open"]:not([data-reka-collection-item]), [data-attachment-viewer]',
  )

export const shouldIgnoreKeypress = (
  e: KeyboardEvent,
  allowCtrlAndMeta: boolean = false,
): boolean => {
  if (isOverlayPresent()) return true

  if (!allowCtrlAndMeta && (e.ctrlKey || e.metaKey)) return true

  const target = e.target
  if (!(target instanceof HTMLElement)) return e.altKey
  return (
    (target instanceof HTMLInputElement && target.type !== 'checkbox') ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    e.altKey
  )
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

// A domain entry, prefixed with @ (e.g. @example.com). Used by screening to trust/block a whole domain.
// Mirrors the backend's DOMAIN_NAME_PATTERN: 1-63 char labels of letters/digits/hyphens (no leading or
// trailing hyphen), joined by dots, at most 253 chars overall — so the Add button never enables a value
// the API would reject.
const isDomain = (s: string) =>
  /^@(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/.test(s)

// A screened value: either a full email address or a whole domain (@example.com).
export const isEmailOrDomain = (s: string) => isEmail(s) || isDomain(s)

// Whether `email` is covered by the screened value `value` — either an exact address match, or a
// '@domain' entry (@example.com) that matches every sender from that domain. Case-insensitive, mirroring
// the backend's sieve matching so a sender from an accepted/blocked domain is treated consistently.
export const matchesScreenedValue = (email: string, value: string) => {
  const normalizedEmail = (email ?? '').trim().toLowerCase()
  const normalizedValue = (value ?? '').trim().toLowerCase()
  if (!normalizedEmail || !normalizedValue) return false

  if (normalizedValue.startsWith('@')) {
    return normalizedEmail.split('@').pop() === normalizedValue.slice(1)
  }

  return normalizedEmail === normalizedValue
}

export const getFileIcon = (type?: string) => {
  if (!type) return Paperclip
  if (type?.startsWith('image/')) return ImageIcon
  if (type === 'application/pdf') return PDFIcon
  if (type?.startsWith('video/')) return VideoIcon
  if (type?.startsWith('audio/')) return AudioIcon

  return File
}

export const randomString = (length: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// `sending`: mentions are flattened to plain links only on the way out. A draft keeps
// the editor's own mention nodes, so reopening one still shows the chips.
export const processInlineImages = (mail: ComposeMailData, { sending = false } = {}) => {
  const htmlBody = mail.html_body! + mail.quoted_content
  const $ = cheerio.load(htmlBody)

  // Unconditional, unlike the mention flattening below: a draft is rendered by the reader too,
  // in the same iframe that can't see the editor's stylesheet, so a draft left holding the
  // variables would already be showing the wrong colours back to its own author.
  preserveEditorColors($)

  if (sending) flattenMentions($)

  const regularAttachments = mail.attachments?.filter((a) => a.disposition !== 'inline') || []
  const inlineAttachments = mail.attachments?.filter((a) => a.disposition === 'inline') || []
  const processedAttachments = [...regularAttachments]

  $('img').each((_, img) => {
    const $img = $(img)
    const src = $img.attr('src')
    if (!src) return

    const cid = $img.attr('data-cid')
    if (!cid) return

    $img.attr('src', `cid:${cid}`)

    if (src.startsWith('/files') || src.startsWith('/private/files')) {
      processedAttachments.push({ file_url: src, disposition: 'inline', cid })
      return
    }

    const url = new URL(src, window.location.origin)
    const blob_id = url.searchParams.get('blob_id')
    if (!blob_id) return

    const attachment = inlineAttachments.find((a) => a.blob_id === blob_id)
    if (attachment) processedAttachments.push({ ...attachment, cid })
  })

  return { html_body: $.html(), attachments: processedAttachments }
}

export const extractNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * What turning on a rule or folder automation turns off: the script the mail server is running,
 * of which it runs one at a time, named as the app names it.
 */
export function turnsOffLine(running: string) {
  if (running === 'vacation') {
    return __('This turns off auto-reply.')
  }

  if (running === 'frappe_mail_automation') {
    return __('This turns off folder automation.')
  }

  return __('This turns off your rule “{0}”.', [running])
}

export { decodeHtmlEntities, hasHtmlContent, plainTextToHtml } from '@/apps/mail/utils/html'
export { analyzeRemoteAssets, blockRemoteAssets } from '@/apps/mail/utils/remoteAssets'

export const getIcon = (mailbox: {
  _name?: string
  icon?: string | null
  role?: string | null
}) => {
  if (mailbox.icon === 'spam') return 'mail-warning'
  if (mailbox.icon) return mailbox.icon
  const icon = Object.entries(FOLDER_ICON_MAP).find(([role]) => role === mailbox.role)?.[1]
  if (icon !== undefined) return icon
  return 'folder'
}

export const getMailboxName = (mailbox: MailboxData) => mailbox._name

// Safari reads the blob behind an `<a download>` asynchronously, after the click has
// already returned, so revoking the object URL in the same tick silently cancels the
// download. Chrome and Firefox snapshot the blob synchronously, which is why this only
// shows up on Safari. Keep the URL alive long enough for the browser to read it, then
// free the blob.
const DOWNLOAD_URL_TTL = 60_000

export const revokeObjectUrlAfterDownload = (url: string) => {
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_TTL)
}

export const downloadUrlAsFile = (url: string, filename: string) => {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  revokeObjectUrlAfterDownload(url)
}
