# Formula Engine Test Campaign

## Goal

Find and classify defects in these areas:

- Tokenization and parsing
- Operator precedence and numeric behavior
- Built-in formula functions
- Cell references and ranges
- Dependency tracking and recalculation
- Formula adjustment after structural changes
- Compatibility with Excel-like engines
- Performance and stability

The campaign must produce reproducible tests, not only bug reports.

## Success criteria

The campaign completes when it produces:

- A documented formula grammar
- A test matrix for all supported syntax
- Direct unit tests for every built-in function
- Property tests for parsing and arithmetic
- Sheet-level tests for dependencies and recalculation
- Differential results from IronCalc
- Confirmed regression tests for each valid defect
- A compatibility report with known differences
- A list of unsupported features
- Repeatable CI commands

## Team structure

Use one lead agent and three subagents per wave. Four agents can work at the same time.

### Lead agent

The lead agent owns coordination and integration.

Responsibilities:

- Create shared test formats.
- Assign work without overlap.
- Review each reported difference.
- Run the full suite after each wave.
- Separate engine defects from unsupported features.
- Merge tests only after independent reproduction.
- Maintain the final compatibility report.

### Parser agent

The parser agent owns lexical and grammar tests.

Scope:

- Tokens
- References
- Strings
- Operators
- Parentheses
- Function calls
- Invalid syntax
- Full token consumption
- Formula fuzzing

### Arithmetic agent

The arithmetic agent owns mathematical semantics.

Scope:

- Operator precedence
- Associativity
- Unary operators
- Percent
- Numeric coercion
- Floating-point behavior
- Mathematical functions
- Boundary values

### Workbook agent

The workbook agent owns stateful engine behavior.

Scope:

- Dependencies
- Recalculation
- Circular references
- Caching
- Cross-sheet references
- Named ranges
- Copy and fill
- Row and column changes

Later waves replace these roles with function-family and compatibility agents.

## Shared artifacts

Create these files before the first testing wave:

```text
engine/test-corpus/
├── README.md
├── syntax.json
├── arithmetic.json
├── functions/
├── workbooks/
├── compatibility/
├── known-differences.json
└── failures/
```

Use one fixture format for direct formula cases:

```json
{
  "id": "precedence-unary-power-001",
  "formula": "=-2^2",
  "cells": {},
  "expected": -4,
  "category": "operator-precedence",
  "source": "excel-compatible-semantics",
  "notes": ""
}
```

Use a workbook fixture for stateful cases:

```json
{
  "id": "dependency-diamond-001",
  "sheets": {
    "Sheet1": {
      "A1": 1,
      "B1": "=A1+1",
      "C1": "=A1+2",
      "D1": "=B1+C1"
    }
  },
  "actions": [
    { "type": "set", "sheet": "Sheet1", "cell": "A1", "value": 10 }
  ],
  "expected": {
    "Sheet1!B1": 11,
    "Sheet1!C1": 12,
    "Sheet1!D1": 23
  }
}
```

Each failure record must contain:

- A minimal formula or workbook
- The actual result
- The expected result
- The comparison engine result
- Reproduction commands
- The suspected component
- The defect classification
- A regression test status

## Defect classifications

Use these labels consistently:

- `parser-accepts-invalid`
- `parser-rejects-valid`
- `precedence`
- `associativity`
- `coercion`
- `error-propagation`
- `function-result`
- `function-arguments`
- `reference-resolution`
- `dependency-missing`
- `dependency-stale`
- `circular-reference`
- `cache-invalidation`
- `structural-edit`
- `compatibility-difference`
- `unsupported-feature`
- `performance`
- `crash`

## Phase 1: Establish the baseline

### Lead agent tasks

1. Find the package-level test command.
2. Run all existing tests.
3. Record the test count and duration.
4. Record any existing failures.
5. Measure coverage for the formula modules.
6. List all exported formula APIs.
7. List all built-in functions.
8. Map each built-in function to existing tests.
9. Create the shared fixture format.
10. Add a test helper that reads corpus files.

### Deliverables

- `baseline.md`
- A function coverage table
- A syntax coverage table
- A passing corpus loader
- A stable test command

Do not start differential testing before the baseline passes.

## Phase 2: Static design audit

Run three agents in parallel.

### Parser agent tasks

1. Write the grammar implemented by `createParser()`.
2. Compare that grammar with the tokenizer output.
3. Find tokens that the parser does not handle.
4. Find parser branches that leave tokens unread.
5. Find invalid characters that the tokenizer ignores.
6. Find ambiguous identifiers.
7. Find unsupported absolute-reference forms.
8. Record each suspicion as a test case.

### Arithmetic agent tasks

1. Extract the precedence levels from the parser.
2. Record operator associativity.
3. Inspect all numeric coercion helpers.
4. Inspect error propagation in every operator.
5. Inspect rounding and date arithmetic.
6. Record each suspicious behavior as a test case.

### Workbook agent tasks

1. Map formula evaluation through the sheet engine.
2. Map dependency registration and invalidation.
3. Inspect cross-sheet dependency behavior.
4. Inspect whole-column dependencies.
5. Inspect cache behavior for volatile formulas.
6. Inspect circular-reference detection.
7. Inspect formula adjustment logic.
8. Record each suspicion as a workbook test.

### Lead agent tasks

1. Remove duplicate findings.
2. Assign a severity to each suspicion.
3. Convert each suspicion into an executable test.
4. Do not fix defects during this phase.

## Phase 3: Deterministic parser tests

The parser agent owns this phase.

### Token tests

Add exact token-stream tests for:

- Integers and decimals
- Scientific notation
- Strings
- Escaped quotes
- Preserved backslashes
- Booleans
- Error literals
- Function names
- Named ranges
- A1 references
- Absolute references
- Mixed references
- Same-sheet ranges
- Cross-sheet references
- Quoted sheet names
- Escaped apostrophes
- Whole-column references
- Commas and semicolons
- Every operator

### Valid syntax tests

Test:

- Nested parentheses
- Nested calls
- Empty strings
- Long argument lists
- Deep reference chains
- Whitespace at every legal boundary
- Lowercase and mixed-case input
- Reversed ranges
- Cross-sheet range forms
- Named ranges that resemble columns

### Invalid syntax tests

Test:

- Missing operands
- Missing function arguments
- Missing closing parentheses
- Extra closing parentheses
- Trailing operators
- Trailing literals
- Adjacent literals
- Unknown punctuation
- Invalid ranges
- Invalid sheet references
- Invalid numeric literals
- Unterminated strings
- Unterminated sheet names
- Extra commas
- Empty argument positions

Every invalid formula must return a documented error. It must not return a partial result.

## Phase 4: Property-based parser testing

Add `fast-check` or an equivalent property-testing library.

### Generator design

Generate an expression tree first. Then print the tree as a formula.

Include these nodes:

- Number
- String
- Boolean
- Unary operator
- Binary operator
- Parenthesized expression
- Function call
- Cell reference
- Range reference

Limit tree depth during normal CI. Run deeper cases in nightly CI.

### Properties

Test these properties:

1. Tokenization never hangs.
2. Evaluation never throws.
3. Valid formulas consume every token.
4. Added outer parentheses preserve the result.
5. Legal whitespace preserves the result.
6. Identifier case preserves the result.
7. A tokenizer round trip preserves token meaning.
8. Invalid token insertion causes an error.
9. Evaluation completes within a time limit.
10. A minimized failure remains reproducible.

Store each random seed when a property fails.

## Phase 5: Arithmetic conformance

The arithmetic agent owns this phase.

### Precedence matrix

Test every pair of operators. Include parentheses around each possible grouping.

Start with:

```text
-2^2
(-2)^2
2^-2
2^3^2
(2^3)^2
2^(3^2)
1+2*3
1*2+3
1+2&3
1&2+3
50%^2
-5%
1<2=TRUE
```

### Numeric coercion matrix

Use each value type in both operand positions:

- Integer
- Decimal
- Zero
- Negative zero
- Empty cell
- Empty string
- Numeric string
- Text string
- Boolean
- Error
- Range
- Sparkline result

Test every arithmetic and comparison operator against this matrix.

### Boundaries

Test:

- Division by positive and negative zero
- Overflow
- Underflow
- Large exponents
- Invalid roots
- Invalid logarithms
- Rounding at decimal boundaries
- Floating-point cancellation
- Very large range aggregates
- NaN and infinity containment

Use exact comparisons when spreadsheet rules require exact results. Use a documented tolerance for approximate functions.

## Phase 6: Built-in function campaign

Replace the initial agents with three function-family agents.

### Agent A

Test:

- Math
- Trigonometry
- Statistics
- Aggregates

### Agent B

Test:

- Text
- Logical
- Information
- Error functions

### Agent C

Test:

- Date and time
- Lookup and reference
- Financial
- Array functions
- Sparkline

### Test matrix for each function

Each function needs tests for:

- Minimum arguments
- Maximum arguments
- Missing arguments
- Extra arguments
- Correct scalar inputs
- Correct range inputs
- Empty inputs
- Text inputs
- Boolean inputs
- Error inputs
- Boundary values
- Nested calls
- Cross-sheet inputs
- Known compatibility examples

Add one test for every documented error outcome.

Track test status in a generated function table:

```text
Function | Basic | Arguments | Types | Errors | Boundaries | Differential
```

## Phase 7: Workbook and dependency campaign

The workbook agent owns this phase.

### Dependency shapes

Test:

- A direct dependency
- A long chain
- A diamond
- A wide fan-out
- A wide fan-in
- A same-sheet range
- A cross-sheet range
- A whole-column reference
- A named range
- A self-reference
- A multi-cell cycle
- A cross-sheet cycle

### Mutation sequence

For each shape:

1. Read every result.
2. Change a source cell.
3. Read every result again.
4. Replace a formula with a literal.
5. Restore the formula.
6. Clear a source cell.
7. Restore the source cell.
8. Verify every dependent result.

### Cache checks

Instrument memo hits and misses.

Verify:

- An unchanged formula uses the cache.
- A source edit invalidates all transitive dependents.
- An unrelated edit preserves cached results.
- A formula edit invalidates its old dependency edges.
- A volatile formula bypasses the cache.
- A cross-sheet edit invalidates remote dependents.
- A named-range edit invalidates affected formulas.

### Structural changes

Test:

- Copy
- Cut
- Paste
- Fill down
- Fill right
- Row insertion
- Row deletion
- Column insertion
- Column deletion
- Sheet rename
- Sheet deletion
- Named-range rename
- Named-range deletion

Cover relative, absolute, and mixed references in every operation.

## Phase 8: Differential testing with IronCalc

Create a separate compatibility agent.

### Harness

The harness must run the same fixture through:

- This formula engine
- IronCalc
- Optional LibreOffice
- Optional Excel fixture results

Normalize results before comparison.

Normalize:

- Error names
- Empty values
- Date representations
- Boolean representations
- Floating-point precision
- Array shapes
- Locale settings

### Comparison policy

Classify each difference as:

- Confirmed local defect
- Confirmed IronCalc defect
- Intentional product difference
- Unsupported local feature
- Unsupported IronCalc feature
- Inconclusive
- Locale-dependent result

Never assume IronCalc is correct because it differs.

Confirm high-impact differences with Excel or Google Sheets. Use LibreOffice as another automated reference.

### Corpus sources

Use:

- The current 251 tests
- New deterministic tests
- Minimized property-test failures
- IronCalc test formulas
- Public spreadsheet compatibility fixtures
- Real formulas from anonymized workbooks
- Generated formulas

Check the source license before copying external fixtures. Record the source and license in each imported fixture set.

## Phase 9: Stateful differential testing

Basic formula comparison does not test recalculation.

Generate an initial workbook and a sequence of edits:

```text
set value
set formula
evaluate
change source
evaluate
insert row
evaluate
rename sheet
evaluate
```

Run the same sequence in both engines.

Compare all affected cells after each action. Save the full action sequence when results differ.

Minimize failures by removing:

1. Unrelated sheets
2. Unrelated cells
3. Unrelated actions
4. Formula branches
5. Function arguments

The final failure should contain the smallest workbook and action sequence.

## Phase 10: Performance and stability

Assign one agent to stress tests.

Test:

- Deep expression nesting
- Long dependency chains
- Large dependency fan-out
- Large ranges
- Whole-column ranges
- Many cross-sheet references
- Repeated volatile formulas
- Large imports
- Repeated structural edits
- Large invalid formulas

Measure:

- Parse time
- Evaluation time
- Recalculation time
- Dependency registration time
- Memory growth
- Stack depth
- UI notification count

Set generous regression limits. Do not use exact timing assertions in shared CI.

Add hard checks for:

- Crashes
- Infinite loops
- Stack overflows
- Unbounded memory growth
- Quadratic behavior in common operations

## Phase 11: Defect confirmation

Use two agents for each candidate defect.

### Reproducer agent

The reproducer agent must:

1. Reproduce the result from a clean test run.
2. Minimize the formula or workbook.
3. Confirm the expected spreadsheet behavior.
4. Add a failing regression test.
5. Record the exact command.

### Reviewer agent

The reviewer agent must:

1. Run the reproducer test independently.
2. Check the expected result source.
3. Check for intentional product differences.
4. Check nearby cases.
5. Approve or reject the defect classification.

The lead agent only accepts a defect after both agents agree.

## Phase 12: Fix workflow

Use a separate change for each defect family.

For each fix:

1. Keep the regression test failing.
2. Change the smallest relevant component.
3. Run the focused test.
4. Run related formula tests.
5. Run sheet integration tests.
6. Run property tests with fixed seeds.
7. Run the full suite.
8. Run differential cases for that feature.
9. Update the compatibility report.

Do not combine parser, function, and dependency fixes unless they share one root cause.

## Continuous integration

### Pull request checks

Run:

- Existing formula tests
- New deterministic tests
- A small property-test sample
- Sheet dependency tests
- Saved differential regressions
- Type checks and lint checks

Keep this job deterministic and reasonably fast.

### Nightly checks

Run:

- Large property-test samples
- IronCalc differential tests
- Stateful workbook fuzzing
- Performance tests
- Large-range tests
- Tests with many random seeds

Upload these artifacts:

- Failed seeds
- Minimized formulas
- Minimized workbooks
- Result differences
- Timing reports
- Function coverage reports

### Weekly checks

Run:

- LibreOffice comparison
- Excel fixture comparison
- External corpus updates
- Long stress tests
- Full compatibility report generation

Pin every comparison engine version. Version changes can alter expected results.

## Agent handoff format

Each subagent must return:

```text
Scope:
Files inspected:
Tests added:
Commands run:
Failures found:
Confirmed defects:
Unconfirmed differences:
Unsupported features:
Artifacts:
Recommended next work:
```

A subagent must not edit another agent's assigned test file.

Use separate files by area:

```text
formula.tokenizer.test.ts
formula.parser.test.ts
formula.precedence.test.ts
formula.coercion.test.ts
formula.functions.math.test.ts
formula.functions.text.test.ts
formula.functions.lookup.test.ts
sheet.dependencies.test.ts
sheet.structural-formulas.test.ts
formula.differential.test.ts
formula.property.test.ts
formula.performance.test.ts
```

## Execution waves

### Wave 1

- Lead: baseline and shared harness
- Agent 1: parser audit
- Agent 2: arithmetic audit
- Agent 3: dependency audit

### Wave 2

- Lead: integrate fixtures
- Agent 1: tokenizer and parser tests
- Agent 2: precedence and coercion tests
- Agent 3: dependency and cache tests

### Wave 3

- Lead: property-test infrastructure
- Agent 1: math and statistics functions
- Agent 2: text and logical functions
- Agent 3: lookup, date, financial, and array functions

### Wave 4

- Lead: IronCalc harness
- Agent 1: deterministic differential corpus
- Agent 2: generated differential corpus
- Agent 3: stateful workbook comparison

### Wave 5

- Lead: defect triage
- Agent 1: reproduce parser defects
- Agent 2: reproduce function defects
- Agent 3: reproduce workbook defects

### Wave 6

- Lead: final report
- Agent 1: performance tests
- Agent 2: unsupported-feature inventory
- Agent 3: compatibility documentation

## Final outputs

The campaign must produce:

- A passing deterministic suite
- A repeatable fuzzing suite
- A repeatable IronCalc comparison harness
- Minimized regression tests for confirmed defects
- A function coverage report
- A syntax coverage report
- A compatibility report
- A performance baseline
- A ranked defect backlog

Rank defects by:

1. Silent wrong result
2. Stale recalculation
3. Data-dependent wrong result
4. Invalid formula accepted
5. Valid formula rejected
6. Crash or freeze
7. Compatibility difference
8. Unsupported feature
