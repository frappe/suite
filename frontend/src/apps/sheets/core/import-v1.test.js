import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { importV1, parseA1 } from './import-v1.js'
import { createWorkbook } from './workbook.js'
import { validateCommand } from './commands.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

describe('parseA1', () => {
	it('parses 1-based row and column', () => {
		expect(parseA1('A1')).toEqual({ row: 1, col: 1 })
		expect(parseA1('Z10')).toEqual({ row: 10, col: 26 })
		expect(parseA1('AA3')).toEqual({ row: 3, col: 27 })
	})

	it('rejects anything that is not a cell id', () => {
		for (const id of ['', 'a1', 'A0', 'A01', '1A', 'A1:B2', 'Sheet1!A1']) expect(parseA1(id)).toBeNull()
	})
})

describe('importV1', () => {
	it('produces one valid batch command', () => {
		const { command } = importV1([{ name: 'Sheet1', cells: { A1: '1' } }])
		expect(command.type).toBe('batch')
		expect(() => validateCommand(command)).not.toThrow()
	})

	it('loads values and formulas that IronCalc evaluates', () => {
		const { command } = importV1([
			{ name: 'Sheet1', cells: { A1: '10', B1: 30, C1: '=AVERAGE(A1:B1)' } },
		])
		const wb = createWorkbook()
		wb.apply(command)
		expect(wb.getDisplayValue('Sheet1', 1, 3)).toBe('20')
		expect(wb.getDisplayValue('Sheet1', 1, 2)).toBe('30')
	})

	it('renames the first sheet and adds the rest, with cross-sheet refs', () => {
		const { command } = importV1([
			{ name: 'Budget', cells: { A1: '5' } },
			{ name: 'Summary', cells: { A1: '=Budget!A1*2' } },
		])
		const wb = createWorkbook()
		wb.apply(command)
		expect(wb.getSheets()).toEqual(['Budget', 'Summary'])
		expect(wb.getDisplayValue('Summary', 1, 1)).toBe('10')
	})

	it('skips empty values silently and reports unusable ones', () => {
		const { command, skipped } = importV1([
			{ name: 'Sheet1', cells: { A1: '', A2: null, A3: { kind: 'spark' }, bad: 'x', A4: 'ok' } },
		])
		expect(command.payload.commands).toHaveLength(1)
		expect(skipped).toEqual({ Sheet1: ['A3', 'bad'] })
	})
})
