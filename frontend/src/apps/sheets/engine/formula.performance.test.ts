// Performance and stability guards for the formula engine.
//
// These are NOT benchmarks. CI machines vary too much for that, so the time
// limits are deliberately generous — they exist to catch a runaway regression
// (a hang, a stack overflow, a quadratic loop), not to measure speed. Where the
// shape of the growth matters rather than its absolute cost, the test compares
// two sizes and asserts a ratio instead of a duration.
//
// A property this suite proves matters more than any timing: an operation that
// gets too big must fail LOUDLY. Silently returning a wrong number because an
// internal limit was hit is the worst outcome a spreadsheet can produce.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"
import { evaluate, tokenize } from "./formula.js"

// Generous ceilings. A healthy run is one to two orders of magnitude under.
const FAST_MS = 2_000
const SLOW_MS = 10_000

function timed<T>(fn: () => T): [T, number] {
	const start = performance.now()
	const value = fn()
	return [value, performance.now() - start]
}

const stubEval = (src: string) =>
	evaluate(
		src,
		() => 0,
		() => [[0]],
	)

describe("parse and evaluate stability", () => {
	it("handles nesting far deeper than a spreadsheet allows", () => {
		// Excel caps nesting at 64 levels, so 200 is already generous.
		const src = "(".repeat(200) + "1" + ")".repeat(200)
		const [result, ms] = timed(() => stubEval(src))
		expect(result).toBe(1)
		expect(ms).toBeLessThan(FAST_MS)
	})

	it("handles deeply nested function calls", () => {
		const src = "IF(1,".repeat(200) + "1" + ")".repeat(200)
		expect(stubEval(src)).toBe(1)
	})

	it("fails with an error rather than a stack overflow when nesting is absurd", () => {
		const src = "(".repeat(50_000) + "1" + ")".repeat(50_000)
		const [result, ms] = timed(() => stubEval(src))
		expect(result).toBe("#ERROR!")
		expect(ms).toBeLessThan(SLOW_MS)
	})

	it("evaluates a very wide expression", () => {
		const [result, ms] = timed(() => stubEval(Array(10_000).fill("1").join("+")))
		expect(result).toBe(10_000)
		expect(ms).toBeLessThan(FAST_MS)
	})

	it("tokenizes a large run of unrecognised characters without hanging", () => {
		const [tokens, ms] = timed(() => tokenize("@".repeat(100_000)))
		expect(tokens).toHaveLength(0)
		expect(ms).toBeLessThan(FAST_MS)
	})

	it("rejects a large malformed formula quickly", () => {
		const [result, ms] = timed(() => stubEval("SUM(".repeat(2_000) + "1"))
		expect(result).toBe("#ERROR!")
		expect(ms).toBeLessThan(FAST_MS)
	})
})

describe("dependency scale", () => {
	function buildChain(n: number) {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		for (let i = 2; i <= n; i++) sheet.setCell(`A${i}`, `=A${i - 1}+1`)
		return sheet
	}

	it("evaluates and re-evaluates a chain within the current depth limit", () => {
		const sheet = buildChain(500)
		expect(sheet.getCellValue("A500")).toBe(500)
		const [, ms] = timed(() => sheet.setCell("A1", 2))
		expect(sheet.getCellValue("A500")).toBe(501)
		expect(ms).toBeLessThan(FAST_MS)
	})

	// KNOWN FAILURE — evaluation is recursive: reading the end of a chain calls
	// getCellValue -> _evalFormula -> evaluate -> getCellValue for every link, so
	// the JS stack bounds the chain length. Past roughly 700 links the RangeError
	// is caught and turned into #ERROR!.
	//
	// This is not an exotic shape. A running-balance column over 1,000 rows is
	// exactly this, and the failure appears on a COLD read — the first render
	// after loading the file — so the user sees a column of errors on a workbook
	// that computed correctly when they saved it. The fix is to evaluate in
	// topological order iteratively rather than by recursive descent.
	it.fails("evaluates a chain longer than the JS stack allows", () => {
		const sheet = buildChain(2_000)
		expect(sheet.getCellValue("A2000")).toBe(2_000)
	})

	it("does not grow quadratically as the chain gets longer", () => {
		// Doubling the chain should roughly double the work. The 8x allowance
		// absorbs JIT warm-up and CI noise while still catching true O(n^2).
		const small = buildChain(300)
		const large = buildChain(600)
		small.setCell("A1", 2)
		large.setCell("A1", 2)
		const [, smallMs] = timed(() => small.setCell("A1", 3))
		const [, largeMs] = timed(() => large.setCell("A1", 3))
		expect(largeMs).toBeLessThan(Math.max(smallMs * 8, 250))
	})

	it("handles a wide fan-out", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		for (let i = 1; i <= 2_000; i++) sheet.setCell(`B${i}`, "=A1+1")
		const [, ms] = timed(() => sheet.setCell("A1", 5))
		expect(sheet.getCellValue("B2000")).toBe(6)
		expect(ms).toBeLessThan(FAST_MS)
	})

	it("notifies each dependent once per edit, not once per path", () => {
		// A diamond reaches D1 by two routes. A cascade that walked paths rather
		// than nodes would repaint D1 twice, and an N-deep diamond lattice would
		// repaint exponentially.
		const seen: string[] = []
		const sheet = createSheet({ onCellChanged: (id: string) => seen.push(id) })
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=A1+1")
		sheet.setCell("C1", "=A1+2")
		sheet.setCell("D1", "=B1+C1")
		seen.length = 0
		sheet.setCell("A1", 10)
		expect(seen.filter((id) => id === "D1")).toHaveLength(1)
	})

	it("survives repeated structural edits", () => {
		const sheet = createSheet({})
		for (let i = 1; i <= 200; i++) sheet.setCell(`A${i}`, `=${i}`)
		const [, ms] = timed(() => {
			for (let i = 0; i < 50; i++) {
				sheet.insertRow(0)
				sheet.deleteRow(0)
			}
		})
		expect(sheet.getCellValue("A1")).toBe(1)
		expect(ms).toBeLessThan(SLOW_MS)
	})
})

describe("large range aggregates", () => {
	function sheetWithColumn(n: number) {
		const sheet = createSheet({})
		for (let i = 1; i <= n; i++) sheet.setCell(`A${i}`, i)
		return sheet
	}

	it("aggregates a large range correctly", () => {
		const sheet = sheetWithColumn(5_000)
		sheet.setCell("B1", "=SUM(A1:A5000)")
		const [result, ms] = timed(() => sheet.getCellValue("B1"))
		expect(result).toBe((5_000 * 5_001) / 2)
		expect(ms).toBeLessThan(FAST_MS)
	})

	// KNOWN FAILURE — `flatten()` collects a range with `r.push(...flatten(item))`.
	// The spread passes every element as a separate argument, so past roughly
	// 125,000 cells it overflows the stack. `primary()` catches the RangeError and
	// returns #VALUE!, so the size of the data silently decides whether SUM
	// answers or fails. Whole-column references (`=SUM(A:A)`) expand to 1,048,576
	// cells and therefore ALWAYS hit this.
	it.fails("aggregates a range larger than the argument-spread limit", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", "=SUM(A1:A200000)")
		expect(sheet.getCellValue("B1")).toBe(1)
	})

	it.fails("aggregates a whole-column reference", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 7)
		sheet.setCell("B1", "=SUM(A:A)")
		expect(sheet.getCellValue("B1")).toBe(7)
	})

	it("reports the whole-column cost so a regression is visible", () => {
		// Whole-column refs expand literally to 1,048,576 rows instead of using
		// the used range, so this is a full second of work to add up one cell.
		// The assertion is a ceiling, not a target — the fix is to bound the
		// expansion, which will make this test finish in microseconds.
		const sheet = createSheet({})
		sheet.setCell("A1", 7)
		sheet.setCell("B1", "=SUM(A:A)")
		const [, ms] = timed(() => sheet.getCellValue("B1"))
		expect(ms).toBeLessThan(SLOW_MS)
	})
})
