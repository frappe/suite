---
status: proposed
---

# Server sync: server-ordered ops, with IronCalc on the server

Builds on [ADR 0001](0001-sheets-ironcalc-calculation-core.md), which chose IronCalc as the calculation core.
Full design: [`0002-design-server-sync.md`](0002-design-server-sync.md)

## In plain words

Sheets ships real-time collaboration on Yjs: each browser keeps its own copy of the sheet and merges other people's edits into it. The server stores and relays edits but never calculates. That has three limits:
- **No values on the server:** APIs, exports and server-side checks can't read what any formula equals.
- **Formulas vs concurrent edits:** Yjs merges data, not formulas. Reading the code, a formula typed while someone inserts a row above it can keep pointing at the old cell; M2 includes a test that confirms this.
- **Memory at size:** Yjs state grows far faster than the sheet itself (a 2M-cell sheet is estimated at ~3.4 GB in Yjs, against ~130 MB measured in IronCalc).

**Decision:** Sheets moves to **server sync**. The server puts every edit in one order, runs the same calculation engine as the browser (IronCalc), and holds the true state of every sheet. We get there in three milestones, and each one ships something useful on its own.

## Terms

- **IronCalc:** the open-source spreadsheet engine Sheets uses (Rust compiled to WebAssembly).
- **Yjs:** a CRDT library. Every browser merges edits itself, with no central order.
- **Op:** one user action sent over the network, such as "set cell X to `=A5*2`" or "insert a row after row Y".
- **Server sync:** the server orders all ops (a single server order with the browser rebasing its own edits, the `prosemirror-collab` model; the server never transforms ops), and every browser follows that order.
- **Rev:** the number the server gives each op, in order.
- **Front door:** the Frappe API endpoint that receives ops, checks them and gives them their rev.

## Decision: the target architecture

```
Browser                                      Server (Frappe)
───────                                      ───────────────
Grid + IronCalc in a Web Worker              Front door (Python): permission checks per op,
Pending edits: cell edits show at once;         accepts ops built on the latest version,
  inserts/deletes/sorts after confirmation      gives each the next rev, stores it
        │  ops up (HTTP, bundled) ──────────►            │
        │  ◄──────── confirmed ops (socket.io)           ▼
                                             Calc job (Node, same IronCalc build): applies
                                                ops in rev order, writes values + snapshots
                                             MariaDB: op log + snapshots
```

How it works:
- **One order:** the server accepts a bundle of ops if it was built on the latest version. A bundle of plain cell edits is also accepted when only cell edits happened in between. Anything else goes back to the browser, which adjusts it to the new version and resends. All adjusting happens in one place, the browser.
- **Cells keep stable ids:** cells are addressed by row and column ids, not positions. An edit stays with its row when rows move, so most concurrent edits need no adjusting at all.
- **Formulas stay correct:**
  - **Formulas stay as the text users type.** When a row is inserted, a pending formula is shifted the way Excel shifts formulas, by the browser's own IronCalc, before it's sent.
  - **Inserts, deletes and sorts show once the server confirms them,** so nothing structural ever has to be rolled back.
- **Same engine both sides:** the server runs the same IronCalc build as the browser, inside a short background job, a pattern Frappe Cloud and self-hosters already run. Browsers compute values themselves for instant feedback. The server's values are the truth for APIs, exports and drift checks (comparing browser and server results to catch divergence). Server values lag a few seconds and carry the rev they reflect; an API call can ask for a fresh run.
- **Built to fail safely:**
  - the server reads ops from the database, never trusting Redis to deliver them;
  - one calc run writes at a time, guarded by a token in MariaDB;
  - an op that breaks the engine becomes a recorded skip everywhere;
  - tabs left on an old build after a deploy reload instead of drifting.

The full design covers the op format, rebase rules, undo, permissions, snapshots, the failure table and load cost.

## Delivery: three milestones

**M1: server values on today's collaboration.**
- A background job loads a sheet's current state into IronCalc in Node, recalculates, and stores the values with the rev they reflect.
- APIs and exports read them. Collaboration itself is untouched.
- *Checkpoint:* server values match the values Excel saved in real Excel files.

**M2: the ordered op log.**
- The front door, the op log, the calc job reading it, and the browser's pending-edit queue, behind a flag on internal sheets.
- *Checkpoints:*
  - browser and server give identical results after thousands of random ops;
  - a two-user test of "formula typed during a row insert" passes on server sync. The same test records how Yjs sync behaves.

**M3: switch collaboration to server sync.**
- Convert existing sheets: a mapping, since row and column ids carry over.
- Roll out per site with the `sync_mode` flag, internal sites first, and a way to switch back.
- *Checkpoints:*
  - row insert at 100k cells under 500 ms in the browser on IronCalc v0.10;
  - a 20-editor load test on a real Frappe Cloud bench: 95% of edits confirmed within 300 ms, with headroom left on the bench's web workers.

**After launch:** raise the limits towards 2M cells (when IronCalc's incremental recalculation lands) and 100 editors (after a load test).

## Why this architecture

- **One order is what production spreadsheets use.** Google Sheets compiles one calc engine for both server and browser. Quadratic ran the same Rust core on its server as in its browser. We found no production spreadsheet grid that uses a CRDT like Yjs for cells.
- **It fixes what Yjs can't:** formulas against concurrent row changes, server-side values, and memory at size.
- **Why before sheets get big:** at today's 100k-cell limit Yjs memory is fine (~170 MB estimated). There the case is correctness (one order for formulas and structure) and one source of truth; size is what it unlocks next.
- **Ops ride on what exists:** they reuse the collaboration storage already built (numbered revs, integrity checks, safe resends) and Frappe's normal HTTP and socket.io paths.

Rejected:
- **Keeping Yjs and patching around it:** we expect it can't make formulas and row changes agree reliably, since Yjs has no single order to shift formulas against (M2's test checks this), and the memory problem grows with sheet size.
- **Server-only calculation with thin browsers:** every keystroke would wait for a round trip.
- **A long-running calc service:** Frappe Cloud's shared benches can't host one. A short background job gives the same result.
- **Adjusting late ops on the server:** that logic would have to exist twice, in TypeScript and in Python.

## Engine: IronCalc

Five options were benchmarked on the same 2M-cell sheet.

| Engine | Edit at 2M cells | Why / why not |
|---|---|---|
| **IronCalc** | ~0.3 s in the browser (recalculates everything) | dynamic arrays and spills, xlsx import/export, MIT/Apache, a funded company, in production as a server-side engine; incremental recalculation in progress upstream |
| HyperFormula | 15 ms | no real dynamic arrays, no xlsx, GPL with a vendor FAQ asking commercial users to pay |
| Formualizer | 1.4 ms | no production users found, one maintainer |
| Univer | ~0.6 s (reported) | xlsx and server calculation are in the paid tier |
| SpreadJS, Aspose | – | closed source; can't ship in an AGPL product |

- IronCalc is slower per edit until its incremental recalculation lands; at today's sheet sizes an edit takes ~0.1 s.
- Most engine-specific code sits behind one small interface, so a future engine means mainly one new implementation and the same tests. Formula reference shifting, which leans on IronCalc's own shifting, is the main exception.

## Product decisions

- **Offline:** short offline, up to about a day. Edits queue while disconnected, are adjusted on reconnect, and edits on deleted rows are dropped with a notice.
- **Undo:** per user and per tab, as today. Ctrl+Z undoes only your own changes and never a colleague's.
- **Sheet size:** today's limit (~100k cells) at launch. The goal is 2M cells.
- **Editors per sheet:** 20 at launch. The goal is 100.
- **Names:** "Yjs sync" for what ships now; "Server sync" for this. The flag is `sync_mode`.

## Work behind this decision

All numbers in this ADR and its design doc come from benchmarks on a 2M-cell sheet and smaller shapes, run in browser wasm and natively, in October–November 2026.

- **IronCalc measured** on sheets from 100k to 2M cells, in the browser and natively, covering memory, edit cost, row insert, and snapshot size and format.
- **Slow row insert traced** to the row shift inside IronCalc and shared with its maintainer as reproducible test files. The upstream fix (IronCalc PR #1622) took a 2M-cell row insert from ~2.6–3.7 s to ~0.28 s natively.
- **Five engine options benchmarked** on one sheet shape (edit, insert, delete, memory, a lookup-heavy case), plus licence and production-use checks across more than ten engines.
- **How Google Sheets, Excel, Quadratic, Univer and Grist handle calculation and collaboration** compared from published sources.
- **The design went through several review passes** on sync correctness and Frappe platform fit; the design doc's failure table and load section came out of them.

## Risks and open questions

- **Row inserts:** on IronCalc's current release they take 1–2 s in the browser even at 100k cells (first-run measurements, possibly up to 2× inflated by machine load). M3 waits for v0.10.
- **Volatile functions** (`NOW`, `RAND`) need a small IronCalc hook (a shared clock and seed per rev) before browsers and server agree on them. Until then, those sheets are left out of drift checks.
- **Engine maturity:** IronCalc is pre-1.0, which is why M1's Excel-file check exists and runs again on every upgrade.
- **Translated function names** and decimal commas: the locale plan is still open.

## What would change this

- IronCalc does badly against real Excel files.
- Another engine matures with incremental recalculation, spills, xlsx and a compatible licence.
- Load tests show the HTTP and socket.io path can't keep up. That would change the transport, not the model.

## Feedback

If you see a simpler way, or a case this gets wrong, please comment. Concrete failure cases help most. I'll take up every point in December, when the engine landscape also gets re-checked.
