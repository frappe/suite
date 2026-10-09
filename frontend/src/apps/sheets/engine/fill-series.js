// Fill-handle extrapolation — routes through the pluggable pattern pipeline
// in ./patterns.  Each source column is classified independently (numeric /
// date / named-sequence / copy fallback) and extended by the matching
// detector's next() function.

import { cellId } from '../utils/cells.js'
import { adjustFormula } from './formula-adjust.js'
import { detectSeries } from './patterns/index.js'
import { _asNumbers, _detectStep as numericStep } from './patterns/numeric.js'

// ── Fill DOWN / UP ────────────────────────────────────────────────────────

// srcData: srcRows × srcCols.  Returns count × srcCols of fill values.
// dir   = +1 → fill downward (after the source); -1 → fill upward.
// mode  = 'auto'   (default) — series if a pattern is detected, else copy
//       | 'series'           — force series; fall back to copy if no pattern
//       | 'copy'             — always cycle the source
export function computeFillDown(srcData, count, dir = 1, { mode = 'auto' } = {}) {
  return srcData.length === 1
    ? _fillVerticalFromRow(srcData[0], count, dir, mode)
    : _fillVerticalFromCols(srcData, count, dir, mode)
}

// Horizontal source — one row of N cols.  We compute the "next" along the
// row's own series, but jumped by `cols * step`-equivalents per filled row.
// Numeric path mirrors the legacy behaviour; everything else falls back to
// repeating the row.
function _fillVerticalFromRow(rowVals, count, dir, mode = 'auto') {
  const nums = _asNumbers(rowVals)
  const step = nums ? numericStep(nums) : null
  const srcCols = rowVals.length
  const useSeries = mode === 'copy' ? false : step !== null
  return Array.from({ length: count }, (_, rOff) =>
    Array.from({ length: srcCols }, (_, ci) =>
      useSeries ? nums[ci] + dir * (rOff + 1) * srcCols * step : rowVals[ci],
    ),
  )
}

// Vertical source — N rows × M cols.  Each column is detected independently.
function _fillVerticalFromCols(srcData, count, dir, mode = 'auto') {
  const srcRows = srcData.length
  const srcCols = srcData[0].length
  const colSeries = Array.from({ length: srcCols }, (_, ci) => {
    const vals = srcData.map((row) => row[ci])
    // Skip detection in copy mode so the popup's "Copy cells" choice
    // reliably cycles, even when a pattern was detectable.
    const series =
      mode === 'copy' ? null : detectSeries(vals.map((v) => (v == null ? '' : String(v))))
    return { vals, series }
  })
  return Array.from({ length: count }, (_, rOff) =>
    colSeries.map(({ vals, series }) => {
      if (series) return series.next(rOff + 1, dir)
      const i =
        dir > 0
          ? (srcRows + rOff) % srcRows
          : (((srcRows - 1 - rOff) % srcRows) + srcRows) % srcRows
      return vals[i]
    }),
  )
}

// ── Fill RIGHT / LEFT ─────────────────────────────────────────────────────

// Returns srcRows × count.  See computeFillDown for mode semantics.
export function computeFillRight(srcData, count, dir = 1, { mode = 'auto' } = {}) {
  const srcCols = srcData[0].length
  return srcCols === 1
    ? _fillHorizontalFromCol(
        srcData.map((r) => r[0]),
        count,
        dir,
        mode,
      )
    : _fillHorizontalFromRows(srcData, count, dir, mode)
}

// Single-column vertical source extended horizontally — numeric path uses a
// cross-row step jump per legacy behaviour; non-numeric repeats.
function _fillHorizontalFromCol(colVals, count, dir, mode = 'auto') {
  const nums = _asNumbers(colVals)
  const step = nums ? numericStep(nums) : null
  const useSeries = mode === 'copy' ? false : step !== null
  const srcRows = colVals.length
  return colVals.map((v, ri) =>
    Array.from({ length: count }, (_, cOff) =>
      useSeries ? nums[ri] + dir * (cOff + 1) * srcRows * step : v,
    ),
  )
}

// Horizontal source — each row is its own series.
function _fillHorizontalFromRows(srcData, count, dir, mode = 'auto') {
  const srcCols = srcData[0].length
  return srcData.map((rowVals) => {
    const series =
      mode === 'copy' ? null : detectSeries(rowVals.map((v) => (v == null ? '' : String(v))))
    return Array.from({ length: count }, (_, cOff) => {
      if (series) return series.next(cOff + 1, dir)
      const i =
        dir > 0
          ? (srcCols + cOff) % srcCols
          : (((srcCols - 1 - cOff) % srcCols) + srcCols) % srcCols
      return rowVals[i]
    })
  })
}

// ── Fill plan ─────────────────────────────────────────────────────────────

// The cells a fill-handle drag from `src` to `total` writes, as a
// {cellId: input} map. `inputAt(r, c)` reads the cell's current input
// (0-based). Formulas shift their references by how far they moved.
//
// A diagonal drag fills vertically first, then spreads the grown columns
// sideways, so the off-axis block is filled too.
export function planFill(src, total, inputAt, mode = 'auto') {
  const writes = {}
  const at = (r, c) => {
    const id = cellId(r, c)
    return id in writes ? writes[id] : inputAt(r, c)
  }
  const readGrid = (s) => {
    const data = []
    for (let r = s.r0; r <= s.r1; r++) {
      const row = []
      for (let c = s.c0; c <= s.c1; c++) row.push(at(r, c))
      data.push(row)
    }
    return data
  }
  const put = (r, c, val) => {
    writes[cellId(r, c)] = val == null ? '' : String(val)
  }
  const goDown = total.r1 > src.r1,
    goUp = total.r0 < src.r0
  const goRight = total.c1 > src.c1,
    goLeft = total.c0 < src.c0

  let workSrc = src
  const srcCols = src.c1 - src.c0 + 1
  if (goDown || goUp) {
    const srcRows = src.r1 - src.r0 + 1
    const count = goDown ? total.r1 - src.r1 : src.r0 - total.r0
    const dir = goDown ? 1 : -1
    const filled = computeFillDown(readGrid(src), count, dir, { mode })
    const startR = goDown ? src.r1 + 1 : total.r0
    filled.forEach((row, rOff) =>
      row.forEach((val, cOff) => {
        if (typeof val === 'string' && val.startsWith('=')) {
          const srcRowOff =
            dir > 0 ? rOff % srcRows : (((srcRows - 1 - rOff) % srcRows) + srcRows) % srcRows
          val = adjustFormula(val, startR + rOff - (src.r0 + srcRowOff), 0)
        }
        put(startR + rOff, src.c0 + cOff, val)
      }),
    )
    workSrc = {
      r0: Math.min(src.r0, total.r0),
      r1: Math.max(src.r1, total.r1),
      c0: src.c0,
      c1: src.c1,
    }
  }
  if (goRight || goLeft) {
    const count = goRight ? total.c1 - workSrc.c1 : workSrc.c0 - total.c0
    const dir = goRight ? 1 : -1
    const filled = computeFillRight(readGrid(workSrc), count, dir, { mode })
    const startC = goRight ? workSrc.c1 + 1 : total.c0
    filled.forEach((row, rOff) =>
      row.forEach((val, cOff) => {
        if (typeof val === 'string' && val.startsWith('=')) {
          const srcColOff =
            dir > 0 ? cOff % srcCols : (((srcCols - 1 - cOff) % srcCols) + srcCols) % srcCols
          val = adjustFormula(val, 0, startC + cOff - (workSrc.c0 + srcColOff))
        }
        put(workSrc.r0 + rOff, startC + cOff, val)
      }),
    )
  }
  return writes
}
