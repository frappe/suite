// Heuristic "Smart Fill" — pattern detection over 1-2 example rows + adjacent
// source columns. Sister feature to Excel's Flash Fill / Sheets' Smart Fill,
// without an LLM in the loop.
//
// API
// ───
//   detectPattern(examples)
//     examples: Array<{ target: any, sources: any[] }>
//     returns: a `Pattern` object or null (no pattern found)
//
//   applyPattern(pattern, sources)
//     sources: any[] — values from one row's source columns
//     returns: the inferred target value, or null if not applicable
//
// Detected pattern kinds (in priority order, most-specific first):
//   * literal       — every target identical
//   * case          — target = UPPER/LOWER/PROPER of one source column
//   * word          — target = first/last/Nth whitespace-separated word
//   * email-part    — target = local-part or domain-part of an email
//   * substring     — target = LEFT(src, n) / RIGHT(src, n) / MID(src, s, l)
//   * concat        — target = sources joined with a consistent separator
//   * column-copy   — target = one source column verbatim
//
// We sample only the first 4 examples (Sheets uses a similar shallow window).
// Adding more rarely changes the detection and slows things down on big sheets.

/** One example row: the value the user typed and that row's source cells. */
export interface SmartFillExample {
  target: unknown
  sources?: unknown[]
}

type CaseTransform = 'upper' | 'lower' | 'proper'
type WordPosition = 'first' | 'last' | number
type EmailPart = 'local' | 'domain'

export type Pattern =
  | { type: 'literal'; value: unknown }
  | { type: 'column-copy'; col: number }
  | { type: 'case'; col: number; transform: CaseTransform }
  | { type: 'word'; col: number; position: WordPosition }
  | { type: 'email-part'; col: number; part: EmailPart }
  | { type: 'substring'; col: number; from: 'left' | 'right'; start: number; length: number }
  | { type: 'concat'; cols: number[]; sep: string }

const MAX_SAMPLES = 4

export function detectPattern(
  examples: readonly (SmartFillExample | null | undefined)[] | null | undefined,
): Pattern | null {
  const sample = (examples || [])
    .filter(
      (e): e is SmartFillExample =>
        !!e && e.target !== undefined && e.target !== null && e.target !== '',
    )
    .slice(0, MAX_SAMPLES)
  if (!sample.length) return null

  // Try detectors in order of specificity.
  return (
    _detectLiteral(sample) ||
    _detectColumnCopy(sample) ||
    _detectCase(sample) ||
    _detectEmailPart(sample) ||
    _detectWord(sample) ||
    _detectSubstring(sample) ||
    _detectConcat(sample)
  )
}

/**
 * Apply a previously-detected pattern to a fresh row of source values.
 * Returns `null` if the pattern's prerequisites aren't satisfied (e.g. a
 * required source column is empty); callers treat null as "skip this row".
 */
export function applyPattern(pattern: Pattern | null | undefined, sources: unknown) {
  if (!pattern) return null
  switch (pattern.type) {
    case 'literal':
      return pattern.value
    case 'column-copy':
      return _safeGet(sources, pattern.col)
    case 'case':
      return _applyCase(_safeGet(sources, pattern.col), pattern.transform)
    case 'word':
      return _applyWord(_safeGet(sources, pattern.col), pattern.position)
    case 'email-part':
      return _applyEmail(_safeGet(sources, pattern.col), pattern.part)
    case 'substring':
      return _applySubstring(
        _safeGet(sources, pattern.col),
        pattern.start,
        pattern.length,
        pattern.from,
      )
    case 'concat':
      return _applyConcat(sources, pattern.cols, pattern.sep)
    default:
      return null
  }
}

// ── Detectors ────────────────────────────────────────────────────────────────
// Every detector gets a non-empty sample (detectPattern returns early
// otherwise), so `samples[0]` is always there.

function _first(samples: readonly SmartFillExample[]) {
  return samples[0] as SmartFillExample
}

function _detectLiteral(samples: readonly SmartFillExample[]): Pattern | null {
  const first = String(_first(samples).target)
  if (samples.every((s) => String(s.target) === first)) {
    return { type: 'literal', value: _first(samples).target }
  }
  return null
}

// "Just copy column N verbatim". Used when only one source equals the target
// across all examples and no other pattern would explain it.
function _detectColumnCopy(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  for (let c = 0; c < ncols; c++) {
    if (samples.every((s) => String(_safeGet(s.sources, c)) === String(s.target))) {
      return { type: 'column-copy', col: c }
    }
  }
  return null
}

function _detectCase(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  for (let c = 0; c < ncols; c++) {
    for (const transform of ['upper', 'lower', 'proper'] as const) {
      const ok = samples.every((s) => {
        const src = _safeGet(s.sources, c)
        if (src == null || src === '') return false
        return _applyCase(src, transform) === String(s.target)
      })
      if (ok) return { type: 'case', col: c, transform }
    }
  }
  return null
}

function _detectWord(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  for (let c = 0; c < ncols; c++) {
    // `first` / `last` are the common cases; also try Nth for n in 0..3.
    for (const position of ['first', 'last', 0, 1, 2, 3] as const) {
      const ok = samples.every((s) => {
        const v = _applyWord(_safeGet(s.sources, c), position)
        return v != null && v === String(s.target)
      })
      if (ok) return { type: 'word', col: c, position }
    }
  }
  return null
}

function _detectEmailPart(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  for (let c = 0; c < ncols; c++) {
    for (const part of ['local', 'domain'] as const) {
      const ok = samples.every((s) => {
        const src = _safeGet(s.sources, c)
        if (typeof src !== 'string' || !src.includes('@')) return false
        return _applyEmail(src, part) === String(s.target)
      })
      if (ok) return { type: 'email-part', col: c, part }
    }
  }
  return null
}

// LEFT(src, n) / RIGHT(src, n) / MID(src, start, len). We try the
// shortest-fixed-position interpretation that's consistent across examples.
function _detectSubstring(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  for (let c = 0; c < ncols; c++) {
    const firstSrc = String(_safeGet(_first(samples).sources, c) ?? '')
    const firstTgt = String(_first(samples).target)
    if (!firstSrc || !firstTgt) continue
    // Try LEFT(_, n) for n in [1 .. firstSrc.length]
    for (let n = 1; n <= firstSrc.length; n++) {
      if (firstSrc.slice(0, n) !== firstTgt.slice(0, n)) break // diverges → bail
      if (firstSrc.slice(0, n) === firstTgt) {
        const ok = samples.every((s) => {
          const src = String(_safeGet(s.sources, c) ?? '')
          return src.slice(0, n) === String(s.target)
        })
        if (ok) return { type: 'substring', col: c, from: 'left', start: 0, length: n }
      }
    }
    // Try RIGHT(_, n)
    for (let n = 1; n <= firstSrc.length; n++) {
      if (firstSrc.slice(-n) === firstTgt) {
        const ok = samples.every((s) => {
          const src = String(_safeGet(s.sources, c) ?? '')
          return src.slice(-n) === String(s.target)
        })
        if (ok) return { type: 'substring', col: c, from: 'right', start: 0, length: n }
      }
    }
  }
  return null
}

// Concatenation across multiple source columns. Search the small set of
// common separators — exhaustive sep discovery is brittle and Sheets follows
// the same shortlist.
const _SEP_CANDIDATES = ['', ' ', ', ', ',', '-', '_', '|', ' / ', '/', '.', ' & ']

function _detectConcat(samples: readonly SmartFillExample[]): Pattern | null {
  const ncols = _first(samples).sources?.length || 0
  if (ncols < 2) return null
  // Try every pair of columns (col i + col j) and every separator.
  for (let i = 0; i < ncols; i++) {
    for (let j = i + 1; j < ncols; j++) {
      for (const sep of _SEP_CANDIDATES) {
        const ok = samples.every((s) => {
          const a = String(_safeGet(s.sources, i) ?? '')
          const b = String(_safeGet(s.sources, j) ?? '')
          return a + sep + b === String(s.target)
        })
        if (ok) return { type: 'concat', cols: [i, j], sep }
      }
    }
  }
  // Three-column concat — same separator everywhere.
  if (ncols >= 3) {
    for (const sep of _SEP_CANDIDATES) {
      const cols = [...Array(ncols).keys()]
      const ok = samples.every((s) => {
        const parts = cols.map((c) => String(_safeGet(s.sources, c) ?? ''))
        return parts.join(sep) === String(s.target)
      })
      if (ok) return { type: 'concat', cols, sep }
    }
  }
  return null
}

// ── Appliers ────────────────────────────────────────────────────────────────

function _applyCase(v: unknown, transform: CaseTransform) {
  if (v == null) return null
  const s = String(v)
  if (transform === 'upper') return s.toUpperCase()
  if (transform === 'lower') return s.toLowerCase()
  if (transform === 'proper') return s.replace(/\b\w/g, (c) => c.toUpperCase())
  return null
}

function _applyWord(v: unknown, position: WordPosition) {
  if (v == null || v === '') return null
  const words = String(v).split(/\s+/).filter(Boolean)
  if (!words.length) return null
  if (position === 'first') return words[0]
  if (position === 'last') return words[words.length - 1]
  if (typeof position === 'number') return words[position] ?? null
  return null
}

function _applyEmail(v: unknown, part: EmailPart) {
  if (typeof v !== 'string' || !v.includes('@')) return null
  const [local, domain] = v.split('@')
  return part === 'local' ? local : domain
}

function _applySubstring(v: unknown, start: number, length: number, from: 'left' | 'right') {
  if (v == null) return null
  const s = String(v)
  if (from === 'right') return s.slice(-length)
  return s.slice(start, start + length)
}

function _applyConcat(sources: unknown, cols: readonly number[], sep: string) {
  return cols.map((c) => String(_safeGet(sources, c) ?? '')).join(sep)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _safeGet(arr: unknown, idx: number): unknown {
  if (!Array.isArray(arr)) return null
  return arr[idx] === undefined ? null : arr[idx]
}
