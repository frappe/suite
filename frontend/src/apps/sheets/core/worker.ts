// Worker host for the sheets core. Runs IronCalc and the workbook adapter
// off the main thread, so a long recalculation never blocks input.
//
// createWorkerHost() holds the protocol logic and is plain, synchronous
// code: tests drive it directly with request objects. The wiring at the
// bottom only runs inside a real Worker; it initialises wasm once and
// forwards messages to the host.
//
// Protocol: docs/sheets-rewrite-spec.md, section 1, "Message protocol".
// Every request carries a client-assigned reqId and every response echoes
// it. undo/redo are not here yet: they land with inverse-command undo.

import init from '@ironcalc/wasm'
import type { ExtendedCellStyle } from '@ironcalc/wasm'
import { createWorkbook, WorkbookError } from './workbook.js'
import type { Workbook } from './workbook.js'
import { MAX_VIEWPORT_CELLS } from './limits.js'

export type ReadWhat = 'display' | 'input' | 'style'

export interface ApplyResult {
	id: string | null
	ok: boolean
	error?: string
}

export interface CellRead {
	row: number
	col: number
	display?: string
	input?: string
	style?: ExtendedCellStyle
}

export interface ErrorBody {
	message: string
	command?: unknown
}

export type WorkerResponse =
	| { reqId: number; result: unknown }
	| { reqId: number; error: ErrorBody }

export interface WorkerHost {
	handle(request: unknown): WorkerResponse
}

class ProtocolError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ProtocolError'
	}
}

// Requests come through postMessage, so nothing about their shape is
// guaranteed. These helpers narrow one field at a time.
function field(obj: unknown, key: string): unknown {
	return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined
}

function int(obj: unknown, key: string): number {
	const v = field(obj, key)
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
		throw new ProtocolError(`"${key}" must be an integer >= 1`)
	}
	return v
}

function str(obj: unknown, key: string): string {
	const v = field(obj, key)
	if (typeof v !== 'string') throw new ProtocolError(`"${key}" must be a string`)
	return v
}

function optStr(obj: unknown, key: string): string | undefined {
	const v = field(obj, key)
	if (v === undefined) return undefined
	if (typeof v !== 'string') throw new ProtocolError(`"${key}" must be a string`)
	return v
}

// Realm-safe: a buffer cloned from another realm (an iframe, a test
// environment) fails `instanceof Uint8Array` but still has the right tag.
function isBytes(v: unknown): v is Uint8Array {
	return Object.prototype.toString.call(v) === '[object Uint8Array]'
}

function errorBody(e: unknown): ErrorBody {
	if (e instanceof WorkbookError) {
		return e.command == null ? { message: e.message } : { message: e.message, command: e.command }
	}
	return { message: e instanceof Error ? e.message : String(e) }
}

export function createWorkerHost(): WorkerHost {
	let wb: Workbook | null = null

	function workbook(): Workbook {
		if (!wb) throw new ProtocolError('workbook not initialised; send "init" first')
		return wb
	}

	function onInit(p: unknown) {
		const bytes = field(p, 'snapshotBytes')
		if (bytes != null && !isBytes(bytes)) {
			throw new ProtocolError('"snapshotBytes" must be a Uint8Array or null')
		}
		const opts: Parameters<typeof createWorkbook>[0] = { loadBytes: bytes ?? null }
		const name = optStr(p, 'name')
		const locale = optStr(p, 'locale')
		const timezone = optStr(p, 'timezone')
		if (name !== undefined) opts.name = name
		if (locale !== undefined) opts.locale = locale
		if (timezone !== undefined) opts.timezone = timezone
		wb = createWorkbook(opts)
		return { version: wb.getVersion(), sheets: wb.getSheets() }
	}

	// Each command succeeds or fails on its own; one bad command does not
	// stop the rest of the batch. A failed command leaves the workbook as
	// it was (workbook.apply restores multi-call commands on error).
	function onApply(p: unknown) {
		const w = workbook()
		const commands = field(p, 'commands')
		if (!Array.isArray(commands)) throw new ProtocolError('"commands" must be an array')
		const results: ApplyResult[] = commands.map(cmd => {
			const id = field(cmd, 'id')
			const result: ApplyResult = { id: typeof id === 'string' ? id : null, ok: true }
			try {
				w.apply(cmd)
			} catch (e) {
				result.ok = false
				result.error = errorBody(e).message
			}
			return result
		})
		return { version: w.getVersion(), results }
	}

	// One message per screen instead of one per cell: IronCalc has no batch
	// range read, so the per-cell loop runs here, next to the engine.
	function onReadViewport(p: unknown) {
		const w = workbook()
		const sheet = str(p, 'sheet')
		const r1 = int(p, 'r1'), c1 = int(p, 'c1'), r2 = int(p, 'r2'), c2 = int(p, 'c2')
		if (r2 < r1 || c2 < c1) throw new ProtocolError('empty range: r2 < r1 or c2 < c1')
		if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_VIEWPORT_CELLS) {
			throw new ProtocolError(`range exceeds ${MAX_VIEWPORT_CELLS} cells`)
		}
		const includeStyles = field(p, 'includeStyles') === true

		const values: string[][] = []
		const styles: ExtendedCellStyle[][] = []
		for (let r = r1; r <= r2; r++) {
			const valueRow: string[] = []
			const styleRow: ExtendedCellStyle[] = []
			for (let c = c1; c <= c2; c++) {
				valueRow.push(w.getDisplayValue(sheet, r, c))
				if (includeStyles) styleRow.push(w.getStyle(sheet, r, c))
			}
			values.push(valueRow)
			if (includeStyles) styles.push(styleRow)
		}
		return includeStyles ? { values, styles } : { values }
	}

	// Scattered reads for cold paths (editor open, Cmd+Arrow, autofit).
	function onReadCells(p: unknown) {
		const w = workbook()
		const sheet = str(p, 'sheet')
		const cells = field(p, 'cells')
		const what = field(p, 'what')
		if (!Array.isArray(cells)) throw new ProtocolError('"cells" must be an array')
		if (!Array.isArray(what)) throw new ProtocolError('"what" must be an array')
		const wantDisplay = what.includes('display')
		const wantInput = what.includes('input')
		const wantStyle = what.includes('style')

		return {
			cells: cells.map((cell: unknown): CellRead => {
				const row = int(cell, 'row'), col = int(cell, 'col')
				const out: CellRead = { row, col }
				if (wantDisplay) out.display = w.getDisplayValue(sheet, row, col)
				if (wantInput) out.input = w.getInput(sheet, row, col)
				if (wantStyle) out.style = w.getStyle(sheet, row, col)
				return out
			}),
		}
	}

	function onToBytes() {
		return { bytes: workbook().toBytes() }
	}

	function handle(request: unknown): WorkerResponse {
		const reqId = field(request, 'reqId')
		// Without a numeric reqId the client cannot match a reply, so -1
		// marks a response nobody is waiting for.
		const id = typeof reqId === 'number' ? reqId : -1
		try {
			if (id === -1) throw new ProtocolError('"reqId" must be a number')
			const type = field(request, 'type')
			const payload = field(request, 'payload')
			switch (type) {
				case 'init': return { reqId: id, result: onInit(payload) }
				case 'apply': return { reqId: id, result: onApply(payload) }
				case 'readViewport': return { reqId: id, result: onReadViewport(payload) }
				case 'readCells': return { reqId: id, result: onReadCells(payload) }
				case 'toBytes': return { reqId: id, result: onToBytes() }
				default: throw new ProtocolError(`unknown request type "${String(type)}"`)
			}
		} catch (e) {
			return { reqId: id, error: errorBody(e) }
		}
	}

	return { handle }
}

// Worker entry. Skipped under tests and on the main thread, where
// WorkerGlobalScope does not exist.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
	const scope = self as unknown as DedicatedWorkerGlobalScope
	const host = createWorkerHost()
	// Messages that arrive while wasm loads wait on this promise, so they
	// are still handled in the order they were sent.
	const ready = init()

	scope.onmessage = (event: MessageEvent<unknown>) => {
		void ready.then(
			() => {
				const response = host.handle(event.data)
				// Transfer the snapshot buffer instead of copying it.
				const bytes = 'result' in response ? field(response.result, 'bytes') : undefined
				scope.postMessage(response, isBytes(bytes) ? [bytes.buffer as ArrayBuffer] : [])
			},
			(e: unknown) => {
				const reqId = field(event.data, 'reqId')
				scope.postMessage({
					reqId: typeof reqId === 'number' ? reqId : -1,
					error: { message: `wasm failed to load: ${e instanceof Error ? e.message : String(e)}` },
				})
			},
		)
	}
}
