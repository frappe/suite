import { casual, type ParsedResult } from 'chrono-node/en'
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
// "on 20 Nov", "at 3pm": the word before is the sentence's, not the date's.
const LEAD = /^(?:on|at)\s+/i
// A weekday standing for the day must be spelled out: "sat", "the Sun" and "this weekend" aren't.
const WEEKDAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i
// Its short form only with a clock time beside it: "Thu 3pm".
const SHORT_WEEKDAY = /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/
// "3/4", "1/2", "24/7", "4/5": as often a fraction or a ratio as a day, unless a year or a time
// says which.
const SLASH_TAG = 'parser/SlashDateFormatParser'
// The line a reply's quoted trail starts with, however a client wraps it, and Outlook's header:
// its date is the quoted mail's, not one the writer proposes.
const ATTRIBUTIONS = [
  /(?:^|\n)[ \t]*On\s(?:[^\n]{0,200}\n){0,2}?[^\n]{0,200}?\bwrote\s*:/g,
  /^[ \t]*(?:Sent|Date):.*$/gim,
]

/**
 * The dates and times in `text`, read as the mail's writer meant them: "tomorrow" and "Thursday"
 * from `sentAt` (a UTC timestamp) on, in `timeZone`, the reader's zone. A date before the day it
 * was sent is the past, and not offered. An hour without am or pm is a working hour (1–7 the
 * afternoon, 8–11 the morning). A time with a zone of its own ("3pm EST") is moved into the
 * reader's.
 */
export function findMailDates(text: string, sentAt: string, timeZone: string): NamedDate[] {
  const sentUtc = dayjs.utc(sentAt)
  if (!text || !sentUtc.isValid()) return []
  const sent = sentUtc.tz(timeZone)
  const reference = { instant: sentUtc.toDate(), timezone: sent.utcOffset() }
  const sentDay = sent.format('YYYY-MM-DD')
  // Read again without looking forward, to tell "20 Oct" in a November mail (last month's) from a
  // date to come: looking forward moves the first to next year.
  const asWritten = new Map(casual.parse(text, reference).map((result) => [result.index, result]))
  const attributions = ATTRIBUTIONS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length]),
  )
  const within = (result: ParsedResult) =>
    attributions.some(([from, to]) => result.index < to && result.index + result.text.length > from)
  return casual.parse(text, reference, { forwardDate: true }).flatMap((result) => {
    if (!namesADate(result) || within(result)) return []
    const { start } = result
    const written = asWritten.get(result.index)?.start
    if (start.isCertain('month') && !start.isCertain('year') && written)
      if (written.get('year') !== start.get('year')) return []
    const date = toNamedDate(result, timeZone, sent)
    return date.start.date >= sentDay ? [date] : []
  })
}

// Whether chrono's reading names a day or a time surely enough to offer: not a phrase that only
// looks like one.
const namesADate = (result: ParsedResult) => {
  const { start, text } = result
  const tags = result.tags()
  if (RELATIVE_TAGS.some((tag) => tags.has(tag)) || PAST.test(text)) return false
  const time = start.isCertain('hour')
  const day = start.isCertain('day')
  if (!time && !day && !start.isCertain('weekday')) return false // "this week", "march"
  if (tags.has(SLASH_TAG) && !start.isCertain('year') && !time) return false
  if (day || !start.isCertain('weekday') || WEEKDAY.test(text)) return true
  const clock = start.isCertain('meridiem') || /\d:\d\d/.test(text)
  return time && clock && SHORT_WEEKDAY.test(text)
}

const toNamedDate = (result: ParsedResult, timeZone: string, sent: Dayjs): NamedDate => {
  const lead = result.text.match(LEAD)?.[0].length ?? 0
  // A time with no day is the next one after the mail was sent.
  const from = moment(result.start, timeZone, (time) =>
    time >= sent.format('HH:mm')
      ? sent.format('YYYY-MM-DD')
      : sent.add(1, 'day').format('YYYY-MM-DD'),
  )
  // A range's end is on its start's day unless it names its own.
  const until = result.end && moment(result.end, timeZone, () => from.date)
  return {
    index: result.index + lead,
    length: result.text.length - lead,
    start: from,
    ...(until && endsAfter(from, until) && { end: until }),
  }
}

const pad = (value: number | null) => String(value ?? 0).padStart(2, '0')

// As the text spells it, which chrono reads in the reader's zone; `dayFor` gives the day of a time
// that names none. Only a time given with a zone of its own goes through its instant, to land on
// the reader's clock.
const moment = (
  components: ParsedResult['start'],
  timeZone: string,
  dayFor: (time: string) => string,
): MailMoment => {
  const named = `${pad(components.get('year'))}-${pad(components.get('month'))}-${pad(components.get('day'))}`
  if (!components.isCertain('hour')) return { date: named }
  const written = components.get('hour') ?? 0
  const hour =
    !components.isCertain('meridiem') && written >= 1 && written <= 7 ? written + 12 : written
  const time = `${pad(hour)}:${pad(components.get('minute'))}`
  const date = components.isCertain('day') || components.isCertain('weekday') ? named : dayFor(time)
  if (!components.isCertain('timezoneOffset')) return { date, time }
  const at = dayjs
    .utc(`${date}T${time}`)
    .subtract(components.get('timezoneOffset') ?? 0, 'minute')
    .tz(timeZone)
  return { date: at.format('YYYY-MM-DD'), time: at.format('HH:mm') }
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
  timeZone: string,
  label: string,
): NamedDate[] {
  const body = doc.body
  if (!body) return []
  body
    .querySelectorAll(`[${MAIL_DATE_ATTRIBUTE}]`)
    .forEach((element) => element.removeAttribute(MAIL_DATE_ATTRIBUTE))
  const trail = new Set(findQuoteRoots(doc))
  // Each run is text that reads on: within one block, and unbroken by a line break, an image or
  // anything skipped. The walker never hands back what it rejects, so it says when it has.
  const runs: Text[][] = [[]]
  let broken = false
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof Element && (trail.has(node) || node.matches(SKIPPED))) {
        broken = true
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let block: Element = body
  let scanned = 0
  for (let node = walker.nextNode(); node && scanned < SCAN_LIMIT; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      if (!(node instanceof Element && INLINE.has(node.tagName))) broken = true
      continue
    }
    const text = node
    const at = text.parentElement?.closest(BLOCKS) ?? body
    if (broken || at !== block) runs.push([])
    broken = false
    block = at
    runs.at(-1)!.push(text)
    scanned += text.data.length
  }

  const dates: NamedDate[] = []
  for (const run of runs) {
    if (!run.length) continue
    const text = run.map((node) => node.data).join('')
    const found = findMailDates(text, sentAt, timeZone)
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
