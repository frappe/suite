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

  it.each([
    'I sat with him for an hour',
    'the Sun is out',
    '3/4 of the team agreed',
    'it took 1/2 an hour',
    'support is open 24/7',
    'we rated it 4/5',
    'enjoy the weekend',
    'I will march on',
  ])('underlines nothing in "%s"', (text) => {
    expect(dates(text)).toEqual([])
  })

  it('takes a weekday in short only with a clock time beside it', () => {
    expect(dates('Thu 3pm works')).toEqual([
      { text: 'Thu 3pm', start: { date: '2026-11-19', time: '15:00' }, end: undefined },
    ])
    expect(dates('see you thursday')[0].start).toEqual({ date: '2026-11-19' })
  })

  it('reads an hour with no am or pm as a working hour', () => {
    expect(dates('Can we meet at 5?')[0].start).toEqual({ date: '2026-11-17', time: '17:00' })
    expect(dates('Friday at 2 then')[0].start).toEqual({ date: '2026-11-20', time: '14:00' })
    expect(dates('Call at 9 tomorrow')[0].start).toEqual({ date: '2026-11-18', time: '09:00' })
    expect(dates('Lunch at 12 on Friday')[0].start).toEqual({ date: '2026-11-20', time: '12:00' })
  })

  it('reads a weekday that is the day the mail was sent as that day, while the hour is to come', () => {
    // Friday 20 November, at 10:00 and at 16:00 in India.
    const friday = (sentAt: string) => findMailDates('Friday at 2 then', sentAt, ZONE)[0].start
    expect(friday('2026-11-20T04:30:00Z')).toEqual({ date: '2026-11-20', time: '14:00' })
    expect(friday('2026-11-20T10:30:00Z')).toEqual({ date: '2026-11-27', time: '14:00' })
  })

  it('reads an hour with minutes, and one beside a day written with a zero, as a working hour', () => {
    expect(dates('Can we do 3:30?')[0].start).toEqual({ date: '2026-11-17', time: '15:30' })
    expect(dates('Thursday 03 Dec at 2')[0].start).toEqual({ date: '2026-12-03', time: '14:00' })
  })

  it('keeps a time written as a clock does', () => {
    expect(dates('tomorrow 07:30 works')[0].start).toEqual({ date: '2026-11-18', time: '07:30' })
    expect(dates('the train is at 05:45')[0].start).toEqual({ date: '2026-11-17', time: '05:45' })
  })

  it('offers no date before the day the mail was sent', () => {
    // Sent on the 17th, the reader's day: 20 October is last month's, not next year's.
    expect(dates('The deadline was 20 Oct.')).toEqual([])
    expect(dates('We met on 3 Nov 2026 at 10:00.')).toEqual([])
    expect(dates('Due 20 Dec')[0].start).toEqual({ date: '2026-12-20' })
  })

  it('offers nothing in the line that opens a quoted trail, however it wraps', () => {
    const text =
      'Thursday at 3pm suits me.\n\nOn Tue, Nov 17, 2026 at 10:00 AM Lena Park <lena@example.com>\nwrote:'
    expect(dates(text).map((date) => date.text)).toEqual(['Thursday at 3pm'])
    const outlook =
      'Friday works.\nFrom: Lena Park\nSent: Tuesday, November 17, 2026 10:00 AM\nTo: Me\nSubject: Q4'
    expect(dates(outlook).map((date) => date.text)).toEqual(['Friday'])
  })

  it('offers a date on a line of the writer’s own that starts like a header', () => {
    expect(dates('Date: Thursday 26 Nov, 3pm\nPlace: Room 4')[0].start).toEqual({
      date: '2026-11-26',
      time: '15:00',
    })
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
    // One control, one tab stop, named for the whole date.
    const buttons = [...doc.querySelectorAll('[role="button"]')]
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Thursday at 3pm'])
    expect(doc.querySelectorAll('[tabindex]')).toHaveLength(1)
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

  it('leaves the line opening a trail alone when the writer answered inside it', () => {
    const { marks } = marked(
      '<div>Friday works.</div><div class="gmail_quote"><div class="gmail_attr">On Tue, Nov 17, 2026 at 10:00 AM Lena &lt;<a href="mailto:lena@example.com">lena@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote">Thursday?</blockquote><div>Yes, Thursday at 3pm.</div><blockquote class="gmail_quote">Room?</blockquote></div>',
    )
    expect(marks).toEqual(['Friday', 'Thursday at 3pm'])
  })

  it('leaves a quoted mail’s header alone, links in it and all, but not a date line of the writer’s', () => {
    const { marks } = marked(
      '<p><b>Date:</b> Thursday 26 Nov, 3pm</p><div>Friday works too.</div>' +
        '<div><b>From:</b> Lena &lt;<a href="mailto:lena@example.com">lena@example.com</a>&gt;<br><b>Sent:</b> Tuesday, November 17, 2026 10:00 AM<br><b>Subject:</b> Q4</div>',
    )
    expect(marks).toEqual(['Thursday 26 Nov, 3pm', 'Friday'])
  })

  it('takes no mark a mail brings of its own', () => {
    const { doc, found } = marked(
      '<span data-mail-date="0"><a href="https://example.com" target="_top">Invoice</a></span>',
    )
    expect(found).toEqual([])
    expect(doc.querySelector('[data-mail-date]')).toBeNull()
  })

  it('does not run a date across a line break', () => {
    const { found } = marked('<p>See you Thursday<br>3 people are coming</p>')
    expect(found.map((date) => date.start)).toEqual([{ date: '2026-11-19' }])
  })
})
