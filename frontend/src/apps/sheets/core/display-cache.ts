// Main-thread cache of what the grid paints: one entry per cell, keyed
// "{sheet}:{row}:{col}", holding the formatted display string, the input
// (what the editor opens with: a formula, not its result) and style.
//
// The renderer reads only from here; there is no synchronous engine read
// on the main thread. A miss (undefined) means "not loaded": the renderer
// paints blank and the provider refills with readViewport. A loaded empty
// cell is an entry with display ''.
//
// Invalidation is wholesale: clear() on every version bump. IronCalc
// exposes no changed-cell set, so any cell may have changed. Entries are
// kept as stale rather than dropped, so the grid keeps painting the last
// value until the refill lands instead of flashing blank; isFresh() tells
// them apart. Once the cache holds more than MAX_CACHED_CELLS, an entry not
// refilled for two clears (scrolled away, or on another sheet) goes.
//
// Optimistic echo: setProvisional() shows typed text before the worker
// has applied it. A provisional entry survives clear() and fill() until
// the client settles it (its apply came back), so a version bump from an
// earlier apply cannot blank text the user typed meanwhile.
//
// Spec: docs/sheets-rewrite-spec.md, section 1, "DisplayCache".

import type { ExtendedCellStyle } from '@ironcalc/wasm'

import type { EchoTarget, ViewportResult } from './client.js'
import { MAX_CACHED_CELLS } from './limits.js'

export interface CachedCell {
  display: string
  input?: string
  style?: ExtendedCellStyle
  provisional?: true
}

export interface DisplayCache extends EchoTarget {
  /** The entry, fresh or stale. */
  get(sheet: string, row: number, col: number): CachedCell | undefined
  /** True when the entry was filled since the last clear, or is provisional. */
  isFresh(sheet: string, row: number, col: number): boolean
  /**
   * Inserts a readViewport result whose top-left cell is (r1, c1).
   * `version` is the engine version when the read was requested; a fill
   * from an older version is dropped and returns false.
   */
  fill(sheet: string, r1: number, c1: number, result: ViewportResult, version: number): boolean
  /** Marks every settled entry stale and moves the cache to `version`. */
  clear(version: number): void
  readonly version: number
  readonly size: number
}

const key = (sheet: string, row: number, col: number) => `${sheet}:${row}:${col}`

export function createDisplayCache(
  initialVersion = 0,
  { maxEntries = MAX_CACHED_CELLS }: { maxEntries?: number } = {},
): DisplayCache {
  const cells = new Map<string, CachedCell>()
  // Commands dispatched but not yet applied, per cell. The same cell can
  // be typed into twice while the first apply is in flight.
  const pending = new Map<string, number>()
  let version = initialVersion
  // Counts clears; an entry remembers the one it was filled in.
  let generation = 0
  const filledIn = new Map<string, number>()

  function get(sheet: string, row: number, col: number): CachedCell | undefined {
    return cells.get(key(sheet, row, col))
  }

  function isFresh(sheet: string, row: number, col: number): boolean {
    const k = key(sheet, row, col)
    return pending.has(k) || (cells.has(k) && filledIn.get(k) === generation)
  }

  function fill(
    sheet: string,
    r1: number,
    c1: number,
    result: ViewportResult,
    readVersion: number,
  ): boolean {
    if (readVersion !== version) return false
    result.values.forEach((rowValues, i) => {
      rowValues.forEach((display, j) => {
        const k = key(sheet, r1 + i, c1 + j)
        if (pending.has(k)) return
        const style = result.styles?.[i]?.[j] ?? cells.get(k)?.style
        const input = result.inputs?.[i]?.[j]
        const cell: CachedCell = { display }
        if (input !== undefined) cell.input = input
        if (style) cell.style = style
        cells.set(k, cell)
        filledIn.set(k, generation)
      })
    })
    return true
  }

  function setProvisional(sheet: string, row: number, col: number, display: string): void {
    const k = key(sheet, row, col)
    pending.set(k, (pending.get(k) ?? 0) + 1)
    // The echoed text is what was typed, so it is the input too.
    const style = cells.get(k)?.style
    const cell: CachedCell = { display, input: display, provisional: true }
    if (style) cell.style = style
    cells.set(k, cell)
  }

  // Called once per echoed command when its apply returns. After the last
  // settle an applied edit leaves the typed text as a stale entry, painted
  // until the refill brings the evaluated value; a rejected one is dropped
  // at once, so the old value comes back instead of text that never landed.
  function settleProvisional(sheet: string, row: number, col: number, applied: boolean): void {
    const k = key(sheet, row, col)
    const n = pending.get(k)
    if (n === undefined) return
    if (n > 1) {
      pending.set(k, n - 1)
      return
    }
    pending.delete(k)
    const cell = cells.get(k)
    if (!cell) return
    if (!applied) {
      cells.delete(k)
      filledIn.delete(k)
      return
    }
    const settled: CachedCell = { display: cell.display }
    if (cell.input !== undefined) settled.input = cell.input
    if (cell.style) settled.style = cell.style
    cells.set(k, settled)
    // The version bump that follows an applied edit makes it stale, and it
    // keeps painting through that clear until the refill.
    filledIn.set(k, generation)
  }

  function clear(nextVersion: number): void {
    version = nextVersion
    generation++
    if (cells.size <= maxEntries) return
    for (const k of cells.keys()) {
      if (pending.has(k)) continue
      // Not refilled since the clear before this one: off screen.
      if ((filledIn.get(k) ?? -1) < generation - 1) {
        cells.delete(k)
        filledIn.delete(k)
      }
    }
  }

  return {
    get,
    isFresh,
    fill,
    setProvisional,
    settleProvisional,
    clear,
    get version() {
      return version
    },
    get size() {
      return cells.size
    },
  }
}
