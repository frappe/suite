import { DRIVE_ROLES, formatDriveBytes, type DriveNotification } from '@/apps/drive'
import { userTimeZone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'

/** A notification about somebody's action on an item, as opposed to one about the reader's own download. */
type ActivityNotification = Extract<DriveNotification, { activity: unknown }>
type Action = ActivityNotification['activity']['action']
type Sentence = (
  actor: string,
  title: string,
  notification: ActivityNotification,
  reader: string | undefined,
) => string

// Every action has a sentence. A new server action fails the typecheck here, and
// the response validator refuses an action it does not know, so the bell never
// shows a raw action word.
const SENTENCES: Record<Action, Sentence> = {
  create: (actor, title) => __('{0} created "{1}"', [actor, title]),
  rename: (actor, title) => __('{0} renamed "{1}"', [actor, title]),
  move: (actor, title) => __('{0} moved "{1}"', [actor, title]),
  edit: (actor, title) => __('{0} edited "{1}"', [actor, title]),
  comment: (actor, title, { activity }, reader) => {
    const mentions = activity.detail.mentions
    return Array.isArray(mentions) && mentions.includes(reader)
      ? __('{0} mentioned you in "{1}"', [actor, title])
      : __('{0} commented on "{1}"', [actor, title])
  },
  trash: (actor, title) => __('{0} moved "{1}" to Trash', [actor, title]),
  restore: (actor, title) => __('{0} restored "{1}"', [actor, title]),
  delete: (actor, title) => __('{0} deleted "{1}"', [actor, title]),
  share_add: (actor, title, { activity }) => {
    const role = rolePhrase(activity.detail.new_role)
    return role
      ? __('{0} shared "{1}" with you ({2})', [actor, title, role])
      : removed(actor, title)
  },
  share_edit: (actor, title, { activity }) => {
    const role = rolePhrase(activity.detail.new_role)
    return role
      ? __('{0} changed your access to "{1}" ({2})', [actor, title, role])
      : removed(actor, title)
  },
  share_remove: (actor, title) => removed(actor, title),
}

const ROLE_PHRASES = new Map<string, () => string>(
  Object.entries({
    [DRIVE_ROLES.read]: () => __('can view'),
    [DRIVE_ROLES.comment]: () => __('can comment'),
    [DRIVE_ROLES.upload]: () => __('can upload'),
    [DRIVE_ROLES.edit]: () => __('can edit'),
    [DRIVE_ROLES.manage]: () => __('can manage'),
  }),
)

/** One plain sentence for the reader: who did what to which item, or what became of their download. */
export function notificationSentence(notification: DriveNotification, reader?: string): string {
  if ('download' in notification) {
    const { title, status } = notification.download
    if (status === 'Failed') return __('Could not prepare "{0}"', [title])
    if (status === 'Expired') return __('"{0}" has expired. Download the items again.', [title])
    return __('"{0}" is ready to download', [title])
  }
  const sentence = SENTENCES[notification.activity.action]
  return sentence(notification.actor.full_name, notification.node_title, notification, reader)
}

/** The comment a mention quotes, why a download failed, a ready zip's size and expiry, or null. */
export function notificationExcerpt(
  notification: DriveNotification,
  now = new Date(),
): string | null {
  if ('download' in notification) return downloadDetails(notification.download, now)
  if (notification.activity.action !== 'comment') return null
  const excerpt = notification.activity.detail.excerpt
  return typeof excerpt === 'string' && excerpt.trim() ? excerpt : null
}

/** When the notification arrived, or when its activity happened if the row has no stamp. */
export function notificationAt(notification: DriveNotification): string | null {
  return notification.creation || ('activity' in notification ? notification.activity.at : null)
}

export function notificationTime(value: string | null | undefined, now = new Date()): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.round((date.getTime() - now.getTime()) / 1_000)
  const absolute = Math.abs(seconds)
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    absolute < 60
      ? [seconds, 'second']
      : absolute < 3_600
        ? [Math.round(seconds / 60), 'minute']
        : absolute < 86_400
          ? [Math.round(seconds / 3_600), 'hour']
          : [Math.round(seconds / 86_400), 'day']
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit)
}

type DownloadNotice = Extract<DriveNotification, { download: unknown }>['download']

/** The list may be older than the expiry, so a Ready row past it reads as expired here. */
function downloadDetails(download: DownloadNotice, now: Date): string | null {
  if (download.status !== 'Ready') return download.error
  const expires = download.expires_at ? new Date(download.expires_at) : null
  if (expires && expires.getTime() <= now.getTime()) return __('Expired')
  const size = download.size === null ? null : formatDriveBytes(download.size)
  if (!expires || Number.isNaN(expires.getTime())) return size
  const until = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: userTimeZone(),
  }).format(expires)
  return size ? __('{0} · Available until {1}', [size, until]) : __('Available until {0}', [until])
}

function removed(actor: string, title: string): string {
  return __('{0} removed your access to "{1}"', [actor, title])
}

function rolePhrase(role: unknown): string | null {
  const phrase = typeof role === 'number' ? ROLE_PHRASES.get(String(role)) : undefined
  return phrase ? phrase() : null
}
