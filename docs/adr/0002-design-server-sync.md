---
status: draft
---

# Design for ADR 0002: server sync

Decision and context: [`0002-server-sync-ironcalc-on-server.md`](0002-server-sync-ironcalc-on-server.md). The calculation engine was chosen in [ADR 0001](0001-sheets-ironcalc-calculation-core.md).

Numbers are marked **(m)** measured or **(e)** estimated. Paths are relative to the suite app.

---

## Part A. Concurrency test (part of milestone 3)

- **The test:** a two-tab test in the style of `collab/glue.test.ts`.
  - Tab A inserts a row above row 5.
  - Concurrently, tab B types `=A5*2` in another cell.
  - Merge both ways. Expected result: B's formula points at the cell B meant, which is now A6.
- **If it fails**, try a fix inside Yjs sync first. For example, the tab that applies a remote structural change re-checks formulas written by ops concurrent with it, using IronCalc's own reference shifting.
- The result is recorded either way; it confirms the problem server sync fixes.

## Part B. Milestone 1: server-side values on Yjs sync

**Flow:**
1. A collaboration push lands (`suite/content/pushes.py`).
2. It enqueues `suite-calc-{site}-{sheet}` on the `long` RQ queue with `deduplicate=True`, at most every ~5–10 s per sheet **(e)**. The API and exports can also enqueue it on demand and wait.
3. The job runs a Node subprocess, the same way `convert.py` and `content/jobs.py` already run the converter:
   - load the compacted Yjs state plus later updates;
   - build the workbook with the same code browsers use (`collab/load.ts` `buildWorkbookFromDoc`, bundled for Node like `collab/converter-entry.ts`);
   - recalculate;
   - write the values.
4. The job exits, which frees its memory. The subprocess runs with a memory cap (`--max-old-space-size`).

**Storage:**
- Values go in a raw table keyed by sheet + rev, like `content/tables.py`.
- Only the latest set is kept. It's a cache, so it's left out of backups and can always be recomputed.

**Reading:** the API and exports return values together with the rev they reflect. If the stored rev is behind head, they can wait for an on-demand run.

**Engine version:**
- Use the exact `@ironcalc/wasm` file the frontend ships, plus the same TypeScript workbook code.
- The job records the build id it ran with, so values computed by an old build can be recomputed after a deploy.

**Volatile functions** (`NOW`, `TODAY`, `RAND`): the server's values are simply the server's; they aren't compared with browsers in milestone 1.

**Missing Node** (self-hosters): show the same in-app notice `convert.py` shows. Values are then unavailable, but editing is unaffected.

**Monitoring:**
- lag (head rev minus computed rev);
- job duration and memory;
- failures, which go to Error Log.

**Correctness test:** run real Excel-saved files through the job and compare each formula with the value Excel stored in the file.

**Size:** fine at today's ~100k-cell cap (~8 MB of IronCalc memory **(m)**; full recalc ~0.1 s **(m)**). Building a 2M-cell sheet from Yjs state will be measured before the cap is raised.

## Part C. Milestones 2–3: the op log and server sync

### C1. Model

**Acceptance:** the server holds one ordered log. The Python front door accepts a bundle of ops if either:
- `base_rev == head`; or
- the bundle itself contains only cell inputs and formats, and every op in `(base_rev, head]` is too. Then the bundle applies as-is.

A bundle containing any structural op (insert, delete, move, sort, sheet change) needs `base_rev == head`. So a sort's precomputed row order is never applied to a state it wasn't computed on.

The front door only looks at op types and never transforms anything. A refused bundle gets "stale, here are the ops since your base"; the browser rebases it and resends. This is the `prosemirror-collab` model, relaxed so that slow clients aren't starved while others type.

**Sending:**
- Send only when there are pending ops.
- At most one bundle in flight per client.
- Adaptive interval: ~200 ms normally, backing off to ~1 s while bundles are being refused **(e)**.
- Keep the existing fast "busy" refusal from `pushes.py`.
- Per-user rate limits, stricter for guest and public-link editors.

**Results per op:** the response says, op by op, accepted or refused and why. Valid ops in a bundle aren't lost because one op fails.

**Ordering in the browser:**
- Ops are processed strictly in rev order, whichever channel delivered them (HTTP reply, socket, catch-up fetch).
- A browser recognises its own ops in the broadcast by session + `client_seq`.
- Seq dedupe runs before the base check, so a resend of an already-accepted bundle is never applied twice.

**Optimistic vs confirmed:**
- **Cell inputs and formats show at once.**
  - When a remote op touches a cell with a pending local op, the browser applies the remote op, then re-applies its own pending op on top. For formats that are patches, the result is merged: remote italic plus local bold gives both.
  - The browser keeps a "confirmed" copy of every cell with a pending edit, updated by remote ops, so a refused op is reverted to the true current value.
- **Wait for confirmation:**
  - structural ops (insert, delete, move, sort, sheet add/rename/delete);
  - pastes that extend the sheet;
  - pastes bigger than one bundle.

  So nothing structural, and no multi-bundle action, is ever half-applied or rolled back.
- **Confirmation latency:**
  - **At launch scale, a confirmed structural op shows after the round trip plus IronCalc's row insert.** On IronCalc 0.9 wasm that's 1.2–2.0 s at 100k cells **(m, first runs, possibly ~2× inflated)**.
  - **So switching collaboration over waits for IronCalc v0.10,** whose insert fix took native 2M-cell inserts from 2.6–3.7 s to ~0.28 s **(m)**. The v0.10 wasm time will be measured.

**Same build everywhere:**
- Results depend on IronCalc and on TypeScript around it, outside the wasm:
  - `core/workbook.ts` `deleteSpan`, the range-end workaround before deletes;
  - `engine/ref-remap.ts`, which remaps conditional formats, validations, charts and named ranges.
- The calc side runs the same command layer at the same build.
- Every POST carries a protocol + build id. A mismatch, for example an old tab after a deploy, is refused with "reload".

### C2. Op format

```json
{ "op": "set_input", "sheet": "s1", "row": "r8a2k3x9", "col": "c4m1p0q2",
  "input": "=A5*2", "base_rev": 1041, "client_seq": 193, "action_id": "u7-88" }
```

- **Addressing:** cells by stable row/col ids, the ones Yjs sync already uses (`collab/schema.ts`).
- **Op types:** set input and format; insert/delete/move rows and columns; sort; sheet add/rename/delete; names; and the other sheet objects Yjs sync stores (charts, pivots, conditional formats, validations, comments).
- **`action_id`:** groups one user action, so it undoes as one step.
- **Sort:** computed after the local recalc finishes. The op carries the key spec plus the resulting row order, compressed. At 100k rows the order is ~1 MB **(e)**, so it's exempt from the normal bundle cap.
- **Bundle cap:** ~1 MiB or ~10k cells **(e)**.

### C3. Rebase rules (browser only)

| Clash | Rule |
|---|---|
| Two edits to the same cell | Later in server order wins; formats that are patches merge |
| Edit vs rows inserted above | Nothing to do; the edit follows its row id |
| Edit vs its row, column or sheet deleted | Dropped, with a notice |
| Two inserts at the same spot | Both apply, in server order |
| Insert anchored to a deleted row | Anchor moves to the nearest surviving row above |
| Sort vs pending cell edits | Edits follow their rows |
| Pending structural op vs any newer op | Recomputed on the new head and resent |

**Formulas** stay as the A1 text users type.
- **Cell formulas:** a pending formula's shifted text is read back from the browser's IronCalc, which shifted it while applying the remote structural op. That includes sheet renames.
- **Other objects that hold references:** conditional formats, validations and named ranges are read back from their local stores after `ref-remap.ts` runs. Validation criteria that hold ranges (list-from-range) are not remapped today, only their cell keys; that has to be fixed first.
- **Queued offline ops:** a shared TypeScript shift function, ~300–500 lines **(e)**, covers ops not yet in IronCalc. It's fuzz-tested against IronCalc's own shifting.

### C4. Permissions

- **Protected ranges and sheet permissions:** checked per op in Python. The front door maps row/col ids to positions with a row-order index kept on the sheet's control row.
- **Formula-type validation:** reject-type validation whose rule is a formula needs the engine. It's checked by the calc side after the fact, and violations are reported to the editor. This is stated as a limit.
- **Shifted formulas:** a formula shifted into a protected range is refused like any other edit there.

### C5. Calc on the server

**Default: the milestone 1 job, extended.** An RQ job on the `long` queue, deduplicated per sheet, debounced to a few seconds plus on demand. It loads the latest snapshot plus the log since, applies ops in rev order, recalculates, writes values and sometimes a snapshot, then exits.
- Browsers compute live values themselves, so seconds of server lag cost nothing visible.
- It runs on Frappe Cloud shared benches. A long-running daemon can't be added there: apps can't add supervisor programs.
- **A daemon only for dedicated or private benches,** where cold loads at 2M cells would matter.
- **Not inside the socket.io process:** that process is shared with other apps on the bench, and a large heap or a wasm crash there would take realtime down for everyone.

**Reading the log:** the job reads ops from MariaDB by rev and checks for gaps. Redis pub/sub is only a wake-up signal, because Frappe's Redis can lose messages and data on restart.

**One writer at a time:**
- A fencing token lives on the sheet's control row in MariaDB (`UPDATE … SET token = token + 1`).
- Value and snapshot writes compare the token in the same transaction, so an older run can't overwrite a newer one.
- Any locks go on `redis_queue`, never `redis_cache`, which evicts keys.

**Bad ops:**
- The front door never runs the engine, so an op that makes IronCalc refuse or crash can reach browsers. **The calc side's verdict is authoritative:** it writes a skip mark into the log.
- **Browsers honour skip marks on replay.**
- **A browser whose engine crashes** on an op discards that engine instance and reloads from the last snapshot plus the log. It waits for the verdict on that rev, which triggers an on-demand calc run.
- **Quarantine:** a sheet whose replay fails 3 times is quarantined (read-only, alert), following `content/quarantine.py` and `suspect.py`.
- **Browser out-of-memory** isn't deterministic across machines, so it's handled the same way, as a reload.

**Volatile functions:**
- Each rev carries a clock value. `RAND` is seeded by (rev, cell). A recalc uses the stamp of the rev it reflects.
- Drift checks compare browser and server values only at equal revs.
- This needs a small hook in IronCalc, to be requested upstream. Until then, sheets with volatile functions are left out of drift checks.

**Engine settings:** the server runs IronCalc with undo history and the send queue off or trimmed. Building a 2M-cell sheet with history grew it to ~0.9–1.1 GB **(m)**, against ~130 MB without.

### C6. Undo (per user, per session)

- **Scope:** "own changes" means this session's, so a second tab of the same user doesn't treat the first tab's edits as its own.
- **Undoing a cell edit:** restores the previous input, shifted through structural ops since (with the shift function), so a restored `=A5` still means the cell it meant. "Nobody changed it since" compares the cell's last-writer rev, not its text, because shifts change the text.
- **Undoing a row delete:**
  - re-inserts the rows with their original ids, inputs and formats;
  - restores the conditional formats, validations, names and merges the delete changed;
  - restores the formulas elsewhere that the delete turned into `#REF!`, except cells edited since.

  Everything needed is saved with the delete op. This is the hardest case and gets its own tests.

### C7. Storage

**Op log:**
- **Carried over from the content layer:** gap-free rev allocation, the hash chain, seq-based idempotency and the `lineage` check.
- **Rewritten for ops:** ingest, admission, capacity checks and compaction, which today parse Yjs structures (`pushes.py`, `capacity.py`, `compaction.py`).
- Raw tables like `content/tables.py`, so schema changes don't need long `ALTER`s on big tables during migrate.

**Snapshots:**
- Engine-neutral: cell inputs and formats keyed by row/col ids, in chunks of ~10k rows **(e)**. A 2M-cell sheet is ~18 MB **(m)**, over a single row's 4 MiB limit.
- A snapshot is a deterministic function of the log, so it can always be rebuilt.
- Keep the latest 1–2 per sheet. Trim with the existing hourly `trim_logs` job. Count everything toward the site quotas in `capacity.py`.
- An IronCalc byte snapshot may be kept as a cache, tagged with its build.

**Log retention:** at least 7 days and back to the oldest snapshot kept.

### C8. Failure modes

| Failure | What happens |
|---|---|
| Two people edit at once | Non-structural bundles both apply; a stale structural bundle is refused, rebased and resent |
| Connection drops mid-POST | Same bundle resent; `client_seq` makes it idempotent |
| Redis message lost or out of order | Everyone reads the log by rev with gap checks; Redis only wakes them |
| Calc job crashes | Next run resumes from snapshot + log; editing is unaffected |
| Op makes IronCalc refuse or crash | Skip mark from the calc side; browsers honour it; 3 failed replays → quarantine |
| Two calc runs overlap | Fencing token in MariaDB; the older run's writes are refused |
| Deploy while tabs are open | Build id mismatch → tab reloads; maintenance-mode 503 during migrate is treated like offline |
| Site restored from backup | `lineage` check; a browser whose base is ahead of head reloads |
| Base older than the log keeps | Browser reloads from the latest snapshot; pending cell edits re-applied by id; formulas it can't re-check go to a "couldn't apply" list the user can copy from |
| Browser and server values differ at the same rev | Drift alarm; the browser reloads |

### C9. Moving from Yjs sync

- **Conversion:** a one-time pure function from Yjs state to a snapshot. Ids, cells and formats carry over unchanged.
- **Rollout:** `sync_mode` flag per site; internal sites first.
- **Monitoring:** lag, refused-bundle rate, calc job duration and memory, quarantined sheets, drift alarms. Shown in a doctype or System Health, with alerts to Error Log.
- **Rollback:** Yjs state kept read-only for a period after switching, plus a reverse converter.

### C10. Load and cost

- **Web workers:** a sync gunicorn worker at ~20–50 ms per request **(e)** handles ~20–50 requests a second. Sending only when pending, one bundle in flight and the adaptive interval keep a typing editor to a few requests a second.
- **Load test:** on a small Frappe Cloud bench, not a development machine, before promising 20 editors, and again before raising to 100.
- **Plan limits:** Frappe Cloud plans have daily CPU-time limits. Calc jobs and POSTs both count, so measure the cost per active editor-hour.

### C11. Build order

1. **Before building:**
   - the concurrency test result (Part A);
   - IronCalc v0.10 measured in wasm;
   - a read-through of the Yjs sync code this replaces.
2. **First working version:**
   - front door with acceptance rules and per-op checks;
   - op log;
   - calc job on the log;
   - browser pending queue for cell edits.
3. **Production, adding:**
   - structural ops and rebase;
   - reading back references from conditional formats, validations and names;
   - undo;
   - skip marks and quarantine;
   - snapshots;
   - conversion;
   - parity and Excel-file tests;
   - rollout and monitoring.

## Part D. Numbers used

| Sheet | Edit, wasm 0.9.0 | Edit, native | Insert row | IronCalc memory |
|---|---|---|---|---|
| 100k cells, 5k formulas | ~98 ms (m) | ~14 ms (m) | 1.2 s wasm 0.9 (m); ~0.11–0.14 s native 0.9 (m) | ~8 MB (m) |
| 100k cells, 50k formulas | ~85 ms (m) | ~43 ms (m) | 2.0 s wasm 0.9 (m) | ~9 MB (m) |
| 500k cells, 250k formulas | ~484 ms (m) | ~247 ms (m) | 10 s wasm 0.9 (m) | ~47 MB (m) |
| 2M cells, 100k formulas | ~255–320 ms (m) | ~123 ms native main (m) | 3.6–6.2 s wasm 0.9 (m); ~0.28 s native main (m) | ~130 MB (m) |
| 2M cells, 1M formulas | ~850 ms (m) | ~392 ms native main (m) | ~0.56 s native main (m) | ~160–190 MB (m) |
| 2M cells + 1,000 lookups | ~12.8 s, one run (m) | ~10.8 s (m) | – | – |

- **Native vs wasm:** native is 1.2–7× faster depending on sheet shape (7× at 100k cells) **(m)**.
- **Yjs at 2M cells:** ~3.4 GB **(e)**, extrapolated from ~1.7 KB per cell measured at 180k cells.
- **Sources:** benchmarks on a 2M-cell sheet and smaller shapes, run in browser wasm and natively, in October–November 2026. First runs were inflated by machine load, so treat single numbers as ±30%.
