import { describe, expect, it } from 'vitest'

import { findMailDates, markMailDates } from '@/apps/mail/utils/mailDates'

// Sent on Monday 16 November 2026 at 20:00 UTC: already Tuesday the 17th, 01:30, for a reader in
// India, so a date read in UTC rather than the reader's zone lands a day early.
const SENT = '2026-11-16T20:00:00Z'
const ZONE = 'Asia/Kolkata'
// A reader who writes the month first, as most of these tests' dates don't care which.
const READER = { timeZone: ZONE, locale: 'en-US' }

const dates = (text: string, reader = READER) =>
  findMailDates(text, SENT, reader).map((date) => ({
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
    const [date] = findMailDates('See you 2 Nov at 10:00', '2026-10-20T09:00:00Z', {
      timeZone: 'Europe/London',
      locale: 'en-GB',
    })
    expect(date.start).toEqual({ date: '2026-11-02', time: '10:00' })
  })

  it('leaves the punctuation after a date out of it', () => {
    expect(dates('I’m free 3–4pm on Friday, if that works').map((date) => date.text)).toEqual([
      '3–4pm on Friday',
    ])
    // The stop that ends "p.m." is the time's.
    expect(dates('Meet Thursday at 3 p.m., then lunch').map((date) => date.text)).toEqual([
      'Thursday at 3 p.m.',
    ])
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
    const friday = (sentAt: string) => findMailDates('Friday at 2 then', sentAt, READER)[0].start
    expect(friday('2026-11-20T04:30:00Z')).toEqual({ date: '2026-11-20', time: '14:00' })
    expect(friday('2026-11-20T10:30:00Z')).toEqual({ date: '2026-11-27', time: '14:00' })
  })

  it('reads "next" and a weekday as the same day with a time as without one', () => {
    // Sent on Wednesday 18 November: "next Saturday" is the 28th, not the 21st this week.
    const day = (text: string) => findMailDates(text, '2026-11-18T10:00:00Z', READER)[0].start
    expect(day('next Saturday')).toEqual({ date: '2026-11-28' })
    expect(day('next Saturday at 10am')).toEqual({ date: '2026-11-28', time: '10:00' })
    expect(day('next Saturday 10am')).toEqual({ date: '2026-11-28', time: '10:00' })
    for (const [weekday, time, at] of [
      ['Friday', '3pm', '15:00'],
      ['Monday', '9', '09:00'],
    ]) {
      const { date } = day(`next ${weekday}`)
      expect(day(`next ${weekday} at ${time}`)).toEqual({ date, time: at })
    }
  })

  it('reads a part of the day as the hour a meeting in it starts', () => {
    // Sent on Wednesday 18 November, at 15:30 in India.
    const at = (text: string) =>
      findMailDates(text, '2026-11-18T10:00:00Z', READER).map((date) => ({
        text: text.slice(date.index, date.index + date.length),
        start: date.start,
      }))
    expect(at('tomorrow morning')).toEqual([
      { text: 'tomorrow morning', start: { date: '2026-11-19', time: '09:00' } },
    ])
    expect(at('tomorrow afternoon')[0].start).toEqual({ date: '2026-11-19', time: '14:00' })
    expect(at('tomorrow evening')[0].start).toEqual({ date: '2026-11-19', time: '18:00' })
    expect(at('Friday morning')[0].start).toEqual({ date: '2026-11-20', time: '09:00' })
    expect(at('Friday evening')[0].start).toEqual({ date: '2026-11-20', time: '18:00' })
    expect(at('tonight')[0].start).toEqual({ date: '2026-11-18', time: '18:00' })
    expect(at('Are you free this evening?')).toEqual([
      { text: 'this evening', start: { date: '2026-11-18', time: '18:00' } },
    ])
    // Still that day's evening when the mail was sent in it, not tomorrow's.
    expect(findMailDates('this evening', '2026-11-18T13:00:00Z', READER)[0].start).toEqual({
      date: '2026-11-18',
      time: '18:00',
    })
    // An hour named beside it is the hour.
    expect(at('tomorrow evening at 7')[0].start).toEqual({ date: '2026-11-19', time: '19:00' })
  })

  it('offers no deadline or vague stretch of time, nor a part of the day without a day', () => {
    const at = (text: string) =>
      findMailDates(text, '2026-11-18T10:00:00Z', READER).map((date) =>
        text.slice(date.index, date.index + date.length),
      )
    // Sent at 15:30: the morning has gone by, and a greeting names no time.
    for (const text of [
      'Good morning Lena',
      'Good afternoon Lena',
      'Good evening Lena',
      'I spoke to her this morning',
      'Send it by end of day',
      'Send it by EOD',
      'by the end of the week',
      'early next week',
      'in two days',
    ])
      expect(at(text)).toEqual([])
    expect(at('by EOD Friday')).toEqual(['Friday'])
  })

  it('reads a day and month in slashes in the order the reader’s locale writes them', () => {
    // Sent in January, so both readings are still to come. Alone, "05/06" could be a score; a time
    // says it is a day.
    const at = (text: string, locale: string) =>
      findMailDates(text, '2027-01-04T10:00:00Z', { timeZone: ZONE, locale })[0].start
    expect(at('Shall we say 05/06 at 10am?', 'en-GB')).toEqual({
      date: '2027-06-05',
      time: '10:00',
    })
    expect(at('Shall we say 05/06 at 10am?', 'en-US')).toEqual({
      date: '2027-05-06',
      time: '10:00',
    })
    expect(at('5/6 at 3pm', 'en-IN')).toEqual({ date: '2027-06-05', time: '15:00' })
    expect(at('5/6 at 3pm', 'en-US')).toEqual({ date: '2027-05-06', time: '15:00' })
    // A day that can't be a month is read as one, either way, with the weekday beside it.
    for (const locale of ['en-GB', 'en-US']) {
      const found = findMailDates('Saturday, 19/05', '2027-01-04T10:00:00Z', {
        timeZone: ZONE,
        locale,
      })
      expect(found).toEqual([expect.objectContaining({ index: 0, length: 15 })])
      expect(found[0].start).toEqual({ date: '2027-05-19' })
    }
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

  it('reads a day without a year from the last two months as gone by, and an older one as next year’s', () => {
    // Sent on Wednesday 18 November 2026, to readers who write the day or the month first.
    const read = (text: string, locale: string) =>
      findMailDates(text, '2026-11-18T10:00:00Z', { timeZone: ZONE, locale }).map(
        (date) => date.start.date,
      )
    for (const locale of ['en-GB', 'en-US']) {
      for (const text of ['The deadline was 20 Oct.', 'since 1 Oct', 'on 18 Sep at 3pm'])
        expect(read(text, locale)).toEqual([])
      expect(read('17 Sep at 3pm', locale)).toEqual(['2027-09-17'])
      expect(read('5 Jun', locale)).toEqual(['2027-06-05'])
      expect(read('15 Aug', locale)).toEqual(['2027-08-15'])
      expect(read('19/05 at 3pm', locale)).toEqual(['2027-05-19'])
      expect(read('Saturday, 19/05', locale)).toEqual(['2027-05-19'])
    }
    // 2 October, written as each reader writes it.
    expect(read('02/10 at 3pm', 'en-GB')).toEqual([])
    expect(read('10/02 at 3pm', 'en-US')).toEqual([])
    // 5 June and 6 May: both long gone, so next year's.
    expect(read('05/06 at 3pm', 'en-GB')).toEqual(['2027-06-05'])
    expect(read('05/06 at 3pm', 'en-US')).toEqual(['2027-05-06'])
    // Nor is any part of a phrase around a date gone by, read as a time on another day.
    for (const locale of ['en-GB', 'en-US'])
      for (const text of [
        'Thanks for the notes from 20 Oct.',
        'since 20 Oct',
        'on 20 Oct at 3pm',
        'from 1 Oct to 5 Oct',
      ])
        expect(read(text, locale), `${text} (${locale})`).toEqual([])
    // With a year, as written: a past one is not offered.
    expect(read('5 Jun 2026', 'en-GB')).toEqual([])
    expect(read('5 Jun 2027', 'en-GB')).toEqual(['2027-06-05'])
  })

  it('reads "from" and a day of a month as that day, and "to" another as the end of it', () => {
    for (const locale of ['en-GB', 'en-US']) {
      const read = (text: string) =>
        findMailDates(text, '2026-11-18T10:00:00Z', { timeZone: ZONE, locale }).map((date) => ({
          text: text.slice(date.index, date.index + date.length),
          start: date.start,
          end: date.end,
        }))
      expect(read('Off from 20 Dec'), locale).toEqual([
        { text: '20 Dec', start: { date: '2026-12-20' }, end: undefined },
      ])
      expect(read('from 1 Dec')[0]?.start, locale).toEqual({ date: '2026-12-01' })
      expect(read('Away from 20 Dec to 5 Jan'), locale).toEqual([
        { text: '20 Dec to 5 Jan', start: { date: '2026-12-20' }, end: { date: '2027-01-05' } },
      ])
      // A span of days in one month, however it is joined.
      for (const span of ['20–22', '20 - 22', '20 to 22'])
        expect(read(`The conference runs from ${span} Nov`), `${span} (${locale})`).toEqual([
          { text: `${span} Nov`, start: { date: '2026-11-20' }, end: { date: '2026-11-22' } },
        ])
      // Gone by: the past rule drops it whole.
      expect(read('Thanks for the notes from 20 Oct.'), locale).toEqual([])
      expect(read('from 1 Oct to 5 Oct'), locale).toEqual([])
      expect(read('from 1–5 Oct'), locale).toEqual([])
      // Without a month, "from" and two numbers are hours.
      expect(read('I work from 9 to 5')[0]?.start, locale).toEqual({
        date: '2026-11-19',
        time: '09:00',
      })
    }
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
  const found = markMailDates(doc, SENT, READER, 'Create event')
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
