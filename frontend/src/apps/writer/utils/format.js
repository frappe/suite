import { format } from 'date-fns'
export function formatDate(date) {
  if (!date) return ''
  const dateObj = new Date(date)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const hourCycle = navigator.language || 'en-US'

  const formattedDate = format(dateObj, 'MM/dd/yy', { timeZone })
  let formattedTime
  if (hourCycle === 'en-US') {
    formattedTime = format(dateObj, 'hh:mm a', { timeZone })
  } else {
    formattedTime = format(dateObj, 'hh:mm a', { timeZone })
  }
  return `${formattedDate}, ${formattedTime}`
}
