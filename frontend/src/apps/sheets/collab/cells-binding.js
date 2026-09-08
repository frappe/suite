// Bridge between the sheet engine and the Y.Doc.
//
// The engine remains the source of truth for *computed* state (formulas,
// dependency graph, display values). The Y.Doc is the source of truth for
// *raw* cell values across collaborators. Bindings keep them in sync:
//
//   * Local edit  → engine.setCell → bind notifies Y.Map.set
//   * Remote edit → Y.Map observe → bind calls engine.setCell
//
// We tag every transaction with an `origin` so we don't echo back our own
// changes (the classic Yjs binding pattern). Local writes use origin
// `LOCAL_ORIGIN`; we ignore observe events that carry it.

import * as Y from 'yjs'
import { ROOT } from './ydoc.js'

const LOCAL_ORIGIN  = Symbol('local')
export const REMOTE_ORIGIN = Symbol('remote')

/**
 * Wire a sheet engine to a Y.Doc. Returns a `dispose()` you must call on
 * teardown (component unmount, sheet change) to detach observers.
 *
 * @param {object}  opts
 * @param {Y.Doc}   opts.doc
 * @param {object}  opts.sheet         - sheet engine (from createSheet())
 * @param {(name: string) => void} [opts.onRemoteSheetChange]
 *                                       Called after a remote update has
 *                                       touched the named sub-sheet. The
 *                                       consumer typically triggers a
 *                                       canvas repaint for that sheet.
 */
export function bindCells({ doc, sheet, onRemoteSheetChange } = {}) {
	if (!doc || !sheet) throw new Error('bindCells: doc and sheet are required')

	const cellsRoot = doc.getMap(ROOT.CELLS)
	const perSheetObservers = new Map()  // sheetName → unobserve()

	// Track which `sheetName|cellId` keys this client has touched since the
	// last `drainLocalTouches()`. Undo uses this to revert only OUR local
	// writes, leaving cells that were touched only by remote peers alone —
	// which is the difference between "per-client undo" and the older
	// "wipe-everything" snapshot restore.
	const _localTouches = new Set()

	// Patch the engine's setCell so every local write also lands in Y.Map.
	// We keep the original behaviour (notify listeners, register deps, etc.)
	// and add the Yjs mirror on the way out.
	//
	// CRITICAL: both the per-sheet `Y.Map` creation (when the sub-sheet
	// doesn't exist yet) and the cell write MUST happen inside the same
	// `doc.transact(…, LOCAL_ORIGIN)`. Otherwise the parent-map `set` runs
	// in an implicit transaction with `undefined` origin, the relay treats
	// it as remote (it isn't LOCAL_ORIGIN), and the cell write that follows
	// arrives at peers without the parent map being present — silent loss.
	const _origSetCell = sheet.setCell.bind(sheet)
	sheet.setCell = function patchedSetCell(id, value, sheetName) {
		_origSetCell(id, value, sheetName)
		const targetSheet = sheetName || sheet.getCurrentSheet()
		_localTouches.add(`${targetSheet}|${id}`)
		const valueOrUndef = (value === '' || value == null) ? undefined : value
		doc.transact(() => {
			const map = _ensureSheetMap(cellsRoot, targetSheet)
			if (valueOrUndef === undefined) map.delete(id)
			else                            map.set(id, valueOrUndef)
		}, LOCAL_ORIGIN)
	}

	// For each sub-sheet that already exists in the doc, attach an observer
	// and replay its current contents into the engine. New sub-sheets attach
	// lazily through the root observer below.
	for (const [name, inner] of cellsRoot.entries()) {
		if (inner instanceof Y.Map) _attachSheetObserver(name, inner, true)
	}

	const rootObserver = (event) => {
		const isRemote = event.transaction.origin !== LOCAL_ORIGIN
		event.changes.keys.forEach((change, name) => {
			if (change.action === 'delete') {
				_detachSheetObserver(name)
				return
			}
			// 'add' or 'update': in both cases the value at this key is a
			// (possibly new) Y.Map we need to observe. 'update' happens when
			// two peers concurrently created their own Y.Map under the same
			// key and Yjs LWW-picked one of them — the parent value just
			// flipped to a different Y.Map and we have to switch observers.
			//
			// We still attach observers for *local* additions (so future
			// remote writes hit them) but skip the engine replay because the
			// local patched setCell already updated the engine directly.
			const inner = cellsRoot.get(name)
			if (inner instanceof Y.Map) {
				_attachSheetObserver(name, inner, isRemote)
				if (isRemote) onRemoteSheetChange?.(name)
			}
		})
	}
	cellsRoot.observe(rootObserver)

	function _attachSheetObserver(name, m, replayExisting = false) {
		_detachSheetObserver(name)
		// When a sheet Y.Map arrives populated (e.g. created and filled in
		// the same transaction, or replaced wholesale via a CRDT key
		// resolution), the inner-Map observer we're about to register has
		// no chance to see those writes. Replay them through the engine
		// directly so the local store catches up.
		if (replayExisting) {
			for (const [cellId, value] of m.entries()) {
				_origSetCell(cellId, value, name)
			}
		}
		const handler = (event) => {
			if (event.transaction.origin === LOCAL_ORIGIN) return
			event.changes.keys.forEach((change, cellId) => {
				const value = change.action === 'delete' ? '' : m.get(cellId)
				_origSetCell(cellId, value, name)
			})
			onRemoteSheetChange?.(name)
		}
		m.observe(handler)
		perSheetObservers.set(name, () => m.unobserve(handler))
	}

	function _detachSheetObserver(name) {
		const fn = perSheetObservers.get(name)
		if (fn) { fn(); perSheetObservers.delete(name) }
	}

	function dispose() {
		sheet.setCell = _origSetCell
		cellsRoot.unobserve(rootObserver)
		for (const off of perSheetObservers.values()) off()
		perSheetObservers.clear()
	}

	// Returns + clears the set of locally-touched cells. Callers use this
	// alongside each history-push to remember "what did THIS undo segment
	// touch" so the eventual restore can revert only those cells, not all
	// cells (which would clobber concurrent remote writes).
	function drainLocalTouches() {
		const out = new Set(_localTouches)
		_localTouches.clear()
		return out
	}

	return { dispose, drainLocalTouches }
}

function _ensureSheetMap(root, name) {
	let m = root.get(name)
	if (!(m instanceof Y.Map)) {
		m = new Y.Map()
		root.set(name, m)
	}
	return m
}
