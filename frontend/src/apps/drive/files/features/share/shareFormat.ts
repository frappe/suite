import { parseStamp } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

/**
 * The "Change your own access?" message: what the caller can still do after
 * the write (§7.4). A Suite Admin keeps Manage whatever the grants say
 * (ADR 0001), so they hear that they can still change the sharing.
 */
export function accessLossMessage(after: number, nodeKind: string, suiteAdmin: boolean): string {
  const kept = keptAccess(after, nodeKind === 'folder' || nodeKind === 'root')
  return suiteAdmin ? `${kept} ${__('As a Suite Admin you can still change its sharing.')}` : kept
}

function keptAccess(role: number, folder: boolean): string {
  if (role <= 0)
    return folder
      ? __('You will lose access to this folder and the items inside it.')
      : __('You will lose access to this item.')
  if (role >= DRIVE_ROLES.edit)
    return folder
      ? __('You will only be able to edit this folder and the items inside it.')
      : __('You will only be able to edit this item.')
  if (role >= DRIVE_ROLES.upload)
    return __('You will only be able to view this folder and the items inside it, and add to it.')
  if (role >= DRIVE_ROLES.comment)
    return folder
      ? __('You will only be able to comment on this folder and the items inside it.')
      : __('You will only be able to comment on this item.')
  return folder
    ? __('You will only be able to view this folder and the items inside it.')
    : __('You will only be able to view this item.')
}

/** A grant's expiry day, as the dialog shows it. */
export function formatDay(stamp: string): string {
  const date = parseStamp(stamp)
  if (!Number.isFinite(date.getTime())) return stamp
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

/** `YYYY-MM-DD` of a stamp in the viewer's zone, for the date picker. */
export function stampDay(stamp: string | null): string {
  if (!stamp) return ''
  const date = parseStamp(stamp)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Copies a `/l/<token>` URL as an absolute URL and says so. */
export async function copyLink(url: string, message = __('Link copied')): Promise<void> {
  const absolute = new URL(url, window.location.origin).href
  try {
    await navigator.clipboard.writeText(absolute)
    toast.success(message)
  } catch {
    toast.info(__('Copy this link'), { description: absolute })
  }
}

/**
 * Copies a link the server is still making, and says so. Safari refuses a
 * clipboard write that starts after an awaited request, so the write starts
 * at once with the URL to come. No link, no message: the row shows the error.
 */
export async function copyNewLink(pending: Promise<string | undefined>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const text = pending.then((url) => {
      if (!url) throw new Error('No link was made.')
      return new Blob([new URL(url, window.location.origin).href], { type: 'text/plain' })
    })
    // The clipboard reads `text`; a failed request must not also surface as unhandled.
    text.catch(() => undefined)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })])
      toast.success(__('Link copied'))
      return
    } catch {
      // The request failed, or this browser refused the write: try the plain way.
    }
  }
  const url = await pending
  if (url) await copyLink(url)
}
