// Numeric coercion, error propagation and numeric boundaries.
//
// The heart of this file is a generated matrix: every value type in both
// operand positions against every arithmetic and comparison operator. Writing
// 972 JSON fixtures for that would be unreadable, so the matrix lives here and
// only the interesting rows are also fixtures in test-corpus/arithmetic.json.
//
// The matrix is checked twice.
//
//   1. `engineValue` is an executable model of the semantics this engine
//      actually implements. Asserting the engine matches it pins every cell of
//      the matrix, so any behaviour change shows up as a named failure rather
//      than a silent drift.
//   2. `excelValue` is a model of Excel/Sheets semantics. The two models are
//      diffed and the number of disagreements per operator is asserted. Those
//      counts are a defect budget: repairing coercion makes them fall and this
//      file goes red, which is the signal to update it together with the corpus.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"

const PROBE = "XFD1048576"
const GRID = { A1: 1, A2: 2 }

function evaluate(formula: string): unknown {
	const sheet = createSheet({})
	for (const [id, v] of Object.entries(GRID)) sheet.setCell(id, v, "Sheet1")
	sheet.setCell(PROBE, formula, "Sheet1")
	return sheet.getCellValue(PROBE, "Sheet1")
}

function display(formula: string): string {
	const sheet = createSheet({})
	sheet.setCell(PROBE, formula, "Sheet1")
	return String(sheet.getDisplayValue(PROBE, "Sheet1"))
}

// ── The type matrix ───────────────────────────────────────────────────────────

type Kind = "number" | "text" | "bool" | "blank" | "error"

interface Operand {
	/** How the operand is written inside a formula. */
	src: string
	/** The value this engine hands to the operators. */
	engine: unknown
	/** The value Excel hands to the operators. */
	kind: Kind
	excel: unknown
}

// `Z99` is deliberately never written to, so it exercises the blank path.
const OPERANDS: Record<string, Operand> = {
	int: { src: "2", engine: 2, kind: "number", excel: 2 },
	zero: { src: "0", engine: 0, kind: "number", excel: 0 },
	// The engine resolves an unset cell to the NUMBER 0, not to a blank.
	blank: { src: "Z99", engine: 0, kind: "blank", excel: null },
	emptystr: { src: '""', engine: "", kind: "text", excel: "" },
	numstr: { src: '"3"', engine: "3", kind: "text", excel: "3" },
	text: { src: '"abc"', engine: "abc", kind: "text", excel: "abc" },
	boolTrue: { src: "TRUE", engine: true, kind: "bool", excel: true },
	boolFalse: { src: "FALSE", engine: false, kind: "bool", excel: false },
	error: { src: "(1/0)", engine: "#DIV/0!", kind: "error", excel: "#DIV/0!" },
}
const OPERAND_NAMES = Object.keys(OPERANDS)

const ARITHMETIC = ["+", "-", "*", "/", "^"] as const
const COMPARISON = ["=", "<>", ">", "<", ">=", "<="] as const
const ALL_OPS = [...ARITHMETIC, "&", ...COMPARISON] as const

// ── Model of the engine as implemented ────────────────────────────────────────

const isErr = (v: unknown) => typeof v === "string" && v.startsWith("#")

function toNum(v: unknown): number {
	if (v === true) return 1
	if (v === false) return 0
	if (v === "" || v == null) return 0
	const n = Number(v)
	return Number.isNaN(n) ? 0 : n
}

function toNumStrict(v: unknown): number | string {
	if (isErr(v)) return v as string
	if (v === true) return 1
	if (v === false) return 0
	if (v === "" || v == null) return 0
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isNaN(n) ? "#VALUE!" : n
}

const str = (v: unknown) => (v == null ? "" : String(v))

function engineValue(op: string, l: unknown, r: unknown): unknown {
	if (op === "&") return str(l) + str(r)
	if (op === "=") return str(l).toLowerCase() === str(r).toLowerCase() || toNum(l) === toNum(r)
	if (op === "<>") return str(l).toLowerCase() !== str(r).toLowerCase()
	if (op === ">") return toNum(l) > toNum(r)
	if (op === "<") return toNum(l) < toNum(r)
	if (op === ">=") return toNum(l) >= toNum(r)
	if (op === "<=") return toNum(l) <= toNum(r)

	// `pow()` has no isErr pre-check and simply coerces left then right, so a
	// non-numeric left operand outranks an error on the right. `+ - * /` check
	// for errors first and therefore answer the other way round. That makes the
	// engine's error precedence depend on which operator you used.
	if (op !== "^") {
		if (isErr(l)) return l
		if (isErr(r)) return r
	}
	const ln = toNumStrict(l)
	if (isErr(ln)) return ln
	const rn = toNumStrict(r)
	if (isErr(rn)) return rn
	const a = ln as number
	const b = rn as number
	switch (op) {
		case "+":
			return a + b
		case "-":
			return a - b
		case "*":
			return a * b
		case "/":
			return b === 0 ? "#DIV/0!" : a / b
		case "^":
			return Math.pow(a, b)
	}
	throw new Error(`unmodelled operator ${op}`)
}

// ── Model of Excel / Google Sheets ────────────────────────────────────────────

/** Excel coerces an operand for arithmetic, or returns an error string. */
function excelNum(o: Operand): number | string {
	switch (o.kind) {
		case "error":
			return o.excel as string
		case "blank":
			return 0
		case "bool":
			return o.excel ? 1 : 0
		case "number":
			return o.excel as number
		case "text": {
			const s = o.excel as string
			if (s.trim() === "") return "#VALUE!"
			const n = Number(s)
			return Number.isNaN(n) ? "#VALUE!" : n
		}
	}
}

function excelText(o: Operand): string {
	switch (o.kind) {
		case "blank":
			return ""
		case "bool":
			return o.excel ? "TRUE" : "FALSE"
		default:
			return String(o.excel)
	}
}

// Excel's cross-type ordering: every number < every text < FALSE < TRUE.
const RANK: Record<Exclude<Kind, "error" | "blank">, number> = { number: 0, text: 1, bool: 2 }

/**
 * Excel compares a blank against whatever the other operand is: as 0 next to a
 * number, as "" next to text, as FALSE next to a boolean.
 */
function asComparable(o: Operand, other: Operand): { rank: number; value: number | string | boolean } {
	if (o.kind === "blank") {
		const k = other.kind === "blank" ? "number" : other.kind
		if (k === "text") return { rank: RANK.text, value: "" }
		if (k === "bool") return { rank: RANK.bool, value: false }
		return { rank: RANK.number, value: 0 }
	}
	return { rank: RANK[o.kind as "number" | "text" | "bool"], value: o.excel as number | string | boolean }
}

function excelCompare(op: string, l: Operand, r: Operand): unknown {
	if (l.kind === "error") return l.excel
	if (r.kind === "error") return r.excel

	const a = asComparable(l, r)
	const b = asComparable(r, l)
	let cmp: number
	if (a.rank !== b.rank) {
		cmp = a.rank < b.rank ? -1 : 1
	} else if (a.rank === RANK.text) {
		const x = String(a.value).toLowerCase()
		const y = String(b.value).toLowerCase()
		cmp = x < y ? -1 : x > y ? 1 : 0
	} else {
		const x = Number(a.value)
		const y = Number(b.value)
		cmp = x < y ? -1 : x > y ? 1 : 0
	}

	switch (op) {
		case "=":
			return cmp === 0
		case "<>":
			return cmp !== 0
		case ">":
			return cmp > 0
		case "<":
			return cmp < 0
		case ">=":
			return cmp >= 0
		case "<=":
			return cmp <= 0
	}
	throw new Error(`unmodelled comparison ${op}`)
}

function excelValue(op: string, l: Operand, r: Operand): unknown {
	if (COMPARISON.includes(op as (typeof COMPARISON)[number])) return excelCompare(op, l, r)
	if (op === "&") {
		if (l.kind === "error") return l.excel
		if (r.kind === "error") return r.excel
		return excelText(l) + excelText(r)
	}
	if (l.kind === "error") return l.excel
	if (r.kind === "error") return r.excel
	const a = excelNum(l)
	if (typeof a === "string") return a
	const b = excelNum(r)
	if (typeof b === "string") return b
	switch (op) {
		case "+":
			return a + b
		case "-":
			return a - b
		case "*":
			return a * b
		case "/":
			return b === 0 ? "#DIV/0!" : a / b
		case "^":
			return Math.pow(a, b)
	}
	throw new Error(`unmodelled operator ${op}`)
}

// ── The matrix tests ──────────────────────────────────────────────────────────

describe("coercion matrix: engine semantics are pinned", () => {
	for (const op of ALL_OPS) {
		it(`\`${op}\` matches the model of the engine for all 81 operand pairs`, () => {
			for (const ln of OPERAND_NAMES) {
				for (const rn of OPERAND_NAMES) {
					const l = OPERANDS[ln]
					const r = OPERANDS[rn]
					const formula = `=${l.src}${op}${r.src}`
					expect(evaluate(formula), `${formula} (${ln} ${op} ${rn})`).toEqual(
						engineValue(op, l.engine, r.engine),
					)
				}
			}
		})
	}
})

/** Every operand pair where the engine and Excel disagree, for one operator. */
function divergences(op: string): string[] {
	const out: string[] = []
	for (const ln of OPERAND_NAMES) {
		for (const rn of OPERAND_NAMES) {
			const l = OPERANDS[ln]
			const r = OPERANDS[rn]
			const mine = engineValue(op, l.engine, r.engine)
			const theirs = excelValue(op, l, r)
			if (!Object.is(mine, theirs)) out.push(`${ln} ${op} ${rn}`)
		}
	}
	return out
}

// Defect budget: how many of the 81 operand pairs disagree with Excel, per
// operator. Every arithmetic operator disagrees only on the empty-string rows
// and columns; every comparison operator is wrong for most of the matrix
// because it coerces both sides with `toNum`, which flattens text, errors and
// blanks all onto 0.
const DIVERGENCE_BUDGET: Record<string, number> = {
	"+": 13,
	"-": 13,
	"*": 13,
	"/": 13,
	"^": 14, // the extra one is the error-precedence inconsistency described above
	"&": 54,
	"=": 31,
	"<>": 21,
	">": 38,
	"<": 38,
	">=": 38,
	"<=": 38,
}

describe("coercion matrix: disagreements with Excel", () => {
	for (const op of ALL_OPS) {
		it(`\`${op}\` disagrees with Excel on exactly ${DIVERGENCE_BUDGET[op]} of 81 operand pairs`, () => {
			const found = divergences(op)
			expect(
				found.length,
				`\`${op}\` divergences changed. Now: ${found.join(", ")}`,
			).toBe(DIVERGENCE_BUDGET[op])
		})
	}

	it("every arithmetic operator rejects non-numeric text", () => {
		for (const op of ARITHMETIC) {
			expect(evaluate(`="abc"${op}1`), `"abc"${op}1`).toBe("#VALUE!")
			expect(evaluate(`=1${op}"abc"`), `1${op}"abc"`).toBe("#VALUE!")
		}
	})

	it("every arithmetic operator coerces numeric text and booleans", () => {
		expect(evaluate('="3"+1')).toBe(4)
		expect(evaluate('="3"*2')).toBe(6)
		expect(evaluate("=TRUE+TRUE")).toBe(2)
		expect(evaluate("=TRUE*3")).toBe(3)
	})

	it("[known-failure] booleans concatenate in lower case", () => {
		// Excel and Sheets produce "TRUE"/"FALSE".
		expect(evaluate('=TRUE&""')).toBe("true")
		expect(evaluate('=FALSE&""')).toBe("false")
	})

	it("[known-failure] an unset cell behaves as the number 0, not as a blank", () => {
		// Excel: "x", TRUE, 0.
		expect(evaluate('=Z99&"x"')).toBe("0x")
		expect(evaluate("=ISBLANK(Z99)")).toBe(false)
		expect(evaluate("=LEN(Z99)")).toBe(1)
	})

	it("[known-failure] `=` and `<>` can both be true for the same pair", () => {
		// Exactly one of these must hold in any spreadsheet.
		expect(evaluate('="a"=0')).toBe(true)
		expect(evaluate('="a"<>0')).toBe(true)
	})

	it("[known-failure] text never compares as ordered", () => {
		// Excel: TRUE, TRUE, TRUE.
		expect(evaluate('="a"<"b"')).toBe(false)
		expect(evaluate('="abc"<"abd"')).toBe(false)
		expect(evaluate('="B">"a"')).toBe(false)
	})
})

// ── Operand kinds that do not fit the matrix ──────────────────────────────────

describe("ranges and sparklines as operands", () => {
	it("a multi-cell range is rejected by arithmetic", () => {
		for (const op of ARITHMETIC) expect(evaluate(`=A1:A2${op}1`), op).toBe("#VALUE!")
	})

	it("[known-failure] a multi-cell range concatenates as a comma-joined list", () => {
		// Excel gives #VALUE! here; dynamic-array Excel and Sheets spill instead.
		// Neither produces "1,2".
		expect(evaluate('=A1:A2&""')).toBe("1,2")
	})

	it("[known-failure] a multi-cell range compares as 0", () => {
		// The range flattens to NaN and `toNum` turns NaN into 0, so a range
		// silently equals every blank and every text value.
		expect(evaluate("=A1:A2=0")).toBe(true)
		expect(evaluate("=A1:A2>1")).toBe(false)
	})

	it("a sparkline spec coerces to the empty string, not to [object Object]", () => {
		expect(evaluate('=SPARKLINE(A1:A2)&"x"')).toBe("x")
	})

	it("a sparkline spec is rejected by arithmetic", () => {
		expect(evaluate("=SPARKLINE(A1:A2)+1")).toBe("#VALUE!")
	})
})

describe("negative zero", () => {
	it("is produced by unary minus on zero and compares equal to zero", () => {
		expect(Object.is(evaluate("=-0"), -0)).toBe(true)
		expect(evaluate("=-0=0")).toBe(true)
	})

	it("is a division-by-zero divisor like positive zero", () => {
		expect(evaluate("=1/-0")).toBe("#DIV/0!")
		expect(evaluate("=1/0")).toBe("#DIV/0!")
	})

	it("displays as 0", () => {
		expect(display("=-0")).toBe("0")
	})
})

// ── Error propagation ─────────────────────────────────────────────────────────

describe("error propagation through operators", () => {
	const ERR = "(1/0)"

	it("arithmetic operators propagate an error in either position", () => {
		for (const op of ARITHMETIC) {
			expect(evaluate(`=${ERR}${op}2`), `left ${op}`).toBe("#DIV/0!")
			expect(evaluate(`=2${op}${ERR}`), `right ${op}`).toBe("#DIV/0!")
		}
	})

	it("unary minus, unary plus and percent propagate an error", () => {
		expect(evaluate(`=-${ERR}`)).toBe("#DIV/0!")
		expect(evaluate(`=+${ERR}`)).toBe("#DIV/0!")
		expect(evaluate(`=${ERR}%`)).toBe("#DIV/0!")
	})

	it("an error literal propagates", () => {
		expect(evaluate("=#REF!+1")).toBe("#REF!")
		expect(evaluate("=1+#VALUE!")).toBe("#VALUE!")
	})

	it("the leftmost error wins", () => {
		expect(evaluate("=#REF!+#VALUE!")).toBe("#REF!")
	})

	it("[known-failure] `&` embeds the error text instead of propagating", () => {
		expect(evaluate(`=${ERR}&"x"`)).toBe("#DIV/0!x")
		expect(evaluate(`="x"&${ERR}`)).toBe("x#DIV/0!")
	})

	it("[known-failure] every comparison operator swallows an error", () => {
		// `toNum` maps the error string to 0, so the comparison answers about 0.
		for (const op of COMPARISON) {
			expect(typeof evaluate(`=${ERR}${op}1`), `left ${op}`).toBe("boolean")
			expect(typeof evaluate(`=1${op}${ERR}`), `right ${op}`).toBe("boolean")
		}
	})

	it("[known-failure] a swallowed error is invisible to ISERROR and IFERROR", () => {
		expect(evaluate(`=ISERROR(${ERR}>1)`)).toBe(false)
		expect(evaluate(`=IFERROR(${ERR}>1,"caught")`)).toBe(false)
	})

	it("[known-failure] the `#N/A` literal is cut at the slash", () => {
		// The tokenizer's error branch stops at `/`, so `#N/A` becomes `#N`
		// divided by the column reference `A`.
		expect(evaluate("=#N/A+1")).toBe("#N")
		expect(evaluate("=NA()")).toBe("#N/A") // the function form is intact
	})
})

// ── Numeric boundaries ────────────────────────────────────────────────────────

describe("numeric boundaries", () => {
	it("division by zero errors however the zero arises", () => {
		for (const f of ["=1/0", "=0/0", "=1/-0", "=-1/0", "=1/(1-1)", "=1/(2-2)", "=MOD(1,0)"]) {
			expect(evaluate(f), f).toBe("#DIV/0!")
		}
	})

	it("underflow flushes to zero rather than erroring", () => {
		expect(evaluate("=1e-320/1e10")).toBe(0)
		expect(evaluate("=EXP(-1000)")).toBe(0)
	})

	it("invalid roots and logarithms give #NUM!", () => {
		expect(evaluate("=SQRT(-1)")).toBe("#NUM!")
		expect(evaluate("=LN(0)")).toBe("#NUM!")
		expect(evaluate("=LN(-1)")).toBe("#NUM!")
		expect(evaluate("=LOG(0)")).toBe("#NUM!")
		expect(evaluate("=ASIN(2)")).toBe("#NUM!")
	})

	it("keeps full double precision instead of rounding to 15 digits", () => {
		expect(evaluate("=0.1+0.2")).toBe(0.30000000000000004)
		expect(evaluate("=0.1+0.2-0.3")).toBe(5.551115123125783e-17)
		expect(evaluate("=1-0.9-0.1")).toBe(-2.7755575615628914e-17)
	})

	it("a large aggregate accumulates the expected rounding error", () => {
		const sheet = createSheet({})
		const n = 20000
		for (let i = 1; i <= n; i++) sheet.setCell(`A${i}`, 0.1, "Sheet1")
		sheet.setCell(PROBE, `=SUM(A1:A${n})`, "Sheet1")
		const total = sheet.getCellValue(PROBE, "Sheet1") as number
		expect(typeof total).toBe("number")
		expect(total).toBeCloseTo(2000, 6)
		// Naive left-to-right accumulation, so the sum is not exactly 2000.
		// Excel and Sheets display 2000 because they round the final result.
		expect(total).not.toBe(2000)
	})

	// Task: no formula result may ever be NaN or Infinity in a spreadsheet.
	// Every case below is a defect. They are grouped so the day a numeric guard
	// lands, this one test names everything that guard has to cover.
	const LEAKS_INFINITY = [
		"=1e308*10",
		"=1e308+1e308",
		"=2^1024",
		"=0^-1",
		"=POWER(0,-1)",
		"=EXP(1000)",
		"=FACT(200)",
		"=LOG(100,1)",
	]
	const LEAKS_NAN = ["=(-8)^(1/3)", "=(-1)^0.5", "=POWER(-8,1/3)"]

	it("[known-failure] overflow produces Infinity instead of #NUM!", () => {
		for (const f of LEAKS_INFINITY) {
			const v = evaluate(f)
			expect(typeof v, f).toBe("number")
			expect(Number.isFinite(v as number), f).toBe(false)
			expect(Number.isNaN(v as number), f).toBe(false)
		}
	})

	it("[known-failure] an undefined real result produces NaN instead of #NUM!", () => {
		for (const f of LEAKS_NAN) {
			expect(Number.isNaN(evaluate(f) as number), f).toBe(true)
		}
	})

	it("[known-failure] NaN and Infinity reach the grid as display text", () => {
		expect(display("=1e308*10")).toBe("Infinity")
		expect(display("=-1e308*10")).toBe("-Infinity")
		expect(display("=(-8)^(1/3)")).toBe("NaN")
	})

	it("[known-failure] Infinity survives concatenation and aggregation", () => {
		expect(evaluate('=1e308*10&""')).toBe("Infinity")
		expect(evaluate("=SUM(1,1e308*10)")).toBe(Infinity)
		expect(evaluate("=IF(1e308*10>0,1,0)")).toBe(1)
	})
})

// ── Rounding sign conventions ─────────────────────────────────────────────────

describe("rounding helpers: sign behaviour", () => {
	it("INT rounds towards minus infinity and TRUNC towards zero", () => {
		expect(evaluate("=INT(-2.5)")).toBe(-3)
		expect(evaluate("=INT(2.5)")).toBe(2)
		expect(evaluate("=TRUNC(-2.7)")).toBe(-2)
		expect(evaluate("=TRUNC(2.7)")).toBe(2)
	})

	it("rounds positive halves away from zero", () => {
		expect(evaluate("=ROUND(0.5,0)")).toBe(1)
		expect(evaluate("=ROUND(1.5,0)")).toBe(2)
		expect(evaluate("=ROUND(2.5,0)")).toBe(3)
	})

	it("[known-failure] negative halves round towards zero, not away from it", () => {
		// Excel: -1, -2, -3.
		expect(evaluate("=ROUND(-0.5,0)")).toBe(-0)
		expect(evaluate("=ROUND(-1.5,0)")).toBe(-1)
		expect(evaluate("=ROUND(-2.5,0)")).toBe(-2)
	})

	it("[known-failure] ROUNDUP and ROUNDDOWN use the wrong direction for negatives", () => {
		// Excel: ROUNDUP is away from zero (-2), ROUNDDOWN is towards zero (-1).
		expect(evaluate("=ROUNDUP(-1.1,0)")).toBe(-1)
		expect(evaluate("=ROUNDDOWN(-1.9,0)")).toBe(-2)
	})

	it("ROUNDUP and ROUNDDOWN are correct for positives", () => {
		expect(evaluate("=ROUNDUP(1.1,0)")).toBe(2)
		expect(evaluate("=ROUNDDOWN(1.9,0)")).toBe(1)
	})

	it("rounds at negative digit counts", () => {
		expect(evaluate("=ROUND(123.456,-1)")).toBe(120)
		expect(evaluate("=ROUND(-123.456,-1)")).toBe(-120)
	})

	it("[known-failure] binary rounding loses a cent at a decimal boundary", () => {
		// Excel and Sheets round the decimal value and give 1.01.
		expect(evaluate("=ROUND(1.005,2)")).toBe(1)
		// The better-known 2.675 trap happens to come out right.
		expect(evaluate("=ROUND(2.675,2)")).toBe(2.68)
	})

	it("[known-failure] MOD takes the sign of the dividend, not the divisor", () => {
		// Excel: 1, -1, 2.
		expect(evaluate("=MOD(-3,2)")).toBe(-1)
		expect(evaluate("=MOD(3,-2)")).toBe(1)
		expect(evaluate("=MOD(-1,3)")).toBe(-1)
		// Agrees with Excel when both operands are negative.
		expect(evaluate("=MOD(-3,-2)")).toBe(-1)
	})

	it("FLOOR and CEILING move the right way when the signs agree", () => {
		expect(evaluate("=FLOOR(-2.5,1)")).toBe(-3)
		expect(evaluate("=FLOOR(2.5,1)")).toBe(2)
		expect(evaluate("=CEILING(-2.5,1)")).toBe(-2)
		expect(evaluate("=CEILING(2.5,1)")).toBe(3)
		expect(evaluate("=CEILING(-2.5,-1)")).toBe(-3)
	})

	it("[known-failure] a significance of the opposite sign is accepted", () => {
		// Excel returns #NUM! when the number is positive and the significance
		// negative, because the result cannot be a multiple on the right side of
		// zero. Here FLOOR rounds up and CEILING rounds down.
		expect(evaluate("=FLOOR(2.5,-1)")).toBe(3)
		expect(evaluate("=CEILING(2.5,-1)")).toBe(2)
	})

	it("[known-failure] EVEN and ODD drop the sign", () => {
		// Excel: -2 and -3.
		expect(evaluate("=EVEN(-1.5)")).toBe(2)
		expect(evaluate("=ODD(-1.5)")).toBe(3)
	})

	it("EVEN and ODD are correct for non-negatives", () => {
		expect(evaluate("=EVEN(0)")).toBe(0)
		expect(evaluate("=ODD(0)")).toBe(1)
		expect(evaluate("=EVEN(1.5)")).toBe(2)
		expect(evaluate("=ODD(1.5)")).toBe(3)
	})

	it("[known-failure] TRUNC ignores its digit count", () => {
		// Excel: 2.78.
		expect(evaluate("=TRUNC(2.789,2)")).toBe(2)
	})
})

// ── Date arithmetic ───────────────────────────────────────────────────────────

describe("date arithmetic", () => {
	it("[known-failure] a date cannot take part in arithmetic", () => {
		// Dates are ISO strings rather than serial numbers, and `toNumStrict`
		// cannot convert them, so the two commonest date operations both fail.
		expect(evaluate("=DATE(2026,1,31)+1")).toBe("#VALUE!")
		expect(evaluate("=DATE(2026,3,1)-DATE(2026,2,1)")).toBe("#VALUE!")
	})

	it("the date functions themselves handle the same cases", () => {
		expect(evaluate("=DAYS(DATE(2026,3,1),DATE(2026,2,1))")).toBe(28)
		expect(evaluate("=EDATE(DATE(2024,1,31),1)")).toBe("2024-02-29")
		expect(evaluate("=EOMONTH(DATE(2024,1,31),1)")).toBe("2024-02-29")
	})

	it("DATE rolls over out-of-range months and days", () => {
		expect(evaluate("=DATE(2026,13,1)")).toBe("2027-01-01")
		expect(evaluate("=DATE(2026,1,0)")).toBe("2025-12-31")
		expect(evaluate("=DATE(2026,2,30)")).toBe("2026-03-02")
	})

	it("[known-failure] DATEDIF counts calendar months, not complete months", () => {
		// Excel: 1, because 20 Jan to 10 Mar is one complete month plus 19 days.
		//
		// Both dates sit well away from a month boundary. DATE() returns an ISO
		// string that is parsed as UTC and read back with local getters, so a
		// date on the 1st or the 31st shifts by a day west of Greenwich and the
		// month arithmetic below changes with the machine's time zone.
		expect(evaluate('=DATEDIF(DATE(2024,1,20),DATE(2024,3,10),"M")')).toBe(2)
	})

	it("[known-failure] a year below 1900 is not offset by 1900", () => {
		// Excel: DATE(1899,1,1) is 1 January 3799.
		expect(evaluate("=DATE(1899,1,1)")).toBe("1899-01-01")
	})

	it("DATEVALUE produces an Excel serial that does support arithmetic", () => {
		expect(evaluate('=DATEVALUE("2026-01-01")')).toBe(46023)
		expect(evaluate('=DATEVALUE("2026-01-01")+1')).toBe(46024)
	})
})
