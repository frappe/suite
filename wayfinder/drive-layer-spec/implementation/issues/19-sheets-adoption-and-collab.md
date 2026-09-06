# 19 — Move Sheets lifecycle and collaboration checks into Drive

**What to build:** Use Drive permissions for Sheets documents, operation records, and live collaboration.

**Blocked by:** [16 — Create content documents and media through one Drive contract](16-content-contract.md)

**Status:** in-progress

**Owner:** Suite Sheets

**Starting revision:** Suite `d7bf210b071e7d4ffb32b75b5ed0802b4f7f053b`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

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

- [ ] Declare Sheet, Sheet Op Log, and Sheet Collab State through the content contract.
- [ ] Implement create, copy, xlsx import, version bytes, restore, purge, and media discovery.
- [ ] Replace separate share/trash enforcement and retain migration source snapshots and fields until Cleanup.
- [ ] Keep default_export=None. Sheet bodies remain free; version blobs and media remain charged.
- [ ] Update both Frappe access checks and the repository-owned collaboration server to carry relevant link credentials.
- [ ] Reject more than 20 supplied credentials. EDIT permits writing; READ/COMMENT permits read-only; below READ refuses.
- [ ] Recheck each live connection every five minutes. Disconnect revoked or expired access, and enforce downgrades.
- [ ] Use server-controlled Guest identity. Do not restart collaboration services as part of implementation.

## Verification

Run Sheets and collaboration-server tests with fake time, revocation, expiry, downgrade, Guest tokens, Satellite queries, and version restoration.

## Completion evidence

Claimed 2026-09-06. Implementation complete, verification partial. No acceptance
box is checked: the two `IntegrationTestCase` classes have not run, and they are
what prove the Drive lifecycle.

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
turns the connection read-only, an upgrade releases writes again.

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

### Not verified

- ~~`TestSheetsBeforeActivation` and `TestSheetsInDrive`~~. Both ran green on
  `slides.localhost` at `fa4c7db13`. See the site gate run above.
- ~~The `Sheet` doctype JSON change~~. `bench migrate` reached the site. The
  DocPerm assertion in gate step 2 is still unrun.
- `index.js` binding the recheck to hocuspocus. `@hocuspocus/server` is not
  installed in this worktree, and the review searched the whole machine and
  found no copy of its source in any other bench or cache. There is also no
  lockfile, so nothing pins a version inside `^4.1.0`. `connection.readOnly`
  mid-session and `onDisconnect({ context })` carrying the watcher are read from
  the library's documented shape, not observed. The policy itself is tested with
  injected time and passes. Gate step 7b is the only place this can be settled;
  `closeConnection` now logs an error rather than passing silently when it finds
  no close method.
- The two `bench console` probes in gate steps 2, 3 and 6. They were written
  against the code, not run.

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

**6. The DocShare bypass, by hand.** No test can reach it: the widening happens
inside Frappe, after the hook has answered. Link a sheet, share it with a user
who holds no grant, and confirm both the row read and the list refuse.

```sh
bench --site slides.localhost console <<'EOF'
import frappe
from frappe.share import add
sheet = frappe.db.get_value("Sheet", {"node": ["is", "set"]}, "name")
assert sheet, "link a sheet through Build first"
add("Sheet", sheet, "victim@example.com", read=1)
frappe.set_user("victim@example.com")
for call in (lambda: frappe.get_doc("Sheet", sheet),
             lambda: frappe.get_list("Sheet"),
             lambda: frappe.get_list("Sheet Op Log")):
    try:
        call(); print("BYPASS: returned", call)
    except frappe.PermissionError as e:
        print("refused:", e)
frappe.set_user("Administrator")
frappe.db.rollback()
EOF
```

**7. The collab server, against its installed dependency.** Steps 7a and 7b are
the two things this branch could not check anywhere.

```sh
cd apps/suite/suite/sheets/collab-server
npm install
npm test
```

7a. Commit the lockfile `npm install` writes. There is none in the repo, so
nothing pins `@hocuspocus/server` inside `^4.1.0` today.

7b. Read the installed `node_modules/@hocuspocus/server` and confirm two things
`index.js` assumes: that setting `connection.readOnly` mid-session stops writes,
and that one of `close` / `disconnect` / `terminate` exists on the connection
object. `closeConnection` returns `false` and logs
`revoked connection could not be closed` when it finds none. If it does, §6.7 is
not met: a revoked reader keeps receiving the document until the tab closes.

**8. One live revocation, with a browser.** Open a linked sheet as an EDIT
holder, drop the grant to READ, and confirm the tab goes read-only within the
recheck period. Then drop the grant entirely and confirm the socket closes.
Nothing below the browser can prove this.

**9. `bench migrate` on a site with legacy sheets.** Every guard has a legacy
arm that must keep working. Confirm an owner still opens, shares, renames,
trashes, and restores a sheet with no node.

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
| 23 | A purge drops the `Sheet` row but not the legacy `File` backing a pre-Build sheet. Orphan rows accumulate until ticket 23 removes the backing |
| Deploy | The collab server has no lockfile. `npm install` at the gate writes one, and it has to be committed |

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
| No lockfile in `collab-server` | `npm install` is outside this run. Gate step 7a |

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

Nothing here is safe to activate: `drive_content_types` stays empty, and ticket
29 owns the switch.
