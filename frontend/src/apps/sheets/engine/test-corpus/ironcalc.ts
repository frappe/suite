// IronCalc adapter for differential testing.
//
// IronCalc is an optional dev-only dependency (`@ironcalc/wasm`). Nothing in the
// product imports it. Everything here degrades to "unavailable" rather than
// throwing, so a checkout without the package still runs the whole test suite.
//
// ── Why the module is initialised by hand ─────────────────────────────────────
// `@ironcalc/wasm` is a wasm-bindgen *web* bundle. Its default `init()` resolves
// `wasm_bg.wasm` through `new URL(..., import.meta.url)` and then `fetch()`es
// it. Under Vitest + jsdom that is a `file:` URL, which `fetch` refuses. So the
// adapter reads the `.wasm` off disk with `node:fs` and calls `initSync` with
// the bytes, which needs no network stack at all.
//
// ── Why values come back through a number format ──────────────────────────────
// The wasm surface exposes no raw cell value: the only readers are
// `getCellType` (a type tag) and `getFormattedCellValue` (a display string).
// IronCalc's "general" format rounds to 9 decimals, far too lossy for comparing
// doubles. Applying an explicit 15-decimal fixed format to the probe cell
// recovers full double precision. That format cannot hold very small or very
// large magnitudes, so the adapter falls back to the general string when the
// general string itself went scientific, and flags the result as degraded.

import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

/** Cell type tags returned by `Model.getCellType`. */
const CELL_TYPE = { NUMBER: 1, TEXT: 2, BOOL: 4, ERROR: 16 } as const

// 15 decimals is the most a double carries without inventing digits.
const PRECISE_FORMAT = "0.000000000000000"

// Far from any fixture's working area so the probe cannot collide with data.
const PROBE_ROW = 900
const PROBE_COL = 100

export type IronCalcKind = "number" | "text" | "boolean" | "error" | "empty"

export interface IronCalcResult {
	kind: IronCalcKind
	/** number, string, boolean, or an error name such as `#DIV/0!`. */
	value: number | string | boolean
	/** The raw display string, kept for diagnosis. */
	formatted: string
	/** Set when precision came from the general format rather than the precise one. */
	degradedPrecision?: boolean
}

type ModelCtor = new (name: string, locale: string, timezone: string, language: string) => any

let Model: ModelCtor | null = null
let loadError: string | null = "initIronCalc() was never awaited"

/**
 * Load and initialise the wasm module. Await once before any evaluation.
 * Returns false (and records `ironCalcLoadError()`) instead of throwing when the
 * optional dependency is missing or the wasm cannot start in this environment.
 */
export async function initIronCalc(): Promise<boolean> {
	if (Model) return true
	try {
		// Resolved through Node, not through the bundler: a bare `import()` of the
		// package name is rewritten at transform time, so a missing optional
		// dependency would fail the whole module instead of being skipped.
		const require = createRequire(import.meta.url)
		const entry = require.resolve("@ironcalc/wasm")
		const mod: any = await import(/* @vite-ignore */ pathToFileURL(entry).href)
		const wasmPath = require.resolve("@ironcalc/wasm/wasm_bg.wasm")
		mod.initSync({ module: readFileSync(wasmPath) })
		// Prove the binding actually works before declaring it available.
		const probe = new mod.Model("probe", "en", "UTC", "en")
		probe.setUserInput(0, 1, 1, "=1+1")
		probe.evaluate()
		if (probe.getFormattedCellValue(0, 1, 1) !== "2") throw new Error("smoke test returned a wrong value")
		Model = mod.Model
		loadError = null
		return true
	} catch (e) {
		loadError = e instanceof Error ? e.message : String(e)
		Model = null
		return false
	}
}

export function isIronCalcAvailable(): boolean {
	return Model != null
}

export function ironCalcLoadError(): string | null {
	return loadError
}

function colToNumber(col: string): number {
	let n = 0
	for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
	return n
}

function parseRef(ref: string): { row: number; col: number } {
	const m = /^\$?([A-Za-z]+)\$?([0-9]+)$/.exec(ref.trim())
	if (!m) throw new Error(`ironcalc: unusable cell ref "${ref}"`)
	return { col: colToNumber(m[1]), row: Number(m[2]) }
}

export interface IronCalcOptions {
	/** Extra sheets beyond the default first sheet; keys are sheet names. */
	sheets?: Record<string, Record<string, string | number>>
	locale?: string
	timezone?: string
}

/**
 * Evaluate one formula in IronCalc against an optional backing grid.
 * Returns `null` when IronCalc is unavailable. Throws only when IronCalc itself
 * rejects the input, which callers record as a difference rather than a crash.
 */
export function evaluateInIronCalc(
	formula: string,
	cells: Record<string, string | number> = {},
	options: IronCalcOptions = {},
): IronCalcResult | null {
	if (!Model) return null

	const model = new Model("diff", options.locale ?? "en", options.timezone ?? "UTC", "en")

	for (const [ref, value] of Object.entries(cells)) {
		const at = parseRef(ref)
		model.setUserInput(0, at.row, at.col, String(value))
	}

	for (const [name, grid] of Object.entries(options.sheets ?? {})) {
		model.newSheet()
		const index = model.getWorksheetsProperties().length - 1
		model.renameSheet(index, name)
		for (const [ref, value] of Object.entries(grid)) {
			const at = parseRef(ref)
			model.setUserInput(index, at.row, at.col, String(value))
		}
	}

	const input = formula.startsWith("=") ? formula : `=${formula}`
	model.setUserInput(0, PROBE_ROW, PROBE_COL, input)
	model.evaluate()

	const tag = model.getCellType(0, PROBE_ROW, PROBE_COL)
	const general: string = model.getFormattedCellValue(0, PROBE_ROW, PROBE_COL)

	if (tag === CELL_TYPE.ERROR) return { kind: "error", value: general, formatted: general }
	if (tag === CELL_TYPE.BOOL) return { kind: "boolean", value: general === "TRUE", formatted: general }
	if (tag === CELL_TYPE.TEXT) {
		return { kind: general === "" ? "empty" : "text", value: general, formatted: general }
	}

	// A numeric cell that displays nothing is an empty cell, not the number 0.
	if (general === "") return { kind: "empty", value: "", formatted: "" }

	model.updateRangeStyle(
		{ sheet: 0, row: PROBE_ROW, column: PROBE_COL, width: 1, height: 1 },
		"num_fmt",
		PRECISE_FORMAT,
	)
	const precise: string = model.getFormattedCellValue(0, PROBE_ROW, PROBE_COL)

	// The fixed format keeps full precision at every magnitude except where it
	// underflows to zero (below ~1e-15). Only then is the general format — which
	// switches to 6-significant-digit scientific — the better of the two.
	const preciseValue = Number(precise)
	const generalValue = Number(general)
	const underflowed = preciseValue === 0 && generalValue !== 0
	const value = underflowed || Number.isNaN(preciseValue) ? generalValue : preciseValue
	return {
		kind: "number",
		value,
		formatted: general,
		...(underflowed ? { degradedPrecision: true } : {}),
	}
}
