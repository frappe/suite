// Cell values for the canvas, served from the DisplayCache.
//
// The canvas paints synchronously and asks for one cell at a time
// (getDisplay). The engine lives in a worker and answers asynchronously.
// This bridges the two:
//
//   1. getDisplay() answers from the cache. On a miss it returns '' and
//      grows a bounding box of missed cells.
//   2. After the paint (one microtask later) the box, plus overscan, goes
//      out as a single readViewport.
//   3. The result fills the cache and requestRender() repaints, this time
//      with hits.
//
// It also clears the cache on every version bump and repaints, which
// starts the cycle again for the visible area.
//
// Rows and columns are 1-based, like the commands.

import type { DisplayCache } from './display-cache.js'
import type { WorkbookClient } from './client.js'
import { MAX_VIEWPORT_CELLS } from './limits.js'

export interface CellProviderOptions {
	client: WorkbookClient
	cache: DisplayCache
	requestRender(): void
	/** Extra rows/cols fetched around the missed area, so scrolling hits. */
	overscanRows?: number
	overscanCols?: number
	onError?(error: unknown): void
}

export interface CellProvider {
	getDisplay(sheet: string, row: number, col: number): string
	dispose(): void
}

interface Box {
	sheet: string
	r1: number
	c1: number
	r2: number
	c2: number
}

export function createCellProvider({
	client,
	cache,
	requestRender,
	overscanRows = 50,
	overscanCols = 10,
	onError = e => console.error('[sheets] readViewport failed', e),
}: CellProviderOptions): CellProvider {
	let missed: Box | null = null
	let scheduled = false
	let inFlight = false
	let disposed = false

	// The client may have moved on before the provider existed (the import
	// batch does). A cache left behind would drop every fill as stale.
	if (cache.version !== client.getVersion()) cache.clear(client.getVersion())

	const offVersion = client.onVersion(v => {
		cache.clear(v)
		requestRender()
	})

	function getDisplay(sheet: string, row: number, col: number): string {
		const hit = cache.get(sheet, row, col)
		if (hit) return hit.display
		noteMiss(sheet, row, col)
		return ''
	}

	function noteMiss(sheet: string, row: number, col: number): void {
		if (!missed || missed.sheet !== sheet) {
			// The canvas paints one sheet per frame; a new sheet name means
			// the user switched tabs, and the old misses no longer matter.
			missed = { sheet, r1: row, c1: col, r2: row, c2: col }
		} else {
			missed.r1 = Math.min(missed.r1, row)
			missed.c1 = Math.min(missed.c1, col)
			missed.r2 = Math.max(missed.r2, row)
			missed.c2 = Math.max(missed.c2, col)
		}
		schedule()
	}

	function schedule(): void {
		if (scheduled || inFlight) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			void fetchMissed()
		})
	}

	async function fetchMissed(): Promise<void> {
		if (disposed || !missed) return
		const box = withOverscan(missed)
		missed = null
		inFlight = true
		const version = client.getVersion()
		try {
			const result = await client.readViewport(box)
			if (disposed) return
			// false: the version moved while the read was in flight. The
			// clear() that came with it already asked for a repaint, which
			// records fresh misses, so nothing to do here.
			if (cache.fill(box.sheet, box.r1, box.c1, result, version)) requestRender()
		} catch (e) {
			// Not retried: the next paint that misses asks again.
			if (!disposed) onError(e)
		} finally {
			inFlight = false
			// Misses recorded while this read was out (a scroll, say).
			if (missed) schedule()
		}
	}

	function withOverscan(b: Box): Box {
		const r1 = Math.max(1, b.r1 - overscanRows)
		const c1 = Math.max(1, b.c1 - overscanCols)
		let r2 = b.r2 + overscanRows
		const c2 = b.c2 + overscanCols
		// Keep within the worker's per-read limit; trim rows, which are
		// the cheap direction to refetch.
		const width = c2 - c1 + 1
		const maxRows = Math.max(1, Math.floor(MAX_VIEWPORT_CELLS / width))
		if (r2 - r1 + 1 > maxRows) r2 = r1 + maxRows - 1
		return { sheet: b.sheet, r1, c1, r2, c2 }
	}

	return {
		getDisplay,
		dispose() {
			disposed = true
			offVersion()
		},
	}
}
