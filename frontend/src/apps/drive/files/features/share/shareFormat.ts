import { parseStamp } from '@/apps/drive/client/grants'
import { toast } from '@/platform/feedback'

/** A grant's expiry day, as the dialog shows it. */
export function formatDay(stamp: string): string {
  const date = parseStamp(stamp)
  if (!Number.isFinite(date.getTime())) return stamp
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

/** `YYYY-MM-DD` of a stamp, for the date picker. */
export function stampDay(stamp: string | null): string {
  return stamp ? stamp.slice(0, 10) : ''
}

/** Copies a `/l/<token>` URL as an absolute URL and says so. */
export async function copyLink(url: string, message = 'Link copied'): Promise<void> {
  const absolute = new URL(url, window.location.origin).href
  try {
    await navigator.clipboard.writeText(absolute)
    toast.success(message)
  } catch {
    toast.info('Copy this link', { description: absolute })
  }
}
