import type { Dayjs } from 'dayjs'

import {
  formatClockTime,
  formatDateTime,
  fromLocalInput,
  isToday,
  userTimeZone,
} from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'

export interface TimeChoice {
  label: string
  /** The exact time in the reader's zone, as short as it can be and still be exact: a choice never
   * leaves them guessing what "later" means. */
  display: string
  /** UTC `...Z`, as the server takes it. */
  value: string
}

const MORNING = 9
const EVENING = 18
// From mid-afternoon the evening is too near to be "later": later today is then a few hours on.
const AFTERNOON = 15
const HOURS_LATER = 3
// Past this, later today is as good as tonight: tomorrow is offered first instead.
const LATEST = 21

// Today's time alone; this week's with its weekday; past that, the date as well.
const displayOf = (at: Dayjs, now: Dayjs) => {
  const days = at.startOf('day').diff(now.startOf('day'), 'day')
  if (days === 0) return at.format('h:mm A')
  if (days < 7) return at.format('ddd h:mm A')
  return at.format('ddd, MMM D, h:mm A')
}

export const timeChoice = (
  label: string,
  at: Dayjs,
  now: Dayjs = dayjs().tz(userTimeZone()),
): TimeChoice => ({
  label,
  display: displayOf(at, now),
  value: fromLocalInput(at.format('YYYY-MM-DDTHH:mm')),
})

/** Why a thread is back in Reminders: its row's word, and the strip over the open thread. */
export const returnedReason = (noReply: boolean) =>
  noReply ? __('No reply yet') : __('From snooze')

/** The strip over a returned thread: when, where the dates are known, with a snooze's start as a
 * muted detail after it; otherwise its row's word. */
export const returnedStrip = (
  noReply: boolean,
  snoozedAt?: string | null,
  returnedAt?: string | null,
  lastSentAt?: string | null,
  now: Date = new Date(),
) => {
  const day = (at: string) => formatDateTime(at, 'ddd, MMM D')
  if (noReply) {
    if (!lastSentAt) return { text: returnedReason(true) }
    const since = isToday(lastSentAt, now) ? formatClockTime(lastSentAt) : day(lastSentAt)
    return { text: __('No reply since {0}', [since]) }
  }
  if (!snoozedAt || !returnedAt) return { text: returnedReason(false) }
  return {
    text: __('Back on {0} at {1}', [day(returnedAt), formatDateTime(returnedAt, 'h:mm A')]),
    detail: __('Snoozed on {0}', [day(snoozedAt)]),
  }
}

/** A snooze's toast, the time as a reminder's says it (see reminderSetMessage). The same for a
 * changed time: either way the threads now wait till then. */
export const snoozedMessage = (count: number, until: string) => {
  const at = formatDateTime(until, 'ddd, MMM D, h:mm A')
  return count > 1 ? __('Threads snoozed until {0}.', [at]) : __('Thread snoozed until {0}.', [at])
}

const morningOf = (day: Dayjs) => day.hour(MORNING).minute(0).second(0)

// Six in the evening; from mid-afternoon, three hours on, up to the next full hour; none past nine.
const laterToday = (now: Dayjs): Dayjs | null => {
  if (now.hour() < AFTERNOON) return now.hour(EVENING).minute(0).second(0)
  const later = now.add(HOURS_LATER, 'hour')
  const onTheHour = later.minute() || later.second() ? later.startOf('hour').add(1, 'hour') : later
  return onTheHour.isAfter(now.hour(LATEST).minute(0).second(0)) ? null : onTheHour
}

/** The times offered for a snooze, soonest first, given the time now in the reader's zone. */
export const snoozeChoices = (now: Dayjs = dayjs().tz(userTimeZone())): TimeChoice[] => {
  const later = laterToday(now)
  const weekday = now.day()
  return [
    later ? timeChoice(__('Later today'), later, now) : null,
    timeChoice(__('Tomorrow'), morningOf(now.add(1, 'day')), now),
    // Monday to Wednesday: from Thursday on, it is as good as next week.
    weekday >= 1 && weekday <= 3
      ? timeChoice(__('Later this week'), morningOf(now.add(2, 'day')), now)
      : null,
    // On a Sunday next Monday is tomorrow, already offered.
    weekday !== 0 ? timeChoice(__('Next week'), morningOf(now.add(8 - weekday, 'day')), now) : null,
  ].filter((choice): choice is TimeChoice => !!choice)
}

/**
 * The times offered for a reminder if nobody replies, in days from now. Each is the morning of that
 * day, which is when a nudge gets read.
 */
export const reminderChoices = (now: Dayjs = dayjs().tz(userTimeZone())): TimeChoice[] => [
  timeChoice(__('Tomorrow'), morningOf(now.add(1, 'day')), now),
  timeChoice(__('In 3 days'), morningOf(now.add(3, 'day')), now),
  timeChoice(__('In a week'), morningOf(now.add(7, 'day')), now),
  timeChoice(__('In 2 weeks'), morningOf(now.add(14, 'day')), now),
]
