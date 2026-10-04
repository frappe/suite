import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initSync } from '@ironcalc/wasm'
import { createWorkerHost } from './worker.js'
import { MAX_VIEWPORT_CELLS } from './limits.js'
import { CommandTypes } from './commands.js'

const require = createRequire(import.meta.url)
initSync({ module: fs.readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) })

let seq = 0
const cmd = (type, payload) => ({ id: `c${seq++}`, actor: 'test', ts: seq, type, payload })
const setInput = (sheet, row, col, input) => cmd(CommandTypes.setInput, { sheet, row, col, input })

let host
let reqId
const send = (type, payload = {}) => host.handle({ reqId: ++reqId, type, payload })
const ok = (type, payload) => {
	const res = send(type, payload)
	expect(res.error).toBeUndefined()
	expect(res.reqId).toBe(reqId)
	return res.result
}

beforeEach(() => {
	host = createWorkerHost()
	reqId = 0
})

describe('worker host — init', () => {
	it('creates an empty workbook', () => {
		expect(ok('init', { snapshotBytes: null })).toEqual({ version: 0, sheets: ['Sheet1'] })
	})

	it('restores from snapshot bytes', () => {
		ok('init', { snapshotBytes: null })
		ok('apply', { commands: [setInput('Sheet1', 1, 1, '42')] })
		const { bytes } = ok('toBytes')
		expect(bytes).toBeInstanceOf(Uint8Array)

		host = createWorkerHost()
		ok('init', { snapshotBytes: bytes })
		expect(ok('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 }).values).toEqual([['42']])
	})

	it('rejects requests before init', () => {
		const res = send('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 })
		expect(res.error.message).toMatch(/not initialised/)
	})
})

describe('worker host — apply', () => {
	beforeEach(() => ok('init', { snapshotBytes: null }))

	it('applies commands and bumps the version once per command', () => {
		const a = setInput('Sheet1', 1, 1, '10')
		const b = setInput('Sheet1', 2, 1, '=A1*2')
		const result = ok('apply', { commands: [a, b] })
		expect(result).toEqual({
			version: 2,
			results: [{ id: a.id, ok: true }, { id: b.id, ok: true }],
		})
	})

	it('reports a bad command without stopping the rest', () => {
		const bad = setInput('Nope', 1, 1, 'x')
		const good = setInput('Sheet1', 1, 1, 'y')
		const { version, results } = ok('apply', { commands: [bad, good] })
		expect(results[0]).toMatchObject({ id: bad.id, ok: false })
		expect(results[0].error).toMatch(/unknown sheet/)
		expect(results[1]).toEqual({ id: good.id, ok: true })
		expect(version).toBe(1)
	})

	it('reports an invalid command with id null when it has no id', () => {
		const { results } = ok('apply', { commands: [{ type: 'setInput' }] })
		expect(results[0]).toMatchObject({ id: null, ok: false })
	})

	it('rejects a payload without a commands array', () => {
		expect(send('apply', {}).error.message).toMatch(/commands/)
	})
})

describe('worker host — reads', () => {
	beforeEach(() => {
		ok('init', { snapshotBytes: null })
		ok('apply', {
			commands: [
				setInput('Sheet1', 1, 1, '10'),
				setInput('Sheet1', 1, 2, '20'),
				setInput('Sheet1', 2, 1, '30'),
				setInput('Sheet1', 2, 2, '=AVERAGE(A1:B1)'),
				cmd(CommandTypes.setRangeStyle, {
					sheet: 'Sheet1', range: { r1: 1, c1: 1, r2: 1, c2: 1 }, style: { 'font.b': true },
				}),
			],
		})
	})

	it('readViewport returns evaluated values row by row', () => {
		const result = ok('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: 2, c2: 3 })
		expect(result).toEqual({ values: [['10', '20', ''], ['30', '15', '']] })
	})

	it('readViewport includes styles only when asked', () => {
		const { styles } = ok('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 2, includeStyles: true })
		expect(styles[0][0].style.font.b).toBe(true)
		expect(styles[0][1].style.font.b).toBeFalsy()
		expect(ok('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: 1, c2: 1 }).styles).toBeUndefined()
	})

	it('readViewport rejects bad and oversized ranges', () => {
		expect(send('readViewport', { sheet: 'Sheet1', r1: 0, c1: 1, r2: 1, c2: 1 }).error.message).toMatch(/r1/)
		expect(send('readViewport', { sheet: 'Sheet1', r1: 5, c1: 1, r2: 1, c2: 1 }).error.message).toMatch(/empty range/)
		const rows = Math.ceil(MAX_VIEWPORT_CELLS / 10) + 1
		expect(send('readViewport', { sheet: 'Sheet1', r1: 1, c1: 1, r2: rows, c2: 10 }).error.message).toMatch(/exceeds/)
	})

	it('readViewport reports an unknown sheet', () => {
		expect(send('readViewport', { sheet: 'Nope', r1: 1, c1: 1, r2: 1, c2: 1 }).error.message).toMatch(/unknown sheet/)
	})

	it('readCells returns only the requested parts', () => {
		const { cells } = ok('readCells', {
			sheet: 'Sheet1',
			cells: [{ row: 2, col: 2 }, { row: 1, col: 1 }],
			what: ['display', 'input'],
		})
		expect(cells).toEqual([
			{ row: 2, col: 2, display: '15', input: '=AVERAGE(A1:B1)' },
			{ row: 1, col: 1, display: '10', input: '10' },
		])
	})
})

describe('worker host — protocol errors', () => {
	it('echoes reqId on errors', () => {
		const res = host.handle({ reqId: 7, type: 'bogus', payload: {} })
		expect(res).toEqual({ reqId: 7, error: { message: 'unknown request type "bogus"' } })
	})

	it('answers a request without reqId with reqId -1', () => {
		expect(host.handle({ type: 'init', payload: {} }).reqId).toBe(-1)
		expect(host.handle(null).reqId).toBe(-1)
	})
})
