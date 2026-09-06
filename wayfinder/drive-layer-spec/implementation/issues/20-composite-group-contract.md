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
Status stays `in-progress` and every box stays unchecked: the shared-site gate
below has not run.

| Commit | What it did |
|---|---|
| `92a14a9c5` | Claimed the ticket and recorded the two ticket-18 files it touches. |
| `0ed123202` | `suite/slides/api/composite.py`, the contract, and the narrowed swallow. |
| `53ae486ad` | 42 tests, the frontend fixture and its vitest test, the debt entry. |
| `543f37d6a` | Refuse a composite name that is not a docname. |
| `bd9904751` | Never read a blank reference row as a database filter. |

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
and the referenced deck's docname. `_reference_names` now reads through it and
answers `presentation or None`, which is exactly what `pluck` answered, so the
version envelope and the save-time check are unchanged.

**`_readable` became `node_is_readable` and catches `drive.DriveError`.** The
wider `except frappe.ValidationError` swallowed the oversized-`X-Drive-Links`
refusal and marked every reference unreadable, which is the silent trim §6.2
forbids. Ticket 18 recorded this as ticket 20's; it is fixed for the grouped
load, the whole-deck read path, and the save-time check at once. Every Drive
access answer is a `DriveError`, so no access behaviour moved.

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
  `bd9904751`: a reference row may hold no deck. `composite_references` handed
  that falsy name to `get_value`, which reads it as "no filters" and answers
  some other deck's node id, on a guest-reachable route. Both the grouped load
  and the whole-deck path now mark the row unreadable.
- `test_an_oversized_link_header_is_refused_rather_than_marking_everything_unreadable`
  asserts the limit error reaches the caller and is not a `DriveError`.
- `test_the_composite_is_authorized_again_on_every_group` revokes the
  composite's own grant between two groups and asserts both calls refuse.

### Criteria to tests

42 tests in `suite/slides/tests/test_composite_groups.py`: 12 in
`TestCompositeGroupRequest` with no site, 30 in `TestCompositeGroups` on real
rows under `activated()`. 14 more in
`frontend/src/apps/slides/contracts/composite-groups.test.ts`.

| Criterion | Tests |
|---|---|
| 1 Contract documented beside the adapter tests | The `composite.py` docstring; `test_the_frontend_fixture_matches_a_real_answer`, `test_the_route_refuses_with_the_whole_deck_read_paths_own_words`, and the whole vitest file |
| 2 Stable ids, bounded groups, membership, injection | `test_a_reference_id_is_the_row_and_never_the_deck_or_the_node`, `test_a_grant_change_never_moves_a_reference_id`, `test_the_group_bound_leaves_exactly_one_code_for_the_composite`, `test_nineteen_ids_are_accepted_and_twenty_are_refused`, `test_a_repeat_counts_toward_the_bound_rather_than_buying_room`, `test_a_repeat_inside_the_bound_is_still_refused`, `test_nineteen_references_load_in_one_group`, `test_a_twentieth_reference_needs_a_second_group`, `test_an_invented_id_a_deck_name_and_a_node_id_are_all_refused`, `test_a_reference_id_from_another_composite_is_refused`, `test_membership_gives_one_answer_for_an_unknown_and_a_foreign_id`, `test_a_name_that_is_not_a_docname_is_refused_before_any_lookup` |
| 3 Authorize composite and every reference per group; count the composite's code | `test_the_composite_is_authorized_again_on_every_group`, `test_a_link_code_authorizes_its_reference_for_the_group_that_carries_it`, `test_more_than_twenty_separately_shared_references_load_in_two_groups`, `test_a_group_carrying_the_wrong_codes_marks_only_those_references`, `test_twenty_codes_are_still_accepted`, `test_an_oversized_link_header_is_refused_rather_than_marking_everything_unreadable` |
| 4 Unreadable references explicit, in order, without content | `test_an_unreadable_reference_comes_back_in_place_with_no_content`, `test_a_group_answers_in_the_order_it_was_asked_not_the_stored_order`, `test_a_group_answers_one_entry_per_requested_id_and_nothing_else`, `test_the_order_the_caller_asked_for_survives_the_request_reader`, `test_a_readable_reference_carries_its_node_and_its_slides`, `test_a_blank_reference_row_is_unreadable_rather_than_an_error`, `test_a_reference_that_is_itself_a_composite_is_marked_and_holds_no_slides` |
| 5 Groups independent across grant changes; remembered targets confer nothing | `test_a_reference_revoked_between_two_groups_is_unreadable_in_the_second`, `test_a_reference_granted_between_two_groups_is_readable_in_the_second`, `test_a_placeholder_keeps_its_id_and_its_place_across_repeated_loads`, `test_a_grant_change_never_moves_a_reference_id`, `test_a_remembered_association_confers_no_authority` |
| 6 Frontend fixtures, more than 20 separately shared references | `composite-groups.fixture.json` (21 references, two groups), `test_the_frontend_fixture_matches_a_real_answer`, and the 14 vitest cases |
| 7 A Slides operation only | `test_a_deck_that_is_not_a_composite_is_refused_even_to_its_owner`, `suite.tests.test_architecture` (7 tests, including the frozen `drive.__all__`), and the unchanged `suite/hooks.py` |
| Non-disclosure (§5.4) | `test_a_stranger_is_refused_before_membership_is_ever_checked`, `test_both_calls_answer_a_stranger_the_same_way_three_times`, `test_a_malformed_group_is_refused_the_same_way_whatever_the_name_is`, `test_the_refusal_message_names_no_reference_and_no_deck`, `test_a_guest_reads_a_published_composite_and_only_published_references`, `test_a_shape_refusal_is_a_validation_error_not_a_permission_error` |
| Malformed shapes | `test_every_malformed_group_is_refused_with_one_answer` (20 shapes, one answer), `test_a_group_arrives_as_a_list_or_as_its_json_text` |
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
it field for field against a real answer from the site, and
`composite-groups.test.ts` holds a client to the rules it states.

### Verification

#### Static and pure checks run here

Run in this worktree at `bd9904751`. No bench, no migrate, no shared-site
command, no service touched.

| Check | Result |
|---|---|
| `python -m compileall` on the four changed `.py` files | Clean |
| `uvx ruff@0.12.3 check` on the four | All checks passed |
| `uvx ruff@0.12.3 format --check` on the four | 4 files already formatted |
| `TestCompositeGroupRequest` 12, `TestSlidesDeclaration` 30, `TestWriterDeclaration` 23, `TestSheetsDeclaration` 21, `suite.tests.test_architecture` 7 — 93 tests, no database | OK, 1.13 s |
| `vitest run` on `composite-groups.test.ts` | 14 passed, 0.61 s |
| Fixture key sets compared against the dict literals in `composite.py` by AST | Every set matches |

The Python classes run with `frappe.init(site="slides.localhost")` and no
connection, from `/home/faris/benches/suite-bench/sites` with `PYTHONPATH` set
to this worktree. `test_composite_groups.__file__` and `composite.__file__` are
both asserted to come from this worktree.

Repo-wide `ruff check` still reports the same five pre-existing errors ticket 18
recorded, all in files this branch does not touch.

**The vitest run needed a temporary config.** This worktree has no
`node_modules`, and installing is out of scope for this run, so the main
checkout's install was symlinked in. Vite's `server.fs.allow` then refuses the
setup file through the symlink, and every existing frontend test fails the same
way, so the run used a throwaway config that widens `server.fs.allow` and drops
`setupFiles`. The file is not committed. `yarn --cwd frontend test`, the
repository's own command, is **not verified here**.

#### The site gate, required, not yet run

Serialised on `slides.localhost` from `/home/faris/benches/suite-bench`, in
this order. Nothing below has been run.

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

`migrate` is listed because the branch is unproved against it, not because it
changes schema: no doctype, no patch, and no fixture record moved.
`test_drive_adoption` and `test_presentation` are in the list because this
ticket changed `suite/slides/drive.py`, which both exercise.
`suite.drive.tests.test_principals` is there because the narrowed swallow now
lets its limit error out.

Expected counts, from a static enumeration of the classes at `bd9904751`:
`test_composite_groups` 12 unit and 30 integration; `test_drive_adoption` 30,
11 and 60; `test_architecture` 7. No test class inherits a test method, none is
skipped, and no method name is defined twice in the new module.

**Suspicions written before the run.** Each is a guess, not a result.

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
   test that touches the repository tree.

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
