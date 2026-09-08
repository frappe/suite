// Fill-handle extrapolation — routes through the pluggable pattern pipeline
// in ./patterns.  Each source column is classified independently (numeric /
// date / named-sequence / copy fallback) and extended by the matching
// detector's next() function.

import { detectSeries } from './patterns/index.js'
import { _detectStep as numericStep, _asNumbers } from './patterns/numeric.js'

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
			useSeries
				? nums[ci] + dir * (rOff + 1) * srcCols * step
				: rowVals[ci]
		)
	)
}

// Vertical source — N rows × M cols.  Each column is detected independently.
function _fillVerticalFromCols(srcData, count, dir, mode = 'auto') {
	const srcRows = srcData.length
	const srcCols = srcData[0].length
	const colSeries = Array.from({ length: srcCols }, (_, ci) => {
		const vals = srcData.map(row => row[ci])
		// Skip detection in copy mode so the popup's "Copy cells" choice
		// reliably cycles, even when a pattern was detectable.
		const series = mode === 'copy'
			? null
			: detectSeries(vals.map(v => v == null ? '' : String(v)))
		return { vals, series }
	})
	return Array.from({ length: count }, (_, rOff) =>
		colSeries.map(({ vals, series }) => {
			if (series) return series.next(rOff + 1, dir)
			const i = dir > 0
				? (srcRows + rOff) % srcRows
				: ((srcRows - 1 - rOff) % srcRows + srcRows) % srcRows
			return vals[i]
		})
	)
}

// ── Fill RIGHT / LEFT ─────────────────────────────────────────────────────

// Returns srcRows × count.  See computeFillDown for mode semantics.
export function computeFillRight(srcData, count, dir = 1, { mode = 'auto' } = {}) {
	const srcCols = srcData[0].length
	return srcCols === 1
		? _fillHorizontalFromCol(srcData.map(r => r[0]), count, dir, mode)
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
			useSeries
				? nums[ri] + dir * (cOff + 1) * srcRows * step
				: v
		)
	)
}

// Horizontal source — each row is its own series.
function _fillHorizontalFromRows(srcData, count, dir, mode = 'auto') {
	const srcCols = srcData[0].length
	return srcData.map(rowVals => {
		const series = mode === 'copy'
			? null
			: detectSeries(rowVals.map(v => v == null ? '' : String(v)))
		return Array.from({ length: count }, (_, cOff) => {
			if (series) return series.next(cOff + 1, dir)
			const i = dir > 0
				? (srcCols + cOff) % srcCols
				: ((srcCols - 1 - cOff) % srcCols + srcCols) % srcCols
			return rowVals[i]
		})
	})
}
