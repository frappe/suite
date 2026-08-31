// IronCalc-backed workbook adapter. Translates the command schema in
// commands.js into calls on @ironcalc/wasm's Model.
//
// Callers must initialise the wasm module first (init / initSync from
// '@ironcalc/wasm'); createWorkbook assumes it is ready.
//
// Commands address sheets by name; IronCalc addresses them by index. Names
// resolve against the live worksheet list on every call, so the mapping can
// never drift after sheet ops or undo/redo.

import { Model } from '@ironcalc/wasm'
import { validateCommand, CommandTypes } from './commands.js'

const LANGUAGE = 'en'

export class WorkbookError extends Error {
	constructor(message, { command = null, cause = null } = {}) {
		super(message)
		this.name = 'WorkbookError'
		this.command = command
		this.cause = cause
	}
}

function asWorkbookError(e, command) {
	if (e instanceof WorkbookError) {
		if (command && !e.command) e.command = command
		return e
	}
	return new WorkbookError(e?.message || String(e), { command, cause: e })
}

// Commands whose translation spans more than one engine call. A failure
// halfway through would leave partial state, so apply() snapshots first
// and restores on error.
const MULTI_CALL = new Set([
	CommandTypes.batch,
	CommandTypes.setFrozen,
	CommandTypes.setRangeStyle,
	CommandTypes.addSheet,
	CommandTypes.setDefinedName,
])

export function createWorkbook({ loadBytes = null, name = 'Workbook', locale = 'en', timezone = 'UTC' } = {}) {
	let model
	try {
		model = loadBytes
			? Model.from_bytes(loadBytes, LANGUAGE)
			: new Model(name, locale, timezone, LANGUAGE)
	} catch (e) {
		throw asWorkbookError(e, null)
	}

	let version = 0

	function sheetIndex(sheetName) {
		const i = model.getWorksheetsProperties().findIndex(p => p.name === sheetName)
		if (i === -1) throw new WorkbookError(`unknown sheet "${sheetName}"`)
		return i
	}

	function scopeIndex(scope) {
		return scope == null ? null : sheetIndex(scope)
	}

	function read(fn) {
		try { return fn() } catch (e) { throw asWorkbookError(e, null) }
	}

	// Rebuilding from bytes resets the native undo history. Only the failure
	// path of a multi-call command pays that cost, and a failed command is a
	// protocol error, so this is acceptable.
	function restore(bytes) {
		try {
			const fresh = Model.from_bytes(bytes, LANGUAGE)
			model.free()
			model = fresh
		} catch {
			// Keep the current model if the restore itself fails.
		}
	}

	function apply(cmd) {
		try {
			validateCommand(cmd)
		} catch (e) {
			throw asWorkbookError(e, cmd)
		}
		const snapshot = MULTI_CALL.has(cmd.type) ? model.toBytes() : null
		try {
			applyOne(cmd)
		} catch (e) {
			if (snapshot) restore(snapshot)
			throw asWorkbookError(e, cmd)
		}
		version += 1
		return { version }
	}

	function applyOne(cmd) {
		const p = cmd.payload
		switch (cmd.type) {
			case CommandTypes.setInput:
				return model.setUserInput(sheetIndex(p.sheet), p.row, p.col, p.input)
			// setUserArrayFormula pins the result to a fixed width × height
			// (CSE-style array). Dynamic-array spills go through setInput.
			case CommandTypes.setArrayFormula:
				return model.setUserArrayFormula(sheetIndex(p.sheet), p.row, p.col, p.width ?? 1, p.height ?? 1, p.input)
			case CommandTypes.clearContents: {
				const { r1, c1, r2, c2 } = p.range
				return model.rangeClearContents(sheetIndex(p.sheet), r1, c1, r2, c2)
			}
			// updateRangeStyle takes one (path, value) string pair per call,
			// e.g. ('font.b', 'true') or ('fill.color', '#FFEE00').
			case CommandTypes.setRangeStyle: {
				const { r1, c1, r2, c2 } = p.range
				const area = { sheet: sheetIndex(p.sheet), row: r1, column: c1, width: c2 - c1 + 1, height: r2 - r1 + 1 }
				for (const [path, value] of Object.entries(p.style)) {
					model.updateRangeStyle(area, path, String(value))
				}
				return
			}
			case CommandTypes.setColumnsWidth:
				return model.setColumnsWidth(sheetIndex(p.sheet), p.c1, p.c2, p.width)
			case CommandTypes.setRowsHeight:
				return model.setRowsHeight(sheetIndex(p.sheet), p.r1, p.r2, p.height)
			case CommandTypes.insertRows:
				return model.insertRows(sheetIndex(p.sheet), p.row, p.count)
			case CommandTypes.deleteRows:
				return model.deleteRows(sheetIndex(p.sheet), p.row, p.count)
			case CommandTypes.insertColumns:
				return model.insertColumns(sheetIndex(p.sheet), p.col, p.count)
			case CommandTypes.deleteColumns:
				return model.deleteColumns(sheetIndex(p.sheet), p.col, p.count)
			case CommandTypes.moveRows:
				return model.moveRows(sheetIndex(p.sheet), p.row, p.count, p.delta)
			case CommandTypes.moveColumns:
				return model.moveColumns(sheetIndex(p.sheet), p.col, p.count, p.delta)
			case CommandTypes.setFrozen: {
				const idx = sheetIndex(p.sheet)
				model.setFrozenRowsCount(idx, p.rows)
				model.setFrozenColumnsCount(idx, p.cols)
				return
			}
			// newSheet() takes no name; the sheet is appended, then renamed.
			case CommandTypes.addSheet: {
				model.newSheet()
				if (p.name) {
					model.renameSheet(model.getWorksheetsProperties().length - 1, p.name)
				}
				return
			}
			case CommandTypes.deleteSheet:
				return model.deleteSheet(sheetIndex(p.sheet))
			case CommandTypes.renameSheet:
				return model.renameSheet(sheetIndex(p.sheet), p.name)
			case CommandTypes.duplicateSheet:
				return model.duplicateSheet(sheetIndex(p.sheet))
			// Upsert: IronCalc splits create/update, the command does not.
			case CommandTypes.setDefinedName: {
				const scope = scopeIndex(p.scope)
				const existing = model.getDefinedNameList()
					.find(d => d.name === p.name && (d.scope ?? null) === scope)
				if (existing) return model.updateDefinedName(p.name, scope, p.name, scope, p.formula)
				return model.newDefinedName(p.name, scope, p.formula)
			}
			case CommandTypes.deleteDefinedName:
				return model.deleteDefinedName(p.name, scopeIndex(p.scope))
			case CommandTypes.batch: {
				model.pauseEvaluation()
				try {
					for (const sub of p.commands) applyOne(sub)
				} finally {
					model.resumeEvaluation()
				}
				return model.evaluate()
			}
			default:
				throw new WorkbookError(`unhandled command type "${cmd.type}"`)
		}
	}

	// Undo/redo are local (native IronCalc). They mutate state, so they bump
	// the version like any applied command. A no-op returns the version as is.
	function undo() {
		if (!read(() => model.canUndo())) return { version }
		read(() => model.undo())
		version += 1
		return { version }
	}

	function redo() {
		if (!read(() => model.canRedo())) return { version }
		read(() => model.redo())
		version += 1
		return { version }
	}

	return {
		apply,
		undo,
		redo,
		canUndo: () => read(() => model.canUndo()),
		canRedo: () => read(() => model.canRedo()),
		getDisplayValue: (sheet, row, col) => read(() => model.getFormattedCellValue(sheetIndex(sheet), row, col)),
		// The editable string: the formula (with '=') or the raw value.
		getInput: (sheet, row, col) => read(() => model.getCellContent(sheetIndex(sheet), row, col)),
		// ExtendedCellStyle: { style, icon, data_bar, rating }.
		getStyle: (sheet, row, col) => read(() => model.getCellStyle(sheetIndex(sheet), row, col)),
		getSheets: () => read(() => model.getWorksheetsProperties().map(p => p.name)),
		getFrozen: sheet => read(() => {
			const idx = sheetIndex(sheet)
			return { rows: model.getFrozenRowsCount(idx), cols: model.getFrozenColumnsCount(idx) }
		}),
		getColumnWidth: (sheet, col) => read(() => model.getColumnWidth(sheetIndex(sheet), col)),
		getRowHeight: (sheet, row) => read(() => model.getRowHeight(sheetIndex(sheet), row)),
		toBytes: () => read(() => model.toBytes()),
		getVersion: () => version,
	}
}
