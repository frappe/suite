# Formula engine test corpus

Data-driven fixtures for the formula engine. `../formula.corpus.test.ts` loads
every JSON file here and turns each fixture into one Vitest case. Adding a test
means adding JSON, so several people can extend coverage without editing the
same test file.

## Layout

```text
test-corpus/
├── harness.ts             loader, runners, comparison
├── syntax.json            tokenizer and parser cases
├── arithmetic.json        precedence, associativity, coercion, boundaries
├── functions/             one file per function family
├── workbooks/             stateful cases (dependencies, recalc, structural edits)
├── compatibility/         differential cases against reference engines
├── known-differences.json accepted, intentional differences
└── failures/              raw defect records (not executed)
```

## Direct fixture

One formula, an optional backing grid, one expected value.

```json
{
  "id": "precedence-power-right-assoc-001",
  "formula": "=2^3^2",
  "cells": { "A1": 5 },
  "expected": 512,
  "category": "operator-precedence",
  "source": "excel-compatible-semantics",
  "notes": "^ is right associative in Excel and Google Sheets",
  "status": "known-failure",
  "defect": "associativity",
  "actual": 9
}
```

Optional keys: `sheets` (multi-sheet grid, overrides `cells`), `namedRanges`,
`tolerance` (absolute, for approximate functions), `notes`.

## Workbook fixture

```json
{
  "id": "dependency-diamond-001",
  "sheets": {
    "Sheet1": { "A1": 1, "B1": "=A1+1", "C1": "=A1+2", "D1": "=B1+C1" }
  },
  "actions": [{ "type": "set", "sheet": "Sheet1", "cell": "A1", "value": 10 }],
  "expected": { "Sheet1!B1": 11, "Sheet1!C1": 12, "Sheet1!D1": 23 },
  "category": "dependency",
  "source": "excel-compatible-semantics"
}
```

Actions: `set`, `clear`, `switchSheet`, `insertRow`, `deleteRow`, `insertCol`,
`deleteCol`, `renameSheet`, `deleteSheet`, `read`. Row and column operations act
on the current sheet, so switch first when a fixture uses more than one sheet.

Expected keys are `Sheet!Cell`; a bare `Cell` means `Sheet1`.

## Status

- `pass` (default) — the engine must produce `expected`.
- `known-failure` — the engine is wrong today. The runner asserts the result
  still does **not** match `expected`, and that it equals the recorded `actual`.

`known-failure` keeps the defect backlog executable and keeps CI green without
hiding anything. When a fix lands, the fixture goes red; change `status` to
`pass` and delete `actual` in the same change.

`expected` must be the value a real spreadsheet produces, never the value this
engine happens to produce. Record where it came from in `source`:

- `excel-compatible-semantics` — documented Excel/Sheets behaviour
- `ironcalc` — confirmed by the IronCalc differential harness
- `google-sheets` / `excel` / `libreoffice` — checked by hand against that product
- `engine-contract` — deliberate local behaviour with no spreadsheet analogue

## Defect labels

`parser-accepts-invalid`, `parser-rejects-valid`, `precedence`, `associativity`,
`coercion`, `error-propagation`, `function-result`, `function-arguments`,
`reference-resolution`, `dependency-missing`, `dependency-stale`,
`circular-reference`, `cache-invalidation`, `structural-edit`,
`compatibility-difference`, `unsupported-feature`, `performance`, `crash`.

## Commands

```bash
# from frontend/
yarn vitest run src/apps/sheets/engine/formula.corpus.test.ts   # corpus only
yarn vitest run src/apps/sheets                                 # everything
yarn vitest run src/apps/sheets -t "precedence"                 # one category
```

## Rules

- Fixture ids are globally unique; the loader fails on a duplicate.
- One fixture proves one thing. Minimise before adding.
- Do not edit another area's fixture file in a change that is not about it.
