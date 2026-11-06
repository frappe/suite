import { api, client } from '@/api'
import type { Thread } from '@/apps/mail/types'
import { raiseOptimisticToast } from '@/apps/mail/utils'
import { threadPinIds } from '@/apps/mail/utils/mailCopies'

/**
 * Pinning a conversation in a folder, the same from any list: rows of a merged list go to their own
 * account, and its Inbox. A pin is the folder's it is made in (see suite/mail/pins.py).
 */
export const useThreadPin = () => {
  // No Undo: Unpin is one click away, on the row that just moved.
  const said = (pinned: boolean, many = false) =>
    many
      ? pinned
        ? __('Threads pinned.')
        : __('Threads unpinned.')
      : pinned
        ? __('Thread pinned.')
        : __('Thread unpinned.')

  const pinMails = (account: string, ids: string[], pinned: boolean, mailbox: string) =>
    raiseOptimisticToast(
      client.mutation(api.mail.messages.pin, { account, ids, pinned, mailbox }),
      said(pinned),
    )

  // `mailbox` is the list's folder; a merged list's rows are pinned in their account's Inbox.
  const pinThreads = (threads: Thread[], pinned: boolean, mailbox?: string) => {
    const byFolder = new Map<string, { account: string; mailbox: string; ids: string[] }>()
    for (const thread of threads) {
      const { account } = thread
      const folder = mailbox ?? thread.inbox ?? ''
      const key = `${account}|${folder}`
      const entry = byFolder.get(key) ?? { account, mailbox: folder, ids: [] }
      entry.ids.push(...threadPinIds(thread))
      byFolder.set(key, entry)
    }
    raiseOptimisticToast(
      Promise.all(
        [...byFolder.values()].map(({ account, mailbox, ids }) =>
          client.mutation(api.mail.messages.pin, { account, ids, pinned, mailbox }),
        ),
      ),
      said(pinned, threads.length > 1),
    )
  }

  return { pinThreads, pinMails }
}
