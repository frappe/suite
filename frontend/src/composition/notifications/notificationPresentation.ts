import { DRIVE_ROLES, formatDriveBytes, type DriveNotification } from '@/apps/drive'
import { userTimeZone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'

/** A notification about somebody's action on an item, as opposed to one about the reader's own download. */
type ActivityNotification = Extract<DriveNotification, { activity: unknown }>
type Action = ActivityNotification['activity']['action']

/** A run of a notification's sentence; the person and the item are `strong`. */
export type SentencePart = { text: string; strong: boolean }

type Sentence = (
  actor: string,
  title: string,
  notification: ActivityNotification,
  reader: string | undefined,
) => SentencePart[]

// Every action has a sentence. A new server action fails the typecheck here, and
// the response validator refuses an action it does not know, so the bell never
// shows a raw action word. `{0}` is the person and `{1}` the item.
const SENTENCES: Record<Action, Sentence> = {
  create: (actor, title) => parts(__('{0} created {1}'), [actor, title]),
  rename: (actor, title) => parts(__('{0} renamed {1}'), [actor, title]),
  move: (actor, title) => parts(__('{0} moved {1}'), [actor, title]),
  edit: (actor, title) => parts(__('{0} edited {1}'), [actor, title]),
  comment: (actor, title, { activity }, reader) => {
    const mentions = activity.detail.mentions
    return Array.isArray(mentions) && mentions.includes(reader)
      ? parts(__('{0} mentioned you in {1}'), [actor, title])
      : parts(__('{0} commented on {1}'), [actor, title])
  },
  trash: (actor, title) => parts(__('{0} moved {1} to Trash'), [actor, title]),
  restore: (actor, title) => parts(__('{0} restored {1}'), [actor, title]),
  delete: (actor, title) => parts(__('{0} deleted {1}'), [actor, title]),
  share_add: (actor, title, { activity }) => {
    const sentence = SHARED.get(String(activity.detail.new_role))
    return sentence ? parts(sentence(), [actor, title]) : removed(actor, title)
  },
  share_edit: (actor, title, { activity }) => {
    const sentence = ACCESS_GIVEN.get(String(activity.detail.new_role))
    return sentence ? parts(sentence(), [actor, title]) : removed(actor, title)
  },
  share_remove: (actor, title) => removed(actor, title),
}

// Whole sentences per role, so a translation can order them as its language needs.
const SHARED = new Map<string, () => string>(
  Object.entries({
    [DRIVE_ROLES.read]: () => __('{0} shared {1} with you to view'),
    [DRIVE_ROLES.comment]: () => __('{0} shared {1} with you to comment'),
    [DRIVE_ROLES.upload]: () => __('{0} shared {1} with you to upload'),
    [DRIVE_ROLES.edit]: () => __('{0} shared {1} with you to edit'),
    [DRIVE_ROLES.manage]: () => __('{0} shared {1} with you to manage'),
  }),
)
const ACCESS_GIVEN = new Map<string, () => string>(
  Object.entries({
    [DRIVE_ROLES.read]: () => __('{0} gave you view access to {1}'),
    [DRIVE_ROLES.comment]: () => __('{0} gave you comment access to {1}'),
    [DRIVE_ROLES.upload]: () => __('{0} gave you upload access to {1}'),
    [DRIVE_ROLES.edit]: () => __('{0} gave you edit access to {1}'),
    [DRIVE_ROLES.manage]: () => __('{0} gave you manage access to {1}'),
  }),
)

/** Who did what to which item, or what became of the reader's download, with the names marked. */
export function notificationParts(
  notification: DriveNotification,
  reader?: string,
): SentencePart[] {
  if ('message' in notification) return [{ text: notification.message.subject, strong: false }]
  if ('download' in notification) {
    const { title, status } = notification.download
    if (status === 'Failed') return parts(__('Could not prepare {0}'), [title])
    if (status === 'Expired')
      return parts(__('{0} has expired. Download the items again.'), [title])
    return parts(__('{0} is ready to download'), [title])
  }
  const sentence = SENTENCES[notification.activity.action]
  return sentence(notification.actor.full_name, notification.node_title, notification, reader)
}

/** One plain sentence for the reader: who did what to which item, or what became of their download. */
export function notificationSentence(notification: DriveNotification, reader?: string): string {
  return notificationParts(notification, reader)
    .map((part) => part.text)
    .join('')
}

/** The comment a mention quotes, why a download failed, a ready zip's size and expiry, or null. */
export function notificationExcerpt(
  notification: DriveNotification,
  now = new Date(),
): string | null {
  if ('message' in notification) return notification.message.detail
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

/** The list may be older than the expiry, so a Ready row past it counts as expired here. */
export function isDownloadExpired(download: DownloadNotice, now = new Date()): boolean {
  return !!download.expires_at && new Date(download.expires_at).getTime() <= now.getTime()
}

function downloadDetails(download: DownloadNotice, now: Date): string | null {
  if (download.status !== 'Ready') return download.error
  if (isDownloadExpired(download, now)) return __('Expired')
  const expires = download.expires_at ? new Date(download.expires_at) : null
  const size = download.size === null ? null : formatDriveBytes(download.size)
  if (!expires || Number.isNaN(expires.getTime())) return size
  const until = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: userTimeZone(),
  }).format(expires)
  return size ? __('{0} · Available until {1}', [size, until]) : __('Available until {0}', [until])
}

function removed(actor: string, title: string): SentencePart[] {
  return parts(__('{0} removed your access to {1}'), [actor, title])
}

/** Splits a translated sentence at its `{n}` slots, marking the names that fill them. */
function parts(sentence: string, names: string[]): SentencePart[] {
  return sentence
    .split(/(\{\d+\})/)
    .filter(Boolean)
    .map((piece) => {
      const slot = /^\{(\d+)\}$/.exec(piece)
      const name = slot ? names[Number(slot[1])] : undefined
      return name === undefined ? { text: piece, strong: false } : { text: name, strong: true }
    })
}
