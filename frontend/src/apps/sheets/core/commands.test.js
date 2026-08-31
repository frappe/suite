import { describe, it, expect } from 'vitest'
import { validateCommand, CommandTypes } from './commands.js'

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })

describe('validateCommand — envelope', () => {
	it('accepts a well-formed command and returns it', () => {
		const c = cmd(CommandTypes.setInput, { sheet: 'Sheet1', row: 1, col: 1, input: '12' })
		expect(validateCommand(c)).toBe(c)
	})

	it('rejects non-objects', () => {
		expect(() => validateCommand(null)).toThrow(/plain object/)
		expect(() => validateCommand([])).toThrow(/plain object/)
	})

	it('rejects a missing or empty id / actor / ts', () => {
		const base = cmd(CommandTypes.addSheet, {})
		expect(() => validateCommand({ ...base, id: '' })).toThrow(/"id"/)
		expect(() => validateCommand({ ...base, actor: undefined })).toThrow(/"actor"/)
		expect(() => validateCommand({ ...base, ts: 'now' })).toThrow(/"ts"/)
	})

	it('rejects unknown types and non-object payloads', () => {
		expect(() => validateCommand(cmd('explodeSheet', {}))).toThrow(/unknown type "explodeSheet"/)
		expect(() => validateCommand({ ...cmd(CommandTypes.setInput, {}), payload: null })).toThrow(/"payload"/)
	})
})

describe('validateCommand — payloads', () => {
	it('accepts one valid example of every type', () => {
		const range = { r1: 1, c1: 1, r2: 3, c2: 2 }
		const ok = [
			[CommandTypes.setInput, { sheet: 'S', row: 1, col: 1, input: '=A1' }],
			[CommandTypes.setArrayFormula, { sheet: 'S', row: 1, col: 1, input: '=SEQUENCE(2,2)', width: 2, height: 2 }],
			[CommandTypes.clearContents, { sheet: 'S', range }],
			[CommandTypes.setRangeStyle, { sheet: 'S', range, style: { 'font.b': true, 'fill.color': '#FFEE00' } }],
			[CommandTypes.setColumnsWidth, { sheet: 'S', c1: 1, c2: 3, width: 120 }],
			[CommandTypes.setRowsHeight, { sheet: 'S', r1: 2, r2: 2, height: 40 }],
			[CommandTypes.insertRows, { sheet: 'S', row: 1, count: 2 }],
			[CommandTypes.deleteRows, { sheet: 'S', row: 1, count: 1 }],
			[CommandTypes.insertColumns, { sheet: 'S', col: 1, count: 1 }],
			[CommandTypes.deleteColumns, { sheet: 'S', col: 2, count: 2 }],
			[CommandTypes.moveRows, { sheet: 'S', row: 2, count: 1, delta: -1 }],
			[CommandTypes.moveColumns, { sheet: 'S', col: 1, count: 1, delta: 2 }],
			[CommandTypes.setFrozen, { sheet: 'S', rows: 0, cols: 2 }],
			[CommandTypes.addSheet, {}],
			[CommandTypes.addSheet, { name: 'Data' }],
			[CommandTypes.deleteSheet, { sheet: 'S' }],
			[CommandTypes.renameSheet, { sheet: 'S', name: 'T' }],
			[CommandTypes.duplicateSheet, { sheet: 'S' }],
			[CommandTypes.setDefinedName, { name: 'TAX', formula: 'Sheet1!$A$1' }],
			[CommandTypes.setDefinedName, { name: 'TAX', scope: 'S', formula: 'Sheet1!$A$1' }],
			[CommandTypes.deleteDefinedName, { name: 'TAX', scope: null }],
		]
		for (const [type, payload] of ok) {
			expect(() => validateCommand(cmd(type, payload)), type).not.toThrow()
		}
	})

	it('rejects 0-based and non-integer positions', () => {
		expect(() => validateCommand(cmd(CommandTypes.setInput, { sheet: 'S', row: 0, col: 1, input: 'x' }))).toThrow(/"row"/)
		expect(() => validateCommand(cmd(CommandTypes.setInput, { sheet: 'S', row: 1, col: 1.5, input: 'x' }))).toThrow(/"col"/)
	})

	it('rejects inverted ranges and spans', () => {
		expect(() => validateCommand(cmd(CommandTypes.clearContents, { sheet: 'S', range: { r1: 3, c1: 1, r2: 1, c2: 1 } })))
			.toThrow(/range end/)
		expect(() => validateCommand(cmd(CommandTypes.setColumnsWidth, { sheet: 'S', c1: 3, c2: 1, width: 90 })))
			.toThrow(/"c2"/)
	})

	it('rejects empty or non-scalar style patches', () => {
		const range = { r1: 1, c1: 1, r2: 1, c2: 1 }
		expect(() => validateCommand(cmd(CommandTypes.setRangeStyle, { sheet: 'S', range, style: {} }))).toThrow(/not be empty/)
		expect(() => validateCommand(cmd(CommandTypes.setRangeStyle, { sheet: 'S', range, style: { 'font.b': { b: 1 } } })))
			.toThrow(/string, number, or boolean/)
	})

	it('rejects a zero delta for move commands', () => {
		expect(() => validateCommand(cmd(CommandTypes.moveRows, { sheet: 'S', row: 1, count: 1, delta: 0 }))).toThrow(/"delta"/)
	})
})

describe('validateCommand — batch', () => {
	it('accepts a batch of valid commands', () => {
		const batch = cmd(CommandTypes.batch, {
			commands: [
				cmd(CommandTypes.setInput, { sheet: 'S', row: 1, col: 1, input: '1' }),
				cmd(CommandTypes.insertRows, { sheet: 'S', row: 1, count: 1 }),
			],
		})
		expect(() => validateCommand(batch)).not.toThrow()
	})

	it('rejects an empty batch', () => {
		expect(() => validateCommand(cmd(CommandTypes.batch, { commands: [] }))).toThrow(/non-empty array/)
	})

	it('rejects an invalid sub-command', () => {
		const batch = cmd(CommandTypes.batch, {
			commands: [cmd(CommandTypes.setInput, { sheet: 'S', row: 0, col: 1, input: '1' })],
		})
		expect(() => validateCommand(batch)).toThrow(/"row"/)
	})

	it('rejects nested batches', () => {
		const inner = cmd(CommandTypes.batch, {
			commands: [cmd(CommandTypes.addSheet, {})],
		})
		expect(() => validateCommand(cmd(CommandTypes.batch, { commands: [inner] }))).toThrow(/nested batch/)
	})
})
