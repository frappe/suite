import { h } from 'vue'

import type { TimeChoice } from '@/apps/mail/utils/snoozeTimes'

/** A row under the times, in a group of its own: another way out of the menu than picking one (red
 * when it undoes). */
export interface TimeMenuFooter {
  label: string
  onClick: () => void
  theme?: 'red'
}

/**
 * The rows of a menu asking for a time: each choice one click, its exact time muted at the row's far
 * end, and a time of the reader's own as one more choice. Shared by TimeMenu and any menu that asks
 * it as a submenu (a selection bar's Snooze), so the two read the same. `heading` labels the
 * choices: on desktop what the time is for, on a phone (whose sheet title says that) what they do.
 */
export const timeMenuOptions = (
  choices: TimeChoice[],
  pick: (value: string) => void,
  pickOwn: () => void,
  heading?: string,
  footer?: TimeMenuFooter,
) => {
  const rows = choices.map((choice) => ({
    label: choice.label,
    onClick: () => pick(choice.value),
    slots: {
      suffix: () => h('span', { class: 'text-ink-gray-5 ml-6 shrink-0 text-sm' }, choice.display),
    },
  }))
  const options = [...rows, { label: __('Pick a date and time…'), onClick: pickOwn }]
  const times = heading ? [{ group: heading, options }] : options
  return footer ? [...times, { group: '', hideLabel: true, options: [footer] }] : times
}
