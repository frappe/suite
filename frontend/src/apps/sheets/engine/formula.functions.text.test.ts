// Text, logical and information functions — the checks the JSON corpus cannot hold.
//
// `test-corpus/functions/text.json` and `.../logical.json` carry the per-case
// expectations for these families. Three kinds of check cannot live in JSON and
// live here instead:
//
//   1. Values JSON has no syntax for — NaN and `undefined` both serialise to
//      `null`, so a fixture cannot pin them. They matter: a cell holding NaN or
//      `undefined` is neither a value nor an error, and every consumer
//      downstream stringifies it into the grid.
//   2. Sweeps — the same question asked of thirty functions at once. Written as
//      a fixture each that is thirty unreadable JSON blobs; written as a table
//      it is one readable statement about the whole family.
//   3. Defect budgets — an inventory of which functions are currently wrong.
//      Asserting the exact set means repairing one of them turns this file red
//      and forces the inventory to be updated in the same change, instead of
//      the fix landing with no record.
//
// Every expectation about a SPREADSHEET is stated as Excel or Google Sheets
// behaviour and, where the engine disagrees, marked as a defect. Nothing here
// treats the engine's current output as correct by definition.

import { describe, expect, it } from "vitest"

import { createSheet } from "./sheet.js"
import { getFunctionNames } from "./formula.js"

const PROBE = "XFD1048576"

function evaluate(formula: string, cells: Record<string, string | number> = {}): unknown {
	const sheet = createSheet({})
	for (const [id, v] of Object.entries(cells)) sheet.setCell(id, v, "Sheet1")
	sheet.setCell(PROBE, formula, "Sheet1")
	return sheet.getCellValue(PROBE, "Sheet1")
}

/** Functions in this agent's scope, split by family. */
const TEXT_FNS = [
	"CHAR", "CLEAN", "CODE", "CONCAT", "CONCATENATE", "DOLLAR", "EXACT", "FIND",
	"FIXED", "JOIN", "LEFT", "LEN", "LOWER", "MID", "NUMBERVALUE", "PROPER",
	"REGEXEXTRACT", "REGEXMATCH", "REGEXREPLACE", "REPLACE", "REPT", "RIGHT",
	"SEARCH", "SPLIT", "SUBSTITUTE", "T", "TEXT", "TEXTJOIN", "TRIM", "UPPER",
	"VALUE",
]
const LOGICAL_FNS = ["AND", "FALSE", "IF", "IFS", "NOT", "OR", "SWITCH", "TRUE", "XOR"]
const INFO_FNS = [
	"IFERROR", "IFNA", "ISBLANK", "ISERR", "ISERROR", "ISEVEN", "ISLOGICAL",
	"ISNA", "ISNUMBER", "ISODD", "ISTEXT", "NA",
]
const SCOPE = [...TEXT_FNS, ...LOGICAL_FNS, ...INFO_FNS]

describe("scope inventory", () => {
	it("every function under test is actually registered", () => {
		const registered = new Set(getFunctionNames())
		expect(SCOPE.filter((f) => !registered.has(f))).toEqual([])
	})
})

// ── 1. Values JSON cannot express ─────────────────────────────────────────────

describe("non-representable results", () => {
	// A spreadsheet has no NaN. Excel answers #VALUE!. NaN in a cell is strictly
	// worse than an error value: errors propagate visibly and IFERROR can catch
	// them, whereas NaN fails every comparison including equality with itself,
	// so a downstream `=IF(x=x,...)` silently takes the wrong branch.
	const NAN_PRODUCERS: Array<[string, string]> = [
		['=CODE("")', "#VALUE!"],
		['=NUMBERVALUE("abc")', "#VALUE!"],
		['=NUMBERVALUE("")', "0"],
		["=NUMBERVALUE()", "#N/A (wrong number of arguments)"],
	]

	it.each(NAN_PRODUCERS)("%s leaks NaN where a spreadsheet gives %s", (formula) => {
		const got = evaluate(formula)
		expect(typeof got).toBe("number")
		expect(Number.isNaN(got as number)).toBe(true)
	})

	it("a leaked NaN is not even equal to itself, so guards downstream misfire", () => {
		expect(evaluate('=CODE("")=CODE("")')).toBe(true)
		// The engine's own `=` operator says TRUE only because it compares the
		// STRING forms first ("NaN" === "NaN"). The underlying value is still
		// NaN, so any consumer doing a real numeric compare disagrees with the
		// grid. Excel never reaches this state: CODE("") is #VALUE!.
		expect(Number.isNaN(evaluate('=CODE("")') as number)).toBe(true)
	})

	// `undefined` is what a missing argument becomes. Excel refuses the formula
	// entry outright and Google Sheets returns #N/A; neither can produce a cell
	// that holds nothing at all.
	const UNDEFINED_PRODUCERS = ["=IF(1)", "=SWITCH()", "=IFERROR(1/0)", "=IFERROR()", "=IFNA(NA())", "=IFNA()"]

	it.each(UNDEFINED_PRODUCERS)("%s returns undefined where a spreadsheet gives an error", (formula) => {
		expect(evaluate(formula)).toBeUndefined()
	})

	it("an undefined cell value is indistinguishable from a blank downstream", () => {
		// `_str` maps null and undefined to empty text, so the failure hides
		// completely: a formula that produced NOTHING reads as a blank cell and
		// every consumer treats it as valid data. Excel would have refused the
		// formula and Sheets would show #N/A.
		expect(evaluate('=IF(1)&"!"')).toBe("!")
		expect(evaluate("=ISBLANK(IF(1))")).toBe(true)
	})

	it("missing text arguments print 'undefined' directly", () => {
		expect(evaluate("=UPPER()")).toBe("UNDEFINED")
		expect(evaluate("=TRIM()")).toBe("undefined")
		expect(evaluate('=REPLACE("hello",2,3)')).toBe("hundefinedo")
		expect(evaluate('=SUBSTITUTE("abc","b")')).toBe("aundefinedc")
	})
})

// ── 2. Arity ──────────────────────────────────────────────────────────────────

describe("arity", () => {
	// There is no arity checking anywhere in the engine: `primary()` collects
	// however many arguments were written and hands the array to the built-in,
	// which destructures what it wants. Both directions are silent.
	it("no function in scope rejects zero arguments", () => {
		const rejected = SCOPE.filter((fn) => evaluate(`=${fn}()`) === "#N/A")
		// The three that do answer #N/A reach it by accident, not by validation:
		// IFS falls through its no-match path (`=IFS(FALSE,1)` gives the same
		// answer), REGEXEXTRACT treats the missing pattern as the literal
		// 'undefined' and reports no match, and #N/A is NA()'s entire purpose.
		// `=SWITCH()` is worse still — it returns the JavaScript `undefined`.
		expect(rejected.sort()).toEqual(["IFS", "NA", "REGEXEXTRACT"])
		expect(evaluate("=SWITCH()")).toBeUndefined()
	})

	it("no function in scope rejects a surplus argument", () => {
		const surplus: Record<string, string> = {
			CHAR: '=CHAR(65,66)',
			CODE: '=CODE("A","B")',
			EXACT: '=EXACT("a","a","a")',
			IF: "=IF(TRUE,1,2,3)",
			IFERROR: "=IFERROR(1,2,3)",
			ISBLANK: '=ISBLANK("a","b")',
			ISNUMBER: "=ISNUMBER(1,2)",
			LEFT: '=LEFT("hello",2,3)',
			LEN: '=LEN("a","b")',
			NOT: "=NOT(TRUE,FALSE)",
			T: '=T("a","b")',
			TRUE: "=TRUE(1)",
			UPPER: '=UPPER("a","b")',
		}
		for (const [fn, formula] of Object.entries(surplus)) {
			expect(evaluate(formula), `${fn}: ${formula}`).not.toBe("#N/A")
		}
	})

	// Excel documents a default for these; the engine reads the missing
	// argument as 0 or as `undefined` instead of applying the default.
	it("LEFT and RIGHT ignore the documented num_chars default of 1", () => {
		expect(evaluate('=LEFT("hello")')).toBe("") // Excel: "h"
		expect(evaluate('=RIGHT("hello")')).toBe("") // Excel: "o"
	})
})

// ── 3. Boolean stringification ────────────────────────────────────────────────

describe("boolean stringification", () => {
	// Excel and Sheets render a logical as "TRUE"/"FALSE" everywhere a text
	// function consumes one. The engine uses JavaScript String(), which gives
	// lower case, so every text function inherits the same wrong casing.
	it("every text function receiving TRUE sees 'true', not 'TRUE'", () => {
		const cases: Array<[string, unknown, unknown]> = [
			// formula, engine result, Excel result
			['=CONCAT(TRUE)', "true", "TRUE"],
			['=CONCATENATE(TRUE)', "true", "TRUE"],
			['=LEFT(TRUE,2)', "tr", "TR"],
			['=RIGHT(TRUE,2)', "ue", "UE"],
			['=MID(TRUE,1,1)', "t", "T"],
			['=CODE(TRUE)', 116, 84],
			['=EXACT(TRUE,"TRUE")', false, true],
			['=FIND("R",TRUE)', "#VALUE!", 2],
			['=PROPER(TRUE)', "True", "True"],
			['=SUBSTITUTE(TRUE,"T","X")', "true", "XRUE"],
			['=REPT(TRUE,1)', "true", "TRUE"],
			['=TEXTJOIN("-",TRUE,TRUE,FALSE)', "true-false", "TRUE-FALSE"],
			['=JOIN("-",TRUE)', "true", "TRUE"],
		]
		for (const [formula, engine] of cases) {
			expect(evaluate(formula), formula).toEqual(engine)
		}
		// The one that is right for the wrong reason: both products lowercase it.
		expect(evaluate("=LOWER(TRUE)")).toBe("true")
		// And the one that is genuinely right: length is the same either way.
		expect(evaluate("=LEN(TRUE)")).toBe(4)
	})
})

// ── 4. Blank cells ────────────────────────────────────────────────────────────

describe("blank cells", () => {
	// `getCellValue` returns the NUMBER 0 for a cell that is unset, cleared or
	// holds empty text. There is no blank in the value model at all, so every
	// blank-sensitive function is wrong in the same way.
	it("an unset cell is the number 0, so blankness is unobservable", () => {
		expect(evaluate("=ISBLANK(Z99)")).toBe(false) // Excel: TRUE
		expect(evaluate("=LEN(Z99)")).toBe(1) // Excel: 0
		expect(evaluate("=ISNUMBER(Z99)")).toBe(true) // Excel: FALSE
		expect(evaluate('=CONCAT(Z99,"x")')).toBe("0x") // Excel: "x"
		expect(evaluate("=UPPER(Z99)")).toBe("0") // Excel: ""
	})

	it("a cleared cell behaves the same as one that was never written", () => {
		const cleared = { A1: "" }
		expect(evaluate("=ISBLANK(A1)", cleared)).toBe(false)
		expect(evaluate("=LEN(A1)", cleared)).toBe(1)
		expect(evaluate("=ISBLANK(Z99)")).toBe(evaluate("=ISBLANK(A1)", cleared))
	})

	it("ISBLANK is wrong in both directions, so it cannot be used at all", () => {
		// Blank cell answers FALSE (should be TRUE) …
		expect(evaluate("=ISBLANK(A1)", { A1: "" })).toBe(false)
		// … and empty TEXT answers TRUE (should be FALSE).
		expect(evaluate('=ISBLANK("")')).toBe(true)
	})
})

// ── 5. How far error-swallowing reaches ───────────────────────────────────────

describe("error propagation into the IS* family", () => {
	// The comparison operators coerce both operands with `toNum`, which maps an
	// error string to 0. The error is destroyed before any caller sees it, so
	// the whole error-handling family goes blind at once.
	it("a comparison erases the error, blinding every error check placed after it", () => {
		expect(evaluate("=(1/0)>1")).toBe(false) // Excel: #DIV/0!
		expect(evaluate("=ISERROR((1/0)>1)")).toBe(false) // Excel: TRUE
		expect(evaluate("=ISERR((1/0)>1)")).toBe(false) // Excel: TRUE
		expect(evaluate('=IFERROR((1/0)>1,"caught")')).toBe(false) // Excel: "caught"
		expect(evaluate('=IF((1/0)>1,"yes","no")')).toBe("no") // Excel: #DIV/0!
	})

	it("an error reaching a function directly IS still caught", () => {
		// Without a comparison in the way the error survives, so the defect is
		// specifically the comparison operators, not the IS* functions.
		expect(evaluate("=ISERROR(1/0)")).toBe(true)
		expect(evaluate('=IFERROR(1/0,"caught")')).toBe("caught")
	})

	// Errors are plain strings, so `isErr` is a `startsWith("#")` test. Any user
	// text beginning with # is misread as an error, in every direction.
	const HASH_TEXTS = ["#1 seed", "#hashtag", "#REF", "#"]

	it.each(HASH_TEXTS)("ordinary text %j is misclassified as an error", (text) => {
		expect(evaluate(`=ISERROR("${text}")`)).toBe(true) // Excel: FALSE
		expect(evaluate(`=IFERROR("${text}","swallowed")`)).toBe("swallowed") // Excel: the text
	})

	it("conversely, every error value is reported as text", () => {
		expect(evaluate("=ISTEXT(1/0)")).toBe(true) // Excel: FALSE
		expect(evaluate("=ISTEXT(NA())")).toBe(true) // Excel: FALSE
	})

	// The numeric IS* functions run their argument through `toNum`, which turns
	// an error into 0. ISEVEN then reports TRUE — an error becomes an answer.
	it("ISODD and ISEVEN convert an error into a confident answer", () => {
		expect(evaluate("=ISEVEN(1/0)")).toBe(true) // Excel: #DIV/0!
		expect(evaluate("=ISODD(1/0)")).toBe(false) // Excel: #DIV/0!
		expect(evaluate('=ISEVEN("abc")')).toBe(true) // Excel: #VALUE!
	})

	it("ISODD and ISEVEN disagree with each other on a fraction", () => {
		// Excel truncates, so exactly one of the two is TRUE. The engine takes
		// 3.5 % 2 = 1.5, which equals neither 0 nor 1, so BOTH are FALSE and the
		// pair stops being a partition.
		expect(evaluate("=ISODD(3.5)")).toBe(false) // Excel: TRUE
		expect(evaluate("=ISEVEN(3.5)")).toBe(false) // Excel: FALSE
	})
})

// ── 6. Eager argument evaluation ──────────────────────────────────────────────

describe("eager argument evaluation", () => {
	// The parser evaluates every argument before calling the function, so IF,
	// IFS, SWITCH, IFERROR and IFNA cannot short-circuit. That is survivable
	// only because errors are produced as VALUES rather than thrown: the
	// selector still discards the branch it did not choose.
	it("the divide-by-zero guard idiom still works despite eager evaluation", () => {
		expect(evaluate("=IF(A1=0,0,1/A1)", { A1: 0 })).toBe(0)
		expect(evaluate('=IF(A1=0,"safe",1/A1)', { A1: 0 })).toBe("safe")
		expect(evaluate("=IFS(A1=0,0,TRUE,1/A1)", { A1: 0 })).toBe(0)
		expect(evaluate('=SWITCH(A1,0,"zero",1/A1)', { A1: 0 })).toBe("zero")
	})

	it("an error in the CONDITION is not propagated, which is the real gap", () => {
		// Excel: #DIV/0! for all three. The engine sees a non-empty string,
		// which JavaScript calls truthy, and takes the TRUE branch.
		expect(evaluate("=IF(1/0,1,2)")).toBe(1)
		expect(evaluate('=IFS(1/0,"a",TRUE,"b")')).toBe("a")
		expect(evaluate("=AND(1/0)")).toBe(true)
		expect(evaluate("=OR(1/0)")).toBe(true)
		expect(evaluate("=NOT(1/0)")).toBe(false)
	})

	it("text in a logical position is accepted instead of rejected", () => {
		// Excel: #VALUE! for all of these. JavaScript truthiness accepts any
		// non-empty string and rejects the empty one.
		expect(evaluate('=IF("a",1,2)')).toBe(1)
		expect(evaluate('=IF("",1,2)')).toBe(2)
		expect(evaluate('=AND("a")')).toBe(true)
		expect(evaluate('=NOT("a")')).toBe(false)
		expect(evaluate('=XOR("a","b")')).toBe(false)
	})
})

// ── 7. Index bases and rejected counts ────────────────────────────────────────

describe("1-based indexing and count validation", () => {
	it("FIND, SEARCH, MID and REPLACE agree on a 1-based origin", () => {
		expect(evaluate('=FIND("h","hello")')).toBe(1)
		expect(evaluate('=SEARCH("H","hello")')).toBe(1)
		expect(evaluate('=MID("hello",1,1)')).toBe("h")
		expect(evaluate('=REPLACE("hello",1,1,"J")')).toBe("Jello")
	})

	it("FIND and SEARCH report not-found as #VALUE!, never 0 or -1", () => {
		// A 0 or -1 would be indistinguishable from a real position under the
		// engine's loose numeric coercion, so this one matters.
		expect(evaluate('=FIND("z","hello")')).toBe("#VALUE!")
		expect(evaluate('=SEARCH("z","hello")')).toBe("#VALUE!")
		expect(evaluate('=FIND("L","hello")')).toBe("#VALUE!") // case-sensitive
		expect(evaluate('=SEARCH("L","hello")')).toBe(3) // case-insensitive
	})

	// Excel answers #VALUE! for every one of these. The engine accepts them all
	// and returns a plausible-looking string, which is how an off-by-one in a
	// user's formula turns into silently wrong data rather than a visible error.
	const REJECTED_BY_EXCEL: Array<[string, unknown]> = [
		['=LEFT("hello",-1)', ""],
		['=RIGHT("hello",-1)', ""],
		['=MID("hello",0,2)', "h"],
		['=MID("hello",-1,2)', ""],
		['=MID("hello",2,-1)', "h"],
		['=REPLACE("hello",0,2,"X")', "Xello"],
		['=REPLACE("hello",-1,2,"X")', "Xhello"],
		['=FIND("l","hello",0)', 3],
		['=REPT("ab",-1)', ""],
		['=SUBSTITUTE("a-b-c","-","+",0)', "a-b-c"],
		["=CHAR(0)", " "],
		["=CHAR(256)", "Ā"],
	]

	it.each(REJECTED_BY_EXCEL)("%s is #VALUE! in Excel but returns a value here", (formula, engine) => {
		expect(evaluate(formula as string)).toEqual(engine)
	})

	it("MID with a negative length returns text from BEFORE the start position", () => {
		// JavaScript substring swaps its bounds when start > end, so a negative
		// num_chars reads backwards. Nothing about the result hints at that.
		expect(evaluate('=MID("hello",4,-2)')).toBe("el")
	})
})

// ── 8. Regex robustness ───────────────────────────────────────────────────────

describe("regex functions", () => {
	const INVALID_PATTERNS = ["[", "(", "*", "a{2,1}", "(?<", "\\"]

	it.each(INVALID_PATTERNS)("an invalid pattern %j is reported, not thrown", (pattern) => {
		const p = pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
		expect(evaluate(`=REGEXMATCH("abc","${p}")`)).toBe("#ERROR!")
		expect(evaluate(`=REGEXEXTRACT("abc","${p}")`)).toBe("#ERROR!")
		expect(evaluate(`=REGEXREPLACE("abc","${p}","x")`)).toBe("#ERROR!")
	})

	it("the tokenizer preserves backslashes so regex classes survive", () => {
		// Only \" and \\ are string escapes; \d, \s and \w must reach the regex
		// engine intact or every realistic pattern breaks.
		expect(evaluate('=REGEXMATCH("a1","\\d")')).toBe(true)
		expect(evaluate('=REGEXMATCH("a b","\\s")')).toBe(true)
		expect(evaluate('=REGEXMATCH("ab","\\w+")')).toBe(true)
		expect(evaluate('=REGEXEXTRACT("a-12","(\\d+)")')).toBe("12")
		expect(evaluate('=REGEXREPLACE("a1b2","\\d","")')).toBe("ab")
	})

	it("no-match answers differ by function, as Sheets documents", () => {
		expect(evaluate('=REGEXMATCH("abc","z")')).toBe(false)
		expect(evaluate('=REGEXEXTRACT("abc","z")')).toBe("#N/A")
		expect(evaluate('=REGEXREPLACE("abc","z","x")')).toBe("abc")
	})

	it("REGEXEXTRACT drops every capture group after the first", () => {
		// Sheets spills one cell per group. Losing the rest is silent.
		expect(evaluate('=REGEXEXTRACT("a12b","([0-9])([0-9])")')).toBe("1")
	})
})

// ── 9. Formatting functions ───────────────────────────────────────────────────

describe("number formatting", () => {
	it("DOLLAR and FIXED never group thousands", () => {
		// Grouping is the defining behaviour of both functions.
		expect(evaluate("=DOLLAR(1234.567)")).toBe("$1234.57") // Excel: "$1,234.57"
		expect(evaluate("=FIXED(1234.567)")).toBe("1234.57") // Excel: "1,234.57"
	})

	it("a negative decimals argument crashes into #VALUE! instead of rounding left", () => {
		// Number.toFixed throws a RangeError for a negative argument and the
		// blanket try/catch around every built-in reports it as a type error,
		// so an internal crash is indistinguishable from bad input.
		expect(evaluate("=DOLLAR(1234.567,-2)")).toBe("#VALUE!") // Excel: "$1,200"
		expect(evaluate("=FIXED(1234.567,-1)")).toBe("#VALUE!") // Excel: "1,230"
	})

	it("FIXED switches to exponential notation past 1e21", () => {
		expect(evaluate("=FIXED(1000000000000000000000,2)")).toBe("1e+21")
	})

	it("TEXT grouping follows the HOST locale, not the format string", () => {
		// toLocaleString() is used as the fallback, so the same workbook renders
		// differently on different machines. That non-determinism is the defect;
		// the assertion below only pins the shape, not one locale's answer.
		const grouped = evaluate('=TEXT(1234567.5,"#,##0")') as string
		expect(typeof grouped).toBe("string")
		expect(grouped).toContain(",")
		// Excel gives "1,234,568" — the format asked for no decimals, and the
		// engine keeps them regardless of locale.
		expect(grouped).toContain(".5")
	})

	it("TEXT ignores the format string entirely once it starts with $", () => {
		expect(evaluate('=TEXT(1234,"$#,##0")')).toBe("$1234.00") // Excel: "$1,234"
		expect(evaluate('=TEXT(1234,"$#,##0.000")')).toBe("$1234.00") // Excel: "$1,234.000"
	})

	it("VALUE accepts a partial parse where Excel demands the whole string", () => {
		expect(evaluate('=VALUE("12abc")')).toBe(12) // Excel: #VALUE!
		expect(evaluate('=VALUE("50%")')).toBe(50) // Excel: 0.5
		expect(evaluate('=VALUE("1 2 3")')).toBe(123) // Excel: #VALUE!
	})

	it("NUMBERVALUE ignores its separator arguments", () => {
		// The separators are the only reason to use NUMBERVALUE over VALUE.
		expect(evaluate('=NUMBERVALUE("1.234,5",",",".")')).toBe(1.2345) // Excel: 1234.5
	})
})

// ── 10. Round trips ───────────────────────────────────────────────────────────

describe("round trips", () => {
	it("CODE(CHAR(n)) is the identity across the whole documented range", () => {
		const broken: number[] = []
		for (let n = 1; n <= 255; n++) if (evaluate(`=CODE(CHAR(${n}))`) !== n) broken.push(n)
		expect(broken).toEqual([])
	})

	it("LEFT and RIGHT partition a string at every cut point", () => {
		const word = "spreadsheet"
		for (let i = 0; i <= word.length; i++) {
			const left = evaluate(`=LEFT("${word}",${i})`)
			const right = evaluate(`=RIGHT("${word}",${word.length - i})`)
			expect(`${left}${right}`, `cut at ${i}`).toBe(word)
		}
	})

	it("MID reproduces LEFT and RIGHT, confirming one shared index base", () => {
		expect(evaluate('=MID("spreadsheet",1,6)')).toBe(evaluate('=LEFT("spreadsheet",6)'))
		expect(evaluate('=MID("spreadsheet",7,5)')).toBe(evaluate('=RIGHT("spreadsheet",5)'))
	})

	it("VALUE undoes TEXT for plain decimal formats", () => {
		for (const n of [0, 1, -1, 1234.5, 0.125]) {
			expect(evaluate(`=VALUE(TEXT(${n},"0.000"))`), `n=${n}`).toBe(n)
		}
	})

	it("SUBSTITUTE is its own inverse when the replacement is absent from the text", () => {
		const s = "a-b-c"
		expect(evaluate(`=SUBSTITUTE(SUBSTITUTE("${s}","-","+"),"+","-")`)).toBe(s)
	})

	it("UPPER and LOWER are idempotent", () => {
		expect(evaluate('=UPPER(UPPER("MiXeD"))')).toBe(evaluate('=UPPER("MiXeD")'))
		expect(evaluate('=LOWER(LOWER("MiXeD"))')).toBe(evaluate('=LOWER("MiXeD")'))
	})
})

// ── 11. Crash sweep ───────────────────────────────────────────────────────────

describe("crash resistance", () => {
	// Every built-in call is wrapped in `try { fn(args) } catch { '#VALUE!' }`,
	// so a genuine crash is indistinguishable from a type error. The point of
	// this sweep is not that the engine survives — it always does — but to pin
	// which hostile inputs currently take the catch branch, so that a future
	// change that starts or stops crashing is visible.
	const HOSTILE = ['""', '"a"', "0", "-1", "1/0", "TRUE", "Z99", "A1:A2", "1000000000"]

	it("no scoped function throws out of the evaluator", () => {
		for (const fn of SCOPE) {
			for (const arg of HOSTILE) {
				for (const formula of [`=${fn}(${arg})`, `=${fn}(${arg},${arg})`, `=${fn}(${arg},${arg},${arg})`]) {
					expect(() => evaluate(formula, { A1: 1, A2: 2 }), formula).not.toThrow()
				}
			}
		}
	})

	it("the catch branch is reachable, so #VALUE! can mean 'internal crash'", () => {
		// String.repeat and Number.toFixed both throw a RangeError here. Excel
		// also answers #VALUE! for the first, so the engine is accidentally
		// right; for the second Excel returns a formatted number.
		expect(evaluate('=REPT("a",1000000000)')).toBe("#VALUE!")
		expect(evaluate("=FIXED(1,-1)")).toBe("#VALUE!")
	})

	it("a very long string is built without failing", () => {
		// Excel caps a cell at 32767 characters and answers #VALUE! past that.
		// The engine has no cap, so this documents an unbounded allocation path.
		expect(evaluate('=LEN(REPT("a",32768))')).toBe(32768)
	})
})

// ── 12. Cross-sheet ───────────────────────────────────────────────────────────

describe("cross-sheet arguments", () => {
	function crossSheet(formula: string): unknown {
		const sheet = createSheet({})
		sheet.addSheet("Data")
		sheet.setCell("A1", "hello", "Data")
		sheet.setCell("A2", "world", "Data")
		sheet.setCell("B1", 0, "Data")
		sheet.setCell(PROBE, formula, "Sheet1")
		return sheet.getCellValue(PROBE, "Sheet1")
	}

	it("scalar text functions read another sheet", () => {
		expect(crossSheet("=UPPER(Data!A1)")).toBe("HELLO")
		expect(crossSheet("=LEN(Data!A1)")).toBe(5)
		expect(crossSheet('=CONCAT(Data!A1,"-",Data!A2)')).toBe("hello-world")
	})

	it("range-taking functions read another sheet's range", () => {
		expect(crossSheet('=TEXTJOIN("-",TRUE,Data!A1:A2)')).toBe("hello-world")
		expect(crossSheet('=JOIN("/",Data!A1:A2)')).toBe("hello/world")
	})

	it("logical and information functions read another sheet", () => {
		expect(crossSheet('=IF(Data!B1=0,"zero","nonzero")')).toBe("zero")
		expect(crossSheet("=ISNUMBER(Data!B1)")).toBe(true)
		expect(crossSheet("=ISTEXT(Data!A1)")).toBe(true)
	})

	it("a missing cross-sheet cell is 0, so IFERROR has nothing to catch", () => {
		// Excel also returns 0 for an empty referenced cell, so this matches —
		// but only because the blank-is-zero defect and Excel's blank-in-
		// arithmetic rule happen to agree here.
		expect(crossSheet('=IFERROR(Data!ZZ99,"missing")')).toBe(0)
	})
})

// ── 13. Array arguments ───────────────────────────────────────────────────────

describe("array arguments", () => {
	// SPLIT returns a flat one-dimensional array where Sheets spills a single
	// ROW. Anything that consumes the result sees the wrong orientation, and
	// any scalar function that receives an array stringifies it with commas.
	it("SPLIT returns a column where Sheets produces a row", () => {
		expect(evaluate('=INDEX(SPLIT("a,b,c",","),1,2)')).toBe("a") // Sheets: "b"
		expect(evaluate('=INDEX(SPLIT("a,b,c",","),2)')).toBe("b")
	})

	it("a scalar text function silently comma-joins an array instead of mapping", () => {
		expect(evaluate('=LEN(SPLIT("a,b",","))')).toBe(3) // Sheets: 1
		expect(evaluate("=TRIM(A1:A2)", { A1: " x ", A2: " y " })).toBe("x , y")
		expect(evaluate("=UPPER(A1:A2)", { A1: "a", A2: "b" })).toBe("A,B")
	})

	it("IF given a range tests the array object, so the condition is always true", () => {
		// A non-empty JavaScript array is truthy whatever it holds, so the FALSE
		// branch is unreachable for any range condition.
		expect(evaluate("=IF(A1:A2,1,2)", { A1: 0, A2: 0 })).toBe(1) // Sheets: 2
	})

	it("range-aware functions do flatten correctly", () => {
		expect(evaluate("=AND(A1:A3)", { A1: 1, A2: 0, A3: 1 })).toBe(false)
		expect(evaluate("=OR(A1:A3)", { A1: 0, A2: 0, A3: 1 })).toBe(true)
		expect(evaluate("=CONCAT(A1:A3)", { A1: "a", A2: "b", A3: "c" })).toBe("abc")
		expect(evaluate('=TEXTJOIN(",",TRUE,A1:A3)', { A1: "a", A2: "b", A3: "c" })).toBe("a,b,c")
	})
})

// ── 14. Error literals ────────────────────────────────────────────────────────

describe("error literals", () => {
	// The tokenizer's error scan stops at `/`, so two of the six Excel error
	// values cannot be written into a formula at all. Any test of ISNA, IFNA or
	// #DIV/0! handling has to PRODUCE the error instead.
	it("#N/A and #DIV/0! cannot be typed as literals", () => {
		expect(evaluate("=#N/A")).toBe("#N")
		expect(evaluate("=#DIV/0!")).toBe("#DIV")
		expect(evaluate("=ISNA(#N/A)")).toBe(false) // the literal never becomes #N/A
	})

	it("the error values that do lex round-trip", () => {
		for (const err of ["#VALUE!", "#REF!", "#NAME?", "#NUM!"]) {
			expect(evaluate(`=${err}`), err).toBe(err)
			expect(evaluate(`=ISERROR(${err})`), err).toBe(true)
		}
	})

	it("NA() and a division produce the two unlexable errors", () => {
		expect(evaluate("=NA()")).toBe("#N/A")
		expect(evaluate("=ISNA(NA())")).toBe(true)
		expect(evaluate("=1/0")).toBe("#DIV/0!")
		expect(evaluate("=ISERR(1/0)")).toBe(true)
	})
})
