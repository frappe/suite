import {
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  CircleAlert,
  CircleCheck,
  Clock,
  Mail as MailIcon,
  MailOpen,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
} from 'lucide-vue-next'
import type { Component } from 'vue'

import type { Thread } from '@/apps/mail/types'
import { archivable, holdsReceivedMail, unarchivable } from '@/apps/mail/utils/receivedMail'
import type { timeMenuOptions } from '@/apps/mail/utils/timeMenuOptions'

type TimeMenuOptions = ReturnType<typeof timeMenuOptions>

export interface SelectAction {
  // The thread toolbar's groups, in its order (see ThreadHeader): what is done to them, read or taken
  // away; what holds them for later, the clocks together and Pin at the end; then what only a
  // selection offers. Where they are filed (Move To, Folders) comes between the first two, from the
  // view.
  group: 'act' | 'later' | 'selection'
  label: string
  // One word for the phone's selection bar; verb phrases and shortcut hints stay in menus and
  // tooltips.
  shortLabel: string
  onClick: () => void
  icon: typeof Star
  condition: () => boolean
  // An action that asks something first (when to snooze until): a menu around its button, which opens
  // it instead of the click. Not where there is no button of its own (a phone's selection bar, the
  // folded More menu): the click asks in a dialog or a sheet then.
  menu?: Component
  // The same asked as a submenu where the actions fold into the More menu, the choices one click
  // each. Called as that menu opens, so its times are the time now.
  submenu?: () => TimeMenuOptions
}

/** A menu of where the ticked threads are filed (Move To, Folders): its rows as the thread toolbar's
 * own. */
export interface FilingMenu {
  label: string
  icon: Component
  options: { label: string; icon?: string | Component; onClick?: () => void }[]
}

/** What a list does to its ticked threads. Each view supplies its own: one account's list acts in
 * that account, the All accounts list in each thread's own. */
export interface SelectHandlers {
  star: () => void
  unstar: () => void
  archive: () => void
  // Where the list files by the filing rules (a single account's); left out elsewhere.
  unarchive?: () => void
  junk: () => void
  notJunk: () => void
  trash: () => void
  delete: () => void
  read: () => void
  unread: () => void
  pin: () => void
  unpin: () => void
  snooze: () => void
  // The toolbar's Snooze button opens this menu, asking for the time; `snooze` asks in the list's
  // dialog where there is no button.
  snoozeMenu?: Component
  // The folded More menu's Snooze submenu (see SelectAction.submenu).
  snoozeOptions?: () => TimeMenuOptions
  unsnooze: () => void
}

/**
 * The actions offered on the ticked threads of a list, in the order the toolbar and the phone's
 * selection bar show them, the thread toolbar's. The same set, words and shortcuts in every list; only the handlers differ.
 * `folder` is the folder the list shows, as far as it changes which actions make sense.
 */
export const selectActions = (
  selected: () => Thread[],
  // `sent`: the account's Sent, where your own mail is kept — Archive and Junk act only on mail you
  // received (see receivedMail). Left out where the list spans accounts.
  folder: () => {
    archive: boolean
    trash: boolean
    drafts: boolean
    // The list is a folder that takes pins (takesPins): the Inbox, Sent, or one of the user's own.
    pinnable?: boolean
    // The list is one a conversation can be snoozed from; or is Snoozed, where it can be brought back.
    snoozable?: boolean
    snoozed?: boolean
    sent?: string
    archiveId?: string
    inboxId?: string
  },
  run: SelectHandlers,
): SelectAction[] => {
  const some = (test: (thread: Thread) => boolean) => () => selected().some(test)
  // Drafts offers only Discard: a draft isn't filed, starred or read.
  const notDrafts = (test: (thread: Thread) => boolean) => () => !folder().drafts && some(test)()
  // Each row's own account's folders where it carries them (a merged list spans accounts), the
  // list's otherwise.
  const boxesOf = (thread: Thread) => ({
    sent: thread.sent ?? folder().sent,
    archive: thread.archive ?? folder().archiveId,
    inbox: thread.inbox ?? folder().inboxId,
  })
  const messagesOf = (thread: Thread) => (thread.messages?.length ? thread.messages : [thread])
  const received = (thread: Thread) => holdsReceivedMail(messagesOf(thread), boxesOf(thread).sent)
  return [
    {
      group: 'act',
      label: __('Mark as Read (Shift+U)'),
      shortLabel: __('Read'),
      onClick: run.read,
      icon: MailOpen,
      condition: notDrafts((t) => t.seen === 0),
    },
    {
      group: 'act',
      label: __('Mark as Unread (U)'),
      shortLabel: __('Unread'),
      onClick: run.unread,
      icon: MailIcon,
      condition: notDrafts((t) => t.seen === 1),
    },
    {
      group: 'act',
      label: __('Archive (E)'),
      shortLabel: __('Archive'),
      onClick: run.archive,
      icon: Archive,
      condition: () =>
        !folder().archive &&
        notDrafts((t) =>
          boxesOf(t).archive ? archivable(messagesOf(t), boxesOf(t)) : received(t),
        )(),
    },
    {
      group: 'act',
      label: __('Unarchive'),
      shortLabel: __('Unarchive'),
      onClick: () => run.unarchive?.(),
      icon: ArchiveRestore,
      condition: () =>
        !!run.unarchive &&
        notDrafts((t) => !!boxesOf(t).archive && unarchivable(messagesOf(t), boxesOf(t)))(),
    },
    {
      group: 'act',
      label: __('Mark as Junk (!)'),
      shortLabel: __('Junk'),
      onClick: run.junk,
      icon: CircleAlert,
      condition: notDrafts((t) => t.junk === 0 && received(t)),
    },
    {
      group: 'act',
      label: __('Mark as Not Junk'),
      shortLabel: __('Not Junk'),
      onClick: run.notJunk,
      icon: CircleCheck,
      condition: some((t) => t.junk === 1),
    },
    {
      group: 'act',
      label: __('Move to Trash (Delete)'),
      shortLabel: __('Trash'),
      onClick: run.trash,
      icon: Trash2,
      condition: () => !folder().trash && !folder().drafts,
    },
    // A draft is one's own unsent text: thrown away for good, as the composer's bin does, rather
    // than filed in Trash among mail that was received.
    {
      group: 'act',
      label: __('Discard (Delete)'),
      shortLabel: __('Discard'),
      onClick: run.delete,
      icon: Trash2,
      condition: () => folder().drafts,
    },
    {
      group: 'act',
      label: __('Delete Threads (Shift+Delete)'),
      shortLabel: __('Delete'),
      onClick: run.delete,
      icon: Trash2,
      condition: () => folder().trash,
    },
    {
      group: 'later',
      // In Snoozed it only moves the time, as the thread's own button says.
      get label() {
        return folder().snoozed ? __('Change snooze time') : __('Snooze')
      },
      shortLabel: __('Snooze'),
      onClick: run.snooze,
      menu: run.snoozeMenu,
      submenu: run.snoozeOptions,
      icon: Clock,
      condition: () => !!(folder().snoozable || folder().snoozed) && some(() => true)(),
    },
    {
      group: 'later',
      label: __('Unsnooze'),
      shortLabel: __('Unsnooze'),
      onClick: run.unsnooze,
      icon: AlarmClockOff,
      condition: () => !!folder().snoozed && some(() => true)(),
    },
    {
      group: 'later',
      label: __('Pin to Top'),
      shortLabel: __('Pin'),
      onClick: run.pin,
      icon: Pin,
      condition: () => !!folder().pinnable && some((t) => !t.pinned)(),
    },
    {
      group: 'later',
      label: __('Unpin'),
      shortLabel: __('Unpin'),
      onClick: run.unpin,
      icon: PinOff,
      condition: () => !!folder().pinnable && some((t) => !!t.pinned)(),
    },
    {
      group: 'selection',
      label: __('Star'),
      shortLabel: __('Star'),
      onClick: run.star,
      icon: Star,
      // Never on a draft: a search result that is one has nothing to star.
      condition: notDrafts((t) => t.flagged === 0 && !(t.draft && !t.messages?.length)),
    },
    {
      group: 'selection',
      label: __('Unstar'),
      shortLabel: __('Unstar'),
      onClick: run.unstar,
      icon: StarOff,
      condition: notDrafts((t) => t.flagged === 1),
    },
  ]
}
