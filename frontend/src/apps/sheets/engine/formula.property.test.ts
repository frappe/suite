// Property-based tests for the formula engine.
//
// Formulas are generated as an expression TREE and then printed, so the
// generator only ever emits grammatically valid input. That separation is what
// makes the invariants below meaningful: a failure is the engine's fault, not a
// malformed string.
//
// Determinism: the seed is fixed so a CI failure is reproducible from the log
// alone. Override for a wider nightly sweep:
//
//   FORMULA_FC_SEED=12345 FORMULA_FC_RUNS=5000 FORMULA_FC_DEPTH=6 \
//     yarn vitest run src/apps/sheets/engine/formula.property.test.ts
//
// A property the engine does NOT yet satisfy is written with `it.fails`, so the
// suite documents the gap, stays green, and turns red the moment the engine is
// fixed. Each one names the corpus fixture that holds the minimal repro.

import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { evaluate, tokenize } from "./formula.js"

// Read through globalThis so the file needs no @types/node; the frontend
// tsconfig deliberately limits `types` to vite and unplugin-icons.
const ENV: Record<string, string | undefined> = (globalThis as any).process?.env ?? {}

const SEED = Number(ENV.FORMULA_FC_SEED ?? 424242)
const RUNS = Number(ENV.FORMULA_FC_RUNS ?? 300)
const DEPTH = Number(ENV.FORMULA_FC_DEPTH ?? 3)

const RUN_OPTS: fc.Parameters<unknown> = { seed: SEED, numRuns: RUNS, verbose: true }

// ── Backing grid ──────────────────────────────────────────────────────────────
// Fixed and small, so a generated reference always resolves to the same value
// and any difference between two runs comes from the engine.

const GRID: Record<string, number | string | boolean> = {
	A1: 1, A2: 2, A3: 3, A4: -4, A5: 0,
	B1: 1.5, B2: "text", B3: "", B4: true, B5: 100,
	C1: 0.25, C2: -0.5, C3: 1e6, C4: "42", C5: false,
	D1: 7, D2: 8, D3: 9, D4: 10, D5: 11,
	E1: 0, E2: 0, E3: 1, E4: 2, E5: 3,
}

const COLS = ["A", "B", "C", "D", "E"]
const ROWS = [1, 2, 3, 4, 5]

function colIndex(label: string) {
	return COLS.indexOf(label)
}

const getCellValue = (id: string) => GRID[id.toUpperCase()] ?? 0
const getRangeValues = (start: string, end: string) => {
	const s = /^([A-E])([1-5])$/.exec(start.toUpperCase())
	const e = /^([A-E])([1-5])$/.exec(end.toUpperCase())
	if (!s || !e) return []
	const rows: unknown[][] = []
	for (let r = Math.min(+s[2], +e[2]); r <= Math.max(+s[2], +e[2]); r++) {
		const row: unknown[] = []
		for (let c = Math.min(colIndex(s[1]), colIndex(e[1])); c <= Math.max(colIndex(s[1]), colIndex(e[1])); c++) {
			row.push(GRID[COLS[c] + r] ?? 0)
		}
		rows.push(row)
	}
	return rows
}

function evalFormula(src: string): unknown {
	return evaluate(src, getCellValue, getRangeValues)
}

// ── Expression tree ───────────────────────────────────────────────────────────

type Node =
	| { k: "num"; v: number }
	| { k: "str"; v: string }
	| { k: "bool"; v: boolean }
	| { k: "ref"; v: string }
	| { k: "range"; a: string; b: string }
	| { k: "unary"; op: string; x: Node }
	| { k: "postfix"; op: string; x: Node }
	| { k: "binary"; op: string; l: Node; r: Node }
	| { k: "paren"; x: Node }
	| { k: "call"; fn: string; args: Node[] }

// Deliberately excludes volatile functions (RAND, RANDBETWEEN, TODAY, NOW):
// they break every invariant here by design, and the cache tests own them.
const SCALAR_FNS = ["ABS", "INT", "SIGN", "SQRT", "LEN", "UPPER", "LOWER", "TRIM", "N", "NOT"]
const BINARY_FNS = ["POWER", "MOD", "ROUND", "LOG", "LEFT", "RIGHT", "EXACT"]
const RANGE_FNS = ["SUM", "AVERAGE", "MAX", "MIN", "COUNT", "COUNTA", "PRODUCT", "MEDIAN"]
const BINOPS = ["+", "-", "*", "/", "^", "&", "=", "<>", ">", "<", ">=", "<="]

const cellRef = fc
	.tuple(fc.constantFrom(...COLS), fc.constantFrom(...ROWS))
	.map(([c, r]) => `${c}${r}`)

const expression = fc.letrec<{ node: Node }>((tie) => ({
	node: fc.oneof(
		{ maxDepth: DEPTH, depthSize: "small" },
		// Leaves
		fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }).map((v): Node => ({ k: "num", v })),
		// Printable ASCII only, and no `"` or `\`, so the literal round-trips
		// through the tokenizer's escape handling without extra encoding.
		fc.stringMatching(/^[ !#-[\]-~]{0,12}$/).map((v): Node => ({ k: "str", v })),
		fc.boolean().map((v): Node => ({ k: "bool", v })),
		cellRef.map((v): Node => ({ k: "ref", v })),
		fc.tuple(cellRef, cellRef).map(([a, b]): Node => ({ k: "range", a, b })),
		// Branches
		fc.tuple(fc.constantFrom("-", "+"), tie("node")).map(([op, x]): Node => ({ k: "unary", op, x })),
		tie("node").map((x): Node => ({ k: "postfix", op: "%", x })),
		fc
			.tuple(fc.constantFrom(...BINOPS), tie("node"), tie("node"))
			.map(([op, l, r]): Node => ({ k: "binary", op, l, r })),
		tie("node").map((x): Node => ({ k: "paren", x })),
		fc.tuple(fc.constantFrom(...SCALAR_FNS), tie("node")).map(([fn, x]): Node => ({ k: "call", fn, args: [x] })),
		fc
			.tuple(fc.constantFrom(...BINARY_FNS), tie("node"), tie("node"))
			.map(([fn, a, b]): Node => ({ k: "call", fn, args: [a, b] })),
		fc
			.tuple(fc.constantFrom(...RANGE_FNS), fc.array(tie("node"), { minLength: 1, maxLength: 4 }))
			.map(([fn, args]): Node => ({ k: "call", fn, args })),
	),
})).node

interface PrintOpts {
	/** Inserted at every token boundary where whitespace is legal. */
	pad?: string
	/** Lower-cases identifiers and references, but never string literals. */
	lower?: boolean
}

function print(n: Node, o: PrintOpts = {}): string {
	const p = o.pad ?? ""
	const id = (s: string) => (o.lower ? s.toLowerCase() : s)
	switch (n.k) {
		case "num":
			// A negative literal would print as a unary minus and change the tree,
			// so wrap it. `1e21`-style output is not valid formula syntax either,
			// which is why the generator caps the magnitude.
			return n.v < 0 ? `(${n.v})` : String(n.v)
		case "str":
			return `"${n.v}"`
		case "bool":
			return id(n.v ? "TRUE" : "FALSE")
		case "ref":
			return id(n.v)
		case "range":
			return `${id(n.a)}${p}:${p}${id(n.b)}`
		case "unary":
			return `${n.op}${p}${print(n.x, o)}`
		case "postfix":
			return `${print(n.x, o)}${p}${n.op}`
		case "binary":
			return `${print(n.l, o)}${p}${n.op}${p}${print(n.r, o)}`
		case "paren":
			return `(${p}${print(n.x, o)}${p})`
		case "call":
			return `${id(n.fn)}(${p}${n.args.map((a) => print(a, o)).join(`${p},${p}`)}${p})`
	}
}

// Errors are strings, so a plain `===` is enough; -0 and 0 are the same cell
// value in a spreadsheet, and NaN is compared by identity rather than value.
function sameResult(a: unknown, b: unknown): boolean {
	if (typeof a === "number" && typeof b === "number") {
		return (Number.isNaN(a) && Number.isNaN(b)) || a === b
	}
	if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
	return a === b
}

// ── Properties ────────────────────────────────────────────────────────────────

describe(`formula properties (seed ${SEED}, ${RUNS} runs, depth ${DEPTH})`, () => {
	it("tokenize terminates on any input", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 400 }), (src) => {
				const start = performance.now()
				tokenize(src)
				return performance.now() - start < 1000
			}),
			RUN_OPTS,
		)
	})

	it("tokenize terminates on adversarial input", () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('"', "'", "!", ":", "(", ")", "#", "$", "\\", "e", "1", ".", ",", "^", "%"), {
					maxLength: 300,
				}),
				(chars) => {
					const start = performance.now()
					tokenize(chars.join(""))
					return performance.now() - start < 1000
				},
			),
			RUN_OPTS,
		)
	})

	it("evaluate never throws, for valid or arbitrary input", () => {
		fc.assert(
			fc.property(fc.oneof(expression.map((n) => print(n)), fc.string({ maxLength: 200 })), (src) => {
				evalFormula(src)
				return true
			}),
			RUN_OPTS,
		)
	})

	it("evaluate never returns undefined or a bare object", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const r = evalFormula(print(node))
				if (r === undefined) return false
				if (r === null) return false
				if (typeof r !== "object") return true
				// The only legal object result is a range matrix or a sparkline spec.
				return Array.isArray(r) || "__spark" in (r as object)
			}),
			RUN_OPTS,
		)
	})

	it("evaluate completes within a time limit", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const src = print(node)
				const start = performance.now()
				evalFormula(src)
				return performance.now() - start < 250
			}),
			RUN_OPTS,
		)
	})

	it("evaluation is deterministic", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const src = print(node)
				return sameResult(evalFormula(src), evalFormula(src))
			}),
			RUN_OPTS,
		)
	})

	// KNOWN FAILURE — found by this suite at seed 424242, path 26:0:0:0, shrunk
	// to `=2%%`. `unary()` applies `%` once, so the second `%` is left unread.
	// At the top level nothing checks for leftover tokens, so the engine answers
	// 0.02. Inside parentheses `expect(RP)` trips over the same leftover token
	// and the engine answers #ERROR!. One expression, two answers, decided by a
	// wrapper that should mean nothing. Same root cause as the two properties
	// below. Minimal repro: corpus fixture `unary-double-percent-001`.
	it.fails("wrapping the whole formula in parentheses preserves the result", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const src = print(node)
				return sameResult(evalFormula(src), evalFormula(`(${src})`))
			}),
			RUN_OPTS,
		)
	})

	it("whitespace at legal boundaries preserves the result", () => {
		fc.assert(
			fc.property(expression, (node) => {
				return sameResult(evalFormula(print(node)), evalFormula(print(node, { pad: "  " })))
			}),
			RUN_OPTS,
		)
	})

	it("identifier case preserves the result", () => {
		fc.assert(
			fc.property(expression, (node) => {
				return sameResult(evalFormula(print(node)), evalFormula(print(node, { lower: true })))
			}),
			RUN_OPTS,
		)
	})

	it("a tokenizer round trip preserves the token stream", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const once = tokenize(print(node))
				const twice = tokenize(print(node, { pad: " " }))
				return JSON.stringify(once) === JSON.stringify(twice)
			}),
			RUN_OPTS,
		)
	})

	// KNOWN FAILURE — neither `evaluate` nor `createParser` checks that the token
	// stream was fully consumed, so trailing junk is discarded and a partial
	// result is returned. Minimal repros: corpus fixtures
	// `invalid-extra-closing-paren-001`, `invalid-adjacent-literals-001`,
	// `invalid-trailing-garbage-after-call-001`.
	it.fails("appending a stray token makes the formula an error", () => {
		fc.assert(
			fc.property(expression, fc.constantFrom(")", "5", '"x"', "@"), (node, junk) => {
				const r = evalFormula(`${print(node)}${junk}`)
				return typeof r === "string" && r.startsWith("#")
			}),
			RUN_OPTS,
		)
	})

	// KNOWN FAILURE — the tokenizer's final branch consumes an unrecognised
	// character and emits no token, so stray punctuation vanishes mid-formula
	// instead of failing. Minimal repro: `invalid-unknown-punctuation-001`.
	it.fails("inserting an illegal character makes the formula an error", () => {
		fc.assert(
			fc.property(expression, (node) => {
				const r = evalFormula(`${print(node)}@1`)
				return typeof r === "string" && r.startsWith("#")
			}),
			RUN_OPTS,
		)
	})
})

// A regression slot for every counterexample a property run has produced. Each
// entry keeps the exact failing input, so a fix is verified against the real
// case rather than against a re-roll of the generator.
describe("minimised property counterexamples", () => {
	it("=2%% and =(2%%) disagree (seed 424242, path 26:0:0:0)", () => {
		expect(evalFormula("2%%")).toBe(0.02)
		expect(evalFormula("(2%%)")).toBe("#ERROR!")
	})
})
