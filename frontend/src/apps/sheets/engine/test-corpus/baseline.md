# Formula engine baseline

Recorded before the test campaign changed anything. Commit `1c8b28e27`.

## Test command

Run from `apps/suite/frontend`:

```bash
yarn vitest run src/apps/sheets                                   # whole app
yarn vitest run src/apps/sheets/engine                            # engine only
yarn vitest run src/apps/sheets/engine/formula.corpus.test.ts     # corpus only
```

`yarn test` runs every app in the workspace, so the campaign uses the scoped
commands above.

## Starting state

| Measure | Value |
| --- | --- |
| Test files | 22 |
| Tests | 595 |
| Failures | 0 |
| Duration | 2.8 s |

`vitest.config.ts` includes `src/**/*.test.ts` only, so `engine/clipboard.test.js`
never runs. That is a pre-existing gap, unrelated to the formula engine.

No coverage provider is installed (`@vitest/coverage-v8` is absent), so the
campaign measures coverage by function inventory instead of line coverage.

## Modules under test

| File | Lines | Role |
| --- | --- | --- |
| `engine/formula.js` | 1180 | tokenizer, recursive-descent parser, 162 built-ins |
| `engine/sheet.js` | 452 | cell storage, evaluation, memo cache, structural edits |
| `engine/deps.js` | 164 | dependency graph, reverse edges, BFS cascade |
| `engine/formula-adjust.js` | 54 | reference shifting for fill and paste, sheet rename |
| `engine/named-ranges.js` | 153 | named-range bindings |
| `engine/sparkline.js` | 104 | sparkline specs |

## Exported API

- `formula.js` — `tokenize`, `evaluate`, `getFunctionNames`, `getFunctionHint`
- `sheet.js` — `createSheet`, returning `setCell`, `batchSetCells`, `getCell`,
  `getDisplayValue`, `getCellValue`, `getRangeValues`, sheet management, row and
  column operations, `snapshot`, `restore`, `setNamedRangeResolver`,
  `invalidateMemo`, `_memoStats`, `_resetMemoStats`
- `deps.js` — `createDepsEngine`, returning `register`, `getDependents`, `rebuild`
- `formula-adjust.js` — `adjustFormula`, `renameSheetInFormula`

`_memoStats` and `_resetMemoStats` make cache behaviour directly testable.

## Function inventory

162 built-ins. `formula.test.ts` calls 153 of them at least once.

Never called by any test:

```text
CLEAN  HOUR  MINUTE  NOW  NUMBERVALUE  RAND  RANDBETWEEN  SECOND  TODAY
```

A call is not coverage. No function has tests for the full matrix the campaign
requires (minimum arguments, extra arguments, wrong types, error inputs,
boundaries). Phase 6 builds that matrix.

## Grammar as implemented

Precedence, loosest to tightest, from `createParser`:

```text
comparison   =  <>  >  <  >=  <=      left, chained
concat       &                        left
add          +  -                     left
mul          *  /                     left
pow          ^                        NOT a loop — handles one operator only
unary        -x  +x  x%               prefix does not recurse; % applies once
primary      literal | ref | range | call | ( expr ) | name
```

Two structural gaps are visible in this table alone:

- `pow` reads a single `^` and returns, so `2^3^2` evaluates `2^3` and abandons
  the rest of the expression.
- `unary` calls `primary`, not itself, so a prefix operator cannot stack, and it
  checks for `%` only on the path that had no prefix operator.

Neither `evaluate` nor `createParser` checks that the token stream was fully
consumed. Any expression that stops early returns a partial result instead of an
error. That single omission turns both gaps above, and every trailing-garbage
typo, into a silent wrong answer.

The tokenizer's final branch consumes an unrecognised character and emits no
token, so stray punctuation disappears rather than failing.

## Confirmed at baseline

These ran against the unmodified engine. Each has a fixture in the corpus.

| Formula | Engine | Spreadsheet | Class |
| --- | --- | --- | --- |
| `=2^3^2` | 8 | 512 | associativity |
| `=--1` | -0 | 1 | precedence |
| `=-5%` | -5 | -0.05 | precedence |
| `=5%%` | 0.05 | 0.0005 | precedence |
| `=$A$1` | `#NAME?` | cell value | reference-resolution |
| `=A$1` | `#NAME?` | cell value | reference-resolution |
| `="a"=0` | TRUE | FALSE | coercion |
| `=1="1"` | TRUE | FALSE | coercion |
| `="apple">1` | FALSE | TRUE | coercion |
| `=(1/0)>1` | FALSE | `#DIV/0!` | error-propagation |
| `="x"&(1/0)` | `x#DIV/0!` | `#DIV/0!` | error-propagation |
| `=1 2` | 1 | error | parser-accepts-invalid |
| `=1+2)` | 3 | error | parser-accepts-invalid |
| `=1@2` | 1 | error | parser-accepts-invalid |
| `="abc` | `abc` | error | parser-accepts-invalid |
| `=1.2.3` | 1.2 | error | parser-accepts-invalid |
| `=SUM(1,2) 5` | 3 | error | parser-accepts-invalid |

Broken absolute references are the highest-impact item here. `$` is the
documented way to pin a reference during fill and paste, `formula-adjust.js`
already implements `$` handling for shifting, and the autocomplete UI offers the
syntax — but the evaluator cannot read it back.

## Corpus harness

`test-corpus/harness.ts` loads every JSON fixture and runs it through the real
`createSheet` engine. `formula.corpus.test.ts` turns each fixture into one
Vitest case. See `test-corpus/README.md` for the fixture format and the
`known-failure` convention.

Seed corpus: 74 fixtures, all green.
