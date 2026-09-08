// Text-with-embedded-numbers detector.
//
// Tokenises each source cell into alternating literal segments and integer
// tokens.  Cells must share the same skeleton (same literals in the same
// positions, same number of integer tokens) — otherwise the pattern isn't
// stable and we return null so a coarser detector can take over.
//
// Each integer slot is treated as its own arithmetic progression.  At least
// one slot must advance; if all integer slots are constant the cells are
// pure repeats and the caller defaults to copy mode.
//
// Zero-padding is preserved per slot — "Product-001, Product-002" extends to
// "Product-003" not "Product-3".

const _INT_RX = /\d+/g

function _tokenize(s) {
	const out = []
	let last = 0
	let m
	_INT_RX.lastIndex = 0
	while ((m = _INT_RX.exec(s)) !== null) {
		if (m.index > last) out.push({ kind: 'lit', value: s.slice(last, m.index) })
		out.push({ kind: 'num', value: +m[0], pad: m[0].length, raw: m[0] })
		last = m.index + m[0].length
	}
	if (last < s.length) out.push({ kind: 'lit', value: s.slice(last) })
	return out
}

function _skeletonMatches(a, b) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i].kind !== b[i].kind) return false
		if (a[i].kind === 'lit' && a[i].value !== b[i].value) return false
	}
	return true
}

function _stepFor(values) {
	if (values.length < 2) return 1   // single-cell case — Google defaults to +1
	const step = values[1] - values[0]
	for (let i = 2; i < values.length; i++) {
		if (values[i] - values[i - 1] !== step) return null
	}
	return step
}

export const textNumberDetector = {
	detect(values) {
		if (values.length === 0) return null
		const tokens = values.map(_tokenize)
		// Must have BOTH a literal and an integer to qualify as "text+number".
		// Pure-number strings fall through to numeric; pure-text falls through
		// to alphabetic / copy.
		const hasNum = tokens[0].some(t => t.kind === 'num')
		const hasLit = tokens[0].some(t => t.kind === 'lit')
		if (!hasNum || !hasLit) return null
		for (let i = 1; i < tokens.length; i++) {
			if (!_skeletonMatches(tokens[0], tokens[i])) return null
		}
		// Compute a step for each numeric slot — if any slot is non-arithmetic
		// we reject so the user doesn't get garbage at the tail.
		const numIdx = []
		for (let i = 0; i < tokens[0].length; i++)
			if (tokens[0][i].kind === 'num') numIdx.push(i)

		const stepsBySlot = []
		for (const i of numIdx) {
			const colVals = tokens.map(t => t[i].value)
			const step = _stepFor(colVals)
			if (step === null) return null
			stepsBySlot.push(step)
		}
		// At least one slot must actually advance.  All-zero steps means the
		// cells were identical — copy mode is the better default.
		if (stepsBySlot.every(s => s === 0)) return null

		const anchorFwd  = tokens[tokens.length - 1]
		const anchorBack = tokens[0]

		return {
			kind: 'text-number',
			confidence: 0.8,
			next(offset, dir = 1) {
				const a = dir > 0 ? anchorFwd : anchorBack
				const out = []
				let slotIdx = 0
				for (const tok of a) {
					if (tok.kind === 'lit') { out.push(tok.value); continue }
					const step = stepsBySlot[slotIdx++]
					const nextVal = tok.value + dir * offset * step
					out.push(_padNum(nextVal, tok.pad))
				}
				return out.join('')
			},
		}
	},
}

function _padNum(n, pad) {
	const sign = n < 0 ? '-' : ''
	const abs  = Math.abs(n)
	const s    = String(abs)
	if (pad <= s.length) return sign + s
	return sign + '0'.repeat(pad - s.length) + s
}
