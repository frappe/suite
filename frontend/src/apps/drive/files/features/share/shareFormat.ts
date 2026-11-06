import { parseStamp } from '@/apps/drive/client/grants'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

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
