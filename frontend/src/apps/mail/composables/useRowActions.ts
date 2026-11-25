import { Archive, ArchiveRestore, Mail, MailOpen, Trash2 } from 'lucide-vue-next'
import { computed, type Component } from 'vue'

import { userStore } from '@/apps/mail/stores/user'
import type { Thread } from '@/apps/mail/types'
import { archivable, unarchivable } from '@/apps/mail/utils/receivedMail'
import { translate as __ } from '@/platform/translation'

/** What a row's action does; the row says how (the event it emits for it). */
export type RowActionKey = 'unread' | 'read' | 'archive' | 'unarchive' | 'trash' | 'delete'

export interface RowAction {
  key: RowActionKey
  label: string
  icon: Component
}

/**
 * The actions a row offers, for one thread or for a whole collapsed run of them: its hover buttons
 * on a desktop, and on a phone the actions its swipes do. One rule, so a swipe never does what the
 * row would not offer.
 *
 * The conditions read "any member": offer Archive while any thread is still outside it, Delete only
 * once every thread is already in Trash. For a single thread each rule collapses to the obvious thing.
 * Labels name the count when there is more than one, since a stack row hides its members and the
 * action is about to move all of them.
 */
export function useRowActions(
  props: () => {
    threads: Thread[]
    // The list files by the filing rules, so it can take an archived thread back to the Inbox.
    unarchive: boolean
    // The list is Drafts: its bin discards rather than trashes. Asked of the list, not the thread:
    // a conversation with a reply draft is filed in Drafts and in Inbox alike.
    drafts: boolean
  },
) {
  const user = userStore()

  return computed<RowAction[]>(() => {
    const { threads, unarchive, drafts } = props()
    const many = threads.length > 1
    const count = String(threads.length)

    // Members of a stack always share an account (it is part of the stack key), so the first row's
    // own Archive/Trash ids speak for the run. Falling back to the active account covers a plain row
    // whose mailbox ids are not carried on the thread.
    const archiveId = threads[0]?.archive ?? user.mailboxIds.archive
    const trashId = threads[0]?.trash ?? user.mailboxIds.trash
    const someIn = (mailboxId: string) =>
      threads.some((t) => t.mailboxes.some((m) => m.mailbox_id === mailboxId))
    const everyIn = (mailboxId: string) =>
      threads.every((t) => t.mailboxes.some((m) => m.mailbox_id === mailboxId))
    const folders = (t: Thread) => ({
      sent: t.sent ?? user.mailboxIds.sent,
      archive: archiveId,
      inbox: t.inbox ?? user.mailboxIds.inbox,
    })
    const messagesOf = (t: Thread) => (t.messages?.length ? t.messages : [t])
    const someUnread = threads.some((t) => !t.seen)

    const actions: (RowAction & { offered: boolean })[] = [
      {
        key: 'unread',
        label: many ? __('Mark {0} conversations as Unread', [count]) : __('Mark as Unread'),
        icon: Mail,
        offered: !drafts && !someUnread,
      },
      {
        key: 'read',
        label: many ? __('Mark {0} conversations as Read', [count]) : __('Mark as Read'),
        icon: MailOpen,
        offered: !drafts && someUnread,
      },
      {
        key: 'archive',
        label: many ? __('Archive {0} conversations', [count]) : __('Archive'),
        icon: Archive,
        // Lists that don't file by the rules yet (All Inboxes) keep the old test: their rows span
        // accounts, and the active account's Sent can't tell another account's replies apart.
        offered:
          !drafts &&
          (unarchive
            ? threads.some((t) => archivable(messagesOf(t), folders(t)))
            : !everyIn(archiveId)),
      },
      {
        key: 'unarchive',
        label: many ? __('Unarchive {0} conversations', [count]) : __('Unarchive'),
        icon: ArchiveRestore,
        offered:
          unarchive && !drafts && threads.some((t) => unarchivable(messagesOf(t), folders(t))),
      },
      {
        key: 'trash',
        label: many ? __('Move {0} conversations to Trash', [count]) : __('Move to Trash'),
        icon: Trash2,
        offered: !drafts && !someIn(trashId),
      },
      {
        key: 'delete',
        label: many ? __('Delete {0} conversations', [count]) : __('Delete Conversation'),
        icon: Trash2,
        offered: !drafts && everyIn(trashId),
      },
      {
        key: 'delete',
        label: many ? __('Discard {0} drafts', [count]) : __('Discard'),
        icon: Trash2,
        offered: drafts,
      },
    ]
    return actions.flatMap(({ offered, ...action }) => (offered ? [action] : []))
  })
}
