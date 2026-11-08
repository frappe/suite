const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * A byte count as people read it: `0 B`, `12.4 MB`, `10 GB`. It counts in
 * 1024s, as the server words its limits (`_readable_size` in
 * `suite/drive/_core/upload.py`), with one decimal below 100 and the reader's
 * decimal separator. `roundUp` keeps a file just over a limit from reading as
 * the limit itself.
 */
export function formatBytes(
  bytes: number,
  { roundUp = false, locale }: { roundUp?: boolean; locale?: string } = {},
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const scale = unit === 0 || value >= 100 ? 1 : 10
  // The epsilon keeps float noise (1.2 * 10 is 12.000000000000002) from rounding up.
  const rounded = (roundUp ? Math.ceil(value * scale - 1e-9) : Math.round(value * scale)) / scale
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded)} ${UNITS[unit]}`
}

/**
 * A listing date, relative while it is recent: `Just now`, `5 min ago`,
 * `3 hr ago`, `Yesterday`, then the day (`Sep 28`), with the year once it
 * is not this year's.
 */
export function formatModified(value: string | null, now = new Date()): string {
  const date = parseDate(value)
  if (!date) return value ?? '—'
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  const days = calendarDaysBetween(date, now)
  if (days === 0 && minutes >= 0) {
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} min ago`
    return `${Math.floor(minutes / 60)} hr ago`
  }
  if (days === 1) return 'Yesterday'
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' },
  ).format(date)
}

/** A full date and time, for details where the exact moment matters. */
export function formatDate(value: string | null): string {
  const date = parseDate(value)
  if (!date) return value ?? '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  )
}

/** Whole calendar days from `from` to `to`, in local time. */
function calendarDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
