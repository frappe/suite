import { useMailCompose, type MailRecipient } from '@/apps/mail'

/**
 * "Email participants", from the event's card or sheet. The calendar has no composer of its own;
 * Mail lends its own (mailto: would depend on the OS having a mail handler, and the suite IS the
 * mail client). Over the calendar on a desktop, where writing to everyone is where attention goes
 * next, so the card steps aside first, as it does in Mail, rather than sitting over the window. A
 * phone's sheet stays: Mail's compose page goes over it, and Back comes back to it.
 */
export function useEmailParticipants({
  closeCard,
  isCard,
}: {
  /** Closes the event's card. */
  closeCard: () => Promise<unknown>
  /** Whether the event is open as a card (a desktop) rather than a sheet (a phone). */
  isCard: () => boolean
}): (people: MailRecipient[]) => Promise<void> {
  const mail = useMailCompose()
  return async (people) => {
    if (isCard()) await closeCard()
    await mail.compose(people)
  }
}
