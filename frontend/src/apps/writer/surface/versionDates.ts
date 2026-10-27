import type { DocumentVersion } from '@/apps/drive'

/** The versions taken on one day, under its heading. */
export interface VersionDay {
  label: string
  versions: DocumentVersion[]
}

const DAY_MS = 86_400_000
const THIS_YEAR: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const OTHER_YEAR: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
const TIME: Intl.DateTimeFormatOptions = { timeStyle: 'short' }

/** Anything Drive stamps with when it was made, such as a version or a comment. */
interface Dated {
  creation: string | null
}

// Null for a version whose time can't be read, which then shows none
function takenAt(version: Dated) {
  if (!version.creation) {
    return null
  }

  const date = new Date(version.creation)
  return Number.isFinite(date.getTime()) ? date : null
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today", "Yesterday", then the date, with the year once it isn't this year's. */
function dayLabel(version: Dated, now: Date) {
  const date = takenAt(version)
  if (!date) {
    return ''
  }

  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days === 0) {
    return 'Today'
  }

  if (days === 1) {
    return 'Yesterday'
  }

  const isThisYear = date.getFullYear() === now.getFullYear()
  const format = isThisYear ? THIS_YEAR : OTHER_YEAR
  return new Intl.DateTimeFormat(undefined, format).format(date)
}

/** The versions, newest first as listed, under the day each was taken. */
export function versionDays(versions: DocumentVersion[], now = new Date()): VersionDay[] {
  const days: VersionDay[] = []
  for (const version of versions) {
    const label = dayLabel(version, now)
    const latest = days.at(-1)
    if (latest?.label === label) {
      latest.versions.push(version)
    } else {
      days.push({ label, versions: [version] })
    }
  }

  return days
}

export function versionTime(version: Dated) {
  const date = takenAt(version)
  if (!date) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, TIME).format(date)
}

/** A version's name; an automatic one goes by the day and time it was taken. */
export function versionTitle(version: DocumentVersion, now = new Date()) {
  if (version.label) {
    return version.label
  }

  return [dayLabel(version, now), versionTime(version)].filter(Boolean).join(', ')
}

/** The time for today, else the day: "2:14 PM", "Yesterday", "Oct 12". */
export function dayOrTime(dated: Dated, now = new Date()) {
  const day = dayLabel(dated, now)
  if (day === 'Today') {
    return versionTime(dated)
  }

  return day
}
