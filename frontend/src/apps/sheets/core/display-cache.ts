// Main-thread cache of what the grid paints: one entry per cell, keyed
// "{sheet}:{row}:{col}", holding the formatted display string and style.
//
// The renderer reads only from here; there is no synchronous engine read
// on the main thread. A miss (undefined) means "not loaded": the renderer
// paints blank and the provider refills with readViewport. A loaded empty
// cell is an entry with display ''.
//
// Invalidation is wholesale: clear() on every version bump. IronCalc
// exposes no changed-cell set, so any cell may have changed.
//
// Optimistic echo: setProvisional() shows typed text before the worker
// has applied it. A provisional entry survives clear() and fill() until
// the client settles it (its apply came back), so a version bump from an
// earlier apply cannot blank text the user typed meanwhile.
//
// Spec: docs/sheets-rewrite-spec.md, section 1, "DisplayCache".

import type { ExtendedCellStyle } from '@ironcalc/wasm'
import type { EchoTarget, ViewportResult } from './client.js'

export interface CachedCell {
	display: string
	style?: ExtendedCellStyle
	provisional?: true
}

export interface DisplayCache extends EchoTarget {
	get(sheet: string, row: number, col: number): CachedCell | undefined
	/**
	 * Inserts a readViewport result whose top-left cell is (r1, c1).
	 * `version` is the engine version when the read was requested; a fill
	 * from an older version is dropped and returns false.
	 */
	fill(sheet: string, r1: number, c1: number, result: ViewportResult, version: number): boolean
	/** Drops every settled entry and moves the cache to `version`. */
	clear(version: number): void
	readonly version: number
	readonly size: number
}

const key = (sheet: string, row: number, col: number) => `${sheet}:${row}:${col}`

export function createDisplayCache(initialVersion = 0): DisplayCache {
	const cells = new Map<string, CachedCell>()
	// Commands dispatched but not yet applied, per cell. The same cell can
	// be typed into twice while the first apply is in flight.
	const pending = new Map<string, number>()
	let version = initialVersion

	function get(sheet: string, row: number, col: number): CachedCell | undefined {
		return cells.get(key(sheet, row, col))
	}

	function fill(sheet: string, r1: number, c1: number, result: ViewportResult, readVersion: number): boolean {
		if (readVersion !== version) return false
		result.values.forEach((rowValues, i) => {
			rowValues.forEach((display, j) => {
				const k = key(sheet, r1 + i, c1 + j)
				if (pending.has(k)) return
				const style = result.styles?.[i]?.[j] ?? cells.get(k)?.style
				cells.set(k, style ? { display, style } : { display })
			})
		})
		return true
	}

	function setProvisional(sheet: string, row: number, col: number, display: string): void {
		const k = key(sheet, row, col)
		pending.set(k, (pending.get(k) ?? 0) + 1)
		const style = cells.get(k)?.style
		cells.set(k, style ? { display, style, provisional: true } : { display, provisional: true })
	}

	// Called once per echoed command when its apply returns, whether it
	// succeeded or failed. The last settle removes the entry; the next
	// refill brings the evaluated value (or the old one, after a failure).
	function settleProvisional(sheet: string, row: number, col: number): void {
		const k = key(sheet, row, col)
		const n = pending.get(k)
		if (n === undefined) return
		if (n > 1) {
			pending.set(k, n - 1)
			return
		}
		pending.delete(k)
		cells.delete(k)
	}

	function clear(nextVersion: number): void {
		version = nextVersion
		for (const k of cells.keys()) {
			if (!pending.has(k)) cells.delete(k)
		}
	}

	return {
		get,
		fill,
		setProvisional,
		settleProvisional,
		clear,
		get version() { return version },
		get size() { return cells.size },
	}
}
