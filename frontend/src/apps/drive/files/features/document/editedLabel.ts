import { userTimeZone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Edited 1h ago", or the date once that is over a month back. */
export function editedLabel(edited: Date, now: Date): string {
  const elapsed = now.getTime() - edited.getTime()
  if (elapsed < MINUTE) return __('Edited just now')
  if (elapsed < HOUR) return __('Edited {0}m ago', [Math.floor(elapsed / MINUTE)])
  if (elapsed < DAY) return __('Edited {0}h ago', [Math.floor(elapsed / HOUR)])
  if (elapsed < 30 * DAY) return __('Edited {0}d ago', [Math.floor(elapsed / DAY)])
  const date = edited.toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: userTimeZone(),
  })
  return __('Edited {0}', [date])
}
