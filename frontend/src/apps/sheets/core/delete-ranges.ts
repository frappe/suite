// Workaround for an IronCalc bug (ISSUES #9, IronCalc 0.9.0): deleting rows
// or columns turns a range end inside the deleted span into #REF!
// (=SUM(A1:A10), delete row 1 → =SUM(#REF!:A9)), where Excel and Google
// Sheets shrink the range (=SUM(A1:A9)). Before the delete, the workbook
// moves each such end to the first row/column the delete keeps; IronCalc's
// own shift then lands it in the right place. A range with both ends inside
// the span is left to IronCalc (#REF!), as in Excel.
//
// Drop this once IronCalc shrinks ranges itself
// (base/src/expressions/parser/stringify.rs, stringify_reference).

export interface DeleteSpan {
  /** The sheet the formula sits on (a range with no sheet name points here). */
  formulaSheet: string
  /** The sheet losing rows or columns. */
  sheet: string
  axis: 'row' | 'col'
  /** First deleted row or column, 1-based. */
  at: number
  count: number
}

// A string literal ("..." with "" for a quote), or a range: an optional sheet
// name ('quoted' or bare: any letters or digits), then A1:B2, A:B or 1:2. The
// lookbehind keeps a match from starting inside a name, or after a sheet name
// the pattern didn't take (it must not fall back to the formula's sheet); the
// lookahead keeps it from ending inside a name.
const TOKEN = new RegExp(
  [
    '("(?:[^"]|"")*")',
    "(?<![\\p{L}\\p{N}_.$'!])((?:'(?:[^']|'')+'|[\\p{L}\\p{N}_][\\p{L}\\p{N}_.]*)!)?" +
      '(?:(\\$?[A-Za-z]{1,3})(\\$?\\d+):(\\$?[A-Za-z]{1,3})(\\$?\\d+)' +
      '|(\\$?[A-Za-z]{1,3}):(\\$?[A-Za-z]{1,3})' +
      '|(\\$?\\d+):(\\$?\\d+))(?![\\p{L}\\p{N}_.(!])',
  ].join('|'),
  'gu',
)

function colNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}

function colLetters(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function sheetOf(prefix: string | undefined, formulaSheet: string): string {
  if (!prefix) return formulaSheet
  const name = prefix.slice(0, -1)
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name
}

// The two ends of a range along the deleted axis, moved off the span when
// only one of them is in it.
function shrink(a: number, b: number, first: number, last: number): [number, number] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const inSpan = (n: number) => n >= first && n <= last
  if (inSpan(lo) && inSpan(hi)) return [a, b]
  const newLo = inSpan(lo) ? last + 1 : lo
  const newHi = inSpan(hi) ? first - 1 : hi
  return a <= b ? [newLo, newHi] : [newHi, newLo]
}

// '$A' or 'A' → [marker, number]; '$12' or '12' → [marker, number].
function split(part: string, letters: boolean): [string, number] {
  const abs = part.startsWith('$') ? '$' : ''
  const body = part.slice(abs.length)
  return [abs, letters ? colNumber(body) : Number(body)]
}

function shrinkPair(
  p1: string,
  p2: string,
  letters: boolean,
  first: number,
  last: number,
): [string, string] {
  const [abs1, n1] = split(p1, letters)
  const [abs2, n2] = split(p2, letters)
  const [m1, m2] = shrink(n1, n2, first, last)
  const show = (n: number) => (letters ? colLetters(n) : String(n))
  return [abs1 + show(m1), abs2 + show(m2)]
}

/**
 * The formula with every range that loses only its first or last rows
 * (columns) to the delete pulled in to the rows it keeps. Unchanged when
 * nothing needs it.
 */
export function shrinkRangesForDelete(formula: string, span: DeleteSpan): string {
  const first = span.at
  const last = span.at + span.count - 1
  const target = span.sheet.toLowerCase()
  const rows = span.axis === 'row'
  return formula.replace(TOKEN, (match, str, prefix, c1, r1, c2, r2, cc1, cc2, rr1, rr2) => {
    if (str !== undefined) return match
    if (sheetOf(prefix, span.formulaSheet).toLowerCase() !== target) return match
    const sheet = prefix ?? ''
    if (c1 !== undefined) {
      if (rows) {
        const [n1, n2] = shrinkPair(r1, r2, false, first, last)
        return `${sheet}${c1}${n1}:${c2}${n2}`
      }
      const [n1, n2] = shrinkPair(c1, c2, true, first, last)
      return `${sheet}${n1}${r1}:${n2}${r2}`
    }
    if (cc1 !== undefined) {
      if (rows) return match
      const [n1, n2] = shrinkPair(cc1, cc2, true, first, last)
      return `${sheet}${n1}:${n2}`
    }
    if (!rows) return match
    const [n1, n2] = shrinkPair(rr1, rr2, false, first, last)
    return `${sheet}${n1}:${n2}`
  })
}
