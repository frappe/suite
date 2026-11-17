import { casual, type ParsedResult } from 'chrono-node/en'

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

/**
 * The dates and times in `text`, read as the mail's writer meant them: "tomorrow" and "Thursday"
 * from `sentAt` (a UTC timestamp) on, in `timeZone`, the reader's zone. A time with a zone of its
 * own ("3pm EST") is moved into the reader's.
 */
export function findMailDates(text: string, sentAt: string, timeZone: string): NamedDate[] {
  const sent = dayjs.utc(sentAt)
  if (!text || !sent.isValid()) return []
  const reference = { instant: sent.toDate(), timezone: sent.tz(timeZone).utcOffset() }
  return casual
    .parse(text, reference, { forwardDate: true })
    .flatMap((result) => toNamedDate(result, timeZone) ?? [])
}

const toNamedDate = (result: ParsedResult, timeZone: string): NamedDate | undefined => {
  const { start, end } = result
  const named = ['day', 'weekday', 'hour'] as const
  if (!named.some((component) => start.isCertain(component))) return // "this week"
  if (RELATIVE_TAGS.some((tag) => result.tags().has(tag)) || PAST.test(result.text)) return
  const lead = result.text.match(LEAD)?.[0].length ?? 0
  const from = moment(start, timeZone)
  const until = end && moment(end, timeZone)
  return {
    index: result.index + lead,
    length: result.text.length - lead,
    start: from,
    ...(until && endsAfter(from, until) && { end: until }),
  }
}

// As the text spells it, which chrono reads in the reader's zone. Only a time given with a zone of
// its own goes through its instant, to land on the reader's clock.
const moment = (components: ParsedResult['start'], timeZone: string): MailMoment => {
  const part = (unit: 'year' | 'month' | 'day' | 'hour' | 'minute') =>
    String(components.get(unit)).padStart(2, '0')
  if (!components.isCertain('hour'))
    return { date: `${part('year')}-${part('month')}-${part('day')}` }
  if (components.isCertain('timezoneOffset')) {
    const at = dayjs(components.date()).tz(timeZone)
    return { date: at.format('YYYY-MM-DD'), time: at.format('HH:mm') }
  }
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

// Only a range of the start's kind (days with days, times with times) that runs forward is one.
const endsAfter = (start: MailMoment, end: MailMoment) => {
  if (!start.time) return !end.time && end.date > start.date
  return !!end.time && `${end.date}T${end.time}` > `${start.date}T${start.time}`
}

// Never inside these: a link already does something on a click, code is not prose, and the rest
// is not the mail's text at all.
const SKIPPED = 'a, button, code, pre, blockquote, kbd, samp, script, style, textarea, title, svg'
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

/** The class a marked date carries, and the attribute naming its entry in the list returned. */
const MAIL_DATE_CLASS = 'mail-date'
const MAIL_DATE_ATTRIBUTE = 'data-mail-date'

/**
 * Marks the dates in a mail's own words in `doc`, each wrapped in a `<span>` that carries
 * `data-mail-date`, its index into the list returned. Only text is wrapped, never moved, so the
 * mail lays out and selects as it did. Links, code, blockquotes and the quoted trail are left alone.
 * `label` is what the mark says it does, for a tooltip and a screen reader.
 */
export function markMailDates(
  doc: Document,
  sentAt: string,
  timeZone: string,
  label: string,
): NamedDate[] {
  const body = doc.body
  if (!body) return []
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
    let offset = 0
    for (const node of run) {
      const nodeStart = offset
      offset += node.data.length
      const cuts = found.flatMap((date, i) => {
        const from = Math.max(date.index, nodeStart)
        const to = Math.min(date.index + date.length, offset)
        return from < to
          ? [{ from: from - nodeStart, to: to - nodeStart, id: dates.length + i }]
          : []
      })
      if (cuts.length) wrap(node, cuts, label)
    }
    dates.push(...found)
  }
  return dates
}

const wrap = (node: Text, cuts: { from: number; to: number; id: number }[], label: string) => {
  const doc = node.ownerDocument
  const fragment = doc.createDocumentFragment()
  let last = 0
  for (const { from, to, id } of cuts) {
    fragment.append(node.data.slice(last, from))
    const mark = doc.createElement('span')
    mark.className = MAIL_DATE_CLASS
    mark.setAttribute(MAIL_DATE_ATTRIBUTE, String(id))
    mark.setAttribute('role', 'button')
    mark.setAttribute('tabindex', '0')
    mark.title = label
    mark.textContent = node.data.slice(from, to)
    fragment.append(mark)
    last = to
  }
  fragment.append(node.data.slice(last))
  node.replaceWith(fragment)
}
