// Date pattern detector — preserves the source format and extrapolates by
// day / week / month / year step.
//
// We parse each source string with a small set of regex-based parsers, each
// of which exposes a `format()` function that puts a (y, m, d) tuple back
// into the original shape.  Detection picks the parser that matches every
// source cell, then classifies the step:
//
//   - daily      (1-day jumps)
//   - weekly     (7-day jumps)
//   - monthly    (same day-of-month, month++)
//   - yearly     (same day-of-month + month, year++)
//
// Format preservation matters: dragging "01-04-2025" must NOT produce
// "2025-04-02".  Each parser captures separator + ordering and reuses both
// on output.

import type { Detector } from './types.js'

/** A parsed source date plus the shape to print it back in. */
interface ParsedDate {
  y: number
  m: number
  d: number
  sep: string
  order: 'dmy' | 'mdy' | 'ymd'
  pad: boolean
}

interface DateParser {
  regex: RegExp
  parse(s: string): ParsedDate | null
  /** Print `d` in the source's shape (`ctx` carries separator + padding). */
  format(d: ParsedDate, ctx: ParsedDate): string
}

type StepKind = 'day' | 'week' | 'month' | 'year'

// ── Parsers (regex → {y,m,d} + format(yymmdd) back to string) ────────────

const _PAD2 = (n: number) => String(n).padStart(2, '0')

// 01-04-2025  /  01/04/2025  /  01.04.2025  — DAY first (DMY).  Frappe and
// most non-US locales default to this ordering, so we try it before MDY.
const DMY: DateParser = {
  regex: /^(\d{1,2})([\-/.])(\d{1,2})\2(\d{4})$/,
  parse(s) {
    const m = s.match(DMY.regex)
    if (!m) return null
    const d = Number(m[1]),
      mo = Number(m[3]),
      y = Number(m[4])
    return { y, m: mo, d, sep: m[2] ?? '', order: 'dmy', pad: (m[1] ?? '').length === 2 }
  },
  format(d, ctx) {
    const day = ctx.pad ? _PAD2(d.d) : String(d.d)
    const month = ctx.pad ? _PAD2(d.m) : String(d.m)
    return `${day}${ctx.sep}${month}${ctx.sep}${d.y}`
  },
}

// 04/01/2025 (US MDY) — only emit when DMY parse fails for some cell.
const MDY: DateParser = {
  regex: /^(\d{1,2})([\-/.])(\d{1,2})\2(\d{4})$/,
  parse(s) {
    const m = s.match(MDY.regex)
    if (!m) return null
    const mo = Number(m[1]),
      d = Number(m[3]),
      y = Number(m[4])
    return { y, m: mo, d, sep: m[2] ?? '', order: 'mdy', pad: (m[1] ?? '').length === 2 }
  },
  format(d, ctx) {
    const day = ctx.pad ? _PAD2(d.d) : String(d.d)
    const month = ctx.pad ? _PAD2(d.m) : String(d.m)
    return `${month}${ctx.sep}${day}${ctx.sep}${d.y}`
  },
}

// 2025-04-01 (ISO) — year first, always dashes.
const YMD: DateParser = {
  regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  parse(s) {
    const m = s.match(YMD.regex)
    if (!m) return null
    return {
      y: Number(m[1]),
      m: Number(m[2]),
      d: Number(m[3]),
      sep: '-',
      order: 'ymd',
      pad: (m[2] ?? '').length === 2,
    }
  },
  format(d, ctx) {
    const month = ctx.pad ? _PAD2(d.m) : String(d.m)
    const day = ctx.pad ? _PAD2(d.d) : String(d.d)
    return `${d.y}-${month}-${day}`
  },
}

const PARSERS = [YMD, DMY, MDY]

function _parseAll(vals: readonly string[], parser: DateParser): ParsedDate[] | null {
  const parsed: ParsedDate[] = []
  for (const v of vals) {
    const p = parser.parse(String(v))
    if (!p) return null
    parsed.push(p)
  }
  return parsed
}

// ── Step classification ─────────────────────────────────────────────────

const DAY_MS = 86_400_000

function _toUTC(d: ParsedDate): number {
  return Date.UTC(d.y, d.m - 1, d.d)
}

function _classifyStep(dates: readonly ParsedDate[]): { kind: StepKind; step: number } | null {
  if (dates.length < 2) return null
  const first = dates[0] as ParsedDate

  // When all source dates share the same day-of-month, prefer month/year
  // step over day-step.  Otherwise "01-Jan, 01-Feb" parses as a 31-day
  // step (Jan→Feb is 31 days) and clamps wrong on shorter months.
  const sameDay = dates.every((d) => d.d === first.d)
  if (sameDay) {
    const monthDiffs: number[] = []
    for (let i = 1; i < dates.length; i++) {
      const cur = dates[i] as ParsedDate
      const prev = dates[i - 1] as ParsedDate
      monthDiffs.push((cur.y - prev.y) * 12 + (cur.m - prev.m))
    }
    const stepM = monthDiffs[0] ?? 0
    if (monthDiffs.every((d) => d === stepM) && stepM !== 0) {
      if (stepM % 12 === 0) return { kind: 'year', step: stepM / 12 }
      return { kind: 'month', step: stepM }
    }
  }

  const dayDiffs: number[] = []
  for (let i = 1; i < dates.length; i++) {
    dayDiffs.push((_toUTC(dates[i] as ParsedDate) - _toUTC(dates[i - 1] as ParsedDate)) / DAY_MS)
  }
  const stepD = dayDiffs[0] ?? 0
  if (!dayDiffs.every((d) => d === stepD)) return null
  if (stepD === 0) return null
  if (stepD % 7 === 0) return { kind: 'week', step: stepD / 7 }
  return { kind: 'day', step: stepD }
}

// ── Stepping ─────────────────────────────────────────────────────────────

function _stepDate(base: ParsedDate, kind: StepKind, n: number): ParsedDate {
  if (kind === 'day' || kind === 'week') {
    const ms = (kind === 'week' ? 7 : 1) * n * DAY_MS
    const dt = new Date(_toUTC(base) + ms)
    return { ...base, y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
  }
  if (kind === 'month') {
    // Anchor on the original day-of-month; clamp at month length.
    const total = base.y * 12 + (base.m - 1) + n
    const y = Math.floor(total / 12),
      m = (((total % 12) + 12) % 12) + 1
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { ...base, y, m, d: Math.min(base.d, lastDay) }
  }
  if (kind === 'year') {
    const y = base.y + n
    const lastDay = new Date(Date.UTC(y, base.m, 0)).getUTCDate()
    return { ...base, y, d: Math.min(base.d, lastDay) }
  }
  return base
}

// ── Detector ─────────────────────────────────────────────────────────────

export const dateDetector: Detector = {
  detect(values) {
    for (const parser of PARSERS) {
      const dates = _parseAll(values, parser)
      if (!dates) continue
      const step = _classifyStep(dates)
      if (!step) {
        // Single-cell date → daily step of 1 (matches Google Sheets).
        if (dates.length === 1) {
          const only = dates[0] as ParsedDate
          return {
            kind: 'date',
            confidence: 0.9,
            next(offset, dir = 1) {
              const next = _stepDate(only, 'day', dir * offset)
              return parser.format(next, only)
            },
          }
        }
        return null
      }
      const anchorFwd = dates[dates.length - 1] as ParsedDate
      const anchorBack = dates[0] as ParsedDate
      const sign = step.step >= 0 ? 1 : -1
      return {
        kind: 'date',
        confidence: 0.95,
        _meta: step,
        next(offset, dir = 1) {
          const a = dir > 0 ? anchorFwd : anchorBack
          const next = _stepDate(a, step.kind, dir * offset * Math.abs(step.step) * sign)
          return parser.format(next, a)
        },
      }
    }
    return null
  },
}
