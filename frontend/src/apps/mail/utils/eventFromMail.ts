import type { NewEventDraft } from '@/apps/calendar'
import type { Mail } from '@/apps/mail/types'
import type { NamedDate } from '@/apps/mail/utils/mailDates'

// "Re:", "Fwd:" and their kin, however many deep: what the meeting is about is what the thread is.
const REPLY_PREFIX = /^(?:\s*(?:re|fw|fwd|aw|wg|sv|vs)\s*(?:\[\d+\])?\s*:\s*)+/i

/**
 * A calendar event as a mail suggests it: named after the conversation, with everyone on the mail
 * but the Bcc'd as its people. The reader is among them: Calendar knows which addresses are theirs
 * and leaves them out. It runs at `when`, a date the reader picked out of the mail's words.
 * Nothing of the mail's text goes in: the description is the reader's to write.
 */
export const eventFromMail = (
  mail: Pick<Mail, 'subject' | 'from_email' | 'from_name' | 'recipients'>,
  when?: Pick<NamedDate, 'start' | 'end'>,
): NewEventDraft => {
  const people = new Map<string, { email: string; name?: string }>()
  const invite = (email: string | undefined, name?: string | null) => {
    const key = email?.trim().toLowerCase()
    if (!key || people.has(key)) return
    people.set(key, { email: email!.trim(), name: name || undefined })
  }
  invite(mail.from_email, mail.from_name)
  for (const recipient of mail.recipients ?? [])
    if (recipient.type !== 'Bcc') invite(recipient.email, recipient.display_name)

  return {
    title: (mail.subject ?? '').replace(REPLY_PREFIX, '').trim(),
    participants: [...people.values()],
    ...(when && { start: when.start, end: when.end }),
  }
}
