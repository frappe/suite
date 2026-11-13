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
    expect(eventFromMail(mail, ['me@example.com']).title).toBe('Q4 planning')
  })

  it("takes the mail's own words as its description, leaving the quoted trail out", () => {
    expect(eventFromMail(mail, ['me@example.com']).description).toBe(
      'Can we meet Thursday to go over the numbers?',
    )
  })

  it('keeps the paragraphs and lines the mail shows apart', () => {
    // As Gmail writes a reply: a div per line, and a div holding only a <br> for the blank one.
    const gmail = {
      ...mail,
      html_body:
        '<div dir="ltr">Hi,<div><br></div><div>Can we meet Thursday?</div><div>Room 4 is free.</div><div><br></div><div>Priya</div></div>',
    }
    expect(eventFromMail(gmail, []).description).toBe(
      'Hi,\n\nCan we meet Thursday?\nRoom 4 is free.\n\nPriya',
    )

    const paragraphs = {
      ...mail,
      html_body: '<p>Hi Lena,</p>\n  <p>Can we meet\n  Thursday?<br>Say at ten.</p>',
    }
    expect(eventFromMail(paragraphs, []).description).toBe(
      'Hi Lena,\n\nCan we meet Thursday?\nSay at ten.',
    )
  })

  it('invites everyone on the mail but you, and nobody who was only Bcc’d', () => {
    expect(eventFromMail(mail, ['ME@example.com']).participants).toEqual([
      { email: 'priya@example.com', name: 'Priya Nair' },
      { email: 'lena@example.com', name: 'Lena' },
    ])
  })
})
