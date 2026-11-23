import { userTimeZone } from '@/platform/time-zone'
import { translate as __ } from '@/platform/translation'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function exactTime(date: Date) {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: userTimeZone(),
  })
}

/** The exact moments behind the label, one line each, with who created the document. */
export function editedDetails(edited: Date, created: Date | null, creator: string | null) {
  const lines = [__('Edited {0}', [exactTime(edited)])]
  if (created) {
    lines.push(
      creator
        ? __('Created {0} by {1}', [exactTime(created), creator])
        : __('Created {0}', [exactTime(created)]),
    )
  }

  return lines
}

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
