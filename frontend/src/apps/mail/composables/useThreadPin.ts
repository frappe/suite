import { api, client } from '@/api'
import type { Thread } from '@/apps/mail/types'
import { raiseOptimisticToast } from '@/apps/mail/utils'
import { threadPinIds } from '@/apps/mail/utils/mailCopies'

/**
 * Pinning a conversation, the same from any list: rows of a merged list go to their own account.
 */
export const useThreadPin = () => {
  // No Undo: Unpin is one click away, on the row that just moved.
  const said = (pinned: boolean) => (pinned ? __('Pinned') : __('Unpinned'))

  const pinMails = (account: string, ids: string[], pinned: boolean) =>
    raiseOptimisticToast(
      client.mutation(api.mail.messages.pin, { account, ids, pinned }),
      said(pinned),
    )

  const pinThreads = (threads: Thread[], pinned: boolean) => {
    const byAccount = new Map<string, string[]>()
    for (const thread of threads) {
      const { account } = thread
      byAccount.set(account, [...(byAccount.get(account) ?? []), ...threadPinIds(thread)])
    }
    raiseOptimisticToast(
      Promise.all(
        [...byAccount].map(([account, ids]) =>
          client.mutation(api.mail.messages.pin, { account, ids, pinned }),
        ),
      ),
      said(pinned),
    )
  }

  return { pinThreads, pinMails }
}
