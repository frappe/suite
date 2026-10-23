import dayjs from '@/apps/mail/utils/dayjs'

/**
 * Grouping a list by date, finer for recent mail and coarser the further back it goes: a group per
 * day this week, a group per week for the three weeks before it, then a group per month. The day and
 * week groups run back regardless of months, so they can take a month's last days; that month's
 * group, holding only what is left of it, says so ("Earlier in September", "Earlier this month")
 * rather than reading as the whole month. The groups follow one another in time, so a list sorted
 * newest first meets each once, in order.
 *
 * A group's key names its dates, not how recent they are: 'day:YYYY-MM-DD', 'week:YYYY-MM-DD' (the
 * week's first day), or 'YYYY-MM'. So a group keeps its key, and a fold on it, across midnight; only
 * what its header reads moves on ("Today" becoming "Yesterday").
 */
const WEEKS = 3

const thisWeekOf = (now: Date | string) => dayjs(now).startOf('day').startOf('week')

/** Where the week groups end: everything before it is grouped by month. */
const weeksEnd = (now: Date | string) => thisWeekOf(now).subtract(WEEKS, 'week')

export const dateGroup = (date: Date | string, now: Date | string = new Date()): string => {
  const day = dayjs(date)
  const today = dayjs(now).startOf('day')
  const thisWeek = thisWeekOf(now)
  // Today and yesterday are days of their own even where this week began today.
  const days = thisWeek.isAfter(today.subtract(1, 'day')) ? today.subtract(1, 'day') : thisWeek
  if (!day.isBefore(days)) return `day:${day.format('YYYY-MM-DD')}`
  if (!day.isBefore(weeksEnd(now))) return `week:${day.startOf('week').format('YYYY-MM-DD')}`
  return day.format('YYYY-MM')
}

/** What a group's header reads. */
export const dateGroupLabel = (key: string, now: Date | string = new Date()): string => {
  const today = dayjs(now).startOf('day')
  if (key.startsWith('day:')) {
    const day = dayjs(key.slice(4))
    if (day.isSame(today, 'day')) return __('Today')
    if (day.isSame(today.subtract(1, 'day'), 'day')) return __('Yesterday')
    return day.format('dddd')
  }
  if (key.startsWith('week:')) {
    const weeks = String(thisWeekOf(now).diff(dayjs(key.slice(5)), 'week'))
    return weeks === '1' ? __('Last week') : __('{0} weeks ago', [weeks])
  }
  const month = dayjs(`${key}-01`)
  // Only the month the week groups end in can have lost days to them, and only if they end after
  // its first day.
  const end = weeksEnd(now)
  const partial = end.isSame(month, 'month') && end.isAfter(month)
  if (partial && month.isSame(now, 'month')) return __('Earlier this month')
  const name = month.format(month.year() === dayjs(now).year() ? 'MMMM' : 'MMMM YYYY')
  return partial ? __('Earlier in {0}', [name]) : name
}
