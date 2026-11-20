/**
 * Where a booking page's free slots fall on the booker's own calendar (spec 003, "The booker's
 * time zone"). The server answers UTC start instants; a day here is a date in the booker's
 * zone, so a slot can land on the day before or after the one the host sees. Nothing here
 * talks to the network or Vue.
 */

import dayjs from '@/apps/calendar/utils/dayjs'

/** A calendar month, `month` counted from 0 as `Date` does. */
export interface Month {
  year: number
  month: number
}

const dayKeyFormats = new Map<string, Intl.DateTimeFormat>()

/** The date, `YYYY-MM-DD`, an instant falls on in `zone`. */
export function dayKey(instant: Date | string, zone: string): string {
  let format = dayKeyFormats.get(zone)
  if (!format) {
    // en-CA writes dates as YYYY-MM-DD.
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dayKeyFormats.set(zone, format)
  }
  return format.format(typeof instant === 'string' ? new Date(instant) : instant)
}

/** The slots of each date in `zone`, in the order the server sent them. */
export function slotsByDay(slots: readonly string[], zone: string): Map<string, string[]> {
  const days = new Map<string, string[]>()
  for (const slot of slots) {
    const key = dayKey(slot, zone)
    const day = days.get(key)
    if (day) day.push(slot)
    else days.set(key, [slot])
  }
  return days
}

export function monthOf(key: string): Month {
  const [year, month] = key.split('-').map(Number)
  return { year, month: month - 1 }
}

export function addMonths({ year, month }: Month, months: number): Month {
  const date = new Date(Date.UTC(year, month + months, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

/** The instant a month starts at in `zone`, in UTC. */
export function monthStart({ year, month }: Month, zone: string): string {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00`
  return dayjs.tz(first, zone).toISOString()
}

/** A window of UTC instants, `to` exclusive, as the slot query takes it. */
export interface SlotWindow {
  from: string
  to: string
}

/** The slot query's window for a month in `zone`: its first instant to the next month's. */
export function monthWindow(month: Month, zone: string): SlotWindow {
  return { from: monthStart(month, zone), to: monthStart(addMonths(month, 1), zone) }
}
