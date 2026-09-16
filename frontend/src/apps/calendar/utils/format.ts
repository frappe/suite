import { isEmail } from '@/apps/calendar/utils'
import dayjs from '@/apps/calendar/utils/dayjs'

const DAYS_MAP: Record<string, string> = {
  su: 'Sunday',
  mo: 'Monday',
  tu: 'Tuesday',
  we: 'Wednesday',
  th: 'Thursday',
  fr: 'Friday',
  sa: 'Saturday',
}

// The days of a rule come back in whatever order they were stored, so a series
// set up on a Tuesday read "on Tuesday, Wednesday, Monday, Thursday, Friday" —
// the right five days, listed as though they were unrelated. A week is read in
// week order, so they are sorted into it before they are named. Anything not a
// day of the week keeps its place at the end rather than being dropped.
const DAY_ORDER = Object.keys(DAYS_MAP)
const dayIndex = (day: string) => {
  const index = DAY_ORDER.indexOf(day)
  return index === -1 ? DAY_ORDER.length : index
}

const getByDayMessage = (byDay?: { day: string; nthOfPeriod?: number }[]) => {
  if (!byDay?.length) return ''
  const [first] = byDay

  if (first.nthOfPeriod === -1)
    return __(' on the last {0}', [DAYS_MAP[first.day]])

  if (first.nthOfPeriod != null)
    return __(' on the {0} {1}', [
      getNthLabel(first.nthOfPeriod),
      DAYS_MAP[first.day],
    ])

  return __(' on {0}', [
    [...byDay]
      .sort((a, b) => dayIndex(a.day) - dayIndex(b.day))
      .map((d) => DAYS_MAP[d.day])
      .join(', '),
  ])
}

const getByMonthDayMessage = (byMonthDay?: number[]) => {
  if (!byMonthDay?.length) return ''
  const [day] = byMonthDay
  if (day === -1) return __(' on the last day')
  return __(' on the {0}', [getNthLabel(day)])
}

const getNthLabel = (n: number): string => {
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }
  const suffix = suffixes[n] ?? 'th'
  return `${n}${suffix}`
}

export const toTitleCase = (str: string) =>
  str
    ?.toLowerCase()
    .split(' ')
    .map(function (word: string) {
      return word.charAt(0).toUpperCase().concat(word.substr(1))
    })
    .join(' ') || ''

export const extractNameFromEmail = (email: string) =>
  isEmail(email)
    ? email
        .split('@')[0]
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : email

const getRepeatFrequencyOptions = (interval: number) => [
  { label: interval === 1 ? __('Year') : __('Years'), value: 'yearly' },
  { label: interval === 1 ? __('Month') : __('Months'), value: 'monthly' },
  { label: interval === 1 ? __('Week') : __('Weeks'), value: 'weekly' },
  { label: interval === 1 ? __('Day') : __('Days'), value: 'daily' },
]

export const getRepeatMessage = (recurrenceRule: RecurrenceRule) => {
  const interval = recurrenceRule?.interval || 1
  const frequency = getRepeatFrequencyOptions(interval).find(
    (option) => option.value === recurrenceRule?.frequency,
  )
  // An event can carry an occurrence's recurrence id and no readable rule to go
  // with it - a series whose rule was cleared keeps the occurrences the server
  // had already expanded. There is nothing to say about how it repeats, so this
  // says nothing, rather than throwing out of the panel that was rendering it.
  if (!frequency) return ''

  // Two strings rather than one with an empty placeholder: "Every {0} {1}" with
  // nothing for {0} leaves the spaces either side of it, so a rule that repeats
  // every week read "Every  week". HTML collapses that and the panel never showed
  // it; copied as plain text it survives. It also gives a translator a sentence
  // for each case rather than one with a hole in the middle.
  const message =
    interval === 1
      ? __('Every {0}', [frequency.label.toLowerCase()])
      : __('Every {0} {1}', [interval, frequency.label.toLowerCase()])

  const suffix =
    getByDayMessage(recurrenceRule.byDay) ||
    getByMonthDayMessage(recurrenceRule.byMonthDay)

  const fullMessage = `${message}${suffix}`

  if (recurrenceRule?.until)
    // `until` is a local date-time; strip the `Z` older events carry so the picked
    // date survives instead of shifting a day in zones east of UTC.
    return __('{0} until {1}', [
      fullMessage,
      dayjs(recurrenceRule.until.replace(/Z$/, '')).format('MMM DD, YYYY'),
    ])
  if (recurrenceRule?.count)
    return __('{0}, {1} times', [fullMessage, recurrenceRule.count])

  return fullMessage
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  byDay?: { day: string; nthOfPeriod?: number }[]
  byMonthDay?: number[]
  until?: string
  count?: number
}

/**
 * An alert as a sentence, saying what the desktop's row of controls says: how the
 * reader is told, then when. The phone shows this in place of those controls and
 * opens them on a tap, so anything the sentence leaves out is a field whose value
 * cannot be read without opening it.
 *
 * The detail card has a formatter of its own (EventDetail's formatAlert): it
 * reads the shape the server sends — an ISO offset, or a `when` timestamp — where this
 * reads the shape the form edits, which EventModal's parseAlert produces.
 */
export const formatAlertPhrase = (alert: {
  type: string
  action?: string
  number?: number
  unit?: string
  direction?: number
  relative_to?: string
  date?: string
  time?: string
}) => {
  // Named on every alert, as the desktop's row names it. Left off the ordinary case,
  // the sentence lost its subject — "on 7 Sep at 9:00 am" says when something happens
  // without saying what.
  const action = alert.action === 'Email' ? __('Email') : __('Notification')

  if (alert.type === 'AbsoluteTrigger')
    return (
      `${action} ` +
      __('on {0} at {1}', [
        dayjs(alert.date).format('D MMM'),
        dayjs(`${alert.date}T${alert.time}`).format('h:mm a'),
      ])
    )

  const number = Math.abs(alert.number ?? 0)
  if (!number) return `${action} ${__('at time of event')}`

  // Built here rather than at module scope: `__` is installed on the window at app start,
  // and a table of translated strings evaluated at import time runs before it exists.
  const units: Record<string, [string, string]> = {
    weeks: [__('week'), __('weeks')],
    days: [__('day'), __('days')],
    hours: [__('hour'), __('hours')],
    minutes: [__('minute'), __('minutes')],
  }

  const [singular, plural] = units[alert.unit ?? 'minutes'] ?? units.minutes
  const unit = number === 1 ? singular : plural

  // The anchor is named both ways round: the desktop's row always shows Start or
  // End, and a phrase that says "before" of one and "before end" of the other reads
  // as though the first were anchored to nothing.
  if (alert.relative_to === 'End')
    return (
      `${action} ` +
      (alert.direction === 1
        ? __('{0} {1} after end', [number, unit])
        : __('{0} {1} before end', [number, unit]))
    )

  return (
    `${action} ` +
    (alert.direction === 1
      ? __('{0} {1} after start', [number, unit])
      : __('{0} {1} before start', [number, unit]))
  )
}

/**
 * The days a week is named by — "Sep 7 – 13", or "Aug 30 – Sep 5" where the week
 * straddles two months — rather than a month the week only partly belongs to.
 *
 * The year comes back on its own, as the month title's does, so a header can set
 * it in its own ink: it is the part of a date a reader checks rather than reads.
 *
 * One label for both devices. The desktop names the range the calendar reports;
 * the phone names the week its date falls in — the same seven days, arrived at
 * from either end.
 */
export const weekSpanLabel = (start: string | Date, end: string | Date) => {
  const from = dayjs(start)
  const to = dayjs(end)
  return {
    label: `${from.format('MMM D')} – ${to.format(to.isSame(from, 'month') ? 'D' : 'MMM D')}`,
    year: to.format('YYYY'),
  }
}
