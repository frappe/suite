// Sheet state engine — owns raw cell data, formula evaluation, and dep cascades.
// The canvas grid stores display strings; this engine stores raw values.
//
// Integration contract:
//   onCellChanged(cellId, displayValue, sheetName) — called after any mutation,
//   so the consumer (SheetEditor.vue) can push display strings to the canvas.

import { evaluate } from './formula.js'
import { createDepsEngine } from './deps.js'
import { renameSheetInFormula } from './formula-adjust.js'
import { parseCellId, colLabel } from '../utils/cells.js'
import { deepClone } from '../utils/deep-clone.js'

// `onCellChanged(id, displayValue, sheet)` fires once per single-cell write
// (setCell, formula cascades). `onCellsChanged(sheet)` fires once after a
// bulk write (batchSetCells) instead of N per-cell notifications — used by
// imports so the host can do a single bulk repaint.
export function createSheet({ onCellChanged, onCellsChanged } = {}) {
	const sheets   = { Sheet1: {} }
	const deps     = createDepsEngine()
	let   current  = 'Sheet1'
	const circular = new Set()
	// One-shot { sheet: {maxRow,maxCol} } set by restore() from the unpacked
	// payload, consumed by the first repopulate so the grid sizes itself without
	// re-parsing every cell id. Any cell mutation clears it (the extent may have
	// changed), so a stale value can never drive a later repopulate.
	let _restoreBounds = null
	// Optional resolver injected after construction (named ranges live in
	// a separate engine; we don't want a hard import circle). Returns
	// `{ sheet, start, end }` or null for unknown names.
	let resolveNamedRange = null
	function setNamedRangeResolver(fn) { resolveNamedRange = fn || null }

	// ── Formula evaluation ────────────────────────────────────────────────────
	//
	// Memoisation: each formula cell evaluates at most once per change to its
	// inputs. Cache key is (sheet, cellId) — every cell has at most one
	// formula, so the cellId uniquely identifies what to cache.
	//
	// Invalidation happens at the setCell / batchSetCells / row-shift sites
	// below: when a cell's data changes, that cell's entry plus every
	// transitive dependent's entry are dropped. The dep graph already
	// computes the BFS list; we re-use that walk for both invalidation and
	// the existing notification cascade.
	//
	// Volatile functions (RAND / RANDBETWEEN / TODAY / NOW) deliberately skip
	// the cache so their value stays fresh on every read.

	const _memo = {}                                          // sheet → Map<cellId, result>
	const VOLATILE_RE = /\b(RAND|RANDBETWEEN|TODAY|NOW)\s*\(/i
	let   _memoHits = 0, _memoMisses = 0                      // diagnostic counters

	function _ensureMemo(sheet) {
		if (!_memo[sheet]) _memo[sheet] = new Map()
		return _memo[sheet]
	}
	function _invalidateCellAndDependents(id, sheet) {
		_memo[sheet]?.delete(id)
		for (const dep of deps.getDependents(id, sheet)) _memo[dep.sheet]?.delete(dep.cellId)
	}
	function _clearAllMemo() { for (const k of Object.keys(_memo)) _memo[k].clear() }

	function getCellValue(id, sheet = current) {
		const raw = sheets[sheet]?.[id]
		if (raw === undefined || raw === null || raw === '') return 0
		if (typeof raw === 'string' && raw.startsWith('='))
			return _evalFormula(raw.slice(1), sheet, id)
		const n = parseFloat(raw)
		return isNaN(n) ? raw : n
	}

	function getRangeValues(startId, endId, sheet = current) {
		const s = parseCellId(startId), e = parseCellId(endId)
		if (!s || !e) return []
		const rows = []
		for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
			const row = []
			for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++)
				row.push(getCellValue(colLabel(c) + (r + 1), sheet))
			rows.push(row)
		}
		return rows
	}

	function _evalFormula(formula, sheet = current, cellId = null) {
		if (cellId) {
			const memo = _ensureMemo(sheet)
			if (memo.has(cellId)) { _memoHits++; return memo.get(cellId) }
			_memoMisses++
		}
		// Recursion guard keyed by cellId when we have it (formulas can recur
		// even when they're different strings — e.g. mutual references with
		// arithmetic differences). Falls back to formula text for ad-hoc
		// evaluate() calls that don't anchor to a cell.
		const key = `${sheet}::${cellId || formula}`
		if (circular.has(key)) return '#CIRCULAR!'
		circular.add(key)
		let result
		try {
			result = evaluate(
				formula,
				id         => getCellValue(id, sheet),
				(s, e)     => getRangeValues(s, e, sheet),
				(sh, id)   => getCellValue(id, sh),
				(sh, s, e) => getRangeValues(s, e, sh),
				name       => resolveNamedRange?.(name) || null,
			)
		} catch (_) {
			// Partial / malformed formulas (e.g. `=VLOOKUP(` mid-typing, which
			// can briefly hit the engine via a stray commit) must not throw —
			// the surrounding UI catches the result and any unhandled exception
			// here would crash whatever called setCell. Return a soft error.
			result = '#ERROR!'
		} finally {
			circular.delete(key)
		}
		if (cellId && !VOLATILE_RE.test(formula)) _ensureMemo(sheet).set(cellId, result)
		return result
	}

	function getDisplayValue(id, sheet = current) {
		const raw = sheets[sheet]?.[id] ?? ''
		if (typeof raw === 'string' && raw.startsWith('=')) {
			const result = _evalFormula(raw.slice(1), sheet, id)
			return result === null || result === undefined ? '' : String(result)
		}
		return raw === null || raw === undefined ? '' : String(raw)
	}

	// ── Mutation ──────────────────────────────────────────────────────────────

	function setCell(id, value, sheet = current) {
		_restoreBounds = null   // extent may change → drop the load-time bounds hint
		if (!sheets[sheet]) sheets[sheet] = {}
		if (value === '' || value == null) delete sheets[sheet][id]
		else sheets[sheet][id] = value

		deps.register(id, value, sheet)
		// Invalidate the formula cache for THIS cell and every transitive
		// dependent BEFORE the notification cascade — otherwise the cascade's
		// getDisplayValue calls would return stale cached results. We compute
		// the dependents list once and reuse it for both invalidation and
		// notification so the BFS only runs once per setCell.
		const dependents = deps.getDependents(id, sheet)
		_memo[sheet]?.delete(id)
		for (const dep of dependents) _memo[dep.sheet]?.delete(dep.cellId)
		_notify(id, sheet)
		// `getDependents` returns `{sheet, cellId}` so cross-sheet dependents
		// (formulas on Sheet2 reading Sheet1!A1) get re-evaluated when the
		// source cell on the other sheet changes.
		for (const dep of dependents) _notify(dep.cellId, dep.sheet)
	}

	// Bulk-write a whole pile of cells with one dep-graph rebuild and *no*
	// per-cell dependent cascade. Used by imports (CSV / XLSX) where a
	// per-cell setCell would freeze the main thread on large files —
	// every setCell currently parses refs, walks dependents, and re-
	// evaluates every formula touching the cell. For a 100k-row import
	// that's 100k × O(deps) work in a tight synchronous loop.
	//
	// Contract: callers pass `{ id: value }` for cells that should exist
	// AFTER the call. Anything not in the map is cleared (so imports
	// replace the sheet rather than merge — matching today's behaviour).
	// Returns the diff (before/after) so callers can decide whether to
	// queue an undo op.
	function batchSetCells(map, sheet = current, { replace = true } = {}) {
		_restoreBounds = null
		if (!sheets[sheet]) sheets[sheet] = {}
		const sh = sheets[sheet]
		const before = {}
		const after  = {}
		if (replace) {
			for (const id of Object.keys(sh)) {
				if (!(id in map)) {
					before[id] = sh[id]
					after[id]  = ''
					delete sh[id]
				}
			}
		}
		for (const [id, v] of Object.entries(map)) {
			const prev = sh[id]
			if (v === '' || v == null) {
				if (prev != null) { before[id] = prev; after[id] = ''; delete sh[id] }
			} else if (prev !== v) {
				before[id] = prev ?? ''
				after[id]  = v
				sh[id] = v
			}
		}
		// Rebuild the dep graph for this sheet in one pass instead of
		// per-cell register() calls. Cross-sheet inbound edges (formulas
		// on OTHER sheets reading into this one) are preserved by deps.
		deps.rebuild(sh, sheet)
		// Wholesale rewrite — cross-sheet formulas reading into this sheet
		// may now be stale, so the safe move is to drop every sheet's memo
		// instead of trying to track which entries were affected.
		_clearAllMemo()
		if (sheet === current) {
			// For incremental writes (replace=false, e.g. paste), the host can
			// repaint only the cells that actually moved plus the formulas
			// that depend on them — way cheaper than walking 25k cells in
			// _repopulateGrid. For wholesale writes (replace=true, e.g.
			// import) the host gets `null` and falls back to a full
			// repopulate since most of the sheet just changed.
			const affected = replace ? null : _collectAffected(after, sheet)
			onCellsChanged?.(sheet, affected)
		}
		return { before, after }
	}

	// For an incremental batch write, the host needs to refresh:
	//   - every cell it explicitly changed (Object.keys(after))
	//   - every formula on this sheet that depends on those cells, since
	//     their evaluated values shifted when the source data did
	// Returns a Set<cellId> the host can iterate.
	function _collectAffected(after, sheet) {
		const set = new Set(Object.keys(after))
		for (const id of Object.keys(after)) {
			for (const dep of deps.getDependents(id, sheet)) {
				if (dep.sheet === sheet) set.add(dep.cellId)
			}
		}
		return set
	}

	function _notify(id, sheet = current) {
		if (sheet !== current) return
		onCellChanged?.(id, getDisplayValue(id, sheet), sheet)
	}

	// ── Row / column insertion & deletion ────────────────────────────────────

	function _shiftCells(sheet, pred, newIdFn) {
		const sh = sheets[sheet]
		if (!sh) return
		// Row/col insertion shifts every dependent cell's address — every
		// cached formula result might now reference the wrong cell. Safer
		// to clear everything than try to remap memo keys.
		_clearAllMemo()
		const entries = Object.entries(sh)
			.map(([id, v]) => ({ id, p: parseCellId(id), v }))
			.filter(({ p }) => p && pred(p))
		entries.sort((a, b) => a.p.row !== b.p.row ? b.p.row - a.p.row : b.p.col - a.p.col)
		for (const { id, p, v } of entries) {
			delete sh[id]
			const nid = newIdFn(p)
			if (nid) sh[nid] = v
		}
		deps.rebuild(sh, sheet)
	}

	function insertRow(atRow) {
		_shiftCells(current, p => p.row >= atRow, p => colLabel(p.col) + (p.row + 2))
	}

	function deleteRow(atRow) {
		const sh = sheets[current]
		if (!sh) return
		for (const id of Object.keys(sh)) {
			const p = parseCellId(id)
			if (p && p.row === atRow) delete sh[id]
		}
		_shiftCells(current, p => p.row > atRow, p => colLabel(p.col) + p.row)
	}

	function insertCol(atCol) {
		const sh = sheets[current]
		if (!sh) return
		const entries = Object.entries(sh)
			.map(([id, v]) => ({ id, p: parseCellId(id), v }))
			.filter(({ p }) => p && p.col >= atCol)
		entries.sort((a, b) => b.p.col - a.p.col)
		for (const { id, p, v } of entries) {
			delete sh[id]
			sh[colLabel(p.col + 1) + (p.row + 1)] = v
		}
		deps.rebuild(sh, current)
		_clearAllMemo()
	}

	function deleteCol(atCol) {
		const sh = sheets[current]
		if (!sh) return
		for (const id of Object.keys(sh)) {
			const p = parseCellId(id)
			if (p && p.col === atCol) delete sh[id]
		}
		const entries = Object.entries(sh)
			.map(([id, v]) => ({ id, p: parseCellId(id), v }))
			.filter(({ p }) => p && p.col > atCol)
		entries.sort((a, b) => a.p.col - b.p.col)
		for (const { id, p, v } of entries) {
			delete sh[id]
			sh[colLabel(p.col - 1) + (p.row + 1)] = v
		}
		deps.rebuild(sh, current)
		_clearAllMemo()
	}

	// ── Sheet management ──────────────────────────────────────────────────────

	function switchSheet(name) {
		if (!sheets[name]) { sheets[name] = {}; deps.rebuild({}, name) }
		current = name
		// No per-cell notify here. The host repaints the whole target sheet
		// via its own switch handler (useSheetTabs onSwitch → _repopulateGrid),
		// so firing onCellChanged for every cell of the target sheet just made
		// the canvas paint it twice — and ran condFormat.invalidate() once per
		// cell — doubling tab-switch cost on large sheets.
	}

	function addSheet(name) {
		if (sheets[name]) return
		sheets[name] = {}
		deps.rebuild({}, name)
	}

	function renameSheet(oldName, newName) {
		if (!sheets[oldName] || sheets[newName] || oldName === newName) return false
		sheets[newName] = sheets[oldName]
		delete sheets[oldName]
		// Walk every sheet (not just the renamed one) and rewrite cross-sheet
		// formulas that referenced the old name. Without this, `=OldName!A1`
		// formulas in *other* sheets break with `#REF!` after a rename.
		for (const sn of Object.keys(sheets)) {
			for (const [cellId, value] of Object.entries(sheets[sn])) {
				if (typeof value === 'string' && value.startsWith('=')) {
					const next = renameSheetInFormula(value, oldName, newName)
					if (next !== value) sheets[sn][cellId] = next
				}
			}
			deps.rebuild(sheets[sn], sn)
		}
		_clearAllMemo()
		if (current === oldName) current = newName
		return true
	}

	function duplicateSheet(srcName, newName) {
		if (!sheets[srcName] || sheets[newName]) return false
		sheets[newName] = deepClone(sheets[srcName])
		deps.rebuild(sheets[newName], newName)
		return true
	}

	function reorderSheets(orderedNames) {
		// Rebuild the internal sheets dict in the requested order. Drops names
		// that don't exist; missing names get appended at the end.
		const next = {}
		for (const name of orderedNames) if (sheets[name]) next[name] = sheets[name]
		for (const name of Object.keys(sheets)) if (!next[name]) next[name] = sheets[name]
		for (const k of Object.keys(sheets)) delete sheets[k]
		for (const [k, v] of Object.entries(next)) sheets[k] = v
		return true
	}

	function deleteSheet(name) {
		if (!sheets[name]) return false
		const names = Object.keys(sheets)
		if (names.length <= 1) return false   // Always keep at least one sheet
		delete sheets[name]
		if (current === name) current = Object.keys(sheets)[0]
		// Notify caller for re-render
		for (const id of Object.keys(sheets[current] || {}))
			onCellChanged?.(id, getDisplayValue(id, current), current)
		return true
	}

	// ── Accessors ─────────────────────────────────────────────────────────────

	function getCell(id, sheet = current)   { return sheets[sheet]?.[id] ?? '' }
	function getCurrentSheet()              { return current }
	function getSheetNames()                { return Object.keys(sheets) }
	function getRawData(sheet = current)    { return sheets[sheet] || {} }
	// Live reference to every sheet's cell map. Read-only by contract — the
	// save path packs straight from this instead of snapshot()'s deepClone,
	// which on a 2M-cell sheet was ~1.9s of pure waste before serializing.
	function getAllRaw()                    { return sheets }
	// Load-time { maxRow, maxCol } for a sheet, or null if unknown. One-shot: the
	// post-restore repopulate reads it once, then it's gone, so no later
	// repopulate (after edits / row inserts that bypass setCell) can act on a
	// stale extent. Lets that one repopulate skip re-deriving bounds from ids.
	function consumeBounds(sheet = current) {
		if (!_restoreBounds) return null
		const b = _restoreBounds[sheet] || null
		delete _restoreBounds[sheet]
		return b
	}

	// ── Snapshot / restore (for history) ─────────────────────────────────────

	function snapshot() {
		return {
			sheets:  deepClone(sheets),
			current,
		}
	}

	function restore(snap, bounds = null) {
		_clearAllMemo()
		for (const key of Object.keys(sheets)) delete sheets[key]
		for (const [name, data] of Object.entries(snap.sheets)) {
			sheets[name] = data
			deps.rebuild(data, name)
		}
		current = snap.current
		// Bounds (from the load path) let the next repopulate skip its per-cell
		// id re-parse. Set AFTER deps.rebuild so nothing above clears it.
		_restoreBounds = bounds
		// One bulk notification instead of N per-cell ones. With 5k rows × 5
		// cols a per-cell loop was a ~750ms tax on every page load — each
		// onCellChanged invalidated the cond-format cache, did a format
		// lookup, applied a number format, and scheduled a canvas render.
		// The host's onCellsChanged handler does one repopulate pass which
		// the canvas's RAF render coalesces, same end state in a fraction
		// of the work.
		onCellsChanged?.(current)
	}

	// Initialise dep graph for the default sheet
	deps.rebuild({}, 'Sheet1')

	return {
		setCell, batchSetCells, getCell, getDisplayValue, getCellValue, getRangeValues,
		switchSheet, addSheet, renameSheet, duplicateSheet, deleteSheet, reorderSheets,
		getSheetNames, getCurrentSheet, getRawData, getAllRaw, consumeBounds,
		insertRow, deleteRow, insertCol, deleteCol,
		snapshot, restore,
		setNamedRangeResolver,
		// Drop the entire formula-result cache. Public so external engines
		// (named ranges, conditional formatting, anything that mutates state
		// the formula evaluator reads) can force-invalidate.
		invalidateMemo: _clearAllMemo,
		// Hit/miss counters — diagnostic only. Tests use these to assert the
		// cache is actually being hit; production code shouldn't depend on them.
		_memoStats: () => ({ hits: _memoHits, misses: _memoMisses }),
		_resetMemoStats: () => { _memoHits = 0; _memoMisses = 0 },
	}
}
