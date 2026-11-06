import type { Dayjs } from 'dayjs'

import { fromLocalInput, userTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'

export interface TimeChoice {
  label: string
  /** The exact time in the reader's zone: a choice never leaves them guessing what "later" means. */
  display: string
  /** UTC `...Z`, as the server takes it. */
  value: string
}

const MORNING = 9
// Later than this, "later today" is tomorrow in all but name.
const LAST_HOUR_TODAY = 21

export const timeChoice = (label: string, at: Dayjs): TimeChoice => ({
  label,
  display: at.format('ddd, MMM D, h:mm A'),
  value: fromLocalInput(at.format('YYYY-MM-DDTHH:mm')),
})

const morningOf = (day: Dayjs) => day.hour(MORNING).minute(0).second(0)

/** The times offered for a snooze, soonest first, given the time now in the reader's zone. */
export const snoozeChoices = (now: Dayjs = dayjs().tz(userTimeZone())): TimeChoice[] => {
  // Three hours on, rounded up to the half hour.
  const later = now
    .add(3, 'hour')
    .add((30 - (now.minute() % 30)) % 30, 'minute')
    .second(0)
  const weekday = now.day()
  return [
    later.isSame(now, 'day') && later.hour() < LAST_HOUR_TODAY
      ? timeChoice(__('Later today'), later)
      : null,
    timeChoice(__('Tomorrow'), morningOf(now.add(1, 'day'))),
    // Monday to Wednesday: from Thursday on, it is as good as next week.
    weekday >= 1 && weekday <= 3
      ? timeChoice(__('Later this week'), morningOf(now.add(2, 'day')))
      : null,
    // On a Sunday next Monday is tomorrow, already offered.
    weekday !== 0 ? timeChoice(__('Next week'), morningOf(now.add(8 - weekday, 'day'))) : null,
  ].filter((choice): choice is TimeChoice => !!choice)
}

/**
 * The times offered for a reminder if nobody replies, counted in days from when the mail goes out:
 * now, or the time it is scheduled for. Each is the morning of that day, which is when a nudge gets
 * read.
 */
export const reminderChoices = (sendsAt: Dayjs = dayjs().tz(userTimeZone())): TimeChoice[] => [
  timeChoice(__('Tomorrow'), morningOf(sendsAt.add(1, 'day'))),
  timeChoice(__('In 3 days'), morningOf(sendsAt.add(3, 'day'))),
  timeChoice(__('In a week'), morningOf(sendsAt.add(7, 'day'))),
  timeChoice(__('In 2 weeks'), morningOf(sendsAt.add(14, 'day'))),
]
