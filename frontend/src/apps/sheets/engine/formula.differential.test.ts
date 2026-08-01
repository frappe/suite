// Differential suite: the same formulas through this engine and through
// IronCalc (a Rust spreadsheet engine, MIT/Apache-2.0), used as a second
// opinion on Excel-compatible semantics.
//
// IronCalc is an OPTIONAL dev dependency. The whole suite is skipped with
// `describe.skipIf` when it cannot be loaded, so a checkout without
// `@ironcalc/wasm` — or an environment where the wasm cannot start — still runs
// green instead of failing CI on a missing optional package.
//
// IronCalc is a reference, NOT an oracle. Where the two engines disagree the
// difference is classified by hand against documented Excel and Google Sheets
// behaviour; see `test-corpus/compatibility-report.md`. Confirmed local defects
// become fixtures under `test-corpus/compatibility/`; accepted differences go
// into `test-corpus/known-differences.json`. This file only asserts that the
// set of disagreements has not grown beyond what is already classified.

import { writeFileSync } from "node:fs"

import { describe, expect, it, beforeAll } from "vitest"

import { loadDirect, runDirect } from "./test-corpus/harness"
import {
	evaluateInIronCalc,
	initIronCalc,
	ironCalcLoadError,
	isIronCalcAvailable,
	type IronCalcResult,
} from "./test-corpus/ironcalc"

// `initIronCalc` is async (wasm), but `describe.skipIf` is evaluated at collect
// time, so the load has to happen during collection rather than in `beforeAll`.
const ironCalcReady = await initIronCalc()

// ── Normalisation ─────────────────────────────────────────────────────────────
//
// The two engines report the same result in different shapes. Every rule below
// is deliberate and is documented in compatibility-report.md.
//
//  1. Errors    — compared by name. `#CIRCULAR!` (local) is folded to `#CIRC!`
//                 (IronCalc). Local `#ERROR!` is a parse failure and is folded
//                 to the generic bucket `#ERROR!`; IronCalc reports parse
//                 failures the same way.
//  2. Empty     — local `""`/`null`/`undefined` and an empty IronCalc cell both
//                 become `{ kind: "empty" }`. A deliberate empty *string* result
//                 is indistinguishable from an empty cell in IronCalc, so the
//                 two are folded together.
//  3. Booleans  — both engines return real booleans; no coercion applied.
//  4. Numbers   — compared with a RELATIVE tolerance of 1e-9, with an absolute
//                 floor of 1e-12 so values near zero do not fail on noise. 1e-9
//                 is the precision IronCalc's number formatter can be trusted to
//                 round-trip. `-0` is folded to `0`: no spreadsheet distinguishes
//                 them.
//  5. Dates     — this engine returns `YYYY-MM-DD` strings, IronCalc returns
//                 Excel serials. A local ISO date string is converted to a
//                 serial before comparison (epoch 1899-12-30, the 1900 leap-year
//                 bug included, as Excel does).
//  6. Arrays    — a local 2D matrix is stringified and compared as one value.
//                 IronCalc spills an array into neighbouring cells, which the
//                 single probe cell cannot see, so no case here returns one.
//  7. Locale    — both engines are pinned to `en` / `UTC`. No locale-dependent
//                 formatting is compared; only raw values.

const RELATIVE_TOLERANCE = 1e-9
const ABSOLUTE_FLOOR = 1e-12

/** Excel's day 0. Day 60 does not exist in reality; Excel's 1900 leap bug. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

type Normal =
	| { kind: "number"; value: number }
	| { kind: "text"; value: string }
	| { kind: "boolean"; value: boolean }
	| { kind: "error"; value: string }
	| { kind: "empty" }
	| { kind: "array"; value: string }

function normaliseErrorName(name: string): string {
	if (name === "#CIRCULAR!") return "#CIRC!"
	return name
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoToSerial(iso: string): number {
	const [y, m, d] = iso.split("-").map(Number)
	return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / MS_PER_DAY
}

export function normaliseLocal(value: unknown): Normal {
	if (value === null || value === undefined || value === "") return { kind: "empty" }
	if (typeof value === "boolean") return { kind: "boolean", value }
	if (typeof value === "number") return { kind: "number", value: value === 0 ? 0 : value }
	if (Array.isArray(value)) return { kind: "array", value: JSON.stringify(value) }
	if (typeof value === "string") {
		if (value.startsWith("#")) return { kind: "error", value: normaliseErrorName(value) }
		if (ISO_DATE.test(value)) return { kind: "number", value: isoToSerial(value) }
		return { kind: "text", value }
	}
	return { kind: "text", value: String(value) }
}

export function normaliseIronCalc(result: IronCalcResult): Normal {
	switch (result.kind) {
		case "empty":
			return { kind: "empty" }
		case "error":
			return { kind: "error", value: normaliseErrorName(String(result.value)) }
		case "boolean":
			return { kind: "boolean", value: Boolean(result.value) }
		case "number": {
			const n = Number(result.value)
			return { kind: "number", value: n === 0 ? 0 : n }
		}
		default:
			return result.value === "" ? { kind: "empty" } : { kind: "text", value: String(result.value) }
	}
}

export function sameNormal(a: Normal, b: Normal): boolean {
	if (a.kind !== b.kind) return false
	if (a.kind === "empty") return true
	if (a.kind === "number" && b.kind === "number") {
		if (Number.isNaN(a.value) && Number.isNaN(b.value)) return true
		const diff = Math.abs(a.value - b.value)
		if (diff <= ABSOLUTE_FLOOR) return true
		return diff <= RELATIVE_TOLERANCE * Math.max(Math.abs(a.value), Math.abs(b.value))
	}
	return (a as any).value === (b as any).value
}

function describeNormal(n: Normal): string {
	return n.kind === "empty" ? "empty" : `${n.kind}(${JSON.stringify((n as any).value)})`
}

// ── Case list ─────────────────────────────────────────────────────────────────

interface DiffCase {
	id: string
	formula: string
	cells?: Record<string, string | number>
}

// Everything already in the corpus that is a plain single-sheet formula. Multi-
// sheet and named-range fixtures are excluded: IronCalc addresses sheets by
// index and has a different defined-name API, so those are not comparable
// without a translation layer that would itself need testing.
function corpusCases(): DiffCase[] {
	return loadDirect("syntax.json", "arithmetic.json")
		.filter((fx) => !fx.sheets && !fx.namedRanges)
		.map((fx) => ({ id: `corpus:${fx.id}`, formula: fx.formula, cells: fx.cells }))
}

const GRID: Record<string, string | number> = {
	A1: 1,
	A2: 2,
	A3: 3,
	B1: "x",
	B2: "y",
	B3: 10,
	C1: -4,
	C2: 0,
	C3: 2.5,
}

// Generated coverage: operators, coercion, error propagation, common functions.
const GENERATED: DiffCase[] = [
	// operators
	["op-add", "=1+2"],
	["op-sub", "=5-9"],
	["op-mul", "=6*7"],
	["op-div", "=7/2"],
	["op-pow", "=2^10"],
	["op-pow-chain", "=2^3^2"],
	["op-pow-neg-base", "=-2^2"],
	["op-pow-frac", "=8^(1/3)"],
	["op-concat", '="a"&"b"'],
	["op-concat-number", '=1&2'],
	["op-percent", "=50%"],
	["op-percent-double", "=5%%"],
	["op-unary-minus-percent", "=-5%"],
	["op-unary-double-minus", "=--1"],
	["op-unary-triple-minus", "=---1"],
	["op-unary-plus", "=+3"],
	["op-mixed-precedence", "=1+2*3-4/2"],
	["op-paren-precedence", "=(1+2)*3"],
	["op-neg-zero", "=-0"],
	["op-div-neg-zero", "=1/-0"],

	// comparison and coercion
	["cmp-num-eq", "=1=1"],
	["cmp-num-neq", "=1<>2"],
	["cmp-num-lt", "=1<2"],
	["cmp-num-gte", "=2>=2"],
	["cmp-text-eq-case", '="A"="a"'],
	["cmp-text-vs-number", '="a"=0'],
	["cmp-number-vs-numeric-text", '=1="1"'],
	["cmp-text-gt-number", '="apple">1'],
	["cmp-empty-eq-zero", '=""=0'],
	["cmp-bool-vs-number", "=TRUE=1"],
	["cmp-bool-gt-text", '=TRUE>"z"'],
	["cmp-chain", "=1<2<3"],
	["coerce-text-plus-number", '="abc"+1'],
	["coerce-numeric-text-plus", '="2"+1'],
	["coerce-bool-plus", "=TRUE+1"],
	["coerce-bool-false-plus", "=FALSE+1"],
	["coerce-empty-cell-plus", "=Z99+1"],
	["coerce-empty-cell-concat", '=Z99&"a"'],
	["coerce-text-cell-plus", "=B1+1", GRID],
	["coerce-text-cell-sum", "=SUM(B1,1)", GRID],

	// error production and propagation
	["err-div0", "=1/0"],
	["err-div0-plus", "=(1/0)+1"],
	["err-div0-compare", "=(1/0)>1"],
	["err-div0-concat", '="x"&(1/0)'],
	["err-div0-pow", "=(1/0)^2"],
	["err-div0-in-sum", "=SUM(1,1/0)"],
	["err-div0-in-if-branch", "=IF(TRUE,1,1/0)"],
	["err-na", "=NA()"],
	["err-na-plus", "=NA()+1"],
	["err-sqrt-negative", "=SQRT(-1)"],
	["err-log-zero", "=LOG(0)"],
	["err-unknown-function", "=NOSUCHFUNC(1)"],
	["err-overflow", "=1e308*10"],
	["err-value-in-iferror", '=IFERROR("a"+1,"caught")'],
	["err-literal-plus", "=#REF!+1"],

	// numeric functions
	["fn-sum", "=SUM(1,2,3)"],
	["fn-sum-range", "=SUM(A1:A3)", GRID],
	["fn-average", "=AVERAGE(A1:A3)", GRID],
	["fn-min", "=MIN(A1:A3)", GRID],
	["fn-max", "=MAX(A1:A3)", GRID],
	["fn-count", "=COUNT(A1:B3)", GRID],
	["fn-counta", "=COUNTA(A1:B3)", GRID],
	["fn-abs", "=ABS(-4)"],
	["fn-round-half-up", "=ROUND(2.5,0)"],
	["fn-round-half-down", "=ROUND(-2.5,0)"],
	["fn-round-negative-digits", "=ROUND(1234,-2)"],
	["fn-roundup", "=ROUNDUP(1.001,2)"],
	["fn-rounddown", "=ROUNDDOWN(-1.999,2)"],
	["fn-int-negative", "=INT(-1.5)"],
	["fn-trunc-negative", "=TRUNC(-1.5)"],
	["fn-mod-negative-divisor", "=MOD(-3,2)"],
	["fn-mod-zero", "=MOD(3,0)"],
	["fn-power", "=POWER(2,0.5)"],
	["fn-sqrt", "=SQRT(16)"],
	["fn-exp", "=EXP(1)"],
	["fn-ln", "=LN(10)"],
	["fn-log10", "=LOG10(1000)"],
	["fn-log-base", "=LOG(8,2)"],
	["fn-pi", "=PI()"],
	["fn-sign", "=SIGN(-3)"],
	["fn-ceiling", "=CEILING(2.1,1)"],
	["fn-floor", "=FLOOR(2.9,1)"],
	["fn-product", "=PRODUCT(2,3,4)"],
	["fn-sumproduct", "=SUMPRODUCT(A1:A3,A1:A3)", GRID],
	["fn-median", "=MEDIAN(A1:A3)", GRID],
	["fn-stdev", "=STDEV(1,2,3,4)"],

	// text functions
	["fn-len", '=LEN("hello")'],
	["fn-left", '=LEFT("hello",2)'],
	["fn-right", '=RIGHT("hello",2)'],
	["fn-mid", '=MID("hello",2,3)'],
	["fn-upper", '=UPPER("aBc")'],
	["fn-lower", '=LOWER("aBc")'],
	["fn-trim", '=TRIM("  a  b  ")'],
	["fn-concatenate", '=CONCATENATE("a","b","c")'],
	["fn-find", '=FIND("l","hello")'],
	["fn-find-missing", '=FIND("z","hello")'],
	["fn-search-case-insensitive", '=SEARCH("L","hello")'],
	["fn-substitute", '=SUBSTITUTE("aaa","a","b",2)'],
	["fn-replace", '=REPLACE("hello",2,3,"X")'],
	["fn-rept", '=REPT("ab",3)'],
	["fn-exact", '=EXACT("a","A")'],
	["fn-value", '=VALUE("12")'],
	["fn-text-integer", '=TEXT(12,"0")'],
	["fn-left-over-length", '=LEFT("ab",10)'],
	["fn-mid-zero-start", '=MID("abc",0,1)'],

	// logical functions
	["fn-if-true", "=IF(1=1,\"y\",\"n\")"],
	["fn-if-omitted-false", "=IF(FALSE,1)"],
	["fn-and", "=AND(TRUE,FALSE)"],
	["fn-or", "=OR(TRUE,FALSE)"],
	["fn-not", "=NOT(TRUE)"],
	["fn-xor", "=XOR(TRUE,TRUE)"],
	["fn-iferror-passthrough", "=IFERROR(1,2)"],
	["fn-ifna", "=IFNA(NA(),5)"],
	["fn-isnumber", "=ISNUMBER(1)"],
	["fn-istext", '=ISTEXT("a")'],
	["fn-isblank-empty-cell", "=ISBLANK(Z99)"],
	["fn-iserror", "=ISERROR(1/0)"],
	["fn-isna", "=ISNA(NA())"],
	["fn-iserr-na", "=ISERR(NA())"],

	// lookup
	["fn-vlookup-exact", "=VLOOKUP(2,A1:A3,1,FALSE)", GRID],
	["fn-vlookup-missing", "=VLOOKUP(99,A1:A3,1,FALSE)", GRID],
	["fn-hlookup", "=HLOOKUP(1,A1:C1,1,FALSE)", GRID],
	["fn-match-exact", "=MATCH(2,A1:A3,0)", GRID],
	["fn-index", "=INDEX(A1:A3,2)", GRID],
	["fn-choose", '=CHOOSE(2,"a","b","c")'],
	["fn-countif", '=COUNTIF(A1:A3,">1")', GRID],
	["fn-sumif", '=SUMIF(A1:A3,">1")', GRID],

	// dates
	["fn-date", "=DATE(2020,1,1)"],
	["fn-date-rollover", "=DATE(2020,13,1)"],
	["fn-year", "=YEAR(DATE(2020,3,4))"],
	["fn-month", "=MONTH(DATE(2020,3,4))"],
	["fn-day", "=DAY(DATE(2020,3,4))"],
	["fn-datevalue", '=DATEVALUE("2020-01-01")'],

	// references
	["ref-plain", "=A1", GRID],
	["ref-absolute", "=$A$1", GRID],
	["ref-absolute-row", "=A$1", GRID],
	["ref-absolute-col", "=$A1", GRID],
	["ref-absolute-range", "=SUM($A$1:$A$3)", GRID],
	["ref-lowercase", "=a1", GRID],
	["ref-empty-cell", "=Z99"],
	["ref-range-reversed", "=SUM(A3:A1)", GRID],

	// parser robustness
	["parse-adjacent-literals", "=1 2"],
	["parse-extra-close-paren", "=1+2)"],
	["parse-trailing-garbage", "=SUM(1,2) 5"],
	["parse-unknown-punctuation", "=1@2"],
	["parse-unterminated-string", '="abc'],
	["parse-double-decimal", "=1.2.3"],
	["parse-trailing-operator", "=1+"],
	["parse-lone-close-paren", "=)"],
	["parse-leading-star", "=*1"],
	["parse-empty-parens", "=()"],
	["parse-doubled-quote-escape", '="a""b"'],
	["parse-error-literal-na", "=#N/A"],
	["parse-error-literal-div0", "=#DIV/0!"],
	["parse-bracketed-ref", "=[A1]", GRID],
	["parse-semicolon-args", "=SUM(1;2)"],
	["parse-semicolon-outside-call", "=1;2"],

	// second battery: argument arity, wrong types, boundary inputs
	["arity-sum-no-args", "=SUM()"],
	["arity-abs-no-args", "=ABS()"],
	["arity-abs-extra-args", "=ABS(-1,2)"],
	["arity-left-extra-args", '=LEFT("abc",1,9)'],
	["arity-round-one-arg", "=ROUND(2.567)"],
	["arity-if-one-arg", "=IF(TRUE)"],
	["arity-if-four-args", "=IF(TRUE,1,2,3)"],
	["arity-mod-one-arg", "=MOD(5)"],
	["arity-power-one-arg", "=POWER(2)"],
	["type-abs-text", '=ABS("a")'],
	["type-len-number", "=LEN(123)"],
	["type-upper-number", "=UPPER(12)"],
	["type-sqrt-text", '=SQRT("4")'],
	["type-int-text", '=INT("2.7")'],
	["type-and-number", "=AND(1,1)"],
	["type-not-number", "=NOT(0)"],
	["type-sum-text-arg", '=SUM("2",3)'],
	["type-average-bool", "=AVERAGE(TRUE,FALSE)"],
	["type-count-text", '=COUNT("a",1)'],
	["bound-left-negative", '=LEFT("abc",-1)'],
	["bound-rept-zero", '=REPT("a",0)'],
	["bound-rept-negative", '=REPT("a",-1)'],
	["bound-mid-negative-length", '=MID("abc",1,-1)'],
	["bound-round-huge-digits", "=ROUND(1.5,400)"],
	["bound-power-zero-zero", "=0^0"],
	["bound-zero-negative-power", "=0^-1"],
	["bound-negative-fractional-power", "=(-8)^(1/3)"],
	["bound-huge-power", "=2^1024"],
	["bound-fact-negative", "=FACT(-1)"],
	["bound-fact-fractional", "=FACT(3.7)"],
	["bound-log-base-one", "=LOG(100,1)"],
	["bound-ln-zero", "=LN(0)"],
	["bound-ln-negative", "=LN(-1)"],
	["bound-asin-out-of-range", "=ASIN(2)"],
	["bound-acos-out-of-range", "=ACOS(2)"],
	["bound-tan-half-pi", "=TAN(PI()/2)"],
	["bound-average-empty-range", "=AVERAGE(Y1:Y3)"],
	["bound-max-empty-range", "=MAX(Y1:Y3)"],
	["bound-min-empty-range", "=MIN(Y1:Y3)"],
	["bound-sum-empty-range", "=SUM(Y1:Y3)"],
	["bound-trunc-digits", "=TRUNC(2.789,2)"],
	["bound-floor-negative-significance", "=FLOOR(2.5,-1)"],
	["bound-ceiling-negative-significance", "=CEILING(2.5,-1)"],
	["bound-even-negative", "=EVEN(-1.5)"],
	["bound-odd-negative", "=ODD(-1.5)"],
	["bound-mod-wraps-negative", "=MOD(-1,3)"],
	["bound-date-before-1900", "=DATE(1899,1,1)"],
	["bound-date-arithmetic", "=DATE(2026,1,31)+1"],
	["bound-date-difference", "=DATE(2026,3,1)-DATE(2026,2,1)"],
	["cmp-text-ordering", '="a"<"b"'],
	["cmp-text-ordering-case", '="B">"a"'],
	["cmp-bool-gt-number", "=TRUE>1"],
	["cmp-error-swallowed-equal", "=(1/0)=1"],
	["cmp-error-visible-to-iserror", "=ISERROR((1/0)>1)"],
	["unary-plus-then-minus", "=+-2"],
	["unary-minus-then-plus", "=-+2"],
	["fn-log2-alias", "=LOG(8,2)"],
	["fn-sumsq", "=SUMSQ(3,4)"],
	["fn-roman", "=ROMAN(4)"],
	["fn-quotient", "=QUOTIENT(-7,2)"],
	["fn-gcd", "=GCD(12,18)"],
	["fn-lcm", "=LCM(4,6)"],
	["fn-combin", "=COMBIN(5,2)"],
	["fn-degrees", "=DEGREES(PI())"],
	["fn-radians", "=RADIANS(180)"],
	["fn-large", "=LARGE(A1:A3,1)", GRID],
	["fn-small", "=SMALL(A1:A3,2)", GRID],
	["fn-rank", "=RANK(2,A1:A3)", GRID],
	["fn-countblank", "=COUNTBLANK(Y1:Y3)"],
	["fn-averageif", '=AVERAGEIF(A1:A3,">1")', GRID],
	["fn-sumifs", '=SUMIFS(A1:A3,A1:A3,">1")', GRID],
	["fn-concat-operator-bool", '=TRUE&"x"'],
	["fn-n-text", '=N("a")'],
	["fn-t-number", "=T(1)"],
	["fn-type-number", "=TYPE(1)"],
	["fn-char", "=CHAR(65)"],
	["fn-code", '=CODE("A")'],
	["fn-proper", '=PROPER("hello world")'],
	["fn-numbervalue", '=NUMBERVALUE("1.5")'],
	["fn-clean", '=CLEAN("a")'],
	["fn-fixed", "=FIXED(1234.567,1)"],
	["fn-dollar", "=DOLLAR(1234.567,2)"],
	["fn-textjoin", '=TEXTJOIN(",",TRUE,"a","b")'],
	["fn-switch", '=SWITCH(2,1,"a",2,"b","z")'],
	["fn-ifs", '=IFS(FALSE,"a",TRUE,"b")'],
	["fn-trim-inner-spaces", '=TRIM("a   b")'],
	["fn-substitute-all", '=SUBSTITUTE("aaa","a","b")'],
	["fn-find-start-position", '=FIND("l","hello",4)'],
	["fn-search-wildcard", '=SEARCH("h*o","hello")'],
	["fn-countif-wildcard", '=COUNTIF(B1:B3,"?")', GRID],
	["fn-round-half-even-check", "=ROUND(0.5,0)"],
	["fn-int-vs-trunc", "=INT(-1.5)-TRUNC(-1.5)"],
].map(([id, formula, cells]) => ({ id: `gen:${id as string}`, formula: formula as string, cells: cells as any }))

const CASES: DiffCase[] = [...corpusCases(), ...GENERATED]

// ── Classification ────────────────────────────────────────────────────────────
//
// Every `gen:` disagreement is classified here, and every row is explained in
// compatibility-report.md. A `gen:` difference that is NOT listed fails the
// suite, so a new disagreement cannot land unclassified.
//
// `corpus:` cases are informational only. syntax.json and arithmetic.json are
// owned by other areas and grow independently, so gating on them would make this
// suite fail for changes that have nothing to do with compatibility. They are
// still run and still reported by DIFF_DUMP.

type Classification =
	| "local-defect"
	| "ironcalc-defect"
	| "intentional-product-difference"
	| "unsupported-local-feature"
	| "unsupported-ironcalc-feature"
	| "inconclusive"
	| "locale-dependent"

// Where BOTH engines disagree with Excel the row is still "local-defect": this
// engine is the one under test. The IronCalc side is recorded in the report.
const DIFFERENCE_TABLE: Record<string, Classification> = {
	// operators and unary handling
	"gen:op-pow-chain": "local-defect",
	"gen:op-percent-double": "local-defect",
	"gen:op-unary-minus-percent": "local-defect",
	"gen:op-unary-double-minus": "local-defect",
	"gen:unary-plus-then-minus": "local-defect",
	"gen:unary-minus-then-plus": "local-defect",

	// comparison and coercion
	"gen:cmp-text-vs-number": "local-defect",
	"gen:cmp-number-vs-numeric-text": "local-defect",
	"gen:cmp-text-gt-number": "local-defect",
	"gen:cmp-empty-eq-zero": "local-defect",
	"gen:cmp-bool-vs-number": "local-defect",
	"gen:cmp-bool-gt-number": "local-defect",
	"gen:cmp-chain": "local-defect",
	"gen:cmp-text-ordering": "local-defect",
	"gen:cmp-text-ordering-case": "local-defect",
	"gen:coerce-empty-cell-concat": "local-defect",
	"gen:fn-concat-operator-bool": "local-defect",

	// error production and propagation
	"gen:err-div0-compare": "local-defect",
	"gen:err-div0-concat": "local-defect",
	"gen:err-div0-in-sum": "local-defect",
	"gen:err-overflow": "local-defect",
	"gen:cmp-error-swallowed-equal": "local-defect",
	"gen:cmp-error-visible-to-iserror": "local-defect",
	"gen:bound-zero-negative-power": "local-defect",
	"gen:bound-negative-fractional-power": "local-defect",
	"gen:bound-huge-power": "local-defect",
	"gen:bound-fact-negative": "local-defect",
	"gen:bound-log-base-one": "local-defect",

	// function results
	"gen:fn-round-half-down": "local-defect",
	"gen:fn-rounddown": "local-defect",
	"gen:fn-mod-negative-divisor": "local-defect",
	"gen:fn-mid-zero-start": "local-defect",
	"gen:fn-isblank-empty-cell": "local-defect",
	"gen:fn-countblank": "local-defect",
	"gen:fn-fixed": "local-defect",
	"gen:fn-dollar": "local-defect",
	"gen:fn-search-wildcard": "local-defect",
	"gen:bound-trunc-digits": "local-defect",
	"gen:bound-floor-negative-significance": "local-defect",
	"gen:bound-ceiling-negative-significance": "local-defect",
	"gen:bound-even-negative": "local-defect",
	"gen:bound-odd-negative": "local-defect",
	"gen:bound-mod-wraps-negative": "local-defect",
	"gen:bound-average-empty-range": "local-defect",

	// argument validation
	"gen:arity-sum-no-args": "local-defect",
	"gen:arity-abs-no-args": "local-defect",
	"gen:arity-abs-extra-args": "local-defect",
	"gen:arity-left-extra-args": "local-defect",
	"gen:arity-round-one-arg": "local-defect",
	"gen:arity-if-one-arg": "local-defect",
	"gen:arity-if-four-args": "local-defect",
	"gen:arity-mod-one-arg": "local-defect",
	"gen:arity-power-one-arg": "local-defect",
	"gen:type-abs-text": "local-defect",
	"gen:bound-left-negative": "local-defect",
	"gen:bound-rept-negative": "local-defect",
	"gen:bound-mid-negative-length": "local-defect",
	// Excel returns 1.5, IronCalc #NUM!, this engine NaN. All three disagree.
	"gen:bound-round-huge-digits": "inconclusive",

	// references
	"gen:ref-absolute": "local-defect",
	"gen:ref-absolute-row": "local-defect",
	"gen:ref-absolute-range": "local-defect",

	// parser
	"gen:parse-unterminated-string": "local-defect",
	"gen:parse-lone-close-paren": "local-defect",
	"gen:parse-leading-star": "local-defect",
	"gen:parse-doubled-quote-escape": "local-defect",
	"gen:parse-error-literal-na": "local-defect",
	"gen:parse-error-literal-div0": "local-defect",
	"gen:parse-bracketed-ref": "local-defect",
	// known-differences.json / diff-argument-separator-semicolon
	"gen:parse-semicolon-args": "intentional-product-difference",

	// dates: this engine models a date as an ISO string, not an Excel serial
	"gen:bound-date-before-1900": "local-defect",
	"gen:bound-date-arithmetic": "local-defect",
	"gen:bound-date-difference": "local-defect",

	// functions this engine does not implement
	"gen:fn-log10": "unsupported-local-feature",
	"gen:fn-sumsq": "unsupported-local-feature",
	"gen:fn-roman": "unsupported-local-feature",
	"gen:fn-lcm": "unsupported-local-feature",
	"gen:fn-rank": "unsupported-local-feature",
	"gen:fn-type-number": "unsupported-local-feature",
}

interface Disagreement {
	id: string
	formula: string
	local: string
	ironcalc: string
}

describe.skipIf(!ironCalcReady)("formula engine vs IronCalc", () => {
	const disagreements: Disagreement[] = []

	beforeAll(() => {
		for (const c of CASES) {
			let local: Normal
			try {
				local = normaliseLocal(runDirect({ ...c, expected: null, category: "diff", source: "ironcalc" } as any))
			} catch (e) {
				local = { kind: "error", value: `#THROW!${(e as Error).message}` }
			}
			let other: Normal
			try {
				const r = evaluateInIronCalc(c.formula, c.cells ?? {})
				if (!r) continue
				other = normaliseIronCalc(r)
			} catch {
				other = { kind: "error", value: "#IRONCALC-REJECTED!" }
			}
			if (!sameNormal(local, other)) {
				disagreements.push({
					id: c.id,
					formula: c.formula,
					local: describeNormal(local),
					ironcalc: describeNormal(other),
				})
			}
		}
		// `DIFF_DUMP=<path> yarn vitest run …` writes the raw comparison there,
		// which is how the table in compatibility-report.md is regenerated.
		if (process.env.DIFF_DUMP) {
			const raw = CASES.map((c) => {
				const v = runDirect({ ...c, expected: null, category: "diff", source: "ironcalc" } as any)
				return {
					id: c.id,
					formula: c.formula,
					type: typeof v,
					finite: typeof v === "number" ? Number.isFinite(v) : null,
					negZero: Object.is(v, -0),
					value: typeof v === "number" && !Number.isFinite(v) ? String(v) : v,
				}
			})
			writeFileSync(
				process.env.DIFF_DUMP,
				JSON.stringify({ total: CASES.length, disagreements, raw }, null, 2),
			)
		}
	})

	it("loads IronCalc", () => {
		expect(isIronCalcAvailable(), ironCalcLoadError() ?? "").toBe(true)
	})

	it("compares a non-trivial corpus", () => {
		expect(GENERATED.length).toBeGreaterThan(150)
	})

	it("has no unclassified disagreement", () => {
		const unclassified = disagreements
			.filter((d) => d.id.startsWith("gen:") && !(d.id in DIFFERENCE_TABLE))
			.map((d) => `${d.id} ${d.formula} local=${d.local} ironcalc=${d.ironcalc}`)
		expect(unclassified).toEqual([])
	})

	it("still disagrees on every classified case", () => {
		const ids = new Set(disagreements.map((d) => d.id))
		// A healed row means a fix landed. Remove it from the table and from the
		// report in the same change.
		const healed = Object.keys(DIFFERENCE_TABLE).filter((id) => !ids.has(id))
		expect(healed).toEqual([])
	})

	it("agrees on everything else", () => {
		const generated = new Set(GENERATED.map((c) => c.id))
		const agreed = GENERATED.length - disagreements.filter((d) => generated.has(d.id)).length
		expect(agreed).toBe(GENERATED.length - Object.keys(DIFFERENCE_TABLE).length)
	})
})

if (!ironCalcReady) {
	describe("formula engine vs IronCalc", () => {
		it.skip(`skipped: @ironcalc/wasm unavailable (${ironCalcLoadError()})`, () => {})
	})
}
