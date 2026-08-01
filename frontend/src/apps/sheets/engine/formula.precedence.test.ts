// Operator precedence, associativity and the unary/postfix operators.
//
// The grouping tests never compare against a hand-written number. They compare
// the flat expression against the SAME expression with explicit parentheses, so
// the assertion is about grouping alone and cannot be invalidated by a change to
// arithmetic or coercion. Cases where the engine disagrees with Excel are
// recorded as explicit exceptions here and as fixtures in
// `test-corpus/arithmetic.json`; fixing the engine turns those exceptions red.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"

const PROBE = "XFD1048576"

function evaluate(formula: string): unknown {
	const sheet = createSheet({})
	sheet.setCell(PROBE, formula, "Sheet1")
	return sheet.getCellValue(PROBE, "Sheet1")
}

// Excel's documented precedence, loosest to tightest. Operators on the same
// level associate left to right — Excel makes no exception for `^`, which is
// why `=2^3^2` is 64 there and not the 512 that maths convention gives.
const PRECEDENCE: Record<string, number> = {
	"=": 1,
	"<>": 1,
	">": 1,
	"<": 1,
	">=": 1,
	"<=": 1,
	"&": 2,
	"+": 3,
	"-": 3,
	"*": 4,
	"/": 4,
	"^": 5,
}
const BINARY_OPS = Object.keys(PRECEDENCE)

/** Excel groups `a o1 b o2 c` to the right only when o2 binds strictly tighter. */
function excelGrouping(o1: string, o2: string): "left" | "right" {
	return PRECEDENCE[o2] > PRECEDENCE[o1] ? "right" : "left"
}

// Two operand triples, because for some operator pairs both groupings happen to
// produce the same value and a single triple would prove nothing.
const TRIPLES: [number, number, number][] = [
	[2, 3, 4],
	[5, 2, 3],
]

// Ordered operator pairs where the engine does not group the way Excel does.
// Each entry is mirrored by a fixture in test-corpus/arithmetic.json.
const KNOWN_BAD_GROUPING = new Set(["^ ^"])

describe("operator precedence: every ordered pair of binary operators", () => {
	for (const o1 of BINARY_OPS) {
		for (const o2 of BINARY_OPS) {
			const grouping = excelGrouping(o1, o2)
			const known = KNOWN_BAD_GROUPING.has(`${o1} ${o2}`)
			const label = `a ${o1} b ${o2} c groups ${grouping}${known ? " [known-failure]" : ""}`

			it(label, () => {
				for (const [a, b, c] of TRIPLES) {
					const flat = evaluate(`=${a}${o1}${b}${o2}${c}`)
					const left = evaluate(`=(${a}${o1}${b})${o2}${c}`)
					const right = evaluate(`=${a}${o1}(${b}${o2}${c})`)
					const excel = grouping === "left" ? left : right
					if (known) {
						expect(
							flat,
							`${a}${o1}${b}${o2}${c} now groups like Excel — drop it from KNOWN_BAD_GROUPING`,
						).not.toEqual(excel)
					} else {
						expect(flat, `${a}${o1}${b}${o2}${c}`).toEqual(excel)
					}
				}
			})
		}
	}

	// A grouping test only has teeth when the two groupings differ. This guards
	// the guard: if a future coercion change made more pairs indistinguishable,
	// the matrix above would quietly stop testing anything.
	it("most operator pairs are actually discriminating", () => {
		let discriminating = 0
		let total = 0
		for (const o1 of BINARY_OPS) {
			for (const o2 of BINARY_OPS) {
				total++
				const distinct = TRIPLES.some(([a, b, c]) => {
					const left = evaluate(`=(${a}${o1}${b})${o2}${c}`)
					const right = evaluate(`=${a}${o1}(${b}${o2}${c})`)
					return !Object.is(left, right)
				})
				if (distinct) discriminating++
			}
		}
		expect(total).toBe(144)
		// 122 of 144 today. The 22 that are not discriminating are all
		// comparison-comparison pairs, where both groupings collapse to the same
		// boolean whichever way they associate.
		expect(discriminating).toBeGreaterThanOrEqual(120)
	})
})

describe("associativity", () => {
	it("subtraction is left associative", () => {
		expect(evaluate("=10-3-2")).toBe(5)
	})

	it("division is left associative", () => {
		expect(evaluate("=100/10/2")).toBe(5)
	})

	it("concatenation is left associative", () => {
		expect(evaluate("=1&2&3")).toBe("123")
	})

	it("comparisons chain left to right", () => {
		// (2=2)=TRUE is TRUE; 2=(2=TRUE) would be FALSE.
		expect(evaluate("=2=2=TRUE")).toBe(true)
	})

	it("explicit parentheses fix both power groupings", () => {
		expect(evaluate("=(2^3)^2")).toBe(64)
		expect(evaluate("=2^(3^2)")).toBe(512)
	})

	it("[known-failure] `^` drops every operator after the first", () => {
		// Excel: (2^3)^2 = 64. The engine reads one `^`, returns, and nothing
		// checks that the token stream was consumed.
		expect(evaluate("=2^3^2")).toBe(8)
		expect(evaluate("=2^3^2^2")).toBe(8)
		expect(evaluate("=2^-3^2")).toBe(0.125) // Excel: (2^-3)^2 = 0.015625
	})
})

describe("unary minus and plus", () => {
	it("binds tighter than `^`", () => {
		expect(evaluate("=-2^2")).toBe(4)
		expect(evaluate("=(-2)^2")).toBe(4)
		expect(evaluate("=-(2^2)")).toBe(-4)
	})

	it("is accepted as an exponent", () => {
		expect(evaluate("=2^-2")).toBe(0.25)
	})

	it("binds tighter than `*`, `+` and `&`", () => {
		expect(evaluate("=-2*3")).toBe(-6)
		expect(evaluate("=-2+3")).toBe(1)
		expect(evaluate("=-2&3")).toBe("-23")
	})

	it("negates a parenthesised expression", () => {
		expect(evaluate("=-(-1)")).toBe(1)
		expect(evaluate("=-(1+2)")).toBe(-3)
	})

	it("negates a function result", () => {
		expect(evaluate("=-SUM(1,2)")).toBe(-3)
	})

	it("coerces its operand like the binary operators", () => {
		expect(evaluate('=-"2"')).toBe(-2)
		expect(evaluate("=-TRUE")).toBe(-1)
		expect(evaluate('=-"abc"')).toBe("#VALUE!")
		expect(evaluate("=-(1/0)")).toBe("#DIV/0!")
	})

	it("[known-failure] prefix operators cannot stack", () => {
		// `unary()` recurses into `primary()`, whose catch-all consumes the
		// second sign token and yields 0, after which the real operand is left
		// unread. Excel gives 1, -2 and -2.
		expect(evaluate("=--1")).toBe(-0)
		expect(evaluate("=+-2")).toBe(0)
		expect(evaluate("=-+2")).toBe(-0)
	})

	it("triple negation is right by accident", () => {
		// Parsed as (-0) - 1, which lands on the correct -1.
		expect(evaluate("=---1")).toBe(-1)
	})
})

describe("postfix percent", () => {
	it("divides by 100", () => {
		expect(evaluate("=50%")).toBe(0.5)
		expect(evaluate("=100%")).toBe(1)
	})

	it("binds tighter than every binary operator", () => {
		expect(evaluate("=50%^2")).toBe(0.25)
		expect(evaluate("=50%*2")).toBe(1)
		expect(evaluate("=2*50%")).toBe(1)
		expect(evaluate("=1+50%")).toBe(1.5)
		expect(evaluate("=1&50%")).toBe("10.5")
		expect(evaluate("=50%=0.5")).toBe(true)
	})

	it("applies to a parenthesised expression and to a function result", () => {
		expect(evaluate("=(1+1)%")).toBe(0.02)
		expect(evaluate("=SUM(1,2)%")).toBe(0.03)
		expect(evaluate("=(-5)%")).toBe(-0.05)
		expect(evaluate("=-(5%)")).toBe(-0.05)
	})

	it("propagates an error operand", () => {
		expect(evaluate("=(1/0)%")).toBe("#DIV/0!")
	})

	it("[known-failure] percent cannot follow a prefix sign, and the rest is lost", () => {
		// `unary()` returns straight after the leading sign without ever looking
		// for `%`. The unread `%` then stops `mul()`, so in the second case the
		// multiplication disappears too. Excel: -0.05 and -0.06.
		expect(evaluate("=-5%")).toBe(-5)
		expect(evaluate("=-2%*3")).toBe(-2)
	})

	it("[known-failure] percent does not repeat", () => {
		// Excel: 5%% is 0.0005.
		expect(evaluate("=5%%")).toBe(0.05)
	})
})
