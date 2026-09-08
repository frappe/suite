// Alphabetic letter-sequence detector.
//
// Single or multi-letter "columns" like spreadsheet column labels:
//   A, B, C, …, Z, AA, AB, …, AZ, BA, …
//
// Treated as a base-26 integer (A=1) so wrap-around past Z works.  Step >1
// supported ("A, C" → "E").  Case preserved per source.

function _alphaIndex(s) {
	if (!/^[A-Za-z]+$/.test(s)) return null
	let n = 0
	const upper = s.toUpperCase()
	for (let i = 0; i < upper.length; i++) {
		const code = upper.charCodeAt(i) - 64    // 'A' → 1
		n = n * 26 + code
	}
	return n
}

function _indexToAlpha(n) {
	// Inverse of _alphaIndex — spreadsheet-style A=1 base-26 (no zero).
	if (n <= 0) return ''
	let s = ''
	while (n > 0) {
		const rem = (n - 1) % 26
		s = String.fromCharCode(65 + rem) + s
		n = Math.floor((n - 1) / 26)
	}
	return s
}

function _matchCase(template, value) {
	if (template === template.toLowerCase()) return value.toLowerCase()
	if (template === template.toUpperCase()) return value.toUpperCase()
	return value   // mixed or title-case → leave the canonical upper-case form
}

function _stepFor(indices) {
	if (indices.length === 1) return 1
	const step = indices[1] - indices[0]
	for (let i = 2; i < indices.length; i++) {
		if (indices[i] - indices[i - 1] !== step) return null
	}
	return step
}

export const alphabeticDetector = {
	detect(values) {
		// Only fire for short letter tokens (column-label / quarter-letter
		// style).  3+ characters is almost always a word — "foo, bar" should
		// fall through to copy, not produce nonsense like "wcr".
		if (values.some(v => String(v).length > 2)) return null
		const idx = []
		for (const v of values) {
			const i = _alphaIndex(String(v))
			if (i === null || i === 0) return null
			idx.push(i)
		}
		if (idx.length < 1) return null
		const step = _stepFor(idx)
		if (step === null) return null
		// All-zero step means identical letters — copy mode is the right fallback.
		if (step === 0) return null
		const anchorFwd  = { i: idx[idx.length - 1], src: String(values[values.length - 1]) }
		const anchorBack = { i: idx[0],              src: String(values[0]) }
		return {
			kind: 'alphabetic',
			confidence: 0.85,
			next(offset, dir = 1) {
				const a = dir > 0 ? anchorFwd : anchorBack
				const target = a.i + dir * offset * step
				if (target <= 0) return ''
				return _matchCase(a.src, _indexToAlpha(target))
			},
		}
	},
}
