import dayjs from 'dayjs/esm'

import { translate as __ } from '@/platform/translation'

export const dayLabel = (value: string | null | undefined, now = dayjs()) => {
  if (!value) return ''
  const day = dayjs(value)
  if (!day.isValid()) return ''
  if (day.isSame(now, 'day')) return __('Today')
  if (day.isSame(now.subtract(1, 'day'), 'day')) return __('Yesterday')
  return day.format(day.isSame(now, 'year') ? 'ddd, D MMM' : 'D MMM YYYY')
}

export const durationLabel = (seconds: number | null | undefined) => {
  if (!seconds || seconds < 60) return seconds ? __('Under a minute') : ''
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return __('{0} min', [minutes])
  return rest ? __('{0} h {1} min', [hours, rest]) : __('{0} h', [hours])
}
