// Guesses a data block's shape for the chart and pivot dialogs: whether its
// first row is a header, which columns hold numbers, and which column labels
// the chart's X axis. Reads shown values (what readRange returns). Pure.

import { displayNumber } from '../utils/format-number.js'

type Row = unknown[]

export interface ColumnShape {
  idx: number
  isNumeric: boolean
}

// A column counts as numeric when at least this share of its sampled
// non-empty cells reads as a number, so a stray text cell doesn't flip it.
const NUMERIC_SHARE = 0.6
const SAMPLE_ROWS = 20

const _isEmpty = (v: unknown) => v === '' || v == null
const _isNumber = (v: unknown) => !_isEmpty(v) && !isNaN(displayNumber(v))

/** Which columns hold numbers, sampled from the rows from `bodyStart` on. */
export function columnShapes(matrix: Row[], bodyStart: number): ColumnShape[] {
  const ncols = matrix[0]?.length || 0
  const end = Math.min(matrix.length, bodyStart + SAMPLE_ROWS)
  const shapes: ColumnShape[] = []
  for (let i = 0; i < ncols; i++) {
    let numHits = 0,
      total = 0
    for (let r = bodyStart; r < end; r++) {
      const v = matrix[r]?.[i]
      if (_isEmpty(v)) continue
      total++
      if (_isNumber(v)) numHits++
    }
    shapes.push({ idx: i, isNumeric: total > 0 && numHits / total >= NUMERIC_SHARE })
  }
  return shapes
}

/**
 * Whether the first row is a header. It is when it holds text and no numbers,
 * and some column turns from text in that row to numbers below it
 * (`Score` over 10, 20, 30). A first row with a number is data. When no
 * column holds numbers there is nothing to tell them apart, and a header is
 * the common case.
 */
export function guessHasHeader(matrix: Row[]): boolean {
  if (matrix.length < 2) return false
  const first = matrix[0] || []
  if (!first.some((v) => !_isEmpty(v))) return false
  if (first.some(_isNumber)) return false
  const body = columnShapes(matrix, 1)
  if (!body.some((c) => c.isNumeric)) return true
  return body.some((c) => c.isNumeric && !_isEmpty(first[c.idx]))
}

/**
 * The default chart encoding: the first text column labels the X axis and
 * the numeric columns are the series (at most `maxSeries`). With no text
 * column, the first column is X. With no numeric column, the first other
 * column is the one series.
 */
export function guessEncoding(columns: ColumnShape[], maxSeries = 8) {
  const x = columns.find((c) => !c.isNumeric)?.idx ?? 0
  let y = columns
    .filter((c) => c.idx !== x && c.isNumeric)
    .slice(0, maxSeries)
    .map((c) => c.idx)
  if (!y.length) {
    const other = columns.find((c) => c.idx !== x)
    y = other ? [other.idx] : []
  }
  return { x, y }
}
