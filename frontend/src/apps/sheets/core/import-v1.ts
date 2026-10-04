// Builds the command that loads a v1 document (the old engine's cell maps)
// into a fresh IronCalc workbook.
//
// v1 stores each sheet as { "A1": raw, "B2": "=SUM(A1:A3)", ... } with
// A1-style ids. The result is one batch command, so IronCalc evaluates
// once at the end instead of after every cell.
//
// Only cell inputs are imported. Formats, merges, comments and the other
// feature layers stay with their v1 modules for now.

import { CommandTypes } from './commands.js'
import type { NonBatchCommand, BatchCommand } from './commands.js'

/** A v1 cell value: input text or a number; feature layers may leave objects. */
export type V1Value = string | number | boolean | null | object

export interface V1Sheet {
	name: string
	cells: { readonly [cellId: string]: V1Value }
}

const CELL_ID = /^([A-Z]+)([1-9]\d*)$/

/** "B3" → { row: 3, col: 2 } (1-based). null for anything else. */
export function parseA1(id: string): { row: number; col: number } | null {
	const m = CELL_ID.exec(id)
	if (!m || !m[1] || !m[2]) return null
	let col = 0
	for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
	return { row: Number(m[2]), col }
}

// v1 values are strings or numbers. Anything else (an empty value, an
// object left by a feature layer) has no cell input to import.
function inputOf(raw: V1Value): string | null {
	if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
	if (typeof raw === 'string' && raw !== '') return raw
	return null
}

export interface ImportResult {
	command: BatchCommand
	/** Cell ids that were not imported, per sheet. */
	skipped: Record<string, string[]>
}

/**
 * `defaultSheet` is the name of the one sheet a new workbook starts with.
 * The first v1 sheet takes it over (renamed if needed); the rest are added.
 */
export function importV1(sheets: V1Sheet[], { actor = 'import', defaultSheet = 'Sheet1' } = {}): ImportResult {
	let n = 0
	const ts = Date.now()
	const make = (type: string, payload: unknown) =>
		({ id: `import-${n++}`, actor, ts, type, payload }) as NonBatchCommand

	const commands: NonBatchCommand[] = []
	const skipped: Record<string, string[]> = {}

	sheets.forEach((sheet, i) => {
		if (i === 0) {
			if (sheet.name !== defaultSheet) {
				commands.push(make(CommandTypes.renameSheet, { sheet: defaultSheet, name: sheet.name }))
			}
		} else {
			commands.push(make(CommandTypes.addSheet, { name: sheet.name }))
		}
		for (const [id, raw] of Object.entries(sheet.cells)) {
			const at = parseA1(id)
			const input = inputOf(raw)
			if (!at || input === null) {
				if (raw !== '' && raw != null) (skipped[sheet.name] ??= []).push(id)
				continue
			}
			commands.push(make(CommandTypes.setInput, { sheet: sheet.name, row: at.row, col: at.col, input }))
		}
	})

	const command = {
		id: `import-${n++}`,
		actor,
		ts,
		type: CommandTypes.batch,
		payload: { commands },
	} as BatchCommand
	return { command, skipped }
}
