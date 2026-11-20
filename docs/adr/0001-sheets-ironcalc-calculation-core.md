---
status: accepted
---

# Use IronCalc as the Sheets calculation and document core

The Sheets rewrite adopts IronCalc, a Rust spreadsheet engine (MIT OR Apache-2.0), as
the calculation and document core. It replaces both the shipping engine
(`engine/formula.js` and `sheet.js`) and the unshipped `engine2`/`sheet2` rewrite.
Agents verified this decision by hands-on probe and source review on 2026-09-01.
IronCalc runs as `@ironcalc/wasm` in the browser and as `@ironcalc/nodejs` in a
server sidecar. Building an equivalent engine in-house would take years.

## Why

- IronCalc supports 494 Excel-conformant functions, dynamic arrays and spill,
  LAMBDA and LET, styles, conditional formatting, frozen panes, defined names,
  undo/redo, and xlsx round-trip.
- Agents measured performance across the WASM boundary (Node, M3 Pro):
  - 50x30 viewport read: 1.25 ms for values, 3.6 ms for values and styles.
  - 10k-dependent recalculation: 8.2 ms.
  - 100k-cell fill: about 250 ms.
  - WASM bundle size: 665 KB gzip.

## Key sub-decision: commands, not IronCalc's native diff format

IronCalc has a native diff mechanism (`flushSendQueue` / `applyExternalDiffs`).
We do not use it as the wire or persistence format. It encodes a private Rust
enum as opaque bitcode, and the encoding is not versioned across releases.

Instead:

- Every user action becomes a semantic JSON command.
- The server sequences commands.
- Every client applies the same commands, in the same order, to its local
  engine model.

Deterministic replay gives convergence across clients. It keeps the operation
log inspectable. It also keeps the engine swappable: the exit door is to
replay the command log into a different engine.

## Server side

A Node sidecar runs `@ironcalc/nodejs` as the authoritative model. It persists
snapshots and handles xlsx import and export. The wasm binding has no xlsx
support.

## Renderer and recalculation consequences

IronCalc exposes no changed-cell set. The canvas renderer re-reads the visible
viewport after each commit (a pull model) and caches display values and styles.
Agents measured the cached pattern in headless Chrome at devicePixelRatio 2:
engine reads cost 0.3 ms per scroll frame. Canvas paint (4.4 ms p95) is the
frame floor, not the engine.

IronCalc recalculates the whole workbook on every edit. It has no dependency
graph. Agents measured per-edit cost: ~90 ms on a cheap 100k-cell workbook,
~9 s on a 150k-cell workbook with running-SUM columns, even for an edit to a
cell that nothing references. Two consequences:

- The engine must run in a Web Worker. Commits are asynchronous; the UI never
  blocks on recalculation.
- Incremental recalculation is our top upstream contribution target. It is an
  open IronCalc issue ("use dependency DAG").

For balance: the in-house engine handles the same edit in 363 ms (referenced)
or ~0 ms (unreferenced), but needs 132 s and 8.8 GB to build its dependency
graph for that workbook shape. It cannot load what IronCalc loads in 1 s.

## Features that stay in-house

These layers sit on top of IronCalc. IronCalc does not model them:

- Pivot tables
- Charts
- Filter and sort criteria
- Data validation
- Comments
- Rich text

## Considered Options

- **Land the in-house `engine2`/`sheet2` rewrite.** Correct on its slice: about
  99.96% Excel agreement in its differential harness. Years away from 494
  functions and dynamic arrays.
- **Univer.** Apache-2.0, but it ships React and Radix inside a Vue app.
  Collaboration is a paid, closed plugin.
- **HyperFormula.** GPLv3 or commercial. License does not fit our needs.

## Consequences

- The team gains 494 Excel-conformant functions and dynamic arrays without
  building them.
- The command-log architecture adds a layer of indirection: no code path may
  call the engine directly outside the command dispatcher.
- The renderer must re-read the viewport on every commit, since IronCalc gives
  no changed-cell diff.
- Pivots, charts, filters, validation, comments, and rich text need in-house
  implementation and maintenance, since IronCalc does not cover them.
- The xlsx path depends on the Node sidecar, not the browser wasm build.

### Known risks

- IronCalc has a two-person upstream team and is pre-1.0 (v0.8.x). The 1.0
  release slipped past its mid-2025 target.
- The engine panics on some edge input. Upstream has no fuzzing yet.
- The xlsx path depends on `zip` 0.6.6, which is unmaintained.
- Merged cells exist on the IronCalc repo main branch but are not yet on npm.
- IronCalc has no batch range-read API.
- Every edit costs a full workbook recalculation. Heavy formula workbooks pay
  seconds per edit until incremental recalculation lands upstream or in a fork.

### Mitigations

- Version pinning, gated by our differential test harness.
- Snapshot and command-log recovery, if a WASM instance gets a poisoned state.
- The MIT license permits a vendored fork if upstream stalls.
