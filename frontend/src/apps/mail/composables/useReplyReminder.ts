import { toast } from 'frappe-ui'
import { computed } from 'vue'

import { api, client, useQuery } from '@/api'
import type { Mail } from '@/apps/mail/types'
import { raiseOptimisticToast } from '@/apps/mail/utils'
import {
  isYours,
  lastWordIsYours,
  reminderSetMessage,
  setReplyReminder,
} from '@/apps/mail/utils/reminderPrompt'

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
  const lastIsYours = computed(() => lastWordIsYours(written.value, sentMailbox()))
  const lastSentAt = computed(
    () => written.value.filter((mail) => isYours(mail, sentMailbox())).at(-1)?.received_at,
  )

  const reminder = useQuery(api.mail.messages.replyReminder, () =>
    account() && threadId() && written.value.length
      ? { account: account(), thread_id: threadId()! }
      : false,
  )
  const remindAt = computed(() => reminder.data?.remind_at ?? undefined)
  const remindable = computed(() => lastIsYours.value && !remindAt.value)

  // Refused, it throws, for the caller to say why.
  const remind = async (at: string) => {
    const setFor = await setReplyReminder(
      account(),
      written.value.map((mail) => mail.id),
      at,
    )
    toast.success(reminderSetMessage(setFor))
  }

  const cancel = () =>
    raiseOptimisticToast(
      client.mutation(api.mail.messages.cancelReplyReminder, {
        account: account(),
        thread_id: threadId()!,
      }),
      __('Reminder removed.'),
    )

  return { remindAt, remindable, lastSentAt, remind, cancel }
}
