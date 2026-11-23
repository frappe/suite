import { useRouter } from 'vue-router'

import { composeLink, useMailCompose, type MailRecipient } from '@/apps/mail'

/**
 * "Email participants", from the event's card or sheet. The calendar has no composer of its own;
 * Mail lends its own (mailto: would depend on the OS having a mail handler, and the suite IS the
 * mail client).
 *
 * On a desktop it opens over the calendar, where writing to everyone is where attention goes next,
 * so the card steps aside first, as it does in Mail, rather than sitting over the window. On a
 * phone it goes to Mail at once by Mail's compose link, which Mail's layout opens as its compose
 * page, loading nothing of Mail's composer here first; the sheet stays behind it for Back.
 *
 * Which of the two is the calendar's call, from its own layout, as Mail's composer host also makes
 * it: two places hold the one decision, accepted to keep the phone's move as it was.
 */
export function useEmailParticipants({
  closeCard,
  isPhone,
}: {
  /** Closes the event's card. */
  closeCard: () => Promise<unknown>
  /** Whether the calendar is laid out for a phone (the event in a sheet, not a card). */
  isPhone: () => boolean
}): (people: MailRecipient[]) => Promise<void> {
  const router = useRouter()
  const mail = useMailCompose()
  return async (people) => {
    if (isPhone()) {
      await router.push(composeLink(people))
      return
    }
    await closeCard()
    await mail.compose(people)
  }
}
