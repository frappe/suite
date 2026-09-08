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

// ── Parsers (regex → {y,m,d} + format(yymmdd) back to string) ────────────

const _PAD2 = n => String(n).padStart(2, '0')

// 01-04-2025  /  01/04/2025  /  01.04.2025  — DAY first (DMY).  Frappe and
// most non-US locales default to this ordering, so we try it before MDY.
const DMY = {
	regex: /^(\d{1,2})([\-/.])(\d{1,2})\2(\d{4})$/,
	parse(s) {
		const m = s.match(DMY.regex)
		if (!m) return null
		const d = +m[1], mo = +m[3], y = +m[4]
		return { y, m: mo, d, sep: m[2], order: 'dmy', pad: m[1].length === 2 }
	},
	format(d, ctx) {
		const day   = ctx.pad ? _PAD2(d.d) : String(d.d)
		const month = ctx.pad ? _PAD2(d.m) : String(d.m)
		return `${day}${ctx.sep}${month}${ctx.sep}${d.y}`
	},
}

// 04/01/2025 (US MDY) — only emit when DMY parse fails for some cell.
const MDY = {
	regex: /^(\d{1,2})([\-/.])(\d{1,2})\2(\d{4})$/,
	parse(s) {
		const m = s.match(MDY.regex)
		if (!m) return null
		const mo = +m[1], d = +m[3], y = +m[4]
		return { y, m: mo, d, sep: m[2], order: 'mdy', pad: m[1].length === 2 }
	},
	format(d, ctx) {
		const day   = ctx.pad ? _PAD2(d.d) : String(d.d)
		const month = ctx.pad ? _PAD2(d.m) : String(d.m)
		return `${month}${ctx.sep}${day}${ctx.sep}${d.y}`
	},
}

// 2025-04-01 (ISO) — year first, always dashes.
const YMD = {
	regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
	parse(s) {
		const m = s.match(YMD.regex)
		if (!m) return null
		return { y: +m[1], m: +m[2], d: +m[3], sep: '-', order: 'ymd',
		         pad: m[2].length === 2 }
	},
	format(d, ctx) {
		const month = ctx.pad ? _PAD2(d.m) : String(d.m)
		const day   = ctx.pad ? _PAD2(d.d) : String(d.d)
		return `${d.y}-${month}-${day}`
	},
}

const PARSERS = [YMD, DMY, MDY]

function _parseAll(vals, parser) {
	const parsed = []
	for (const v of vals) {
		const p = parser.parse(String(v))
		if (!p) return null
		parsed.push(p)
	}
	return parsed
}

// ── Step classification ─────────────────────────────────────────────────

const DAY_MS = 86_400_000

function _toUTC(d) { return Date.UTC(d.y, d.m - 1, d.d) }

function _classifyStep(dates) {
	if (dates.length < 2) return null

	// When all source dates share the same day-of-month, prefer month/year
	// step over day-step.  Otherwise "01-Jan, 01-Feb" parses as a 31-day
	// step (Jan→Feb is 31 days) and clamps wrong on shorter months.
	const sameDay = dates.every(d => d.d === dates[0].d)
	if (sameDay) {
		const monthDiffs = []
		for (let i = 1; i < dates.length; i++) {
			monthDiffs.push((dates[i].y - dates[i - 1].y) * 12
			              + (dates[i].m - dates[i - 1].m))
		}
		if (monthDiffs.every(d => d === monthDiffs[0]) && monthDiffs[0] !== 0) {
			const stepM = monthDiffs[0]
			if (stepM % 12 === 0) return { kind: 'year',  step: stepM / 12 }
			return { kind: 'month', step: stepM }
		}
	}

	const dayDiffs = []
	for (let i = 1; i < dates.length; i++) {
		dayDiffs.push((_toUTC(dates[i]) - _toUTC(dates[i - 1])) / DAY_MS)
	}
	if (!dayDiffs.every(d => d === dayDiffs[0])) return null
	const stepD = dayDiffs[0]
	if (stepD === 0) return null
	if (stepD % 7 === 0) return { kind: 'week', step: stepD / 7 }
	return { kind: 'day', step: stepD }
}

// ── Stepping ─────────────────────────────────────────────────────────────

function _stepDate(base, kind, n) {
	if (kind === 'day' || kind === 'week') {
		const ms = (kind === 'week' ? 7 : 1) * n * DAY_MS
		const dt = new Date(_toUTC(base) + ms)
		return { ...base, y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
	}
	if (kind === 'month') {
		// Anchor on the original day-of-month; clamp at month length.
		const total = (base.y * 12 + (base.m - 1)) + n
		const y = Math.floor(total / 12), m = (total % 12 + 12) % 12 + 1
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

export const dateDetector = {
	detect(values) {
		for (const parser of PARSERS) {
			const dates = _parseAll(values, parser)
			if (!dates) continue
			const step = _classifyStep(dates)
			if (!step) {
				// Single-cell date → daily step of 1 (matches Google Sheets).
				if (dates.length === 1) {
					return {
						kind: 'date',
						confidence: 0.9,
						next(offset, dir = 1) {
							const next = _stepDate(dates[0], 'day', dir * offset)
							return parser.format(next, dates[0])
						},
					}
				}
				return null
			}
			const anchorFwd  = dates[dates.length - 1]
			const anchorBack = dates[0]
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
