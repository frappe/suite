# Compatibility report: Frappe Sheets formula engine vs IronCalc

First differential run. Reference engine: **IronCalc 0.8.4** (`@ironcalc/wasm`,
MIT/Apache-2.0), a Rust spreadsheet engine compiled to WebAssembly. It is an
optional **dev** dependency; nothing in the product imports it.

IronCalc is a second opinion, not an oracle. Every difference below was
classified by hand against documented Excel and Google Sheets behaviour, and the
report names which product the expected value comes from. IronCalc is wrong in
five places recorded here.

## What was compared

| Source | Cases |
| --- | --- |
| `test-corpus/syntax.json` + `arithmetic.json` (single-sheet direct fixtures) | 183 |
| Formulas generated for this report | 249 |
| **Total** | **432** |

Generated coverage: arithmetic and comparison operators, unary and percent
handling, string concatenation, type coercion, error production and propagation,
argument arity, argument type, argument boundaries, references (relative,
absolute, ranges), parser robustness, and 90 built-in functions across the
numeric, text, logical, lookup and date families.

Excluded on purpose:

- Multi-sheet fixtures. IronCalc addresses sheets by index, not name, so
  comparing them needs a translation layer that would itself need testing.
- Named-range fixtures. IronCalc's defined-name API differs enough that a
  mismatch would measure the adapter, not the engines.
- Workbook fixtures (`workbooks/`). Those test recalculation and structural
  edits, which is a separate campaign.

Result: **156 disagreements** — 78 from the corpus, 78 from the generated set.
The corpus half largely restates defects already tracked in `syntax.json` and
`arithmetic.json`; the generated half is the new material and is what this
report classifies.

## Normalisation rules

The two engines report the same answer in different shapes. Comparison happens
only after both sides are folded into `{kind, value}`.

| # | Rule | Detail |
| --- | --- | --- |
| 1 | Error names | Compared by name. Local `#CIRCULAR!` folds to IronCalc's `#CIRC!` (already recorded as `diff-circular-error-name`). Local `#ERROR!` is a parse failure; IronCalc reports parse failures the same way, so the two match directly. |
| 2 | Empty | Local `""`, `null` and `undefined` and an empty IronCalc cell all become `empty`. IronCalc cannot distinguish a deliberate empty-string result from an empty cell, so the two are folded together — this hides any difference in that one case. |
| 3 | Booleans | Both engines return real booleans. No coercion is applied before comparing. |
| 4 | Numbers | **Relative tolerance 1e-9**, with an **absolute floor of 1e-12** so values near zero do not fail on noise. 1e-9 was chosen because it is the precision IronCalc's number formatter round-trips reliably. `-0` folds to `0`: no spreadsheet distinguishes them. `NaN` equals `NaN`. |
| 5 | Dates | This engine returns `YYYY-MM-DD` text; IronCalc returns an Excel serial. A local ISO date string is converted to a serial (epoch 1899-12-30, Excel's 1900 leap-year bug included) before comparing. Without this rule every date case would be a false difference. |
| 6 | Arrays | A local 2D matrix is stringified and compared as one value. IronCalc spills an array into neighbouring cells, which the single probe cell cannot see, so no generated case returns an array. |
| 7 | Locale | Both engines are pinned to `en` / `UTC`. Only raw values are compared, never formatted output. No locale-dependent difference was found. |

### Reading values out of IronCalc

The wasm surface has no raw value getter: only `getCellType` (a type tag) and
`getFormattedCellValue` (a display string). The general format rounds to 9
decimals, which is too lossy for doubles. The adapter therefore applies a
15-decimal fixed number format (`0.000000000000000`) to the probe cell and
parses that. It falls back to the general string only when the fixed format
underflows to zero (below roughly 1e-15), and flags the result as
`degradedPrecision` when it does. A scientific format was tried first and
rejected: IronCalc mis-writes three-digit exponents (see IC-5).

## Classified differences

78 generated disagreements. Every row is asserted by
`engine/formula.differential.test.ts`; a new one that is not in its
`DIFFERENCE_TABLE` fails the suite.

"Correct" is the value Excel and Google Sheets both produce unless stated
otherwise.

### Confirmed local defects — operators and coercion (17)

| Formula | This engine | IronCalc | Correct | Note |
| --- | --- | --- | --- | --- |
| `=2^3^2` | 8 | 64 | 512 | `^` is right associative. **All three disagree**; see IC-1. |
| `=5%%` | 0.05 | 0.0005 | 0.0005 | `%` does not stack. |
| `=-5%` | -5 | -0.05 | -0.05 | `%` binds tighter than unary minus. |
| `=--1` | -0 | 1 | 1 | Prefix operators do not stack. |
| `=+-2` | 0 | -2 | -2 | Same root cause. |
| `=-+2` | 0 | -2 | -2 | Same root cause. |
| `="a"=0` | TRUE | FALSE | FALSE | Text never equals a number. |
| `=1="1"` | TRUE | FALSE | FALSE | A number never equals text. |
| `=""=0` | TRUE | FALSE | FALSE | The empty string is text. |
| `=TRUE=1` | TRUE | FALSE | FALSE | Booleans sort above numbers. |
| `=TRUE>1` | FALSE | TRUE | TRUE | Same ordering rule. |
| `="apple">1` | FALSE | TRUE | TRUE | Text sorts above numbers. |
| `="a"<"b"` | FALSE | TRUE | TRUE | Text is not ordered at all locally. |
| `="B">"a"` | FALSE | TRUE | TRUE | Comparison is case-insensitive. |
| `=1<2<3` | TRUE | FALSE | FALSE | `TRUE<3` is FALSE under the type ordering. |
| `=Z99&"a"` | `0a` | `a` | `a` | A blank cell concatenates as empty, not 0. |
| `=TRUE&"x"` | `truex` | `TRUEx` | `TRUEx` | JavaScript `String(true)` leaks out. |

Root cause for the comparison rows: `comparison()` in `formula.js` compares
`_str(l).toLowerCase()===_str(r).toLowerCase() || toNum(l)===toNum(r)` for `=`
and `toNum(l)>toNum(r)` for the ordering operators. Excel's rule is a total
order over four type bands — number < text < FALSE < TRUE — with no
cross-band coercion at all.

### Confirmed local defects — error handling (11)

| Formula | This engine | IronCalc | Correct |
| --- | --- | --- | --- |
| `=(1/0)>1` | FALSE | `#DIV/0!` | `#DIV/0!` |
| `=(1/0)=1` | FALSE | `#DIV/0!` | `#DIV/0!` |
| `=ISERROR((1/0)>1)` | FALSE | TRUE | TRUE |
| `="x"&(1/0)` | `x#DIV/0!` | `#DIV/0!` | `#DIV/0!` |
| `=SUM(1,1/0)` | 1 | `#DIV/0!` | `#DIV/0!` |
| `=1e308*10` | `Infinity` | `#NUM!` | `#NUM!` |
| `=2^1024` | `Infinity` | `#NUM!` | `#NUM!` |
| `=0^-1` | `Infinity` | `#NUM!` | `#NUM!` |
| `=LOG(100,1)` | `Infinity` | `#DIV/0!` | `#DIV/0!` |
| `=(-8)^(1/3)` | `NaN` | `#NUM!` | `#NUM!` |
| `=FACT(-1)` | 1 | `#NUM!` | `#NUM!` |

`comparison()` and `concat()` do not check `isErr` on their operands, unlike
`add()` and `mul()` which do. Nothing anywhere converts a non-finite double into
a spreadsheet error, so `Infinity` and `NaN` reach the grid — values no
spreadsheet can represent.

### Confirmed local defects — function results (15)

| Formula | This engine | IronCalc | Correct | Note |
| --- | --- | --- | --- | --- |
| `=ROUND(-2.5,0)` | -2 | -3 | -3 | ROUND is half-away-from-zero. |
| `=ROUNDDOWN(-1.999,2)` | -2 | -1.99 | -1.99 | The digits argument is ignored for negatives. |
| `=TRUNC(2.789,2)` | 2 | 2.78 | 2.78 | The digits argument is ignored. |
| `=FLOOR(2.5,-1)` | 3 | `#NUM!` | `#NUM!` | Mismatched signs are an error. |
| `=CEILING(2.5,-1)` | 2 | `#NUM!` | `#NUM!` | Same. |
| `=EVEN(-1.5)` | 2 | -2 | -2 | Rounds away from zero, keeping the sign. |
| `=ODD(-1.5)` | 3 | -3 | -3 | Same. |
| `=MOD(-3,2)` | -1 | 1 | 1 | MOD's sign follows the divisor. |
| `=MOD(-1,3)` | -1 | 2 | 2 | Same. |
| `=ISBLANK(Z99)` | FALSE | TRUE | TRUE | An unset cell reads as `""`, never blank. |
| `=COUNTBLANK(Y1:Y3)` | 0 | 3 | 3 | Same root cause. |
| `=AVERAGE(Y1:Y3)` | 0 | `#DIV/0!` | `#DIV/0!` | Averaging nothing is a division by zero. |
| `=FIXED(1234.567,1)` | `1234.6` | `1,234.6` | `1,234.6` | No thousands grouping, so argument 3 is inert. |
| `=DOLLAR(1234.567,2)` | `$1234.57` | `$1,234.57` | `$1,234.57` | Same. |
| `=SEARCH("h*o","hello")` | `#VALUE!` | 1 | 1 | SEARCH takes `*` and `?` wildcards. |

### Confirmed local defects — argument validation (14)

This engine calls `FUNCTIONS[name](args)` with whatever the parser collected. No
function checks its argument count or types, so a missing argument becomes
`undefined` and coerces to 0. Excel and Google Sheets refuse all of these at
entry; the corpus records a refusal as `#ERROR!`, matching `syntax.json`.

| Formula | This engine | IronCalc | Correct |
| --- | --- | --- | --- |
| `=SUM()` | 0 | `#ERROR!` | rejected |
| `=ABS()` | 0 | `#ERROR!` | rejected |
| `=ABS(-1,2)` | 1 | `#ERROR!` | rejected |
| `=LEFT("abc",1,9)` | `a` | `#ERROR!` | rejected |
| `=ROUND(2.567)` | 3 | `#ERROR!` | rejected |
| `=IF(TRUE)` | `undefined` | `#ERROR!` | rejected |
| `=IF(TRUE,1,2,3)` | 1 | `#ERROR!` | rejected |
| `=MOD(5)` | `#DIV/0!` | `#ERROR!` | rejected |
| `=POWER(2)` | 1 | `#ERROR!` | rejected |
| `=ABS("a")` | 0 | `#VALUE!` | `#VALUE!` |
| `=MID("abc",0,1)` | `""` | `#VALUE!` | `#VALUE!` |
| `=MID("abc",1,-1)` | `""` | `#VALUE!` | `#VALUE!` |
| `=LEFT("abc",-1)` | `""` | `#VALUE!` | `#VALUE!` |
| `=REPT("a",-1)` | `""` | `#VALUE!` | `#VALUE!` |

`=IF(TRUE)` returns JavaScript `undefined`, and `=ROUND(1.5,400)` returns `NaN`.
JSON cannot express either, so those fixtures record no `actual`; the runner
still asserts the mismatch.

### Confirmed local defects — references and parser (10)

| Formula | This engine | IronCalc | Correct |
| --- | --- | --- | --- |
| `=$A$1` | `#NAME?` | cell value | cell value |
| `=A$1` | `#NAME?` | cell value | cell value |
| `=SUM($A$1:$A$3)` | 0 | 6 | 6 |
| `="abc` | `abc` | `#ERROR!` | rejected |
| `=)` | 0 | `#ERROR!` | rejected |
| `=*1` | 0 | `#ERROR!` | rejected |
| `=[A1]` | cell value | `#ERROR!` | rejected |
| `="a""b"` | `a` | `a"b` | `a"b` |
| `=#N/A` | `#N` | `#N/A` | `#N/A` |
| `=#DIV/0!` | `#DIV` | `#DIV/0!` | `#DIV/0!` |

Absolute references are the highest-impact item in the whole report. `$` is the
documented way to pin a reference during fill and paste, `formula-adjust.js`
already handles `$` when shifting, and the autocomplete UI offers the syntax —
but the evaluator cannot read it back.

The error-literal rows are a tokenizer bug: the `#` branch stops at `/` and `,`,
so `#N/A` truncates to `#N` and `#DIV/0!` to `#DIV`.

### Confirmed local defects — dates (3)

| Formula | This engine | IronCalc | Correct |
| --- | --- | --- | --- |
| `=DATE(2026,1,31)+1` | `#VALUE!` | 46054 | 46054 |
| `=DATE(2026,3,1)-DATE(2026,2,1)` | `#VALUE!` | 28 | 28 |
| `=DATE(1899,1,1)` | -363 | `#NUM!` | `#NUM!` |

`DATE` returns a `YYYY-MM-DD` string, so no arithmetic works on a date. Recorded
as `diff-dates-are-iso-strings` in `known-differences.json` because it is a
design choice with wide blast radius, not a one-line bug. The first two rows
survive normalisation rule 5 precisely because the failure is in the arithmetic,
not the representation.

### Unsupported local features (6)

Functions IronCalc and Excel both have and this engine does not. Each has a
fixture in `compatibility/ironcalc-functions.json`.

`LOG10` · `SUMSQ` · `LCM` · `ROMAN` · `RANK` · `TYPE`

### Intentional product differences (1 in this run)

| Formula | This engine | IronCalc | Entry |
| --- | --- | --- | --- |
| `=SUM(1;2)` | 3 | `#ERROR!` | `diff-argument-separator-semicolon` |

### Inconclusive (1)

| Formula | This engine | IronCalc | Excel | Note |
| --- | --- | --- | --- | --- |
| `=ROUND(1.5,400)` | `NaN` | `#NUM!` | 1.5 | Three answers. The local one is certainly wrong — `NaN` is not a spreadsheet value — but IronCalc is not the reference here, so the fixture uses `source: excel-compatible-semantics`. |

## Unsupported features, both directions

### This engine has, IronCalc does not

Confirmed by calling all 162 local built-ins through IronCalc:

`SPARKLINE` · `SPLIT` · `JOIN` · `REGEXMATCH`

All four are Google Sheets functions with no Excel equivalent. Recorded as
`diff-google-sheets-only-functions`. Also `;` as an argument separator, which
IronCalc rejects — already recorded as `diff-argument-separator-semicolon`.

### IronCalc has, this engine does not

Probed against a 183-name list of common Excel functions. 42 hits:

```text
ACOSH   AVERAGEA BASE     BESSELI  BIN2DEC  BITAND   DEC2BIN  DELTA
ERF     FACTDOUBLE FISHER FORMULATEXT INDIRECT IPMT  ISNONTEXT ISREF
LCM     LOG10    LOOKUP   MAXA     MINA     MODE     MROUND   NORMDIST
NPER    OFFSET   PPMT     RANK     RATE     ROMAN    SLN      STDEVA
SUBTOTAL SUMSQ   SYD      TEXTAFTER TEXTBEFORE TYPE  UNICODE  WEEKNUM
XNPV    YEARFRAC
```

The highest-value ones for a spreadsheet product are `INDIRECT`, `OFFSET`,
`SUBTOTAL`, `LOOKUP` and `FORMULATEXT`: they are structural, not niche maths,
and a workbook that uses them cannot be opened at all.

## Confirmed IronCalc defects

Recorded so nobody "fixes" this engine to match IronCalc.

| # | Behaviour | IronCalc | Excel / Sheets | Entry |
| --- | --- | --- | --- | --- |
| IC-1 | `=2^3^2` | 64, and the stored formula is rewritten to `=(2^3)^2` | 512 | `diff-ironcalc-power-left-associative` |
| IC-2 | `=1 2`, `=1+2)`, `=1@2`, `=1.2.3`, `=SUM(1,2) 5` | accepted, truncated to the first valid prefix, and the stored formula is rewritten | rejected | `diff-ironcalc-accepts-trailing-garbage` |
| IC-3 | `=1e308*10&""` | text `inf` (but `=1e308*10` alone is `#NUM!`) | `#NUM!` | `diff-ironcalc-infinity-leaks-through-concat` |
| IC-4 | `=ROUND(1.5,400)` | `#NUM!` | 1.5 | see Inconclusive above |
| IC-5 | `0.00E+00` number format on `1e-300` | `1.00000000000000E-30300` | `1.00E-300` | `diff-ironcalc-scientific-exponent-format` |

IC-2 matters for the campaign: this engine's parser-accepts-invalid defects
cannot be detected differentially, because IronCalc has the same class of defect.
Those cases stay covered by `syntax.json` against documented Excel behaviour.

## Locale-dependent differences

None found. Both engines were pinned to `en` / `UTC` and only raw values were
compared. The one locale-adjacent difference — `;` as an argument separator — is
already classified as an intentional product difference, not a locale one.

## Artifacts

| Path | Contents |
| --- | --- |
| `engine/test-corpus/ironcalc.ts` | The adapter. `initIronCalc()`, `isIronCalcAvailable()`, `ironCalcLoadError()`, `evaluateInIronCalc()`. |
| `engine/formula.differential.test.ts` | The suite, the normalisation rules and the classification table. |
| `engine/test-corpus/compatibility/ironcalc-functions.json` | 16 fixtures: function results and missing functions. |
| `engine/test-corpus/compatibility/ironcalc-arguments.json` | 15 fixtures: arity, argument type, argument bounds. |
| `engine/test-corpus/known-differences.json` | 6 new entries: 1 product difference, 1 unsupported local feature, 4 IronCalc defects. |

New fixtures use the `diff-` id prefix. All 31 are `status: "known-failure"`, so
the corpus stays green while the backlog stays executable: fixing any one of them
turns its fixture red and forces the corpus to be updated in the same change.

## How to re-run

```bash
cd apps/suite/frontend

# install the optional reference engine (a `canvas` node-pre-gyp
# build failure during this install is pre-existing and harmless)
yarn add -D --ignore-workspace-root-check @ironcalc/wasm

yarn vitest run src/apps/sheets/engine/formula.differential.test.ts  # differential only
yarn vitest run src/apps/sheets/engine                              # whole engine suite

# regenerate the tables above
DIFF_DUMP=/tmp/diff.json yarn vitest run src/apps/sheets/engine/formula.differential.test.ts
```

Without `@ironcalc/wasm` the whole differential suite is skipped by
`describe.skipIf`, and `yarn vitest run src/apps/sheets/engine` still passes. The
corpus fixtures this run produced do not depend on IronCalc and keep running
either way.

## Recommended next work

1. **Absolute references.** `=$A$1` returning `#NAME?` is the single most
   damaging defect found. Fix the tokenizer to strip `$` before classifying an
   identifier.
2. **Comparison semantics.** Replace the coercing comparison path with Excel's
   four-band type ordering. Fifteen differences collapse into one fix.
3. **Non-finite results.** Convert `Infinity` and `NaN` to `#NUM!` at the
   boundary of every arithmetic and function result. Five differences, one fix.
4. **Error propagation through `comparison()` and `concat()`.** `add()` and
   `mul()` already do it; the other two do not.
5. **Argument validation.** A declarative arity and type table on `FUNCTIONS`
   would close all fourteen argument rows at once and give the autocomplete UI
   something to read.
6. **Dates as serials.** The largest change here, and a prerequisite for any
   real date arithmetic.
7. **Extend the harness to workbook fixtures.** IronCalc supports
   `insertRows`, `deleteColumns`, `renameSheet` and undo/redo, so the structural
   edit corpus could be compared too.
