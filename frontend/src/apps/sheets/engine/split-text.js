// Split-text-to-columns engine.
//
// parseRow(text, sep)    → array of tokens from one cell, with CSV-style
//                          quoting so "a,b",c yields ['a,b', 'c'].
// detectSeparator(rows)  → picks a separator from a fixed priority list by
//                          looking for the one that produces the most
//                          consistent multi-token split across the column.
//
// All pure — no DOM, no Vue, no engines.  SheetEditor wraps the result with
// op-logging + history bookkeeping.

const _SEP_LITERAL = {
	tab:       '\t',
	comma:     ',',
	semicolon: ';',
	pipe:      '|',
	space:     ' ',
	period:    '.',
}

// Auto-detect tries these in order — first one that produces >1 token in at
// least one cell wins.  Tab and comma rank highest because they're the
// dominant CSV-paste separators.
const _AUTO_PRIORITY = ['tab', 'comma', 'semicolon', 'pipe', 'space']

export function parseRow(text, separator) {
	if (text == null) return ['']
	const s = String(text)
	if (separator === '' || separator == null) return [s]
	// Single-character separators run through the CSV parser to honour
	// quotes.  Multi-char custom separators get a simple split — quoting is
	// undefined for those.
	if (separator.length === 1) return _parseCsv(s, separator)
	return s.split(separator)
}

// Minimal CSV row parser — handles double-quoted fields and escaped quotes
// (`""`) within them.  Designed for ONE row at a time; line breaks are
// preserved inside quotes but the function does not split rows on \n.
function _parseCsv(s, sep) {
	const out = []
	let cur = '', inQ = false
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (inQ) {
			if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; continue }
			if (c === '"') { inQ = false; continue }
			cur += c
		} else {
			if (c === '"') { inQ = true; continue }
			if (c === sep) { out.push(cur); cur = ''; continue }
			cur += c
		}
	}
	out.push(cur)
	return out
}

// Score a separator against the column.  Higher = better split — counted as
// the total number of "extra" tokens beyond 1 per cell.  Zero means nothing
// to split.
function _scoreSeparator(values, sepKey) {
	const lit = _SEP_LITERAL[sepKey]
	let extras = 0
	for (const v of values) {
		if (v == null || v === '') continue
		const toks = parseRow(v, lit)
		extras += Math.max(0, toks.length - 1)
	}
	return extras
}

function detectSeparator(values) {
	for (const key of _AUTO_PRIORITY) {
		if (_scoreSeparator(values, key) > 0) return key
	}
	return null
}

// Resolve a separator selection ('auto' / named key / literal custom string)
// to the literal string used by parseRow.  Returns null when 'auto' produces
// no detection (caller falls back to no-op).
export function resolveSeparator(values, choice) {
	if (choice && choice.kind === 'custom') return choice.value || null
	if (choice === 'auto') {
		const key = detectSeparator(values)
		return key ? _SEP_LITERAL[key] : null
	}
	return _SEP_LITERAL[choice] || null
}
