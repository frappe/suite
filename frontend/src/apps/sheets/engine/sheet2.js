// sheet2 — a reactive spreadsheet engine built on a REAL dependency graph.
//
// The old engine's staleness bugs (named ranges frozen, cross-sheet refs cached
// after delete, volatility not propagating) all trace to one missing thing: it
// never knew *what depends on what*. It memoised results and invalidated only
// the code paths someone remembered to wire up.
//
// sheet2 fixes that at the root. Every formula's precedents are extracted from
// the AST (engine2.precedents) and recorded as edges in a dependency graph:
//   • cell edges     A1 → {cells that read A1}
//   • name edges     REV → {cells that read the name REV}
//   • range edges    (sheet, box) → dependent      (incl. whole columns)
// A cell edit walks the graph to find exactly which cells go stale and clears
// only those. A dependent can therefore NEVER read a stale precedent.
//
// Design split (stated plainly so it can be audited):
//   • Cell edits — the hot path — invalidate incrementally via the graph.
//   • Structural changes (define/rebind/undefine a name, add/delete a sheet) are
//     rare, so they take a full cache clear. Correct and simple; the incremental
//     machinery is reserved for the case where it matters.

import { evaluate2, precedents } from './engine2.js'

const VOLATILE_RE = /\b(RAND|RANDBETWEEN|TODAY|NOW)\s*\(/i
const MAXROW = 1048576

// ── ref helpers ───────────────────────────────────────────────────────────────
const colToIdx = (l) => {
  let n = 0
  for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}
const colLabel = (i) => {
  let s = '',
    n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
const parseRef = (id) => {
  const m = String(id).match(/^\$?([A-Z]+)\$?(\d+)$/i)
  if (!m) return null
  return { c: colToIdx(m[1].toUpperCase()), r: parseInt(m[2], 10) }
}
const boxOf = (a, b) => {
  const pa = parseRef(a),
    pb = parseRef(b)
  if (!pa || !pb) return null
  return {
    c1: Math.min(pa.c, pb.c),
    c2: Math.max(pa.c, pb.c),
    r1: Math.min(pa.r, pb.r),
    r2: Math.max(pa.r, pb.r),
  }
}
const boxHas = (box, c, r) => c >= box.c1 && c <= box.c2 && r >= box.r1 && r <= box.r2

export function createSheet2() {
  const sheets = { Sheet1: {} } // sheet -> { id: rawValue }
  const names = {} // NAME -> { sheet, start, end }
  const cache = new Map() // "sheet!id" -> computed value
  const computing = new Set() // cycle guard

  // dependency graph
  const fwd = new Map() // depKey ("S!ID" | "name:X") -> Set(dependent "S!ID")
  const rangeDeps = new Map() // dependent "S!ID" -> [{ sheet, box }]
  const subs = new Map() // dependent "S!ID" -> Set(depKey) it subscribed to (for teardown)
  const volatileBase = new Set() // "S!ID" whose own formula is volatile
  const volatile = new Set() // transitive closure of volatileBase

  const key = (sheet, id) => `${sheet}!${id}`
  const splitKey = (k) => {
    const i = k.indexOf('!')
    return [k.slice(0, i), k.slice(i + 1)]
  }
  const addEdge = (dk, dep) => {
    if (!fwd.has(dk)) fwd.set(dk, new Set())
    fwd.get(dk).add(dep)
  }

  // ── extent (for capping whole-column ranges to real data) ──────────────────
  function extent(sheet) {
    let maxR = 0
    for (const id of Object.keys(sheets[sheet] || {})) {
      const p = parseRef(id)
      if (p && p.r > maxR) maxR = p.r
    }
    return maxR
  }

  // ── graph maintenance ──────────────────────────────────────────────────────
  function teardown(k) {
    for (const dk of subs.get(k) || []) fwd.get(dk)?.delete(k)
    subs.delete(k)
    rangeDeps.delete(k)
    volatileBase.delete(k)
  }

  function register(sheet, id, formula) {
    const k = key(sheet, id)
    const mySubs = new Set()
    const myRanges = []
    for (const p of precedents(formula)) {
      if (p.kind === 'cell') {
        const dk = key(p.sheet || sheet, p.id)
        addEdge(dk, k)
        mySubs.add(dk)
      } else if (p.kind === 'name') {
        const dk = 'name:' + p.name.toUpperCase()
        addEdge(dk, k)
        mySubs.add(dk)
      } else if (p.kind === 'range') {
        const box = boxOf(p.a, p.b)
        if (box) myRanges.push({ sheet: p.sheet || sheet, box })
      }
    }
    subs.set(k, mySubs)
    if (myRanges.length) rangeDeps.set(k, myRanges)
    if (VOLATILE_RE.test(formula)) volatileBase.add(k)
  }

  // Every dependent directly affected by a change to (sheet,id):
  //  • cells that read it directly       (fwd cell edges)
  //  • ranges that contain it            (rangeDeps membership)
  //  • names whose binding covers it     (→ dependents of that name)
  function directDependents(sheet, id) {
    const out = new Set()
    for (const d of fwd.get(key(sheet, id)) || []) out.add(d)
    const p = parseRef(id)
    if (p) {
      for (const [dep, boxes] of rangeDeps)
        for (const rb of boxes) if (rb.sheet === sheet && boxHas(rb.box, p.c, p.r)) out.add(dep)
      for (const [nm, b] of Object.entries(names)) {
        const bs = b.sheet || 'Sheet1',
          bx = boxOf(b.start, b.end)
        if (bs === sheet && bx && boxHas(bx, p.c, p.r))
          for (const d of fwd.get('name:' + nm) || []) out.add(d)
      }
    }
    return out
  }

  function recomputeVolatile() {
    volatile.clear()
    const stack = []
    for (const k of volatileBase) {
      volatile.add(k)
      stack.push(k)
    }
    while (stack.length) {
      const [s, i] = splitKey(stack.pop())
      for (const dep of directDependents(s, i))
        if (!volatile.has(dep)) {
          volatile.add(dep)
          stack.push(dep)
        }
    }
  }

  // Clear cache for the changed cell + every transitive dependent.
  function invalidate(sheet, id) {
    cache.delete(key(sheet, id))
    const stack = [[sheet, id]]
    const done = new Set()
    while (stack.length) {
      const [s, i] = stack.pop()
      for (const dep of directDependents(s, i)) {
        if (done.has(dep)) continue
        done.add(dep)
        cache.delete(dep)
        stack.push(splitKey(dep))
      }
    }
  }

  // ── evaluation ─────────────────────────────────────────────────────────────
  function buildRange(sheet, a, b) {
    const box = boxOf(a, b)
    if (!box) return []
    let r2 = box.r2
    if (r2 >= MAXROW) r2 = Math.max(box.r1, extent(sheet)) // cap whole-column to real data
    const rows = []
    for (let r = box.r1; r <= r2; r++) {
      const row = []
      for (let c = box.c1; c <= box.c2; c++) row.push(_pull(colLabel(c) + r, sheet))
      rows.push(row)
    }
    return rows
  }

  function computeCell(sheet, id) {
    const raw = sheets[sheet]?.[id]
    if (raw === undefined || raw === null || raw === '') return ''
    if (typeof raw === 'string' && raw.startsWith('=')) return evalFormula(raw.slice(1), sheet, id)
    if (typeof raw === 'number') return raw
    const n = Number(raw)
    return isNaN(n) ? raw : n
  }

  function evalFormula(body, sheet, id) {
    const k = key(sheet, id)
    if (computing.has(k)) return '#CIRCULAR!'
    computing.add(k)
    try {
      return evaluate2(body, {
        getCell: (cid) => _pull(cid, sheet),
        getRange: (a, b) => buildRange(sheet, a, b),
        getSheetCell: (S, cid) => (sheets[S] === undefined ? '#REF!' : _pull(cid, S)),
        getSheetRange: (S, a, b) => (sheets[S] === undefined ? [['#REF!']] : buildRange(S, a, b)),
        resolveName: (nm) => names[String(nm).toUpperCase()] || null,
      })
    } finally {
      computing.delete(k)
    }
  }

  // The FORMULA precedent cells of a formula (literals need no pre-warming; they
  // compute inline in O(1)). Ranges expand only to the cells that actually hold
  // formulas, so a SUM over 200k literals costs nothing here.
  function precedentCells(formula, sheet) {
    const out = []
    const pushFormula = (s, id) => {
      const r = sheets[s]?.[id]
      if (typeof r === 'string' && r.startsWith('=')) out.push({ sheet: s, id })
    }
    for (const p of precedents(formula)) {
      if (p.kind === 'cell') pushFormula(p.sheet || sheet, p.id.replace(/\$/g, '').toUpperCase())
      else if (p.kind === 'range') {
        const box = boxOf(p.a, p.b)
        if (!box) continue
        const s = p.sheet || sheet
        let r2 = box.r2
        if (r2 >= MAXROW) r2 = Math.max(box.r1, extent(s))
        for (let r = box.r1; r <= r2; r++)
          for (let c = box.c1; c <= box.c2; c++) pushFormula(s, colLabel(c) + r)
      } else if (p.kind === 'name') {
        const b = names[p.name.toUpperCase()]
        if (!b) continue
        const box = boxOf(b.start, b.end)
        if (!box) continue
        const s = b.sheet || 'Sheet1'
        for (let r = box.r1; r <= box.r2; r++)
          for (let c = box.c1; c <= box.c2; c++) pushFormula(s, colLabel(c) + r)
      }
    }
    return out
  }

  // Iterative topological pre-warm: fill the cache for every formula cell in the
  // target's dependency cone, deepest first, using an EXPLICIT stack. This keeps
  // JS call-stack depth O(1) in the length of a dependency chain, so a 100k-deep
  // chain evaluates without overflowing (the old engine died at ~700).
  function ensureComputed(startSheet, startId) {
    const done = new Set()
    const onstack = new Set()
    const stack = [{ sheet: startSheet, id: startId, phase: 0 }]
    while (stack.length) {
      const fr = stack[stack.length - 1]
      const k = key(fr.sheet, fr.id)
      const raw = sheets[fr.sheet]?.[fr.id]
      const isFormula = typeof raw === 'string' && raw.startsWith('=')
      if (done.has(k) || !isFormula || (!volatile.has(k) && cache.has(k))) {
        stack.pop()
        continue
      }
      if (fr.phase === 0) {
        fr.phase = 1
        onstack.add(k)
        for (const pc of precedentCells(raw.slice(1), fr.sheet)) {
          const pk = key(pc.sheet, pc.id)
          if (onstack.has(pk) || done.has(pk)) continue // cycle edge / already handled
          stack.push({ sheet: pc.sheet, id: pc.id, phase: 0 })
        }
      } else {
        onstack.delete(k)
        done.add(k)
        stack.pop()
        const v = computeCell(fr.sheet, fr.id) // precedents now cached → shallow
        if (!volatile.has(k)) cache.set(k, v)
      }
    }
  }

  // Internal cache-aware read (used by resolvers/ranges). Assumes precedents are
  // already warm for deep chains; falls back to inline compute for shallow ones.
  function _pull(id, sheet = 'Sheet1') {
    const raw = sheets[sheet]?.[id]
    const isFormula = typeof raw === 'string' && raw.startsWith('=')
    if (!isFormula) return computeCell(sheet, id)
    const k = key(sheet, id)
    if (volatile.has(k)) return computeCell(sheet, id) // never cache volatile
    if (cache.has(k)) return cache.get(k)
    const v = computeCell(sheet, id)
    cache.set(k, v)
    return v
  }

  function getValue(id, sheet = 'Sheet1') {
    const raw = sheets[sheet]?.[id]
    if (typeof raw === 'string' && raw.startsWith('=')) ensureComputed(sheet, id)
    return _pull(id, sheet)
  }

  function getDisplay(id, sheet = 'Sheet1') {
    const v = getValue(id, sheet)
    return v === '' || v === null || v === undefined ? '' : String(v)
  }

  // ── mutation ───────────────────────────────────────────────────────────────
  function setCell(id, value, sheet = 'Sheet1') {
    if (!sheets[sheet]) sheets[sheet] = {}
    const k = key(sheet, id)
    teardown(k)
    if (value === '' || value == null) delete sheets[sheet][id]
    else sheets[sheet][id] = value
    if (typeof value === 'string' && value.startsWith('=')) register(sheet, id, value.slice(1))
    recomputeVolatile()
    invalidate(sheet, id)
  }

  // structural changes → full cache clear (rare; correctness over cleverness)
  function structural() {
    cache.clear()
    recomputeVolatile()
  }
  function defineName(name, binding) {
    names[name.toUpperCase()] = { sheet: 'Sheet1', ...binding }
    structural()
  }
  function undefineName(name) {
    delete names[name.toUpperCase()]
    structural()
  }
  function addSheet(name) {
    if (!sheets[name]) sheets[name] = {}
    structural()
  }
  function deleteSheet(name) {
    if (Object.keys(sheets).length <= 1) return false
    delete sheets[name]
    structural()
    return true
  }

  return {
    setCell,
    getValue,
    getDisplay,
    defineName,
    undefineName,
    addSheet,
    deleteSheet,
    _debug: { fwd, rangeDeps, volatile, names, sheets },
  }
}
