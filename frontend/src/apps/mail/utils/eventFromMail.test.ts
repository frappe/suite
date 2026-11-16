import { describe, expect, it } from 'vitest'

import { eventFromMail } from '@/apps/mail/utils/eventFromMail'

const mail = {
  subject: 'Re: Fwd: Q4 planning',
  html_body:
    '<p>Can we meet Thursday to go over the numbers?</p><div class="gmail_quote"><div class="gmail_attr">On Mon, Lena wrote:</div><blockquote class="gmail_quote"><p>Here are the numbers.</p></blockquote></div>',
  text_body: '',
  from_email: 'priya@example.com',
  from_name: 'Priya Nair',
  recipients: [
    { type: 'To' as const, email: 'me@example.com', display_name: 'Me' },
    { type: 'Cc' as const, email: 'lena@example.com', display_name: 'Lena' },
    { type: 'Bcc' as const, email: 'secret@example.com', display_name: null },
  ],
}

describe('an event from a mail', () => {
  it('is named after the conversation, without its Re: and Fwd:', () => {
    expect(eventFromMail(mail).title).toBe('Q4 planning')
  })

  it("takes the mail's own words as its description, leaving the quoted trail out", () => {
    expect(eventFromMail(mail).description).toBe('Can we meet Thursday to go over the numbers?')
  })

  it('keeps the paragraphs and lines the mail shows apart', () => {
    // As Gmail writes a reply: a div per line, and a div holding only a <br> for the blank one.
    const gmail = {
      ...mail,
      html_body:
        '<div dir="ltr">Hi,<div><br></div><div>Can we meet Thursday?</div><div>Room 4 is free.</div><div><br></div><div>Priya</div></div>',
    }
    expect(eventFromMail(gmail).description).toBe(
      'Hi,\n\nCan we meet Thursday?\nRoom 4 is free.\n\nPriya',
    )

    const paragraphs = {
      ...mail,
      html_body: '<p>Hi Lena,</p>\n  <p>Can we meet\n  Thursday?<br>Say at ten.</p>',
    }
    expect(eventFromMail(paragraphs).description).toBe(
      'Hi Lena,\n\nCan we meet Thursday?\nSay at ten.',
    )
  })

  it('leaves the quoted trail out of a mail sent as text alone', () => {
    const text = (text_body: string) => eventFromMail({ ...mail, html_body: '', text_body })

    // A reply on top, the trail and the line that introduces it below.
    expect(
      text('Thursday works for me.\n\nOn Mon, 10 Nov 2026, Lena wrote:\n> Can we meet?\n> Lena')
        .description,
    ).toBe('Thursday works for me.')

    // Answers between the lines they answer: the answers stay, the quoted lines go.
    expect(
      text('On Mon, Lena wrote:\n> Room 4?\nYes, room 4.\n\n> At ten?\nTen is fine.').description,
    ).toBe('Yes, room 4.\n\nTen is fine.')

    // A signature above the trail does not carry the trail in with it.
    const signed = text('Sure.\n-- \nPriya\n\nOn Mon, Lena wrote:\n> Budget numbers attached')
    expect(signed.description).toMatch(/^Sure\./)
    expect(signed.description).not.toContain('Budget numbers')
  })

  it('keeps a long description to 2,000 characters, its ellipsis among them', () => {
    const long = eventFromMail({ ...mail, html_body: '', text_body: 'word '.repeat(1000) })
    expect(long.description!.length).toBeLessThanOrEqual(2000)
    expect(long.description).toMatch(/word…$/)

    // An emoji is two UTF-16 units; the cut must not land between them.
    const emoji = eventFromMail({
      ...mail,
      html_body: '',
      text_body: 'a'.repeat(1998) + '😀'.repeat(10),
    })
    expect(emoji.description!.length).toBeLessThanOrEqual(2000)
    expect(emoji.description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(emoji.description).toMatch(/…$/)
  })

  it('has everyone on the mail as its people, and nobody who was only Bcc’d', () => {
    // The reader too: which addresses are theirs is Calendar's to know.
    expect(eventFromMail(mail).participants).toEqual([
      { email: 'priya@example.com', name: 'Priya Nair' },
      { email: 'me@example.com', name: 'Me' },
      { email: 'lena@example.com', name: 'Lena' },
    ])
  })
})
