// Date, lookup, financial, array and sparkline behaviour that the JSON corpus
// cannot express.
//
// `test-corpus/functions/{datetime,lookup,financial-array}.json` carries the
// bulk of the coverage for these families. Four kinds of case cannot live
// there and live here instead:
//
//   * results that are NaN, `undefined` or a plain JavaScript object — JSON has
//     no literal for any of them, and the corpus comparison would silently
//     coerce them;
//   * results that depend on the machine's time zone — the corpus asserts one
//     fixed value, so a time-zone-sensitive answer would make CI depend on
//     where it runs. Here the offset is read at run time and folded into the
//     assertion, which keeps the test deterministic everywhere;
//   * volatile functions, asserted through invariants that hold across a
//     midnight rollover rather than through a value;
//   * multi-cell behaviour — a matrix or a sparkline spec written into one cell
//     and read back from another. The corpus's direct fixtures evaluate a
//     single formula and have nowhere to put the second cell.
//
// Nothing here is a bug fix: `known-failure` blocks record what a spreadsheet
// would do next to what this engine does, so a future fix turns them red.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"

// The corpus harness writes its probe formula into the same far corner, so a
// fixture's own data can never collide with it.
const PROBE = "XFD1048576"

type Grid = Record<string, Record<string, string | number>>

function build(sheets: Grid = {}) {
	const sheet = createSheet({})
	for (const name of Object.keys(sheets)) if (name !== "Sheet1") sheet.addSheet(name)
	for (const [name, cells] of Object.entries(sheets))
		for (const [id, value] of Object.entries(cells)) sheet.setCell(id, value, name)
	return sheet
}

/** Evaluate one formula against an optional Sheet1 grid and return the raw value. */
function evalFormula(formula: string, cells: Record<string, string | number> = {}): unknown {
	const sheet = build({ Sheet1: cells })
	sheet.setCell(PROBE, formula, "Sheet1")
	return sheet.getCellValue(PROBE, "Sheet1")
}

// Minutes east of UTC at the given instant. `getTimezoneOffset` counts the
// other way, hence the sign. The instant matters: a zone that observes summer
// time has two offsets, and a day-fraction argument always lands on the Unix
// epoch, so that is the instant these tests must ask about.
function utcOffsetMinutes(at: number | string = 0): number {
	return -new Date(at).getTimezoneOffset()
}

describe("date functions: NaN leaks where a spreadsheet raises an error", () => {
	// Every one of these is #VALUE! in Excel and Google Sheets. The engine hands
	// back NaN, which is not an error: ISERROR is false, IFERROR does not catch
	// it, and SUM turns the whole column into NaN. JSON has no NaN literal, so
	// the corpus can only record that the answer is wrong, not what it is.
	const nanCases: Array<[string, string]> = [
		["=YEAR(\"junk\")", "unparseable date"],
		["=MONTH(\"\")", "empty text"],
		["=DAY()", "no argument at all"],
		["=HOUR(\"13:45:30\")", "a bare time string, which Excel accepts"],
		["=WEEKDAY(\"junk\")", "unparseable date"],
		["=DAYS(\"junk\",\"2026-02-01 00:00:00\")", "unparseable start date"],
		["=DATEDIF(\"junk\",\"2026-03-01 00:00:00\",\"D\")", "unparseable start date"],
	]

	for (const [formula, why] of nanCases) {
		it(`${formula} is NaN rather than #VALUE! (${why})`, () => {
			const v = evalFormula(formula)
			expect(typeof v).toBe("number")
			expect(Number.isNaN(v as number)).toBe(true)
		})
	}

	it("a NaN date reads as a silent zero downstream", () => {
		// toNum maps NaN to 0, so SUM treats the broken date as a zero and the
		// total looks healthy. In Excel a #VALUE! in A3 would propagate and make
		// the total an error, which is the whole point of having error values.
		const sheet = build({ Sheet1: { A1: 10, A2: 20, A3: "=YEAR(\"junk\")" } })
		expect(Number.isNaN(sheet.getCellValue("A3", "Sheet1") as number)).toBe(true)
		sheet.setCell(PROBE, "=SUM(A1:A3)", "Sheet1")
		expect(sheet.getCellValue(PROBE, "Sheet1")).toBe(30)
		// ISERROR is false and COUNT skips it, so neither guard notices.
		sheet.setCell(PROBE, "=COUNT(A1:A3)", "Sheet1")
		expect(sheet.getCellValue(PROBE, "Sheet1")).toBe(2)
	})

	it("ISERROR does not see a NaN date, so IFERROR cannot guard one", () => {
		expect(evalFormula("=ISERROR(YEAR(\"junk\"))")).toBe(false)
		expect(Number.isNaN(evalFormula("=IFERROR(YEAR(\"junk\"),\"caught\")") as number)).toBe(true)
	})
})

describe("date functions: the parse is UTC-anchored but the getters are local", () => {
	// `new Date('2026-05-23')` is UTC midnight by specification, while
	// getFullYear/getMonth/getDate read local time. West of Greenwich the two
	// disagree and every date shifts back by a day. Asserting the day directly
	// would make this test pass or fail according to where it runs, so it
	// asserts the leak itself: the hour-of-day of a pure date must be zero.
	// The date under test is 2026-05-23, so the offset in force on that day is
	// the one that decides the answer.
	const offset = utcOffsetMinutes("2026-05-23T00:00:00Z")

	it("HOUR of a date-only string exposes the machine's UTC offset", () => {
		const expectedHour = Math.floor((((offset % 1440) + 1440) % 1440) / 60)
		expect(evalFormula("=HOUR(\"2026-05-23\")")).toBe(expectedHour)
		// In a spreadsheet a date with no time part always has hour 0.
		if (offset !== 0) expect(evalFormula("=HOUR(\"2026-05-23\")")).not.toBe(0)
	})

	it("DAY of a date-only string shifts back a day west of Greenwich", () => {
		// The spreadsheet answer is 23 everywhere.
		expect(evalFormula("=DAY(\"2026-05-23\")")).toBe(offset >= 0 ? 23 : 22)
	})

	it("DATE and DAY do not round-trip west of Greenwich", () => {
		// DATE builds from local components, DAY re-parses as UTC, so the pair
		// only agrees in zones at or east of Greenwich.
		expect(evalFormula("=DAY(DATE(2026,5,23))")).toBe(offset >= 0 ? 23 : 22)
	})

	it("writing the same date with an explicit local time is stable everywhere", () => {
		// This is why the corpus fixtures use the space-separated form.
		expect(evalFormula("=DAY(\"2026-05-23 00:00:00\")")).toBe(23)
		expect(evalFormula("=HOUR(\"2026-05-23 00:00:00\")")).toBe(0)
	})
})

describe("HOUR / MINUTE / SECOND cannot read a day fraction", () => {
	// Excel stores a time as a fraction of a day, which is exactly what TIME
	// returns. HOUR feeds that fraction to `new Date()`, which reads it as a
	// millisecond count, so the answer is the machine's UTC offset instead of
	// the requested hour.
	// A day fraction is a handful of milliseconds, so the instant is the epoch.
	const offsetHours = Math.floor((((utcOffsetMinutes(0) % 1440) + 1440) % 1440) / 60)

	it("HOUR(0.5) is the UTC offset, not noon", () => {
		expect(evalFormula("=HOUR(0.5)")).toBe(offsetHours)
	})

	it("HOUR cannot read back what TIME wrote", () => {
		expect(evalFormula("=HOUR(TIME(23,45,30))")).toBe(offsetHours)
		// Spreadsheet answer is 23, which no real UTC offset can coincide with.
		expect(evalFormula("=HOUR(TIME(23,45,30))")).not.toBe(23)
	})

	it("TIMEVALUE output is equally unreadable", () => {
		expect(evalFormula("=HOUR(TIMEVALUE(\"23:45\"))")).not.toBe(23)
	})

	it("TIME itself produces the correct fraction, so only the reader is broken", () => {
		expect(evalFormula("=TIME(13,45,30)")).toBeCloseTo((13 * 3600 + 45 * 60 + 30) / 86400, 12)
	})
})

describe("volatile date functions", () => {
	// Asserted through invariants and shape. Nothing here compares against the
	// wall clock, so a run that straddles midnight cannot flip the result.

	it("TODAY returns a fixed-width ISO date", () => {
		const today = evalFormula("=TODAY()")
		expect(typeof today).toBe("string")
		expect(today as string).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it("TODAY is stable within one evaluation", () => {
		expect(evalFormula("=DAYS(TODAY(),TODAY())")).toBe(0)
		expect(evalFormula("=TODAY()=TODAY()")).toBe(true)
	})

	it("two reads a moment apart differ by at most one day", () => {
		// The only way the two can differ is a midnight rollover between them.
		const sheet = build({ Sheet1: { A1: "=TODAY()", A2: "=DATEVALUE(TODAY())" } })
		const first = sheet.getCellValue("A2", "Sheet1") as number
		const second = sheet.getCellValue("A2", "Sheet1") as number
		expect(Math.abs(second - first)).toBeLessThanOrEqual(1)
	})

	it("TODAY bypasses the memo cache", () => {
		const sheet = build({ Sheet1: { A1: "=TODAY()" } })
		sheet._resetMemoStats()
		sheet.getCellValue("A1", "Sheet1")
		sheet.getCellValue("A1", "Sheet1")
		expect(sheet._memoStats().hits).toBe(0)
	})

	it("NOW disagrees with TODAY on format, so it feeds no date function", () => {
		const now = evalFormula("=NOW()")
		expect(typeof now).toBe("string")
		// Spreadsheet behaviour: NOW is TODAY plus a time, and both are numbers
		// on the same scale. Here NOW is a locale string, so the ISO prefix that
		// every date function in this engine needs is absent.
		expect(now as string).not.toMatch(/^\d{4}-\d{2}-\d{2}/)
		expect(evalFormula("=DATEVALUE(NOW())")).not.toBe(evalFormula("=DATEVALUE(TODAY())"))
	})

	it("neither volatile function checks its argument count", () => {
		expect(evalFormula("=LEN(TODAY(1,2,3))")).toBe(10)
		expect(typeof evalFormula("=NOW(1)")).toBe("string")
	})
})

describe("a date typed into a cell is read back as a number", () => {
	// getCellValue parseFloat's every stored string, and parseFloat('2026-01-15')
	// is 2026. So a date the user typed reaches every date and lookup function
	// as the number 2026. This is the root cause behind several corpus
	// known-failures and is easiest to see directly.

	it("the cell value is the year, not the date", () => {
		const sheet = build({ Sheet1: { A1: "2026-01-15" } })
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(2026)
	})

	it("two different dates in the same year become the same number", () => {
		const sheet = build({ Sheet1: { A1: "2026-01-15", A2: "2026-02-15" } })
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(sheet.getCellValue("A2", "Sheet1"))
		// A spreadsheet gives -31 here.
		sheet.setCell(PROBE, "=DAYS(A1,A2)", "Sheet1")
		expect(sheet.getCellValue(PROBE, "Sheet1")).toBe(0)
	})

	it("SUM over a column of dates totals the years", () => {
		// Excel totals the serials: 46037 + 46068 = 92105.
		expect(evalFormula("=SUM(A1:A2)", { A1: "2026-01-15", A2: "2026-02-15" })).toBe(4052)
	})

	it("a lookup cannot find a date that is in the column", () => {
		const cells = { A1: "2026-01-15", B1: "jan", A2: "2026-02-15", B2: "feb" }
		expect(evalFormula("=VLOOKUP(\"2026-02-15\",A1:B2,2,FALSE)", cells)).toBe("#N/A")
		expect(evalFormula("=MATCH(\"2026-02-15\",A1:A2,0)", cells)).toBe("#N/A")
		// Both rows collapse to 2026, so an approximate lookup matches the wrong one.
		expect(evalFormula("=VLOOKUP(2026,A1:B2,2,FALSE)", cells)).toBe("jan")
	})
})

describe("lookup and reference: results JSON cannot hold", () => {
	it("INDEX with no arguments returns undefined, not an error", () => {
		// Neither a value nor an error: ISERROR is false and the cell reads blank.
		expect(evalFormula("=INDEX()")).toBeUndefined()
		expect(evalFormula("=ISERROR(INDEX())")).toBe(false)
	})

	it("CHOOSE with a fractional index returns undefined", () => {
		// Excel truncates 2.7 to 2 and returns "b".
		expect(evalFormula("=CHOOSE(2.7,\"a\",\"b\",\"c\")")).toBeUndefined()
	})

	it("an undefined result displays as an empty cell", () => {
		const sheet = build({ Sheet1: { A1: "=INDEX()" } })
		expect(sheet.getDisplayValue("A1")).toBe("")
	})

	it("ROW and COLUMN read the CONTENTS of the cell they are asked about", () => {
		// The parser evaluates the argument before the function sees it, so the
		// reference is gone by then. When the contents happen to look like a
		// cell id, the answer is derived from the data instead of the address.
		expect(evalFormula("=ROW(A1)", { A1: "C7" })).toBe(7)
		expect(evalFormula("=COLUMN(A1)", { A1: "C7" })).toBe(3)
		// Same formula, different data, different answer.
		expect(evalFormula("=ROW(A1)", { A1: "Z99" })).toBe(99)
		// Spreadsheet answer for all three: ROW(A1) is 1 and COLUMN(A1) is 1.
	})
})

describe("array functions have no spill semantics", () => {
	it("a matrix written into a cell stays a matrix", () => {
		const sheet = build({ Sheet1: { A1: 1, A2: 2, A3: 3, C1: "=SEQUENCE(3)" } })
		// A spreadsheet spills into C1:C3 and C1 reads 1.
		expect(sheet.getCellValue("C1", "Sheet1")).toEqual([1, 2, 3])
	})

	it("the neighbouring cells a spill would occupy stay empty", () => {
		const sheet = build({ Sheet1: { C1: "=SEQUENCE(3)" } })
		expect(sheet.getCellValue("C2", "Sheet1")).toBe(0)
		expect(sheet.getCellValue("C3", "Sheet1")).toBe(0)
	})

	it("a matrix cell displays every value joined by commas", () => {
		const sheet = build({ Sheet1: { A1: 1, A2: 2, A3: 3 } })
		sheet.setCell("B1", "=SEQUENCE(3)")
		sheet.setCell("B2", "=TRANSPOSE(A1:A3)")
		sheet.setCell("B3", "=UNIQUE(A1:A3)")
		// A spreadsheet shows "1" in each of these.
		expect(sheet.getDisplayValue("B1")).toBe("1,2,3")
		expect(sheet.getDisplayValue("B2")).toBe("1,2,3")
		expect(sheet.getDisplayValue("B3")).toBe("1,2,3")
	})

	it("reading a matrix cell back into arithmetic is a type error", () => {
		const sheet = build({ Sheet1: { C1: "=SEQUENCE(3)", D1: "=C1+1" } })
		// Spreadsheet answer: 2.
		expect(sheet.getCellValue("D1", "Sheet1")).toBe("#VALUE!")
	})

	it("reading a matrix cell back into a text function measures the join", () => {
		const sheet = build({ Sheet1: { C1: "=SEQUENCE(3)", D1: "=LEN(C1)" } })
		// Spreadsheet answer: 1, the length of "1".
		expect(sheet.getCellValue("D1", "Sheet1")).toBe(5)
	})

	it("reading a matrix cell into an aggregate totals the whole matrix", () => {
		const sheet = build({ Sheet1: { C1: "=SEQUENCE(3)", D1: "=SUM(C1)" } })
		// Spreadsheet answer: 1, because SUM(C1) reads one spilled cell.
		expect(sheet.getCellValue("D1", "Sheet1")).toBe(6)
	})

	it("a matrix survives a cross-sheet read unchanged", () => {
		const sheet = build({
			Sheet1: { A1: "=Data!C1" },
			Data: { A1: 1, A2: 2, A3: 3, C1: "=TRANSPOSE(A1:A3)" },
		})
		expect(sheet.getCellValue("C1", "Data")).toEqual([[1, 2, 3]])
	})

	it("array functions with no arguments return undefined rather than an error", () => {
		expect(evalFormula("=SORT()")).toBeUndefined()
		expect(evalFormula("=UNIQUE()")).toBeUndefined()
		expect(evalFormula("=FILTER()")).toBeUndefined()
	})

	it("TRANSPOSE with no argument builds a matrix around nothing", () => {
		expect(evalFormula("=TRANSPOSE()")).toEqual([[undefined]])
	})
})

describe("SPARKLINE returns a render-only spec", () => {
	const data = { A1: 1, A2: 5, A3: 3 }

	it("builds a line spec by default", () => {
		expect(evalFormula("=SPARKLINE(A1:A3)", data)).toEqual({
			__spark: true,
			type: "line",
			data: [1, 5, 3],
			color: null,
		})
	})

	it("accepts a type and a colour", () => {
		expect(evalFormula("=SPARKLINE(A1:A3,\"column\",\"red\")", data)).toEqual({
			__spark: true,
			type: "column",
			data: [1, 5, 3],
			color: "red",
		})
	})

	it("normalises the type case and accepts a hex colour", () => {
		expect(evalFormula("=SPARKLINE(A1:A3,\"COLUMN\",\"#ff0000\")", data)).toMatchObject({
			type: "column",
			color: "#ff0000",
		})
	})

	it("falls back to the defaults for an unknown type or colour", () => {
		// "bluee" is the documented trap: a bare /[a-z]+/ check would admit it and
		// leave the canvas painting in whatever colour was last set.
		expect(evalFormula("=SPARKLINE(A1:A3,\"bogus\",\"bluee\")", data)).toMatchObject({
			type: "line",
			color: null,
		})
	})

	it("ignores a non-string colour", () => {
		expect(evalFormula("=SPARKLINE(A1:A3,\"line\",5)", data)).toMatchObject({ color: null })
	})

	it("drops non-numeric data points", () => {
		expect(evalFormula("=SPARKLINE(A1:A3)", { A1: 1, A2: "text", A3: 3 })).toMatchObject({
			data: [1, 3],
		})
	})

	it("drops an error inside the data range", () => {
		expect(evalFormula("=SPARKLINE(A1:A2)", { A1: 1, A2: "=1/0" })).toMatchObject({ data: [1] })
	})

	it("accepts a computed matrix as its data source", () => {
		expect(evalFormula("=SPARKLINE(SEQUENCE(3))")).toMatchObject({ data: [1, 2, 3] })
	})

	it("wraps a scalar as a one-point spec", () => {
		expect(evalFormula("=SPARKLINE(5)")).toMatchObject({ data: [5] })
	})

	it("builds an empty spec with no arguments instead of reporting an error", () => {
		// Google Sheets rejects the call. An empty spec renders as a blank cell,
		// so the mistake is invisible.
		expect(evalFormula("=SPARKLINE()")).toMatchObject({ data: [] })
	})

	it("renders as an empty cell rather than as text", () => {
		const sheet = build({ Sheet1: { ...data, B1: "=SPARKLINE(A1:A3)" } })
		expect(sheet.getDisplayValue("B1")).toBe("")
	})

	it("a blank cell inside the range becomes a zero data point", () => {
		// sparkSpec is written to treat a blank as a gap, but getCellValue turns
		// an empty cell into 0 before the filter can see it, so the sparkline
		// draws a spurious dip to zero.
		expect(evalFormula("=SPARKLINE(A1:A4)", { A1: 1, A2: 5, A3: 3, A4: "" })).toMatchObject({
			data: [1, 5, 3, 0],
		})
	})

	it("does not leak through the concatenation operator", () => {
		expect(evalFormula("=\"x\"&SPARKLINE(A1:A3)", data)).toBe("x")
	})

	it("leaks through CONCATENATE and LEN", () => {
		// `&` routes through the `_str` helper; these two call String() directly,
		// so the same value renders two different ways.
		expect(evalFormula("=CONCATENATE(\"a\",SPARKLINE(A1:A3))", data)).toBe("a[object Object]")
		expect(evalFormula("=LEN(SPARKLINE(A1:A3))", data)).toBe(15)
	})

	it("a spec read back from another cell still does not leak through `&`", () => {
		const sheet = build({ Sheet1: { ...data, B1: "=SPARKLINE(A1:A3)", C1: "=\"x\"&B1" } })
		expect(sheet.getCellValue("C1", "Sheet1")).toBe("x")
	})

	it("a spec read back from another cell leaks through LEN", () => {
		const sheet = build({ Sheet1: { ...data, B1: "=SPARKLINE(A1:A3)", C1: "=LEN(B1)" } })
		expect(sheet.getCellValue("C1", "Sheet1")).toBe(15)
	})

	it("recomputes when its data changes", () => {
		const sheet = build({ Sheet1: { ...data, B1: "=SPARKLINE(A1:A3)" } })
		expect(sheet.getCellValue("B1", "Sheet1")).toMatchObject({ data: [1, 5, 3] })
		sheet.setCell("A2", 9, "Sheet1")
		expect(sheet.getCellValue("B1", "Sheet1")).toMatchObject({ data: [1, 9, 3] })
	})
})

describe("financial functions: values JSON cannot hold", () => {
	it("NPV with a rate of -1 returns Infinity instead of a division error", () => {
		// The discount factor is (1+r)^i, which is 0 here, so the cash flow is
		// divided by zero. Excel reports #DIV/0!. Infinity is not an error, so
		// ISERROR misses it and IFERROR cannot guard it.
		expect(evalFormula("=NPV(-1,100)")).toBe(Infinity)
		expect(evalFormula("=ISERROR(NPV(-1,100))")).toBe(false)
	})

	it("PMT with a rate of -1 returns negative zero", () => {
		// A rate of -100% is nonsense and Excel reports #NUM!. JSON has no -0
		// literal, which is the other reason this case cannot live in the corpus.
		expect(Object.is(evalFormula("=PMT(-1,1,10000)"), -0)).toBe(true)
	})

	it("FV of a rate that overflows the exponent is Infinity, not #NUM!", () => {
		const v = evalFormula("=FV(1e308,2,0,-1)")
		expect(Number.isFinite(v as number)).toBe(false)
	})
})
