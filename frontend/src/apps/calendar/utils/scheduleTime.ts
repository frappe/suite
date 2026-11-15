const LAST_TIME_MINUTES = 24 * 60 - 15

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export const adjustScheduleEndTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime)) return endTime
  return toTime(Math.min(toMinutes(startTime) + 60, LAST_TIME_MINUTES))
}

export const adjustScheduleStartTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime)) return startTime
  return toTime(Math.max(toMinutes(endTime) - 60, 0))
}

/**
 * The window a new meeting opens on: the next full hour, an hour long. The date is that hour's own,
 * so after 23:00 it is tomorrow, and the end stops at the day's last slot rather than wrapping past
 * midnight to before the start.
 */
export const defaultScheduleWindow = (now: Date) => {
  const start = new Date(now)
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const pad = (value: number) => String(value).padStart(2, '0')
  const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startTime,
    endTime: adjustScheduleEndTime(startTime, startTime),
  }
}
