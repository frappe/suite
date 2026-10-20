import { DRIVE_ROLES, type DriveNotification } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

type Action = DriveNotification['activity']['action']
type Sentence = (actor: string, title: string, notification: DriveNotification) => string

// Every action has a sentence. A new server action fails the typecheck here, and
// the response validator refuses an action it does not know, so the bell never
// shows a raw action word.
const SENTENCES: Record<Action, Sentence> = {
  create: (actor, title) => __('{0} created "{1}"', [actor, title]),
  rename: (actor, title) => __('{0} renamed "{1}"', [actor, title]),
  move: (actor, title) => __('{0} moved "{1}"', [actor, title]),
  edit: (actor, title) => __('{0} edited "{1}"', [actor, title]),
  comment: (actor, title) => __('{0} mentioned you in "{1}"', [actor, title]),
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

const ROLE_PHRASES: Record<number, () => string> = {
  [DRIVE_ROLES.read]: () => __('can view'),
  [DRIVE_ROLES.comment]: () => __('can comment'),
  [DRIVE_ROLES.upload]: () => __('can upload'),
  [DRIVE_ROLES.edit]: () => __('can edit'),
  [DRIVE_ROLES.manage]: () => __('can manage'),
}

/** One plain sentence: who did what to which item, for the reader. */
export function notificationSentence(notification: DriveNotification): string {
  const sentence = SENTENCES[notification.activity.action]
  return sentence(notification.actor.full_name, notification.node_title, notification)
}

/** The comment a mention quotes, or null when the activity carries none. */
export function notificationExcerpt(notification: DriveNotification): string | null {
  if (notification.activity.action !== 'comment') return null
  const excerpt = notification.activity.detail.excerpt
  return typeof excerpt === 'string' && excerpt.trim() ? excerpt : null
}

export function notificationTime(value: string | null | undefined, now = new Date()): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.round((date.getTime() - now.getTime()) / 1_000)
  const absolute = Math.abs(seconds)
  const [amount, unit] =
    absolute < 60
      ? [seconds, 'second']
      : absolute < 3_600
        ? [Math.round(seconds / 60), 'minute']
        : absolute < 86_400
          ? [Math.round(seconds / 3_600), 'hour']
          : [Math.round(seconds / 86_400), 'day']
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    amount,
    unit as Intl.RelativeTimeFormatUnit,
  )
}

function removed(actor: string, title: string): string {
  return __('{0} removed your access to "{1}"', [actor, title])
}

function rolePhrase(role: unknown): string | null {
  const phrase = typeof role === 'number' ? ROLE_PHRASES[role] : undefined
  return phrase ? phrase() : null
}
