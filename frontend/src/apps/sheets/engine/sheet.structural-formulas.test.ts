// What happens to formula TEXT when the grid moves underneath it.
//
// Three separate mechanisms are covered here, because they fail differently:
//
//   * `adjustFormula` — a regex over raw formula text. Drives copy, cut, paste,
//     fill down and fill right (clipboard.js and SheetEditor).
//   * `renameSheetInFormula` — the same class of regex, driven by sheet rename.
//   * row / column insert and delete in sheet.js — which call NEITHER, so the
//     formula text is left pointing at addresses the data has vacated.
//
// Reference forms are exercised relative, absolute and mixed throughout,
// because `$` anchoring is where the engine contradicts itself: formula-adjust
// implements it correctly and the evaluator cannot read it back.
//
// Tests marked DEFECT assert today's wrong behaviour and name the spreadsheet
// answer, so a fix turns this file red — same contract as a `known-failure`
// corpus fixture.

import { beforeEach, describe, expect, it } from "vitest"

import { createClipboard } from "./clipboard.js"
import { adjustFormula, renameSheetInFormula } from "./formula-adjust.js"
import { createSheet } from "./sheet.js"

describe("adjustFormula — relative, absolute and mixed", () => {
	it("shifts a relative reference on both axes", () => {
		expect(adjustFormula("=A1+1", 1, 0)).toBe("=A2+1")
		expect(adjustFormula("=A1+1", 0, 1)).toBe("=B1+1")
		expect(adjustFormula("=A1+1", 2, 3)).toBe("=D3+1")
	})

	it("pins a fully anchored reference", () => {
		expect(adjustFormula("=$A$1", 5, 5)).toBe("=$A$1")
	})

	it("pins only the anchored axis of a mixed reference", () => {
		expect(adjustFormula("=A$1", 1, 1)).toBe("=B$1")
		expect(adjustFormula("=$A1", 1, 1)).toBe("=$A2")
	})

	it("shifts both endpoints of a range", () => {
		expect(adjustFormula("=SUM(A1:A3)", 2, 0)).toBe("=SUM(A3:A5)")
		expect(adjustFormula("=SUM($A$1:$A$3)", 2, 0)).toBe("=SUM($A$1:$A$3)")
		expect(adjustFormula("=SUM(A$1:A$3)", 2, 1)).toBe("=SUM(B$1:B$3)")
	})

	it("shifts the cell part of a cross-sheet reference and leaves the sheet name", () => {
		expect(adjustFormula("=Sheet2!A1", 1, 0)).toBe("=Sheet2!A2")
	})

	it("is a no-op for a zero offset and for non-formulas", () => {
		expect(adjustFormula("=A1", 0, 0)).toBe("=A1")
		expect(adjustFormula("hello A1", 1, 1)).toBe("hello A1")
	})
})

describe("adjustFormula — text it should not have touched", () => {
	it("rewrites cell-shaped text inside a string literal — DEFECT", () => {
		// The regex has no notion of string literals. A quarter label, a lookup
		// key or any text that looks like a reference is silently edited when
		// the formula is filled or pasted.
		// Excel and Sheets: =A2&"Q1". Defect: structural-edit.
		expect(adjustFormula('=A1&"Q1"', 1, 0)).toBe('=A2&"Q2"')
		expect(adjustFormula('="see A1"', 1, 0)).toBe('="see A2"')
	})

	it("corrupts function names that end in digits — DEFECT", () => {
		// LOG10 and ATAN2 are both built-ins of this engine. A column fill turns
		// LOG10 into LOH10; a row fill turns ATAN2 into ATAN3. Both are then
		// unknown functions.
		// Excel and Sheets: the function name is untouched. Defect: structural-edit.
		expect(adjustFormula("=LOG10(A1)", 0, 1)).toBe("=LOH10(B1)")
		expect(adjustFormula("=ATAN2(A1,B1)", 1, 0)).toBe("=ATAN3(A2,B2)")
	})

	it("rewrites a quoted sheet name that contains digits — DEFECT", () => {
		// The `(?!!)` lookahead only protects an unquoted name sitting directly
		// before the `!`. Inside quotes the name is just text, so 'Q1 Data'
		// becomes 'Q2 Data' and the reference points at a sheet that does not
		// exist.
		// Excel and Sheets: ='Q1 Data'!A6. Defect: structural-edit.
		expect(adjustFormula("='Q1 Data'!A5", 1, 0)).toBe("='Q2 Data'!A6")
	})

	it("clamps a reference that shifts off the grid instead of breaking it — DEFECT", () => {
		// Excel and Sheets turn a reference pushed past row 1 or column A into
		// #REF!. Clamping keeps a valid-looking address, so =B2+A1 shifted up and
		// left collapses two distinct references onto the same cell.
		// Excel and Sheets: =A1+#REF!. Defect: structural-edit.
		expect(adjustFormula("=A1", -1, 0)).toBe("=A1")
		expect(adjustFormula("=A1", 0, -1)).toBe("=A1")
		expect(adjustFormula("=B2+A1", -1, -1)).toBe("=A1+A1")
	})
})

describe("copy and paste", () => {
	let sheet: ReturnType<typeof createSheet>
	let clipboard: ReturnType<typeof createClipboard>

	beforeEach(() => {
		sheet = createSheet({})
		clipboard = createClipboard({ sheet })
		sheet.setCell("A1", 10)
		sheet.setCell("A2", 20)
		sheet.setCell("A3", 30)
	})

	it("shifts a relative reference and recalculates at the destination", () => {
		sheet.setCell("B1", "=A1*2")
		clipboard.copy({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2")
		expect(sheet.getCell("B2")).toBe("=A2*2")
		expect(sheet.getCellValue("B2")).toBe(40)
	})

	it("keeps an absolute reference pinned but cannot evaluate it — DEFECT", () => {
		// The pin itself is correct: $A$1 survives the paste, which is the whole
		// point of the syntax. The evaluator then reports #NAME? for it, so
		// anchoring a reference is exactly the thing a user must not do.
		// Excel and Sheets: 20. Defect: reference-resolution.
		sheet.setCell("B1", "=$A$1*2")
		clipboard.copy({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2")
		expect(sheet.getCell("B2")).toBe("=$A$1*2")
		expect(sheet.getCellValue("B2")).toBe("#NAME?")
	})

	it("shifts only the unanchored axis of a mixed reference", () => {
		sheet.setCell("B1", "=$A1*2")
		clipboard.copy({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B3")
		expect(sheet.getCell("B3")).toBe("=$A3*2")
		expect(sheet.getCellValue("B3")).toBe(60)
	})

	it("pins the row of a row-anchored reference but cannot evaluate it — DEFECT", () => {
		// Excel and Sheets: 20. Defect: reference-resolution.
		sheet.setCell("B1", "=A$1*2")
		clipboard.copy({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B3")
		expect(sheet.getCell("B3")).toBe("=A$1*2")
		expect(sheet.getCellValue("B3")).toBe("#NAME?")
	})

	it("tiles a single copied formula across a wider destination", () => {
		sheet.setCell("B1", 2)
		sheet.setCell("C1", 3)
		sheet.setCell("A5", "=A1*10")
		clipboard.copy({ r0: 4, c0: 0, r1: 4, c1: 0 })
		clipboard.paste("B5", null, "all", { r0: 4, c0: 1, r1: 4, c1: 2 })
		expect(sheet.getCell("B5")).toBe("=B1*10")
		expect(sheet.getCell("C5")).toBe("=C1*10")
	})

	it("creates a self-reference when a paste pushes a reference off the grid — DEFECT", () => {
		// B2 holds =B1+A2. Pasting it one column left clamps A2 (already in
		// column A) instead of breaking it, so the formula lands in A2 reading
		// A2 and the engine reports a cycle the user never wrote.
		// Excel and Sheets: =A1+#REF! -> #REF!. Defect: structural-edit.
		sheet.setCell("B1", 5)
		sheet.setCell("B2", "=B1+A2")
		clipboard.copy({ r0: 1, c0: 1, r1: 1, c1: 1 })
		clipboard.paste("A2")
		expect(sheet.getCell("A2")).toBe("=A1+A2")
		expect(sheet.getCellValue("A2")).toBe("#CIRCULAR!")
	})

	it("paste-values drops the formula and keeps the computed number", () => {
		sheet.setCell("B1", "=A1*2")
		clipboard.copy({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2", null, "values")
		expect(sheet.getCellValue("B2")).toBe(20)
	})
})

describe("cut and paste", () => {
	it("vacates the source cell", () => {
		const sheet = createSheet({})
		const clipboard = createClipboard({ sheet })
		sheet.setCell("A1", 10)
		sheet.setCell("B1", 7)
		clipboard.cut({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2")
		expect(sheet.getCell("B1")).toBe("")
		expect(sheet.getCellValue("B2")).toBe(7)
	})

	it("re-relativises a moved formula the way a copy would — DEFECT", () => {
		// A cut moves a formula; it does not re-anchor it. Excel and Sheets keep
		// =A1*2 pointing at A1 after the move, so the value follows the formula.
		// clipboard.js runs the same adjustFormula for cut as for copy, so the
		// moved formula silently starts reading a different row.
		// Excel and Sheets: 20. Defect: structural-edit.
		const sheet = createSheet({})
		const clipboard = createClipboard({ sheet })
		sheet.setCell("A1", 10)
		sheet.setCell("A2", 20)
		sheet.setCell("B1", "=A1*2")

		clipboard.cut({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2")
		expect(sheet.getCell("B2")).toBe("=A2*2")
		expect(sheet.getCellValue("B2")).toBe(40)
	})

	it("leaves an anchored reference alone, matching a spreadsheet by accident", () => {
		// A cut must not shift references, and an anchored one is not shifted —
		// but only because it is anchored, not because the cut was honoured.
		const sheet = createSheet({})
		const clipboard = createClipboard({ sheet })
		sheet.setCell("A1", 10)
		sheet.setCell("B1", "=$A$1*2")
		clipboard.cut({ r0: 0, c0: 1, r1: 0, c1: 1 })
		clipboard.paste("B2")
		expect(sheet.getCell("B2")).toBe("=$A$1*2")
	})
})

describe("fill down and fill right", () => {
	// SheetEditor implements both as adjustFormula(src, dr, 0) / (0, dc)
	// followed by a write, so the primitive is what decides correctness.
	function fillDown(sheet: ReturnType<typeof createSheet>, srcId: string, targets: string[]) {
		const src = sheet.getCell(srcId)
		const srcRow = parseInt(srcId.replace(/^[A-Z]+/, ""), 10)
		for (const id of targets) {
			const row = parseInt(id.replace(/^[A-Z]+/, ""), 10)
			sheet.setCell(id, adjustFormula(src, row - srcRow, 0))
		}
	}

	it("fills a relative formula down a column", () => {
		const sheet = createSheet({})
		for (let r = 1; r <= 4; r++) sheet.setCell(`A${r}`, r * 10)
		sheet.setCell("B1", "=A1*2")
		fillDown(sheet, "B1", ["B2", "B3", "B4"])
		expect([2, 3, 4].map((r) => sheet.getCellValue(`B${r}`))).toEqual([40, 60, 80])
	})

	it("fills a range formula down a column", () => {
		const sheet = createSheet({})
		for (let r = 1; r <= 6; r++) sheet.setCell(`A${r}`, 1)
		sheet.setCell("B1", "=SUM(A1:A2)")
		fillDown(sheet, "B1", ["B2", "B3"])
		expect(sheet.getCell("B3")).toBe("=SUM(A3:A4)")
		expect(sheet.getCellValue("B3")).toBe(2)
	})

	it("fills a relative formula right along a row", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("B1", 2)
		sheet.setCell("C1", 3)
		sheet.setCell("A2", "=A1*10")
		sheet.setCell("B2", adjustFormula(sheet.getCell("A2"), 0, 1))
		sheet.setCell("C2", adjustFormula(sheet.getCell("A2"), 0, 2))
		expect([sheet.getCellValue("B2"), sheet.getCellValue("C2")]).toEqual([20, 30])
	})

	it("keeps an anchored row while filling down, but the result is unreadable — DEFECT", () => {
		// This is the canonical use of `$`: a fill-down column that keeps
		// multiplying by one fixed rate cell. The text stays pinned correctly and
		// every filled cell reports #NAME?.
		// Excel and Sheets: 20, 40, 60. Defect: reference-resolution.
		const sheet = createSheet({})
		sheet.setCell("A1", 2)
		for (let r = 1; r <= 3; r++) sheet.setCell(`B${r}`, r * 10)
		sheet.setCell("C1", "=B1*A$1")
		fillDown(sheet, "C1", ["C2", "C3"])
		expect([sheet.getCell("C2"), sheet.getCell("C3")]).toEqual(["=B2*A$1", "=B3*A$1"])
		expect([1, 2, 3].map((r) => sheet.getCellValue(`C${r}`))).toEqual(["#NAME?", "#NAME?", "#NAME?"])
	})
})

describe("row and column edits do not touch formula text", () => {
	// The corpus fixtures in workbooks/structural-edits.json assert the wrong
	// VALUES this produces. These assert the single root cause: sheet.js moves
	// cell ids and rebuilds the dependency graph, but never calls adjustFormula.

	it("leaves the formula unchanged after a row insertion", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 10)
		sheet.setCell("A2", 20)
		sheet.setCell("B1", "=A1+A2")
		sheet.insertRow(0)
		expect(sheet.getCell("B2")).toBe("=A1+A2") // Excel and Sheets: =A2+A3
	})

	it("leaves the formula unchanged after a row deletion", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 1)
		sheet.setCell("A2", 10)
		sheet.setCell("A3", 20)
		sheet.setCell("C5", "=A2+A3")
		sheet.deleteRow(0)
		expect(sheet.getCell("C4")).toBe("=A2+A3") // Excel and Sheets: =A1+A2
	})

	it("leaves the formula unchanged after a column insertion", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 10)
		sheet.setCell("B1", 20)
		sheet.setCell("C1", "=A1+B1")
		sheet.insertCol(0)
		expect(sheet.getCell("D1")).toBe("=A1+B1") // Excel and Sheets: =B1+C1
	})

	it("turns a formula into a self-reference after a column deletion", () => {
		const sheet = createSheet({})
		sheet.setCell("A1", 10)
		sheet.setCell("B1", 20)
		sheet.setCell("C1", "=B1*2")
		sheet.deleteCol(0)
		expect(sheet.getCell("B1")).toBe("=B1*2") // Excel and Sheets: =A1*2
		expect(sheet.getCellValue("B1")).toBe("#CIRCULAR!")
	})

	it("leaves an anchored reference unchanged too", () => {
		// Anchored references do move with a row insertion in Excel: $A$2 becomes
		// $A$3. Nothing rewrites them here either.
		const sheet = createSheet({})
		sheet.setCell("A2", 20)
		sheet.setCell("B1", "=$A$2")
		sheet.insertRow(0)
		expect(sheet.getCell("B2")).toBe("=$A$2") // Excel and Sheets: =$A$3
	})
})

describe("renameSheetInFormula", () => {
	it("rewrites an unquoted prefix", () => {
		expect(renameSheetInFormula("=Sheet1!A1", "Sheet1", "Data")).toBe("=Data!A1")
	})

	it("rewrites a quoted prefix and drops the quotes when they are unnecessary", () => {
		expect(renameSheetInFormula("='My Sheet'!A1", "My Sheet", "Data")).toBe("=Data!A1")
	})

	it("adds quotes when the new name needs them", () => {
		expect(renameSheetInFormula("=Sheet1!A1", "Sheet1", "My Data")).toBe("='My Data'!A1")
	})

	it("does not match a longer sheet name that starts with the old one", () => {
		expect(renameSheetInFormula("=Sheet1!A1+Sheet10!B1", "Sheet1", "X")).toBe("=X!A1+Sheet10!B1")
	})

	it("does not match a longer sheet name that ends with the old one", () => {
		expect(renameSheetInFormula("=MySheet1!A1", "Sheet1", "Data")).toBe("=MySheet1!A1")
	})

	it("rewrites the sheet name inside a string literal — DEFECT", () => {
		// Same blind spot as adjustFormula: a regex over raw text edits string
		// content. Any label or key that contains "<sheet name>!" is rewritten
		// by a rename the user made for unrelated reasons.
		// Excel and Sheets: ="Sheet1!A1". Defect: structural-edit.
		expect(renameSheetInFormula('="Sheet1!A1"', "Sheet1", "Data")).toBe('="Data!A1"')
	})

	it("keeps cross-sheet dependents working after a rename", () => {
		const sheet = createSheet({})
		sheet.addSheet("Sheet2")
		sheet.setCell("A1", 5, "Sheet2")
		sheet.setCell("A1", "=Sheet2!A1+1", "Sheet1")
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(6)

		sheet.renameSheet("Sheet2", "Data")
		expect(sheet.getCell("A1", "Sheet1")).toBe("=Data!A1+1")

		sheet.setCell("A1", 50, "Data")
		expect(sheet.getCellValue("A1", "Sheet1")).toBe(51)
	})
})

describe("named-range rename and delete", () => {
	// The named-range store owns the bindings; formulas hold the name as text.
	// Nothing rewrites formula text when a binding is renamed, and nothing tells
	// the sheet engine to recompute when one is removed.
	function workbook() {
		const sheet = createSheet({})
		let names: Record<string, { start: string; end: string }> = { REV: { start: "A1", end: "A1" } }
		sheet.setNamedRangeResolver((name: string) => {
			const entry = names[String(name).toUpperCase()]
			return entry ? { sheet: null, ...entry } : null
		})
		sheet.setCell("A1", 5)
		sheet.setCell("B1", "=REV*2")
		return { sheet, setNames: (next: typeof names) => (names = next) }
	}

	it("breaks every formula that used the old name — DEFECT", () => {
		// Excel and Sheets rewrite =REV*2 to =INCOME*2 when the defined name is
		// renamed, precisely so a rename is safe. Here the formula keeps the dead
		// name and the cell goes to #NAME?.
		// Excel and Sheets: 10. Defect: unsupported-feature.
		const { sheet, setNames } = workbook()
		expect(sheet.getCellValue("B1")).toBe(10)

		setNames({ INCOME: { start: "A1", end: "A1" } })
		sheet.invalidateMemo()
		expect(sheet.getCellValue("B1")).toBe("#NAME?")
	})

	it("reports #NAME? after the binding is deleted, matching a spreadsheet", () => {
		const { sheet, setNames } = workbook()
		expect(sheet.getCellValue("B1")).toBe(10)

		setNames({})
		sheet.invalidateMemo()
		expect(sheet.getCellValue("B1")).toBe("#NAME?")
	})

	it("keeps serving the deleted name's last value until the cache is dropped — DEFECT", () => {
		// Deleting a binding is a mutation the sheet engine is never told about,
		// so without a manual invalidateMemo the formula still shows its old
		// result. Defect: cache-invalidation.
		const { sheet, setNames } = workbook()
		expect(sheet.getCellValue("B1")).toBe(10)

		setNames({})
		expect(sheet.getCellValue("B1")).toBe(10) // Excel and Sheets: #NAME?
	})
})
