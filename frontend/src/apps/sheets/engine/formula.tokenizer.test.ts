// Exact token-stream assertions for `tokenize`.
//
// The corpus can only observe the value a formula evaluates to, which hides
// which tokens were produced and which were silently dropped. These tests pin
// the token stream itself, so a tokenizer change that happens to leave the
// evaluated result intact still shows up here.
//
// Where the stream is wrong, the assertion records what the tokenizer really
// emits and the comment says what a spreadsheet would need instead. See
// `test-corpus/syntax.json` for the matching evaluated-value fixtures.

import { describe, expect, it } from "vitest"

import { tokenize } from "./formula.js"

type Token = Record<string, unknown>

function toks(src: string): Token[] {
	return tokenize(src) as Token[]
}

describe("tokenize: numbers", () => {
	it("integer", () => {
		expect(toks("42")).toEqual([{ t: "NUM", v: 42 }])
	})

	it("decimal", () => {
		expect(toks("3.5")).toEqual([{ t: "NUM", v: 3.5 }])
	})

	it("leading dot", () => {
		expect(toks(".5")).toEqual([{ t: "NUM", v: 0.5 }])
	})

	it("scientific notation, lowercase e", () => {
		expect(toks("1.5e3")).toEqual([{ t: "NUM", v: 1500 }])
	})

	it("scientific notation, negative exponent", () => {
		expect(toks("2e-2")).toEqual([{ t: "NUM", v: 0.02 }])
	})

	it("scientific notation, uppercase E and explicit plus", () => {
		expect(toks("1E+3")).toEqual([{ t: "NUM", v: 1000 }])
	})

	// A second exponent is not part of any numeric literal. The scanner stops
	// after the first one and the remainder becomes a reference token that no
	// parser branch ever reads.
	it("stops after the first exponent and leaves the rest as a reference", () => {
		expect(toks("1e5e5")).toEqual([
			{ t: "NUM", v: 100000 },
			{ t: "REF", v: "E5" },
		])
	})

	// `[0-9.]` accepts any mix of digits and dots; parseFloat then truncates.
	it("accepts a second decimal point in one literal", () => {
		expect(toks("1.2.3")).toEqual([{ t: "NUM", v: 1.2 }])
	})
})

describe("tokenize: strings", () => {
	it("plain string", () => {
		expect(toks('"hi"')).toEqual([{ t: "STR", v: "hi" }])
	})

	it("empty string", () => {
		expect(toks('""')).toEqual([{ t: "STR", v: "" }])
	})

	it("backslash-escaped quote", () => {
		expect(toks('"a\\"b"')).toEqual([{ t: "STR", v: 'a"b' }])
	})

	it("escaped backslash collapses to one", () => {
		expect(toks('"a\\\\"')).toEqual([{ t: "STR", v: "a\\" }])
	})

	// Regex-bearing functions receive the pattern verbatim, so a backslash in
	// front of anything other than `"` or `\` must survive.
	it("preserves a backslash that is not an escape", () => {
		expect(toks('"\\d+"')).toEqual([{ t: "STR", v: "\\d+" }])
	})

	// Doubling is the escape Excel and Sheets define; `"a""b"` is one string
	// holding `a"b`. The tokenizer instead closes and reopens, which is why the
	// parser silently returns only the first half.
	it("splits a doubled quote into two strings instead of escaping it", () => {
		expect(toks('"a""b"')).toEqual([
			{ t: "STR", v: "a" },
			{ t: "STR", v: "b" },
		])
	})

	it("an unterminated string still closes at end of input", () => {
		expect(toks('"abc')).toEqual([{ t: "STR", v: "abc" }])
	})
})

describe("tokenize: booleans", () => {
	it("TRUE", () => {
		expect(toks("TRUE")).toEqual([{ t: "BOOL", v: true }])
	})

	it("lowercase false", () => {
		expect(toks("false")).toEqual([{ t: "BOOL", v: false }])
	})

	// Followed by `(` the keyword must become a call, or the parens would be a
	// syntax error on their own.
	it("TRUE() is a function call, not a literal", () => {
		expect(toks("TRUE()")).toEqual([{ t: "FN", v: "TRUE" }, { t: "LP" }, { t: "RP" }])
	})
})

describe("tokenize: error literals", () => {
	it("#REF!", () => {
		expect(toks("#REF!")).toEqual([{ t: "ERR", v: "#REF!" }])
	})

	it("#VALUE!", () => {
		expect(toks("#VALUE!")).toEqual([{ t: "ERR", v: "#VALUE!" }])
	})

	it("#NAME?", () => {
		expect(toks("#NAME?")).toEqual([{ t: "ERR", v: "#NAME?" }])
	})

	// `/` terminates the error scan, so the two error literals that contain one
	// cannot be written down. Both should be a single ERR token.
	it("#N/A breaks into three tokens", () => {
		expect(toks("#N/A")).toEqual([
			{ t: "ERR", v: "#N" },
			{ t: "OP", v: "/" },
			{ t: "COLREF", v: "A" },
		])
	})

	it("#DIV/0! breaks into three tokens", () => {
		expect(toks("#DIV/0!")).toEqual([
			{ t: "ERR", v: "#DIV" },
			{ t: "OP", v: "/" },
			{ t: "NUM", v: 0 },
		])
	})
})

describe("tokenize: function names", () => {
	it("uppercases the name", () => {
		expect(toks("sum(1)")).toEqual([
			{ t: "FN", v: "SUM" },
			{ t: "LP" },
			{ t: "NUM", v: 1 },
			{ t: "RP" },
		])
	})

	it("whitespace between name and paren still yields a call", () => {
		expect(toks("IF (1)")).toEqual([
			{ t: "FN", v: "IF" },
			{ t: "LP" },
			{ t: "NUM", v: 1 },
			{ t: "RP" },
		])
	})

	// An unknown name followed by `(` is still an FN token; the parser turns it
	// into #NAME? only after it has consumed the argument list.
	it("an unknown name before a paren is still a call token", () => {
		expect(toks("NOPE(1)")).toEqual([
			{ t: "FN", v: "NOPE" },
			{ t: "LP" },
			{ t: "NUM", v: 1 },
			{ t: "RP" },
		])
	})
})

describe("tokenize: names and references", () => {
	it("A1 reference", () => {
		expect(toks("A1")).toEqual([{ t: "REF", v: "A1" }])
	})

	it("lowercase reference is upcased", () => {
		expect(toks("a1")).toEqual([{ t: "REF", v: "A1" }])
	})

	it("whole-column reference", () => {
		expect(toks("A:A")).toEqual([
			{ t: "COLREF", v: "A" },
			{ t: "COLON" },
			{ t: "COLREF", v: "A" },
		])
	})

	it("multi-column range", () => {
		expect(toks("A:B")).toEqual([
			{ t: "COLREF", v: "A" },
			{ t: "COLON" },
			{ t: "COLREF", v: "B" },
		])
	})

	it("same-sheet range", () => {
		expect(toks("A1:B2")).toEqual([
			{ t: "REF", v: "A1" },
			{ t: "COLON" },
			{ t: "REF", v: "B2" },
		])
	})

	// Nothing distinguishes a named range from a column letter at this stage;
	// the parser has to try named-range resolution on every bare COLREF.
	it("an all-letter name is indistinguishable from a column", () => {
		expect(toks("Revenue")).toEqual([{ t: "COLREF", v: "REVENUE" }])
	})

	// Equally, nothing bounds the column part at XFD, so a name shaped like
	// letters-then-digits is read as a cell that does not exist.
	it("a name shaped like a cell is indistinguishable from a reference", () => {
		expect(toks("NOSUCHNAME1")).toEqual([{ t: "REF", v: "NOSUCHNAME1" }])
	})

	it("an identifier that is neither shape becomes a NAME", () => {
		expect(toks("my_range")).toEqual([{ t: "NAME", v: "MY_RANGE" }])
	})
})

describe("tokenize: absolute references", () => {
	// `$` has no branch of its own. It is legal inside an identifier, so where
	// it lands decides whether the reference survives.
	it("a leading $ is absorbed and the reference survives", () => {
		expect(toks("$A1")).toEqual([{ t: "REF", v: "A1" }])
	})

	it("$ before the row turns the reference into a name", () => {
		expect(toks("A$1")).toEqual([{ t: "NAME", v: "A$1" }])
	})

	it("a fully absolute reference turns into a name", () => {
		expect(toks("$A$1")).toEqual([{ t: "NAME", v: "A$1" }])
	})

	it("a mixed range loses only the endpoint that pins its row", () => {
		expect(toks("A1:$B$2")).toEqual([
			{ t: "REF", v: "A1" },
			{ t: "COLON" },
			{ t: "NAME", v: "B$2" },
		])
	})

	it("an absolute whole-column range still reads as columns", () => {
		expect(toks("$A:$A")).toEqual([
			{ t: "COLREF", v: "A" },
			{ t: "COLON" },
			{ t: "COLREF", v: "A" },
		])
	})
})

describe("tokenize: sheet references", () => {
	it("cross-sheet cell", () => {
		expect(toks("Sheet2!A1")).toEqual([{ t: "SHEETREF", sheet: "Sheet2", v: "A1" }])
	})

	// Only the start of a cross-sheet range carries the sheet; the endpoint is a
	// plain reference the parser resolves against the same sheet.
	it("cross-sheet range qualifies only its start", () => {
		expect(toks("Sheet2!A1:B2")).toEqual([
			{ t: "SHEETREF", sheet: "Sheet2", v: "A1" },
			{ t: "COLON" },
			{ t: "REF", v: "B2" },
		])
	})

	it("cross-sheet whole column", () => {
		expect(toks("Sheet2!A:A")).toEqual([
			{ t: "SHEETCOL", sheet: "Sheet2", v: "A" },
			{ t: "COLON" },
			{ t: "COLREF", v: "A" },
		])
	})

	it("quoted sheet name with a space", () => {
		expect(toks("'My Sheet'!A1")).toEqual([{ t: "SHEETREF", sheet: "My Sheet", v: "A1" }])
	})

	it("doubled apostrophe is one literal apostrophe", () => {
		expect(toks("'O''Brien'!A1")).toEqual([{ t: "SHEETREF", sheet: "O'Brien", v: "A1" }])
	})

	it("quoted sheet name that starts with a digit", () => {
		expect(toks("'2024'!A1")).toEqual([{ t: "SHEETREF", sheet: "2024", v: "A1" }])
	})

	it("spaces before the bang are absorbed into the sheet name", () => {
		expect(toks("Sheet2 !A1")).toEqual([{ t: "SHEETREF", sheet: "Sheet2", v: "A1" }])
	})

	// After `!` only `[A-Za-z0-9]` is accepted, so a pinned cross-sheet cell
	// cannot be expressed at all.
	it("a $ after the bang degrades the reference to #REF!", () => {
		expect(toks("Sheet2!$A$1")).toEqual([
			{ t: "ERR", v: "#REF!" },
			{ t: "NAME", v: "A$1" },
		])
	})

	it("a bang with nothing usable after it is #REF!", () => {
		expect(toks("Sheet2!1A")).toEqual([{ t: "ERR", v: "#REF!" }])
	})

	it("an unterminated quoted sheet name is #REF!", () => {
		expect(toks("'unterminated")).toEqual([{ t: "ERR", v: "#REF!" }])
	})

	it("a quoted name not followed by a bang is #REF!", () => {
		expect(toks("'Sheet2'A1")).toEqual([
			{ t: "ERR", v: "#REF!" },
			{ t: "REF", v: "A1" },
		])
	})

	// Excel forbids `!` inside a sheet name; the scanner reads to the closing
	// apostrophe and accepts it anyway.
	it("accepts a bang inside a quoted sheet name", () => {
		expect(toks("'a!b'!A1")).toEqual([{ t: "SHEETREF", sheet: "a!b", v: "A1" }])
	})

	// The space-swallowing rule only fires when the next non-space is `!`, so an
	// unquoted multi-word sheet name splits into unrelated tokens.
	it("an unquoted sheet name with a space splits apart", () => {
		expect(toks("My Sheet!A1")).toEqual([
			{ t: "COLREF", v: "MY" },
			{ t: "SHEETREF", sheet: "Sheet", v: "A1" },
		])
	})
})

describe("tokenize: separators and operators", () => {
	it("comma", () => {
		expect(toks("1,2")).toEqual([{ t: "NUM", v: 1 }, { t: "COMMA" }, { t: "NUM", v: 2 }])
	})

	it("semicolon is the same token as comma", () => {
		expect(toks("1;2")).toEqual([{ t: "NUM", v: 1 }, { t: "COMMA" }, { t: "NUM", v: 2 }])
	})

	it("parentheses", () => {
		expect(toks("()")).toEqual([{ t: "LP" }, { t: "RP" }])
	})

	it("colon", () => {
		expect(toks(":")).toEqual([{ t: "COLON" }])
	})

	it("every operator, single and two character", () => {
		expect(toks("+ - * / ^ & % = <> > < >= <=")).toEqual([
			{ t: "OP", v: "+" },
			{ t: "OP", v: "-" },
			{ t: "OP", v: "*" },
			{ t: "OP", v: "/" },
			{ t: "OP", v: "^" },
			{ t: "OP", v: "&" },
			{ t: "OP", v: "%" },
			{ t: "OP", v: "=" },
			{ t: "OP", v: "<>" },
			{ t: "OP", v: ">" },
			{ t: "OP", v: "<" },
			{ t: "OP", v: ">=" },
			{ t: "OP", v: "<=" },
		])
	})

	it("two-character operators win over their prefixes", () => {
		expect(toks(">=<=<>")).toEqual([
			{ t: "OP", v: ">=" },
			{ t: "OP", v: "<=" },
			{ t: "OP", v: "<>" },
		])
	})

	it("percent is a trailing operator token", () => {
		expect(toks("1%")).toEqual([{ t: "NUM", v: 1 }, { t: "OP", v: "%" }])
	})
})

describe("tokenize: characters with no branch", () => {
	// The final branch consumes the character and pushes nothing, so unknown
	// punctuation leaves no trace for the parser to reject.
	it.each(["@", "~", "!", "?", "\\", "{", "}", "[", "]", "|", "$"])(
		"drops %j entirely",
		(ch) => {
			expect(toks(ch)).toEqual([])
		},
	)

	it("drops unknown punctuation from the middle of an expression", () => {
		expect(toks("1@2")).toEqual([{ t: "NUM", v: 1 }, { t: "NUM", v: 2 }])
	})

	it("whitespace-only input yields no tokens", () => {
		expect(toks("   \t\n ")).toEqual([])
	})

	it("empty input yields no tokens", () => {
		expect(toks("")).toEqual([])
	})
})

describe("tokenize: whitespace at legal boundaries", () => {
	const expected = [
		{ t: "FN", v: "SUM" },
		{ t: "LP" },
		{ t: "REF", v: "A1" },
		{ t: "COLON" },
		{ t: "REF", v: "A3" },
		{ t: "COMMA" },
		{ t: "NUM", v: 2 },
		{ t: "RP" },
	]

	it("no whitespace", () => {
		expect(toks("SUM(A1:A3,2)")).toEqual(expected)
	})

	it("whitespace at every boundary", () => {
		expect(toks(" SUM ( A1 : A3 , 2 ) ")).toEqual(expected)
	})
})
