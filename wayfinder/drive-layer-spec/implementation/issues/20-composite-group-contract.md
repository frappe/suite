# 20 — Load composite references in authorized groups

**What to build:** Load large composites without sending unrelated link codes or weakening reference authorization.

**Blocked by:** [18 — Move Slides documents and media into Drive](18-slides-adoption.md)

**Status:** in-progress

**Owner:** Suite Slides API

**Starting revision:** Suite `63ec3f2d181a36d8802c5141c2d8077ee7bb3ea7`;
Frappe `e9cc6261d1bb342383d9cb641e8190cbfc3854fd` (read only, unchanged).

**Claimed files:** `suite/slides/api/composite.py`,
`suite/slides/tests/test_composite_groups.py`, `suite/slides/drive.py`,
`frontend/src/apps/slides/contracts/composite-groups.fixture.json`,
`frontend/src/apps/slides/contracts/composite-groups.test.ts`,
`suite/tests/test_architecture.py`, and this ticket.

`suite/slides/drive.py` and `suite/tests/test_architecture.py` are ticket 18's
files. Ticket 18 handed both changes to this ticket in writing; see
[Deviations from file ownership](#deviations-from-file-ownership).

**Execution gate:** None beyond completed blockers.

**Source:** [Drive spec](../../drive-layer-spec.md), §6.2, §6.6; §11.2 composite route.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Acceptance criteria

- [ ] Define and document the Slides grouped-load request and response contract beside its adapter tests.
- [ ] Use stable reference identifiers and bounded requested groups. Validate membership in the composite; reject arbitrary injected references.
- [ ] Authorize the composite and each requested reference on every group. Count the composite’s own code within the 20-item cap.
- [ ] Return unreadable references explicitly in their requested order. Do not silently remove them or expose their content.
- [ ] Keep each group independently loadable after grant changes. Remembered client target associations confer no authority.
- [ ] Provide contract fixtures for frontend adoption, including more than 20 separately shared references.
- [ ] Keep this a Slides API operation. Add no generic Drive route or new permission rule.

## Verification

Run grouped-load tests for 19 references plus a composite code, multiple groups, unauthorized ids, revocation between groups, and stable placeholders.

## Completion evidence

Implemented 2026-09-06 in this worktree, on `implement/drive-20-composite-groups`.
Status stays `in-progress` and every box stays unchecked. The Python half of
the shared-site gate is green at `1778ac347`; `yarn --cwd frontend test` has
still not run.

| Commit | What it did |
|---|---|
| `92a14a9c5` | Claimed the ticket and recorded the two ticket-18 files it touches. |
| `0ed123202` | `suite/slides/api/composite.py`, the contract, and the narrowed swallow. |
| `53ae486ad` | The first 42 tests, the frontend fixture and its vitest test, the debt entry. |
| `543f37d6a` | Refuse a composite name that is not a docname. |
| `bd9904751` | Never read a blank reference row as a database filter. |
| `b3ceb6b3d` | Review: stop claiming a composite reference has no slides. |
| `1d5bb2254` | Review: state what a client reads for a reference with no deck. |
| `d1e893c6c` | Review: one empty value for a reference that names no deck. |
| `adbf503df` | Review: refuse a malformed group before it costs a 500. |
| `6cfac67b3` | Review: make the contract tests able to fail. |
| `4c0a47a60` | Gate: annotate `references`, and hold the signature with two tests. |
| `1778ac347` | Gate: put the hidden deck in a root its reader cannot own. |

### Changed behaviour and interfaces

**New: `suite/slides/api/composite.py`.** Two whitelisted, guest-reachable
Slides operations. The request and response contract is that module's
docstring, which is what "documented beside its adapter tests" resolves to in
this repository: the sibling contracts live in
`suite/sheets/collab.py:1-53` and `suite/slides/drive.py:1-66`, and no
markdown-beside-a-test convention exists to follow.

- `composite_manifest(name)` answers the reference list with a stable id per
  reference, the group bound, and the composite's `modified`. One point check,
  on the composite. It opens no reference and says nothing about whether one
  can be read.
- `composite_group(name, references)` answers content for one bounded group:
  one point check on the composite plus one per requested reference.

**New: `slides_drive.composite_reference_rows(docname)`.** The reference list
with the `Reference Presentation` row's own name as the identifier, its `idx`,
and the referenced deck's docname, or `None` when the row names no deck.
`_reference_names` reads through it, so it answers exactly what `pluck`
answered and the version envelope and the save-time check are unchanged.

**`_readable` became `node_is_readable` and catches `drive.DriveError`.** The
wider `except frappe.ValidationError` swallowed the oversized-`X-Drive-Links`
refusal and marked every reference unreadable, which is the silent trim §6.2
forbids. Ticket 18 recorded this as ticket 20's; it is fixed for the grouped
load, the whole-deck read path, and the save-time check at once. Every Drive
access answer is a `DriveError`, so no access behaviour moved.

**A fourth site still swallows it, and this ticket did not fix it.**
`get_editor_access` (`presentation.py:903-905`) is guest-reachable and catches
`frappe.ValidationError` around its own `drive.check`, so an oversized header
makes it answer `"none"` instead of stating the limit. It fails closed, so no
access is gained. `presentation.py` is not this ticket's file and no handoff
covers it, so it is recorded here for ticket 23 rather than changed.

**Nothing else moved.** No Drive route, no Drive export, no permission rule, no
hook, no doctype, no patch. `drive_content_types` is still `[]` and both
`Presentation` permission entries still point at `presentation.py`, so the
registry stays dormant and ticket 29 still owns activation.
`get_composite_presentation` is unchanged; ticket 34 moves the client onto the
grouped calls.

### Decisions

- **A reference id is the child row's own name.** Not the deck docname, which
  collapses a composite that names one deck twice and is guessable; not `idx`,
  which moves on a reorder. A row name belongs to one composite, so it is
  useless as an injected value, and it does not move when a grant does — which
  is what makes a placeholder stable.
- **The id is stable while the reference list is.** `duplicate` and
  `restore_version` rewrite the table and mint new ids. A client holding an
  older list is refused by the membership check rather than answered from a
  guess, and the manifest carries `modified` as the staleness cue.
- **The bound is 19, always.** `LINK_HEADER_LIMIT - 1`, so the worst honest
  group is the composite's code plus one per reference. The server bounds the
  group whether or not codes were sent: it cannot know which references the
  client reached through a link, and must not answer a request the client could
  not have authorized in full.
- **Supplied ids are counted before duplicates come out.** §4.7 counts header
  items that way so filtering cannot bypass the limit; a group counts the same
  way so a repeat cannot buy room.
- **Request shape is refused before the composite is resolved.** Those refusals
  describe the request, so they answer no question about the site and keep a
  malformed call off the database. Membership is refused *after* authorization,
  so a caller who cannot read the composite never learns which ids belong to it.
- **One refusal text for the composite.** `"Presentation is not public"`, the
  whole-deck read path's own words, for "not a composite", "no such deck", "not
  in Drive", and "you cannot read it". Both routes are guest-reachable.
- **A reference that is itself a composite is answered, marked, and not
  recursed into.** Ticket 18 left the semantics here. One call resolves one
  level; a client that wants the inner deck's references asks for its manifest,
  which runs that deck's own checks.
- **A remembered target confers no authority because the call cannot carry
  one.** The request holds reference ids and nothing else. A node id or a deck
  docname in that position fails membership, so there is no field for a client
  assertion to occupy.

### Failure evidence

- `test_a_name_that_is_not_a_docname_is_refused_before_any_lookup` and
  `543f37d6a`: `frappe.db.get_value` reads a dict or a list in the name
  position as filters. Both calls are guest-reachable, so a caller sending one
  was choosing the query rather than naming a deck.
- `test_a_blank_reference_row_is_unreadable_rather_than_an_error` and
  `bd9904751`: a reference row may hold no deck, and both readers now mark it
  unreadable. **The original claim here was wrong** and `d1e893c6c` restates it.
  `frappe.db.get_value` does not read a falsy name as "no filters": `get_values`
  returns before it builds a query for `None`
  (`frappe/database/database.py:680-722`), and `""` becomes `name = ''`
  (`frappe/database/query.py:399-401`), which no primary key matches. The guard
  saves a query. It closed no disclosure, and the test passes with or without
  it. The real hole is a dict or a list in the name position, which `543f37d6a`
  closed and `d1e893c6c` closes in the third caller,
  `refuse_unreadable_references`.
- `test_an_oversized_link_header_is_refused_rather_than_marking_everything_unreadable`
  asserts the limit error reaches the caller and is not a `DriveError`.
- `test_the_composite_is_authorized_again_on_every_group` revokes the
  composite's own grant between two groups and asserts both calls refuse.

### Criteria to tests

49 tests in `suite/slides/tests/test_composite_groups.py`: 16 in
`TestCompositeGroupRequest` with no site, 33 in `TestCompositeGroups` on real
rows under `activated()`. 23 more in
`frontend/src/apps/slides/contracts/composite-groups.test.ts`.

| Criterion | Tests |
|---|---|
| 1 Contract documented beside the adapter tests | The `composite.py` docstring; `test_the_frontend_fixture_matches_a_real_answer`, `test_the_route_refuses_with_the_whole_deck_read_paths_own_words`, and the whole vitest file |
| 2 Stable ids, bounded groups, membership, injection | `test_a_reference_id_is_the_row_and_never_the_deck_or_the_node`, `test_a_grant_change_never_moves_a_reference_id`, `test_the_group_bound_leaves_exactly_one_code_for_the_composite`, `test_nineteen_ids_are_accepted_and_twenty_are_refused`, `test_a_repeat_counts_toward_the_bound_rather_than_buying_room`, `test_a_repeat_inside_the_bound_is_still_refused`, `test_nineteen_references_load_in_one_group`, `test_a_twentieth_reference_needs_a_second_group`, `test_an_invented_id_a_deck_name_and_a_node_id_are_all_refused`, `test_a_reference_id_from_another_composite_is_refused`, `test_membership_gives_one_answer_for_an_unknown_and_a_foreign_id`, `test_a_name_that_is_not_a_docname_is_refused_before_any_lookup`, `test_an_id_wider_than_a_docname_is_refused`, `test_a_reference_id_held_across_a_version_restore_is_refused_not_guessed` |
| 3 Authorize composite and every reference per group; count the composite's code | `test_the_composite_is_authorized_again_on_every_group`, `test_a_link_code_authorizes_its_reference_for_the_group_that_carries_it`, `test_more_than_twenty_separately_shared_references_load_in_two_groups`, `test_a_group_carrying_the_wrong_codes_marks_only_those_references`, `test_twenty_codes_are_still_accepted`, `test_an_oversized_link_header_is_refused_rather_than_marking_everything_unreadable` |
| 4 Unreadable references explicit, in order, without content | `test_an_unreadable_reference_comes_back_in_place_with_no_content`, `test_a_group_answers_in_the_order_it_was_asked_not_the_stored_order`, `test_a_group_answers_one_entry_per_requested_id_and_nothing_else`, `test_the_order_the_caller_asked_for_survives_the_request_reader`, `test_a_readable_reference_carries_its_node_and_its_slides`, `test_a_blank_reference_row_is_unreadable_rather_than_an_error`, `test_a_reference_that_is_itself_a_composite_is_marked_and_never_recursed_into`, `test_a_group_entry_carries_the_documented_fields_and_nothing_more`, `test_the_manifest_names_an_unreadable_reference_exactly_like_a_readable_one` |
| 5 Groups independent across grant changes; remembered targets confer nothing | `test_a_reference_revoked_between_two_groups_is_unreadable_in_the_second`, `test_a_reference_granted_between_two_groups_is_readable_in_the_second`, `test_a_placeholder_keeps_its_id_and_its_place_across_repeated_loads`, `test_a_grant_change_never_moves_a_reference_id`, `test_a_remembered_association_confers_no_authority` |
| 6 Frontend fixtures, more than 20 separately shared references | `composite-groups.fixture.json` (21 references, two groups), `test_the_frontend_fixture_matches_a_real_answer`, and the 14 vitest cases |
| 7 A Slides operation only | `test_a_deck_that_is_not_a_composite_is_refused_even_to_its_owner`, `suite.tests.test_architecture` (7 tests, including the frozen `drive.__all__`), and the unchanged `suite/hooks.py` |
| Non-disclosure (§5.4) | `test_a_stranger_is_refused_before_membership_is_ever_checked`, `test_both_calls_answer_a_stranger_the_same_way_three_times`, `test_a_malformed_group_is_refused_the_same_way_whatever_the_name_is`, `test_the_refusal_message_names_no_reference_and_no_deck`, `test_a_guest_reads_a_published_composite_and_only_published_references`, `test_a_shape_refusal_is_a_validation_error_not_a_permission_error` |
| Malformed shapes | `test_every_malformed_group_is_refused_with_one_answer` (20 shapes, one answer), `test_a_group_arrives_as_a_list_or_as_its_json_text`, `test_a_json_list_holding_a_non_string_is_refused`, `test_deeply_nested_json_is_refused_rather_than_raised`, `test_an_oversized_request_text_is_refused_before_it_is_parsed` |
| Duplicates | `test_a_composite_naming_one_deck_twice_answers_two_separate_references`, `test_a_repeat_inside_the_bound_is_still_refused` |

### The frontend contract fixture

`frontend/src/apps/slides/contracts/composite-groups.fixture.json` is the first
contract fixture in this repository; nothing set a format to follow, so it
states one. It holds a composite of 21 separately shared decks, the manifest,
the two groups it takes, and the six refusals a client must handle with their
exception classes and HTTP statuses. Ids, timestamps and codes are
placeholders; shapes, ordering and counts are not.

The first group carries the composite's code plus 19 reference codes, which is
the 20 `X-Drive-Links` allows. The second carries only the composite's code, so
both of its references come back marked, in place, with no content — which is
the placeholder case ticket 34 has to draw.

Two tests hold it: `test_the_frontend_fixture_matches_a_real_answer` compares
it against a real answer from the site, and `composite-groups.test.ts` holds
the fixture to the rules it states. **There is no client.** Nothing in
`frontend/src` calls either method yet, so the vitest file pins the fixture's
shapes, counts and arithmetic and nothing more. Ticket 34 writes the client.

### Verification

#### Static and pure checks run here

Run in this worktree at `6cfac67b3`, from
`/home/faris/benches/suite-bench/apps/.worktrees/suite-drive-20-review`. No
bench, no migrate, no shared-site command, no service touched.

| Check | Command | Result |
|---|---|---|
| Compile | `python -m compileall` on the four changed `.py` files | Clean |
| Lint | `uvx ruff@0.12.3 check` on the four | All checks passed |
| Format | `uvx ruff@0.12.3 format --check` on the four | 4 files already formatted |
| Python, no database | `TestCompositeGroupRequest` 16, `TestSlidesDeclaration` 30, `TestWriterDeclaration` 23, `TestSheetsDeclaration` 21, `suite.tests.test_architecture` 7 | 97 tests, OK |
| Frontend contract | `vitest run` on `composite-groups.test.ts` | 23 passed |
| Fixture mutation | 11 fixture mutations against the vitest suite | 10 caught; the eleventh is a legal out-of-order group and must pass |
| Recursion mutation | `except (ValueError, RecursionError)` narrowed back to `except ValueError` | `TestCompositeGroupRequest` errors, as intended |

The Python classes run with `frappe.init(site="slides.localhost")` and no
connection, from `/home/faris/benches/suite-bench/sites` with `PYTHONPATH` set
to this worktree. `test_composite_groups.__file__` and `composite.__file__` are
both asserted to come from this worktree.

Repo-wide `uvx ruff@0.12.3 check .` reports **24** errors, in 16 files, none of
them touched by this branch. The earlier note of "five" was wrong; the count
was never measured at the repository root.

**The vitest run needed a temporary config.** This worktree has no
`node_modules`, and installing is out of scope, so the main checkout's install
was symlinked in (gitignored). Vite's `server.fs.allow` then refuses the setup
file through the symlink, and **every existing frontend test fails the same
way** (checked against `src/apps/slides/stores/blankLineStyles.test.ts`), so
the run used a throwaway config that widens `server.fs.allow`, drops
`setupFiles`, and uses the `node` environment. The file is not committed.
`yarn --cwd frontend test`, the repository's own command, is **not verified
here**. Prettier is not installed either, so the two frontend files follow the
surrounding style by hand rather than by tool.

#### The site gate, Python half run 2026-09-06

Serialised on `slides.localhost` from `/home/faris/benches/suite-bench`, in
this order, one command at a time, with the previous one finished.

```
bench --site slides.localhost migrate
bench --site slides.localhost run-tests --module suite.slides.tests.test_composite_groups
bench --site slides.localhost run-tests --module suite.slides.tests.test_drive_adoption
bench --site slides.localhost run-tests --module suite.slides.doctype.presentation.test_presentation
bench --site slides.localhost run-tests --module suite.slides.tests.test_pasted_media
bench --site slides.localhost run-tests --module suite.slides.api.test_file
bench --site slides.localhost run-tests --module suite.drive.tests.test_content
bench --site slides.localhost run-tests --module suite.drive.tests.test_principals
bench --site slides.localhost run-tests --module suite.tests.test_architecture
yarn --cwd frontend test
```

Run these serially. The bench has no RQ worker, and its short queue saturates
if several test modules enqueue at once.

`migrate` is listed because the branch is unproved against it, not because it
changes schema: no doctype, no patch, and no fixture record moved.
`test_drive_adoption` and `test_presentation` are in the list because this
ticket changed `suite/slides/drive.py`, which both exercise.
`suite.drive.tests.test_principals` is there because the narrowed swallow now
lets its limit error out.

Expected counts, from a static enumeration of the classes at `6cfac67b3`:
`test_composite_groups` **16** unit and **33** integration; `test_drive_adoption`
30, 11 and 60; `test_architecture` 7; `composite-groups.test.ts` **23**. No test
class inherits a test method, none is skipped, and no method name is defined
twice in the new module.

##### What the gate answered

The first run at `840a487c4` gave **42 errors and 3 failures** in the
`test_composite_groups` integration class. Every error was the same
`FrappeTypeError`, and all three failures were caused by it. Results at
`1778ac347`:

| Module | Counts | Result |
|---|---|---|
| `migrate` | — | Reported successful before this session; not re-run here |
| `suite.slides.tests.test_composite_groups` | 18 unit, 34 integration | OK, twice in a row |
| `suite.slides.tests.test_drive_adoption` | 30 unit, 71 integration | OK |
| `suite.slides.doctype.presentation.test_presentation` | 19 integration | OK |
| `suite.slides.tests.test_pasted_media` | 3 integration | OK |
| `suite.slides.api.test_file` | 21 integration | OK |
| `suite.drive.tests.test_content` | 53 unit, 49 integration, 3 unspecified | OK |
| `suite.drive.tests.test_principals` | 10 unit | OK |
| `suite.tests.test_architecture` | 7 unspecified | OK |
| `yarn --cwd frontend test` | — | **Not run** |

The unit class is 18, not 16, and the integration class 34, not 33: three
tests were added at `4c0a47a60`.

##### The 42 errors

`suite/hooks.py` sets `require_type_annotated_api_methods`, so frappe validates
every whitelisted argument against its annotation before the body runs.
`composite_group` declared `references=None` with no annotation, and frappe
raised `FrappeTypeError` for every call. Two things hid it:

- `frappe.whitelist` applies the check only inside a request or a test
  (`apply_condition=_in_request_or_test`), so every static check, every
  no-database run, and the vitest suite pass with the argument bare.
- The unit class calls `_requested_references` and `_authorized_composite`
  directly, so it never crosses the wrapper.

It was a live defect, not a test artefact: a real client of the route read a
417 for every call.

`references: object` is now the annotation, and the module docstring says why.
A transport picks the type this argument arrives as: `make_form_dict` hands a
JSON body over as the real list and a form or query string as text, and a
hostile caller can send any type JSON carries. Measured against
`transform_parameter_types`, `list[str] | str | None` refuses `5`, `True`,
`{...}`, `[["a"]]` and `["a", 7]` with frappe's own text, so a JSON client and
a form client would read two different refusals for one mistake. `object`
passes every value to `_requested_references` unchanged.

##### The three empty answer sets

Not a fourth defect, and not a test flaw. All three tests collect refusal
messages inside `self.subTest`. `FrappeTypeError` subclasses `TypeError`, not
`frappe.ValidationError`, so it escaped `assertRaises`, `subTest` recorded an
error, and the `answers.add(...)` line below it never ran. The sets were empty
because the loop bodies never finished. Annotating `references` emptied all 42
errors and all 3 failures at once.

##### Two fixture flaws the annotation then exposed

Both proved before they were changed, both in the test module.

1. **`other_root` belonged to VIEWER.** `create_root` writes an anchor grant
   for its own user, so a deck placed in VIEWER's root is readable by VIEWER.
   `test_an_unreadable_reference_comes_back_in_place_with_no_content` and
   `test_a_placeholder_keeps_its_id_and_its_place_across_repeated_loads` read
   that root as VIEWER and asserted `readable: false`. The proof that the root
   and not the point check was wrong: three sibling tests place a deck in the
   same root, read it as STRANGER, and get `readable: false`. The root now
   belongs to OUTSIDER, who is never a caller.
2. **`_real_refusal_messages` probed without authorization.** It ran as a guest
   with no `X-Drive-Links`, so `_authorized_composite` refused first and
   `injected_reference` recorded `Presentation is not public` instead of the
   membership message. That is the module's documented order, not a defect in
   it: membership is checked after authorization. Each probe now carries the
   composite's link code, the way the manifest and group calls above it do. The
   three shape refusals are unaffected, because the reader runs before
   authorization.

No non-disclosure assertion was weakened. `assertRaises(frappe.PermissionError)`
and the `api.REFUSED` equality checks are untouched.

##### The guard against a recurrence

Three tests, all of which fail with the annotation reverted (checked):

| Test | Reverted-annotation result |
|---|---|
| `test_every_whitelisted_call_here_survives_enforced_type_checking` | Errors on `composite_group`; calls frappe's own enforcement, so it cannot drift from it |
| `test_the_whitelisted_call_hands_the_reader_the_value_it_was_sent` | Errors on all 10 shapes, then fails on the recorded list |
| `test_a_malformed_group_is_refused_the_same_way_whatever_its_json_type` | Errors on all 8 shapes, then fails |

**Suspicions written before the run.** Each was a guess. Outcomes added after.

1. **`TestSlidesInDrive` and `TestCompositeGroups` both create Personal roots.**
   The users differ, so the roots differ, but a run killed between `setUp` and
   its cleanup leaves roots behind and `create_root` then refuses. Both classes
   purge at `setUpClass` for that reason.
2. **`_remove_fixture_rows` commits.** That is what defeated rollback isolation
   on tickets 17, 18 and 19. Here the commit follows the root purge, and roots
   own every deck, slide, node and grant these tests write, so there should be
   nothing left to strand. `File Blob` is not swept: this module uploads no
   media.
3. **`ensure_user` may leave three users behind.** The adoption modules do the
   same and the site already carries their fixture users.
4. **`_widely_shared_composite` writes 21 decks and 22 grants, three times.**
   Slow, and the first candidate if the module times out.
5. **The blank-row test saves with `flags.ignore_validate`.** If frappe stops
   honouring that flag on a child-table append, the save raises and the test
   errors rather than failing.
6. **`link_header` installs a real `werkzeug` request.** If a test in the same
   module leaves one installed after an exception, later tests would carry
   codes they did not ask for. The context manager restores in `finally`.
7. **`test_the_frontend_fixture_matches_a_real_answer` reads a path four levels
   above the test file.** It breaks if the module moves, and it is the only
   test that touches the repository tree. It now also answers the five
   translated refusal messages from the server, so a site running under a
   non-English language would fail it.
8. **`test_a_reference_id_held_across_a_version_restore_is_refused_not_guessed`
   calls `restore_version` directly.** It saves as Administrator, whose admin
   bypass carries `refuse_unreadable_references`. If the fixture user changes,
   the save refuses instead.

None of the eight happened. The module ran clean twice in a row, and the only
site-only defect was the one no static check could reach.

##### Read on the site, deliberately not changed

`name: str` has the same asymmetry the annotation fix removes for
`references`. Over HTTP, a `name` that is a dict, a list, a number or a
boolean reads frappe's `FrappeTypeError` (417), not the `REFUSED`
`PermissionError` (403) the Refusals table promises;
`_authorized_composite`'s own guard only sees a value frappe already accepted.
It discloses nothing, it breaks no test, and it is outside this gate's scope,
so it is recorded rather than changed.

## Independent adversarial review

Reviewed 2026-09-06 at `113cebb68`, in a separate worktree, on
`review/drive-20-composite-groups`. Agents ran three audits: the API contract,
authorization, and the frontend fixture with test adequacy. Every claim below
was re-derived from source before it was acted on.

### Fixed here

| Severity | Finding | Commit |
|---|---|---|
| High | `test_a_reference_that_is_itself_a_composite_is_marked_and_holds_no_slides` asserted `slides == []`, and the contract said the same. `create_empty` gives every deck one slide and flagging it composite removes nothing, so the test fails the first time the site gate runs. | `b3ceb6b3d` |
| High | `json.loads` answers `RecursionError`, not `ValueError`, for deeply nested text. `composite_group` parses before it authorizes and is guest-reachable, so a 200 KB body of open brackets was an uncaught 500 and one `Error Log` row, repeatable anonymously. | `adbf503df` |
| Medium | The grouped load answered `""` for a reference row with no deck; the whole-deck path answered `null` for the same row. A client keying a placeholder on `presentation` collided every blank reference on one value, and could read `""` as a docname. | `d1e893c6c` |
| Medium | `refuse_unreadable_references` passed `reference.presentation` straight from the submitted document into `frappe.db.get_value`. A dict there becomes filters. Third caller of the hole `543f37d6a` closed. | `d1e893c6c` |
| Medium | Seven mutations of the fixture passed all 14 vitest cases, including wrong HTTP statuses, junk refusal messages, and a dropped composite code. The refusal assertions were `toBeTruthy()` and `toBeGreaterThan(0)`. | `6cfac67b3` |
| Medium | The vitest required the flattened group requests to follow manifest order, which forbids a legal out-of-order group the API allows and a backend test proves. | `6cfac67b3` |
| Medium | `test_the_frontend_fixture_matches_a_real_answer` compared one manifest row, no types, and one of six refusal messages, while its docstring claimed "the same keys, the same types". | `6cfac67b3` |
| Low | The manifest read `modified` in a second query after the point check had already read the row. | `adbf503df` |
| Low | The contract stated no HTTP status. These are Slides methods, so frappe answers 417 where §4.7 names 400 on a Drive route. | `adbf503df` |
| Low | The fixture showed neither of two shapes the backend produces: a nested composite, and a reference with no deck. | `6cfac67b3` |

Corrected in this document: the `bd9904751` failure evidence, the repo-wide
ruff count, the claim that the vitest holds a client, and the claim that the
narrowed swallow fixed every site.

### Confirmed, deliberately not changed

- **An unreadable reference still answers its deck's docname.** Suppressing it
  in a group buys nothing, because the manifest hands the same caller every
  reference docname and cannot do otherwise: it must cost one point check, so
  it cannot know which references are readable. The oracle that consumes a
  docname is `is_composite_presentation` (`presentation.py:696-698`), guest-
  callable with no check, which ticket 23 already owns. Docnames are random
  hashes, `Presentation` declares no `autoname`, and every read route still
  runs `frappe.has_permission`, so a leaked docname is not a capability.
- **`get_editor_access` keeps the wide swallow.** `presentation.py` is not this
  ticket's file and no handoff covers it. Recorded above for ticket 23.
- **`slides` is `as_dict()`, so it carries frappe's row metadata including
  `owner`.** Identical to what `get_composite_presentation` already answers to
  the same callers, so narrowing it here would split the two routes' shapes
  while ticket 34 is migrating between them. The key set is now pinned on both
  sides and stated in the contract.
- **Neither call is paged.** A composite with 10000 references answers a
  10000-row manifest. Building one needs MANAGE and 10000 point checks at save,
  and `get_composite_presentation` is strictly worse, so this is not a new
  exposure. Paging is a contract change ticket 34 would have to follow.
- **The grouped calls answer no `title` and no `theme`,** so a client cannot
  render a deck from them alone. Drive owns the title (§10.2) and the node id
  crosses for it; `theme` has no home in this contract. Adding fields during a
  review is scope this ticket did not ask for. Handed to ticket 34.

### Unresolved lows

- `str(datetime)` drops the fractional part when microseconds are 0, so
  `manifest.modified` is sometimes `"2026-09-06 11:04:12"`. The fixture records
  the microsecond form and nothing pins the format.
- Five of six refusal messages are `_()`-wrapped. A translated site changes
  them, and `test_the_frontend_fixture_matches_a_real_answer` now compares them
  against the server, so it is language-dependent. The fixture says to switch
  on the kind and the status instead.
- `version_bytes` writes `None` for a blank reference row and `_version_payload`
  requires every reference to be a `str`, so a version taken of a composite
  carrying a blank row cannot be restored. Pre-existing, unchanged by ticket 20,
  and it belongs to ticket 12 or ticket 18.
- `test_the_route_refuses_with_the_whole_deck_read_paths_own_words` greps
  `presentation.py` for a literal `frappe.throw` line. It passes on dead code
  and fails on a reformat.
- `principals_for_request()` is rebuilt inside each of the 20 `drive.check`
  calls a full group makes, so `X-Drive-Links` is parsed 20 times and a
  signed-in caller's roles and groups are looked up 20 times. A Drive engine
  concern, not this route's.
- Neither method declares a rate limit. `get_composite_presentation` does not
  either.

## Deviations from file ownership

Two of the claimed files belong to ticket 18, which handed both over in
writing.

- **`suite/slides/drive.py`.** Ticket 18's handoff says "Ticket 20 owns the
  grouped load that batches them, and the response codes for a marked
  reference", and its review list records the oversized-header swallow as
  ticket 20's. The reference-rows reader and the narrowed `except` are that
  work, and they belong beside `composite_references`, not in a second module.
- **`suite/tests/test_architecture.py`.** The new test module needs the grant,
  root and principal workflows tickets 21 and 22 will expose over HTTP. Its
  eight `_core` entries are recorded under their own owner, "Suite Slides API",
  with the same removal note the sibling test modules carry.

Neither file's Drive-facing behaviour changed. `drive.__all__` is untouched,
which `test_drive_public_interface_is_explicit_and_complete_only` proves.

## Handoffs

- **Ticket 34, frontend.** Adopt `composite_manifest` and `composite_group`,
  and read
  `frontend/src/apps/slides/contracts/composite-groups.fixture.json` for the
  shapes. Three specific debts: `presentationLoadRequests`
  (`frontend/src/apps/slides/utils/pinTargets.ts:34-64`) still pins
  `get_composite_presentation`, and the comment there says the pin list must
  mirror the load path exactly, so grouped loading changes the offline pin set;
  the SPA has no share-token store and sends no `X-Drive-Links` at all today,
  which tickets 32 and 33 owe first; and nothing in the SPA reads the
  `references` array the backend already returns, so there is no placeholder to
  extend.
- **Ticket 23, legacy read path.** `is_composite_presentation`
  (`presentation.py:696-698`) is guest-callable, runs no permission check, and
  answers whether a name is a composite. The grouped calls refuse with one text
  for exactly that reason, so their non-disclosure is only as good as that
  method. It is pre-existing and ticket 23 owns it.
- **Ticket 21, HTTP.** The grouped calls stay Slides methods. If the composite
  render ever moves under an HTTP route, §11.2 keeps it outside the Drive
  namespace.
- **This ticket, remaining.** `yarn --cwd frontend test` is the last gate step.
  It needs an install the review worktree did not have; run it from a checkout
  that does. After it passes, the boxes can be checked.

### Reviewed and deliberately not changed

- **`refuse_unreadable_references` runs with the restorer's principals.**
  Ticket 18 handed this over. It is the spec's answer, not a defect: §6.6 makes
  "you may reference what you can read" an ordinary read check at save, a
  version restore is a save, and a restorer who has lost read on a reference
  may not save it back. No change.
- **`get_composite_presentation` still runs one uncapped point check per
  reference.** Bounding it would break the client before ticket 34 moves it.
  The grouped calls are the bounded path, and the ticket asks for them, not for
  a cap on the existing route.
