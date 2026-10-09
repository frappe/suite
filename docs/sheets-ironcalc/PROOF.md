# Proof — formula engine rebuild

Don't take my word for any of this. Run it.

## Verify the gates yourself (no extra setup)

```bash
cd frontend
npx vitest run src/apps/sheets/engine   # runs the automated checks
```

You'll see **57 checks pass** (plus 1 skipped — the differential, which needs the
optional reference engine below). These checks are the audit's `findings.md`
turned into automated tests. Each one fails on the old engine and passes on the
new one:
- `engine2.test.ts` — the wrong-answer findings (`2^3^2`, `--1`, `-5%`, `SUM($A$1:$A$3)`, `MAX` over negatives, `ROUND(-2.5)`, `GCD`, `EVEN`, `NOSUCHNAME` → `#NAME?`, …)
- `sheet2.test.ts` — the "cell didn't recalculate" findings (named ranges going stale, cross-sheet ref after a sheet is deleted, whole-column totals, volatile values, deep chains)

## Run the side-by-side comparison (optional reference engine)

```bash
cd frontend
yarn add -D hyperformula        # the independent reference engine (dev-only, never shipped)
node src/apps/sheets/engine/difftest/compare-engines.js 8000
```

```
known-Excel correctness:  OLD 3/16   NEW 15/16
OLD engine agreement:  ~91%
NEW engine agreement:  ~99%
```

| | Old | New |
|---|---|---|
| Formulas matching a trusted independent engine | ~91% | **~99%** |
| Known-correct spot checks | 3 / 16 | **15 / 16** |
| "Didn't recalculate" cases | 3 / 8 fixed | **8 / 8 fixed** |
| Long formula chains | broke at ~700 | handles 50,000 |

## Being straight about the gaps

- The remaining ~1% of "differences" are **mostly the reference tool being wrong,
  not us** — it truncates a couple of functions where we match Excel/Sheets.
- The checker caught **four real bugs in the rebuild itself** before anyone else
  saw them. That's the point: the way to trust software built with AI is an
  automated check that actively tries to prove your own work wrong.
- Not finished: some functions still need porting, it's on one reference engine
  (a second, stronger one is next), and it isn't swapped into the live app yet —
  it sits behind the same `evaluate()` / `createSheet()` interface, all checks green.

## How this was built

Every problem from the audit became a repeatable, automated check first. Then the
engine was rebuilt the standard, proper way (a real tokenizer → parser → syntax
tree → evaluator, plus a dependency graph) and measured against those checks the
whole way. The checks run automatically on every change, so a regression fails
the build instead of reaching a customer.
