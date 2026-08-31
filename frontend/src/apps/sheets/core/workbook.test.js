import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { createWorkbook, WorkbookError } from './workbook.js'
import { CommandTypes } from './commands.js'

// Node has no fetch-based wasm loading for the web-target package; feed the
// raw bytes to initSync instead.
const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const setInput = (wb, sheet, row, col, input) =>
	wb.apply(cmd(CommandTypes.setInput, { sheet, row, col, input }))

describe('workbook — formulas through commands', () => {
	it('evaluates SUM over a range', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, '1')
		setInput(wb, 'Sheet1', 2, 1, '2')
		setInput(wb, 'Sheet1', 3, 1, '3')
		setInput(wb, 'Sheet1', 4, 1, '=SUM(A1:A3)')
		expect(wb.getDisplayValue('Sheet1', 4, 1)).toBe('6')
		expect(wb.getInput('Sheet1', 4, 1)).toBe('=SUM(A1:A3)')
	})

	it('evaluates cross-sheet references', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
		expect(wb.getSheets()).toEqual(['Sheet1', 'Data'])
		setInput(wb, 'Data', 1, 1, '41')
		setInput(wb, 'Sheet1', 1, 1, '=Data!A1+1')
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('42')
	})

	it('evaluates XLOOKUP', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, 'apple')
		setInput(wb, 'Sheet1', 2, 1, 'banana')
		setInput(wb, 'Sheet1', 1, 2, '10')
		setInput(wb, 'Sheet1', 2, 2, '20')
		setInput(wb, 'Sheet1', 1, 3, '=XLOOKUP("banana",A1:A2,B1:B2)')
		expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('20')
	})

	it('spills SEQUENCE as a dynamic array', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, '=SEQUENCE(3)')
		expect([1, 2, 3].map(r => wb.getDisplayValue('Sheet1', r, 1))).toEqual(['1', '2', '3'])
	})

	it('pins setArrayFormula to its given dimensions', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.setArrayFormula, {
			sheet: 'Sheet1', row: 1, col: 1, width: 2, height: 2, input: '=SEQUENCE(2,2)',
		}))
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('1')
		expect(wb.getDisplayValue('Sheet1', 2, 2)).toBe('4')
	})
})

describe('workbook — structure ops', () => {
	it('insertRows adjusts references', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, '12')
		setInput(wb, 'Sheet1', 2, 1, '=A1*2')
		wb.apply(cmd(CommandTypes.insertRows, { sheet: 'Sheet1', row: 1, count: 1 }))
		expect(wb.getInput('Sheet1', 3, 1)).toBe('=A2*2')
		expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('24')
	})

	it('applies row heights, column widths, frozen panes, and styles', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.setColumnsWidth, { sheet: 'Sheet1', c1: 2, c2: 3, width: 120 }))
		wb.apply(cmd(CommandTypes.setRowsHeight, { sheet: 'Sheet1', r1: 5, r2: 5, height: 44 }))
		wb.apply(cmd(CommandTypes.setFrozen, { sheet: 'Sheet1', rows: 2, cols: 1 }))
		wb.apply(cmd(CommandTypes.setRangeStyle, {
			sheet: 'Sheet1',
			range: { r1: 1, c1: 1, r2: 2, c2: 2 },
			style: { 'font.b': true, 'fill.color': '#FFEE00' },
		}))
		expect(wb.getColumnWidth('Sheet1', 3)).toBe(120)
		expect(wb.getRowHeight('Sheet1', 5)).toBe(44)
		expect(wb.getFrozen('Sheet1')).toEqual({ rows: 2, cols: 1 })
		const style = wb.getStyle('Sheet1', 2, 2).style
		expect(style.font.b).toBe(true)
		expect(style.fill.color).toBe('#FFEE00')
	})

	it('clears contents and moves rows', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, 'a')
		setInput(wb, 'Sheet1', 2, 1, 'b')
		wb.apply(cmd(CommandTypes.moveRows, { sheet: 'Sheet1', row: 1, count: 1, delta: 1 }))
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('b')
		expect(wb.getDisplayValue('Sheet1', 2, 1)).toBe('a')
		wb.apply(cmd(CommandTypes.clearContents, { sheet: 'Sheet1', range: { r1: 1, c1: 1, r2: 2, c2: 1 } }))
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('')
		expect(wb.getDisplayValue('Sheet1', 2, 1)).toBe('')
	})

	it('renames, duplicates, and deletes sheets by name', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.renameSheet, { sheet: 'Sheet1', name: 'Main' }))
		wb.apply(cmd(CommandTypes.duplicateSheet, { sheet: 'Main' }))
		expect(wb.getSheets()).toEqual(['Main', 'Main (1)'])
		wb.apply(cmd(CommandTypes.deleteSheet, { sheet: 'Main (1)' }))
		expect(wb.getSheets()).toEqual(['Main'])
	})

	it('upserts and deletes defined names', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, '5')
		wb.apply(cmd(CommandTypes.setDefinedName, { name: 'TAX', formula: 'Sheet1!$A$1' }))
		setInput(wb, 'Sheet1', 1, 2, '=TAX*2')
		expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('10')
		setInput(wb, 'Sheet1', 2, 1, '7')
		wb.apply(cmd(CommandTypes.setDefinedName, { name: 'TAX', formula: 'Sheet1!$A$2' }))
		expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('14')
		wb.apply(cmd(CommandTypes.deleteDefinedName, { name: 'TAX' }))
		setInput(wb, 'Sheet1', 1, 3, '=TAX')
		expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('#NAME?')
	})
})

describe('workbook — versioning and errors', () => {
	it('bumps the version once per applied command', () => {
		const wb = createWorkbook()
		expect(wb.getVersion()).toBe(0)
		expect(setInput(wb, 'Sheet1', 1, 1, '1')).toEqual({ version: 1 })
		expect(setInput(wb, 'Sheet1', 2, 1, '2')).toEqual({ version: 2 })
	})

	it('a failed command throws WorkbookError and does not bump the version', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, '1')
		const bad = cmd(CommandTypes.setInput, { sheet: 'Nope', row: 1, col: 1, input: '1' })
		let caught
		try { wb.apply(bad) } catch (e) { caught = e }
		expect(caught).toBeInstanceOf(WorkbookError)
		expect(caught.command).toBe(bad)
		expect(caught.message).toMatch(/unknown sheet "Nope"/)
		expect(wb.getVersion()).toBe(1)
	})

	it('an invalid command shape also leaves the version alone', () => {
		const wb = createWorkbook()
		expect(() => wb.apply(cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 0, col: 1, input: '1' })))
			.toThrow(WorkbookError)
		expect(wb.getVersion()).toBe(0)
	})

	it('batch counts as one version and rolls back atomically on failure', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.batch, {
			commands: [
				cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '1' }),
				cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 2, col: 1, input: '2' }),
				cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 3, col: 1, input: '=A1+A2' }),
			],
		}))
		expect(wb.getVersion()).toBe(1)
		expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('3')

		const failing = cmd(CommandTypes.batch, {
			commands: [
				cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 2, input: 'x' }),
				cmd(CommandTypes.setInput, { sheet: 'Nope', row: 1, col: 1, input: 'y' }),
			],
		})
		expect(() => wb.apply(failing)).toThrow(WorkbookError)
		expect(wb.getVersion()).toBe(1)
		// The first sub-command must not stick: the pre-batch snapshot wins.
		expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('')
		expect(wb.getDisplayValue('Sheet1', 3, 1)).toBe('3')
	})

	it('undo/redo round trip', () => {
		const wb = createWorkbook()
		setInput(wb, 'Sheet1', 1, 1, 'hello')
		expect(wb.canUndo()).toBe(true)
		expect(wb.canRedo()).toBe(false)
		expect(wb.undo()).toEqual({ version: 2 })
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('')
		expect(wb.canRedo()).toBe(true)
		expect(wb.redo()).toEqual({ version: 3 })
		expect(wb.getDisplayValue('Sheet1', 1, 1)).toBe('hello')
		// No-op when there is nothing left to redo.
		expect(wb.redo()).toEqual({ version: 3 })
	})
})

describe('workbook — snapshots', () => {
	it('round-trips through toBytes/loadBytes', () => {
		const wb = createWorkbook()
		wb.apply(cmd(CommandTypes.addSheet, { name: 'Data' }))
		setInput(wb, 'Data', 1, 1, '3')
		setInput(wb, 'Sheet1', 1, 1, '=Data!A1^2')
		const copy = createWorkbook({ loadBytes: wb.toBytes() })
		expect(copy.getSheets()).toEqual(['Sheet1', 'Data'])
		expect(copy.getDisplayValue('Sheet1', 1, 1)).toBe('9')
		expect(copy.getInput('Sheet1', 1, 1)).toBe('=Data!A1^2')
		expect(copy.getVersion()).toBe(0)
	})
})

// ── Determinism / convergence ───────────────────────────────────────────────

function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// Seeded log of ~200 commands across values, formulas, styles, row/column
// ops, sheet ops, and batches. The generator tracks live sheet names so
// every command addresses an existing sheet.
function generateLog(seed, n = 200) {
	const rand = mulberry32(seed)
	const int = max => 1 + Math.floor(rand() * max)
	const pick = arr => arr[Math.floor(rand() * arr.length)]
	const sheets = ['Sheet1']
	const log = []
	let id = 0
	const make = (type, payload) => ({ id: `g${id}`, actor: 'gen', ts: id++, type, payload })
	const push = (type, payload) => log.push(make(type, payload))

	for (let i = 0; i < n; i++) {
		const sheet = pick(sheets)
		const r = rand()
		if (r < 0.32) {
			push(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: String(int(1000)) })
		} else if (r < 0.5) {
			push(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: `=SUM(A1:B5)+${int(9)}` })
		} else if (r < 0.62) {
			const r1 = int(15), c1 = int(6)
			push(CommandTypes.setRangeStyle, {
				sheet,
				range: { r1, c1, r2: r1 + int(3), c2: c1 + int(2) },
				style: pick([{ 'font.b': true }, { 'font.i': true }, { 'fill.color': '#D0E8FF' }, { 'num_fmt': '0.00' }]),
			})
		} else if (r < 0.69) {
			push(CommandTypes.insertRows, { sheet, row: int(10), count: 1 })
		} else if (r < 0.75) {
			push(CommandTypes.deleteRows, { sheet, row: int(10), count: 1 })
		} else if (r < 0.79) {
			push(CommandTypes.insertColumns, { sheet, col: int(6), count: 1 })
		} else if (r < 0.83) {
			const c1 = int(8)
			push(CommandTypes.setColumnsWidth, { sheet, c1, c2: c1, width: 40 + int(80) })
		} else if (r < 0.87) {
			push(CommandTypes.clearContents, { sheet, range: { r1: int(10), c1: int(4), r2: 12, c2: 6 } })
		} else if (r < 0.9 && sheets.length < 5) {
			const name = `Gen${id}`
			sheets.push(name)
			push(CommandTypes.addSheet, { name })
		} else if (r < 0.93 && sheets.length > 1) {
			const victim = sheets.splice(1 + Math.floor(rand() * (sheets.length - 1)), 1)[0]
			push(CommandTypes.deleteSheet, { sheet: victim })
		} else if (r < 0.96) {
			push(CommandTypes.setFrozen, { sheet, rows: int(3), cols: int(2) })
		} else {
			push(CommandTypes.batch, {
				commands: [
					make(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: String(int(99)) }),
					make(CommandTypes.setInput, { sheet, row: int(20), col: int(8), input: `=A1+${int(9)}` }),
				],
			})
		}
	}
	return log
}

function applyLog(wb, log) {
	// Failures must be deterministic too, so record them instead of throwing.
	return log.map(c => {
		try { return `v${wb.apply(c).version}` } catch (e) { return `err:${e.message}` }
	})
}

function snapshotState(wb) {
	const state = { sheets: wb.getSheets(), cells: {}, styles: {}, frozen: {} }
	for (const sheet of state.sheets) {
		state.frozen[sheet] = wb.getFrozen(sheet)
		for (let row = 1; row <= 30; row++) {
			for (let col = 1; col <= 12; col++) {
				const value = wb.getDisplayValue(sheet, row, col)
				const input = wb.getInput(sheet, row, col)
				if (value !== '' || input !== '') state.cells[`${sheet}!${row},${col}`] = `${input}→${value}`
			}
		}
		for (let row = 1; row <= 20; row++) {
			for (let col = 1; col <= 8; col++) {
				const s = wb.getStyle(sheet, row, col).style
				if (s.font.b || s.font.i || s.fill.color || s.num_fmt !== 'general') {
					state.styles[`${sheet}!${row},${col}`] = [s.font.b, s.font.i, s.fill.color, s.num_fmt].join('|')
				}
			}
		}
	}
	return state
}

describe('workbook — determinism', () => {
	it('the same command log converges on two fresh workbooks', () => {
		const log = generateLog(1337, 200)
		const a = createWorkbook()
		const b = createWorkbook()
		expect(applyLog(b, log)).toEqual(applyLog(a, log))
		expect(b.getSheets()).toEqual(a.getSheets())
		expect(snapshotState(b)).toEqual(snapshotState(a))
		// toBytes() is NOT byte-deterministic: two models built from the same
		// calls serialise differently (verified against @ironcalc/wasm 0.8.4),
		// so convergence is asserted at the value level above.
	})

	it('a snapshot loaded from bytes matches the source workbook', () => {
		const log = generateLog(42, 120)
		const wb = createWorkbook()
		applyLog(wb, log)
		const copy = createWorkbook({ loadBytes: wb.toBytes() })
		expect(snapshotState(copy)).toEqual(snapshotState(wb))
	})
})
