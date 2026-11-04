# 27 — Migrate root pairs, node trees, and grants

**What to build:** Convert legacy Drive trees and permissions while preserving ids and accepted access semantics.

**Blocked by:** [26 — Prepare legacy bytes for an additive Build](26-build-storage-preparation.md)

**Status:** done

**Owner:** Suite migration

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §14.2 steps 4–6, §14.3–14.5.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [x] Create each root node and metadata pair atomically with the original File id. Validate incomplete pairs before descendants.
- [x] Walk reachable trees by depth. Keep top-level parent=root-node and root-relative paths within validated capacity.
- [x] Preserve identities and timestamps; deduplicate Active titles deterministically. Report broken chains and skipped Removed subtrees.
- [x] Propagate trash from the nearest independently trashed ancestor and preserve earlier trash stamps.
- [x] Map Drive Permission and Sheet DocShare exactly, including denies, stale principals, migrated anchors, and duplicate rows.
- [x] Mint required links, drop root-public/link violations and forced-public composite rows, and collect every specified count.
- [x] Commit resumable batches of 1000 without splitting a root pair. Preserve migration source tables.

## Verification

Run mapping fixtures and interruption/rerun tests for complete, missing, and mismatched root pairs, grants, trash, and duplicate titles.

## Completion evidence

All seven acceptance criteria are built, independently reviewed, and proved.
The five focused modules contain 276 site-free cases; the final 12-module
site-free gate passed all 456 cases. The root orchestrator then ran the ten
required modules serially on `slides.localhost` at reviewed revision
`c2773ec2c`: all 404 cases passed, every command exited 0, and every module
printed `OK`. The exact module counts are recorded under **Independent
closeout and live site gate**.

Agents wrote and reviewed the production modules, the five focused test
modules, and the site-backed module. Their findings are listed under
**Defects the audits found and fixed**. The final independent review found
five more defects after the first review and corrected them on its own
branch. A second independent review closed the concurrency and fixture gaps,
and the root orchestrator completed the serialized site gate before this
closeout.

### Revisions

Base Suite `356d38782`, the commit that closed ticket 26, on
`implement/drive-27-tree-grants`. No Frappe change in this pass.

| Commit | Subject |
|---|---|
| `630ff6f44` | build the node trees and the grants (§14.2 steps 4 to 6) |
| `5395a6e43` | cover the tree and grant conversion without a site |
| `0661dbe10` | prove the tree and grant wiring against the real tables |
| `c82be8a49` | close the independent review's port defects and cover the adapters |
| `229beaf5e` | close the four final root-pair, batch, and link-resume blockers |
| `b16e134ae` | refuse conflicting Build roots and revalidate pairs before descent |
| `0ed1b1770` | make the post-identity-lock conflict read current on MariaDB |
| `1fcd4b640` | prove lock/read order and isolate the site-backed root fixtures |
| `c2773ec2c` | record the final independent review before the root site gate |

### What was built

Five new modules in `suite/drive/patches/build/`, and two new seams in the
package's existing `ports.py`.

| Module | Holds |
|---|---|
| `root_pairs.py` | §14.2 step 4 and §14.3: the root node and metadata pairs |
| `tree.py` | step 5 and §14.4: the depth walk, trash, titles, and the census |
| `grants.py` | step 6 and §14.5: `Drive Permission` and Sheet `DocShare` |
| `mapping.py` | §14.5's two tables as pure functions |
| `titles.py` | §8.6 sibling dedupe, bounded by the target column |

`ports.py` gained `LegacyTree` and `DriveTarget`. `LegacyTree` has no write
method of any kind, so "preserve the migration source tables" is a property
of the seam and not a rule somebody has to remember. `DriveTarget` writes
through `frappe.db.bulk_insert`, because `set_new_name` throws a
caller-supplied name away for an `autoname: hash` doctype
(`frappe/model/naming.py:160-162`) and §14.3 needs the `File` id kept.
Writing with SQL means no controller `validate` runs, so every rule the
engine would have applied is applied by hand and named in a comment.

`state.py` gained `TreeConversion` and `GrantConversion`, and
`environment.py` gained a clock, an id source, and a token source, so a
fixture's output is a fixed string rather than a wall clock.

### Acceptance criteria

| Criterion | Where | Proof |
|---|---|---|
| Atomic root pair with the original File id | `root_pairs.py`, `SiteDrive.write_root_pair` | one savepoint holds the node, the metadata, and the Personal anchor. The identity lock matches the live root creator on MariaDB and Postgres. `TestPersonalRootPair`, `TestInterruption`: a kill between the halves leaves nothing, and the rerun completes the pair. `TestBatching.test_no_commit_falls_inside_a_pair` |
| Validate incomplete pairs before descendants | `tree.refuse_incomplete`, `root_pairs._refuse_mismatch` | `PairTest` (6): a missing half, non-root node, noncanonical node, or metadata pointing elsewhere stops step 5 before one descendant is written. `TestMismatchRefusals` checks every canonical node field, both metadata links, lifecycle, kind, and user identity |
| Walk reachable trees by depth | `tree._walk_root` | breadth-first, one level per pass, because a node's path and trash stamp both come from its parent. `PlaceTest` (5) |
| Top-level `parent` is the root node | `tree._node_row` | `test_top_level_points_at_the_root_node`. §3.1, §14.3, and §14.4 all say so. The older "NULL directly under a root" in `tickets/011-migration-mapping.md:162` is superseded |
| Root-relative paths within validated capacity | `tree._within_capacity` | the path is the engine's own `_validate_tree_position` formula, pinned by `test_path_holds_the_ancestors_and_not_the_node`. Depth past 40 and a path past `varchar(500)` skip the subtree and are counted. `max_depth`, `max_path_length`, and `max_id_length` are measured from the source rows, so a site that needed depth 44 reports 44 |
| Preserve identities and timestamps | `tree._node_row` | `IdentityTest` (4): the id, `creation`, `modified`, `content_modified`, and `owner` all come from the `File` row, and the test asserts the stamps are not the Build clock. `modified_by` is `KindTest.test_modified_by_comes_from_the_source_row` |
| Deterministic Active title dedupe | `titles.py`, `tree._convert_siblings` | oldest first by `(creation, name)`, decided from the source rows and never read back, so an interrupted run resumes to the same answer. `TitleTest` (7), `test_an_interrupted_run_resumes_to_the_same_titles`. Trashed siblings hold no title |
| Report broken chains and Removed subtrees | `tree.take_census` | a read-only upward classification of every `File` row with no node: broken, Removed, reachable and missing, or outside Drive. `CensusTest` (8), `RemovedTest` (2) |
| Trash from the nearest independently trashed ancestor | `tree._trash_stamp` | `TrashTest` (5). An inner folder trashed in March keeps its March stamp under an outer folder trashed in June, so §8.8's restore of the outer one leaves it behind |
| Map `Drive Permission` exactly | `mapping.py`, `grants._convert_pair` | `test_mapping` (52) walks all 64 flag combinations against the spec table written out independently in the test file. `RoleTest` (9) runs the same table through the whole step |
| Denies, stale principals, duplicates | `mapping.collapse`, `grants._principal_for` | duplicates collapse the way `dedupe_drive_permissions.py` does, before mapping, because `read + share` unioned with `write` is MANAGE and mapping first gives EDIT. `CollapseTest` (3), `PrincipalTest` (10) |
| Sheet `DocShare` | `grants._convert_docshare` | `DocShareTest` (10), including the `everyone` row, a missing user, and two sources meeting on one `(node, principal)` |
| Migrated anchors | `root_pairs._anchor_grants`, `grants._shared_floor` | the Personal MANAGE anchor lands with the pair; the Shared root keeps whatever its legacy `$GENERAL` row mapped to and gets a READ floor only when nothing produced one. `SharedFloorTest` (5) |
| Mint required links | `grants._convert_anonymous` | a `user = ""` row above read becomes `$PUBLIC` READ plus one `$LINK:<22 base62>` at the mapped level. `AnonymousTest` (10). `LinkInterruptionTest` proves kills immediately before and after the database commit neither duplicate the link nor lose `links_minted` |
| Drop root public and link violations | `grants._convert_anonymous`, `_convert_pair` | §5.9 refusals 7, 8, and 11 applied by hand, because bulk SQL fires no refusal. `GuardrailTest` (6) |
| Drop forced-public composite rows | `grants._convert_anonymous` | only the shape `presentation.py:102-113` writes: a plain read grant. `test_a_public_deny_on_a_composite_deck_is_kept` |
| Collect every specified count | `state.TreeConversion`, `state.GrantConversion` | every §14.9 key this ticket owns, decided from the source rows so a rerun over a finished site reports the same numbers. `test_a_rerun_reports_the_same_source_counters` |
| Resumable batches of 1000, never splitting a pair | all three steps | root batches count target node, metadata, and optional anchor rows while keeping a pair atomic. Link batches use a state-file write-ahead ledger around the database commit. `TestBatching`, `RerunTest`, and `LinkInterruptionTest` cover both interruption boundaries |
| Preserve migration source tables | `LegacyTree` | no write method exists on the protocol. `SourceTest` in both modules, and `test_the_read_port_has_no_write_method` |

### Decisions taken where the spec leaves a choice

1. **A root node is always Active.** §3.1 fixes the canonical empty root
   shape and `_validate_root_shape` refuses any other. Lifecycle therefore
   lives on the metadata row: a Trashed root folder, a disabled User, and a
   missing User all give `Archived` metadata under an Active node. A
   `Removed` root folder is skipped whole, because publishing it would
   resurrect a deleted namespace.
2. **A link above EDIT is clamped, not dropped.** §5.9 refusal 9 refuses a
   link above EDIT for everyone, Suite Admin included, and a MANAGE link
   would let whoever holds the token grant and purge. Dropping the row
   would take away access the site really had. `links_clamped` counts it.
3. **Over-capacity subtrees are skipped with their descendants.** §3.1 sets
   both limits and names no behaviour past them. Writing anyway would
   truncate `path`, silently moving a subtree, or leave a node every later
   save refuses.
4. **A chain terminating cleanly outside Drive is not broken.** frappe's
   `Home` and any folder-less row an older version left behind are not
   Drive's tree, so §14.4 neither migrates nor counts them.
5. **A user principal must be a valid email.** `access._principal_kind`
   takes nothing else, and `Drive Permission.user` is a plain Link, so it
   can hold `Administrator` or `Guest`. A grant written with either is a
   row nothing ever reads. Neither loses access: `is_drive_admin` gives
   Administrator everything without a grant, and a guest reads through
   `$PUBLIC`. Both are dropped and counted under `dead_principal`.
6. **A deny naming a Personal root's own user is dropped** anywhere inside
   that root, per §5.9 refusal 11. A `$GENERAL` deny in the Shared root
   stays legal.
7. **A fresh Active root makes an unmigrated legacy root a refusal.** The
   accepted source mapping wins: an enabled `Users/<email>` folder becomes
   Active and keeps its `File` id (§14.3). Build locks the same stable
   identity row as the live root creator, then refuses any other Active
   root. It archives neither namespace. An already-Archived legacy pair is
   different: offboarding and email reuse may validly leave it beside a
   fresh Active root, so a rerun preserves that target lifecycle.

### Commands and real results

This is the historical first implementation pass, before the final review
and root site gate. It ran site-free in the worktree. No `bench`, `migrate`,
`install`, `restart`, or `push` was run in that pass; `slides.localhost`, its
queues, and its configuration were not touched.

```
$ cd /home/faris/benches/suite-bench/apps/.worktrees/suite-drive-27
$ python3 -m compileall -q suite/drive/patches/build suite/drive/tests/test_build_tree.py
COMPILED

$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_tree.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_tree.py
27 files already formatted

$ cd /home/faris/benches/suite-bench/sites
$ PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-27 \
  ../env/bin/python -c '
import sys, unittest, frappe
frappe.init(site="slides.localhost")
mods = [
 "suite.drive.patches.build.tests.test_gate",
 "suite.drive.patches.build.tests.test_layout",
 "suite.drive.patches.build.tests.test_s3_copy",
 "suite.drive.patches.build.tests.test_legacy_bytes",
 "suite.drive.patches.build.tests.test_ports",
 "suite.drive.patches.build.tests.test_dormancy",
 "suite.drive.patches.build.tests.test_mapping",
 "suite.drive.patches.build.tests.test_titles",
 "suite.drive.patches.build.tests.test_root_pairs",
 "suite.drive.patches.build.tests.test_tree",
 "suite.drive.patches.build.tests.test_grants",
 "suite.tests.test_architecture",
]
suite = unittest.TestLoader().loadTestsFromNames(mods)
r = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if r.wasSuccessful() else 1)
'
Ran 401 tests in 2.237s

OK
```

`frappe.init` with no `connect` is enough: every module under test reads the
framework but no database. Per module: `test_mapping` 52, `test_titles` 23,
`test_root_pairs` 60, `test_tree` 59, `test_grants` 67, and, unchanged from
ticket 26, `test_gate` 15, `test_layout` 8, `test_s3_copy` 41,
`test_legacy_bytes` 34, `test_ports` 28, `test_dormancy` 7,
`suite.tests.test_architecture` 7.

`suite/drive/tests/test_build_tree.py` collects 25 cases and was **not run**:
it is an `IntegrationTestCase` and needs the site.

### Mutation check

Eight mutations of the production modules, one at a time, each reverted, the
261-test site-free suite run against each.

| Mutation | Caught by |
|---|---|
| the dedupe suffix ignores the column width | `test_a_deduplicated_title_fits_the_column` and 2 more |
| a blobless file keeps its legacy size | `test_a_blobless_file_carries_no_size_and_no_mime` |
| an unrepresentable link is written | `test_a_link_with_no_url_is_skipped`, `test_a_url_past_the_column_is_skipped` |
| the census memo drops the Removed flag | **survived**, see below |
| the `Users` row is counted as a defect | `test_the_users_row_is_never_a_defect` |
| step 5 does not check the pairs | `PairTest`, all 3 refusals |
| every anonymous row on a composite deck is dropped | `test_a_public_deny_on_a_composite_deck_is_kept` |
| a repair sends the anchor grant again | `TestPersonalRepair`, all 3 |

The survivor is an equivalent mutant. It shifts `_finish`'s memo by one
element, so each id records what was Removed strictly above it rather than
at or above it. No test can tell the two apart: a memo hit always lands on
an id already in the walking row's own trail, so that id's flag is counted
from the trail either way. The memo's flag is load-bearing only for
ancestors above the hit point, and both versions carry those.

Agents ran a further 53 mutations against `mapping.py` and `titles.py` and 5
against `root_pairs.py`. All 58 were caught.

### Defects the audits found and fixed

1. **A blobless file node was unsaveable.** `_validate_kind_shape` refuses a
   file with no blob that still carries a size or a MIME, and §14.1 leaves
   exactly those rows when Build cannot reach the bytes. Every one of them
   would have been a node nobody could rename, move, or trash again, and it
   would have charged the owner for bytes that are gone.
2. **A deduplicated title could overflow `varchar(140)`.** `File.file_name`
   is the same width, so a copied title always fits and a suffixed one may
   not. Two siblings with a full 140-character name would have failed the
   whole 1000-row batch. The stem now gives way and the extension survives.
3. **A link node could overflow `varchar(500)` or carry no URL.**
   `File.file_url` is a `Code` column with no bound, the only source column
   wider than its target. Both cases are skipped and counted now.
4. **A whitespace-only `file_name` produced a title the controller
   rejects.** `root_pairs` stripped it; `tree` did not.
5. **The census memo lost the Removed flag above a memoised node.** A row
   two levels under a Removed folder was reported as an unexplained defect
   instead of a skipped Removed row, on any site with such a folder.
6. **The `Users` row was reported as a defect on every site.** §14.3 drops
   it, so it has no node anywhere and appeared in the census on every run.
7. **A Personal root pair could not be repaired.** The repair path sent the
   anchor grant a second time and hit `grant_node_principal`, the unique
   `(node, principal)` constraint `drive_grant.py:15` adds. A site whose
   `Drive Root` row was lost would fail in the same place on every rerun.
8. **The composite-deck drop was too broad.** §14.5 drops the forced-public
   row, which `presentation.py` writes as `deny = 0, read = 1`. Dropping
   every anonymous row on a composite deck also dropped a public **deny**,
   and with it the §6.5 refusal that keeps an inherited `$PUBLIC` grant on
   an ancestor folder from publishing the deck.
9. **A DocShare row with an over-long principal was counted twice**, in both
   §14.9 drop buckets, inflating the permission total.
10. **`user_enabled`, `group_exists`, `sheet_entity`, and
    `is_composite_deck` were read per row.** A permission table naming the
    same twenty colleagues on ten thousand nodes was ten thousand `User`
    reads for each of them. All four are cached now.
11. **The census walked each chain alone**, two single-id queries per hop.
    On a site whose `File` table is mostly framework attachments that is a
    round trip per attachment to conclude it is not Drive's. A whole page
    now climbs together, two queries per round.
12. **`SiteTree` took its test narrowing two ways**, as a `frappe.get_all`
    clause and as a raw SQL prefix. Half its reads are SQL and cannot take a
    clause, so the filter form would have raised.
13. **The Active-root port was dead code.** `User.after_insert` can already
    have provisioned a Personal root at a fresh id. The first correction
    made step 4 consult the target table and archive the legacy-id pair while
    still returning it to the descendant walk. Item 17 supersedes that
    policy because it contradicted source precedence. Unit and real-table
    tests call `convert_root_pairs`; neither tests the helper in isolation.
14. **A row named after the legacy id could point at another node and pass.**
    Existing pairs are now checked against the same complete root-node shape
    as `validate_root_pair`: name, metadata node link, kind, parent, root,
    path, node state, empty content fields, metadata lifecycle, and Personal
    or Shared identity all have to agree before descendants are exposed.
15. **The root batch limit counted pairs rather than target rows.** A Personal
    pair can write a node, metadata, and an anchor, so the old 1000-pair batch
    could publish nearly 3000 rows. Boundaries now account for every row and
    move before, never through, an atomic pair.
16. **An exact grant auto-flush could permanently undercount a minted link.**
    `_Batch.add(link=True)` used to commit and save state before
    `record_link`. A write-ahead list of node ids is now saved before the DB
    batch, reconciled from `Drive Grant` on a rerun, and cleared only with the
    cumulative count after commit.
17. **Build silently archived the normative legacy root when a fresh-id root
    already existed.** That kept §3.2 uniqueness but contradicted §14.3,
    which makes an enabled legacy folder Active at its original `File` id.
    Build now takes the live creator's stable identity lock and refuses the
    contradictory target state without changing either namespace. It still
    accepts an already-Archived legacy pair beside a fresh root after valid
    offboarding and email reuse.
18. **Step 5 rechecked only pair existence and `kind=root`.** A pair could
    become noncanonical after step 4's commit, or its metadata could point
    elsewhere, and the tree walk would publish descendants below it. Step 5
    now applies the full step 4 validator again before its first write.
19. **A MariaDB deadlock could mask its own error.** InnoDB may remove every
    savepoint when it chooses a deadlock victim. The pair rollback used to
    raise the missing-savepoint error instead. It now uses the same fallback
    as the live root workflow: narrow rollback on Postgres and ordinary
    errors, full handle reset when MariaDB already rolled back the victim.
20. **The Active-root conflict check was still a MariaDB snapshot read.**
    Build took the correct stable identity lock, but an ordinary follow-up
    read could retain a snapshot from before a concurrent root creator
    committed. The query is now an explicit locking/current read, matching
    the live root workflow on both supported databases.
21. **The site-backed module used an existing User as a fixture.** That
    violated the implementation rules and let the preprovisioning regression
    create or depend on a non-prefixed live namespace. The module now inserts
    a minimal prefixed User with `db_insert` (so no provisioning hook or queue
    work runs) and deletes it with the rest of its isolated rows.

### Final blocker-correction verification

This is the final review worktree's record before the root site gate. No
bench command or database-backed test was run in that correction worktree.
The following site-free results are current at the final review commits:

```
$ python3 -m compileall -q suite/drive/patches/build suite/drive/tests/test_build_tree.py
COMPILED

$ uvx ruff@0.12.3 check suite/drive/patches/build suite/drive/tests/test_build_tree.py
All checks passed!
$ uvx ruff@0.12.3 format --check suite/drive/patches/build suite/drive/tests/test_build_tree.py
27 files already formatted

$ PYTHONPATH=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-27-final-review-2 \
  ../env/bin/python <the documented frappe.init plus 12-module unittest runner>
Ran 456 tests in 1.982s

OK
```

Current site-free module counts are: gate 15, layout 8, S3 copy 41,
legacy bytes 34, ports 68, dormancy 7, mapping 52, titles 23, root pairs
68, tree 61, grants 72, and architecture 7. The site-backed
`suite.drive.tests.test_build_tree` module collects 34 cases and was not run
here.

Five additional production mutations were applied one at a time and
reverted. All were killed:

| Mutation | Catching proof |
|---|---|
| ignore `DriveTarget.active_root` | all three `TestPreprovisionedPersonalRoot` cases |
| accept a metadata row whose `node` points elsewhere | the exact metadata-link mismatch case |
| count each root pair as one batch row | both target-row `TestBatching` assertions |
| skip the root-node `root = NULL` invariant | the canonical-shape field matrix |
| omit either write-ahead preparation or post-commit completion | `LinkInterruptionTest` and the ordinary anonymous-link case |

The final independent review applied eight more mutations one at a time and
reverted each one. All were killed: omit the Active-root conflict guard;
omit the second canonical-pair validation; count a root pair as one row;
omit link write-ahead preparation; omit post-commit link completion; and
replace the deadlock-safe rollback with a direct savepoint rollback; make
the post-identity-lock Active-root query a nonlocking snapshot read; move
the identity lock after its conflict read.

### Independent closeout and live site gate

The closeout auditor independently read the accepted migration behavior,
the ticket, and every implementation and final-review commit through
`c2773ec2c`. It reran the 12-module site-free command from the preceding
section against that exact tip:

```
Ran 456 tests in 2.393s

OK
```

It also reran the four original blocker reproductions directly against the
reviewed production paths. The preprovisioned-root case raised
`BuildPairError` before writing the legacy pair; a metadata row named after
the legacy id but linked elsewhere was refused; a 700-Personal-root fixture
kept every committed target-row delta at or below 999 while every pair stayed
atomic; and an anonymous above-read row at the exact two-row auto-flush
boundary persisted `links_minted = 1` with an empty write-ahead ledger.

The root orchestrator then ran the database-backed gate serially on
`slides.localhost` at `c2773ec2c`. No test was skipped. Every command exited
0 and printed `OK`:

| Module | Cases | Result |
|---|---:|---|
| `suite.drive.tests.test_build_tree` | 34 | `OK` |
| `suite.drive.patches.build.tests.test_root_pairs` | 68 | `OK` |
| `suite.drive.patches.build.tests.test_tree` | 61 | `OK` |
| `suite.drive.patches.build.tests.test_grants` | 72 | `OK` |
| `suite.drive.patches.build.tests.test_mapping` | 52 | `OK` |
| `suite.drive.patches.build.tests.test_titles` | 23 | `OK` |
| `suite.drive.patches.build.tests.test_ports` | 68 | `OK` |
| `suite.drive.patches.build.tests.test_dormancy` | 7 | `OK` |
| `suite.drive.tests.test_build_storage` | 12 | `OK` |
| `suite.tests.test_architecture` | 7 | `OK` |
| **Total** | **404** | **all passed** |

The 34 integration cases exercise the real MariaDB tables and indexes, the
bulk-insert column tuples, savepoint rollback, identity lock/current-read
path, compound keyset pagination, canonical pair validation, source-row
preservation, grant uniqueness, and both sides of link write-ahead recovery.
Together with the exhaustive mapping fixtures, interruption/rerun tests,
eight final-review mutation kills, and dormant-package checks, this evidence
proves each checked acceptance criterion without activating Build.

### Known residual risks after the site gate

- **`_Batch.flush` reads `grant_roles` once per node.** A batch of 1000
  grants spread over 1000 nodes is 1000 queries. Batching it needs a
  protocol change on `DriveTarget`, which ticket 28 or 29 can make once the
  shape of the remaining steps is known.
- **`_NodeFacts` drops its node cache wholesale at 20 000 entries.**
  Permission rows arrive grouped by entity, so the entry in use is refilled
  at once. A site with more than 20 000 shared sheets thrashes it, because
  `DocShare` rows arrive in `name` order.
- **A rerun does not correct metadata state.** A user disabled after the
  first run keeps `Active` metadata. §14.3 does not ask for a rerun to fix
  it, and Build is a migration rather than a sync, but nothing says so.
- **An Archived duplicate Personal root still gets its MANAGE anchor.** The
  second `Users/<email>` folder for one address is Archived and still
  carries one grant for the same person. Harmless, and it keeps "one anchor
  per Personal root node" true without an exception.
- **A Trashed `File` row with no `file_modified`, no `modified`, and no
  `creation` would produce a Trashed node with no stamp**, which
  `DriveNode.validate` refuses. Only reachable through a hand-inserted row:
  `creation` is a framework column and is never NULL on a real site.
- **The forced-public composite rule cannot separate a real public read.**
  An owner who publicly shared a deck read-only, on a deck that later became
  composite, is indistinguishable from the forced row. §14.5 drops it and
  `composite_rows_dropped` counts it.

### Site gate command set (completed)

The root orchestrator ran this command set serially on `slides.localhost`;
the results are recorded above:

```
TICKET_WORKTREE=/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-27-final-review-2

env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.tests.test_build_tree

env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_root_pairs
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_tree
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_grants
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_mapping
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_titles
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_ports
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.patches.build.tests.test_dormancy

env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.drive.tests.test_build_storage
env -C /home/faris/benches/suite-bench PYTHONPATH="$TICKET_WORKTREE" \
  bench --site slides.localhost run-tests --module suite.tests.test_architecture
```

Every final gate command exited 0 and printed `OK`. The output was also read
for `OK` or `FAILED` rather than inferred from process status alone.

`test_build_tree` writes `File`, `Drive Permission`, `Drive Node`,
`Drive Root`, and `Drive Grant` rows under a per-run prefix, cleaned up in
`tearDown`. It never touches the site's own `Drive` or `Users` rows: the root
pair and enabled email User it works with are synthetic and prefixed. The
User is inserted with `db_insert`, so the provisioning hook and background
queue do not run.

**A `bench migrate` proves nothing about this ticket and must not be used as
its gate.** The package is still dormant: `patches.txt` does not name it,
`hooks.py` does not reference it, no module exports `execute`, and parsing
every module shows nothing runs at import time. `test_dormancy` (7) checks
all of that by globbing the package, so `tree.py` and `grants.py` are covered
without a list to keep. Registration is ticket 30's; the entry point that
calls these three steps in order is ticket 29's.
