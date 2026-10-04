import { parseStamp } from '@/apps/drive/client/grants'
import { toast } from '@/platform/feedback'

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
export async function copyLink(url: string, message = 'Link copied'): Promise<void> {
  const absolute = new URL(url, window.location.origin).href
  try {
    await navigator.clipboard.writeText(absolute)
    toast.success(message)
  } catch {
    toast.info('Copy this link', { description: absolute })
  }
}
