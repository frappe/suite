// Corpus runner for the formula-engine test campaign.
//
// Every JSON fixture under `test-corpus/` runs through this one file. Adding a
// case means adding JSON, not a test function — that is what lets several
// agents extend the suite without touching each other's files.
//
// A fixture with `status: "known-failure"` documents a defect the engine still
// has. The runner asserts the wrong answer is STILL produced, so fixing the
// engine breaks this suite and forces the corpus to be updated in the same
// change. See `test-corpus/README.md`.

import { describe, expect, it } from "vitest"

import {
	DirectFixture,
	WorkbookFixture,
	loadDirect,
	loadWorkbooks,
	matches,
	matchesAll,
	runDirect,
	runWorkbook,
} from "./test-corpus/harness"

const DIRECT_SOURCES = ["syntax.json", "arithmetic.json", "functions", "compatibility"]
const WORKBOOK_SOURCES = ["workbooks"]

const direct = loadDirect(...DIRECT_SOURCES)
const workbooks = loadWorkbooks(...WORKBOOK_SOURCES)

function byCategory<T extends { category: string }>(list: T[]): Map<string, T[]> {
	const out = new Map<string, T[]>()
	for (const fx of list) {
		const bucket = out.get(fx.category) ?? []
		bucket.push(fx)
		out.set(fx.category, bucket)
	}
	return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function checkDirect(fx: DirectFixture) {
	const actual = runDirect(fx)
	if (fx.status === "known-failure") {
		expect(
			matches(actual, fx.expected, fx.tolerance),
			`${fx.id} now matches the spreadsheet-correct value ${JSON.stringify(fx.expected)} — ` +
				`the defect looks fixed, so flip status to "pass" and drop "actual".`,
		).toBe(false)
		if ("actual" in fx)
			expect(
				matches(actual, fx.actual),
				`${fx.id}: recorded actual ${JSON.stringify(fx.actual)} drifted to ${JSON.stringify(actual)}`,
			).toBe(true)
		return
	}
	if (fx.tolerance != null && typeof fx.expected === "number") {
		expect(actual).toBeCloseTo(fx.expected as number, -Math.log10(fx.tolerance))
	} else {
		expect(actual, `${fx.id}: ${fx.formula}`).toEqual(fx.expected)
	}
}

function checkWorkbook(fx: WorkbookFixture) {
	const actual = runWorkbook(fx)
	if (fx.status === "known-failure") {
		expect(
			matchesAll(actual, fx.expected, fx.tolerance),
			`${fx.id} now matches the spreadsheet-correct values — flip status to "pass".`,
		).toBe(false)
		if ("actual" in fx)
			expect(
				matchesAll(actual, fx.actual as Record<string, unknown>),
				`${fx.id}: recorded actual ${JSON.stringify(fx.actual)} drifted to ${JSON.stringify(actual)}`,
			).toBe(true)
		return
	}
	expect(actual, fx.id).toEqual(fx.expected)
}

describe("corpus: direct formulas", () => {
	it("loaded at least one fixture", () => {
		expect(direct.length).toBeGreaterThan(0)
	})
	for (const [category, cases] of byCategory(direct)) {
		describe(category, () => {
			for (const fx of cases) {
				const label = `${fx.id} — ${fx.formula}${fx.status === "known-failure" ? " [known-failure]" : ""}`
				it(label, () => checkDirect(fx))
			}
		})
	}
})

describe("corpus: workbooks", () => {
	for (const [category, cases] of byCategory(workbooks)) {
		describe(category, () => {
			for (const fx of cases) {
				const label = `${fx.id}${fx.status === "known-failure" ? " [known-failure]" : ""}`
				it(label, () => checkWorkbook(fx))
			}
		})
	}
})
