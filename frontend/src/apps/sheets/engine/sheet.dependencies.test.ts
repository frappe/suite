// Stateful behaviour of the sheet engine: which cells the dependency graph
// knows about, and when the formula memo cache is dropped.
//
// The corpus (`test-corpus/workbooks/*.json`) covers observable cell values.
// This file covers the two things a value assertion cannot see:
//
//   * the dependency graph itself — an edge that was never registered looks
//     identical to a correct result until something upstream changes;
//   * `_memoStats` — whether a read was served from cache or recomputed.
//
// Where the engine disagrees with Excel and Google Sheets the test asserts the
// current behaviour and says so, exactly like a `known-failure` fixture: fixing
// the engine turns the test red and forces this file to be updated.

import { beforeEach, describe, expect, it } from "vitest"

import { createDepsEngine } from "./deps.js"
import { createSheet } from "./sheet.js"

/** Cell ids that would be recalculated if `cellId` on `sheet` changed. */
function dependentsOf(deps: ReturnType<typeof createDepsEngine>, cellId: string, sheet = "Sheet1") {
	return deps.getDependents(cellId, sheet).map((d: any) => `${d.sheet}!${d.cellId}`)
}

/** A deps engine holding one formula in Sheet1!Z1. */
function depsFor(formula: string, extraSheets: string[] = []) {
	const deps = createDepsEngine()
	deps.rebuild({}, "Sheet1")
	for (const s of extraSheets) deps.rebuild({}, s)
	deps.register("Z1", formula, "Sheet1")
	return deps
}

describe("dependency graph — edges that are registered", () => {
	it("registers a single same-sheet reference", () => {
		expect(dependentsOf(depsFor("=A1+1"), "A1")).toEqual(["Sheet1!Z1"])
	})

	it("registers every cell inside a range, and nothing past its edge", () => {
		const deps = depsFor("=SUM(A1:A3)")
		expect(dependentsOf(deps, "A1")).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "A2")).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "A3")).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "A4")).toEqual([])
	})

	it("registers a rectangular range on both axes", () => {
		const deps = depsFor("=SUM(A1:B2)")
		for (const id of ["A1", "A2", "B1", "B2"]) expect(dependentsOf(deps, id)).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "C1")).toEqual([])
	})

	it("registers a cross-sheet reference against the remote sheet", () => {
		const deps = depsFor("=Data!A1*2", ["Data"])
		expect(dependentsOf(deps, "A1", "Data")).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "A1", "Sheet1")).toEqual([])
	})

	it("registers a cross-sheet range cell by cell", () => {
		const deps = depsFor("=SUM(Data!A1:A3)", ["Data"])
		expect(dependentsOf(deps, "A2", "Data")).toEqual(["Sheet1!Z1"])
	})

	it("walks the graph transitively", () => {
		const deps = createDepsEngine()
		deps.rebuild({ B1: "=A1+1", C1: "=B1+1", D1: "=C1+1" }, "Sheet1")
		expect(dependentsOf(deps, "A1")).toEqual(["Sheet1!B1", "Sheet1!C1", "Sheet1!D1"])
	})

	it("terminates on a cycle instead of looping forever", () => {
		const deps = createDepsEngine()
		deps.rebuild({ A1: "=B1+1", B1: "=C1+1", C1: "=A1+1" }, "Sheet1")
		expect(dependentsOf(deps, "A1").sort()).toEqual(["Sheet1!B1", "Sheet1!C1"])
	})

	it("drops the old edges when a formula is retargeted", () => {
		const deps = depsFor("=A1+1")
		deps.register("Z1", "=C1+1", "Sheet1")
		expect(dependentsOf(deps, "A1")).toEqual([])
		expect(dependentsOf(deps, "C1")).toEqual(["Sheet1!Z1"])
	})

	it("drops the edges when a formula is replaced by a literal", () => {
		const deps = depsFor("=A1+1")
		deps.register("Z1", 7 as any, "Sheet1")
		expect(dependentsOf(deps, "A1")).toEqual([])
	})
})

describe("dependency graph — edges that are missing", () => {
	// `extractRefs` only understands REF, SHEETREF and SHEETCOL tokens. Every
	// reference form below tokenizes as something else and therefore registers
	// no edge at all, so the memo entry of the depending formula is never
	// dropped and the cell freezes at its first evaluated value.

	it("registers nothing for a whole-column reference", () => {
		// Excel and Sheets recalculate =SUM(A:A) whenever any cell in column A
		// changes. A:A tokenizes as COLREF COLON COLREF, which extractRefs skips.
		const deps = depsFor("=SUM(A:A)")
		expect(dependentsOf(deps, "A1")).toEqual([])
		expect(dependentsOf(deps, "A500")).toEqual([])
	})

	it("registers only the first cell of a cross-sheet whole-column reference", () => {
		// deps.js documents this as a deliberate cheap approximation, but the
		// effect is the same as a missing edge for every row below the first.
		const deps = depsFor("=SUM(Data!A:A)", ["Data"])
		expect(dependentsOf(deps, "A1", "Data")).toEqual(["Sheet1!Z1"])
		expect(dependentsOf(deps, "A2", "Data")).toEqual([])
	})

	it("registers nothing for a named range", () => {
		// A defined name tokenizes as NAME (or COLREF when it is all letters),
		// and extractRefs never asks the resolver what it points at.
		const deps = depsFor("=REV*2")
		expect(dependentsOf(deps, "A1")).toEqual([])
	})

	it("registers nothing for an anchored reference", () => {
		// `$A$1` and `A$1` become NAME tokens, so they neither evaluate nor
		// create a dependency. `$A1` survives because the leading `$` is simply
		// dropped by the tokenizer, leaving a plain A1.
		expect(dependentsOf(depsFor("=$A$1"), "A1")).toEqual([])
		expect(dependentsOf(depsFor("=A$1"), "A1")).toEqual([])
		expect(dependentsOf(depsFor("=$A1"), "A1")).toEqual(["Sheet1!Z1"])
	})
})

describe("memo cache", () => {
	let sheet: ReturnType<typeof createSheet>

	// A1 -> B1 -> C1 -> D1, so one edit has to reach three cached results.
	beforeEach(() => {
		sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=A1+1")
		sheet.setCell("C1", "=B1+1")
		sheet.setCell("D1", "=C1+1")
	})

	it("serves an unchanged formula from the cache", () => {
		sheet._resetMemoStats()
		expect(sheet.getCellValue("D1")).toBe(4)
		// Cold read evaluates D1, C1 and B1; A1 is a literal and is not cached.
		expect(sheet._memoStats()).toEqual({ hits: 0, misses: 3 })

		sheet._resetMemoStats()
		expect(sheet.getCellValue("D1")).toBe(4)
		expect(sheet._memoStats()).toEqual({ hits: 1, misses: 0 })
	})

	it("invalidates every transitive dependent when a source changes", () => {
		sheet.getCellValue("D1")
		sheet.setCell("A1", 10)

		sheet._resetMemoStats()
		expect(sheet.getCellValue("D1")).toBe(13)
		// All three cached entries were dropped, so the whole chain re-evaluates.
		expect(sheet._memoStats()).toEqual({ hits: 0, misses: 3 })
	})

	it("preserves cached results across an unrelated edit", () => {
		sheet.getCellValue("D1")
		sheet.setCell("E1", 5)

		sheet._resetMemoStats()
		expect(sheet.getCellValue("D1")).toBe(4)
		expect(sheet._memoStats()).toEqual({ hits: 1, misses: 0 })
	})

	it("invalidates the OLD dependency edges when a formula is retargeted", () => {
		sheet.setCell("Z1", 100)
		sheet.getCellValue("D1")

		sheet.setCell("B1", "=Z1+1")
		expect(sheet.getCellValue("D1")).toBe(103)

		// A1 is no longer upstream of anything, so editing it must not move D1.
		sheet.setCell("A1", 999)
		expect(sheet.getCellValue("D1")).toBe(103)
	})

	it("invalidates a remote dependent when the other sheet changes", () => {
		const wb = createSheet({})
		wb.addSheet("Data")
		wb.setCell("A1", 5, "Data")
		wb.setCell("B1", "=Data!A1*2", "Sheet1")
		expect(wb.getCellValue("B1", "Sheet1")).toBe(10)

		wb.setCell("A1", 50, "Data")
		wb._resetMemoStats()
		expect(wb.getCellValue("B1", "Sheet1")).toBe(100)
		expect(wb._memoStats()).toEqual({ hits: 0, misses: 1 })
	})

	it("invalidates the whole cache on a row insertion", () => {
		sheet.getCellValue("D1")
		sheet.insertRow(50)

		sheet._resetMemoStats()
		sheet.getCellValue("D1")
		expect(sheet._memoStats().hits).toBe(0)
	})
})

describe("memo cache — volatile formulas", () => {
	const VOLATILE = ["=RAND()", "=RANDBETWEEN(1,10)", "=TODAY()", "=NOW()"]

	for (const formula of VOLATILE) {
		it(`bypasses the cache for ${formula}`, () => {
			const sheet = createSheet({})
			sheet.setCell("A1", formula)
			sheet._resetMemoStats()
			sheet.getCellValue("A1")
			sheet.getCellValue("A1")
			expect(sheet._memoStats()).toEqual({ hits: 0, misses: 2 })
		})
	}

	it("bypasses the cache for a volatile call nested in a larger expression", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", "=IF(TRUE,NOW(),0)")
		sheet._resetMemoStats()
		sheet.getCellValue("A1")
		sheet.getCellValue("A1")
		expect(sheet._memoStats()).toEqual({ hits: 0, misses: 2 })
	})

	it("caches a formula whose only dependency is volatile — DEFECT", () => {
		// A1 refreshes on every read, but B1 reads A1 through the memo, so B1
		// keeps the first sample forever. In Excel and Sheets a volatile cell
		// marks its whole dependent tree volatile, so B1 tracks A1.
		// Defect: cache-invalidation.
		const sheet = createSheet({})
		sheet.setCell("A1", "=RAND()")
		sheet.setCell("B1", "=A1")

		expect(sheet.getCellValue("A1")).not.toBe(sheet.getCellValue("A1"))

		const first = sheet.getCellValue("B1")
		sheet._resetMemoStats()
		expect(sheet.getCellValue("B1")).toBe(first)
		expect(sheet._memoStats()).toEqual({ hits: 1, misses: 0 })
	})

	it("treats a volatile name inside a string literal as volatile — DEFECT", () => {
		// VOLATILE_RE runs over the raw formula text, so a constant expression
		// that merely mentions RAND( / NOW( / TODAY( in a string is re-evaluated
		// on every single read. The value stays correct; the cost does not.
		// Defect: cache-invalidation (unnecessary recomputation).
		for (const formula of ['="RAND("', '="see NOW()"', '=CONCAT("TODAY(",1)']) {
			const sheet = createSheet({})
			sheet.setCell("A1", formula)
			sheet._resetMemoStats()
			sheet.getCellValue("A1")
			sheet.getCellValue("A1")
			expect(sheet._memoStats(), formula).toEqual({ hits: 0, misses: 2 })
		}
	})

	it("does not treat a longer identifier ending in a volatile name as volatile", () => {
		// The `\b` guard does its job on this side: MYRAND( is not RAND(.
		const sheet = createSheet({})
		sheet.setCell("A1", '=CONCAT("MYRAND(",1)')
		sheet._resetMemoStats()
		sheet.getCellValue("A1")
		sheet.getCellValue("A1")
		expect(sheet._memoStats()).toEqual({ hits: 1, misses: 1 })
	})
})

describe("memo cache — named ranges", () => {
	function withName(target: { sheet?: string | null; start: string; end: string }) {
		const sheet = createSheet({})
		let binding = target
		sheet.setNamedRangeResolver((name: string) =>
			String(name).toUpperCase() === "REV" ? { sheet: null, ...binding } : null,
		)
		return { sheet, rebind: (next: typeof target) => (binding = next) }
	}

	it("resolves a name to its bound cell", () => {
		const { sheet } = withName({ start: "A1", end: "A1" })
		sheet.setCell("A1", 5)
		sheet.setCell("B1", "=REV*2")
		expect(sheet.getCellValue("B1")).toBe(10)
	})

	it("does not invalidate a name's dependents when the bound cell changes — DEFECT", () => {
		// No edge exists from A1 to B1, so once B1 has been read its result is
		// frozen. Every spreadsheet recalculates through a defined name.
		// Defect: dependency-missing.
		const { sheet } = withName({ start: "A1", end: "A1" })
		sheet.setCell("A1", 5)
		sheet.setCell("B1", "=REV*2")
		expect(sheet.getCellValue("B1")).toBe(10)

		sheet.setCell("A1", 50)
		expect(sheet.getCellValue("B1")).toBe(10) // Excel and Sheets: 100
	})

	it("does not invalidate anything when a name is rebound — DEFECT", () => {
		// Editing a named range in the UI replaces the binding. Nothing tells the
		// sheet engine, so every formula using the name keeps its old result
		// until some unrelated edit happens to clear the cache.
		// Defect: cache-invalidation.
		const { sheet, rebind } = withName({ start: "A1", end: "A1" })
		sheet.setCell("A1", 5)
		sheet.setCell("C1", 100)
		sheet.setCell("B1", "=REV*2")
		expect(sheet.getCellValue("B1")).toBe(10)

		rebind({ start: "C1", end: "C1" })
		expect(sheet.getCellValue("B1")).toBe(10) // Excel and Sheets: 200
	})

	it("picks up a rebound name once the cache is dropped by hand", () => {
		// `invalidateMemo` is the documented escape hatch, and it does work —
		// the defect above is that nothing calls it.
		const { sheet, rebind } = withName({ start: "A1", end: "A1" })
		sheet.setCell("A1", 5)
		sheet.setCell("C1", 100)
		sheet.setCell("B1", "=REV*2")
		expect(sheet.getCellValue("B1")).toBe(10)

		rebind({ start: "C1", end: "C1" })
		sheet.invalidateMemo()
		expect(sheet.getCellValue("B1")).toBe(200)
	})

	it("does not invalidate a name whose binding lives on another sheet — DEFECT", () => {
		// Defect: dependency-missing.
		const sheet = createSheet({})
		sheet.addSheet("Data")
		sheet.setNamedRangeResolver((name: string) =>
			String(name).toUpperCase() === "REV" ? { sheet: "Data", start: "A1", end: "A1" } : null,
		)
		sheet.setCell("A1", 5, "Data")
		sheet.setCell("B1", "=REV*2", "Sheet1")
		expect(sheet.getCellValue("B1", "Sheet1")).toBe(10)

		sheet.setCell("A1", 50, "Data")
		expect(sheet.getCellValue("B1", "Sheet1")).toBe(10) // Excel and Sheets: 100
	})
})

describe("mutation paths that skip invalidation", () => {
	it("deleteSheet leaves cross-sheet dependents cached — DEFECT", () => {
		// deleteSheet drops the sheet without rebuilding the dependency graph or
		// clearing the memo, so a formula pointing into the deleted sheet keeps
		// serving the value it cached while the sheet still existed.
		// Defect: structural-edit.
		const sheet = createSheet({})
		sheet.addSheet("Sheet2")
		sheet.setCell("A1", 5, "Sheet2")
		sheet.setCell("A1", "=Sheet2!A1+1", "Sheet1")
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(6)

		sheet.deleteSheet("Sheet2")
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(6) // Excel and Sheets: #REF!

		// Even a forced recompute cannot recover: a missing sheet reads as zero
		// rather than as a dangling reference.
		sheet.invalidateMemo()
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(1) // Excel and Sheets: #REF!
	})

	it("batchSetCells drops the whole cache", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=A1+1")
		expect(sheet.getCellValue("B1")).toBe(2)

		sheet.batchSetCells({ A1: 10, B1: "=A1+1" }, "Sheet1")
		expect(sheet.getCellValue("B1")).toBe(11)
	})

	it("batchSetCells with replace=false still invalidates dependents", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=A1+1")
		expect(sheet.getCellValue("B1")).toBe(2)

		sheet.batchSetCells({ A1: 10 }, "Sheet1", { replace: false })
		expect(sheet.getCellValue("B1")).toBe(11)
	})

	it("restore drops the cache", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=A1+1")
		const snap = sheet.snapshot()
		sheet.setCell("A1", 99)
		expect(sheet.getCellValue("B1")).toBe(100)

		sheet.restore(snap)
		expect(sheet.getCellValue("B1")).toBe(2)
	})
})
