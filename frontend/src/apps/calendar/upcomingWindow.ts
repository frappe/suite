/** Local calendar days through the next weekday, including intervening weekend events. */
export function upcomingEventWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const to = new Date(from)
  do {
    to.setDate(to.getDate() + 1)
  } while (to.getDay() === 0 || to.getDay() === 6)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}
