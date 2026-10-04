// Main-thread proxy for the sheets core worker, and the CommandDispatcher.
//
// Owns the only connection to the worker. Everything on the main thread
// (canvas, editor, feature layers) talks to the engine through this file.
//
// - request(): posts { reqId, type, payload } and resolves when the
//   response with the same reqId comes back.
// - dispatch(): validates a command, echoes setInput into the display
//   cache, and queues it. One `apply` is in flight at a time; commands
//   dispatched meanwhile go out together in the next one.
// - onVersion(): fires when the engine version changes. Every cached
//   value may be stale at that point.
//
// Imports from worker.ts are type-only, so the main-thread bundle never
// pulls in @ironcalc/wasm.
//
// Protocol: docs/sheets-rewrite-spec.md, section 1.

import { validateCommand, CommandTypes } from './commands.js'
import type { Command } from './commands.js'
import type { ApplyResult, CellRead, ReadWhat, WorkerResponse } from './worker.js'
import type { ExtendedCellStyle } from '@ironcalc/wasm'

/** The part of a Worker the client uses. Tests pass a fake. */
export interface WorkerPort {
	postMessage(message: unknown): void
	onmessage: ((event: MessageEvent) => void) | null
	terminate?(): void
}

/** Where optimistic echoes go. DisplayCache implements this. */
export interface EchoTarget {
	setProvisional(sheet: string, row: number, col: number, display: string): void
	dropProvisional(sheet: string, row: number, col: number): void
}

export interface ClientOptions {
	snapshotBytes?: Uint8Array | null
	name?: string
	locale?: string
	timezone?: string
	/** Defaults to a new module Worker running worker.ts. */
	port?: WorkerPort
	echo?: EchoTarget
}

export interface ViewportArgs {
	sheet: string
	r1: number
	c1: number
	r2: number
	c2: number
	includeStyles?: boolean
}

export interface ViewportResult {
	values: string[][]
	styles?: ExtendedCellStyle[][]
}

export interface ReadCellsArgs {
	sheet: string
	cells: { row: number; col: number }[]
	what: ReadWhat[]
}

export interface CommandFailure {
	command: Command
	error: string
}

export class WorkerRequestError extends Error {
	command: unknown

	constructor(message: string, command?: unknown) {
		super(message)
		this.name = 'WorkerRequestError'
		this.command = command ?? null
	}
}

export interface WorkbookClient {
	readonly sheets: string[]
	/** Throws on an invalid command; it never reaches the worker. */
	dispatch(cmd: unknown): void
	onVersion(cb: (version: number) => void): () => void
	onCommandError(cb: (failure: CommandFailure) => void): () => void
	getVersion(): number
	readViewport(args: ViewportArgs): Promise<ViewportResult>
	readCells(args: ReadCellsArgs): Promise<{ cells: CellRead[] }>
	/** Sends queued commands first, so the bytes include them. */
	toBytes(): Promise<Uint8Array>
	/** Resolves once no command is queued or in flight. */
	idle(): Promise<void>
	terminate(): void
}

function spawnWorker(): WorkerPort {
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export async function createWorkbookClient(options: ClientOptions = {}): Promise<WorkbookClient> {
	const port = options.port ?? spawnWorker()
	const echo = options.echo ?? null

	// --- request / response correlation -----------------------------------

	let nextReqId = 1
	const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

	port.onmessage = (event: MessageEvent) => {
		const res = event.data as WorkerResponse
		const entry = waiting.get(res.reqId)
		// reqId -1 (malformed request) or a stale id: nobody is waiting.
		if (!entry) return
		waiting.delete(res.reqId)
		if ('error' in res) entry.reject(new WorkerRequestError(res.error.message, res.error.command))
		else entry.resolve(res.result)
	}

	function request<T>(type: string, payload: unknown = {}): Promise<T> {
		const reqId = nextReqId++
		return new Promise<T>((resolve, reject) => {
			waiting.set(reqId, { resolve: resolve as (v: unknown) => void, reject })
			port.postMessage({ reqId, type, payload })
		})
	}

	// --- init --------------------------------------------------------------

	const initPayload: Record<string, unknown> = { snapshotBytes: options.snapshotBytes ?? null }
	if (options.name !== undefined) initPayload['name'] = options.name
	if (options.locale !== undefined) initPayload['locale'] = options.locale
	if (options.timezone !== undefined) initPayload['timezone'] = options.timezone
	const init = await request<{ version: number; sheets: string[] }>('init', initPayload)

	let version = init.version
	const versionListeners = new Set<(version: number) => void>()
	const errorListeners = new Set<(failure: CommandFailure) => void>()

	function setVersion(v: number): void {
		if (v === version) return
		version = v
		for (const cb of versionListeners) cb(v)
	}

	function reportFailure(command: Command, error: string): void {
		// The echoed text never made it into the engine; take it back out.
		if (echo && command.type === CommandTypes.setInput) {
			const p = command.payload
			echo.dropProvisional(p.sheet, p.row, p.col)
		}
		for (const cb of errorListeners) cb({ command, error })
	}

	// --- dispatch queue ----------------------------------------------------

	let queue: Command[] = []
	let inFlight = false
	let flushScheduled = false
	let idleWaiters: (() => void)[] = []

	function dispatch(input: unknown): void {
		const cmd = validateCommand(input)
		if (echo && cmd.type === CommandTypes.setInput) {
			const p = cmd.payload
			echo.setProvisional(p.sheet, p.row, p.col, p.input)
		}
		queue.push(cmd)
		scheduleFlush()
	}

	// Waiting one microtask lets a synchronous burst of dispatches (a paste,
	// a fill) leave as one apply instead of one message each.
	function scheduleFlush(): void {
		if (flushScheduled) return
		flushScheduled = true
		queueMicrotask(() => {
			flushScheduled = false
			void flush()
		})
	}

	async function flush(): Promise<void> {
		if (inFlight) return
		if (queue.length === 0) {
			const waiters = idleWaiters
			idleWaiters = []
			for (const resolve of waiters) resolve()
			return
		}
		inFlight = true
		const batch = queue
		queue = []
		try {
			const res = await request<{ version: number; results: ApplyResult[] }>('apply', { commands: batch })
			res.results.forEach((r, i) => {
				const command = batch[i]
				if (!r.ok && command) reportFailure(command, r.error ?? 'unknown error')
			})
			setVersion(res.version)
		} catch (e) {
			// The whole request failed, so none of the batch applied.
			const message = e instanceof Error ? e.message : String(e)
			for (const command of batch) reportFailure(command, message)
		} finally {
			inFlight = false
		}
		await flush()
	}

	function idle(): Promise<void> {
		if (!inFlight && queue.length === 0 && !flushScheduled) return Promise.resolve()
		return new Promise(resolve => idleWaiters.push(resolve))
	}

	// --- public API --------------------------------------------------------

	return {
		sheets: init.sheets,
		dispatch,
		onVersion(cb) {
			versionListeners.add(cb)
			return () => versionListeners.delete(cb)
		},
		onCommandError(cb) {
			errorListeners.add(cb)
			return () => errorListeners.delete(cb)
		},
		getVersion: () => version,
		readViewport: args => request<ViewportResult>('readViewport', args),
		readCells: args => request<{ cells: CellRead[] }>('readCells', args),
		async toBytes() {
			await idle()
			return (await request<{ bytes: Uint8Array }>('toBytes')).bytes
		},
		idle,
		terminate() {
			port.terminate?.()
			for (const entry of waiting.values()) entry.reject(new WorkerRequestError('worker terminated'))
			waiting.clear()
		},
	}
}
