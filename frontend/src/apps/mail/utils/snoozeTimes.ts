import type { Dayjs } from 'dayjs'

import { fromLocalInput, userTimeZone } from '@/apps/mail/utils/datetime'
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
// Two choices this close are one choice twice.
const MIN_GAP_HOURS = 2

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

const morningOf = (day: Dayjs) => day.hour(MORNING).minute(0).second(0)

/** The times offered for a snooze, soonest first, given the time now in the reader's zone. */
export const snoozeChoices = (now: Dayjs = dayjs().tz(userTimeZone())): TimeChoice[] => {
  const inAnHour = now.add(1, 'hour').second(0)
  const evening = now.hour(EVENING).minute(0).second(0)
  const weekday = now.day()
  return [
    timeChoice(__('In 1 hour'), inAnHour, now),
    evening.diff(inAnHour, 'hour', true) >= MIN_GAP_HOURS
      ? timeChoice(__('Later today'), evening, now)
      : null,
    timeChoice(__('Tomorrow'), morningOf(now.add(1, 'day')), now),
    // Monday to Wednesday: from Thursday on, it is as good as next week.
    weekday >= 1 && weekday <= 3
      ? timeChoice(__('Later this week'), morningOf(now.add(2, 'day')), now)
      : null,
    // On a Sunday next Monday is tomorrow, already offered.
    weekday !== 0 ? timeChoice(__('Next week'), morningOf(now.add(8 - weekday, 'day')), now) : null,
  ].filter((choice): choice is TimeChoice => !!choice)
}
