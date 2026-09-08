import { format } from 'date-fns'
export function formatSize(size, nDigits = 1) {
  if (size === 0) return 'empty'
  var i = -1
  var byteUnits = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  do {
    size /= 1000
    i++
  } while (size > 1000)
  return Math.max(size, 0.1).toFixed(nDigits) + ' ' + byteUnits[i]
}

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
