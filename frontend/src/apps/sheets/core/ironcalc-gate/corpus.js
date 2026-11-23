// Corpus generation: (1) curated cases lifted from Ankush's findings.md, each
// with a hand-known Excel/Sheets-correct answer so we can flag when the ORACLE
// is wrong too; (2) a seeded random generator over arithmetic + a whitelist of
// pure numeric functions, so runs are reproducible.

// ── Seeded PRNG (mulberry32) — reproducible corpus across runs ────────────────
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Curated cases from findings.md (pure single-cell evaluation only) ─────────
// `excel` = the answer Excel/Google Sheets give. Omitted where not a clean scalar.
export const CURATED = [
  { f: '=2^3^2', excel: 64 }, // ^ is left-assoc in Excel/Sheets: (2^3)^2 = 64
  { f: '=--1', excel: 1 },
  { f: '=-5%', excel: -0.05 },
  { f: '=-2%*3', excel: -0.06 },
  { f: '=SUM("abc",4)', excel: '#VALUE!' },
  { f: '=AVERAGE(10,"x",30)', excel: 20 },
  { f: '=MOD(-3,2)', excel: 1 },
  { f: '=ROUND(-2.5,0)', excel: -3 },
  { f: '=TRUNC(3.14159,2)', excel: 3.14 },
  { f: '=EVEN(-1)', excel: -2 },
  { f: '=GCD(8,12,10)', excel: 2 },
  { f: '=SUM($A$1:$A$3)', excel: 6 },
  { f: '=MAX(C1:C3)', excel: -1 },
  { f: '=AVERAGE(B1:B5)', excel: 30 }, // B: 10,blank,30,blank,50 -> avg of 3 = 30
  { f: '=COUNT(B1:B5)', excel: 3 },
  { f: '=SUMIF(A1:A5,">2")', excel: 12 }, // A1..A5 = 1,2,3,4,5 -> 3+4+5
  { f: '=INDEX(A1:B2,0,1)', excel: null }, // spills a column; skip scalar-compare
]

// ── Random generator ──────────────────────────────────────────────────────────
const NUM_FUNCS = [
  { n: 'SUM', arity: [1, 4], kind: 'anyNum' },
  { n: 'AVERAGE', arity: [1, 4], kind: 'anyNum' },
  { n: 'MIN', arity: [1, 4], kind: 'anyNum' },
  { n: 'MAX', arity: [1, 4], kind: 'anyNum' },
  { n: 'PRODUCT', arity: [1, 3], kind: 'anyNum' },
  { n: 'COUNT', arity: [1, 3], kind: 'anyNum' },
  { n: 'ABS', arity: [1, 1], kind: 'scalar' },
  { n: 'SQRT', arity: [1, 1], kind: 'posScalar' },
  { n: 'INT', arity: [1, 1], kind: 'scalar' },
  { n: 'SIGN', arity: [1, 1], kind: 'scalar' },
  { n: 'ROUND', arity: [2, 2], kind: 'roundish' },
  { n: 'ROUNDUP', arity: [2, 2], kind: 'roundish' },
  { n: 'ROUNDDOWN', arity: [2, 2], kind: 'roundish' },
  { n: 'TRUNC', arity: [1, 2], kind: 'roundish' },
  { n: 'MOD', arity: [2, 2], kind: 'modish' },
  { n: 'POWER', arity: [2, 2], kind: 'powish' },
  { n: 'CEILING', arity: [2, 2], kind: 'ceilish' },
  { n: 'FLOOR', arity: [2, 2], kind: 'ceilish' },
]
const CELLS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B3', 'B5', 'C1', 'C3', 'C4', 'D1', 'D3', 'D5']
const RANGES = ['A1:A5', 'A1:A10', 'B1:B5', 'C1:C5', 'A1:C3', 'D1:D5', 'A1:B10']

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)]
}
function litNum(r) {
  const pool = [0, 1, 2, 3, 5, 10, -1, -2, -5, 0.5, 2.5, -2.5, 100, 0.001]
  return pool[Math.floor(r() * pool.length)]
}
function numArg(r) {
  const roll = r()
  if (roll < 0.4) return String(litNum(r))
  if (roll < 0.8) return pick(r, CELLS)
  return pick(r, RANGES)
}
function scalarArg(r) {
  return r() < 0.6 ? String(litNum(r)) : pick(r, CELLS)
}

function genFuncCall(r) {
  const fn = pick(r, NUM_FUNCS)
  const n = fn.arity[0] + Math.floor(r() * (fn.arity[1] - fn.arity[0] + 1))
  let args = []
  switch (fn.kind) {
    case 'anyNum':
      args = Array.from({ length: n }, () => numArg(r))
      break
    case 'scalar':
      args = [scalarArg(r)]
      break
    case 'posScalar':
      args = [String(Math.abs(litNum(r)) + 1)]
      break
    case 'roundish':
      args = [scalarArg(r), String(Math.floor(r() * 5) - 1)].slice(0, n)
      break
    case 'modish':
      args = [scalarArg(r), String(litNum(r) || 3)]
      break
    case 'powish':
      args = [String(1 + Math.floor(r() * 4)), String(Math.floor(r() * 4))]
      break
    case 'ceilish':
      args = [scalarArg(r), String([1, 2, 5, 10][Math.floor(r() * 4)])]
      break
  }
  return `${fn.n}(${args.join(',')})`
}

// A small arithmetic expression with proper-ish nesting (tests precedence/assoc).
function genArith(r, depth = 0) {
  if (depth >= 2 || r() < 0.35) {
    const roll = r()
    if (roll < 0.5) return String(litNum(r))
    if (roll < 0.8) return pick(r, CELLS)
    return genFuncCall(r)
  }
  const ops = ['+', '-', '*', '/', '^']
  const op = pick(r, ops)
  let l = genArith(r, depth + 1),
    rt = genArith(r, depth + 1)
  if (r() < 0.25) l = '-' + l // unary minus
  if (r() < 0.15) rt = '(' + rt + ')' // parens
  return `${l}${op}${rt}`
}

// ── Extended families (all HyperFormula-adjudicable) ──────────────────────────
const TEXT_CELLS = ['E1', 'E2', 'E3', 'E5', 'E7', 'E9']
const TEXT_LITS = ['"apple"', '"Hello World"', '"abc"', '"  spaced  "', '"banana"', '"xyz123"']
const TEXT_RANGES = ['E1:E10', 'E1:E5', 'E3:E9']
const A_RANGES = ['A1:A10', 'A1:A5', 'B1:B10', 'C1:C10', 'D1:D5']

const textArg = (r) => (r() < 0.5 ? pick(r, TEXT_CELLS) : pick(r, TEXT_LITS))
const smallInt = (r) => String(1 + Math.floor(r() * 4))

function genLogical(r) {
  const roll = r()
  if (roll < 0.4) return `IF(${pick(r, CELLS)}>${litNum(r)},${litNum(r)},${litNum(r)})`
  if (roll < 0.6) return `AND(${pick(r, CELLS)}>${litNum(r)},${pick(r, CELLS)}<${litNum(r)})`
  if (roll < 0.8) return `OR(${pick(r, CELLS)}>${litNum(r)},${pick(r, CELLS)}<${litNum(r)})`
  return `NOT(${pick(r, CELLS)}>${litNum(r)})`
}
function genText(r) {
  const fns = [
    () => `LEN(${textArg(r)})`,
    () => `LEFT(${textArg(r)},${smallInt(r)})`,
    () => `RIGHT(${textArg(r)},${smallInt(r)})`,
    () => `MID(${textArg(r)},${smallInt(r)},${smallInt(r)})`,
    () => `UPPER(${textArg(r)})`,
    () => `LOWER(${textArg(r)})`,
    () => `TRIM(${textArg(r)})`,
    () => `CONCATENATE(${textArg(r)},${textArg(r)})`,
    () => `EXACT(${textArg(r)},${textArg(r)})`,
    () => `REPT(${textArg(r)},${smallInt(r)})`,
  ]
  return pick(r, fns)()
}
function genStat(r) {
  const fns = [
    () => `MEDIAN(${pick(r, A_RANGES)})`,
    () => `LARGE(${pick(r, A_RANGES)},${smallInt(r)})`,
    () => `SMALL(${pick(r, A_RANGES)},${smallInt(r)})`,
    () => `COUNTA(${pick(r, [...A_RANGES, ...TEXT_RANGES])})`,
    () => `COUNTIF(${pick(r, TEXT_RANGES)},"apple")`,
    () => `COUNTIF(${pick(r, A_RANGES)},">${litNum(r)}")`,
    () => `SUMIF(${pick(r, A_RANGES)},">${litNum(r)}")`,
    () => `SUMIF(E1:E10,"apple",A1:A10)`,
    () => `AVERAGEIF(${pick(r, A_RANGES)},">${litNum(r)}")`,
    () => `STDEV(${pick(r, A_RANGES)})`,
    () => `SUMPRODUCT(A1:A3,B1:B3)`,
  ]
  return pick(r, fns)()
}
function genLookup(r) {
  const fns = [
    () => `ROW(${pick(r, CELLS)})`,
    () => `COLUMN(${pick(r, CELLS)})`,
    () => `ROWS(${pick(r, A_RANGES)})`,
    () => `COLUMNS(A1:C3)`,
    () => `CHOOSE(${smallInt(r)},${litNum(r)},${litNum(r)},${litNum(r)},${litNum(r)})`,
    () => `MATCH(${litNum(r)},A1:A10,1)`,
    () => `INDEX(A1:C3,${smallInt(r)},${1 + Math.floor(r() * 3)})`,
  ]
  return pick(r, fns)()
}
function genMath2(r) {
  const fns = [
    () => `PI()`,
    () => `EXP(${smallInt(r)})`,
    () => `LN(${1 + Math.floor(r() * 5)})`,
    () => `LOG(${1 + Math.floor(r() * 5)})`,
    () => `LOG10(${1 + Math.floor(r() * 5)})`,
    () => `SIN(${litNum(r)})`,
    () => `COS(${litNum(r)})`,
    () => `TAN(${litNum(r)})`,
    () => `DEGREES(${litNum(r)})`,
    () => `RADIANS(${litNum(r)})`,
    () => `FACT(${smallInt(r)})`,
    () => `COMBIN(${5 + Math.floor(r() * 3)},${smallInt(r)})`,
    () => `SUMSQ(${pick(r, A_RANGES)})`,
  ]
  return pick(r, fns)()
}

export function genFormula(r) {
  const roll = r()
  // 45% original arithmetic/numeric-func core (keeps operator coverage strong),
  // 55% spread across the new families.
  if (roll < 0.25) return '=' + genFuncCall(r)
  if (roll < 0.45) return '=' + genArith(r)
  if (roll < 0.57) return '=' + genLogical(r)
  if (roll < 0.71) return '=' + genText(r)
  if (roll < 0.85) return '=' + genStat(r)
  if (roll < 0.93) return '=' + genLookup(r)
  return '=' + genMath2(r)
}
