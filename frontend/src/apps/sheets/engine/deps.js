// Dependency engine — tracks which cells depend on which other cells.
// Used to cascade re-evaluation when a source cell changes.
//
// References are stored as `{ sheet, cellId }` pairs so cross-sheet refs
// (`=Sheet2!A1`) cascade correctly. Same-sheet refs use the current
// sheet's name implicitly. `getDependents` returns an array of these
// pairs and callers (sheet engine) are expected to walk both axes.

import { tokenize } from './formula.js'
import { parseCellId, colLabel } from '../utils/cells.js'

export function createDepsEngine() {
	// depMap[sheet][cellId]     = Set<"sheet|cellId">  — cells this cell reads
	// reverseDep[sheet][cellId] = Set<"sheet|cellId">  — cells that read this cell
	const depMap     = {}
	const reverseDep = {}

	function ensure(sheet) {
		if (!depMap[sheet])     depMap[sheet]     = {}
		if (!reverseDep[sheet]) reverseDep[sheet] = {}
	}

	function _key(sheet, cellId)   { return `${sheet}|${cellId}` }
	function _split(key)           { const i = key.indexOf('|'); return { sheet: key.slice(0, i), cellId: key.slice(i + 1) } }

	// Walk the formula's tokens and return Set<"sheet|cellId">. Handles:
	//   * Same-sheet refs:    A1, A1:B3
	//   * Cross-sheet refs:   Sheet2!A1, Sheet2!A1:B3, Sheet2!A1:Sheet2!B3
	//   * Cross-sheet cols:   Sheet2!A  (expanded to A1 of that sheet so a
	//                                    minimal dependency exists — full
	//                                    column expansion is impractical)
	function extractRefs(formula, currentSheet) {
		const refs = new Set()
		try {
			const tokens = tokenize(formula)
			for (let i = 0; i < tokens.length; i++) {
				const tok = tokens[i]

				// Same-sheet single or range
				if (tok.t === 'REF') {
					if (tokens[i + 1]?.t === 'COLON' && tokens[i + 2]?.t === 'REF') {
						_addRange(refs, currentSheet, tok.v, tokens[i + 2].v)
						i += 2
					} else {
						refs.add(_key(currentSheet, tok.v))
					}
					continue
				}

				// Cross-sheet single or range
				if (tok.t === 'SHEETREF') {
					const targetSheet = tok.sheet
					if (tokens[i + 1]?.t === 'COLON' && tokens[i + 2]) {
						const endTok = tokens[i + 2]
						// `Sheet2!A1:B3`  → end is REF (implicit same sheet as start)
						// `Sheet2!A1:Sheet2!B3` → end is SHEETREF on the same sheet
						const endCell = endTok.t === 'SHEETREF' ? endTok.v
									  : endTok.t === 'REF'      ? endTok.v
									  : null
						if (endCell) {
							_addRange(refs, targetSheet, tok.v, endCell)
							i += 2
							continue
						}
					}
					refs.add(_key(targetSheet, tok.v))
					continue
				}

				// `Sheet2!A` — bare column reference. Adding A1 of the foreign
				// sheet is a minimal, cheap dependency that catches "something
				// in that column changed" without blowing up the dep graph.
				if (tok.t === 'SHEETCOL') {
					refs.add(_key(tok.sheet, tok.v + '1'))
				}
			}
		} catch (_) { /* tokeniser explodes → no deps tracked */ }
		return refs
	}

	function _addRange(refs, sheet, startId, endId) {
		const s = parseCellId(startId)
		const e = parseCellId(endId)
		if (!s || !e) return
		for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
			for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++) {
				refs.add(_key(sheet, colLabel(c) + (r + 1)))
			}
		}
	}

	function removeEdges(cellId, sheet) {
		const old = depMap[sheet]?.[cellId]
		if (!old) return
		for (const refKey of old) {
			const { sheet: tSheet, cellId: tCell } = _split(refKey)
			reverseDep[tSheet]?.[tCell]?.delete(_key(sheet, cellId))
		}
		delete depMap[sheet][cellId]
	}

	function register(cellId, value, sheet = 'Sheet1') {
		ensure(sheet)
		removeEdges(cellId, sheet)
		if (typeof value !== 'string' || !value.startsWith('=')) return
		const refs = extractRefs(value.slice(1), sheet)
		depMap[sheet][cellId] = refs
		for (const refKey of refs) {
			const { sheet: tSheet, cellId: tCell } = _split(refKey)
			ensure(tSheet)
			const bucket = reverseDep[tSheet][tCell] || (reverseDep[tSheet][tCell] = new Set())
			bucket.add(_key(sheet, cellId))
		}
	}

	// Returns all cells that (transitively) depend on cellId in this sheet,
	// in BFS order. Each entry is `{ sheet, cellId }` — callers walk both
	// axes because dependents can live on a *different* sub-sheet via
	// cross-sheet refs.
	function getDependents(cellId, sheet = 'Sheet1') {
		ensure(sheet)
		const startKey = _key(sheet, cellId)
		const visited = new Set([startKey]), order = [], queue = [startKey]
		while (queue.length) {
			const k = queue.shift()
			const { sheet: tSheet, cellId: tCell } = _split(k)
			const bucket = reverseDep[tSheet]?.[tCell]
			if (!bucket) continue
			for (const depKey of bucket) {
				if (visited.has(depKey)) continue
				visited.add(depKey)
				order.push(_split(depKey))
				queue.push(depKey)
			}
		}
		return order
	}

	// Rebuild the entire dep graph for a sheet from raw data.
	function rebuild(sheetData, sheet = 'Sheet1') {
		ensure(sheet)
		// Drop only the edges that originate from this sheet; preserve any
		// inbound edges from other sheets (those get re-registered when their
		// owning sheet rebuilds, but we don't want to clobber them in passing).
		for (const cellId of Object.keys(depMap[sheet] || {})) removeEdges(cellId, sheet)
		// reverseDep[sheet] still holds *inbound* edges from *other* sheets'
		// formulas. Don't reset it wholesale.
		//
		// Only formula cells (value starting with '=') create edges, so skip
		// everything else without paying the per-cell register/removeEdges cost.
		// Iterate with for-in instead of Object.entries to avoid allocating a
		// 2M-entry pair array — that allocation + its GC was ~1.4s of the cold
		// load on a 2M-cell sheet (the rest of the cells aren't formulas).
		if (!sheetData) return
		for (const cellId in sheetData) {
			const value = sheetData[cellId]
			if (typeof value === 'string' && value.charCodeAt(0) === 61 /* '=' */) {
				register(cellId, value, sheet)
			}
		}
	}

	return { register, getDependents, rebuild }
}
