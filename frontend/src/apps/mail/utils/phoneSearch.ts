import dayjs from '@/apps/mail/utils/dayjs'
import { translate as __ } from '@/platform/translation'

const DAY = 'YYYY-MM-DD'

/**
 * The dates a phone's Date chip offers. Results come newest first, so the recent end of the list
 * is already at hand; what a date is for is reaching past it: mail older than a week, a month or
 * a year. Each is the `before` day the search route holds, so a search made from one reads back as
 * that preset.
 */
export const searchDatePresets = (today = dayjs()) => [
  { label: __('Older than a week'), before: today.subtract(1, 'week').format(DAY) },
  { label: __('Older than a month'), before: today.subtract(1, 'month').format(DAY) },
  { label: __('Older than a year'), before: today.subtract(1, 'year').format(DAY) },
]

/**
 * A range picked by its first and last days, as the search route holds it. The search takes
 * `after` as the first day in and `before` as the first day out, so the last day picked is kept
 * as the day after it.
 */
export const dateRangeQuery = (from: string, to: string) => ({
  after: from || undefined,
  before: to ? dayjs(to).add(1, 'day').format(DAY) : undefined,
})

/** The route's dates back as the first and last days in the range, for the picker and the chip. */
export const dateRangeDays = (query: { after?: string; before?: string }) => ({
  from: query.after ?? '',
  to: query.before ? dayjs(query.before).subtract(1, 'day').format(DAY) : '',
})

/**
 * Mail before a day or after it, the day itself out, as the search route holds it: `before` is
 * already the first day out, and after a day is from the day after it.
 */
export const singleDayQuery = (side: 'before' | 'after', day: string) =>
  side === 'before' ? { before: day } : { after: dayjs(day).add(1, 'day').format(DAY) }

/** The route's dates back as the picker holds them: a range between two days, or one day's side. */
export const heldDates = (query: { after?: string; before?: string }) => {
  const { from, to } = dateRangeDays(query)
  if (from && to) return { mode: 'between' as const, from, to, single: '' }
  if (query.before) return { mode: 'before' as const, from: '', to: '', single: query.before }
  if (query.after) {
    const single = dayjs(query.after).subtract(1, 'day').format(DAY)
    return { mode: 'after' as const, from: '', to: '', single }
  }
  return { mode: 'between' as const, from: '', to: '', single: '' }
}

/** What the Date chip says for dates that are no preset: "3 Nov – 9 Nov", "Before 3 Nov". */
export const dateRangeLabel = (query: { after?: string; before?: string }, today = dayjs()) => {
  const held = heldDates(query)
  const day = (date: string) =>
    dayjs(date).format(dayjs(date).year() === today.year() ? 'D MMM' : 'D MMM YYYY')
  if (held.mode === 'between')
    return held.from === held.to ? day(held.from) : `${day(held.from)} – ${day(held.to)}`
  return held.mode === 'before'
    ? __('Before {0}', [day(held.single)])
    : __('After {0}', [day(held.single)])
}

/** A chip of a phone's search, as a Button's props: outlined, and filled while it is on. */
export const searchChip = (on: boolean) => ({
  size: 'md' as const,
  variant: on ? ('subtle' as const) : ('outline' as const),
  class: ['shrink-0 rounded-4', { 'border border-transparent !bg-surface-gray-3': on }],
})

// The word each filter goes by, as it would be typed in the palette.
const OPERATORS = new Map([
  ['inMailbox', 'in'],
  ['from', 'from'],
  ['to', 'to'],
  ['cc', 'cc'],
  ['bcc', 'bcc'],
  ['with', 'with'],
  ['subject', 'subject'],
  ['after', 'after'],
  ['before', 'before'],
])

/**
 * A search as a recent search names it: the words, then each filter as the palette writes it
 * (`from:dana@example.com`, `in:Archive`, `is:unread`).
 */
export const searchLabel = (query: Record<string, string>, folderName: (id: string) => string) => {
  const parts = [query.text ?? '']
  for (const [key, value] of Object.entries(query)) {
    if (key === 'inMailbox') parts.push(`in:${folderName(value)}`)
    else if (OPERATORS.has(key)) parts.push(`${OPERATORS.get(key)}:${value}`)
    else if (key === 'isRead') parts.push(value === 'true' ? 'is:read' : 'is:unread')
    else if (key === 'hasAttachment')
      parts.push(value === 'true' ? 'has:attachments' : 'has:no-attachments')
  }
  return parts.filter(Boolean).join(' · ')
}
