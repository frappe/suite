// Parser behaviour the JSON corpus cannot express: termination, absence of
// throws, stack depth, and the fact that the parser never checks it consumed
// every token.
//
// `test-corpus/syntax.json` covers "formula X evaluates to Y". This file covers
// properties that hold across whole classes of input, plus the adversarial
// cases where the interesting result is "it finished at all".

import { describe, expect, it } from "vitest"

import { evaluate, tokenize } from "./formula.js"

const CELLS: Record<string, number> = { A1: 1, A2: 2, B1: 10 }
const getCell = (id: string) => CELLS[id] ?? 0
const getRange = () => [[0]]

function evalExpr(src: string): unknown {
	return evaluate(src, getCell, getRange)
}

/** Milliseconds a call took, so a hang shows up as a number instead of a timeout. */
function elapsed(fn: () => void): number {
	const start = Date.now()
	fn()
	return Date.now() - start
}

// Deliberately loose. These bounds only have to separate "finished" from
// "hung"; they are not performance budgets. The tokenizer's sheet-name lookahead
// is quadratic in a run of spaces (measured: 10k spaces ≈ 170 ms, 20k ≈ 530 ms,
// 40k ≈ 1.5 s), so the bound has to leave room for that.
const TERMINATION_BUDGET_MS = 5000

describe("tokenize terminates on adversarial input", () => {
	const adversarial: [string, string][] = [
		["deeply nested parens", "(".repeat(20000) + "1" + ")".repeat(20000)],
		["unbalanced open parens", "(".repeat(20000) + "1"],
		["deeply nested calls", "SUM(".repeat(5000) + "1" + ")".repeat(5000)],
		["very long operator chain", Array(20000).fill("1").join("+")],
		["very long string literal", `"${"a".repeat(200000)}"`],
		["unterminated string literal", `"${"a".repeat(200000)}`],
		["run of apostrophes", "'".repeat(50000)],
		["run of doubled apostrophes", "''".repeat(25000)],
		["run of quotes", '"'.repeat(50000)],
		["run of hashes", "#".repeat(50000)],
		["run of backslashes", `"${"\\".repeat(50000)}"`],
		["run of digits", "1".repeat(50000)],
		["run of dots", ".".repeat(50000)],
		// Worst case for the identifier scanner: every space re-scans the whole
		// remaining run looking for a `!`.
		["spaces before a sheet bang", `A${" ".repeat(10000)}!A1`],
		["alternating unknown punctuation", "@~|".repeat(20000)],
	]

	it.each(adversarial)("%s", (_label, src) => {
		let count = -1
		const ms = elapsed(() => {
			count = tokenize(src).length
		})
		expect(count).toBeGreaterThanOrEqual(0)
		expect(ms).toBeLessThan(TERMINATION_BUDGET_MS)
	})
})

describe("evaluate never throws", () => {
	// Every token-relevant character, so the fuzz reaches each tokenizer branch
	// and each parser branch rather than only the arithmetic ones.
	const ALPHABET = [..."0123456789.eE+-*/^&%<>=(),;:!@#$_\"'ABZ ", "\\", "TRUE", "SUM", "A1"]

	function pseudoRandom(seed: number): () => number {
		let s = seed >>> 0
		return () => {
			s = (s * 1664525 + 1013904223) >>> 0
			return s / 0x100000000
		}
	}

	it("survives 3000 pseudo-random token soups", () => {
		const rand = pseudoRandom(20240801)
		for (let n = 0; n < 3000; n++) {
			const len = 1 + Math.floor(rand() * 12)
			let src = ""
			for (let k = 0; k < len; k++) src += ALPHABET[Math.floor(rand() * ALPHABET.length)]
			expect(() => evaluate(src, getCell, getRange), `input: ${JSON.stringify(src)}`).not.toThrow()
		}
	})

	it("survives every single character on its own", () => {
		for (let code = 32; code < 127; code++) {
			const ch = String.fromCharCode(code)
			expect(() => evaluate(ch, getCell, getRange), `input: ${JSON.stringify(ch)}`).not.toThrow()
		}
	})

	it("survives an empty formula", () => {
		expect(evalExpr("")).toBe("")
	})
})

describe("deep nesting does not escape as an exception", () => {
	it("evaluates a nesting depth a real sheet might reach", () => {
		expect(evalExpr("(".repeat(200) + "1" + ")".repeat(200))).toBe(1)
	})

	// The parser is recursive descent with no depth limit, so past some depth it
	// overflows the stack. `evaluate` catches that and reports #ERROR!. The
	// exact threshold depends on the host stack, so assert only that the call
	// returns one of the two acceptable outcomes.
	it("returns a value rather than overflowing at extreme depth", () => {
		let result: unknown
		expect(() => {
			result = evalExpr("(".repeat(50000) + "1" + ")".repeat(50000))
		}).not.toThrow()
		expect([1, "#ERROR!"]).toContain(result)
	})

	it("returns a value rather than overflowing for deeply nested calls", () => {
		let result: unknown
		expect(() => {
			result = evalExpr("SUM(".repeat(20000) + "1" + ")".repeat(20000))
		}).not.toThrow()
		expect([1, "#ERROR!"]).toContain(result)
	})
})

describe("the parser does not require the token stream to be consumed", () => {
	// Neither `evaluate` nor `createParser` checks `pos === tokens.length`, so
	// anything after the first complete expression is discarded without a word.
	// Each case below is a typo a spreadsheet rejects outright.
	const trailingGarbage: [string, unknown, number][] = [
		["1 2", 1, 2],
		["1 \"a\"", 1, 2],
		["\"a\" \"b\"", "a", 2],
		["1+2)", 3, 4],
		["SUM(1,2) 5", 3, 7],
		["TRUE TRUE", true, 2],
		["1;2", 1, 3],
		["A1 A2", 1, 2],
		["1e5e5", 100000, 2],
	]

	it.each(trailingGarbage)("%j keeps only the leading expression", (src, value, tokenCount) => {
		expect(tokenize(src)).toHaveLength(tokenCount as number)
		expect(evalExpr(src as string)).toEqual(value)
	})

	it("a lone unrecognised token is valued at zero instead of rejected", () => {
		// `primary` ends with an unconditional `next(); return 0`.
		for (const src of [")", "*1", "&1", "^2", ":A1", ","]) {
			expect(evalExpr(src), `input: ${JSON.stringify(src)}`).toBe(0)
		}
	})

	it("an input the tokenizer empties evaluates to a blank cell", () => {
		// Characters with no branch are dropped, so `=@@@` is indistinguishable
		// from an empty formula.
		expect(tokenize("@@@")).toEqual([])
		expect(evalExpr("@@@")).toBe("")
	})
})

describe("function-call syntax", () => {
	it("an unclosed argument list is an error, not a partial call", () => {
		expect(evalExpr("SUM(1,2")).toBe("#ERROR!")
	})

	it("a missing argument list makes the name an unresolved name", () => {
		expect(evalExpr("SUM")).toBe("#NAME?")
	})

	it("an unknown function still consumes its whole argument list", () => {
		expect(evalExpr("NOPE(1,2,3)")).toBe("#NAME?")
		expect(evalExpr("NOPE(1,2,3)+1")).toBe("#NAME?")
	})
})
