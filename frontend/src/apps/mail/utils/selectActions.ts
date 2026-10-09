import {
  Archive,
  CircleAlert,
  CircleCheck,
  Mail as MailIcon,
  MailOpen,
  Star,
  StarOff,
  Trash2,
} from 'lucide-vue-next'

import type { Thread } from '@/apps/mail/types'

export interface SelectAction {
  label: string
  // One word for the phone's selection bar; verb phrases and shortcut hints stay in menus and
  // tooltips.
  shortLabel: string
  onClick: () => void
  icon: typeof Star
  condition: () => boolean
}

/** What a list does to its ticked threads. Each view supplies its own: one account's list acts in
 * that account, the All accounts list in each thread's own. */
export interface SelectHandlers {
  star: () => void
  unstar: () => void
  archive: () => void
  junk: () => void
  notJunk: () => void
  trash: () => void
  delete: () => void
  read: () => void
  unread: () => void
}

/**
 * The actions offered on the ticked threads of a list, in the order the toolbar and the phone's
 * selection bar show them. The same set, words and shortcuts in every list; only the handlers differ.
 * `folder` is the folder the list shows, as far as it changes which actions make sense.
 */
export const selectActions = (
  selected: () => Thread[],
  folder: () => { archive: boolean; trash: boolean; drafts: boolean },
  run: SelectHandlers,
): SelectAction[] => {
  const some = (test: (thread: Thread) => boolean) => () => selected().some(test)
  return [
    {
      label: __('Star'),
      shortLabel: __('Star'),
      onClick: run.star,
      icon: Star,
      condition: some((t) => t.flagged === 0),
    },
    {
      label: __('Unstar'),
      shortLabel: __('Unstar'),
      onClick: run.unstar,
      icon: StarOff,
      condition: some((t) => t.flagged === 1),
    },
    {
      label: __('Archive (E)'),
      shortLabel: __('Archive'),
      onClick: run.archive,
      icon: Archive,
      condition: () => !folder().archive,
    },
    {
      label: __('Mark as Junk (!)'),
      shortLabel: __('Junk'),
      onClick: run.junk,
      icon: CircleAlert,
      condition: () => !folder().drafts && some((t) => t.junk === 0)(),
    },
    {
      label: __('Mark as Not Junk'),
      shortLabel: __('Not Junk'),
      onClick: run.notJunk,
      icon: CircleCheck,
      condition: some((t) => t.junk === 1),
    },
    {
      label: __('Move to Trash (Delete)'),
      shortLabel: __('Trash'),
      onClick: run.trash,
      icon: Trash2,
      condition: () => !folder().trash,
    },
    {
      label: __('Delete Threads (Shift+Delete)'),
      shortLabel: __('Delete'),
      onClick: run.delete,
      icon: Trash2,
      condition: () => folder().trash,
    },
    {
      label: __('Mark as Read (Shift+U)'),
      shortLabel: __('Read'),
      onClick: run.read,
      icon: MailOpen,
      condition: some((t) => t.seen === 0),
    },
    {
      label: __('Mark as Unread (U)'),
      shortLabel: __('Unread'),
      onClick: run.unread,
      icon: MailIcon,
      condition: some((t) => t.seen === 1),
    },
  ]
}
