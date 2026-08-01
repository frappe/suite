# Formula engine: findings and ranked backlog

Result of the test campaign described in `plan.md`. Every defect below was
produced by executing the real engine, and every one is reproduced twice: once
by the agent that found it and once independently. Each has at least one fixture
or test that fails when the defect is fixed.

- Fixtures: **1888** (1055 matching a spreadsheet, 833 recorded defects)
- Tests: **2950 passing, 6 expected-fail, 1 skipped**, 25 files
- Baseline before the campaign: 595 tests, 22 files

Ranking follows `plan.md`: a wrong number nobody can see outranks a visible
failure, because a spreadsheet is trusted. `coverage.md` has the generated
per-function table; `compatibility-report.md` has the IronCalc comparison.

## Commands

```bash
cd apps/suite/frontend
yarn vitest run src/apps/sheets/engine                    # everything
yarn vitest run src/apps/sheets/engine/formula.corpus.test.ts
FORMULA_FC_SEED=1 FORMULA_FC_RUNS=20000 FORMULA_FC_DEPTH=6 \
  yarn vitest run src/apps/sheets/engine/formula.property.test.ts
node src/apps/sheets/engine/test-corpus/report.mjs > coverage.md
```

## 1. Silent wrong results

The engine answers with a plausible number that is wrong, with nothing to
indicate a problem.

| Repro | Engine | Correct |
| --- | --- | --- |
| `=SUM($A$1:$A$3)` over 1,2,3 | `0` | 6 |
| `=NOSUCHNAME1` | `0` | `#NAME?` |
| `=Sheet9!A1` (sheet deleted) | `0` | `#REF!` |
| `=SUM(NoSuch!A1:A3)` | `0` | `#REF!` |
| `=MAX(C1:C3)` over -1, blank, -5 | `0` | -1 |
| `=AVERAGE(A1:A3)` over 1, blank, 3 | 1.33 | 2 |
| `=AVERAGE(10,"x",30)` | 13.33 | 20 |
| `=SUM("abc",4)` | 4 | `#VALUE!` |
| `=2^3^2` | 8 | 64 |
| `=-5%` | -5 | -0.05 |
| `=-2%*3` | -2 | -0.06 |
| `=--1` | -0 | 1 |
| `=ROW(B7)` | 1 | 7 |
| `=SUM(INDEX(A1:B2,0,1))` | 0 | 30 |
| `=SUMIF(A1:A5,"apple",B1:B3)` | 40 | 90 |
| `=GCD(8,12,10)` | 4 | 2 |
| `=MOD(-3,2)` | -1 | 1 |
| `=ROUND(-2.5,0)` | -2 | -3 |
| `=TRUNC(3.14159,2)` | 3 | 3.14 |
| `=EVEN(-1)` | 2 | -2 |
| `=YEAR(A1)` where A1 holds `2026-01-15` | 1970 | 2026 |
| `=DATEDIF(…,"M")` across a month | over-counts | complete months |

Three root causes account for most of this:

**An unset cell is the number 0.** `getCellValue` returns 0 for a blank, so
there is no blank in the value model at all. `MAX` over negatives with one gap
returns a value that is not in the range. `ISBLANK` is then wrong in both
directions: `ISBLANK(Z99)` is FALSE and `ISBLANK("")` is TRUE.

**Text coerces to 0 instead of being skipped or rejected.** `toNum` maps any
non-numeric text to 0, so a typo inside a literal argument is invisible.

**Absolute references do not evaluate.** `$` has no tokenizer branch, so it is
silently dropped and the remainder becomes an identifier. `=$A$1` and `=A$1`
give `#NAME?`; `=SUM($A$1:$A$3)` gives `0`. Meanwhile `formula-adjust.js`
implements `$` anchoring correctly for shifting, so a pinned reference survives
a fill and then fails to evaluate. The syntax is worse than unsupported: it is
actively harmful, because the fill handle produces it.

## 2. Stale recalculation

| Repro | Engine | Correct |
| --- | --- | --- |
| Named range `REV`→A1; read `=REV*2`, then set A1 | frozen at old value | recalculates |
| `A1==RAND()`, `B1==A1`, read repeatedly | B1 never changes | tracks A1 |
| `=SUM(Data!A:A)`, edit `Data!A2` | stale | recalculates |
| Rebind or delete a named range | nothing invalidates | recalculates |
| `=Sheet2!A1+1`, delete Sheet2 | 6 (cached) | `#REF!` |

`deps.extractRefs` walks only REF/SHEETREF/SHEETCOL tokens and never consults
the named-range resolver, so a formula using a name registers **no edge at all**
and freezes after its first evaluation. Volatility does not propagate either: a
cell is volatile only if its own text matches `VOLATILE_RE`, so a dependent of a
volatile cell caches forever. The same regex matches inside string literals, so
`="RAND("` is treated as volatile — harmless, but it shows the test is textual.

## 3. Data-dependent wrong results

The answer depends on the size of the data, the machine, or the locale — so it
is correct in review and wrong in production.

| Repro | Behaviour |
| --- | --- |
| `=SUM(A1:A200000)`, `=SUM(A:A)` | correct to ~124,998 cells, then `#VALUE!` |
| Dependency chain over ~700 cells | `#ERROR!` on the first cold read |
| `=TEXT(1234567.5,"#,##0")` | `12,34,567.5` on an `en-IN` machine |
| `=DAY("2026-05-23")` | 22 west of Greenwich, 23 east |
| `=HOUR(TIME(23,45,30))` | returns the machine's UTC offset |

`flatten()` collects ranges with `push(...spread)`, which exceeds the argument
limit past roughly 125,000 elements; the `RangeError` is swallowed by the
blanket `try/catch` and surfaces as `#VALUE!`. Evaluation is recursive, one JS
frame set per dependency link, so a running-balance column over 1,000 rows
fails on the cold read after loading the file — a workbook that computed
correctly when saved opens as a column of errors.

`TEXT` falls back to `toLocaleString()`, so the same workbook shows different
numbers to different users. Dates are built as ISO strings parsed at UTC
midnight and read back with local getters, so every date reads a day early west
of Greenwich. **The pre-existing `formula.test.ts` already fails 5 tests under a
negative UTC offset**; CI runs UTC, which is why this was never seen.

## 4. Invalid formulas accepted

`=1 2`→1, `=1+2)`→3, `=SUM(1,2) 5`→3, `=1@2`→1, `="abc`→`abc`, `=1.2.3`→1.2,
`=A1 A2`→1, `=*1`→0, `=)`→0, `=,`→0, `=[A1]`→1, `=1e5e5`→100000.

One cause: neither `evaluate` nor `createParser` checks that the token stream
was consumed, and the tokenizer's final branch consumes an unrecognised
character while emitting no token. So a typo silently truncates the formula.
This is also what makes the precedence defects silent rather than loud, and the
property suite found it independently: `=2%%` answers 0.02 while `=(2%%)`
answers `#ERROR!`, because only the parenthesised form has an `expect(RP)` to
trip over the leftover token.

Not detectable differentially — IronCalc accepts these too.

## 5. Valid formulas rejected

`=#N/A`→`#N`, `=#DIV/0!`→`#DIV` (the error scan stops at `/`), `="a""b"`→`a`
(doubled-quote escaping is unsupported), `=Sheet2!$A$1`→`#REF!`.

## 6. Crashes and freezes

**`=SUMPRODUCT()` never returns.** `Math.min()` over zero arrays is `Infinity`,
so the accumulation loop has no bound. Confirmed by subprocess timeout. In the
browser this freezes the UI thread with no error and no recovery — a user who
commits `=SUMPRODUCT(` before finishing loses the tab. Recorded as a **skipped**
test with a do-not-unskip comment, because running it would hang CI.

`=INDEX()`, `=SORT()`, `=UNIQUE()`, `=FILTER()`, `=CHOOSE(2.7,…)` and `=IF(1)`
return JavaScript `undefined`, which is neither a value nor an error and renders
as an empty cell — `ISBLANK` then reports it as blank data.

`=UPPER()` renders `UNDEFINED`; `=REPLACE("hello",2,3)` renders `hundefinedo`.

A quadratic tokenizer scan over spaces before a sheet separator: 44 ms at 5,000
spaces, 1451 ms at 40,000.

## 7. Structural edits corrupt correct sheets

No user error is involved; the sheet is correct until an ordinary edit.

| Action | Result |
| --- | --- |
| Insert a row above `=A1+A2` | formula text is never rewritten |
| Delete a column left of `=B1*2` | becomes a reference to itself, `#CIRCULAR!` |
| Delete a referenced row | reads `0`, not `#REF!` |
| Fill `=A1&"Q1"` down | `=A2&"Q2"` — the string literal is rewritten |
| Fill `=LOG10(A1)` right | `=LOH10(B1)` — a function that does not exist |
| Fill `='Q1 Data'!A5` down | `='Q2 Data'!A6` — the sheet name is rewritten |
| Shift `=B2+A1` off-grid | clamps to `=A1+A1` instead of `#REF!` |
| Cut `B1==A1*2` to B2 | re-relativised to `=A2*2`; a move must not re-anchor |
| Rename a sheet | rewrites matching text inside string literals |

`insertRow`/`deleteRow`/`insertCol`/`deleteCol` move cell ids and rebuild the
dependency graph but never call `adjustFormula`. And `adjustFormula` itself
rewrites raw text with a regex, so it cannot tell a reference from a string, a
function name, or a quoted sheet name.

## 8. Errors are a string convention, not a type

`isErr` is `startsWith("#")` on a string. Consequences:

- `=IFERROR("#1 seed","x")` returns `"x"` — ordinary user text is swallowed.
- `=ISTEXT(1/0)` is TRUE.
- Comparison and `&` never check for errors, so `=(1/0)>1` is FALSE and
  `="x"&(1/0)` is `"x#DIV/0!"`.
- Therefore **`IFERROR` cannot catch a guarded comparison** — the pattern it
  exists for. `=ISERROR((1/0)>1)` and `=IFERROR((1/0)>1,"caught")` are both
  FALSE.
- `NaN` and `Infinity` are not errors either and reach the grid as the text
  `"NaN"` and `"Infinity"`: `=1e308*10`, `=2^1024`, `=0^-1`, `=EXP(1000)`,
  `=(-1)^0.5`, `=CODE("")`, `=YEAR("junk")`.
- Errors inside a range are skipped by every aggregate rather than propagated.

Comparison is broken for the same reason it swallows errors — it coerces both
sides with `toNum`. All text collapses to 0, so no two text values compare as
ordered (`="a"<"b"` is FALSE), and `=` additionally ORs a string compare with a
numeric one, so `="a"=0` and `="a"<>0` are **both TRUE**.

## 9. No argument validation anywhere

**Zero of 162 functions check arity.** `=SUM()`→0, `=PRODUCT()`→1, `=ABS(-3,9)`→3,
`=PI(5)`→π, `=IF(TRUE,1,2,3)`→1, `=COUNTIF()`→1, `=PMT(rate,nper)`→0.

Several return a plausible-looking error for the wrong reason — `=LN()`→`#NUM!`,
`=MOD()`→`#DIV/0!` — which is worse than a clear `#N/A`, because it looks
considered.

370 fixtures, the largest single class in the corpus.

## Recommended order

Ranked by defects closed per unit of change. The first four are all single call
sites.

1. **Bound `flatten` and guard `SUMPRODUCT`.** Two small edits. Removes the
   freeze and makes eight aggregates correct on full-column ranges.
2. **Check that every token was consumed in `evaluate`, and make the
   tokenizer's final branch fail.** Turns a large class of silent wrong answers
   into errors, and stops future dropped operators from being invisible.
3. **A declarative arity and error-propagation table checked at the `T.FN`
   dispatch site.** One call site closes the 370 `function-arguments` fixtures
   and most of the propagation cases, without editing 162 function bodies. It
   also gives autocomplete something to read.
4. **Make errors a real type and rewrite `comparison()` around Excel's typed
   ordering.** Fixes error propagation, text ordering, boolean comparison, the
   `=`/`<>` contradiction, and the `IFERROR` blindness together. Map `NaN` and
   `Infinity` to `#NUM!` at the same boundary.
5. **Give `$` a tokenizer branch** so `REF` carries anchor flags.
   `formula-adjust.js` already implements the other half.
6. **Introduce a blank distinct from 0** in `getCellValue`, and teach the
   aggregates to skip blanks and text.
7. **Call `adjustFormula` from the row and column operations, and rewrite both
   it and `renameSheetInFormula` over the token stream** rather than raw text.
8. **Evaluate iteratively in topological order** instead of by recursive
   descent, removing the ~700-cell chain limit.
9. **Teach `deps.extractRefs` about named ranges**, invalidate on resolver
   change, and propagate volatility to dependents.
10. **Decide the date representation.** Serial numbers, or a date type the
    operators understand. Build with `Date.UTC` and read with `getUTC*` to
    remove the whole time-zone class. Until then date arithmetic cannot work.

## Unsupported features

Absolute references (evaluation); array spill; a blank type; `#REF!` as a
sentinel anywhere; date serials and date arithmetic; doubled-quote string
escaping; `#N/A` and `#DIV/0!` as literals; array literals `{1,2}`; structured
and 3-D references; the intersection and union operators; `SEARCH` wildcards;
`NUMBERVALUE` separators; `TEXT` format parsing beyond four hard-coded shapes;
`DOLLAR`/`FIXED` thousands grouping; `NETWORKDAYS`/`WORKDAY` holidays;
`DATEDIF` MD/YM/YD; `INDEX` row/column 0; `XLOOKUP` search modes; `FILTER`
multiple conditions; `SORT` secondary keys; named-range rename rewriting;
whole-column ranges at usable cost; `PERCENTILE.INC`, `STDEV.S`, `VAR.P`,
`CEILING.MATH`, `MODE`, `RANK`, `QUARTILE`, `LCM`, `SUMSQ`, `MROUND`,
`INDIRECT`, `OFFSET`, `SUBTOTAL`, `LOOKUP`.

## Notes on method

- Two claims were adjudicated rather than accepted. `=2^3^2` is **64**: Excel
  documents one precedence level for `^` and left-to-right evaluation among
  equal precedence, and IronCalc independently agrees. Both the baseline and one
  agent initially said 512, which is mathematical convention.
- IronCalc is not treated as an oracle. Five IronCalc defects are recorded in
  `known-differences.json`, including one that limits the method: IronCalc also
  accepts `=1 2` and `=1.2.3`, so the `parser-accepts-invalid` class cannot be
  found differentially and is pinned against documented Excel behaviour instead.
- `known-failure` fixtures assert the engine is **still wrong**. Fixing a defect
  turns the suite red and forces the corpus to be updated in the same change, so
  this document cannot silently go stale.
