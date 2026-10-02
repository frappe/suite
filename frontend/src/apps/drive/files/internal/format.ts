export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
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
  return new Intl.DateTimeFormat(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { dateStyle: 'medium' }).format(date)
}

/** A full date and time, for details where the exact moment matters. */
export function formatDate(value: string | null): string {
  const date = parseDate(value)
  if (!date) return value ?? '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Whole calendar days from `from` to `to`, in local time. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
