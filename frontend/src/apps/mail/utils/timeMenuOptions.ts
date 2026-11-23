import { h } from 'vue'

import type { TimeChoice } from '@/apps/mail/utils/snoozeTimes'

/** A row under the times: another way out of the menu than picking one. */
export interface TimeMenuFooter {
  label: string
  onClick: () => void
}

/**
 * The rows of a menu asking for a time: each choice one click, its exact time muted at the row's far
 * end, then a time of the reader's own. Shared by TimeMenu and any menu that asks it as a submenu (a
 * selection bar's Snooze), so the two read the same. `heading` labels the choices, as the menu's own
 * group heading, where nothing else says what the time is for (a phone's sheet has its title).
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
  const own = {
    group: '',
    hideLabel: true,
    options: [{ label: __('Pick a date and time…'), onClick: pickOwn }],
  }
  const times = [...(heading ? [{ group: heading, options: rows }] : rows), own]
  return footer ? [...times, { group: '', hideLabel: true, options: [footer] }] : times
}
