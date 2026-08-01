// Shared corpus harness for the formula-engine test campaign.
//
// Two fixture kinds:
//   * direct    — one formula, an optional cell map, one expected value
//   * workbook  — sheets, a list of actions, and expected cell values after
//
// Every fixture carries a `status`. `pass` means the engine is expected to
// match `expected`. `known-failure` means the engine is currently WRONG: the
// runner asserts the mismatch still exists and reports `actual`, so a fix
// turns the fixture red and forces the corpus to be updated. That keeps the
// defect backlog executable instead of prose.

import { createSheet } from "../sheet.js"

// Eager glob instead of `fs`: no @types/node dependency, and Vite resolves the
// paths at build time so a malformed JSON file fails loudly at import.
const CORPUS_FILES = import.meta.glob("./**/*.json", { eager: true, import: "default" }) as Record<
	string,
	unknown
>

export type FixtureStatus = "pass" | "known-failure"

export type Defect =
	| "parser-accepts-invalid"
	| "parser-rejects-valid"
	| "precedence"
	| "associativity"
	| "coercion"
	| "error-propagation"
	| "function-result"
	| "function-arguments"
	| "reference-resolution"
	| "dependency-missing"
	| "dependency-stale"
	| "circular-reference"
	| "cache-invalidation"
	| "structural-edit"
	| "compatibility-difference"
	| "unsupported-feature"
	| "performance"
	| "crash"

export interface DirectFixture {
	id: string
	formula: string
	cells?: Record<string, string | number>
	sheets?: Record<string, Record<string, string | number>>
	namedRanges?: Record<string, { sheet?: string; start: string; end: string }>
	expected: unknown
	tolerance?: number
	category: string
	source: string
	notes?: string
	status?: FixtureStatus
	defect?: Defect
	actual?: unknown
}

export type Action =
	| { type: "set"; sheet?: string; cell: string; value: string | number }
	| { type: "clear"; sheet?: string; cell: string }
	| { type: "insertRow"; at: number }
	| { type: "deleteRow"; at: number }
	| { type: "insertCol"; at: number }
	| { type: "deleteCol"; at: number }
	| { type: "renameSheet"; from: string; to: string }
	| { type: "deleteSheet"; name: string }
	| { type: "switchSheet"; name: string }
	| { type: "read"; sheet?: string; cell: string }

export interface WorkbookFixture {
	id: string
	sheets: Record<string, Record<string, string | number>>
	namedRanges?: Record<string, { sheet?: string; start: string; end: string }>
	actions?: Action[]
	expected: Record<string, unknown>
	tolerance?: number
	category: string
	source: string
	notes?: string
	status?: FixtureStatus
	defect?: Defect
	actual?: Record<string, unknown>
}

// ── Loading ───────────────────────────────────────────────────────────────────

// A corpus file is either a bare array of fixtures or `{ cases: [...] }`.
// Files that hold neither (README metadata, known-differences) are skipped.
function fixturesIn(path: string): any[] {
	const doc = CORPUS_FILES[path] as any
	const list = Array.isArray(doc) ? doc : doc?.cases
	return Array.isArray(list) ? list : []
}

/** Load every direct fixture under the given corpus-relative paths. */
export function loadDirect(...relPaths: string[]): DirectFixture[] {
	return loadAll(relPaths) as DirectFixture[]
}

/** Load every workbook fixture under the given corpus-relative paths. */
export function loadWorkbooks(...relPaths: string[]): WorkbookFixture[] {
	return loadAll(relPaths) as WorkbookFixture[]
}

function loadAll(relPaths: string[]): any[] {
	const out: any[] = []
	const seen = new Set<string>()
	const allPaths = Object.keys(CORPUS_FILES).sort()
	for (const rel of relPaths) {
		// `syntax.json` matches exactly; `functions` matches everything beneath it.
		const prefix = `./${rel}`
		const files = allPaths.filter((p) => p === prefix || p.startsWith(`${prefix}/`))
		for (const f of files) {
			for (const fx of fixturesIn(f)) {
				if (!fx?.id) throw new Error(`corpus: fixture without id in ${f}`)
				if (seen.has(fx.id)) throw new Error(`corpus: duplicate fixture id "${fx.id}" (${f})`)
				seen.add(fx.id)
				out.push({ ...fx, _file: f })
			}
		}
	}
	return out
}

// ── Execution ─────────────────────────────────────────────────────────────────

function buildSheet(fx: { sheets?: Record<string, Record<string, any>>; cells?: Record<string, any>; namedRanges?: any }) {
	const sheet = createSheet({})
	const sheets = fx.sheets ?? (fx.cells ? { Sheet1: fx.cells } : {})
	for (const name of Object.keys(sheets)) {
		if (name !== "Sheet1") sheet.addSheet(name)
	}
	for (const [name, cells] of Object.entries(sheets)) {
		for (const [id, value] of Object.entries(cells)) sheet.setCell(id, value, name)
	}
	if (fx.namedRanges) {
		const map = new Map<string, any>()
		for (const [name, binding] of Object.entries(fx.namedRanges as Record<string, any>)) {
			map.set(name.toUpperCase(), { sheet: null, ...binding })
		}
		sheet.setNamedRangeResolver((name: string) => map.get(String(name).toUpperCase()) ?? null)
		sheet.invalidateMemo()
	}
	return sheet
}

/**
 * Evaluate a direct fixture through the production sheet engine and return the
 * raw value. The probe cell is far outside any fixture's working area so it
 * cannot collide with the fixture's own data.
 */
export const PROBE_CELL = "XFD1048576"

export function runDirect(fx: DirectFixture): unknown {
	const sheet = buildSheet(fx)
	const formula = fx.formula.startsWith("=") ? fx.formula : `=${fx.formula}`
	sheet.setCell(PROBE_CELL, formula, "Sheet1")
	return sheet.getCellValue(PROBE_CELL, "Sheet1")
}

export function applyAction(sheet: ReturnType<typeof createSheet>, a: Action): void {
	switch (a.type) {
		case "set":
			sheet.setCell(a.cell, a.value, a.sheet ?? "Sheet1")
			break
		case "clear":
			sheet.setCell(a.cell, "", a.sheet ?? "Sheet1")
			break
		case "switchSheet":
			sheet.switchSheet(a.name)
			break
		case "insertRow":
			sheet.insertRow(a.at)
			break
		case "deleteRow":
			sheet.deleteRow(a.at)
			break
		case "insertCol":
			sheet.insertCol(a.at)
			break
		case "deleteCol":
			sheet.deleteCol(a.at)
			break
		case "renameSheet":
			sheet.renameSheet(a.from, a.to)
			break
		case "deleteSheet":
			sheet.deleteSheet(a.name)
			break
		case "read":
			sheet.getCellValue(a.cell, a.sheet ?? "Sheet1")
			break
		default:
			throw new Error(`corpus: unknown action ${JSON.stringify(a)}`)
	}
}

/** Run a workbook fixture and return the actual value for every expected key. */
export function runWorkbook(fx: WorkbookFixture): Record<string, unknown> {
	const sheet = buildSheet(fx)
	// Row/column ops act on the current sheet only, so an action list that
	// targets another sheet must switch first — fixtures do that explicitly.
	for (const a of fx.actions ?? []) applyAction(sheet, a)
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(fx.expected)) {
		const [sheetName, cellId] = key.includes("!") ? key.split("!") : ["Sheet1", key]
		out[key] = sheet.getCellValue(cellId, sheetName)
	}
	return out
}

// ── Comparison ────────────────────────────────────────────────────────────────

export function matches(actual: unknown, expected: unknown, tolerance?: number): boolean {
	if (typeof expected === "number" && typeof actual === "number") {
		if (Number.isNaN(expected)) return Number.isNaN(actual)
		if (tolerance != null) return Math.abs(actual - expected) <= tolerance
		// Plain `===`, so -0 and 0 compare equal: a spreadsheet shows both as 0.
		return actual === expected
	}
	if (Array.isArray(expected) || Array.isArray(actual)) {
		return JSON.stringify(actual) === JSON.stringify(expected)
	}
	return actual === expected
}

export function matchesAll(
	actual: Record<string, unknown>,
	expected: Record<string, unknown>,
	tolerance?: number,
): boolean {
	return Object.keys(expected).every((k) => matches(actual[k], expected[k], tolerance))
}
