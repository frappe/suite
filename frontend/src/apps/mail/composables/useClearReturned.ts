import { api, client } from '@/api'
import type { Thread } from '@/apps/mail/types'
import { raiseOptimisticToast } from '@/apps/mail/utils'

/**
 * Clearing a returned conversation's mark (see suite/mail/reminders.py): nothing takes it off but the
 * reader. The rows fall back to their dates on the click (see the client policy), each in its own
 * account, and Undo puts back the marks the server says it took off.
 */
export const useClearReturned = () => {
  // `account` for rows that don't name their own: one account's list.
  const clearReturned = (threads: Thread[], account?: string) => {
    const byAccount = new Map<string, string[]>()
    for (const thread of threads) {
      const owner = thread.account || account
      if (!owner || !thread.returned) continue
      byAccount.set(owner, [...(byAccount.get(owner) ?? []), thread.thread_id])
    }
    if (!byAccount.size) return
    const many = [...byAccount.values()].flat().length > 1
    const cleared = Promise.all(
      [...byAccount].map(async ([owner, threadIds]) => ({
        account: owner,
        marks: await client.mutation(api.mail.messages.dismissReturned, {
          account: owner,
          thread_ids: threadIds,
        }),
      })),
    )
    raiseOptimisticToast(
      cleared,
      many ? __('Threads removed from Reminders.') : __('Thread removed from Reminders.'),
      () =>
        raiseOptimisticToast(
          cleared.then((done) =>
            Promise.all(
              done.map(({ account: owner, marks }) =>
                client.mutation(api.mail.messages.restoreReturned, {
                  account: owner,
                  ids: marks.ids,
                  no_reply_ids: marks.no_reply_ids,
                }),
              ),
            ),
          ),
          many ? __('Threads moved back.') : __('Thread moved back.'),
        ),
    )
  }

  return { clearReturned }
}
