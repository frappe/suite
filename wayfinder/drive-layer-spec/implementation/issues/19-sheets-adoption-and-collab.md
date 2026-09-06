# 19 — Move Sheets lifecycle and collaboration checks into Drive

**What to build:** Use Drive permissions for Sheets documents, operation records, and live collaboration.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** done

**Owner:** Suite Sheets

**Starting revision:** Suite `d7bf210b071e7d4ffb32b75b5ed0802b4f7f053b`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Final revision:** Suite `9e064776c`, the last change to code or tests. The
closeout after it is documentation only. Frappe
`e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/sheets/drive.py`, `suite/sheets/collab.py`,
`suite/sheets/permissions.py`, `suite/sheets/trash.py`, `suite/sheets/api.py`,
`suite/sheets/doctype/sheet/sheet.py`, `suite/sheets/doctype/sheet/sheet.json`,
`suite/sheets/tests/*`, `suite/sheets/collab-server/*`, `suite/hooks.py`,
`suite/tests/test_architecture.py`, and this ticket.

Four existing Sheets test modules were updated, not replaced:
`test_permissions.py`, `test_collab.py`, `test_api_security.py`, and
`test_share_notify.py`. Every guard and endpoint now reads the node column
first, so each of those tests had to say which side it exercises.

This ticket also changes ticket 16's files: `suite/drive/_core/nodes.py` and
`suite/drive/__init__.py`. Recorded as a deviation from the plan's file
ownership, not hidden. Reason: §10.1 declares `import_from_file` and no Drive
workflow calls it. An app cannot implement "an xlsx becoming a sheet" against a
callback nobody invokes, and an app may not read a `Drive Node` blob itself
(ARCHITECTURE.md rule 2.2). Ticket 18 amended the same three files for the same
reason with `adopt_media`.

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.7, §10.7 Sheet; §14.6.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Scope: this is the expand phase

The README stages registry activation and permission-hook changes until the node
links exist. Ticket 29 makes those changes, after Build. So this ticket ships
everything Sheets needs and activates none of it:

| Ships here | Waits |
|---|---|
| `suite/sheets/drive.py`: `SPEC` and every callback | — |
| The `node` Link on `Sheet`, and the `DriveContent` mixin | — |
| Drive-native create, copy, xlsx import, version bytes, restore, purge, media discovery | — |
| `drive.import_document` and `drive.read_file` | — |
| Link credentials, the 20-item limit, and the five-minute recheck in collab | — |
| Server-controlled Guest identity | — |
| `drive_content_types = ["suite.sheets.drive.SPEC"]` | 29 |
| Both `Sheet` permission hooks pointing at `suite.drive.framework` | 29 |
| The `Sheet Op Log` and `Sheet Collab State` satellite hooks | 29 |
| Legacy `File` backing, the DocShare endpoints, the Sheets trash | 23, 34 |
| Dropping `title`, `trashed`, `trashed_on`, `trashed_by`, `head_snapshot` | Cleanup, §14.10 |
| Dropping `Sheet Snapshot` and `suite/sheets/trash.py` | Cleanup, §14.10 |

## Acceptance criteria

- [x] Declare Sheet, Sheet Op Log, and Sheet Collab State through the content contract.
- [x] Implement create, copy, xlsx import, version bytes, restore, purge, and media discovery.
- [x] Replace separate share/trash enforcement and retain migration source snapshots and fields until Cleanup.
- [x] Keep default_export=None. Sheet bodies remain free; version blobs and media remain charged.
- [x] Update both Frappe access checks and the repository-owned collaboration server to carry relevant link credentials.
- [x] Reject more than 20 supplied credentials. EDIT permits writing; READ/COMMENT permits read-only; below READ refuses.
- [x] Recheck each live connection every five minutes. Disconnect revoked or expired access, and enforce downgrades.
- [x] Use server-controlled Guest identity. Do not restart collaboration services as part of implementation.

## Verification

Run Sheets and collaboration-server tests with fake time, revocation, expiry, downgrade, Guest tokens, Satellite queries, and version restoration.

## Completion evidence

Claimed 2026-09-06. Closed 2026-09-06. Every acceptance criterion is met and
every box is checked.

The two `IntegrationTestCase` classes ran green on `slides.localhost`. Gate step
7 ran against a real `@hocuspocus/server` and found the binding broken; it is
repaired and pinned. Gate steps 6 and 9 became tests. One gate step stays
unrun: step 8, the live browser revocation. It is a ticket 34 handoff
rather than a ticket 19 blocker. **Why step 8 does not block** is argued under
[The site gate](#the-site-gate).

Nothing here is safe to activate: `drive_content_types` stays empty and ticket
29 owns the switch.

### Commits

| Commit | What |
|---|---|
| `6aa145536` | Claim the ticket and stage its scope |
| `f57b3a8cd` | `drive.import_document` and `drive.read_file` |
| `b9d4505db` | The Sheets declaration, the `node` Link, and the mixin |
| `255fa572b` | Staged `Sheet` guards and the legacy-path refusals |
| `0895495bf` | Collab access from Drive, and the five-minute recheck |
| `e05ad41cb` | The three new test suites and the debt baseline |
| `f6c720707` | Review fix: keep every legacy right on the open `Sheet` row |
| `81846e831` | Review fix: `drive.check` refuses a write on a trashed node |
| `40991a192` | Review fix: read the stored node, exempt an operator first |
| `f76d6c55f` | Review fix: bound the xlsx import, fix merge attribution |
| `88c92650f` | Review fix: a restore drops the collaborative document |
| `fe122fe8a` | Review fix: refuse a Guest on a legacy sheet, do not throw |
| `7150208c1` | Review fix: bound what the collab server accepts and survives |
| `a252f406a` | Gate step 7a: pin the collab server dependency tree |
| `e2b7ae846` | Gate step 7b: bind the recheck to the connection hocuspocus gives |
| `f9a23c268` | Gate step 9 fix: a sheet owner may take back the share they granted |
| `9e064776c` | Gate steps 6 and 9 as tests, and fixture cleanup that leaves no rows |

`a252f406a` and `e2b7ae846` are `73b6b3d14` and `679b67b10` from
`fix/drive-19-hocuspocus-runtime`, cherry-picked. Verified content-identical at
closeout: `git diff 679b67b10 main -- suite/sheets/collab-server/` is empty, and
all seven files match byte for byte. The runtime evidence those commits carried
in `58b5095a1` is merged into this ticket below; that documentation commit was
not itself cherry-picked.

### What changed

**The declaration** (`suite/sheets/drive.py`). One `ContentTypeSpec`:
`create_empty`, `duplicate`, `import_from_file`, `version_bytes`,
`restore_version`, `on_purge`, and `used_nodes`. `default_export=None` and
`export=None`, so Sheets stays hidden over WebDAV this release.
`pushes_preview=False`. Two satellites, `Sheet Op Log` and
`Sheet Collab State`. `legacy_fields=("title", "trashed", "trashed_on",
"trashed_by")`.

Every Drive workflow that changes a body writes one op at a fresh `Sheet Seq`
allocation, so the history panel does not skip what Drive did: `create` for a
new or copied sheet, `import` for an xlsx, `restore` for a version. None of them
goes through `versioning.save`, which gates on `frappe.has_permission("Sheet")`
after Drive has already answered against `Drive Grant`.

**The doctype.** `Sheet` gains a read-only `node` Link with a search index.
`title` loses `reqd` and gains the §14.10 description. The `All` DocPerm loses
`if_owner` for the open baseline §10.4 needs at activation, and a `Guest` read
row is added for link grants. The controller carries `drive.DriveContent`: a
linked row requires no title, gets no backing `File`, and touches its node on
every save.

**The guards** (`suite/sheets/permissions.py`). `sheet_has_permission` and
`sheet_query_conditions` are new. They put the `if_owner` rule back where it can
also read the node column, and refuse a linked row through
`drive.refuse_shared_row` / `drive.refuse_shared_linked_rows` rather than
answering `False`, because Frappe widens a denied row check
(`frappe/permissions.py:214-216`) and ORs shared names around a list predicate
(`frappe/database/query.py:1739-1742`). The two child guards get the same split
plus `_refuse_shared_linked_children`, which closes the one hole no node column
can scope: a `DocShare` on an op-log or snapshot row of a linked sheet.

**The legacy paths.** `share_sheet`, `unshare_sheet`, `get_sheet_shares`,
`delete_sheet`, `restore_sheet`, `delete_sheet_permanent`, `rename_sheet`, and
`duplicate_sheet` refuse a linked sheet. `list_trash` filters linked rows out.
`trash.hard_delete_sheet` refuses one and `purge_trashed_sheets` skips one. Every
path still works unchanged on a row Build has not linked.

**Collaboration** (`suite/sheets/collab.py`, `suite/sheets/collab-server/`).
`check_collab_access` answers a linked sheet from `Drive Grant`: EDIT and above
writes, READ or COMMENT connects read-only, UPLOAD connects read-only because it
places nodes rather than cells, anything lower is refused. Link credentials
travel in `X-Drive-Links`, which the collab server forwards from the browser, so
`suite.drive` builds the same principals it builds for any other request and the
20-item limit stays in `parse_link_header`. A Guest gets a server-controlled
identity, and the collab server tells two apart by a `randomUUID()` it generates.

Every answer carries `recheckSeconds`. `access-recheck.js` re-asks on that
cadence: revoked or expired closes the socket, a downgrade across the EDIT line
turns the connection read-only, an upgrade releases writes again. `hooks.js`
binds that policy to hocuspocus and `index.js` is boot only, so `node --test`
drives the whole connection lifecycle against the installed library.

### Deviations and decisions, recorded

1. **`drive.import_document` and `drive.read_file` were added.** §10.1 declares
   `import_from_file` and no Drive workflow called it. An app cannot implement
   "an xlsx becoming a sheet" against a callback nobody invokes, and an app may
   not read a `Drive Node` blob itself (ARCHITECTURE.md rule 2.2). Ticket 18
   amended the same files for the same reason with `adopt_media`.

2. **`DriveError` joined the facade.** `suite/drive/__init__.py` already
   documented "caught by type, not by message" without exporting the type. The
   collab endpoint needs one `except` for every refusal, and importing
   `suite.drive._core.errors` is an architecture violation.

3. **`remap_media` is deliberately not declared.** A Sheets body names no media
   today, so there is no reference to rewrite. A no-op declaration would let a
   copy carry media nothing names, charge the destination root, and have the
   §10.6 sweep trash it in seven days. **Handoff:** the ticket that adds an image
   cell declares `remap_media` and narrows `used_nodes` with it.

4. **`used_nodes` over-reports.** It walks every string in the decoded body at
   every depth and reports every whole id-shaped token. §10.6 trashes what the
   app does not report, so over-reporting only keeps media alive.

5. **`Sheet Snapshot` is not a satellite.** §14.6 turns its rows into
   `Drive Node Version` rows, so it stays a Build source with its own guards
   until Cleanup drops the doctype (§14.10). A satellite declaration would freeze
   rows Build still has to read.

6. **The recheck fails closed after three consecutive unreachable answers, not
   one.** One Frappe blip must not drop every editor on the site; three whole
   periods with no confirmed answer is long enough that only Drive may say yes
   (§1). The number is `MAX_CONSECUTIVE_FAILURES` in `access-recheck.js`.

7. **The xlsx import drops workbook-level decoration.** openpyxl read-only gives
   values, formulas, and number formats, not the style sheet, so borders, fills,
   and fonts are lost. Every formula and every merge comes across. Losing
   decoration is recoverable; losing a formula is not.

### Checks run

Implementation run, at `e8a337284`:

| Check | Result |
|---|---|
| `python -m compileall` on every changed module | clean |
| `uvx ruff@0.12.3 check` on every changed file | All checks passed |
| `python -m unittest suite.tests.test_architecture` | 7 tests, OK |
| `python -m unittest` on 10 database-free Sheets modules | 135 tests, 1 error |
| `npm test` in `suite/sheets/collab-server` | 33 tests, 33 pass, 0 fail |
| xlsx importer against a generated workbook, in a bench python | values, formula, date, percent format, and merges across two worksheets all correct |

Review run, at `7150208c1`:

| Check | Result |
|---|---|
| `python -m compileall suite/sheets suite/drive` | clean |
| `uvx ruff check` on every file the review changed | 1 error, `RUF059` at `test_collab_access.py:94`, present at `e8a337284` too |
| `python -m unittest` on the six ticket modules | 119 tests, 5 errors |
| The same six modules at `e8a337284`, from `git archive` | 98 tests, the same 5 errors |
| `npm test` in `suite/sheets/collab-server` | 55 tests, 55 pass, 0 fail |
| Two importer DoS vectors, run before the fix | 4.8 KB workbook to 2 GB in 19.7 s; 107 KB workbook to 2 GB in 7.9 s |
| The same two vectors, run after the fix | both refused, no allocation |

The review added 21 passing tests and no new failure. All 5 errors are the same
site-bound `setUpClass` calls and the same `_build_registry` flags read as
before, listed under **Not verified**.

Site gate run, on `slides.localhost`, at `fa4c7db13`. This is the first run
against a real database, so it closes most of **Not verified** below. Every
command ran serially, one bench invocation at a time:

| Gate step | Command | Result |
|---|---|---|
| 1 | `bench --site slides.localhost migrate` | succeeded (run before this repair) |
| 4 | `run-tests --module suite.sheets.tests.test_drive_adoption` | 42 integration OK, 59 database-free OK |
| 4 | `run-tests --module suite.sheets.tests.test_permissions` | 14 tests, OK |
| 4 | `run-tests --module suite.drive.tests.test_content` | 53 + 49 + 3 tests, OK |
| 4 | `run-tests --module suite.tests.test_architecture` | 7 tests, OK |
| — | `run-tests --module suite.drive.tests.test_nodes` | 13 + 23 tests, OK |
| — | `run-tests --module suite.drive.tests.test_access` | 12 tests, OK |
| — | `run-tests --module suite.drive.tests.test_versions` | 7 + 10 tests, OK |
| — | `run-tests --module suite.drive.tests.test_grants` | **24 tests, 24 errors** |

`test_drive_adoption` started this run with 3 errors and now has none. All three
were faults in the test module, not in Drive. `fa4c7db13` records them.

`test_grants` fails identically at `e9171a963` with the repair stashed, so it is
older than this work and outside it. Every one of the 24 errors is the same
`setUp`, raising `An active Drive root already exists for
drive-grant-target@example.com`. No such root is committed on the site, so the
fixture conflicts with itself inside the run. It blocks gate step 5.

`uvx ruff@0.12.3 format --check` reports the same 14 hunks in
`test_drive_adoption.py` before and after `fa4c7db13`, so the repair adds no
formatting drift. The drift itself predates this ticket and was left alone.

Site gate run, on `slides.localhost`, at `0971534cc`. `test_grants` is fixed,
so gate step 5 ran for the first time. Every command ran serially, one bench
invocation at a time:

| Gate step | Command | Result |
|---|---|---|
| — | `run-tests --module suite.drive.tests.test_grants` | 26 tests, OK, twice |
| — | `run-tests --module suite.drive.tests.test_views` | 10 + 10 tests, OK |
| — | `run-tests --module suite.drive.tests.test_roots` | 24 tests, OK |
| — | `run-tests --module suite.drive.tests.test_nodes` | 13 + 23 tests, OK |
| — | `run-tests --module suite.drive.tests.test_access` | 12 tests, OK |
| — | `run-tests --module suite.drive.tests.test_upload` | 26 tests, OK |
| — | `run-tests --module suite.drive.tests.test_versions` | 7 + 10 tests, OK |
| — | `run-tests --module suite.drive.tests.test_principals` | 10 tests, OK |
| — | `run-tests --module suite.drive.tests.test_activity` | 8 tests, OK |
| — | `run-tests --module suite.drive.tests.test_root_admin` | OK |
| — | `run-tests --module suite.drive.tests.test_quota` | OK |
| 4 | `run-tests --module suite.tests.test_architecture` | 7 tests, OK |
| 5 | `run-tests --app suite` | 221 unit OK, 871 integration with 1 failure, 545 unspecified OK |

The cause of the `test_grants` block was `ensure_user`. It inserts a real
`User`, the `after_insert` hook chain provisions an Active Personal root, and
the fixture then asks `create_root` for a second one. Drive refused correctly.
The hook only runs for a new user, which is why the module errored while
`test_upload`, whose fixture emails were already committed on the site, passed.
`0971534cc` records the repair. It changes no Drive production code.

Gate step 5 had one failure, and it was not this ticket's and not Drive's:

- `suite.meet.api.test.test_recording_reliability`,
  `test_one_active_recording_per_room_owner_by_default`, asserted `'Recording'`
  and read `'Starting'`. It failed the same way at `e338cccb1` with the repair
  stashed, and on its own module run.

`e15a9a50f` fixes it in Meet. `recording.start` inserts the recording and its
storage reservation, then counts the owner's live recordings and refuses over
the limit. The refusal left both writes in the transaction for the request
layer to roll back, so a caller that does not roll back kept a `Starting`
recording and a charged reservation. The test is such a caller: after the
expected refusal it started the second room again and `start` returned the
leaked row. A savepoint around the admission block now drops those writes
before the throw, and the test asserts the refusal leaves no recording row, no
reservation, and no bytes charged to the owner root.

Site gate run, on `slides.localhost`, at `e15a9a50f`. Every command ran
serially, one bench invocation at a time:

| Command | Result |
|---|---|
| `run-tests --module suite.meet.api.test.test_recording_reliability` | 13 tests, OK |
| `run-tests --module suite.meet.api.test.test_recording` | 41 tests, OK |
| `run-tests --module suite.meet.api.test.test_callback_security` | 7 tests, OK |
| `run-tests --module suite.meet.api.test.test_meeting` | 49 tests, OK |
| `run-tests --module suite.meet.api.test.test_e2ee_proof` | 7 tests, OK |
| `run-tests --module suite.meet.doctype.meet_recording.test_meet_recording` | 10 tests, OK |
| `run-tests --module suite.meet.recording.test_ingest_media` | 3 tests, OK |
| `run-tests --module suite.meet.recording.test_grants` | 4 tests, OK |
| `run-tests --module suite.meet.patches.test.test_backfill_recording_storage_reservations` | 6 tests, OK |
| `run-tests --app suite` | 221 unit OK, 871 integration OK with 26 skipped, 545 unspecified OK |

Gate step 5 has no failure left. No queue overload occurred: the `short` queue
sat at 156 of its 550 cap after the full run, so nothing was cleared.

One environment note for anyone repeating step 5. The bench has no RQ worker,
so every run leaves its background jobs queued. The `short` queue reached its
550 cap and later runs of `test_upload` and `test_versions` then errored with
`QueueOverloaded` from `previews.enqueue_render`, not from any code fault.
Emptying the `short` and `default` queues cleared it, and one full app run
refills `short` to about 99. Check the queue depth before trusting a step 5
failure.

Every Python check ran under
`PYTHONPATH=apps/frappe:<worktree> python -m unittest` from
`/home/faris/benches/suite-bench/sites`, with no site connected and no bench
command. No migration, no install, and no service restart.

Collab-server runtime run, at `e2b7ae846`, on 2026-09-06. Gate step 7. The
first run against a real `@hocuspocus/server`, and it closes step 7:

| Check | Result |
|---|---|
| `npm install` in `suite/sheets/collab-server` | 24 packages, 0 vulnerabilities |
| `@hocuspocus/server` resolved from `^4.1.0` | **4.6.0**, now pinned by `package-lock.json` |
| `npm test` at `fa4c7db13` (before this repair) | 55 tests, 55 pass, 0 fail |
| `npm test` at `e2b7ae846` | **89 tests, 89 pass, 0 fail** |
| `node --check` on all 12 collab-server JS files | clean |
| Boot `index.js` on a spare port with fake env | `Hocuspocus v4.6.0 running`, exits clean |

No lint ran: the repo configures no JavaScript linter for this package.

**What the runtime says, against what `index.js` assumed.** Three assumptions,
one right and two wrong:

| Assumption | Verdict |
|---|---|
| `onAuthenticate` is handed a `connection` | **Wrong.** The payload is `onAuthenticatePayload` (`src/types.ts:320`): `connectionConfig`, no `connection`. `connection.readOnly = …` threw a TypeError inside the hook, and hocuspocus turns a throw there into permission-denied. Every connection was refused and no recheck ever started |
| `connection.readOnly`, set mid-session, stops writes | **Right.** `MessageReceiver` reads it per message at 217 and 259. A downgrade needs nothing else. Asserted on the document, not on a spy |
| One of `close` / `disconnect` / `terminate` exists | **Half right.** `close(event)` exists; `disconnect` and `terminate` do not. `close()` removes the connection from the document and drops its route in `ClientConnection`, so the caller stops reading and stops writing, but it leaves the websocket open |

§6.7 asks for a disconnect, so `closeConnection` now closes
`connection.webSocket` as well. The three steps are ordered so each is useful
alone: `readOnly`, then `close()`, then the socket. It returns `false` and logs
an error only when the transport exposes no socket close.

Two more facts the binding needs, both asserted:

- `connected` is the first hook carrying the live `Connection`, so the recheck
  starts there.
- `onDisconnect` receives the same context object `connected` did, and
  `Connection.onClose` fires on every close path. Both stop the watcher, so a
  context replaced by a later `onTokenSync` cannot orphan a timer.

The 34 new tests run against a real `Hocuspocus` fed real protocol frames over
a fake socket. No port, no service, no site.

Re-run at closeout, at `9a2448da0`, twice and independently, from
`suite/sheets/collab-server` with the package already installed: `npm test`
gives **89 tests, 17 suites, 89 pass, 0 fail**. No install, no service, no site.
`package-lock.json` is tracked and pins `@hocuspocus/server`,
`@hocuspocus/common`, `extension-database`, and `extension-redis` all at 4.6.0,
matching the installed tree.


### Not verified

- ~~`TestSheetsBeforeActivation` and `TestSheetsInDrive`~~. Both ran green on
  `slides.localhost` at `fa4c7db13`. See the site gate run above.
- ~~The `Sheet` doctype JSON change~~. `bench migrate` reached the site. The
  DocPerm assertion in gate step 2 is still unrun.
- ~~`index.js` binding the recheck to hocuspocus~~. Settled at `e2b7ae846`.
  `npm install` resolves `^4.1.0` to `@hocuspocus/server` 4.6.0, the lockfile
  now holds it, and the binding was read out of that version's `src/` and then
  driven end to end. Two of the three assumptions were wrong; see the runtime
  run above. The binding is rewritten and the four library facts it stands on
  are asserted in `test/hocuspocus-contract.test.js`.
- ~~The gate step 6 probe~~. Run, and replaced by `TestTheGateProbes`
  (`9e064776c`). The step 9 probe is covered by the same class.
- **The gate step 2 console probe never ran, and no test can run it.** The three
  tests that look like coverage (`test_the_open_baseline_row_still_carries_every_legacy_right`,
  `test_the_open_baseline_row_no_longer_restricts_itself_to_the_owner`, and
  `test_guest_reads_only_through_a_link_grant`) read `sheet.json` off disk
  through `_doc_perm`, in a site-free `unittest.TestCase`. They cannot see
  JSON-versus-live-meta drift, which is the only thing step 2 exists to catch.
  What settles the substance instead is behaviour on the migrated site: gate
  step 9's legacy arm has an ordinary `Suite User` owner share, list shares, and
  unshare a node-less sheet, and `share_sheet` asks `ptype="share"`
  (`suite/sheets/api.py:168`). Those tests pass on `slides.localhost`, so the
  live `All` row does carry `share` and does not restrict to the owner. The
  narrow metadata assertion is unrun; the right it guards is proved.
- **The gate step 3 test is a proxy.** `test_the_registry_is_still_empty`,
  `test_both_sheet_permission_hooks_are_still_the_app_s_own`, and
  `test_neither_satellite_is_wired_to_the_framework_yet` read `suite.hooks`
  module attributes, not `_build_registry()` and not `frappe.get_hooks`. They
  cannot see a cross-app merge or a site override. The console probe never ran.
- Step 8 stays open: no browser has watched a live revocation. Everything below
  the browser is covered by tests against the real library. It is a ticket 34
  handoff, argued in the site gate below.

### The site gate

Run serially on `slides.localhost`, from the bench root, after this branch is
integrated:

Serially, and in this order. Every step has to pass before the next one runs:
a failure in an early step makes a later result meaningless.

**1. Reach the site.** The doctype JSON has never been applied anywhere.

```sh
cd /home/faris/benches/suite-bench
bench --site slides.localhost migrate
```

**2. Prove the `Sheet` DocPerm row is what the JSON says.** `f6c720707` restored
five rights the ticket dropped by accident. A migrate can silently keep an old
row, and the whole legacy share path depends on this one.

```sh
bench --site slides.localhost console <<'EOF'
row = [p for p in frappe.get_meta("Sheet").permissions if p.role == "All"][0]
print({k: row.get(k) for k in
       ("read","write","create","delete","share","email","export","print","report","select","if_owner")})
assert row.if_owner == 0 and row.share == 1 and row.export == 1 and row.report == 1
print([ (p.role, p.read) for p in frappe.get_meta("Sheet").permissions ])
EOF
```

**3. Prove the registry is still dormant.** The expand phase depends on it. If
`Sheet` is registered before ticket 29, both hook sets answer and the staged
guards are dead code.

```sh
bench --site slides.localhost console <<'EOF'
from suite.drive._core.content import _build_registry
assert "Sheet" not in _build_registry(), "Sheet must not be registered until 29"
print(frappe.get_hooks("has_permission").get("Sheet"))
EOF
```

**4. The module suites, one at a time.** `test_drive_adoption` first: its two
`IntegrationTestCase` classes are the only proof of create, copy, import,
version, restore, purge, media discovery, and the legacy refusals.

```sh
bench --site slides.localhost run-tests --module suite.sheets.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.sheets.tests.test_collab_access
bench --site slides.localhost run-tests --module suite.sheets.tests.test_collab
bench --site slides.localhost run-tests --module suite.sheets.tests.test_permissions
bench --site slides.localhost run-tests --module suite.sheets.tests.test_api_security
bench --site slides.localhost run-tests --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

**5. The whole app, once the modules pass.**

```sh
bench --site slides.localhost run-tests --app suite
```

Ran at `e15a9a50f`: 221 unit OK, 871 integration OK with 26 skipped, 545
unspecified OK. Step 4's modules all pass. The earlier `test_grants` block is
fixed by `0971534cc`, and the one Meet failure by `e15a9a50f`.

The earlier run at `0971534cc` read 871 integration with 1 failure,
`suite.meet.api.test.test_recording_reliability.test_one_active_recording_per_room_owner_by_default`.

Gate steps 6 and 9 run, on `slides.localhost`, at `9e064776c`. The whole app was
not re-run.

| Module | Result |
|---|---|
| `test_drive_adoption`, first run | 68 integration OK, 59 database-free OK |
| `test_drive_adoption`, second run | 68 integration OK, 59 database-free OK |
| `suite.sheets.tests.test_permissions` | 14 tests, OK |
| `suite.sheets.tests.test_api_security` | 11 tests, OK |
| `suite.sheets.tests.test_share_notify` | 6 tests, OK |
| `suite.drive.tests.test_content` | 53 + 49 + 3 tests, OK |
| `suite.tests.test_architecture` | 7 tests, OK |
| `suite.tests.test_composition` | 3 tests, OK |
| `uvx ruff@0.12.3 check` on both changed files | All checks passed |

`test_drive_adoption` went from 42 integration tests to 68. The 26 new ones are
gate steps 6 and 9. `test_share_notify` is not in the step 4 list and was run
anyway, because `f9a23c268` changes the endpoint it covers.

After both runs the site holds no fixture user, no fixture Drive root, no
linked `Sheet`, no fixture `DocShare`, and no orphan op log, seq row, snapshot,
collab state, or backing `File`.

**6. The DocShare bypass. Done, and now a test.** `9e064776c` turns it into
`TestTheGateProbes` in `suite.sheets.tests.test_drive_adoption`. Run step 4 and
it runs.

The claim that no test could reach it was wrong. The class creates the linked
sheet under `activated()`, adds the share while `suite/hooks.py` is untouched,
and reads through `frappe.client.get` and `frappe.get_list`. Every arm refuses:

Corrected at closeout against the tests that exist. An earlier version of this
table claimed an `activated()` result for three probes no test enters
`activated()` for. Only what a test asserts is listed; "not covered" means the
staged answer is proved and the activated one is ticket 29's to prove.

| Probe | Staged hooks | Under `activated()` |
|---|---|---|
| named share, row read | `DriveForbidden` | `DriveForbidden` |
| named share, `Sheet` list | `DriveForbidden` | `DriveForbidden` |
| named share, `Sheet Op Log` list | answers without the sheet | answers without the sheet |
| `everyone` share, row read | `DriveForbidden` | `DriveForbidden` |
| `everyone` share, `Sheet` list | `DriveForbidden` | `DriveForbidden` |
| `everyone` share, `Sheet Op Log` list | answers without the sheet | not covered |
| share on one `Sheet Op Log` row | `frappe.PermissionError` | not covered |
| share on one `Sheet Snapshot` row | `frappe.PermissionError` | not covered |
| a new share, written under activation | — | `DriveForbidden` |

The staged column is what this ticket ships, and every cell in it is a passing
test. The three uncovered cells are activation behaviour, which ticket 29 owns;
`Sheet Snapshot` in particular keeps its own guard past activation (§14.6), so
its activated answer should not be assumed to change.

Four controls run the same share against a sheet with no node and prove it does
widen there: the row opens, the list carries it, and the op log list carries it
too. Without them a refusal test passes on a site where nothing is shared.

The script this step used to carry could not have proved any of it:

- `frappe.get_doc` runs no permission check (`frappe/model/document.py:336`),
  so its row probe answered for every caller and would have printed `BYPASS`
  on a site that is refusing correctly.
- The refusal is a `DriveForbidden`, a `ValidationError` with a 403. The
  script's `except frappe.PermissionError` does not catch it.
- The op log list refuses nothing here, because the share is on the parent and
  `frappe.db.query` ORs shared names of the doctype being listed. It answers
  with the linked sheet absent, which the script would also have read as
  `BYPASS`.

**7. The collab server, against its installed dependency.** Steps 7a and 7b are
the two things this branch could not check anywhere.

```sh
cd apps/suite/suite/sheets/collab-server
npm install
npm test
```

Both steps ran on 2026-09-06. See the runtime run above.

7a. Done at `a252f406a`. `package-lock.json` is tracked and pins
`@hocuspocus/server` 4.6.0.

7b. Done at `e2b7ae846`. The four facts the binding stands on are asserted
against the installed package by `test/hocuspocus-contract.test.js`, so this
step is a test run rather than a reading exercise from here on. §6.7 is met: a
revoke sets `readOnly`, detaches the connection from the document, and closes
the websocket.

**8. One live revocation, with a browser. Not run, and it does not block this
ticket.** Open a linked sheet as an EDIT holder, drop the grant to READ, and
confirm the tab goes read-only within the recheck period. Then drop the grant
entirely and confirm the socket closes.

This step is a ticket 34 handoff, not a ticket 19 blocker. The reasons are in
source precedence, and each is checkable:

- **No acceptance criterion asks for it.** README execution rule 10 sets `done`
  against the acceptance criteria. None of the eight names a browser. The
  ticket's own **Verification** line asks for "Sheets and collaboration-server
  tests", which is what ran.
- **Criterion 8 forbids what the step needs.** "Do not restart collaboration
  services as part of implementation." The README stop conditions repeat it:
  "Do not push, create PRs, publish services, restart services, or install
  dependencies as part of this run." No collaboration service is running on this
  bench, so step 8 cannot be performed without breaking the criterion it would
  be verifying.
- **Ticket 34 owns it by name.** Its acceptance criterion "Use only relevant
  document credentials for collaboration and reflect server read-only/refused
  states" and its verification line "run content-app browser journeys with …
  collab downgrade" are this step.
- **The client cannot exercise it today.** The browser sends a bare `sid`
  (`frontend/src/apps/sheets/components/SheetEditor/useCollaboration.js:292`)
  and nothing in `frontend/src` emits the `{sid, links}` shape. `frontend/` is
  not in this ticket's claimed files. A link-credential revocation is therefore
  unreachable from a browser until 34 lands.
- **README release gates say so.** "Frontend adoption … does not block backend
  implementation."

**Why the executable tests suffice for ticket 19.** Criterion 7 is a server
behaviour, and the thing step 8 would add over the tests is the browser's own
reaction. What the server does is now asserted against the installed
`@hocuspocus/server` 4.6.0 rather than against its documentation: `readOnly`
flipped mid-session drops the next update, `Connection.close()` detaches and
leaves the socket open, and `closeConnection` therefore closes the socket too.
That was the exact gap step 7b existed to close, and closing it is what makes
the remaining browser check a client-integration question. Step 8 is recorded as
34's, not waived.

**9. The legacy arm on a migrated site. Done, and now a test.** `9e064776c`
covers it in the same class. `slides.localhost` is migrated and carries legacy
sheets, so the fixtures run on exactly the site this step names.

An ordinary owner — a `Suite User`, not an operator, because the Administrator
is answered before any hook runs (`frappe/permissions.py:109`) — opens, shares,
lists shares, renames, trashes, restores, and unshares a sheet with no node
through `suite.sheets.api`. The adversarial arms: a stranger cannot open it, a
reader cannot trash it or revoke someone else's share, a trashed sheet does not
open until it is restored, and the backing `File` survives a rename under its
new name.

The probe found one defect, fixed in `f9a23c268`. `unshare_sheet` reached
`frappe.share.remove`, which deletes the `DocShare` row without
`ignore_permissions`. `DocShare` carries a System Manager DocPerm and nothing
else, so an ordinary owner could grant a named share and never take it back.
The `everyone` branch two lines above already passed `ignore_permissions`, and
`frappe.share.add` writes the row the same way (`frappe/share.py:82`). Older
than this ticket, which only added the linked-sheet refusal to that endpoint.
The authority is unchanged: the `share` right on the sheet is what may revoke.

**Fixture residue.** Each test in the class censuses 20 tables before it runs
and asserts an empty delta afterwards. 13 of them (`_GATE_ADDED`) are deleted
outright; the other 7 (`_GATE_WITNESS`: the four `Drive *` tables, `File`,
`File Blob`, `User`) are counted only and come back through Drive's own purge
and the `File` controller, because a test may not write a `Drive *` table
(ARCHITECTURE.md rule 2.2). The assertion is registered first so it runs last.

It is not vacuous by construction: every test writes a `Sheet` and most write a
`DocShare`, both in `_GATE_ADDED`, so dropping `_drop_gate_rows` must leave a
non-empty delta. That is the structure, not a recorded experiment. No run with
the delete step removed is logged, and the earlier wording overstated it as one.

Two older leaks are closed with it: `TestSheetsBeforeActivation` left one backing `File`
per legacy fixture, because `File.permanent_delete` marks the row `Removed`
rather than deleting it, and both older classes left their fixture users on the
site. 120 orphan `File` rows had accumulated on `slides.localhost` and were
removed.

### Handoffs

| To | What |
|---|---|
| 29 | Register `suite.sheets.drive.SPEC`; move both `Sheet` hooks to `suite.drive.framework.doc_*`; add `satellite_*` for `Sheet Op Log` and `Sheet Collab State`; leave `Sheet Snapshot` on its own guard |
| 34 | The browser sends a bare `sid` as the collab token today. Send `{"sid":..., "links":[...]}` so a Guest with a link can connect; the collab server already reads both shapes |
| 34 | The Sheets client still calls the legacy endpoints, which refuse a linked sheet. It needs the Drive equivalents before Build |
| 23 | The legacy `File` backing, the DocShare endpoints, and `suite/sheets/trash.py` |
| Cleanup (§14.10) | Drop `title`, `trashed`, `trashed_on`, `trashed_by`, `head_snapshot`, `Sheet Snapshot`, `Sheet Cell`, and `suite/sheets/trash.py` |
| A later Sheets ticket | An image cell needs `remap_media` and a narrowed `used_nodes` |
| 21 and 22 | The new test module reaches `suite.drive._core` for roots, media, and version restore. Recorded in the architecture debt baseline |
| 29 | `sheet_has_permission` denies a Suite Admin a linked row while the child guards exempt a System Manager. Neither matches §4.9. Both close when `suite.drive.framework` answers and `is_drive_admin` is the one definition |
| 29 | `Sheet Op Log` and `Sheet Collab State` have no satellite DocPerm baseline yet. The satellite declarations need one at activation |
| 29 | `Drive Node` and `Sheet Seq` are taken in opposite orders by the Drive workflows and by `versioning`. Not reachable today because no Drive workflow calls `versioning.save`, but it is a lock-order inversion waiting for the ticket that joins them |
| 34 | A restore now deletes the persisted `Sheet Collab State` row, so a reconnect rebuilds from the restored body. A Y.Doc already live in the collab server is not evicted: an open tab keeps the replaced document until it reconnects. Eviction needs a server-side signal |
| 34 | The client does not declare its own awareness identity. The collab server names a Guest with a `randomUUID()`; the client has to stop trusting any name in the token |
| 23 | A purge drops the `Sheet` row but not the legacy `File` backing a pre-Build sheet. Orphan rows accumulate until ticket 23 removes the backing. Measured: 120 had built up on `slides.localhost` from test fixtures alone. `9e064776c` makes the fixtures clean up after themselves; the production path is still ticket 23's |
| ~~Deploy~~ | ~~The collab server has no lockfile~~. Done at `a252f406a`: `package-lock.json` is tracked and pins 4.6.0 |
| 34 | Gate step 8, the live browser revocation. Nothing below the browser is left to prove; the client has to send `{sid, links}` and reflect the read-only and refused states |
| A later Sheets ticket | The xlsx import truncates past `MAX_IMPORT_SHEETS` worksheets instead of refusing. See the closeout |
| 29 | The `All` DocPerm on `Sheet` carries `select: 1`, added by this ticket and recorded only at closeout. Activate against the real row |

## Independent adversarial review

Reviewed 2026-09-06 at `e8a337284`. Diff read: `d7bf210b0..e8a337284`. The
reviewer worked in a separate worktree with no site, no bench command, no
install, and no service restart. Three subagents audited the Python
authorization surface, the Sheets lifecycle, and the JavaScript collaboration
server independently.

### Findings fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | The `All` DocPerm on `Sheet` lost `share`, `email`, `export`, `print` and `report` along with `if_owner`. A hook can only deny, so a right the row does not carry is a right no hook can hand back. `share_sheet` asks `ptype="share"` and `frappe.share.check_share_permission` asks it again, so the owner of a legacy sheet could no longer share, export or print it | `f6c720707` |
| 2 | High | The xlsx importer allocated from attacker-controlled dimensions with no bound. Two vectors reproduced: a 4.8 KB workbook reached 2 GB in 19.7 s through merge ranges, and a 107 KB workbook reached 2 GB in 7.9 s through declared row spans. `MAX_IMPORT_UNZIPPED`, `MAX_IMPORT_SLOTS`, `MAX_IMPORT_MERGED` and `MAX_IMPORT_MERGE_RANGES` now bound every one, and the zip central directory is summed before anything is read | `f76d6c55f` |
| 3 | High | Merge ranges were mapped to worksheets by position in the zip, not by name. A workbook whose sheet parts are stored out of order put one worksheet's merges on another. Reproduced: tabs `[Beta, Gamma, Alpha]` put Beta's merge on Alpha. `_worksheet_path` is now the mapping | `f76d6c55f` |
| 4 | High | `fetch` in the collab server had no timeout. A wedged Frappe worker leaves the recheck awaiting forever: no rejection to count, no timer pending, and a revoked caller connected for the life of the socket | `7150208c1` |
| 5 | Medium | `drive.check` ignored §8.8. It granted EDIT on a trashed node, while `DriveContent.drive_check` refuses one. An app-facing call has to answer the same way | `81846e831` |
| 6 | Medium | `sheet_query_conditions` refused a shared linked row before exempting a privileged caller, which locked the operator out of the very list that finds the offending `DocShare` | `40991a192` |
| 7 | Medium | `sheet_has_permission` read `node` off the submitted document. `frappe.client.save` builds the whole `Document` from client JSON, so a caller presenting a linked row with `node` cleared took the legacy owner-or-`DocShare` branch. It now reads the stored column for any saved row | `40991a192` |
| 8 | Medium | `_child_has_permission` returned `False` for a child row with no parent, and `false_if_not_shared` re-granted it. An orphan row is exactly what no share should reopen. It now refuses | `40991a192` |
| 9 | Medium | `restore_version` rewrote the body and left the persisted `Sheet Collab State` row in place, so the next connection rebuilt the replaced document from the stale Y.Doc and the restore was silently undone | `88c92650f` |
| 10 | Medium | `parseToken` bounded the number of link credentials but not their content. A CR, LF, NUL or DEL inside one forges a second header on the request the collab server makes with its own secret. The sid had the same hole, and it becomes a `Cookie` header | `7150208c1` |
| 11 | Medium | `intervalMs` reached `setTimeout` unvalidated. Node clamps a negative or non-numeric delay to 1 ms, turning one connection into roughly 900 requests a second at an `allow_guest` endpoint | `7150208c1` |
| 12 | Medium | An injected `onCapability` or `onRevoke` that threw rejected `tick`, which runs as a bare timer callback. Node turns an unhandled rejection into a process exit, so one connection's transport could drop every editor on the site | `7150208c1` |
| 13 | Medium | `_legacy_access` raised `AuthenticationError` for a Guest. The collab server reads a non-2xx status as an unreachable Frappe, so a settled and permanent refusal burned three fail-closed periods and was reported as a network problem | `fe122fe8a` |
| 14 | Low | `openpyxl` was used directly but declared nowhere. It reached the venv as a transitive Frappe dependency, so a Frappe release that drops it breaks the importer | `f76d6c55f` |
| 15 | High | `onAuthenticate` set `connection.readOnly`, but `@hocuspocus/server` 4.6.0 hands that hook no `connection`. The TypeError became a permission-denied, so no caller could open a sheet and no recheck ever started. The hook now sets `connectionConfig.readOnly` and `connected` starts the recheck against the live `Connection` | `e2b7ae846` |
| 16 | High | `Connection.close()` leaves the websocket open, so a revoked reader kept the socket. §6.7 asks for a disconnect, so `closeConnection` now closes `connection.webSocket` after detaching the connection | `e2b7ae846` |
| 17 | Medium | `^4.1.0` had no lockfile. The server ran against whatever npm resolved that day, across the payload change between 4.1 and 4.6 that caused finding 15 | `a252f406a` |
| 18 | Low | The caller's `sid` was about to travel on the connection context, which reaches every extension and every later hook. The recheck carries a bound call instead; the credentials stay in the closure | `e2b7ae846` |

### Checked and left alone

- **The `DocShare` OR bypass, both halves.** `refuse_shared_row` and
  `refuse_shared_linked_rows` are not registry-gated, so the staged refusals do
  run today. Confirmed by reading both, not assumed.
- **The 20-item `X-Drive-Links` limit.** `parse_link_header` rejects a 21st
  item, never truncates. The JavaScript bound is advisory and carries a comment
  saying Frappe is the authority.
- **Guest identity.** The name comes back from Frappe's answer. Nothing in the
  token can name the connected person; a link proves a capability only.
- **Token secrecy.** `X-Collab-Secret` never travels on the access call, which
  carries the caller's authority and nothing of the server's.
- **The READ, COMMENT and EDIT thresholds.** They match the §4 ladder. UPLOAD
  connects read-only because it places nodes, not cells.
- **Expired and revoked links.** Both come back as `canRead: false` and close
  the socket on the first tick.
- **The dormant registry.** `drive_content_types` is empty and both `Sheet`
  hooks still point at `suite.sheets.permissions`. Gate step 3 pins it.
- **Error non-disclosure.** A role below READ answers `DriveNotFound`, never
  `DrivePermissionError`, so nothing distinguishes a missing node from a
  forbidden one.
- **Direct SQL.** Every fragment is a literal or `frappe.db.escape`, and
  `_CHILD_TABLES` is a lookup rather than interpolation. No caller-controlled
  string reaches a query.
- **Timer leaks.** `stop()` clears the pending timer, `finish()` clears it and
  marks the watcher stopped, and the tests assert `pendingCount()` after every
  path. `unref` keeps a pending recheck from holding the process open.

### Unresolved low findings

| Finding | Why it is left |
|---|---|
| `sheet_has_permission` denies a Suite Admin a linked row; the child guards exempt a System Manager. Neither matches §4.9 | Fixing it means this module reading `Drive Grant`, which is ticket 29's job. Handed off |
| `used_nodes` over-reports every id-shaped token in the body | Recorded deviation 4. Over-reporting keeps media alive, so it fails safe |
| `xml.etree.ElementTree` expands internal entities, and `defusedxml` is not installed | Mitigated, not removed: `_validate_package` rejects any part whose first 8 KB carries a `<!DOCTYPE`. Installing `defusedxml` is outside this run |
| `RUF059` at `test_collab_access.py:94` | Present at `e8a337284`. Not this review's change |

### Recommendation

**Integrate, then run the gate.** No acceptance blocker is open in the code. All
14 confirmed high and medium findings are fixed and covered by tests, the diff
compiles, and 119 Python tests plus 55 JavaScript tests pass with no new
failure.

Two conditions, both at the gate rather than in the branch:

1. Gate step 7b decides whether §6.7 is met. If the installed
   `@hocuspocus/server` exposes no way to close a connection mid-session, a
   revoked reader keeps receiving the document and that is a blocker for
   activation, not for this expand-phase merge.
2. Gate step 2 has to confirm the `Sheet` DocPerm row that actually lands. The
   JSON has never reached a site.

The gate then ran, and findings 15 to 18 came out of it. Condition 1 is settled:
4.6.0 exposes `Connection.close()`, it leaves the socket open, and
`closeConnection` closes the socket too, so §6.7 is met. Condition 2 is settled
in substance rather than by the probe it names. See **Not verified** and the
closeout.

Nothing here is safe to activate: `drive_content_types` stays empty, and ticket
29 owns the switch.

## Closeout

Verified 2026-09-06 on `main` at `9a2448da0`, working tree clean. The verifier
changed no code and no test, ran no bench command, no install, no migration, no
service, and no browser. Three subagents audited the declaration and lifecycle,
the collaboration surface, and the gate evidence independently.

### Every criterion, against the evidence that proves it

| Criterion | Code | Evidence |
|---|---|---|
| Declare Sheet and its two satellites | `sheets/drive.py:310-338`, matching §10.7 field for field | `TestSheetsDeclaration` (21 database-free); `_validate_shape(SPEC)` passes |
| Create, copy, xlsx import, version bytes, restore, purge, media discovery | `sheets/drive.py:165,170,184,208,226,256,287`, all seven wired into `SPEC` | `test_drive_adoption` 68 integration + 59 database-free, run twice |
| Replace share/trash enforcement, retain Build sources | `sheets/permissions.py`; nine refusals in `api.py`, two in `trash.py`; `title`/`trashed`/`head_snapshot`/`Sheet Snapshot` all still present | `test_permissions` 14, `test_api_security` 11, `test_share_notify` 6, `TestTheGateProbes` |
| `default_export=None`, bodies free, versions and media charged | `create_document`/`import_document` admit nothing; `versions.py:65` and `nodes.py:678` admit | `test_content` 53 + 49 + 3 |
| Link credentials through both access checks and the collab server | `connection-token.js:47` → `frappe-client.js:61` (`X-Drive-Links`) → `framework.py:321` → `principals` | `test_collab_access` 24, `test_collab` 13, collab-server 89 |
| 20-item limit and the ladder | `principals.py:60` throws on a 21st, never truncates; `collab.py:101-134` asks READ then EDIT | `test_collab_access` 24 |
| Five-minute recheck, disconnect, downgrade | `collab.py:68`; `access-recheck.js`; `hooks.js:60-95,160-190` | collab-server 89 against installed 4.6.0 |
| Server-controlled Guest identity, no service restarted | `collab.py:179-201`; `hooks.js:144` `randomUUID`; `parseToken` returns only `{sid, links}` | `test_collab_access` 24; no service touched in this run |

Architecture and composition hold at `7` and `3`. Full app at `e15a9a50f`: 221
unit OK, 871 integration OK with 26 skipped, 545 unspecified OK, exit zero.

### What ran after the last full app run

`run-tests --app suite` last ran at `e15a9a50f`. Two commits changed code or
tests after it:

| Commit | Change | Covered by |
|---|---|---|
| `f9a23c268` | one line in `unshare_sheet` | `test_api_security` 11, `test_share_notify` 6, `test_permissions` 14, `TestTheGateProbes`, all run at `9e064776c` |
| `9e064776c` | `test_drive_adoption.py` only | itself, run twice |

`a252f406a` and `e2b7ae846` are JavaScript only and are covered by the 89-test
run. The whole app was not re-run after `9e064776c`; the affected modules were.
`frappe.share.remove(..., flags={"ignore_permissions": True})` reaches
`delete_doc`, which folds the flag onto the document before the permission check
(`frappe/model/delete_doc.py:282-294`), so the fix does what it claims.

### Found at closeout, recorded not fixed

A closeout may not change code. Both are handoffs, neither blocks a criterion.

1. **The xlsx import silently drops worksheets past 200.**
   `sheets/drive.py:522` is `names = list(book.sheetnames)[:MAX_IMPORT_SHEETS]`.
   Every other import bound refuses the workbook; this one truncates, reports
   success, and records nothing. `_merge_slice` states the opposite policy for
   the same class of problem in its own docstring (`:707`): "refused whole, not
   truncated". No test covers it. It also makes deviation 7's "every formula and
   every merge comes across" false past 200 worksheets. **Handoff:** the ticket
   that touches the importer next should throw here, as the other four bounds
   do.
2. **`select: 1` was added to the `All` DocPerm and never recorded.** The
   pre-image row at `d7bf210b0` had no `select`; `sheet.json` has it now. The
   `What changed` note says only that the row loses `if_owner` and gains a Guest
   row, and review finding 1 lists the restored rights without it. Effect is
   contained: `select` routes through `sheet_has_permission`, and `_READ_PTYPES`
   (`permissions.py:255`) maps it to parent read on the child guards. Gate step
   2 prints `select` but does not assert it, so the probe would not have caught
   a wrong value either. Recorded so ticket 29 activates against the real row.

### One inaccuracy corrected in this document

The gate step 6 table claimed an `activated()` result for three probes that no
test enters `activated()` for. The table now says "not covered" for those three
and the staged column, which is what this ticket ships, is fully proved. The
fixture-residue paragraph claimed a removal experiment that is not recorded
anywhere; it now states the structural argument instead.

### Decision

**Complete.** All eight acceptance criteria are met. Gate step 8 is not run and
is recorded as ticket 34's, with the argument under the site gate. Gate steps 2
and 3 have no console run; step 2's substance is proved behaviourally on the
migrated site and step 3's test is a proxy, both recorded above rather than
claimed as run.

Nothing here is active. `drive_content_types` is `[]`, both `Sheet` hooks still
point at `suite.sheets.permissions`, and neither satellite is wired. Ticket 29
owns the switch.
