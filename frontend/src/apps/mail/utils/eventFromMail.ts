import type { NewEventDraft } from '@/apps/calendar'
import type { Mail } from '@/apps/mail/types'
import { findQuoteRoots } from '@/apps/mail/utils/quotedContent'

// "Re:", "Fwd:" and their kin, however many deep: what the meeting is about is what the thread is.
const REPLY_PREFIX = /^(?:\s*(?:re|fw|fwd|aw|wg|sv|vs)\s*(?:\[\d+\])?\s*:\s*)+/i

// A description is a note on the event, not the mail kept twice.
const DESCRIPTION_LIMIT = 2000

/**
 * A calendar event as a mail suggests it: named after the conversation, the mail's own words (the
 * quoted trail left out) as its description, and everyone on the mail but you invited. When it
 * happens is the reader's to say — a date read out of prose would be a guess.
 */
export const eventFromMail = (
  mail: Pick<
    Mail,
    'subject' | 'html_body' | 'text_body' | 'from_email' | 'from_name' | 'recipients'
  >,
  ownAddresses: readonly string[],
): NewEventDraft => {
  const own = new Set(ownAddresses.map((address) => address.toLowerCase()))
  const people = new Map<string, { email: string; name?: string }>()
  const invite = (email: string | undefined, name?: string | null) => {
    const key = email?.trim().toLowerCase()
    if (!key || own.has(key) || people.has(key)) return
    people.set(key, { email: email!.trim(), name: name || undefined })
  }
  invite(mail.from_email, mail.from_name)
  for (const recipient of mail.recipients ?? [])
    if (recipient.type !== 'Bcc') invite(recipient.email, recipient.display_name)

  return {
    title: (mail.subject ?? '').replace(REPLY_PREFIX, '').trim(),
    description: words(mail),
    participants: [...people.values()],
  }
}

const words = (mail: Pick<Mail, 'html_body' | 'text_body'>) => {
  let text = mail.text_body ?? ''
  if (mail.html_body) {
    const doc = new DOMParser().parseFromString(mail.html_body, 'text/html')
    doc.querySelectorAll('style, script, title').forEach((element) => element.remove())
    findQuoteRoots(doc).forEach((quote) => quote.remove())
    text = doc.body.innerText ?? doc.body.textContent ?? ''
  }
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT).trimEnd()}…` : text
}
