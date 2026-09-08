// engine2 — a rebuilt formula engine SPINE: tokenizer → Pratt parser → AST →
// tree-walking evaluator. This is the strangler-fig replacement for the parse
// layer of formula.js. The point of this slice is to prove that a *grammar*
// eliminates an entire class of bugs (operator precedence / associativity /
// unary / percent) at once — not one patch at a time.
//
// Scope of this slice: numbers, strings, cell refs ($-anchored), ranges,
// cross-sheet refs, whole-column refs, function calls, named identifiers,
// arithmetic + comparison + concat operators, prefix unary ±, postfix %.
// Values model: a scalar (number | string | boolean | error-string) OR a
// "matrix" {__m:[[...]]} produced by a range — functions coerce per Excel rules
// (text/blanks inside ranges are ignored; a non-numeric *scalar* argument to a
// numeric function is a #VALUE!).

// ── Errors ────────────────────────────────────────────────────────────────────
const ERR = { VALUE: '#VALUE!', DIV0: '#DIV/0!', NUM: '#NUM!', NAME: '#NAME?', REF: '#REF!' }
const isErr = (v) => typeof v === 'string' && /^#.+[!?]$/.test(v)

// ── Tokenizer ─────────────────────────────────────────────────────────────────
const TT = { NUM: 'NUM', STR: 'STR', REF: 'REF', COLREF: 'COLREF', SHEETREF: 'SHEETREF',
  SHEETCOL: 'SHEETCOL', IDENT: 'IDENT', FUNC: 'FUNC', OP: 'OP', LP: 'LP', RP: 'RP',
  COMMA: 'COMMA', COLON: 'COLON', PCT: 'PCT' }

function tokenize(src) {
  const toks = []
  let i = 0
  const n = src.length
  const isDigit = (c) => c >= '0' && c <= '9'
  const isAlpha = (c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_'
  const isAlnum = (c) => isAlpha(c) || isDigit(c)

  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }

    // number (incl. decimals and scientific notation)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1
      while (j < n && isDigit(src[j])) j++
      if (src[j] === '.') { j++; while (j < n && isDigit(src[j])) j++ }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1
        if (src[k] === '+' || src[k] === '-') k++
        if (isDigit(src[k])) { k++; while (k < n && isDigit(src[k])) k++; j = k }
      }
      toks.push({ t: TT.NUM, v: parseFloat(src.slice(i, j)) })
      i = j; continue
    }

    // string literal
    if (c === '"') {
      let j = i + 1, s = ''
      while (j < n) {
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue } break }
        s += src[j]; j++
      }
      toks.push({ t: TT.STR, v: s })
      i = j + 1; continue
    }

    // sheet-qualified ref:  Ident!  or  'Sheet Name'!   followed by A1 / A:A
    // We detect an identifier (or quoted name) directly followed by '!'.
    if (c === "'" || isAlpha(c)) {
      let j = i, sheet = null
      if (c === "'") {
        j = i + 1; let s = ''
        while (j < n && src[j] !== "'") { s += src[j]; j++ }
        j++ // closing quote
        if (src[j] === '!') { sheet = s; j++ }
        else { // a lone quoted string isn't valid here; treat as name fallback
          toks.push({ t: TT.IDENT, v: s }); i = j; continue
        }
      } else {
        let k = i
        while (k < n && isAlnum(src[k])) k++
        if (src[k] === '!') { sheet = src.slice(i, k); j = k + 1 }
      }

      if (sheet !== null) {
        // parse the reference after '!'
        let k = j
        let dollar1 = src[k] === '$'; if (dollar1) k++
        let colStart = k; while (k < n && src[k] >= 'A' && src[k] <= 'Z') k++
        const col = src.slice(colStart, k)
        let dollar2 = src[k] === '$'; if (dollar2) k++
        let rowStart = k; while (k < n && isDigit(src[k])) k++
        const row = src.slice(rowStart, k)
        if (col && row) { toks.push({ t: TT.SHEETREF, sheet, v: col + row }); i = k; continue }
        if (col && !row) { toks.push({ t: TT.SHEETCOL, sheet, v: col }); i = k; continue }
        // malformed
        toks.push({ t: TT.IDENT, v: '#REF!' }); i = k; continue
      }
    }

    // $-anchored cell ref, plain cell ref, column ref, function, ident, boolean
    if (c === '$' || isAlpha(c)) {
      let j = i
      if (src[j] === '$') j++
      let colStart = j
      while (j < n && ((src[j] >= 'A' && src[j] <= 'Z') || (src[j] >= 'a' && src[j] <= 'z'))) j++
      const col = src.slice(colStart, j).toUpperCase()
      let hadDollar2 = false
      if (src[j] === '$') { hadDollar2 = true; j++ }
      let rowStart = j
      while (j < n && isDigit(src[j])) j++
      const row = src.slice(rowStart, j)

      if (col && row) {
        // A function name may contain trailing digits (LOG10, ATAN2). A real
        // cell ref is never followed by '(' — so col+row+'(' is a function call.
        if (!hadDollar2) { let p = j; while (src[p] === ' ' || src[p] === '\t') p++; if (src[p] === '(') { toks.push({ t: TT.FUNC, v: col + row }); i = j; continue } }
        // A valid A1 ref has column ≤ XFD (16384) and row ≤ 1048576. Something
        // like NOSUCHFN1 only *looks* like a ref — it's a name (→ #NAME?).
        let cn = 0; for (const ch of col) cn = cn * 26 + (ch.charCodeAt(0) - 64)
        const validRef = col.length <= 3 && cn <= 16384 && parseInt(row, 10) <= 1048576
        toks.push({ t: validRef ? TT.REF : TT.IDENT, v: col + row }); i = j; continue
      }
      // identifier with no trailing digits: function, boolean, or named range.
      if (col && !hadDollar2) {
        const name = col
        // function iff next non-space char is '('
        let p = j; while (p < n && (src[p] === ' ' || src[p] === '\t')) p++
        if (src[p] === '(') { toks.push({ t: TT.FUNC, v: name }); i = j; continue }
        if (name === 'TRUE') { toks.push({ t: TT.NUM, v: true }); i = j; continue }
        if (name === 'FALSE') { toks.push({ t: TT.NUM, v: false }); i = j; continue }
        // could be a column ref (A:A) if followed by ':' then col — but that is
        // resolved in the parser via COLON; emit as COLREF-capable IDENT.
        toks.push({ t: TT.IDENT, v: name }); i = j; continue
      }
    }

    // operators & punctuation
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') { toks.push({ t: TT.OP, v: two }); i += 2; continue }
    if ('+-*/^&=<>'.includes(c)) { toks.push({ t: TT.OP, v: c }); i++; continue }
    if (c === '%') { toks.push({ t: TT.PCT }); i++; continue }
    if (c === '(') { toks.push({ t: TT.LP }); i++; continue }
    if (c === ')') { toks.push({ t: TT.RP }); i++; continue }
    if (c === ',') { toks.push({ t: TT.COMMA }); i++; continue }
    if (c === ':') { toks.push({ t: TT.COLON }); i++; continue }

    throw new Error('bad char ' + JSON.stringify(c) + ' at ' + i)
  }
  return toks
}

// ── Parser (precedence climbing) ──────────────────────────────────────────────
// Binding powers (higher = tighter). Unary minus sits ABOVE ^ so that -2^2
// parses as (-2)^2 = 4. This is the Excel/Sheets convention — confirmed against
// the oracle (=-10^100 evaluates to +1e100, i.e. (-10)^100), NOT the -(x^y)
// reading a naive grammar would give. A memory-based guess got this backwards;
// the differential harness caught the sign-flips and corrected it.
const BP = { cmp: 10, concat: 20, add: 30, mul: 40, pow: 50, unary: 60 }
const infixBp = (op) => {
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') return BP.cmp
  if (op === '&') return BP.concat
  if (op === '+' || op === '-') return BP.add
  if (op === '*' || op === '/') return BP.mul
  if (op === '^') return BP.pow
  return -1
}
const rightAssoc = () => false // Excel/Sheets: all binary ops incl. ^ are left-assoc

function parse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (t) => { const tk = next(); if (!tk || tk.t !== t) throw new Error('expected ' + t); return tk }

  function parseExpr(minbp) {
    let left = nud()
    for (;;) {
      const tk = peek()
      if (!tk || tk.t !== TT.OP) break
      const lbp = infixBp(tk.v)
      if (lbp <= minbp) break
      next()
      const right = parseExpr(rightAssoc(tk.v) ? lbp - 1 : lbp)
      left = { k: 'bin', op: tk.v, left, right }
    }
    return left
  }

  // prefix / atom, plus postfix %
  function nud() {
    const tk = peek()
    if (!tk) throw new Error('unexpected end')

    // prefix unary
    if (tk.t === TT.OP && (tk.v === '-' || tk.v === '+')) {
      next()
      const operand = parseExpr(BP.unary)
      return postfix(tk.v === '-' ? { k: 'neg', x: operand } : operand)
    }

    if (tk.t === TT.NUM) { next(); return postfix({ k: 'num', v: tk.v }) }
    if (tk.t === TT.STR) { next(); return postfix({ k: 'str', v: tk.v }) }

    if (tk.t === TT.LP) {
      next()
      const e = parseExpr(0)
      expect(TT.RP)
      return postfix(e)
    }

    if (tk.t === TT.REF) {
      next()
      if (peek()?.t === TT.COLON) { next(); const end = expect(TT.REF); return postfix({ k: 'range', a: tk.v, b: end.v }) }
      return postfix({ k: 'ref', id: tk.v })
    }

    if (tk.t === TT.SHEETREF) {
      next()
      if (peek()?.t === TT.COLON) {
        next(); const end = next()
        const endId = end.t === TT.SHEETREF ? end.v : end.v
        return postfix({ k: 'srange', sheet: tk.sheet, a: tk.v, b: endId })
      }
      return postfix({ k: 'sref', sheet: tk.sheet, id: tk.v })
    }

    if (tk.t === TT.SHEETCOL) {
      next()
      if (peek()?.t === TT.COLON) { next(); const end = next(); const endCol = end.v.match?.(/^[A-Z]+/)?.[0] || end.v; return postfix({ k: 'scol', sheet: tk.sheet, a: tk.v, b: endCol }) }
      return postfix({ k: 'scol', sheet: tk.sheet, a: tk.v, b: tk.v })
    }

    if (tk.t === TT.FUNC) {
      next(); expect(TT.LP)
      const args = []
      while (peek() && peek().t !== TT.RP) {
        args.push(parseExpr(0))
        if (peek()?.t === TT.COMMA) next()
      }
      expect(TT.RP)
      return postfix({ k: 'call', name: tk.v, args })
    }

    if (tk.t === TT.IDENT) {
      next()
      // whole-column range  A:A
      if (peek()?.t === TT.COLON) { next(); const end = next(); const endCol = (end.v || '').match?.(/^[A-Z]+/)?.[0] || end.v; return postfix({ k: 'col', a: tk.v, b: endCol }) }
      return postfix({ k: 'name', name: tk.v })
    }

    throw new Error('unexpected token ' + JSON.stringify(tk))
  }

  function postfix(node) {
    let n = node
    while (peek()?.t === TT.PCT) { next(); n = { k: 'pct', x: n } }
    return n
  }

  const ast = parseExpr(0)
  if (pos !== tokens.length) throw new Error('trailing tokens')
  return ast
}

// ── Evaluator ─────────────────────────────────────────────────────────────────
const num = (v) => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return isNaN(n) ? NaN : n
}
// scalar coercion that ERRORS on non-numeric text (for scalar fn args & arithmetic)
const strictNum = (v) => {
  if (isErr(v)) return v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(String(v).trim())
  return isNaN(n) ? ERR.VALUE : n
}
const isMatrix = (v) => v && typeof v === 'object' && '__m' in v
const flatten = (v) => (isMatrix(v) ? v.__m.flat() : [v])

function makeEvaluator(resolvers) {
  const { getCell, getRange, getSheetCell, getSheetRange, resolveName } = resolvers

  function ev(node) {
    switch (node.k) {
      case 'num': return node.v
      case 'str': return node.v
      case 'ref': return getCell(node.id)
      case 'range': return { __m: getRange(node.a, node.b) }
      case 'sref': return getSheetCell(node.sheet, node.id)
      case 'srange': return { __m: getSheetRange(node.sheet, node.a, node.b) }
      case 'scol': return { __m: getSheetRange(node.sheet, node.a + '1', node.b + '1048576') }
      case 'col': return { __m: getRange(node.a + '1', node.b + '1048576') }
      case 'name': {
        const b = resolveName(node.name)
        if (!b) return ERR.NAME
        if (b.start === b.end) return b.sheet ? getSheetCell(b.sheet, b.start) : getCell(b.start)
        return { __m: b.sheet ? getSheetRange(b.sheet, b.start, b.end) : getRange(b.start, b.end) }
      }
      case 'neg': { const x = strictNum(ev(node.x)); return isErr(x) ? x : -x }
      case 'pct': { const x = strictNum(ev(node.x)); return isErr(x) ? x : x / 100 }
      case 'bin': return binop(node.op, ev(node.left), ev(node.right))
      case 'call': return callFn(node.name, node.args)
      default: throw new Error('bad node ' + node.k)
    }
  }

  function binop(op, l, r) {
    // ranges collapse to their top-left for scalar ops (Excel implicit-intersection-ish);
    // for our corpus, operands to arithmetic are scalars — take first cell if a matrix.
    if (isMatrix(l)) l = l.__m.flat()[0] ?? 0
    if (isMatrix(r)) r = r.__m.flat()[0] ?? 0
    if (isErr(l)) return l
    if (isErr(r)) return r
    if (op === '&') return String(l ?? '') + String(r ?? '')
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      const a = typeof l === 'number' ? l : num(l), b = typeof r === 'number' ? r : num(r)
      switch (op) { case '=': return a === b; case '<>': return a !== b; case '<': return a < b
        case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b }
    }
    const a = strictNum(l), b = strictNum(r)
    if (isErr(a)) return a
    if (isErr(b)) return b
    switch (op) {
      case '+': return a + b
      case '-': return a - b
      case '*': return a * b
      case '/': return b === 0 ? ERR.DIV0 : a / b
      case '^': {
        if (a < 0 && !Number.isInteger(b)) return ERR.NUM
        const p = Math.pow(a, b)
        return isNaN(p) || !isFinite(p) ? ERR.NUM : p
      }
    }
  }

  // collect numeric values from args: ranges ignore text/blank; scalar text errors
  function numericArgs(argNodes) {
    const nums = []
    for (const node of argNodes) {
      const v = ev(node)
      if (isErr(v)) return { err: v }
      if (isMatrix(v)) {
        for (const cell of v.__m.flat()) { if (typeof cell === 'number') nums.push(cell) /* ignore text/blank/bool in ranges */ }
      } else {
        const n = strictNum(v)
        if (isErr(n)) return { err: n }
        nums.push(n)
      }
    }
    return { nums }
  }

  // flat list of a node's values (ranges → cells; scalar → [scalar]); errors bubble
  function flatVals(node) { const v = ev(node); if (isErr(v)) return { err: v }; return { vals: isMatrix(v) ? v.__m.flat() : [v] } }
  // a node as a 2D matrix (scalar → 1×1)
  function asMatrix(node) { const v = ev(node); if (isErr(v)) return v; return isMatrix(v) ? v.__m : [[v]] }

  function callFn(name, args) {
    const F = FUNCS[name]
    if (!F) return ERR.NAME
    try { return F(args, { ev, numericArgs, flatVals, asMatrix, isMatrix }) } catch (e) { return ERR.VALUE }
  }

  return (ast) => ev(ast)
}

// ── shared coercions / helpers for the function library ───────────────────────
const toStr = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))
const toBool = (v) => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === '' || v === null || v === undefined) return false
  const s = String(v).toUpperCase()
  if (s === 'TRUE') return true
  if (s === 'FALSE') return false
  const n = Number(v); return isNaN(n) ? false : n !== 0
}
const refRC = (id) => { const m = String(id).match(/^\$?([A-Z]+)\$?(\d+)$/i); if (!m) return null; let col = 0; for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64); return { row: parseInt(m[2], 10), col } }
// Excel criteria → predicate: numbers, "text", ">=5", "<>x", wildcards * and ?
function makePred(crit) {
  if (typeof crit === 'number') return (x) => (typeof x === 'number' ? x === crit : Number(x) === crit)
  const s = String(crit)
  const m = s.match(/^(>=|<=|<>|>|<|=)?(.*)$/)
  const op = m[1] || '=', rhs = m[2]
  const rn = Number(rhs)
  const numeric = rhs.trim() !== '' && !isNaN(rn)
  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    return (x) => { const xn = typeof x === 'number' ? x : Number(x); if (isNaN(xn)) return false
      return op === '>' ? xn > rn : op === '>=' ? xn >= rn : op === '<' ? xn < rn : xn <= rn }
  }
  // = or <> : numeric compare if rhs numeric, else wildcard string match (case-insensitive)
  const wild = /[*?]/.test(rhs)
  const re = wild ? new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null
  const test = (x) => {
    if (numeric && !wild) return (typeof x === 'number' ? x : Number(x)) === rn
    const xs = toStr(x)
    return wild ? re.test(xs) : xs.toLowerCase() === rhs.toLowerCase()
  }
  return op === '<>' ? (x) => !test(x) : test
}

// ── Function library (Excel semantics, correct-by-construction) ───────────────
const gcd2 = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b] } return a }
const round_half_away = (x, d) => { const f = Math.pow(10, d); return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-12) / f }

const FUNCS = {
  SUM:     (a, c) => { const r = c.numericArgs(a); return r.err ?? r.nums.reduce((s, x) => s + x, 0) },
  PRODUCT: (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.length ? r.nums.reduce((s, x) => s * x, 1) : 0 },
  AVERAGE: (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.length ? r.nums.reduce((s, x) => s + x, 0) / r.nums.length : '#DIV/0!' },
  COUNT:   (a, c) => { const r = c.numericArgs(a); return r.err ? 0 : r.nums.length }, // COUNT ignores text errors in ranges; scalar text -> not counted
  MIN:     (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.length ? Math.min(...r.nums) : 0 },
  MAX:     (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.length ? Math.max(...r.nums) : 0 },
  ABS:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.abs(x) },
  SQRT:    (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; return x < 0 ? ERR.NUM : Math.sqrt(x) },
  INT:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.floor(x) },
  SIGN:    (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.sign(x) },
  ROUND:   (a, c) => { const x = strictNum(c.ev(a[0])); const d = a[1] ? strictNum(c.ev(a[1])) : 0; if (isErr(x)) return x; if (isErr(d)) return d; return round_half_away(x, d) },
  ROUNDUP: (a, c) => { const x = strictNum(c.ev(a[0])); const d = a[1] ? strictNum(c.ev(a[1])) : 0; if (isErr(x)||isErr(d)) return isErr(x)?x:d; const f = Math.pow(10, d); return Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-12) / f },
  ROUNDDOWN:(a, c) => { const x = strictNum(c.ev(a[0])); const d = a[1] ? strictNum(c.ev(a[1])) : 0; if (isErr(x)||isErr(d)) return isErr(x)?x:d; const f = Math.pow(10, d); return Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-12) / f },
  TRUNC:   (a, c) => { const x = strictNum(c.ev(a[0])); const d = a[1] ? strictNum(c.ev(a[1])) : 0; if (isErr(x)||isErr(d)) return isErr(x)?x:d; const f = Math.pow(10, d); return Math.trunc(x * f) / f },
  MOD:     (a, c) => { const x = strictNum(c.ev(a[0])); const y = strictNum(c.ev(a[1])); if (isErr(x)||isErr(y)) return isErr(x)?x:y; if (y === 0) return ERR.DIV0; return x - y * Math.floor(x / y) },
  POWER:   (a, c) => { const x = strictNum(c.ev(a[0])); const y = strictNum(c.ev(a[1])); if (isErr(x)||isErr(y)) return isErr(x)?x:y; if (x < 0 && !Number.isInteger(y)) return ERR.NUM; const p = Math.pow(x, y); return isFinite(p) ? p : ERR.NUM },
  CEILING: (a, c) => { const x = strictNum(c.ev(a[0])); const s = a[1] ? strictNum(c.ev(a[1])) : 1; if (isErr(x)||isErr(s)) return isErr(x)?x:s; if (s === 0) return 0; return Math.ceil(x / s) * s },
  FLOOR:   (a, c) => { const x = strictNum(c.ev(a[0])); const s = a[1] ? strictNum(c.ev(a[1])) : 1; if (isErr(x)||isErr(s)) return isErr(x)?x:s; if (s === 0) return ERR.DIV0; return Math.floor(x / s) * s },
  GCD:     (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.map((n) => Math.trunc(Math.abs(n))).reduce((g, x) => gcd2(g, x), 0) },
  LCM:     (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.map((n) => Math.trunc(Math.abs(n))).reduce((l, x) => (x === 0 ? 0 : Math.abs(l * x) / gcd2(l, x)), 1) },
  EVEN:    (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; const up = Math.ceil(Math.abs(x) / 2) * 2; return Math.sign(x || 1) * up },
  ODD:     (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; let up = Math.ceil((Math.abs(x) + 1) / 2) * 2 - 1; return Math.sign(x || 1) * up },
  // ── Logical ──────────────────────────────────────────────────────────────
  IF:      (a, c) => { const t = c.ev(a[0]); if (isErr(t)) return t; return toBool(t) ? c.ev(a[1]) : (a[2] !== undefined ? c.ev(a[2]) : false) },
  IFERROR: (a, c) => { const v = c.ev(a[0]); return isErr(v) ? c.ev(a[1]) : v },
  IFNA:    (a, c) => { const v = c.ev(a[0]); return v === '#N/A' ? c.ev(a[1]) : v },
  IFS:     (a, c) => { for (let i = 0; i + 1 < a.length; i += 2) { const t = c.ev(a[i]); if (isErr(t)) return t; if (toBool(t)) return c.ev(a[i + 1]) } return '#N/A' },
  AND:     (a, c) => { for (const n of a) { const r = c.flatVals(n); if (r.err) return r.err; for (const v of r.vals) if (v !== '' && v !== null && !toBool(v)) return false } return true },
  OR:      (a, c) => { let any = false; for (const n of a) { const r = c.flatVals(n); if (r.err) return r.err; for (const v of r.vals) if (v !== '' && v !== null && toBool(v)) any = true } return any },
  NOT:     (a, c) => { const v = c.ev(a[0]); return isErr(v) ? v : !toBool(v) },
  XOR:     (a, c) => { let cnt = 0; for (const n of a) { const r = c.flatVals(n); if (r.err) return r.err; for (const v of r.vals) if (v !== '' && v !== null && toBool(v)) cnt++ } return cnt % 2 === 1 },
  TRUE:    () => true,
  FALSE:   () => false,

  // ── Math (transcendental / combinatorial) ────────────────────────────────
  PI:      () => Math.PI,
  EXP:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.exp(x) },
  LN:      (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; return x <= 0 ? ERR.NUM : Math.log(x) },
  LOG10:   (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; return x <= 0 ? ERR.NUM : Math.log10(x) },
  LOG:     (a, c) => { const x = strictNum(c.ev(a[0])); const b = a[1] ? strictNum(c.ev(a[1])) : 10; if (isErr(x)||isErr(b)) return isErr(x)?x:b; return x <= 0 ? ERR.NUM : Math.log(x) / Math.log(b) },
  SIN:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.sin(x) },
  COS:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.cos(x) },
  TAN:     (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.tan(x) },
  ATAN:    (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : Math.atan(x) },
  ATAN2:   (a, c) => { const x = strictNum(c.ev(a[0])); const y = strictNum(c.ev(a[1])); if (isErr(x)||isErr(y)) return isErr(x)?x:y; return Math.atan2(y, x) },
  DEGREES: (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : x * 180 / Math.PI },
  RADIANS: (a, c) => { const x = strictNum(c.ev(a[0])); return isErr(x) ? x : x * Math.PI / 180 },
  FACT:    (a, c) => { const x = strictNum(c.ev(a[0])); if (isErr(x)) return x; const n = Math.trunc(x); if (n < 0) return ERR.NUM; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r },
  COMBIN:  (a, c) => { const n = Math.trunc(strictNum(c.ev(a[0]))), k = Math.trunc(strictNum(c.ev(a[1]))); if (n < 0 || k < 0 || k > n) return ERR.NUM; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r) },
  SUMSQ:   (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; return r.nums.reduce((s, x) => s + x * x, 0) },
  SUMPRODUCT: (a, c) => { const mats = a.map((n) => c.asMatrix(n)); for (const m of mats) if (isErr(m)) return m; const flat = mats.map((m) => m.flat()); const len = flat[0].length; let s = 0; for (let i = 0; i < len; i++) { let p = 1; for (const f of flat) p *= (typeof f[i] === 'number' ? f[i] : Number(f[i]) || 0); s += p } return s },

  // ── Stats / counting / criteria ──────────────────────────────────────────
  COUNTA:  (a, c) => { let cnt = 0; for (const n of a) { const r = c.flatVals(n); if (r.err) { cnt++; continue } for (const v of r.vals) if (v !== '' && v !== null && v !== undefined) cnt++ } return cnt },
  COUNTBLANK: (a, c) => { const m = c.asMatrix(a[0]); if (isErr(m)) return m; let cnt = 0; for (const v of m.flat()) if (v === '' || v === null || v === undefined) cnt++; return cnt },
  MEDIAN:  (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; if (!r.nums.length) return ERR.NUM; const s = [...r.nums].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 },
  LARGE:   (a, c) => { const m = c.asMatrix(a[0]); if (isErr(m)) return m; const k = Math.trunc(strictNum(c.ev(a[1]))); const s = m.flat().filter((v) => typeof v === 'number').sort((x, y) => y - x); return k >= 1 && k <= s.length ? s[k - 1] : ERR.NUM },
  SMALL:   (a, c) => { const m = c.asMatrix(a[0]); if (isErr(m)) return m; const k = Math.trunc(strictNum(c.ev(a[1]))); const s = m.flat().filter((v) => typeof v === 'number').sort((x, y) => x - y); return k >= 1 && k <= s.length ? s[k - 1] : ERR.NUM },
  STDEV:   (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; const n = r.nums.length; if (n < 2) return ERR.DIV0; const mean = r.nums.reduce((s, x) => s + x, 0) / n; return Math.sqrt(r.nums.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) },
  STDEVP:  (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; const n = r.nums.length; if (!n) return ERR.DIV0; const mean = r.nums.reduce((s, x) => s + x, 0) / n; return Math.sqrt(r.nums.reduce((s, x) => s + (x - mean) ** 2, 0) / n) },
  VAR:     (a, c) => { const r = c.numericArgs(a); if (r.err) return r.err; const n = r.nums.length; if (n < 2) return ERR.DIV0; const mean = r.nums.reduce((s, x) => s + x, 0) / n; return r.nums.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) },
  COUNTIF: (a, c) => { const m = c.asMatrix(a[0]); if (isErr(m)) return m; const pred = makePred(c.ev(a[1])); let cnt = 0; for (const v of m.flat()) if (v !== '' && v !== null && pred(v)) cnt++; return cnt },
  SUMIF:   (a, c) => { const rng = c.asMatrix(a[0]); if (isErr(rng)) return rng; const pred = makePred(c.ev(a[1])); const sumM = a[2] ? c.asMatrix(a[2]) : rng; if (isErr(sumM)) return sumM; const rf = rng.flat(), sf = sumM.flat(); let s = 0; for (let i = 0; i < rf.length; i++) if (rf[i] !== '' && rf[i] !== null && pred(rf[i])) { const x = sf[i]; if (typeof x === 'number') s += x } return s },
  AVERAGEIF: (a, c) => { const rng = c.asMatrix(a[0]); if (isErr(rng)) return rng; const pred = makePred(c.ev(a[1])); const avgM = a[2] ? c.asMatrix(a[2]) : rng; if (isErr(avgM)) return avgM; const rf = rng.flat(), af = avgM.flat(); let s = 0, n = 0; for (let i = 0; i < rf.length; i++) if (rf[i] !== '' && rf[i] !== null && pred(rf[i]) && typeof af[i] === 'number') { s += af[i]; n++ } return n ? s / n : ERR.DIV0 },

  // ── Text ─────────────────────────────────────────────────────────────────
  LEN:     (a, c) => { const v = c.ev(a[0]); return isErr(v) ? v : toStr(v).length },
  LEFT:    (a, c) => { const s = toStr(c.ev(a[0])); const n = a[1] ? Math.trunc(strictNum(c.ev(a[1]))) : 1; return s.slice(0, Math.max(0, n)) },
  RIGHT:   (a, c) => { const s = toStr(c.ev(a[0])); const n = a[1] ? Math.trunc(strictNum(c.ev(a[1]))) : 1; return n <= 0 ? '' : s.slice(-n) },
  MID:     (a, c) => { const s = toStr(c.ev(a[0])); const start = Math.trunc(strictNum(c.ev(a[1]))); const len = Math.trunc(strictNum(c.ev(a[2]))); if (start < 1 || len < 0) return ERR.VALUE; return s.slice(start - 1, start - 1 + len) },
  UPPER:   (a, c) => toStr(c.ev(a[0])).toUpperCase(),
  LOWER:   (a, c) => toStr(c.ev(a[0])).toLowerCase(),
  PROPER:  (a, c) => toStr(c.ev(a[0])).replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\B\w/g, (m) => m.toLowerCase()),
  TRIM:    (a, c) => toStr(c.ev(a[0])).replace(/\s+/g, ' ').trim(),
  CONCATENATE: (a, c) => a.map((n) => toStr(c.ev(n))).join(''),
  CONCAT:  (a, c) => { let out = ''; for (const n of a) { const r = c.flatVals(n); if (r.err) return r.err; out += r.vals.map(toStr).join('') } return out },
  REPT:    (a, c) => { const s = toStr(c.ev(a[0])); const n = Math.trunc(strictNum(c.ev(a[1]))); return n < 0 ? ERR.VALUE : s.repeat(n) },
  EXACT:   (a, c) => toStr(c.ev(a[0])) === toStr(c.ev(a[1])),
  FIND:    (a, c) => { const sub = toStr(c.ev(a[0])), s = toStr(c.ev(a[1])); const start = a[2] ? Math.trunc(strictNum(c.ev(a[2]))) : 1; const i = s.indexOf(sub, start - 1); return i < 0 ? ERR.VALUE : i + 1 },
  SEARCH:  (a, c) => { const sub = toStr(c.ev(a[0])).toLowerCase(), s = toStr(c.ev(a[1])).toLowerCase(); const start = a[2] ? Math.trunc(strictNum(c.ev(a[2]))) : 1; const i = s.indexOf(sub, start - 1); return i < 0 ? ERR.VALUE : i + 1 },
  SUBSTITUTE: (a, c) => { const s = toStr(c.ev(a[0])), oldT = toStr(c.ev(a[1])), newT = toStr(c.ev(a[2])); if (oldT === '') return s; if (a[3]) { const which = Math.trunc(strictNum(c.ev(a[3]))); let i = 0, from = 0; while (true) { const idx = s.indexOf(oldT, from); if (idx < 0) return s; if (++i === which) return s.slice(0, idx) + newT + s.slice(idx + oldT.length); from = idx + oldT.length } } return s.split(oldT).join(newT) },
  VALUE:   (a, c) => { const v = c.ev(a[0]); if (isErr(v)) return v; const n = Number(String(v).trim()); return isNaN(n) ? ERR.VALUE : n },
  T:       (a, c) => { const v = c.ev(a[0]); return typeof v === 'string' && !isErr(v) ? v : '' },

  // ── Lookup / reference ───────────────────────────────────────────────────
  ROW:     (a, c) => { if (!a.length) return ERR.VALUE; const n = a[0]; if (n.k === 'ref') return refRC(n.id)?.row ?? ERR.REF; if (n.k === 'range') return refRC(n.a)?.row ?? ERR.REF; return ERR.VALUE },
  COLUMN:  (a, c) => { if (!a.length) return ERR.VALUE; const n = a[0]; if (n.k === 'ref') return refRC(n.id)?.col ?? ERR.REF; if (n.k === 'range') return refRC(n.a)?.col ?? ERR.REF; return ERR.VALUE },
  ROWS:    (a, c) => { const m = c.asMatrix(a[0]); return isErr(m) ? m : m.length },
  COLUMNS: (a, c) => { const m = c.asMatrix(a[0]); return isErr(m) ? m : (m[0] ? m[0].length : 0) },
  CHOOSE:  (a, c) => { const i = Math.trunc(strictNum(c.ev(a[0]))); if (i < 1 || i >= a.length) return ERR.VALUE; return c.ev(a[i]) },
  MATCH:   (a, c) => { const key = c.ev(a[0]); const m = c.asMatrix(a[1]); if (isErr(m)) return m; const type = a[2] !== undefined ? Math.trunc(strictNum(c.ev(a[2]))) : 1; const arr = m.flat()
    if (type === 0) { for (let i = 0; i < arr.length; i++) if (toStr(arr[i]).toLowerCase() === toStr(key).toLowerCase()) return i + 1; return '#N/A' }
    if (type === 1) { let res = -1; for (let i = 0; i < arr.length; i++) { if (typeof arr[i] === 'number' && arr[i] <= key) res = i } return res < 0 ? '#N/A' : res + 1 }
    for (let i = 0; i < arr.length; i++) { if (typeof arr[i] === 'number' && arr[i] >= key) return i + 1 } return '#N/A' },
  INDEX:   (a, c) => { const m = c.asMatrix(a[0]); if (isErr(m)) return m; const rN = Math.trunc(strictNum(c.ev(a[1]))); const cN = a[2] !== undefined ? Math.trunc(strictNum(c.ev(a[2]))) : (m.length === 1 ? -1 : 1)
    if (cN === -1) { const row = m[rN - 1]; if (!row) return ERR.REF; return row.length === 1 ? row[0] : { __m: [row] } }
    if (rN === 0) { const col = m.map((r) => [r[cN - 1]]); return { __m: col } }
    if (cN === 0) { const row = m[rN - 1]; return row ? { __m: [row] } : ERR.REF }
    const row = m[rN - 1]; if (!row) return ERR.REF; const cell = row[cN - 1]; return cell === undefined ? ERR.REF : cell },
  VLOOKUP: (a, c) => { const key = c.ev(a[0]); const m = c.asMatrix(a[1]); if (isErr(m)) return m; const col = Math.trunc(strictNum(c.ev(a[2]))); const exact = a[3] !== undefined ? !toBool(c.ev(a[3])) : false
    if (exact) { for (const row of m) if (toStr(row[0]).toLowerCase() === toStr(key).toLowerCase()) return row[col - 1] ?? ERR.REF; return '#N/A' }
    let best = null; for (const row of m) { if (typeof row[0] === 'number' && row[0] <= key) best = row; else if (typeof row[0] === 'number' && row[0] > key) break } return best ? (best[col - 1] ?? ERR.REF) : '#N/A' },
  HLOOKUP: (a, c) => { const key = c.ev(a[0]); const m = c.asMatrix(a[1]); if (isErr(m)) return m; const rowN = Math.trunc(strictNum(c.ev(a[2]))); const exact = a[3] !== undefined ? !toBool(c.ev(a[3])) : false; const head = m[0] || []
    if (exact) { for (let i = 0; i < head.length; i++) if (toStr(head[i]).toLowerCase() === toStr(key).toLowerCase()) return m[rowN - 1]?.[i] ?? ERR.REF; return '#N/A' }
    let bi = -1; for (let i = 0; i < head.length; i++) { if (typeof head[i] === 'number' && head[i] <= key) bi = i; else if (typeof head[i] === 'number' && head[i] > key) break } return bi < 0 ? '#N/A' : (m[rowN - 1]?.[bi] ?? ERR.REF) },

  // Volatile — deliberately never cached by the reactive layer (VOLATILE_RE).
  RAND:        () => Math.random(),
  RANDBETWEEN: (a, c) => { const lo = strictNum(c.ev(a[0])), hi = strictNum(c.ev(a[1])); if (isErr(lo)) return lo; if (isErr(hi)) return hi; return Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo) },
}

// ── Public entry: evaluate(formula, resolvers) ────────────────────────────────
export function evaluate2(formula, resolvers) {
  let ast
  try { ast = parse(tokenize(formula)) } catch (e) { return ERR.VALUE } // malformed → #VALUE!, never a silent throw
  const run = makeEvaluator(resolvers)
  try {
    const v = run(ast)
    if (isMatrix(v)) return v.__m.flat()[0] ?? '' // a bare range in scalar position
    return v
  } catch (e) { return ERR.VALUE }
}

// Expose the precedent extractor — this is what makes a real dependency graph
// possible (the missing piece behind every reactivity failure).
export function precedents(formula) {
  let ast; try { ast = parse(tokenize(formula)) } catch { return [] }
  const out = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    switch (n.k) {
      case 'ref': out.push({ kind: 'cell', id: n.id }); break
      case 'range': out.push({ kind: 'range', a: n.a, b: n.b }); break
      case 'sref': out.push({ kind: 'cell', sheet: n.sheet, id: n.id }); break
      case 'srange': out.push({ kind: 'range', sheet: n.sheet, a: n.a, b: n.b }); break
      case 'col': out.push({ kind: 'range', a: n.a + '1', b: n.b + '1048576' }); break
      case 'scol': out.push({ kind: 'range', sheet: n.sheet, a: n.a + '1', b: n.b + '1048576' }); break
      case 'name': out.push({ kind: 'name', name: n.name }); break
    }
    for (const k of ['x', 'left', 'right']) if (n[k]) walk(n[k])
    if (n.args) n.args.forEach(walk)
  })(ast)
  return out
}
