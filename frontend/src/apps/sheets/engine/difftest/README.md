# Formula-engine differential harness

> **Status (2026-09):** IronCalc superseded `engine2.js` and `sheet2.js` per
> [ADR 0001](../../../../../../docs/adr/0001-sheets-ironcalc-calculation-core.md).
> Those files and their tests are removed. The harness now gates IronCalc:
> `ironcalc.test.ts` runs the curated cases and a seeded random corpus on every
> test run. See `IRONCALC-REPORT.md` for the measured baseline. The historical
> engine2 results below remain for the record.

Turns "the formula engine feels buggy" into a **number you can track and beat**.

It feeds the *same* formula, over the *same* grid, to two engines and diffs the
results:

- **Sheets** — the engine under test (`../formula.js`, called headless via its
  real `evaluate()` entry point — no browser).
- **Oracle** — [HyperFormula](https://hyperformula.handsontable.com/), an
  independent, production spreadsheet engine.

## How it's wired into the repo

The rebuilt engine lives one level up: [`../engine2.js`](../engine2.js) (parser +
evaluator) and [`../sheet2.js`](../sheet2.js) (reactive engine on the dependency
graph). Three gates run in plain `vitest`:

| Gate | File | Needs oracle? |
|---|---|---|
| Correctness (curated, known-Excel) | `../engine2.test.ts` | no |
| Reactivity + dep-graph robustness | `../sheet2.test.ts` | no |
| Differential smoke (seeded) | `difftest/differential.test.ts` | yes (skips if absent) |

```bash
# the two oracle-free gates — no extra setup:
npx vitest run src/apps/sheets/engine

# the exploratory differential (installs the reference engine, dev-only):
yarn add -D hyperformula
node src/apps/sheets/engine/difftest/compare-engines.js 8000   # old vs new vs oracle, per-bucket
node src/apps/sheets/engine/difftest/run.js 5000               # writes report.md
```

`hyperformula` is **not** a committed dependency — the shipped app never bundles
it, and the oracle-free gates hold the line without it. Install it only to run
the side-by-side comparison; the differential test skips cleanly when it's absent.

## Baseline (seed 12345, 5000 random formulas)

| | |
|---|---|
| Agreement | **86.8%** |
| Divergent | **13.2%** (659 formulas) |

The curated table reproduces every pure-evaluation finding from `findings.md`
(`2^3^2`, `--1`, `-5%`, `SUM("abc",4)`, `SUM($A$1:$A$3)`, `MAX` over negatives,
`ROUND(-2.5)`, `GCD`, `EVEN`, …).

## Read divergences honestly — three important caveats

1. **A divergence is not automatically "Sheets is wrong."** It means the two
   engines disagree. Go adjudicate against the spec / Excel / Google Sheets.
2. **The oracle is not gospel.** The harness already caught HyperFormula being
   wrong on `MOD(-3,2)` (returns `-1`; Excel/Sheets give `1`). That's why the
   curated cases carry a hand-verified Excel-correct answer as a third opinion.
3. **Some diffs are Excel-vs-Google-Sheets convention differences**, not bugs —
   e.g. `AVERAGE(10,"x",30)` is `#VALUE!` in Excel but `20` in Google Sheets.
   These need a product decision ("which semantics do we target?"), not a fix.

Net: the 13.2% is an **upper bound** on real defects — but the curated column
shows a large, unambiguous chunk of it *is* real (Sheets✗ / oracle✓ / matches
Excel).

## Reactivity harness (the worse half)

`run.mjs` only tests one-shot evaluation. The *worst* findings are stale-value
bugs, which only appear when an input changes and its dependents are supposed to
recalculate. `reactivity.mjs` drives the **real reactive engine** (`createSheet`,
the same one the app uses) and scripts mutate→read→assert scenarios.

```bash
node reactivity.mjs
```

Correct behaviour here is **spec-defined, not oracle-derived**: a dependent must
reflect its precedent's current value; a reference to a deleted sheet must become
`#REF!`.

**Result: 8 scenarios, 3 pass, 5 fail.**

| Scenario | Result |
|---|---|
| scalar dependency `B1=A1+1` recalcs | ✅ pass |
| range aggregate `SUM(A1:A3)` recalcs | ✅ pass |
| cross-sheet recalc on remote edit | ✅ pass |
| named range: edit source → dependent stays **stale** (6, want 20) | ❌ fail |
| named range: rebind → dependent stays **stale** (6, want 200) | ❌ fail |
| delete referenced sheet → returns cached **6**, not `#REF!` | ❌ fail |
| whole-column `SUM(Data!A:A)` → `#VALUE!`* | ❌ fail |
| volatile `RAND()` doesn't propagate to dependent (**frozen**) | ❌ fail |

The two passing sanity cases matter: the harness isn't rigged to fail. Simple
dependencies *do* recalc — the **structural** ones (named ranges, cross-sheet
lifecycle, volatility propagation) don't, because there's no real dependency
graph behind them. That's the single structural point the whole debate turns on,
now reproduced mechanically.

\* whole-column cross-sheet returns `#VALUE!` even on first read in this headless
harness; the app may register column extents differently, so adjudicate this one
against the running app before quoting it.

## The rebuild — proof a grammar fixes a bug *class*

`engine2.mjs` is a strangler-fig replacement for the parse layer: a real
**tokenizer → Pratt parser → AST → tree-walking evaluator**, with correct
operator binding powers. `compare-engines.mjs` runs the OLD engine and the NEW
engine through the *same* corpus, both scored against the oracle.

```bash
node compare-engines.mjs 5000
```

**Result — arithmetic + numeric core (seed 12345, 5000 formulas):**

| | Agreement w/ oracle | Known-Excel curated |
|---|---|---|
| OLD (`formula.js`) | 86.82% | 3 / 16 |
| NEW (`engine2.mjs`) | **98.12%** | **14 / 16** |

**Result — whole surface (8000 formulas: arithmetic, logical, text,
stats/criteria, lookup, transcendental math):**

| | Agreement w/ oracle |
|---|---|
| OLD (`formula.js`) | 91.38% |
| NEW (`engine2.mjs`) | **98.91%** |

Of the 87 whole-surface divergences, **84 are the *oracle's* bugs**, not ours:
76 `MOD` and 8 `INT` cases where HyperFormula truncates toward zero and our
engine floors like Excel/Sheets (e.g. `INT(-2.5)` → we say `-3`, Excel says
`-3`, HyperFormula says `-2`). The other 3 are floating-point *underflow*
(denormal vs flush-to-zero) — a display edge, not a wrong answer. So the new
engine's true correctness against Excel is ~99.96%; the headline % understates
it because the reference engine is itself wrong on `MOD`/`INT`.

The widened corpus also caught a **real bug in our own tokenizer** — function
names with trailing digits (`LOG10`, `ATAN2`) were mis-read as cell references
and failed to parse. Found by the harness, fixed, re-run. Exactly the loop.

+11.3 points on the core — and the entire operator bug class (`2^3^2`, `--1`, `-5%`,
`-2%*3`, `SUM($A$1:$A$3)`, `MAX` over negatives) is fixed **at once**, because a
Pratt parser gets precedence/associativity right by construction. Not patched
one finding at a time — made impossible.

Two things this run *also* proved, which are the whole point:

1. **The harness catches the rebuild's own bugs.** First pass, engine2 had a
   sign-flip on `-10^100` (I put unary minus below `^`; Excel binds it tighter —
   `(-10)^100`). The differential run flagged every sign-flip; one-line fix;
   re-run. That's the discipline: the new engine doesn't get trusted either.
2. **The only remaining "regressions" are the oracle being wrong.** All 12 are
   `MOD` with a negative operand — engine2 gives the correct Excel/Sheets answer
   (sign follows divisor: `MOD(-1,3)=2`), HyperFormula gives the JS-`%` answer
   (`-1`). Confirmed by the curated `MOD(-3,2)` case. This is exactly why a gold
   oracle (LibreOffice/Excel) is the next add — HyperFormula alone can't
   adjudicate its own bugs.

The remaining 2 curated misses: `SUMIF` (not yet implemented in this slice) and
`AVERAGE(10,"x",30)` (engine2 returns `#VALUE!`, the *Excel* answer; the table's
"20" is the *Google Sheets* answer — a product-convention choice, not a bug).

## The reactivity rebuild — a real dependency graph

The stale-value findings all trace to one missing thing: the old engine never
knew *what depends on what*. `sheet2.mjs` fixes it at the root — every formula's
precedents come straight from the AST (`engine2.precedents`) and become edges in
a dependency graph (cell edges, name edges, range/whole-column edges). A cell
edit walks the graph and clears exactly the cells that went stale.

```bash
node reactivity2.mjs   # old engine vs new engine, same 8 scenarios
node stress2.mjs       # 12 adversarial graph tests
```

**Reactivity head-to-head: OLD 3/8 → NEW 8/8.** Named-range recalc, named-range
rebind, cross-sheet `#REF!` after delete, whole-column recalc, and transitive
volatility (`RAND()` propagation) — all fixed, because they're now the *same*
mechanism, not five special cases.

**Adversarial stress: 12/12.** These hunt the bugs a dep graph usually hides,
and one of them caught a real defect in the rebuild itself:

| Test | Result |
|---|---|
| transitive chain, diamond, re-point, stale-edge teardown | ✅ |
| direct + indirect cycles → `#CIRCULAR!`, no hang | ✅ |
| range precision (inside recalcs, outside inert) | ✅ |
| cross-sheet range recalc, sheet re-add clears `#REF!` | ✅ |
| transitive volatility, `undefineName` invalidation | ✅ |
| **deep chain of 1000/50000 — no stack overflow** | ✅ *(see below)* |

The deep-chain test initially **failed** — my first pull-evaluator recursed one
JS frame per chain link and blew the stack at ~1000, surfacing as `#VALUE!`. This
is the *exact* class of bug in `findings.md` ("`#ERROR!` on the first cold read"
for ~700-deep chains). The fix: iterative **topological pre-warm** (explicit
stack, heap not call-stack), so a formula only ever reads already-cached inputs.
A 50,000-deep chain now evaluates cold in ~180ms. The stress harness caught my
own regression — which is the whole point of having it.

## What's here

| file | role |
|---|---|
| `grid.mjs`       | fixture grid + both engine adapters + result normalisation/compare |
| `corpus.mjs`     | curated findings cases + seeded random formula generator |
| `run.mjs`        | differential pass — old engine vs oracle, writes `report.md` |
| `reactivity.mjs` | reactivity pass — drives the real engine, mutate→read→assert |
| `engine2.mjs`    | the rebuilt spine: tokenizer → Pratt parser → AST → evaluator (+ `precedents()` for the dep graph) |
| `compare-engines.mjs` | head-to-head — old vs new vs oracle over one corpus |
| `sheet2.mjs`     | reactive engine on a real dependency graph (incremental invalidation + topological pre-warm) |
| `reactivity2.mjs`| reactivity head-to-head — old 3/8 vs new 8/8 |
| `stress2.mjs`    | 12 adversarial dependency-graph tests |

## Next steps (to make this the correctness gate)

- **Add a gold oracle.** HyperFormula is a fast stand-in; add LibreOffice
  headless (or Excel) as a second oracle so 2-of-3 agreement adjudicates
  automatically.
- **Grow the generator.** Add text/date/lookup/logical functions, deeper
  nesting, and reference edge cases (`$A$1`, whole-column `A:A`, cross-sheet).
- **Add a reactivity harness.** The stale-value findings (dependency tracking)
  need a *live sheet* test, not single-cell eval — separate harness.
- **Wire into CI.** Fail the build if agreement drops below the current number.
  The number only goes up from here.
