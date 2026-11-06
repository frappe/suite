import { toast } from 'frappe-ui'
import { computed } from 'vue'

import { api, client, useQuery } from '@/api'
import type { Mail } from '@/apps/mail/types'
import { raiseOptimisticToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'

/**
 * A reminder if nobody replies, for the conversation open in a thread (see suite/mail/reminders.py).
 * It follows the latest mail you sent in it, and is offered while that is the conversation's last
 * word: once someone has answered, there is nothing to chase.
 */
export const useReplyReminder = (
  account: () => string,
  threadId: () => string | undefined,
  thread: () => Mail[],
  sentMailbox: () => string,
) => {
  const written = computed(() => thread().filter((mail) => mail.id && !mail.draft))
  const lastIsYours = computed(
    () => !!written.value.at(-1)?.mailboxes.some((box) => box.mailbox_id === sentMailbox()),
  )

  const reminder = useQuery(api.mail.messages.replyReminder, () =>
    account() && threadId() && written.value.length
      ? { account: account(), thread_id: threadId()! }
      : false,
  )
  const remindAt = computed(() => reminder.data?.remind_at ?? undefined)
  const remindable = computed(() => lastIsYours.value && !remindAt.value)

  // Refused, it throws, for the time picker to say why and stay open.
  const remind = async (at: string) => {
    const { remind_at } = await client.mutation(api.mail.messages.remindIfNoReply, {
      account: account(),
      ids: written.value.map((mail) => mail.id),
      remind_at: at,
    })
    toast.success(
      __('Reminder set for {0}.', [formatDateTime(remind_at ?? at, 'ddd, MMM D, h:mm A')]),
    )
  }

  const cancel = () =>
    raiseOptimisticToast(
      client.mutation(api.mail.messages.cancelReplyReminder, {
        account: account(),
        thread_id: threadId()!,
      }),
      __('Reminder cancelled.'),
    )

  return { remindAt, remindable, remind, cancel }
}
