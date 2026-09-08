// Yjs document factory + hydration helpers.
//
// One Y.Doc per workbook (per `Sheet` row in the backend). The doc holds the
// pieces of state that must converge across collaborators without losing
// data — cell values, cell formats, comments, sheet metadata. Lower-contention
// state (pivot configs, validation rules, sort/filter, cond-format) stays
// in the snapshot JSON for now; we'll fold it in later.
//
// Wire format on the backend is unchanged: we still persist `sheets_data` as
// a JSON blob via the existing `save_sheet` path. The Y.Doc's role is purely
// in-memory real-time conflict resolution. On open, we hydrate the Y.Doc
// from JSON; on save, we serialise it back. The op-log + snapshot system
// from `versioning/` keeps doing exactly what it does today.
//
// Document shape:
//
//   ydoc
//   ├─ Y.Map  'workbook'   { sheetNames: Y.Array<string>, current: string }
//   ├─ Y.Map  'cells'      { [sheetName]: Y.Map<cellId, rawValue> }
//   ├─ Y.Map  'formats'    { [sheetName]: Y.Map<cellId, formatObject> }
//   └─ Y.Map  'comments'   { [sheetName]: Y.Map<cellId, text> }

import * as Y from 'yjs'

/** Top-level Y.Doc map keys — single place to keep them in sync. */
export const ROOT = Object.freeze({
	WORKBOOK: 'workbook',
	CELLS:    'cells',
	FORMATS:  'formats',
	COMMENTS: 'comments',
})

const WORKBOOK_KEYS = Object.freeze({
	SHEET_NAMES: 'sheetNames',  // Y.Array<string>
	CURRENT:     'current',     // string
})

/** Fresh Y.Doc seeded with the top-level maps. */
export function createYDoc() {
	const doc = new Y.Doc()
	doc.getMap(ROOT.WORKBOOK)
	doc.getMap(ROOT.CELLS)
	doc.getMap(ROOT.FORMATS)
	doc.getMap(ROOT.COMMENTS)
	return doc
}

/**
 * Populate a Y.Doc from the plain-JSON snapshot we currently store on the
 * backend (the value returned by `sheet.snapshot()` + `formats.snapshot()`).
 * Wraps the writes in a single transaction so peers see one merged update
 * instead of N tiny ones during the hydrate phase.
 */
export function hydrateYDoc(doc, { sheet, formats, comments } = {}) {
	doc.transact(() => {
		_hydrateWorkbook(doc, sheet)
		_hydrateCells(doc, sheet?.sheets)
		_hydrateFormats(doc, formats)
		_hydrateComments(doc, comments)
	}, 'hydrate')
}

// ── internal hydrate helpers ───────────────────────────────────────────────

function _hydrateWorkbook(doc, sheet) {
	const wb = doc.getMap(ROOT.WORKBOOK)
	const names = Object.keys(sheet?.sheets || { Sheet1: {} })
	wb.set(WORKBOOK_KEYS.SHEET_NAMES, Y.Array.from(names))
	wb.set(WORKBOOK_KEYS.CURRENT, sheet?.current || names[0] || 'Sheet1')
}

function _hydrateCells(doc, sheets) {
	const root = doc.getMap(ROOT.CELLS)
	for (const [name, cells] of Object.entries(sheets || {})) {
		const m = new Y.Map()
		for (const [id, value] of Object.entries(cells || {})) m.set(id, value)
		root.set(name, m)
	}
}

function _hydrateFormats(doc, formats) {
	const root = doc.getMap(ROOT.FORMATS)
	for (const [name, cellFormats] of Object.entries(formats || {})) {
		const m = new Y.Map()
		for (const [id, fmt] of Object.entries(cellFormats || {})) m.set(id, fmt)
		root.set(name, m)
	}
}

function _hydrateComments(doc, comments) {
	const root = doc.getMap(ROOT.COMMENTS)
	for (const [name, cellComments] of Object.entries(comments || {})) {
		const m = new Y.Map()
		for (const [id, text] of Object.entries(cellComments || {})) m.set(id, text)
		root.set(name, m)
	}
}
