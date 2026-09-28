---
id: 019
title: Branches, backend asks and the release path
label: wayfinder:grilling
status: closed
assignee: faris (fable, 2026-09-29)
blocked-by: []
---

## Question

The plan needs three facts only Faris can fix.

- **Where the backend asks go.** The ticket 003, 006 and 012 asks shipped
  on the map branch (`20befde95`, `47311aa11`), not on `forge/drive-layer`.
  The asks from tickets 007, 008, 011 and 014 have not shipped. The Drive
  README says `forge/drive-layer` is "the sole base branch and the sole
  merge target", yet `47311aa11` is composition code, not Drive. Decide:
  file the open asks as Drive issues, and whether to port the shipped ones
  onto `forge/drive-layer`.
- **Branch shape.** The draft plan cuts `forge/unified-frontend` from the
  map branch and merges `upstream/develop` (341 commits behind) in
  Stage 0. Both branches were rebased on develop on 2026-09-17. Decide merge
  or rebase from here on.
- **Release path.** How `forge/unified-frontend` reaches production, its
  order against the Drive Build release, and who runs `bench set-config`
  for each flip on Frappe Cloud sites and what the release note says (map
  fog, ticket 014).

Raised by the plan audit of
[Draft the spec and plan](015-draft-the-spec-and-plan.md).

## Resolution

Resolved on 2026-09-29. A Fable subagent answered the reversible questions
and prepared the rest. Faris answered them, and his answers replace the
proposed options where they differ.

In short: merge from here on, never rebase. Drive backend asks move to the
Drive program: port `20befde95` onto `forge/drive-layer` and file D10 to
D28 as Drive issues. Production tracks `develop`, and the map branch
already contains `forge/drive-layer`, so the code order is Drive Build
release, then this branch, then the shell flip, then the files flip.
Three items need Faris: the Drive port and issues, the release order, and
who flips the keys on Frappe Cloud.

### Facts (read-only, 2026-09-29)

- HEAD `0039c9fab`. `forge/drive-layer` (`4ca321ab9`) is an ancestor: 44
  ahead, 0 behind. `upstream/develop` (`29d9f510e`, 2026-09-28): 591
  ahead, 341 behind, merge base `bf6eb9c82`.
- `20befde95` (parent `47311aa11`) and `47311aa11` (parent `653b046c5`)
  are single-parent commits. `653b046c5` descends from `forge/drive-layer`.
  `fb5213940` has one parent, `0d6868cd8`.
- `20befde95` touches only Drive: `suite/drive/_core`, `suite/drive/http`,
  their tests, the Drive spec (+74 lines) and the generated Drive client.
  `47311aa11` touches `suite/composition`, `suite/api/routes.py`, Mail,
  Calendar and Meet `http/`, `suite/hooks.py`, and Drive's `translator.py`
  and `framework.py`. `504d6ab10` adds 8 lines to `suite/hooks.py`.
- Dry merges (`git merge-tree --write-tree`): `20befde95` applies onto
  `forge/drive-layer` with no conflict, alone or with `47311aa11`. Tests
  not run (a bench test run writes to the site).
- Three program branches are published on `frappe/suite`:
  `forge/drive-layer` (remote tip equals local), `forge/wayfinder-drive-layer`
  and `forge/wayfinder-unified-frontend`. The upstream remote fetches only
  `develop`. Upstream has no `main` head. Local `main` is 589 behind and
  carries 59 accidental Drive commits (`backup/accidental-main-drive-layer-20260908-0508`).
- The remote `forge/wayfinder-unified-frontend` tip is `0018352d2`
  (2026-09-28, six "Bread Genie" fix commits on top of `fb5213940`, one in
  `suite/drive/_core/previews.py`). Local has 13 doc commits on top of
  `fb5213940` that the remote lacks. Neither side contains the other.
- `forge/drive-layer` has 38 merge commits since the develop base.
- Production is Frappe Cloud site `frappemail.frappe.cloud`, release group
  `bench-40775` (team `team@erpnext.com`, public bench), suite at
  `fd3bb88f5`, an `upstream/develop` commit of 2026-09-27. Production
  tracks `develop`.
- Frappe `forge/storage-v2` is 36 commits ahead of frappe `upstream/develop`
  and is published on `netchampfaris/frappe`. Drive issue 31 names it in the
  release candidate. The Drive spec §14.1 needs Frappe Cloud to allowlist
  `storage_driver` and `storage_driver_config` before production migrates.
- Upstream since the base: 282 files in `suite/mail`, 83 `suite/meet`, 51
  `suite/calendar`, 258 under `frontend/`, 3 in `suite/drive`. Eight files
  changed on both `forge/drive-layer` and upstream; 15 on both HEAD and
  upstream. Upstream did not touch `suite/hooks.py` or `router/index.ts`.

### Decided (reversible)

1. **Merge, never rebase, from here on.** Every reconciliation of
   `forge/unified-frontend` (stage 0, before stage 5, before stage 7) is a
   merge of `upstream/develop`. Both branches are published, one has 38
   merge commits, and the remote map branch has diverged; a rebase would
   force-push and strand the six remote commits [Facts; plan Branch rules].
2. **Stage 0 absorbs the remote first.** Before cutting
   `forge/unified-frontend`, fetch `upstream forge/wayfinder-unified-frontend`
   by name (the refspec only covers `develop`) and merge `0018352d2` into
   the local map branch. No force-push. The cut point is that merge commit
   [Facts].
3. **Conflict rule for the eight Drive-overlap files.** In stage 0, Mail,
   Calendar and Meet files take develop's side. `suite/drive/api/files.py`,
   `list.py`, `webdav/tests/test_put_get.py`, `patches.txt`,
   `presentation.py` and `writer/api/general.py` keep `forge/drive-layer`'s
   behavior, then re-apply upstream's intent by hand. The Drive spec wins for
   Drive behavior [MAP; Facts].
4. **Suite, Calendar, Meet, Mail and Writer asks land on
   `forge/unified-frontend`.** S1 (stage 9), S2, S3 (stage 8), S4 (stage 11)
   are composition, `suite/www` or frontend files that this program owns.
   C3, M1, L1 and L2 have no waiting stage; they stay open in spec §15 and
   get no branch until a stage needs them [plan Built and kept; spec §15].
5. **Drive issue grouping, if Faris approves item 1 below.** Six issues in
   `wayfinder/drive-layer-spec/implementation/issues/`, numbered from 39:
   39 storage breakdown (D10; stage 4), 40 upload and restore (D11 to D16;
   stage 10), 41 link routes (D17, D24, D25; stages 8, 9, 13), 42 sharing
   (D19 to D23; stage 9; D23 is a Drive spec edit), 43 legacy-call counter
   (D26; stages 12 and 14; names from ticket 017), 44 node shape extras
   (D27, D28; no gate). Each names the stage that waits. One issue per
   waiting stage keeps one Drive merge per stage [plan Backend asks].
6. **The pull request target is `develop`.** Production deploys
   `develop`. Local `main` is never used; the "never commit on develop or
   main" rule stays [Facts].
7. **"One full release" means one deploy.** For the stage 14 hold, a
   release is one Frappe Cloud deploy of release group `bench-40775` that
   contains the files-flip code. The hold record names the deploy id and
   date [spec §14.8; Facts].
8. **Flip wording.** The spec and plan say "set the site config key
   `suite_flip_shell`" instead of "`bench set-config`". `frappe.conf` reads
   `site_config.json`; the Frappe Cloud dashboard writes the same file.
   `bench set-config` is one way to set it, not the rule [spec §14.2].
9. **Release note content.** One note per flip, written by the stage 7 or
   13 report and sent by Faris. Four lines: what moved into the shell; old
   links redirect and bookmarks keep working; the key that turns it off and
   who holds it; where to report a broken page. The Drive Build note
   (`links_minted`, changed anyone-with-link URLs) belongs to the Drive
   program [spec §14; Drive spec §14.9].
10. **The Drive Build release stays with the Drive program.** This plan
    records only the order dependency in stages 7 and 13. Frappe Cloud
    allowlisting and the frappe `forge/storage-v2` source are Drive issue 36
    and 37 gates, not this map's [Drive README Release gates].

### Faris's answers

1. **One development branch: `forge/drive-layer`.** Faris: "we should
   probably just keep one development branch: forge/drive-layer and merge
   the frontend branch onto it". Done on 2026-09-29: the six Bread Genie
   commits from the remote map branch were merged (`a8cb8ff6e`, no
   conflicts, import-boundary check passed), `forge/drive-layer` was
   fast-forwarded to it and pushed to `frappe/suite`. Map, Drive and
   frontend work all land on `forge/drive-layer` from here on. There is no
   `forge/unified-frontend` branch, and no port of `20befde95` is needed.
   Merge only, never rebase: the branch is published and shared.
2. **Release order.** Follows from 1: Drive Build and the code of stages
   0 to 6 reach `develop` in one release, with both keys off. Stages 8 to
   12 follow in later releases, with `suite_flip_files` still off. Each flip
   happens later by key (orchestrator reading of Faris's one-branch answer,
   2026-09-29).
3. **Flips on Frappe Cloud.** Faris: "i can flip the keys on FC manually".
   Faris sets and clears both keys himself. No allowlist ask.
4. **Drive asks D10 to D28** are filed as Drive implementation issues on
   `forge/drive-layer` (ticket 022 does it, after ticket 017's issues, to
   keep the numbering in order).

### The questions as they were put

1. **Drive branch carries the Drive asks.** The Drive README makes
   `forge/drive-layer` the sole merge target for Drive code, yet D1 to D9
   shipped on the map branch, and D10 to D28 have no Drive issue. Example:
   stage 9 needs D19 (inherited grants). If it is built on
   `forge/unified-frontend`, `forge/drive-layer` never gets it, and the Drive
   Build release ships a spec that names a route the code lacks.
   Options: (a) port `20befde95` onto `forge/drive-layer` (clean dry merge)
   and file D10 to D28 as Drive issues 39 to 44, built off and merged into
   `forge/drive-layer`, then merged forward. Pro: one owner for Drive code,
   the Drive spec edit in `20befde95` reaches the Drive branch. Con: a Drive
   test run on the ported commit before merge, and the Drive program must
   stop rebasing (a later rebase duplicates commits in this branch).
   (b) keep all Drive asks on `forge/unified-frontend`. Pro: no cross-branch
   work. Con: the Drive branch and spec diverge from the code until the
   final develop merge. I recommend (a), and leave `47311aa11` here: it is
   composition, and `20befde95` applies without it.
   **Question:** port `20befde95` to `forge/drive-layer`, file D10 to D28
   as Drive issues, and ask the Drive program to never rebase again?
2. **Release order: Drive Build first.** The map branch contains
   `forge/drive-layer`, so any release of this code to `develop` carries the
   Build patch, and the next deploy runs Build on every site in the public
   bench. Example: the shell flip alone (Mail, Meet, Calendar) cannot reach
   production without Build running first.
   Options: (a) Drive merges `forge/drive-layer` to `develop` and releases
   Build; then `forge/unified-frontend` merges as the delta; then the shell
   flip; then the files flip. Pro: no history surgery, one review per
   program, matches stage 13. Con: the shell flip waits on Drive's gates
   (allowlisting, frappe source), which have no date. (b) one pull request
   with both programs. Pro: fewest steps. Con: 600 commits in one review,
   and a rollback of one is a rollback of both. (c) rebuild a Drive-free
   shell-flip branch off `develop` by cherry-pick. Pro: the shell flip ships
   alone. Con: the dispatcher rewrites Drive's translator and Files and
   Home import the Drive client, so most commits do not lift cleanly, and
   two long branches then need a second reconciliation. I recommend (a).
   **Question:** accept order (a), Build, then this branch, then the two
   flips?
3. **Who flips on Frappe Cloud.** `suite_flip_shell` and
   `suite_flip_files` are new site config keys. The production bench is a
   public bench owned by `team@erpnext.com`, so `bench set-config` needs
   someone with bench shell access. The dashboard can set a key only if
   Frappe Cloud allowlists it, the same gate the Drive spec records for
   `storage_driver`. Example: on flip day, a key nobody can set means no
   flip and no rollback. Options: (a) ask Frappe Cloud to allowlist both
   keys with the storage keys; Faris flips from the dashboard and records
   the time in the stage report. Pro: no bench access, one person, minutes
   to roll back. Con: one more Frappe Cloud ask, and allowlisting is not
   verified from this box. (b) a Frappe Cloud operator with bench access runs
   `bench set-config` on request. Pro: no allowlist. Con: two people on a
   rollback path. I recommend (a).
   **Question:** file the allowlist ask for both keys, with you as the one
   who flips and rolls back?

### Spec and plan changes

Ticket 022 applies these.

- Spec §14.2 Switch: "set with `bench set-config`" becomes "set as a site
  config key (`bench set-config` locally, the Frappe Cloud dashboard in
  production, after allowlisting)". Add: "Faris sets and clears the key and
  records the time in the stage report" if item 3 (a) holds.
- Spec §14.8 Deletion: define "one full release" as one production deploy
  that contains the files-flip code.
- Spec §15 preamble: add "Drive asks D10 to D28 are Drive issues 39 to 44
  on `forge/drive-layer`. Suite, Calendar, Meet, Mail and Writer asks land
  on `forge/unified-frontend` in the stage that waits." Mark D1 to D9
  "shipped on the map branch; ported to `forge/drive-layer` in stage 0"
  once item 1 (a) holds. Add "Release note" as a four-line rule under §14.
- Spec §16.1 item 3: remove once folded.
- Plan Starting state, Branches: add the remote tip `0018352d2` and its
  six commits, the production hash and deploy path, and the frappe
  `forge/storage-v2` fact.
- Plan Stage 0: add "fetch and merge the remote map branch before the cut",
  "merge, not rebase", the conflict rule for the eight Drive-overlap files,
  and, if item 1 (a) holds, "port `20befde95` onto `forge/drive-layer` on a
  Drive ticket branch, run the Drive tests, merge, then merge
  `forge/drive-layer` into `forge/unified-frontend`".
- Plan Stage 7 and Stage 13: replace "(ticket 019)" with the order: Drive
  Build deploy, then the `forge/unified-frontend` merge to `develop` and its
  deploy, then the key. Name the flipper per item 3.
- Plan Stage 14: cite the deploy definition.
- Plan Backend asks by stage: add an "Issue" column with 39 to 44; the
  closing line "The Drive implementation README tracks no issue for D10 to
  D28. Ticket 019 decides where they land" goes.
- Plan Branch rules: replace "Ticket 019 decides merge or rebase" with
  "Reconcile by merge only. No rebase of either program branch." Add "Pull
  requests target `develop`. Local `main` is unused."
- Plan Handoff to Drive Cleanup: add the release order and the deploy ids as
  evidence rows.
- Plan Open items: remove the ticket 019 entry.

### Asks

- Drive program, if item 1 (a) holds: accept the `20befde95` port; add
  issues 39 to 44 to the README index and `Coverage` table; add "no rebase
  of `forge/drive-layer` while `forge/unified-frontend` contains it" to the
  README's Branches and merges; record in issue 36 that the shell flip and
  files flip follow the Build release on `develop`.
- Suite program (Faris), if item 3 (a) holds: ask Frappe Cloud to allowlist
  `suite_flip_shell` and `suite_flip_files` together with `storage_driver`
  and `storage_driver_config`.
- Drive program, item 2 either way: the Build release runbook (issue 36)
  states that `develop` deploys to the public bench `bench-40775`, so Build
  runs on every suite site in it, not only `frappemail.frappe.cloud`.
