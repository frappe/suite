import { userStore } from '@/apps/mail/stores/user'
import dayjs from '@/apps/mail/utils/dayjs'

/**
 * Timestamps on the wire are always UTC, spelled the way Stalwart spells them:
 * "2026-07-28T09:02:30Z". Nothing on the server converts them, so this module is the single place
 * that moves between that wire format and the zone the user reads and types in.
 */

// What `<input type="datetime-local">` reads and writes.
const LOCAL_INPUT_FORMAT = 'YYYY-MM-DDTHH:mm'
const UTC_FORMAT = 'YYYY-MM-DDTHH:mm:ss[Z]'

/**
 * The zone timestamps are displayed and typed in: the browser's, falling back to `time_zone` on
 * the User doc for the rare environment where the browser cannot say (`get_user_info` resolves
 * that to the site's zone when unset, completing the browser → user → system fallback chain).
 */
export const userTimeZone = (): string => {
  const { userResource } = userStore()
  return dayjs.tz.guess() || userResource.data?.time_zone
}

/** Reads a UTC timestamp from an API into the user's zone. */
export const inUserTimeZone = (value: string) => dayjs.utc(value).tz(userTimeZone())

/** Formats a UTC timestamp from an API for display in the user's zone. */
export const formatDateTime = (value?: string | null, format = 'MMM D YYYY, h:mm A'): string =>
  value ? inUserTimeZone(value).format(format) : ''

/** Formats a UTC timestamp from an API as "3 hours ago"; relative, so the zone does not matter. */
export const fromNow = (value?: string | null): string => (value ? dayjs.utc(value).fromNow() : '')

/** Fills a `datetime-local` input from a UTC timestamp, in the user's zone. */
export const toLocalInput = (value?: string | null): string =>
  value ? inUserTimeZone(value).format(LOCAL_INPUT_FORMAT) : ''

/**
 * Turns what the user typed into a `datetime-local` input — a wall clock reading in their zone,
 * carrying no offset — back into the UTC timestamp the APIs take. Blank stays blank so callers can
 * tell "unset" from a time.
 */
export const fromLocalInput = (value?: string | null): string =>
  value ? dayjs.tz(value, userTimeZone()).utc().format(UTC_FORMAT) : ''

/**
 * The site's zone — what plain Frappe DB datetime fields (e.g. the exchange doctypes) are
 * stored and served in, as naive strings. Distinct from `userTimeZone()`, which is where
 * timestamps are *displayed*.
 */
export const systemTimeZone = (): string => {
  const { userResource } = userStore()
  return userResource.data?.system_time_zone || dayjs.tz.guess()
}

/** Formats a naive system-zone DB timestamp (not a `...Z` wire value) in the user's zone. */
export const formatSystemDateTime = (
  value?: string | null,
  format = 'MMM D YYYY, h:mm A',
): string => (value ? dayjs.tz(value, systemTimeZone()).tz(userTimeZone()).format(format) : '')

/**
 * Turns a wall-clock reading in the user's zone back into the naive system-zone string a plain
 * DB datetime field stores — the write-side counterpart of `formatSystemDateTime`, for the rare
 * form that edits such a field directly.
 */
export const toSystemDateTime = (value?: string | null): string =>
  value ? dayjs.tz(value, userTimeZone()).tz(systemTimeZone()).format('YYYY-MM-DD HH:mm:ss') : ''

/** The start of a `YYYY-MM-DD` day in the user's zone, as a UTC timestamp the APIs take. */
export const utcDayStart = (date?: string | null): string =>
  date ? dayjs.tz(date, userTimeZone()).startOf('day').utc().format(UTC_FORMAT) : ''

/** The end of a `YYYY-MM-DD` day in the user's zone, as a UTC timestamp the APIs take. */
export const utcDayEnd = (date?: string | null): string =>
  date ? dayjs.tz(date, userTimeZone()).endOf('day').utc().format(UTC_FORMAT) : ''

/** The current time as a UTC timestamp the APIs take. */
export const utcNow = (): string => dayjs.utc().format(UTC_FORMAT)

/** Shifts the current time by `amount` of `unit` and returns it as a UTC timestamp. */
export const utcFromNow = (amount: number, unit: 'day' | 'hour' | 'minute'): string =>
  dayjs.utc().add(amount, unit).format(UTC_FORMAT)
