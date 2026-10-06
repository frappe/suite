# Drive layer: running plan

The orchestrating session updates this file whenever work lands or a
decision is made. The spec is [`drive-layer-spec.md`](drive-layer-spec.md)
and the original staged plan is [`drive-layer-plan.md`](drive-layer-plan.md).

Bug numbers (B1, B2, …) refer to the local tracker at
`drive-rehearsal/context/tracker.md` in the bench folder. It stays outside
the repo because its rehearsal evidence refers to restored production data.
Nothing from that data belongs in this file.

## Where things stand (2026-10-06)

- **Suite PR #881** (`forge/drive-layer` into `develop`): conflicts with
  develop again, in `pyproject.toml`. CI still fails at setup, because it
  needs the Frappe PR below: CI installs a Frappe without `frappe.storage`.
- **Frappe PR frappe/frappe#42407** (`forge/storage-v2`): adds the storage
  layer Drive needs. It now also serves sites whose folder is a symlink, and
  shows S3 files in the browser with their real type instead of always
  downloading them. It also conflicts with its base branch.
- **Migration:** one `bench migrate` runs Build, then Cleanup. Rollback is
  a backup restore. Legacy S3 objects are deleted only by the separate
  `delete_legacy_objects` command. Production is **no-go** until a fresh
  rehearsal passes with the final patch set. The rehearsal is parked
  while Faris does UI polish. Its steps are in
  [`rehearsal-runbook.md`](rehearsal-runbook.md).
- **Preview site** (`rehearsal.localhost`): kept for Faris's testing. Mail
  and Calendar are connected to Faris's own mailbox. Remove the stored
  credentials and the mail server setting before the site is deleted.

## Release path

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Load the latest code on the preview: rebuild the frontend and restart its server | orchestrator | server restarted 2026-10-06; frontend rebuild waits until no other agent has uncommitted frontend changes |
| 2 | CORS rule on the rehearsal bucket (GET, HEAD, POST from the preview's origin), then retry text previews and uploads | Faris | done: Faris applied the rule |
| 3 | Update the PR #881 description: new commits in Follow-ups, refreshed line counts | orchestrator | open |
| 4 | Merge frappe/frappe#42407 | Faris | open |
| 5 | Thumbnail size: the preview-size patch passed through a legacy `preview_size` that was far too large, so previews came out nearly full size | orchestrator | done: `921521654`. `preview_size` must be 128 to 2048 pixels; the patch sets any other value to 512 |
| 6 | Video thumbnails: MP4 files with their index at the end failed, because the renderer read a stream it could not seek, and every video was downloaded in full | orchestrator | done: `ad0f94c02`. Videos on S3 open as a seekable file that fetches only the bytes it reads. On the preview every remaining failure came from a broken source file |
| 7 | Fresh full rehearsal from a new backup, with the checklist below. Steps: [`rehearsal-runbook.md`](rehearsal-runbook.md) | Codex | parked while Faris does UI polish |
| 8 | Production prerequisites, listed below | Faris | open |
| 9 | Production migration, then `delete_legacy_objects` once confirmed, then delete all restored production data from the laptop | Faris | open |

### Fresh rehearsal checklist

- The preflight passes with an operator-supplied accepted-defects list, run
  over every object (`every_object=True`), not a sample.
- Build and Cleanup complete. A second `bench migrate` changes nothing.
- The new indexes exist before history is read (B108).
- Borrowed pictures get their own copy in current content, old versions
  and templates (B112). Pictures directly inside lists are kept (B113).
- The thumbnail backfill runs to completion. Record how long it takes.
  Previews come out at the configured size, and MP4 files with their
  index at the end get previews (steps 5 and 6).
- Browser checks also cover: PDFs open in the page, text and Markdown
  previews, uploads, Download saves the file, a picture inside a document
  opens by its own link.

### Production prerequisites

- CORS rule on the production bucket for the production site's origin
  (spec §14.1).
- Faris reviews the accepted-defects list for production.
- A downtime window sized from the rehearsal's measured times.

## UI polish (current focus)

Faris adds items here as he finds them while testing. Each item gets a
tracker row when work starts.

| Item | Area | Notes | Status |
|---|---|---|---|
| Escape in the document title field saves the typed name instead of reverting (B84) | Writer, Sheets, Slides header | frappe-ui `TextInput` also emits on the native `change` event | open |
| A folder opened from Recent, Starred or Shared shows only its name until its path loads (B29) | Drive | needs breadcrumbs from those views | open |
| Share dialog and grid cards show emails instead of names and avatars (B2) | Drive | needs names and images in the Drive API | open |
| Writer document settings dialog: fonts, spacing, print header and footer (B98) | Writer | the Settings button is hidden only as a stopgap; done means the dialog works | open |
| Document actions inside an open Writer document: copy link, move, info, favourite, delete, and header indicators (B104) | Writer | | open |
| Print, export and word count (B103) | Writer | | open |
| Slides saves while a slide is focused, and the first-slide check (B83) | Slides | waiting for Gursheen's review; see `specs/slides/001-saving.md` | blocked |
| Office files show "No preview" | Drive | by design, spec §9.2 has no office renderer | decide |

## Later (does not block the migration)

- **Writer features:** versions (B99), templates (B100), comments (B55).
  The gap list is [`specs/writer/001-drive-parity.md`](../../specs/writer/001-drive-parity.md).
- **Search across apps (B97):** Drive search matches titles only.
- **Slides media as Drive nodes (B51, B82).**
- **Correctness:**
  - The listing query hides a node that the permission engine admits, when a `$PUBLIC` deny and a readable link are on the same node (B44).
  - A files listing with `?type=` returned a 500 (B46).
  - `group_by` is still on the server (B38).
- **Contract typing (C1–C5).**
- **Tests and tooling:**
  - the flaky notifications e2e test (B97b)
  - the WebDAV test fakes use the old `download_url` signature
  - mypy skips `suite/drive/patches/`
  - a note on the group-membership index belongs in the spec
- **frappe-ui:** a public `BaseSuggestionItem` export from `frappe-ui/editor` (B42).

## Decisions (2026-10-03 to 2026-10-04)

- **Folder access:** the folder owner wins, and access is grants only.
- **Mail attachments:** capped at 25 MB.
- **Writer API:** the dead endpoints and the Writer-only search index are
  removed. Search must work across apps.
- **Concurrency:** Drive HTTP and WebDAV writes run at READ COMMITTED, and
  locks are taken from the tree root down (spec §8.12).
- **Slides saving:** the current behaviour is documented and waiting for
  Gursheen's review.
- **Borrowed pictures:** a picture another document owns is copied into the
  document that shows it. The blob is the same, the node is new and the
  reference is rewritten. This covers current content, old versions and
  templates, in Writer and Slides.
- **Pictures directly inside lists:** the ProseMirror schema cannot accept
  them, so Build wraps each one in its own paragraph.
- **Preflight:**
  - Missing objects of Removed rows do not block.
  - Defects of Active and Trashed rows block unless they are on the operator's accepted list.
  - Anything new blocks.
- **Thumbnails:** one backfill after migration makes every missing
  preview. The daily sweep stays as a safety net.
- **Bucket CORS:** a migration prerequisite for S3 sites.
- **Frappe fixes from the rehearsal** go into frappe/frappe#42407.

## Working rules

- The orchestrating session delegates every code change to an Opus
  subagent, unless Faris names another model.
- **Never copy production data** into the repo, commits or PRs. That
  includes names, emails, file names, counts and keys.
- **Preview site rules:**
  - Never run `bench migrate` on it.
  - Restart its server only with Faris's go-ahead.
  - Never contact the production site or the production bucket from it.
- **Commits:**
  - Stage paths explicitly.
  - No force push, no `--no-verify`, no stash, reset or clean.
- **Unexplained working-tree changes:** ask before touching them. They may
  be Faris's or Codex's.
