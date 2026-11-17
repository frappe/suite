import { describe, expect, it } from 'vitest'

import { findMailDates, markMailDates } from '@/apps/mail/utils/mailDates'

// Sent on Monday 16 November 2026 at 20:00 UTC: already Tuesday the 17th, 01:30, for a reader in
// India, so a date read in UTC rather than the reader's zone lands a day early.
const SENT = '2026-11-16T20:00:00Z'
const ZONE = 'Asia/Kolkata'

const dates = (text: string) =>
  findMailDates(text, SENT, ZONE).map((date) => ({
    text: text.slice(date.index, date.index + date.length),
    start: date.start,
    end: date.end,
  }))

describe('dates in a mail', () => {
  it('reads a weekday and a time as the coming one', () => {
    expect(dates('Can we meet Thursday at 3pm?')).toEqual([
      { text: 'Thursday at 3pm', start: { date: '2026-11-19', time: '15:00' }, end: undefined },
    ])
  })

  it('reads a day of the month with a time', () => {
    expect(dates('Does 20 Nov 14:00 work for you?')).toEqual([
      { text: '20 Nov 14:00', start: { date: '2026-11-20', time: '14:00' }, end: undefined },
    ])
  })

  it('reads "tomorrow" from the day the mail was sent, in the reader’s zone', () => {
    expect(dates('Let’s talk tomorrow 10:30.')).toEqual([
      { text: 'tomorrow 10:30', start: { date: '2026-11-18', time: '10:30' }, end: undefined },
    ])
  })

  it('reads a range as a start and an end', () => {
    expect(dates('I’m free 3–4pm on Friday')).toEqual([
      {
        text: '3–4pm on Friday',
        start: { date: '2026-11-20', time: '15:00' },
        end: { date: '2026-11-20', time: '16:00' },
      },
    ])
  })

  it('moves a time given in another zone onto the reader’s clock', () => {
    // 3pm in New York is 01:30 the next morning in India.
    expect(dates('Thursday at 3pm EST')[0].start).toEqual({ date: '2026-11-20', time: '01:30' })
  })

  it('keeps the time the mail names across a change of clocks', () => {
    // Sent in London's summer time; the meeting falls after the clocks go back.
    const [date] = findMailDates('See you 2 Nov at 10:00', '2026-10-20T09:00:00Z', 'Europe/London')
    expect(date.start).toEqual({ date: '2026-11-02', time: '10:00' })
  })

  it('reads a day with no time as the whole day', () => {
    const [friday] = dates('Shall we do Friday instead?')
    expect(friday.text).toBe('Friday')
    expect(friday.start).toEqual({ date: '2026-11-20' })
    expect(friday.end).toBeUndefined()
  })

  it('finds nothing in a mail that names no date', () => {
    expect(dates('Thanks for the numbers, I’ll look at them now and get back to you.')).toEqual([])
    expect(dates('Room 4, version 2.3, call +44 20 7946 0958')).toEqual([])
  })
})

const marked = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const found = markMailDates(doc, SENT, ZONE, 'Create event')
  const marks = [...doc.querySelectorAll('[data-mail-date]')]
  return { doc, found, marks: marks.map((mark) => mark.textContent) }
}

describe('dates marked in a mail’s body', () => {
  it('marks a date in the mail’s own words, without changing its text', () => {
    const html = '<p>Hi Lena,</p><p>Can we meet <b>Thursday</b> at 3pm in room 4?</p>'
    const { doc, found, marks } = marked(html)
    expect(marks).toEqual(['Thursday', ' at 3pm'])
    expect(found).toHaveLength(1)
    // Both pieces name the one date they belong to.
    const ids = [...doc.querySelectorAll('[data-mail-date]')].map((m) =>
      m.getAttribute('data-mail-date'),
    )
    expect(new Set(ids)).toEqual(new Set(['0']))
    expect(doc.body.textContent).toBe(
      new DOMParser().parseFromString(html, 'text/html').body.textContent,
    )
  })

  it('leaves links, code and quotes alone', () => {
    const { marks } = marked(
      '<p><a href="https://example.com">Thursday at 3pm</a></p>' +
        '<p><code>tomorrow 10:30</code></p><pre>20 Nov 14:00</pre>' +
        '<blockquote>3–4pm on Friday</blockquote>',
    )
    expect(marks).toEqual([])
  })

  it('leaves the quoted trail alone', () => {
    const { marks } = marked(
      '<div>Friday works.</div><div class="gmail_quote"><div class="gmail_attr">On Mon, 16 Nov 2026 at 09:00, Lena wrote:</div><blockquote class="gmail_quote">Thursday at 3pm?</blockquote></div>',
    )
    expect(marks).toEqual(['Friday'])
  })

  it('does not run a date across a line break', () => {
    const { found } = marked('<p>See you Thursday<br>3 people are coming</p>')
    expect(found.map((date) => date.start)).toEqual([{ date: '2026-11-19' }])
  })
})
