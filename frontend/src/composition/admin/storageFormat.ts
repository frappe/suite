import { translate as __ } from '@/platform/translation'

/** Storage sizes for admin tables: whole MB below 1 GB, up to two decimals above. */
export function formatStorage(bytes: number): string {
  if (bytes < 1_000_000_000) return __('{0} MB', [Math.round(bytes / 1_000_000).toLocaleString()])
  return __('{0} GB', [
    (bytes / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
  ])
}

type UserStorage = { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }

/** What the user is known to be using. Mail usage that has not been measured yet counts as none. */
export function storageUsed(user: UserStorage): number {
  return user.drive_bytes + (user.mail_bytes ?? 0)
}

export function storageLimit(user: UserStorage): string {
  return user.cap_bytes === null ? __('No limit') : formatStorage(user.cap_bytes)
}
