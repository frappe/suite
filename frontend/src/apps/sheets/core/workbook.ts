// IronCalc-backed workbook adapter. Translates the command schema in
// commands.ts into calls on @ironcalc/wasm's Model.
//
// Callers must initialise the wasm module first (init / initSync from
// '@ironcalc/wasm'); createWorkbook assumes it is ready.
//
// Commands address sheets by name; IronCalc addresses them by index. Names
// resolve against the live worksheet list on every call, so the mapping can
// never drift after sheet ops or undo/redo.

import { Model } from '@ironcalc/wasm'
import type { ExtendedCellStyle } from '@ironcalc/wasm'
import { validateCommand, CommandTypes } from './commands.js'
import type { Command, CommandType } from './commands.js'

const LANGUAGE = 'en'

export interface WorkbookErrorOptions {
	command?: unknown
	cause?: unknown
}

export class WorkbookError extends Error {
	// The command that failed, as received (it may not have passed validation).
	command: unknown

	constructor(message: string, { command = null, cause = null }: WorkbookErrorOptions = {}) {
		super(message, { cause })
		this.name = 'WorkbookError'
		this.command = command
	}
}

// IronCalc throws Error objects or plain strings across the wasm boundary.
function messageOf(e: unknown): string {
	if (e instanceof Error && e.message) return e.message
	return String(e)
}

function asWorkbookError(e: unknown, command: unknown): WorkbookError {
	if (e instanceof WorkbookError) {
		if (command && !e.command) e.command = command
		return e
	}
	return new WorkbookError(messageOf(e), { command, cause: e })
}

// Commands whose translation spans more than one engine call. A failure
// halfway through would leave partial state, so apply() snapshots first
// and restores on error.
const MULTI_CALL: ReadonlySet<CommandType> = new Set<CommandType>([
	CommandTypes.batch,
	CommandTypes.setFrozen,
	CommandTypes.setRangeStyle,
	CommandTypes.addSheet,
	CommandTypes.setDefinedName,
])

export interface CreateWorkbookOptions {
	loadBytes?: Uint8Array | null
	name?: string
	locale?: string
	timezone?: string
}

export interface VersionResult {
	version: number
}

export interface Workbook {
	apply(cmd: unknown): VersionResult
	undo(): VersionResult
	redo(): VersionResult
	canUndo(): boolean
	canRedo(): boolean
	getDisplayValue(sheet: string, row: number, col: number): string
	/** The editable string: the formula (with '=') or the raw value. */
	getInput(sheet: string, row: number, col: number): string
	getStyle(sheet: string, row: number, col: number): ExtendedCellStyle
	getSheets(): string[]
	getFrozen(sheet: string): { rows: number; cols: number }
	getColumnWidth(sheet: string, col: number): number
	getRowHeight(sheet: string, row: number): number
	toBytes(): Uint8Array
	getVersion(): number
}

export function createWorkbook({
	loadBytes = null,
	name = 'Workbook',
	locale = 'en',
	timezone = 'UTC',
}: CreateWorkbookOptions = {}): Workbook {
	let model: Model
	try {
		model = loadBytes
			? Model.from_bytes(loadBytes, LANGUAGE)
			: new Model(name, locale, timezone, LANGUAGE)
	} catch (e) {
		throw asWorkbookError(e, null)
	}

	let version = 0

	function sheetIndex(sheetName: string): number {
		const i = model.getWorksheetsProperties().findIndex(p => p.name === sheetName)
		if (i === -1) throw new WorkbookError(`unknown sheet "${sheetName}"`)
		return i
	}

	function scopeIndex(scope: string | null | undefined): number | null {
		return scope == null ? null : sheetIndex(scope)
	}

	function read<T>(fn: () => T): T {
		try { return fn() } catch (e) { throw asWorkbookError(e, null) }
	}

	// Rebuilding from bytes resets the native undo history. Only the failure
	// path of a multi-call command pays that cost, and a failed command is a
	// protocol error, so this is acceptable.
	function restore(bytes: Uint8Array): void {
		try {
			const fresh = Model.from_bytes(bytes, LANGUAGE)
			model.free()
			model = fresh
		} catch {
			// Keep the current model if the restore itself fails.
		}
	}

	function apply(input: unknown): VersionResult {
		let cmd: Command
		try {
			cmd = validateCommand(input)
		} catch (e) {
			throw asWorkbookError(e, input)
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

	function applyOne(cmd: Command): void {
		switch (cmd.type) {
			case CommandTypes.setInput: {
				const p = cmd.payload
				model.setUserInput(sheetIndex(p.sheet), p.row, p.col, p.input)
				return
			}
			// setUserArrayFormula pins the result to a fixed width × height
			// (CSE-style array). Dynamic-array spills go through setInput.
			case CommandTypes.setArrayFormula: {
				const p = cmd.payload
				model.setUserArrayFormula(sheetIndex(p.sheet), p.row, p.col, p.width ?? 1, p.height ?? 1, p.input)
				return
			}
			case CommandTypes.clearContents: {
				const { sheet, range: { r1, c1, r2, c2 } } = cmd.payload
				model.rangeClearContents(sheetIndex(sheet), r1, c1, r2, c2)
				return
			}
			// updateRangeStyle takes one (path, value) string pair per call,
			// e.g. ('font.b', 'true') or ('fill.color', '#FFEE00').
			case CommandTypes.setRangeStyle: {
				const { sheet, range: { r1, c1, r2, c2 }, style } = cmd.payload
				const area = { sheet: sheetIndex(sheet), row: r1, column: c1, width: c2 - c1 + 1, height: r2 - r1 + 1 }
				for (const [path, value] of Object.entries(style)) {
					model.updateRangeStyle(area, path, String(value))
				}
				return
			}
			case CommandTypes.setColumnsWidth: {
				const p = cmd.payload
				model.setColumnsWidth(sheetIndex(p.sheet), p.c1, p.c2, p.width)
				return
			}
			case CommandTypes.setRowsHeight: {
				const p = cmd.payload
				model.setRowsHeight(sheetIndex(p.sheet), p.r1, p.r2, p.height)
				return
			}
			case CommandTypes.insertRows: {
				const p = cmd.payload
				model.insertRows(sheetIndex(p.sheet), p.row, p.count)
				return
			}
			case CommandTypes.deleteRows: {
				const p = cmd.payload
				model.deleteRows(sheetIndex(p.sheet), p.row, p.count)
				return
			}
			case CommandTypes.insertColumns: {
				const p = cmd.payload
				model.insertColumns(sheetIndex(p.sheet), p.col, p.count)
				return
			}
			case CommandTypes.deleteColumns: {
				const p = cmd.payload
				model.deleteColumns(sheetIndex(p.sheet), p.col, p.count)
				return
			}
			case CommandTypes.moveRows: {
				const p = cmd.payload
				model.moveRows(sheetIndex(p.sheet), p.row, p.count, p.delta)
				return
			}
			case CommandTypes.moveColumns: {
				const p = cmd.payload
				model.moveColumns(sheetIndex(p.sheet), p.col, p.count, p.delta)
				return
			}
			case CommandTypes.setFrozen: {
				const p = cmd.payload
				const idx = sheetIndex(p.sheet)
				model.setFrozenRowsCount(idx, p.rows)
				model.setFrozenColumnsCount(idx, p.cols)
				return
			}
			// newSheet() takes no name; the sheet is appended, then renamed.
			case CommandTypes.addSheet: {
				model.newSheet()
				if (cmd.payload.name) {
					model.renameSheet(model.getWorksheetsProperties().length - 1, cmd.payload.name)
				}
				return
			}
			case CommandTypes.deleteSheet:
				model.deleteSheet(sheetIndex(cmd.payload.sheet))
				return
			case CommandTypes.renameSheet:
				model.renameSheet(sheetIndex(cmd.payload.sheet), cmd.payload.name)
				return
			case CommandTypes.duplicateSheet:
				model.duplicateSheet(sheetIndex(cmd.payload.sheet))
				return
			// Upsert: IronCalc splits create/update, the command does not.
			case CommandTypes.setDefinedName: {
				const p = cmd.payload
				const scope = scopeIndex(p.scope)
				const existing = model.getDefinedNameList()
					.find(d => d.name === p.name && (d.scope ?? null) === scope)
				if (existing) model.updateDefinedName(p.name, scope, p.name, scope, p.formula)
				else model.newDefinedName(p.name, scope, p.formula)
				return
			}
			case CommandTypes.deleteDefinedName:
				model.deleteDefinedName(cmd.payload.name, scopeIndex(cmd.payload.scope))
				return
			case CommandTypes.batch: {
				model.pauseEvaluation()
				try {
					for (const sub of cmd.payload.commands) applyOne(sub)
				} finally {
					model.resumeEvaluation()
				}
				model.evaluate()
				return
			}
		}
	}

	// Undo/redo are local (native IronCalc). They mutate state, so they bump
	// the version like any applied command. A no-op returns the version as is.
	function undo(): VersionResult {
		if (!read(() => model.canUndo())) return { version }
		read(() => model.undo())
		version += 1
		return { version }
	}

	function redo(): VersionResult {
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
		getInput: (sheet, row, col) => read(() => model.getCellContent(sheetIndex(sheet), row, col)),
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
