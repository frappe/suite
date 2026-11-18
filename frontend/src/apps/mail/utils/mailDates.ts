import { casual, GB, type ParsedResult } from 'chrono-node/en'
import type { Dayjs } from 'dayjs'

import dayjs from '@/apps/mail/utils/dayjs'
import { findQuoteRoots } from '@/apps/mail/utils/quotedContent'

/**
 * Dates and times a mail names in its own words, each a moment a meeting could start at.
 *
 * Kept out of the main bundle (chrono-node is large): load it with `import()` once a mail is open.
 */

/** A day, and the time on it when the mail gave one. A day alone is the whole day. */
export interface MailMoment {
  /** `YYYY-MM-DD`, in the reader's zone. */
  date: string
  /** `HH:mm`, in the reader's zone. */
  time?: string
}

export interface NamedDate {
  /** Where it sits in the text it was read from. */
  index: number
  length: number
  start: MailMoment
  /** Where a range ("3–4pm", "20–22 Nov") ends; none for a single moment. */
  end?: MailMoment
}

// "now", "in 5 minutes", "a week ago", "yesterday": said of the writing, not a time to meet.
const RELATIVE_TAGS = ['casualReference/now', 'casualReference/yesterday', 'result/relativeDate']
// Read forward, "last Friday" would land on the next one.
const PAST = /^(?:last|past|previous)\b/i
// "on 20 Nov", "at 3pm": the word before is the sentence's, not the date's; and so is a comma or a
// stop after it ("on Friday, then"), but not the stop that ends "p.m.".
const LEAD = /^(?:on|at)\s+/i
const TRAIL = /(?:[\s,;:!?]|(?<!\b[ap]\.m)\.)+$/i
// A weekday standing for the day must be spelled out: "sat", "the Sun" and "this weekend" aren't.
const WEEKDAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i
// Its short form only with a clock time beside it: "Thu 3pm".
const SHORT_WEEKDAY = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/
// "3/4", "1/2", "24/7", "4/5": as often a fraction or a ratio as a day, unless a year or a time
// says which.
const SLASH_TAG = 'parser/SlashDateFormatParser'
// A part of the day, at the hour a meeting in it starts: ours, not chrono's, which puts the
// morning at 6 and the evening at 8. "Friday night" and "tonight" are an evening's.
const PART_TIMES = { morning: '09:00', afternoon: '14:00', evening: '18:00', tonight: '18:00' }
// Said without a day, a part of the day is the mail's own only after "this": "Good morning" isn't
// one, nor is "this morning", which has mostly gone by the time anyone reads of it.
const THIS_PART = /^this\s+(?:afternoon|evening)$/i
// The line a reply's quoted trail starts with, however a client wraps it: its date is the quoted
// mail's, not one the writer proposes.
const ATTRIBUTION = /(?:^|\n)[ \t]*On\s(?:[^\n]{0,200}\n){0,2}?[^\n]{0,200}?\bwrote\s*:/g
// The header Outlook and forwards put above a quoted mail: lines like these, one after another.
const HEADER_LINE = /^[ \t]*(?:From|Sent|Date|To|Cc|Subject):/i
const HEADER_NAMES = /^[ \t]*(?:From|To|Cc|Subject):/i

/** Who reads the mail: their time zone, and the locale that says how they write a day and month. */
export interface MailReader {
  timeZone: string
  /** A BCP 47 tag, as `navigator.languages` gives it. */
  locale: string
}

// "05/06" is 6 May to a reader who writes the month first (en-US, and the year-first locales), and
// 5 June to everyone else. The locale's own short date says which it writes first.
const monthFirst = (locale: string) => {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2026, 4, 6))
  } catch {
    parts = new Intl.DateTimeFormat().formatToParts(new Date(2026, 4, 6))
  }
  const order = parts.map((part) => part.type)
  return order.indexOf('month') < order.indexOf('day')
}

/**
 * Which of `lines` belong to a quoted mail's header: two or more header lines in a row, one of
 * them a From:, To:, Cc: or Subject:. A "Date:" line of the writer's own, on its own, isn't one.
 */
const inHeader = (lines: readonly string[]): boolean[] => {
  const result = lines.map(() => false)
  let start = 0
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && HEADER_LINE.test(lines[i])) continue
    const run = lines.slice(start, i)
    if (run.length > 1 && run.some((line) => HEADER_NAMES.test(line))) result.fill(true, start, i)
    start = i + 1
  }
  return result
}

/** The stretches of `text` that are a quoted mail's header, by line. */
const headerBlocks = (text: string): [number, number][] => {
  const lines = text.split('\n')
  const header = inHeader(lines)
  let offset = 0
  return lines.flatMap<[number, number]>((line, i) => {
    const from = offset
    offset += line.length + 1
    return header[i] ? [[from, from + line.length]] : []
  })
}

/**
 * The dates and times in `text`, read as the mail's writer meant them: "tomorrow" and "Thursday"
 * from `sentAt` (a UTC timestamp) on, in the reader's zone, and "05/06" in the order the reader's
 * locale writes a day and month. A date before the day it was sent is the past, and not offered;
 * so is a day without a year that went by in the two months before it ("20 Oct" in a November
 * mail). One further back is next year's ("5 Jun" in a November mail).
 * An hour without am or pm is a working hour (1–7 the afternoon, 8–11 the morning), and a part of
 * the day is the hour a meeting in it starts ("tomorrow evening" at 18:00). A time with a zone of
 * its own ("3pm EST") is moved into the reader's.
 */
export function findMailDates(
  text: string,
  sentAt: string,
  { timeZone, locale }: MailReader,
): NamedDate[] {
  const sentUtc = dayjs.utc(sentAt)
  if (!text || !sentUtc.isValid()) return []
  const sent = sentUtc.tz(timeZone)
  const reference = { instant: sentUtc.toDate(), timezone: sent.utcOffset() }
  const sentDay = sent.format('YYYY-MM-DD')
  const chrono = monthFirst(locale) ? casual : GB
  const attributions = [
    ...[...text.matchAll(ATTRIBUTION)].map((match) => [match.index, match.index + match[0].length]),
    ...headerBlocks(text),
  ]
  const within = (result: ParsedResult) =>
    attributions.some(([from, to]) => result.index < to && result.index + result.text.length > from)
  return chrono.parse(text, reference, { forwardDate: true }).flatMap((result) => {
    if (!namesADate(result) || within(result)) return []
    const date = toNamedDate(result, timeZone, sent)
    const { start } = result
    if (start.isCertain('month') && !start.isCertain('year')) {
      const dated = inItsYear(date, sent)
      return dated ? [dated] : []
    }
    return date.start.date >= sentDay ? [date] : []
  })
}

// How long a day without a year stays one gone by, before it reads as next year's.
const RECENT_MONTHS = 2

/**
 * `date`, a day and month without a year, in the year it falls in: the next time it comes round
 * from the day the mail was sent, unless it came round in the two months before that, when it is
 * the past (undefined). One rule, whatever the format or the parser's own guess at the year.
 */
const inItsYear = (date: NamedDate, sent: Dayjs): NamedDate | undefined => {
  const sentDay = sent.format('YYYY-MM-DD')
  const monthDay = date.start.date.slice(5)
  let year = sent.year()
  if (`${year}-${monthDay}` < sentDay) year++
  if (`${year - 1}-${monthDay}` >= sent.subtract(RECENT_MONTHS, 'month').format('YYYY-MM-DD'))
    return undefined
  const years = year - Number(date.start.date.slice(0, 4))
  const shift = (moment: MailMoment): MailMoment => ({
    ...moment,
    date: dayjs(moment.date).add(years, 'year').format('YYYY-MM-DD'),
  })
  return { ...date, start: shift(date.start), ...(date.end && { end: shift(date.end) }) }
}

// Whether chrono's reading names a day or a time surely enough to offer: not a phrase that only
// looks like one.
const namesADate = (result: ParsedResult) => {
  const { start, text } = result
  const tags = result.tags()
  if (RELATIVE_TAGS.some((tag) => tags.has(tag)) || PAST.test(text)) return false
  if (partOfDay(result) && THIS_PART.test(text.replace(TRAIL, ''))) return true
  const time = start.isCertain('hour')
  const day = start.isCertain('day')
  if (!time && !day && !start.isCertain('weekday')) return false // "this week", "march"
  if (tags.has(SLASH_TAG) && !start.isCertain('year') && !time) return false
  if (day || !start.isCertain('weekday') || WEEKDAY.test(text)) return true
  const clock = start.isCertain('meridiem') || /\d:\d\d/.test(text)
  return time && clock && SHORT_WEEKDAY.test(text)
}

// The time a part of the day the text names stands for, when it names no hour.
const partOfDay = (result: ParsedResult) => {
  if (result.start.isCertain('hour')) return undefined
  const tags = result.tags()
  return Object.entries(PART_TIMES).find(([part]) => tags.has(`casualReference/${part}`))?.[1]
}

// Whether `hour` is written in `text` as a clock does, with its leading zero ("07:30", "at 05"),
// and so means what it says. "at 5", "3:30" and "Friday at 2" are a meeting's hours.
const zeroLed = (text: string, hour: number) =>
  new RegExp(
    `\\b0${hour}[:.]\\d\\d|(?:\\bat|@|\\bfrom|\\buntil|\\btill|\\bto|[-–])\\s*0${hour}\\b`,
    'i',
  ).test(text)

const toNamedDate = (result: ParsedResult, timeZone: string, sent: Dayjs): NamedDate => {
  const lead = result.text.match(LEAD)?.[0].length ?? 0
  const sentDay = sent.format('YYYY-MM-DD')
  const workingHours = (hour: number) => !zeroLed(result.text, hour)
  const part = partOfDay(result)
  const from = moment(result.start, timeZone, {
    workingHours,
    part,
    // A time with no day is the next one after the mail was sent; "this evening" is that day's.
    dayFor: (time) =>
      time >= sent.format('HH:mm') || part ? sentDay : sent.add(1, 'day').format('YYYY-MM-DD'),
    // A weekday with an hour is the next time that weekday comes round at that hour: today, when
    // it is today and the hour is still to come. Except "next Friday", whose week is chrono's, as
    // it is without an hour.
    weekday: /\bnext\b/i.test(result.text)
      ? 'as named'
      : { earliest: sent.format('YYYY-MM-DDTHH:mm') },
  })
  // A range's end is on its start's day unless it names a day of its own.
  const until =
    result.end && moment(result.end, timeZone, { workingHours, dayFor: () => from.date })
  const trail = result.text.slice(lead).match(TRAIL)?.[0].length ?? 0
  return {
    index: result.index + lead,
    length: result.text.length - lead - trail,
    start: from,
    ...(until && endsAfter(from, until) && { end: until }),
  }
}

const pad = (value: number | null) => String(value ?? 0).padStart(2, '0')

interface MomentRules {
  /** Whether an hour without am or pm is a working hour (1–7 the afternoon, 8–11 the morning). */
  workingHours: (hour: number) => boolean
  /** The day of a time that names none. */
  dayFor: (time: string) => string
  /** The time a part of the day ("tomorrow evening") stands for, when no hour is named. */
  part?: string
  /**
   * For a weekday at a time, which week: chrono's (`'as named'`), or the soonest at or after
   * `earliest` (`YYYY-MM-DDTHH:mm`). Without it, the weekday's day is `dayFor`'s.
   */
  weekday?: 'as named' | { earliest: string }
}

// As the text spells it, which chrono reads in the reader's zone. Only a time given with a zone of
// its own goes through its instant, to land on the reader's clock.
const moment = (
  components: ParsedResult['start'],
  timeZone: string,
  { workingHours, dayFor, weekday, part }: MomentRules,
): MailMoment => {
  const named = `${pad(components.get('year'))}-${pad(components.get('month'))}-${pad(components.get('day'))}`
  if (!components.isCertain('hour') && !part) return { date: named }
  const time = part ?? clockTime(components, workingHours)
  let date = named
  if (!components.isCertain('day')) {
    if (!components.isCertain('weekday') || !weekday) date = dayFor(time)
    else if (weekday !== 'as named') {
      // chrono picked the week by the hour as written; with the hour read as meant, the same
      // weekday a week sooner may still be to come.
      const sooner = dayjs(named).subtract(7, 'day').format('YYYY-MM-DD')
      if (`${sooner}T${time}` >= weekday.earliest) date = sooner
    }
  }
  if (!components.isCertain('timezoneOffset')) return { date, time }
  const at = dayjs
    .utc(`${date}T${time}`)
    .subtract(components.get('timezoneOffset') ?? 0, 'minute')
    .tz(timeZone)
  return { date: at.format('YYYY-MM-DD'), time: at.format('HH:mm') }
}

// The hour and minute the text names, an hour without am or pm read as `workingHours` says.
const clockTime = (
  components: ParsedResult['start'],
  workingHours: MomentRules['workingHours'],
) => {
  const written = components.get('hour') ?? 0
  const afternoon =
    !components.isCertain('meridiem') && written >= 1 && written <= 7 && workingHours(written)
  return `${pad(afternoon ? written + 12 : written)}:${pad(components.get('minute'))}`
}

// Only a range of the start's kind (days with days, times with times) that runs forward is one.
const endsAfter = (start: MailMoment, end: MailMoment) => {
  if (!start.time) return !end.time && end.date > start.date
  return !!end.time && `${end.date}T${end.time}` > `${start.date}T${start.time}`
}

// Never inside these: a link already does something on a click, code is not prose, the line that
// opens a quoted trail (Gmail's, Thunderbird's) dates the quoted mail, and the rest is not the
// mail's text at all.
const SKIPPED =
  'a, button, code, pre, blockquote, kbd, samp, script, style, textarea, title, svg, ' +
  '[class~="gmail_attr"], [class~="x_gmail_attr"], [class~="moz-cite-prefix"], [class~="x_moz-cite-prefix"]'
// Skipped, yet part of the line around them: a link in a header's From: line, say.
const IN_LINE_SKIPPED = 'a, button, code, kbd, samp, svg'
// Text either side of these edges does not run on, so a date can't straddle one.
const BLOCKS =
  'address, article, aside, body, center, dd, div, dl, dt, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, section, table, tbody, td, tfoot, th, thead, tr, ul'
// Inline elements a date can run through: "<b>Thursday</b> at 3pm" is one date.
const INLINE = new Set([
  'B',
  'BIG',
  'EM',
  'FONT',
  'I',
  'MARK',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'U',
])
// Enough for any letter; a long newsletter isn't read to its end.
const SCAN_LIMIT = 50_000

/**
 * The attribute a marked date carries, naming its entry in the list `markMailDates` returns: the
 * one hook the frame's click handling and styling go by. A mail must never bring its own, so the
 * sanitizer forbids it, and marking clears any that got through.
 */
const MAIL_DATE_ATTRIBUTE = 'data-mail-date'

/**
 * Marks the dates in a mail's own words in `doc`, each wrapped in `<span>`s that carry
 * `data-mail-date`, its index into the list returned. Only text is wrapped, never moved, so the
 * mail lays out and selects as it did. Links, code, blockquotes and the quoted trail are left alone.
 * A date split by inline formatting is one control: its first piece is the button, named for the
 * whole date, and `label` says what it does.
 */
export function markMailDates(
  doc: Document,
  sentAt: string,
  reader: MailReader,
  label: string,
): NamedDate[] {
  const body = doc.body
  if (!body) return []
  body
    .querySelectorAll(`[${MAIL_DATE_ATTRIBUTE}]`)
    .forEach((element) => element.removeAttribute(MAIL_DATE_ATTRIBUTE))
  const trail = new Set(findQuoteRoots(doc))
  // Each run is text that reads on: within one block, and unbroken by a line break, an image or
  // anything skipped. The walker never hands back what it rejects, so it says when it has. A run
  // also knows the line it is on, which a link inside the line doesn't end.
  const runs: { nodes: Text[]; line: number }[] = []
  let broken = false
  let newLine = true
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof Element && (trail.has(node) || node.matches(SKIPPED))) {
        broken = true
        if (!node.matches(IN_LINE_SKIPPED)) newLine = true
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let block: Element = body
  let line = -1
  let scanned = 0
  for (let node = walker.nextNode(); node && scanned < SCAN_LIMIT; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      if (!(node instanceof Element && INLINE.has(node.tagName))) broken = newLine = true
      continue
    }
    const at = node.parentElement?.closest(BLOCKS) ?? body
    if (newLine || at !== block) line++
    if (broken || at !== block || !runs.length) runs.push({ nodes: [], line })
    broken = newLine = false
    block = at
    runs.at(-1)!.nodes.push(node)
    scanned += node.data.length
  }

  // A quoted mail's header is told apart by its lines.
  const texts = runs.map((run) => run.nodes.map((node) => node.data).join(''))
  const lines: string[] = []
  runs.forEach((run, r) => (lines[run.line] = (lines[run.line] ?? '') + texts[r]))
  const header = inHeader(lines)
  const dates: NamedDate[] = []
  for (const [r, { nodes: run, line: on }] of runs.entries()) {
    if (header[on]) continue
    const text = texts[r]
    const found = findMailDates(text, sentAt, reader)
    if (!found.length) continue
    const opened = new Set<number>()
    let offset = 0
    for (const node of run) {
      const nodeStart = offset
      offset += node.data.length
      const cuts = found.flatMap((date, i) => {
        const from = Math.max(date.index, nodeStart)
        const to = Math.min(date.index + date.length, offset)
        if (from >= to) return []
        const first = !opened.has(i)
        opened.add(i)
        const name = first ? text.slice(date.index, date.index + date.length) : undefined
        return [{ from: from - nodeStart, to: to - nodeStart, id: dates.length + i, name }]
      })
      if (cuts.length) wrap(node, cuts, label)
    }
    dates.push(...found)
  }
  return dates
}

interface Cut {
  from: number
  to: number
  id: number
  /** The whole date's words, on its first piece only: the one that is the button. */
  name?: string
}

const wrap = (node: Text, cuts: Cut[], label: string) => {
  const doc = node.ownerDocument
  const fragment = doc.createDocumentFragment()
  let last = 0
  for (const { from, to, id, name } of cuts) {
    fragment.append(node.data.slice(last, from))
    const mark = doc.createElement('span')
    mark.setAttribute(MAIL_DATE_ATTRIBUTE, String(id))
    mark.title = label
    if (name === undefined) mark.setAttribute('aria-hidden', 'true')
    else {
      mark.setAttribute('role', 'button')
      mark.setAttribute('tabindex', '0')
      mark.setAttribute('aria-label', name.replace(/\s+/g, ' ').trim())
    }
    mark.textContent = node.data.slice(from, to)
    fragment.append(mark)
    last = to
  }
  fragment.append(node.data.slice(last))
  node.replaceWith(fragment)
}
