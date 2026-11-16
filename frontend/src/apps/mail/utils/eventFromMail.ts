import type { NewEventDraft } from '@/apps/calendar'
import type { Mail } from '@/apps/mail/types'
import { splitPlainText } from '@/apps/mail/utils/plainTextBlocks'
import { findQuoteRoots } from '@/apps/mail/utils/quotedContent'

// "Re:", "Fwd:" and their kin, however many deep: what the meeting is about is what the thread is.
const REPLY_PREFIX = /^(?:\s*(?:re|fw|fwd|aw|wg|sv|vs)\s*(?:\[\d+\])?\s*:\s*)+/i

// A description is a note on the event, not the mail kept twice.
const DESCRIPTION_LIMIT = 2000

/**
 * A calendar event as a mail suggests it: named after the conversation, the mail's own words (the
 * quoted trail left out) as its description, and everyone on the mail but the Bcc'd as its people.
 * The reader is among them: Calendar knows which addresses are theirs and leaves them out. When it
 * happens is the reader's to say — a date read out of prose would be a guess.
 */
export const eventFromMail = (
  mail: Pick<
    Mail,
    'subject' | 'html_body' | 'text_body' | 'from_email' | 'from_name' | 'recipients'
  >,
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
    description: words(mail),
    participants: [...people.values()],
  }
}

// The HTML part, when there is one, over the text part: HTML marks its quoted trail, and a text
// part only by its `>` lines.
const words = (mail: Pick<Mail, 'html_body' | 'text_body'>) => {
  let text: string
  if (mail.html_body) {
    const doc = new DOMParser().parseFromString(mail.html_body, 'text/html')
    doc.querySelectorAll('style, script, title').forEach((element) => element.remove())
    findQuoteRoots(doc).forEach((quote) => quote.remove())
    text = renderedText(doc.body)
  } else text = ownLines(mail.text_body ?? '')
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cut(text)
}

// A text part without its quoted lines, the "On …, Lena wrote:" line above the first of them, or
// the signature, which runs to the end and so takes in any trail below it.
const ownLines = (text: string) => {
  const blocks = splitPlainText(text)
  const trail = blocks.findIndex((block) => block.kind === 'quote')
  const lead = blocks[trail - 1]
  if (lead?.kind === 'body') {
    const lines = lead.text.trimEnd().split('\n')
    if (lines.at(-1)?.trimEnd().endsWith(':')) lead.text = lines.slice(0, -1).join('\n')
  }
  return blocks
    .filter((block) => block.kind === 'body')
    .map((block) => block.text)
    .join('\n\n')
}

// At most the limit, its ellipsis counted, and never half of a character outside the BMP.
const cut = (text: string) => {
  if (text.length <= DESCRIPTION_LIMIT) return text
  let end = DESCRIPTION_LIMIT - 1
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${text.slice(0, end).trimEnd()}…`
}

// Stand-ins for the line breaks a browser draws at a block's edges: one around a block, two around
// a paragraph, however many edges meet. A <br> is a break of its own and never merges.
const LINE = '\uE000'
const PARAGRAPH = '\uE001'
const BREAK = '\uE002'
const BLOCKS =
  'address, article, aside, blockquote, center, dd, div, dl, dt, figure, footer, form, header, hr, li, main, nav, ol, section, table, tr, ul'
const PARAGRAPHS = 'h1, h2, h3, h4, h5, h6, p, pre'

// A parsed document is never laid out, so its innerText is only its textContent, every line
// break the mail shows lost ("Hi,Can we meet…"). This spells them out instead.
const renderedText = (body: HTMLElement) => {
  // Whitespace in the HTML source is folded, as a browser folds it, except where it is preformatted.
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (!node.parentElement?.closest('pre'))
      node.nodeValue = (node.nodeValue ?? '').replace(/\s+/g, ' ')
  body.querySelectorAll('br').forEach((element) => element.replaceWith(BREAK))
  body.querySelectorAll(BLOCKS).forEach((element) => {
    element.before(LINE)
    element.after(LINE)
  })
  body.querySelectorAll(PARAGRAPHS).forEach((element) => {
    element.before(PARAGRAPH)
    element.after(PARAGRAPH)
  })
  return (body.textContent ?? '')
    .replace(/[ \t]*[\uE000\uE001][\uE000\uE001 \t]*/g, (edges) =>
      edges.includes(PARAGRAPH) ? '\n\n' : '\n',
    )
    .replace(/[ \t]*\uE002[ \t]*/g, '\n')
}
