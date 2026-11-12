// Named-sequence detector — day names, month names, both full and short.
//
// The detector matches each source value to a known sequence, classifies the
// step (forward N positions), and extrapolates with wrap-around.  Case is
// preserved per cell so dragging "monday, tuesday" produces lowercase output
// and "Mon, Tue" produces title-case.

import type { Detector } from './types.js'

interface NamedSequence {
  name: string
  items: readonly string[]
}

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const SEQUENCES: readonly NamedSequence[] = [
  { name: 'days-full', items: FULL_DAYS },
  { name: 'days-short', items: SHORT_DAYS },
  { name: 'months-full', items: FULL_MONTHS },
  { name: 'months-short', items: SHORT_MONTHS },
]

function _indexOf(seq: NamedSequence, value: string): number {
  const lc = String(value).toLowerCase()
  for (let i = 0; i < seq.items.length; i++) {
    if (seq.items[i]?.toLowerCase() === lc) return i
  }
  return -1
}

function _classify(seq: NamedSequence, indices: readonly number[]): { step: number } | null {
  if (indices.length === 1) return { step: 1 } // single value → step 1
  const len = seq.items.length
  // Allow wrap-around: difference can be (next - cur) or +len for forward.
  const first = ((indices[1] ?? 0) - (indices[0] ?? 0) + len) % len || len
  for (let i = 2; i < indices.length; i++) {
    const d = ((indices[i] ?? 0) - (indices[i - 1] ?? 0) + len) % len || len
    if (d !== first) return null
  }
  // Negative-step detection — if every actual diff < 0 in raw terms,
  // invert to a backward step.  Otherwise forward.
  const rawDiff = (indices[1] ?? 0) - (indices[0] ?? 0)
  if (rawDiff < 0 && Math.abs(rawDiff) < len / 2) {
    return { step: rawDiff }
  }
  return { step: first }
}

// Preserve the case shape of the source value when emitting a sequence item.
function _matchCase(template: string, value: string): string {
  if (template === template.toUpperCase()) return value.toUpperCase()
  if (template === template.toLowerCase()) return value.toLowerCase()
  // Title case is the dictionary form — return as-is.
  return value
}

export const namedSequenceDetector: Detector = {
  detect(values) {
    for (const seq of SEQUENCES) {
      const idx = values.map((v) => _indexOf(seq, v))
      if (idx.some((i) => i < 0)) continue
      const cls = _classify(seq, idx)
      if (!cls) return null
      const len = seq.items.length
      const anchorFwd = { i: idx[idx.length - 1] ?? 0, src: values[values.length - 1] ?? '' }
      const anchorBack = { i: idx[0] ?? 0, src: values[0] ?? '' }
      return {
        kind: 'named-sequence',
        confidence: 0.95,
        _meta: { seq: seq.name },
        next(offset, dir = 1) {
          const a = dir > 0 ? anchorFwd : anchorBack
          const next = (((a.i + dir * offset * cls.step) % len) + len) % len
          return _matchCase(a.src, seq.items[next] ?? '')
        },
      }
    }
    return null
  },
}
