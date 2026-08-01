// Math and statistics function tests that the JSON corpus cannot express.
//
// Everything with a single formula and a single scalar answer lives in
// `test-corpus/functions/math.json` and `test-corpus/functions/statistics.json`.
// This file holds the rest:
//
//   * results JSON has no literal for — Infinity, NaN, undefined, -0
//   * volatile functions, where only a distribution can be asserted
//   * inputs too large to write out as a fixture
//   * one non-terminating call that must never be executed
//
// Where the engine disagrees with Excel or Google Sheets, the assertion records
// what the engine does today and the comment names the correct answer. That
// keeps the suite green while making a fix visible: the fix turns the
// assertion red and forces this file to be updated with it.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"

const PROBE = "XFD1048576"

function evalIn(formula: string, sheets?: Record<string, Record<string, string | number>>): unknown {
	const sheet = createSheet({})
	for (const name of Object.keys(sheets ?? {})) if (name !== "Sheet1") sheet.addSheet(name)
	for (const [name, cells] of Object.entries(sheets ?? {}))
		for (const [id, value] of Object.entries(cells)) sheet.setCell(id, value, name)
	sheet.setCell(PROBE, formula, "Sheet1")
	return sheet.getCellValue(PROBE, "Sheet1")
}

function column(rows: number, value: string | number = 1): Record<string, string | number> {
	const cells: Record<string, string | number> = {}
	for (let r = 1; r <= rows; r++) cells[`A${r}`] = value
	return cells
}

// ── Results JSON cannot hold ─────────────────────────────────────────────────

describe("non-finite results", () => {
	// Excel's numeric range stops at about 1.79E308 and every overflow past it
	// is #NUM!. The engine hands back the raw IEEE-754 Infinity instead, which
	// then poisons any cell that reads it.
	it.each([
		["=SUM(1E308,1E308)", "#NUM!"],
		["=POWER(10,309)", "#NUM!"],
		["=EXP(1000)", "#NUM!"],
		["=FACT(171)", "#NUM!"],
		["=SINH(1000)", "#NUM!"],
		["=COSH(1000)", "#NUM!"],
		["=LOG(8,1)", "#DIV/0!"],
		["=HARMEAN(-1,1)", "#NUM!"],
	])("%s overflows to Infinity instead of %s", (formula) => {
		const result = evalIn(formula)
		expect(typeof result).toBe("number")
		expect(Number.isFinite(result as number)).toBe(false)
		expect(Number.isNaN(result as number)).toBe(false)
	})

	// A negative base with a fractional exponent has no real result; Excel
	// reports #NUM!. NaN leaks straight through instead, and NaN compares
	// unequal to itself, so a dependent IF() silently takes the false branch.
	it("POWER with a negative base and fractional exponent yields NaN, not #NUM!", () => {
		expect(Number.isNaN(evalIn("=POWER(-8,1/3)") as number)).toBe(true)
	})

	// MEDIAN over nothing is #NUM! in Excel. Here the mean of two undefined
	// array slots produces NaN.
	it("MEDIAN with no arguments yields NaN, not #NUM!", () => {
		expect(Number.isNaN(evalIn("=MEDIAN()") as number)).toBe(true)
	})

	// LARGE and SMALL must truncate k. The engine indexes the sorted array with
	// the fractional k, lands between elements and returns undefined — a value
	// no spreadsheet can display and no JSON fixture can record.
	it.each([
		["=LARGE(A1:A5,2.7)", 4],
		["=SMALL(A1:A5,2.7)", 2],
	])("%s returns undefined instead of %i", (formula) => {
		expect(evalIn(formula, { Sheet1: { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 } })).toBeUndefined()
	})

	// A spreadsheet has one zero. JavaScript has two, and the negative one
	// escapes here. It compares equal to 0 so nothing downstream breaks today,
	// but it does serialise as "-0" through JSON.
	it("SIGN(-0) keeps the negative zero", () => {
		expect(Object.is(evalIn("=SIGN(-0)"), -0)).toBe(true)
	})
})

// ── flatten() and range size ─────────────────────────────────────────────────

describe("large ranges", () => {
	// `flatten` appends with `r.push(...sub)`, so the whole range becomes one
	// argument list. Past the engine's stack limit the spread throws
	// RangeError, the blanket try/catch around every function call swallows it,
	// and a plain SUM turns into #VALUE!. Excel handles a full column.
	it("SUM survives 100,000 cells", () => {
		expect(evalIn("=SUM(A1:A100000)", { Sheet1: column(100000) })).toBe(100000)
	})

	it("SUM over 130,000 cells reports #VALUE! instead of the total", () => {
		expect(evalIn("=SUM(A1:A130000)", { Sheet1: column(130000) })).toBe("#VALUE!")
	})

	it("every range aggregate fails the same way at 130,000 cells", () => {
		const sheets = { Sheet1: column(130000) }
		for (const fn of ["SUM", "AVERAGE", "COUNT", "COUNTA", "MAX", "MIN", "PRODUCT", "MEDIAN"]) {
			expect(evalIn(`=${fn}(A1:A130000)`, sheets), fn).toBe("#VALUE!")
		}
	})

	// The failure is silent: it reports the same value as a genuine type error,
	// so a user has no way to tell a size limit from bad input.
	it("a stack overflow is indistinguishable from a type error", () => {
		expect(evalIn("=SUM(A1:A130000)", { Sheet1: column(130000) })).toBe(evalIn('="a"+1'))
	})
})

// ── Volatile functions ───────────────────────────────────────────────────────

describe("RAND", () => {
	function samples(formula: string, n: number): number[] {
		const out: number[] = []
		for (let i = 0; i < n; i++) out.push(evalIn(formula) as number)
		return out
	}

	it("stays within [0,1)", () => {
		for (const v of samples("=RAND()", 500)) {
			expect(typeof v).toBe("number")
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(1)
		}
	})

	it("does not repeat itself", () => {
		expect(new Set(samples("=RAND()", 500)).size).toBeGreaterThan(490)
	})

	it("spreads roughly evenly across the unit interval", () => {
		const buckets = new Array(10).fill(0)
		for (const v of samples("=RAND()", 4000)) buckets[Math.floor(v * 10)]++
		// 400 expected per bucket; a wide band keeps this from flaking.
		for (const count of buckets) expect(count).toBeGreaterThan(250)
	})

	it("is not cached between reads of the same cell", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", "=RAND()")
		const seen = new Set<unknown>()
		for (let i = 0; i < 20; i++) seen.add(sheet.getCellValue("A1"))
		expect(seen.size).toBeGreaterThan(1)
	})
})

describe("RANDBETWEEN", () => {
	function samples(formula: string, n: number): number[] {
		const out: number[] = []
		for (let i = 0; i < n; i++) out.push(evalIn(formula) as number)
		return out
	}

	it("returns integers inside the inclusive bounds", () => {
		for (const v of samples("=RANDBETWEEN(1,6)", 600)) {
			expect(Number.isInteger(v)).toBe(true)
			expect(v).toBeGreaterThanOrEqual(1)
			expect(v).toBeLessThanOrEqual(6)
		}
	})

	it("reaches both endpoints", () => {
		const seen = new Set(samples("=RANDBETWEEN(1,6)", 600))
		expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
	})

	it("handles a negative range", () => {
		const seen = new Set(samples("=RANDBETWEEN(-3,-1)", 300))
		expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1])
	})

	// Excel reports #NUM! when bottom exceeds top. The engine builds a range
	// from the reversed bounds and returns a number from inside it.
	it("accepts reversed bounds instead of reporting #NUM!", () => {
		for (const v of samples("=RANDBETWEEN(6,1)", 200)) {
			expect(Number.isInteger(v)).toBe(true)
			expect(v).toBeGreaterThanOrEqual(1)
			expect(v).toBeLessThanOrEqual(6)
		}
	})

	// Both arguments are required. With none the bounds collapse to 0 and the
	// call is silently deterministic.
	it("with no arguments always returns 0", () => {
		expect(new Set(samples("=RANDBETWEEN()", 50))).toEqual(new Set([0]))
	})
})

// ── Non-termination ──────────────────────────────────────────────────────────

describe("SUMPRODUCT with no arguments", () => {
	// DO NOT REMOVE THE SKIP. `Math.min()` over zero arrays is Infinity, so
	// `for (let i = 0; i < len; i++)` never ends and `arrays.reduce(..., 1)`
	// over an empty list keeps adding 1. `=SUMPRODUCT()` hangs the thread it
	// runs on — in the browser that is the UI thread. Excel and Google Sheets
	// reject the call. The test is written out so the defect is discoverable
	// from the suite, and skipped so it cannot hang CI.
	it.skip("hangs forever — enable only after the arity guard lands", () => {
		expect(evalIn("=SUMPRODUCT()")).toBe("#N/A")
	})

	// One argument terminates, so the neighbouring behaviour is still pinned.
	it("with one argument behaves like SUM", () => {
		expect(evalIn("=SUMPRODUCT(A1:A4)", { Sheet1: { A1: 3, A2: 8, A3: 1, A4: 4 } })).toBe(16)
	})
})

// ── Error masking ────────────────────────────────────────────────────────────

describe("errors from inside a function", () => {
	// Every call site is wrapped in `try { fn(args) } catch { '#VALUE!' }`, so
	// an internal crash reports the same value as a type error in the operands.
	// The two have completely different causes: one is bad input, the other is
	// the engine hitting its own limit on input Excel accepts.
	it("an internal crash reports the same value as a type error", () => {
		const crash = evalIn("=SUM(A1:A130000)", { Sheet1: column(130000) })
		const typeError = evalIn('="a"+1')
		expect(crash).toBe("#VALUE!")
		expect(typeError).toBe("#VALUE!")
	})
})

// ── Arity ────────────────────────────────────────────────────────────────────

describe("argument count is never checked", () => {
	// No function in the table validates how many arguments it received. Excel
	// refuses these at entry; Google Sheets returns #N/A. The engine answers
	// every one of them with a number, which is the failure mode a user cannot
	// see. Individual expectations live in the JSON corpus; this test states
	// the property once, across the whole family.
	const CALLS = [
		"=SUM()",
		"=PRODUCT()",
		"=ABS()",
		"=ABS(1,2)",
		"=SQRT()",
		"=PI(5)",
		"=ROUND()",
		"=POWER()",
		"=EXP()",
		"=MOD(5,3,1)",
		"=SIN()",
		"=COS(1,2)",
		"=DEGREES()",
		"=COMBIN()",
		"=PERMUT()",
		"=MAX()",
		"=MIN()",
		"=COUNT()",
		"=COUNTA()",
		"=COUNTBLANK()",
		"=N()",
		"=N(1,2)",
	]

	it.each(CALLS)("%s returns a number rather than an error", (formula) => {
		expect(typeof evalIn(formula)).toBe("number")
	})
})
