// PROTOTYPE — remove. Date maths shared by the week, month and year grids.
// Weeks start on Sunday everywhere in this prototype.
import dayjs, { type Dayjs } from 'dayjs'

export const ISO = 'YYYY-MM-DD'

/**
 * PROTOTYPE — the demo clock, 'HH:mm'. Pinned so a screenshot is reproducible:
 * the now line sits in the same place every time, and so does the split between
 * events that have finished and events still to come. Set to null to follow the
 * real clock.
 */
export const DEMO_NOW: string | null = '11:25'

export function today(): string {
  return dayjs().format(ISO)
}

/** The seven days of the week containing `date`, Sunday first. */
export function weekOf(date: string): Dayjs[] {
  const sunday = dayjs(date).subtract(dayjs(date).day(), 'day')
  return Array.from({ length: 7 }, (_, i) => sunday.add(i, 'day'))
}

/**
 * Whole weeks covering `date`'s month, so a month grid never ends mid-row.
 * Days from the neighbouring months are included and flagged by the caller.
 */
export function monthMatrix(date: string): Dayjs[][] {
  const first = dayjs(date).startOf('month')
  const last = first.endOf('month')
  const start = first.subtract(first.day(), 'day')
  const total = last.add(6 - last.day(), 'day').diff(start, 'day') + 1

  const days = Array.from({ length: total }, (_, i) => start.add(i, 'day'))
  return Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7))
}

/**
 * Hour label for the time gutter. The unit only appears where it changes, so
 * the column reads as numbers rather than 24 repetitions of "am".
 */
export function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return String(hour > 12 ? hour - 12 : hour)
}

/** '14:30' → 870. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** 870 → '2:30 PM'; a whole hour drops the ':00'. */
export function formatTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`
}
