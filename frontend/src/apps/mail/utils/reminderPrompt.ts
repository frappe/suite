import { api, client } from '@/api'
import type { Mail } from '@/apps/mail/types'
import { formatDateTime } from '@/apps/mail/utils/datetime'

/** Mail of yours: it is in your Sent. */
export const isYours = (mail: Pick<Mail, 'mailboxes'>, sent: string) =>
  !!sent && mail.mailboxes.some((box) => box.mailbox_id === sent)

/** Whether the conversation's last word is yours: the latest written message is in your Sent. Once
 * someone has answered there is nothing to chase. */
export const lastWordIsYours = (
  mails: Pick<Mail, 'id' | 'draft' | 'mailboxes'>[],
  sent: string,
) => {
  const last = mails.filter((mail) => mail.id && !mail.draft).at(-1)
  return !!last && isYours(last, sent)
}

/** Sets a reminder if nobody replies, on the conversation these messages are in. Refused, it throws,
 * for the caller to say why. */
export const setReplyReminder = async (account: string, ids: string[], at: string) => {
  const { remind_at } = await client.mutation(api.mail.messages.remindIfNoReply, {
    account,
    ids,
    remind_at: at,
  })
  return remind_at ?? at
}

export const reminderSetMessage = (at: string) =>
  __('Reminder set for {0}.', [formatDateTime(at, 'ddd, MMM D, h:mm A')])
