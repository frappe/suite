// Reference remapper for structural column/row operations.
//
// A structural op (move / insert / delete of columns or rows) permutes the
// index space on ONE sheet. Every formula in the workbook that points at that
// sheet must have its column/row references rewritten so the formula keeps
// referring to the same logical data after the op.
//
// This is distinct from `adjustFormula` (formula-adjust.js), which applies a
// *uniform* (dr, dc) shift for copy/paste/fill. Here the shift is not uniform:
// each source index maps to an arbitrary destination via `mapCol` / `mapRow`,
// so a column moved from D→B has to rewrite refs per-column, not by a constant.
//
// The rewrite runs on the RAW formula string (not the tokenizer) so `$`
// anchors, identifier casing, and spacing are preserved verbatim — only the
// column letters / row numbers of matched references change.
//
//   remapRefs(formula, { sheetOfFormula, opSheet, mapCol, mapRow })
//
//   mapCol / mapRow : (index: number) => number | null
//       Return the new 0-based index, or null when that index was deleted
//       (the reference then collapses to #REF!). Omit a map to leave that axis
//       untouched.
//   opSheet         : the sheet the structural op happened on. Only references
//                     that resolve to this sheet are rewritten.
//   sheetOfFormula  : the sheet the formula itself lives on, so bare (un-
//                     qualified) references can be scoped to the right sheet.

import { colLabel, parseCellId, cellId } from '../utils/cells.js'

const REF_ERROR = '#REF!'

// Sheet-name prefix: a quoted name (`'My Sheet'!`, doubled '' escapes) or a
// bare identifier (`Sheet1!`). Trailing `!` included.
const SHEET_PREFIX = String.raw`(?:'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*)!`
// A single cell ref (`A1`, `$A$1`) or a whole-column ref (`A`, `$A`).
const REF = String.raw`\$?[A-Za-z]+\$?\d+|\$?[A-Za-z]+`
// A double-quoted string literal (`\"`/`\\` escapes), matched so we can skip
// reference-like text *inside* strings (`="Total for A1"` must stay intact).
const STRING = String.raw`"(?:\\.|[^"\\])*"`

// One pass matches EITHER a string literal (group 1 — left untouched) OR a
// reference *unit*: an optional sheet prefix, a start ref, and an optional
// range tail (`:` + optional prefix + end ref). Word boundaries keep it from
// firing mid-identifier; the trailing `(?![...(])` skips function names that
// look like refs (e.g. `LOG10(`).
const MASTER = new RegExp(
  `(${STRING})|` +
  String.raw`(?<![A-Za-z0-9_$'!])` +
  String.raw`(${SHEET_PREFIX})?(${REF})` +
  String.raw`(?:\s*:\s*(${SHEET_PREFIX})?(${REF}))?` +
  String.raw`(?![A-Za-z0-9_(])`,
  'g',
)

function colToIndex(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// Normalise a matched sheet prefix to a bare, lower-cased name for comparison.
// Sheet names are matched case-insensitively (Google behaviour).
function sheetKey(prefix) {
  let s = prefix.slice(0, -1) // drop trailing '!'
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).replace(/''/g, "'")
  return s.toLowerCase()
}

// Split a ref string into its parts. `row` is null for a whole-column ref.
function parseRef(ref) {
  const m = ref.match(/^(\$?)([A-Za-z]+)(\$?)(\d*)$/)
  if (!m) return null
  return {
    cd: m[1],
    col: colToIndex(m[2].toUpperCase()),
    rd: m[3],
    row: m[4] ? parseInt(m[4], 10) - 1 : null,
  }
}

function isColOnly(ref) {
  return /^\$?[A-Za-z]+$/.test(ref)
}

// Bounding box of a span under a (possibly non-monotonic) map: the min and max
// surviving destination index for sources in [lo, hi]. A column move permutes
// indices, so a range must grow/shrink to the bounding box of where its cells
// land — endpoint-only remapping would corrupt it. Returns null when every
// index in the span was deleted. A null map leaves the axis untouched.
function boxAxis(lo, hi, map) {
  if (!map) return [lo, hi]
  let mn = Infinity, mx = -Infinity
  for (let i = lo; i <= hi; i++) {
    const v = map(i)
    if (v == null || v < 0) continue
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  return mn === Infinity ? null : [mn, mx]
}

function buildRef(e) {
  return e.cd + colLabel(e.col) + (e.row == null ? '' : e.rd + (e.row + 1))
}

// ── Index-map builders ────────────────────────────────────────────────────────
// Every structural op is expressed as an index map `(old) => new | null`.
// null marks an index that no longer exists (deleted). These builders return
// the same kind of function `remapRefs`, and every engine module's `remapCols`
// consume, so the whole feature shares one notion of "how indices moved".

// Move a contiguous block of `count` indices starting at `from` so the block's
// new start is `to` (an index in the ORIGINAL space, as the drop target). The
// indices between shift to fill the gap; everything else is identity.
export function moveMap(from, to, count = 1) {
  const end = from + count            // block is [from, end)
  return (i) => {
    if (i >= from && i < end) {
      // Where the block lands: `to` is the pre-move index it should sit before.
      const dest = to <= from ? to : to - count
      return dest + (i - from)
    }
    if (to <= from) {
      // Block moved left: indices in [to, from) shift right by count.
      if (i >= to && i < from) return i + count
      return i
    }
    // Block moved right: indices in [end, to) shift left by count.
    if (i >= end && i < to) return i - count
    return i
  }
}

// Insert `count` blank indices at `at`: everything ≥ at shifts up.
export function insertMap(at, count = 1) {
  return (i) => (i >= at ? i + count : i)
}

// Delete `count` indices at `at`: [at, at+count) vanish (→ null), the rest
// shift down.
export function deleteMap(at, count = 1) {
  return (i) => {
    if (i >= at && i < at + count) return null
    return i >= at + count ? i - count : i
  }
}

// ── Store remappers ───────────────────────────────────────────────────────────
// Shared helpers every engine module's `remapCols` builds on, so each module
// permutes its column-indexed state the same way. `mapCol`/`mapRow` are the
// index maps above; a null map leaves that axis untouched. All builders are
// collision-safe because move/insert/delete maps are injective on surviving
// indices — a fresh object is built rather than shifting in place.

// Rebuild a { cellId: value } map with columns/rows remapped; cells whose
// column or row was deleted are dropped.
export function remapCellKeys(obj, mapCol, mapRow) {
  const out = {}
  for (const id of Object.keys(obj)) {
    const p = parseCellId(id)
    if (!p) { out[id] = obj[id]; continue }
    const nc = mapCol ? mapCol(p.col) : p.col
    if (nc == null || nc < 0) continue
    let nr = p.row
    if (mapRow) { nr = mapRow(p.row); if (nr == null || nr < 0) continue }
    out[cellId(nr, nc)] = obj[id]
  }
  return out
}

// Rebuild an { intKey: value } map with keys remapped; deleted keys dropped.
export function remapIndexKeys(obj, map) {
  const out = {}
  for (const k of Object.keys(obj)) {
    const ni = map(Number(k))
    if (ni == null || ni < 0) continue
    out[ni] = obj[k]
  }
  return out
}

// Parse a bare A1 range/cell string ("A1", "B2:D9", "A:A") into a rectangle.
// Whole-column endpoints get row null. Returns null if unparseable.
export function parseA1Range(range) {
  if (typeof range !== 'string') return null
  const [a, b] = range.includes(':') ? range.split(':') : [range, range]
  const pa = parseRef(a), pb = parseRef(b)
  if (!pa || !pb) return null
  return {
    c0: Math.min(pa.col, pb.col), c1: Math.max(pa.col, pb.col),
    r0: pa.row == null || pb.row == null ? null : Math.min(pa.row, pb.row),
    r1: pa.row == null || pb.row == null ? null : Math.max(pa.row, pb.row),
  }
}

// Remap a bare A1 range/cell string the way a formula reference would move.
// Returns the new string, or "#REF!" when fully deleted.
export function remapRangeString(range, { opSheet, mapCol = null, mapRow = null }) {
  if (typeof range !== 'string' || !range) return range
  return remapRefs('=' + range, { sheetOfFormula: opSheet, opSheet, mapCol, mapRow }).slice(1)
}

// Remap a rectangle {r0,c0,r1,c1} to the bounding box of where its cells land,
// or null when fully deleted along either axis.
export function remapRect(rect, mapCol, mapRow) {
  const cbox = boxAxis(Math.min(rect.c0, rect.c1), Math.max(rect.c0, rect.c1), mapCol)
  if (cbox === null) return null
  const rbox = boxAxis(Math.min(rect.r0, rect.r1), Math.max(rect.r0, rect.r1), mapRow)
  if (rbox === null) return null
  return { r0: rbox[0], c0: cbox[0], r1: rbox[1], c1: cbox[1] }
}

export function remapRefs(formula, { sheetOfFormula = null, opSheet = null, mapCol = null, mapRow = null } = {}) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula
  if (opSheet == null) return formula
  const opLc = String(opSheet).toLowerCase()
  const fmLc = sheetOfFormula == null ? null : String(sheetOfFormula).toLowerCase()

  return formula.replace(MASTER, (match, str, sPrefix, sRef, ePrefix, eRef) => {
    if (str !== undefined) return match   // string literal — never a reference
    const isRange = eRef !== undefined
    // A lone whole-column token (`A`, not `A:A`) is a named range / column word,
    // never a cell reference — leave it alone.
    if (!isRange && isColOnly(sRef)) return match

    // The unit's sheet is its prefix (or the formula's own sheet for bare refs).
    // A range's endpoints always share that sheet, so scope the whole unit once.
    const scope = sPrefix ? sheetKey(sPrefix) : fmLc
    if (scope !== opLc) return match

    const s = parseRef(sRef)
    const e = isRange ? parseRef(eRef) : null
    if (!s || (isRange && !e)) return match

    if (!isRange) {
      const nc = mapCol ? mapCol(s.col) : s.col
      if (nc == null || nc < 0) return REF_ERROR
      let nr = s.row
      if (s.row != null && mapRow) {
        nr = mapRow(s.row)
        if (nr == null || nr < 0) return REF_ERROR
      }
      return (sPrefix || '') + buildRef({ cd: s.cd, col: nc, rd: s.rd, row: nr })
    }

    // Range → per-axis bounding box of where its cells land.
    const cbox = boxAxis(Math.min(s.col, e.col), Math.max(s.col, e.col), mapCol)
    if (cbox === null) return REF_ERROR
    let rlo = null, rhi = null
    if (s.row != null && e.row != null) {
      const rbox = boxAxis(Math.min(s.row, e.row), Math.max(s.row, e.row), mapRow)
      if (rbox === null) return REF_ERROR
      ;[rlo, rhi] = rbox
    }
    const start = buildRef({ cd: s.cd, col: cbox[0], rd: s.rd, row: rlo })
    const end = buildRef({ cd: e.cd, col: cbox[1], rd: e.rd, row: rhi })
    return (sPrefix || '') + start + ':' + (ePrefix || '') + end
  })
}
