// Clipboard engine — internal copy/cut/paste + system clipboard TSV interchange.

import { colLabel, parseCellId } from '../utils/cells.js'
import { adjustFormula } from './formula-adjust.js'

export function createClipboard({ sheet, formats, condFormat = null, validation = null, getPivotAt = null, createPivotFromPaste = null }) {
	let _data    = null   // { 'dr,dc': rawValue }
	let _fmts    = null   // { 'dr,dc': formatObj }
	let _vals    = null   // { 'dr,dc': validationRule | null }
	let _mode    = null   // 'copy' | 'cut'
	let _srcSel  = null   // { r0, c0, r1, c1 } of the source
	let _pivot   = null   // portable pivot config when the source overlaps a pivot

	// ── Capture ───────────────────────────────────────────────────────────────

	function _capture(sel, mode) {
		const { r0, c0, r1, c1 } = sel
		_data = {}; _fmts = {}; _vals = {}; _mode = mode; _srcSel = sel
		// If the copied range overlaps a pivot, remember its config so a paste
		// can mint a new live pivot instead of dead values (Google Sheets UX).
		_pivot = getPivotAt ? getPivotAt(sel, sheet.getCurrentSheet()) : null
		for (let r = r0; r <= r1; r++) {
			for (let c = c0; c <= c1; c++) {
				const key = `${r - r0},${c - c0}`
				const id  = colLabel(c) + (r + 1)
				_data[key] = sheet.getCell(id)
				_fmts[key] = formats ? { ...formats.get(id, sheet.getCurrentSheet()) } : {}
				_vals[key] = validation ? validation.get(id, sheet.getCurrentSheet()) : null
			}
		}
	}

	// Write TSV to system clipboard (display values, tab-separated)
	function _writeSystem(sel) {
		const { r0, c0, r1, c1 } = sel
		const rows = []
		for (let r = r0; r <= r1; r++) {
			const cells = []
			for (let c = c0; c <= c1; c++)
				cells.push(String(sheet.getDisplayValue(colLabel(c) + (r + 1))).replace(/\t|\n/g, ' '))
			rows.push(cells.join('\t'))
		}
		// Guard `navigator` at the global level — Node < 21 (CI runs Node 20)
		// doesn't expose it, and optional-chaining only on `.clipboard` still
		// throws ReferenceError when `navigator` itself is undefined.
		if (typeof navigator !== 'undefined') {
			navigator.clipboard?.writeText(rows.join('\n')).catch(() => {})
		}
	}

	// ── Public ────────────────────────────────────────────────────────────────

	function copy(sel) {
		_capture(sel, 'copy')
		_writeSystem(sel)
	}

	function cut(sel) {
		_capture(sel, 'cut')
		_writeSystem(sel)
	}

	// Compute the (r, c) cells that should receive paste output, along with the
	// source (dr, dc) buffer offset to pull from for each.  Three modes:
	//   1. destSel matches the source size (or no destSel given) → anchor paste,
	//      one buffer cell per dest cell.
	//   2. destSel is multi-cell and source is 1×1 → tile the single value across
	//      every dest cell.  This is the "copy A1, paste B1:D1" UX.
	//   3. destSel is N×M and source is a divisor (k·rows, l·cols) → tile the
	//      source block across the destination (matches Google Sheets).
	function _resolveTargets(anch, destSel) {
		const targets = []
		const keys = Object.keys(_data)
		const srcRows = _srcSel ? (_srcSel.r1 - _srcSel.r0 + 1) : 1
		const srcCols = _srcSel ? (_srcSel.c1 - _srcSel.c0 + 1) : 1

		if (!destSel || (destSel.r0 === destSel.r1 && destSel.c0 === destSel.c1)) {
			for (const key of keys) {
				const [dr, dc] = key.split(',').map(Number)
				targets.push({ r: anch.row + dr, c: anch.col + dc, dr, dc })
			}
			return targets
		}

		const destRows = destSel.r1 - destSel.r0 + 1
		const destCols = destSel.c1 - destSel.c0 + 1
		const tileable = destRows % srcRows === 0 && destCols % srcCols === 0
		if (!tileable) {                                            // fall back to anchor paste
			for (const key of keys) {
				const [dr, dc] = key.split(',').map(Number)
				targets.push({ r: anch.row + dr, c: anch.col + dc, dr, dc })
			}
			return targets
		}
		for (let r = destSel.r0; r <= destSel.r1; r++) {
			for (let c = destSel.c0; c <= destSel.c1; c++) {
				const dr = (r - destSel.r0) % srcRows
				const dc = (c - destSel.c0) % srcCols
				targets.push({ r, c, dr, dc })
			}
		}
		return targets
	}

	// Paste the internal buffer at anchor cell.
	//   kind = 'all'      → values + formulas + formats (default)
	//        = 'values'   → captured display values only, no formulas or formats
	//        = 'formulas' → raw values/formulas only, leave formats untouched
	//        = 'formats'  → only formats; cell content untouched
	//   destSel = { r0, c0, r1, c1 } (optional) — when provided and the source is
	//             a single cell, the source is tiled across the entire dest range
	//             (Google-Sheets behaviour: copy A1, select B1:D1, paste → B/C/D).
	function paste(anchorId, historyPush, kind = 'all', destSel = null) {
		if (!_data) return
		const anch = parseCellId(anchorId)
		if (!anch) return
		const sh = sheet.getCurrentSheet()

		// A full paste of a copied pivot mints a new live pivot at the anchor
		// instead of writing static cells — the pivot renders its own output, so
		// writing the copied values first would just be overwritten (and would
		// drag the source sheet's formats along). Paste-special (values/formulas/
		// formats) skips this and pastes dead cells — the "just the numbers" path.
		// Returns the (async) render promise so the caller can await it before
		// snapshotting history.
		if (_pivot && kind === 'all' && createPivotFromPaste) {
			return createPivotFromPaste(_pivot, anchorId, sh)
		}

		const targets = _resolveTargets(anch, destSel)

		// Two-pass: build the cell-value map first, hand it to batchSetCells in
		// one shot so the engine does ONE dep-rebuild + ONE bulk notify instead
		// of N per-cell setCell calls (each of which parses deps, fires the
		// notify cascade, and — through collab's patched setCell — opens a Y.Doc
		// transaction). For a 5k-cell paste this cuts the value-write phase
		// from hundreds of ms to ~50 ms. Formats / validation stay per-cell
		// because those engines don't have a batch API yet.
		const writes = {}
		const wantValues = kind === 'all' || kind === 'formulas' || kind === 'values'
		if (wantValues) {
			for (const { r, c, dr, dc } of targets) {
				const id  = colLabel(c) + (r + 1)
				const key = `${dr},${dc}`
				const raw = _data[key]
				if (kind === 'all' || kind === 'formulas') {
					writes[id] = typeof raw === 'string' && raw.startsWith('=')
						? adjustFormula(raw, r - (_srcSel.r0 + dr), c - (_srcSel.c0 + dc))
						: raw
				} else {
					// 'values' — formulas paste as their computed display value.
					const isFormula = typeof raw === 'string' && raw.startsWith('=')
					writes[id] = isFormula ? _displayAt(key) : raw
				}
			}
			if (sheet.batchSetCells) {
				sheet.batchSetCells(writes, sh, { replace: false })
			} else {
				// Engine without batch API — fall back to per-cell loop.
				for (const [id, v] of Object.entries(writes)) sheet.setCell(id, v, sh)
			}
		}

		// Formats / validation pass — still per-cell, but skipped entirely when
		// the user picked Values or Formulas mode.
		if ((kind === 'all' || kind === 'formats') && (formats || validation)) {
			for (const { r, c, dr, dc } of targets) {
				const id  = colLabel(c) + (r + 1)
				const key = `${dr},${dc}`
				if (formats && _fmts[key]) formats.set(id, _fmts[key], sh)
				if (validation && _vals) {
					const rule = _vals[key]
					if (rule) validation.set(id, rule, sh)
					else      validation.clear(id, sh)
				}
			}
		}
		// Copy conditional-format rules to the destination range.
		if (condFormat && _srcSel && (kind === 'all' || kind === 'formats')) {
			const rows = _srcSel.r1 - _srcSel.r0, cols = _srcSel.c1 - _srcSel.c0
			const dest = { r0: anch.row, c0: anch.col, r1: anch.row + rows, c1: anch.col + cols }
			condFormat.addRulesForRange(_srcSel, dest, sh)
		}
		// Only consume the cut buffer when we actually moved content.
		if (_mode === 'cut' && _srcSel && (kind === 'all' || kind === 'values' || kind === 'formulas')) {
			const { r0, c0, r1, c1 } = _srcSel
			// Cells that just received the paste — when source and destination
			// overlap (e.g. cut C2:C7, paste at C3:C8) the clear pass must NOT
			// touch these or it wipes the content we just wrote. Only the source
			// cells outside the destination should be vacated.
			const destIds = new Set(targets.map(({ r, c }) => colLabel(c) + (r + 1)))
			const clears = {}
			for (let r = r0; r <= r1; r++)
				for (let c = c0; c <= c1; c++) {
					const id = colLabel(c) + (r + 1)
					if (destIds.has(id)) continue
					clears[id] = ''
					if (formats)    formats.clear(id, sh)
					if (validation) validation.clear(id, sh)
				}
			if (sheet.batchSetCells) sheet.batchSetCells(clears, sh, { replace: false })
			else                     for (const id of Object.keys(clears)) sheet.setCell(id, '', sh)
			_data = _fmts = _vals = _mode = _srcSel = _pivot = null
		}
		// Post-mutate snapshot — history.push() must run after the data has
		// settled so undo restores the correct state.
		historyPush?.()
	}

	// Display value captured at the time the source cell was copied/cut. Falls
	// back to the raw string when the captured value isn't a formula.
	function _displayAt(key) {
		const raw = _data[key]
		if (typeof raw !== 'string' || !raw.startsWith('=')) return raw
		// Use the sheet engine to evaluate against current state. The user may
		// have edited the source after copy — we accept that race for simplicity.
		const [dr, dc] = key.split(',').map(Number)
		if (!_srcSel) return raw
		const srcId = colLabel(_srcSel.c0 + dc) + (_srcSel.r0 + dr + 1)
		return sheet.getDisplayValue(srcId)
	}

	// Parse an HTML fragment's first <table> into a 2D grid of cell strings, or
	// null if there's no usable table. External apps (Gameplan, Google Sheets,
	// Excel Online, web pages) put a full <table> on the `text/html` clipboard
	// flavor — richer than their `text/plain` flavor, which some editors emit
	// without tab delimiters (so it collapses into a single column). colspan is
	// honored by padding blanks; rowspan is left as-is (rare, and its cell text
	// simply lands in the top row of the span).
	function parseHTMLTable(html) {
		if (!html || typeof DOMParser === 'undefined') return null
		const doc   = new DOMParser().parseFromString(html, 'text/html')
		const table = doc.querySelector('table')
		if (!table) return null
		const grid = []
		// Only the outer table's own rows/cells — a bare querySelectorAll('tr')
		// descends into any nested <table> inside a cell (common in web-page
		// clipboard HTML) and bleeds its rows into the outer grid. A nested
		// table's text still lands in the parent cell via textContent, which is
		// what we want.
		const rows = table.querySelectorAll(
			':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr',
		)
		for (const tr of rows) {
			const row = []
			for (const cell of tr.querySelectorAll(':scope > th, :scope > td')) {
				const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
				row.push(text)
				const span = parseInt(cell.getAttribute('colspan') || '1', 10)
				for (let i = 1; i < span; i++) row.push('')
			}
			grid.push(row)
		}
		// Drop trailing all-empty rows some editors append.
		while (grid.length && grid[grid.length - 1].every(c => c === '')) grid.pop()
		return grid.length ? grid : null
	}

	// Paste an HTML-table grid (from an external app's `text/html` flavor).
	// Shares the placement/tiling/bulk-write path with pasteFromText.
	function pasteFromHTML(html, anchorId, historyPush, destSel = null) {
		const grid = parseHTMLTable(html)
		if (!grid) return false
		return _pasteGrid(grid, anchorId, historyPush, destSel)
	}

	// Paste raw text (from system clipboard / external app).  Honors destSel so
	// pasting a single token into a multi-cell selection fills the whole range.
	function pasteFromText(text, anchorId, historyPush, destSel = null) {
		if (!text?.trim()) return
		return _pasteGrid(_textToGrid(text), anchorId, historyPush, destSel)
	}

	// Split raw clipboard text into a 2D grid (tab = column, newline = row).
	// Shared by pasteFromText and measureTextPaste so the write and the undo
	// capture agree on exactly what a text paste covers.
	function _textToGrid(text) {
		const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd().split('\n')
		return lines.map(l => l.split('\t'))
	}

	// Geometry of a grid paste: its source dimensions and whether it tiles across
	// the destination. Single source of truth for both the write (_pasteGrid) and
	// the undo-capture bounds (_gridRect) — an external paste's extent must never
	// be computed two different ways, or undo silently under-covers the write.
	function _gridGeometry(grid, anch, destSel) {
		const srcRows = grid.length
		const srcCols = grid.reduce((m, r) => Math.max(m, r.length), 0)
		const tileable = destSel
			&& !(destSel.r0 === destSel.r1 && destSel.c0 === destSel.c1)
			&& ((destSel.r1 - destSel.r0 + 1) % srcRows === 0)
			&& ((destSel.c1 - destSel.c0 + 1) % srcCols === 0)
		return { srcRows, srcCols, tileable }
	}

	// The destination rect a grid paste will actually write. A tiled paste fills
	// exactly destSel; otherwise it's the anchor plus the grid's own dimensions.
	function _gridRect(grid, anchorId, destSel = null) {
		const anch = parseCellId(anchorId)
		if (!anch) return null
		const { srcRows, srcCols, tileable } = _gridGeometry(grid, anch, destSel)
		if (tileable) return { r0: destSel.r0, c0: destSel.c0, r1: destSel.r1, c1: destSel.c1 }
		return { r0: anch.row, c0: anch.col, r1: anch.row + srcRows - 1, c1: anch.col + srcCols - 1 }
	}

	// Extent an external text paste would cover, WITHOUT writing anything. Lets
	// the editor size its undo capture to the full pasted block instead of just
	// the clicked cell (the internal copy/paste path gets this from
	// getSourceSel(); an external paste has no source selection to read).
	function measureTextPaste(text, anchorId, destSel = null) {
		if (!text?.trim()) return null
		return _gridRect(_textToGrid(text), anchorId, destSel)
	}

	// Extent an external HTML-table paste would cover, WITHOUT writing anything.
	function measureHTMLPaste(html, anchorId, destSel = null) {
		const grid = parseHTMLTable(html)
		if (!grid) return null
		return _gridRect(grid, anchorId, destSel)
	}

	// Place a 2D grid of cell strings at the anchor (or tiled across destSel),
	// then ship one bulk write. Shared by pasteFromText and pasteFromHTML.
	function _pasteGrid(grid, anchorId, historyPush, destSel = null) {
		const anch = parseCellId(anchorId)
		if (!anch) return false
		const { srcRows, srcCols, tileable } = _gridGeometry(grid, anch, destSel)

		// Build the cell map first, then ship one bulk write — same reason as
		// paste() above. Big external pastes (Excel/CSV via system clipboard)
		// were the worst case here.
		const writes = {}
		if (tileable) {
			for (let r = destSel.r0; r <= destSel.r1; r++) {
				for (let c = destSel.c0; c <= destSel.c1; c++) {
					const dr = (r - destSel.r0) % srcRows
					const dc = (c - destSel.c0) % srcCols
					writes[colLabel(c) + (r + 1)] = grid[dr][dc] ?? ''
				}
			}
		} else {
			grid.forEach((row, dr) =>
				row.forEach((val, dc) => {
					writes[colLabel(anch.col + dc) + (anch.row + dr + 1)] = val
				}))
		}
		const sn = sheet.getCurrentSheet()
		if (sheet.batchSetCells) sheet.batchSetCells(writes, sn, { replace: false })
		else                     for (const [id, v] of Object.entries(writes)) sheet.setCell(id, v, sn)
		historyPush?.()   // post-mutate snapshot
		return true
	}

	// Expand selection to fit pasted content (used for visual feedback).
	function hasData() { return !!_data }
	function getMode() { return _mode }
	function getSourceSel() { return _data ? _srcSel : null }
	// The pivot config captured on copy, if the source overlapped a pivot. Lets
	// the paste dispatcher branch its undo bookkeeping (a pivot paste needs a
	// full snapshot, not the cell-diff op).
	function getPivotBlob() { return _data ? _pivot : null }
	function clear() { _data = _fmts = _vals = _mode = _srcSel = _pivot = null }

	return { copy, cut, paste, pasteFromText, pasteFromHTML, measureTextPaste, measureHTMLPaste, hasData, getMode, getSourceSel, getPivotBlob, clear }
}
