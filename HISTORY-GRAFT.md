# Git history preservation (graft procedure)

> **STATUS — DONE (regrafted 2026-06-17).** All 7 apps' original per-file authorship now
> shows in GitHub's **History *and* Blame UI** on `develop`. This was achieved with the
> **content-bearing append** method documented immediately below. The `-s ours` procedure
> described later in this file is **SUPERSEDED** (it linked ancestry but left blame
> collapsed on the port commit, because `-s ours` never introduces the original file
> content into the mainline tree) — kept only as historical context.

## Live commit SHAs (the regraft that is actually in `develop`)

> ⚠️ The first append run (tip `4e5219a86`, base `3f9e986cc`) described in the diagram
> below was **superseded by a regraft on 2026-06-17** and is **NOT in the current
> `develop` ancestry** (`git merge-base --is-ancestor 4e5219a86 develop` fails). The
> method/topology is identical; only the SHAs changed. When verifying blame, use the
> **live** port commit below — grepping the old `4e5219a86` returns misleading zeros.

The structure in `develop` today is `T' → G' → M' → P'`:

| Role | SHA | Subject |
|------|-----|---------|
| `T'` base | `64d776f6fa` | mainline tip the regraft built on |
| `G'` remove | `7475c253e0` | `regraft: remove app files (re-added with original authorship below)` |
| `M'` union | `31c428a021` | `regraft: graft original per-app authorship (content-bearing)` — **8-parent** (`G'` + the 7 filter-repo'd app histories) |
| `P'` port | `494c3ce9fb` | `Phase 5/6 port: 7 apps into suite (tree byte-identical to develop)` — single parent `M'` |

## The method actually used: content-bearing fast-forward append

Three commits were appended on top of `origin/develop` tip `T` (`3f9e986cc`), producing a
new tip `P` (`4e5219a86`) that is **byte-identical to `T`** and a **fast-forward** (no
force-push, no re-clone):

```
T (origin/develop) ── G ───────────── M ───── P   ← new develop tip
                        (remove apps)  │  (port: tree = T exactly)
   D_drive … D_calendar (7 filter-repo'd  │  M parents = [G, D_drive … D_calendar]
   histories, ORIGINAL content) ──────────┘  M tree    = G_tree ∪ all 7 apps' subtrees
```

- **`D_<app>`** = a fresh clone of `apps/<app>` run through `git filter-repo` with a
  **uniform 2-rule path map** (no hand-crafted flattening):
  `--path frontend/src --path <backend> --path-rename frontend/src/:frontend/src/apps/<app>/ --path-rename <backend>/:suite/<app>/`.
  For all apps `<backend>` == the app's top-level package dir and `<app>` == suite module
  name, except **calendar** (`calendar_app/` → `suite/calendar/`). Content stays ORIGINAL.
- **`G`** removes every app-derived path from `T`: `suite/{drive,meet,writer,sheets,slides,mail,calendar,client,frappe_writer}`
  and `frontend/src/apps/{the 7}`. Foundation (`suite_core`, `server`, `www`, `public`,
  `hooks.py`) is left untouched → keeps its real authorship.
- **`M`** = an 8-parent commit (`-p G` + the 7 `D_<app>`) whose tree is the disjoint union
  built with plumbing: `read-tree G_tree`, then `read-tree --prefix=frontend/src/apps/<app>/`
  and `--prefix=suite/<app>/` for each app. NOT a real merge (sidesteps octopus conflicts).
- **`P`** = the port commit; tree set to **`T`'s tree exactly** via `commit-tree $(rev-parse T^{tree})`,
  guaranteeing byte-identity. Authored as Faris Ansari.

**Why blame works — including the split/flatten cases:** at `M` each app file equals its
`D_<app>` original (TREESAME) → blame follows into the original commits. At `P`, git's
**rename detection** bridges the port-time path moves: the inner-module flatten
(`suite/<app>/<app>/doctype/…` → `suite/<app>/doctype/…`) and the two split modules
(`suite/mail/client/…` → `suite/client/…`, `suite/writer/frappe_writer/…` →
`suite/frappe_writer/…`) are detected as renames of identical files, so blame crosses
cleanly without any explicit flatten rules. Only genuinely port-changed lines (and
near-total rewrites like `router.js`→`router.ts`) blame to `P` — honestly.

**Verification gates (all passed):** `git diff P origin/develop` empty; `origin/develop`
is an ancestor of `P` (FF); per-app blame of a stable backend controller reaches original
authors (Safwan/Drive, Suhail/Meet, s-aga-r/Mail via the `client` split, Gursheen/Slides,
Akash/Calendar, etc.) with only 0–1 lines on `P`.

Reusable scripts from the run: `/tmp/regraft/run_filter.sh` (per-app filter-repo) and
`/tmp/regraft/build_gmp.sh` (G→M→P plumbing).

---

## (Superseded) original plan — `git merge -s ours`

The 7 source apps were folded into `suite` by **plain copy** (D13 fallback), so the
original per-app authorship was NOT in `suite`'s history. The original plan restored it by grafting
each source repo's history onto the new `suite/` paths with `git filter-repo`
(path rewrite) + `git merge -s ours --allow-unrelated-histories` (link ancestry
without changing the migrated tree). **This left blame collapsed on the port commit and
was replaced by the append method above.**

## Why `-s ours`, and the one rule that governs timing

`merge -s ours` keeps the **current tree** and only links the rewritten history as
ancestors. `git log --follow <path>` / `git blame` then reach the original authors —
**but only for paths that already exist in the committed `suite` tree at graft time.**

A subtree grafted *before* its files are committed will NOT retroactively connect:
an `-s ours` merge never introduces the file into the mainline tree, so a later
"add" commit has no rename source to cross back into the graft.

> **Rule:** graft a subtree's history only AFTER that subtree exists (is committed) in `suite`.

## Status

- **Backend (all 7): DONE.** Backend code was already committed, so all 7 backend
  histories are grafted (commits `history: graft <app> backend …`). Verified:
  `git log --follow suite/slides/doctype/presentation/presentation.py` reaches
  Gursheen Anand's commits; drive → Safwan Samsudeen/Arjun Choudhary; mail → s-aga-r; etc.
- **Frontend: PENDING, per-port.** The whole `frontend/` is still uncommitted, so no
  frontend history is grafted yet — including slides'. Each app's frontend history is
  grafted as the **final step of its port**, after the port is committed (see below).

## Per-port frontend graft (run after each app's frontend port is committed)

```bash
APP=drive PKG=drive          # source repo dir + python package name
FR=/Users/netchampfaris/Projects/frappe-bench-suite/env/bin/git-filter-repo
SHA=$(git -C apps/$APP rev-parse HEAD)        # migration-base commit (full history behind it)
rm -rf /tmp/suite-hist/$APP-fe
git clone -q apps/$APP /tmp/suite-hist/$APP-fe
( cd /tmp/suite-hist/$APP-fe
  git checkout -q -B graft "$SHA"; git remote remove origin
  for b in $(git branch --format='%(refname:short)' | grep -v '^graft$'); do git branch -qD "$b"; done
  git tag -l | xargs -r git tag -d
  # keep ONLY frontend, rewrite source frontend/src -> the ported path; drop the rest
  "$FR" --force --filename-callback '
n = filename.decode("utf-8","surrogateescape")
if n.startswith("frontend/src/"):
    return ("frontend/src/apps/'"$APP"'/" + n[len("frontend/src/"):]).encode()
return b""' )
git -C apps/suite remote add hist-$APP-fe /tmp/suite-hist/$APP-fe
git -C apps/suite fetch -q hist-$APP-fe
git -C apps/suite merge -s ours --allow-unrelated-histories \
  -m "history: graft $APP frontend authorship under frontend/src/apps/$APP" hist-$APP-fe/graft
git -C apps/suite remote remove hist-$APP-fe
# verify: git -C apps/suite log --follow -- frontend/src/apps/$APP/<some-view>.vue
```

Adjust the `frontend/src/ -> frontend/src/apps/<app>/` rename if the port reorganized
files differently than the source `src/` layout (it's best-effort; rename detection
covers the rest). Path precision only affects how cleanly `--follow` traces a given
current file — **no history is lost either way**, since every commit is grafted as an ancestor.

## Notes / invariants

- **Do not delete the source app repos** (`apps/<app>/`, Phase 4 cleanup) until every
  frontend graft is done — they are the history source. Backend grafts are complete,
  so backend-source deletion is already safe; keep them for the frontend.
- All 7 source repos were un-shallowed and their `origin` remotes restored
  (`github.com/frappe/<app>`), so full history is available locally.
- Rollback anchor for the backend-graft batch: pre-graft `suite` HEAD `5953115a`.
  Each graft is a no-op on the tree (`git diff 5953115a HEAD` = empty).
- Slides is ported but uncommitted; commit the frontend, then run the procedure above
  with `APP=slides PKG=slides` to graft its frontend history.
