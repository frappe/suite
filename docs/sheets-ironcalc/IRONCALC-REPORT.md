# IronCalc differential report

Three-way comparison: old engine (`../formula.js`) vs new engine (`../engine2.js`)
vs [IronCalc](https://github.com/ironcalc/IronCalc) (`@ironcalc/wasm` 0.8.4, Rust
engine compiled to wasm). Same harness, same fixture grid, same corpus and seed
as the README baseline. An agent ran this comparison on 2026-09-01.

## Method

- Installed `@ironcalc/wasm@0.8.4` in a scratch directory outside the repo.
  Loaded it in Node via `initSync({ module: fs.readFileSync('wasm_bg.wasm') })`.
- Replicated the fixture grid, `canon()`, and `compare()` from `grid.js`
  verbatim. The repo engines were imported read-only by absolute path.
  HyperFormula was not needed and was not installed.
- IronCalc adapter: one `Model`, fixture cells written with `setUserInput`,
  each formula written to scratch cell H1, result read back.
- IronCalc has no raw-value getter in `wasm.d.ts`. `getCellContent` returns the
  input string. So the adapter reads `getFormattedCellValue` plus
  `getCellType` (probed codes: 1 number, 2 text, 4 logical, 16 error) and
  converts to JS number / string / boolean / error token before `canon()`.
- The default "general" format rounds to 6-10 significant digits and would
  break the harness 1e-9 epsilon. Fix: the scratch cell carries the number
  format `0.###############E+000` (via `getCellStyle` + `onPasteStyles`).
  That yields 15 significant digits, relative error about 5e-15.
- Aside, found while building the adapter: IronCalc's formatter mangles
  3-digit exponents under a 2-digit mask (`E+00` renders 2e200 as
  `2.E+20200`). The 3-digit mask avoids it.
- Function coverage probe: all 61 function names the corpus can emit resolve in
  IronCalc (none return `#NAME?`). The "function unimplemented" bucket is
  therefore empty by measurement, not by assumption.

Run:

```bash
cd /tmp/ironcalc-difftest
npm i @ironcalc/wasm@0.8.4
node run-ironcalc.js 8000 12345
```

## Curated known-Excel cases (16 scored)

| Engine | Correct |
|---|---|
| OLD (`formula.js`) | 3 / 16 |
| NEW (`engine2.js`) | 15 / 16 |
| IronCalc 0.8.4 | **15 / 16** |

- The single miss is the same for both: `=AVERAGE(10,"x",30)`. Both return
  `#VALUE!`, the Excel answer. The table's expected `20` is the Google Sheets
  answer. Counting Excel semantics as correct, both are 16/16.
- engine2 and IronCalc agree with each other on all 16 curated cases.
- IronCalc floors like Excel on the oracle's known weak spots: `MOD(-3,2)` is
  `1`, `ROUND(-2.5,0)` is `-3`, `EVEN(-1)` is `-2`.

## Random corpus (seed 12345, 8000 formulas)

| Pair | Agreement |
|---|---|
| engine2 vs IronCalc | **99.91%** (7993 / 8000) |
| old vs IronCalc | 90.63% (7250 / 8000) |
| old vs engine2 | 90.61% (7249 / 8000) |

- Error-code mismatches inside the matches: 0. When both engines error, they
  emit the same code every time in this corpus.
- Baseline context: engine2 vs HyperFormula was 98.91% on the same corpus, and
  the README attributes most of that residue to HyperFormula's `MOD`/`INT`
  bugs. IronCalc agrees with engine2 on those, so the pairwise number rises to
  99.91%. Two independent Excel-faithful engines now corroborate each other.

## Divergence buckets (engine2 vs IronCalc, 7 total)

| Bucket | Count |
|---|---|
| Function unimplemented in IronCalc | 0 |
| IronCalc errors, engine2 has a value | 0 |
| engine2 errors, IronCalc has a value | 5 |
| Precision | 0 |
| Genuine semantic difference | 2 |

### engine2 errors, IronCalc returns a number (5)

All five are one root cause: IronCalc lets a non-finite intermediate
(`0^negative` or overflow gives infinity) flow through a later operation that
brings it back to a finite number. Excel errors at the intermediate step.
engine2 matches Excel's behavior class.

| Formula | engine2 | IronCalc |
|---|---|---|
| `=0^D3^C1` | `#NUM!` | 0 |
| `=--1/0^C3` | `#NUM!` | 0 |
| `=-2*-5/(-A5^(PRODUCT(B1:B5,A1:A5)))` | `#NUM!` | 0 |
| `=-1*-2.5/MOD(A5,-1)^D5` | `#NUM!` | 0 |
| `=ROUNDDOWN(5,-1)^B5^-2.5^-1` | `#NUM!` | 0 |

Adjudication probes: IronCalc does error on the direct forms (`=0^-1`,
`=0^-2.5`, `=5^1800000` all give `#NUM!`). Only the compound form leaks:
`=(0^-2.5)^-1` gives 0. So this is a real IronCalc bug on a narrow edge, 5 in
8000 formulas. Related probe: IronCalc gives `=0^0` as 1; Excel gives `#NUM!`.

### Genuine semantic difference (2)

`INDEX` resolving to an empty cell:

| Formula | engine2 | IronCalc |
|---|---|---|
| `=INDEX(A1:C3,2,2)` | blank | 0 |
| `=INDEX(A1:C3,2,3)` | blank | 0 |

Excel displays 0 for a formula reference to an empty cell. Here IronCalc
matches Excel and engine2 does not. This is the empty-cell coercion
convention, the same product decision the README already flags.

## Verdict

Yes on both counts. IronCalc's correctness equals engine2 on the curated set
(15/16, identical answers on all 16, and both misses are the Google-Sheets-vs-
Excel `AVERAGE` convention, not a defect). On the 8000-formula random corpus
the two agree 99.91%, with zero unimplemented functions, zero precision
divergences, and zero error-code mismatches. The 7 residual divergences split
5-2: five are an IronCalc edge bug (non-finite intermediates in compound `^`
expressions collapse to 0 instead of an error, where engine2 matches Excel),
and two are `INDEX`-over-empty-cell coercion where IronCalc matches Excel and
engine2 returns blank. Both classes are acceptable: the first is rare and
error-vs-0 on degenerate exponent chains, the second is a convention choice
IronCalc gets right. Caveat: this run covers the corpus's function surface
(arithmetic, logical, text, stats/criteria, lookup, transcendental); it says
nothing about dates, engineering, or financial functions, and it measures
one-shot evaluation, not reactivity.
