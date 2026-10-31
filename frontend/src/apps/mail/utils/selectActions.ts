import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  CircleCheck,
  Mail as MailIcon,
  MailOpen,
  Star,
  StarOff,
  Trash2,
} from 'lucide-vue-next'

import type { Thread } from '@/apps/mail/types'
import { archivable, holdsReceivedMail, unarchivable } from '@/apps/mail/utils/receivedMail'

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
  // Where the list files by the filing rules (a single account's); left out elsewhere.
  unarchive?: () => void
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
  // `sent`: the account's Sent, where your own mail is kept — Archive and Junk act only on mail you
  // received (see receivedMail). Left out where the list spans accounts.
  folder: () => {
    archive: boolean
    trash: boolean
    drafts: boolean
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
      label: __('Star'),
      shortLabel: __('Star'),
      onClick: run.star,
      icon: Star,
      // Never on a draft: a search result that is one has nothing to star.
      condition: notDrafts((t) => t.flagged === 0 && !(t.draft && !t.messages?.length)),
    },
    {
      label: __('Unstar'),
      shortLabel: __('Unstar'),
      onClick: run.unstar,
      icon: StarOff,
      condition: notDrafts((t) => t.flagged === 1),
    },
    {
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
      label: __('Unarchive'),
      shortLabel: __('Unarchive'),
      onClick: () => run.unarchive?.(),
      icon: ArchiveRestore,
      condition: () =>
        !!run.unarchive &&
        notDrafts((t) => !!boxesOf(t).archive && unarchivable(messagesOf(t), boxesOf(t)))(),
    },
    {
      label: __('Mark as Junk (!)'),
      shortLabel: __('Junk'),
      onClick: run.junk,
      icon: CircleAlert,
      condition: notDrafts((t) => t.junk === 0 && received(t)),
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
      condition: () => !folder().trash && !folder().drafts,
    },
    {
      label: __('Delete Threads (Shift+Delete)'),
      shortLabel: __('Delete'),
      onClick: run.delete,
      icon: Trash2,
      condition: () => folder().trash,
    },
    // A draft is one's own unsent text: thrown away for good, as the composer's bin does, rather
    // than filed in Trash among mail that was received.
    {
      label: __('Discard (Delete)'),
      shortLabel: __('Discard'),
      onClick: run.delete,
      icon: Trash2,
      condition: () => folder().drafts,
    },
    {
      label: __('Mark as Read (Shift+U)'),
      shortLabel: __('Read'),
      onClick: run.read,
      icon: MailOpen,
      condition: notDrafts((t) => t.seen === 0),
    },
    {
      label: __('Mark as Unread (U)'),
      shortLabel: __('Unread'),
      onClick: run.unread,
      icon: MailIcon,
      condition: notDrafts((t) => t.seen === 1),
    },
  ]
}
