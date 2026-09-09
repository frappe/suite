# 31 — Rehearse Build on an approved export and verify rollback

**What to build:** Validate the migration against representative existing data before a release.

**Blocked by:** [30 — Verify the complete backend before migration rehearsal](30-backend-integration-review.md)

**Status:** blocked

**Owner:** Suite migration operations

**Execution gate:** Requires an approved export and explicit authority to overwrite the selected test target. No dataset has been supplied.

**Source:** [Drive spec](../../drive-layer-spec.md), §14; plan Build rehearsal.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Rehearsal inputs (recorded 2026-09-09)

- **Dataset:** a Frappe Cloud backup of `frappemail.frappe.cloud` (suite.frappe.io), taken with files. Build reads the database, `private/files`, `public/files`, and the legacy S3 bucket. A database-only backup is not enough. Sizes on 2026-09-09: database 1.67 GB, public 1.82 GB, private 26.67 GB, bucket 28.5 GB.
- **Local and S3 bytes are two disjoint populations, not duplicates.** Local private is mostly Presentation (Slides) attachments. They are written through the framework `upload_file` path, which never reaches Drive's S3 uploader (`suite/drive/utils/files.py`, `suite/drive/overrides/file.py:625-660`). About 6 GB of private disk has no File row. The cause is suspected stale `.uploads` chunks or Meet recordings, not verified.
- **Open question before a production Build:** File rows with S3 fetch URLs claim about 120 GB active, but the bucket reports 28.5 GB. Either many rows share one key, or objects are missing. This needs a bucket listing pass with read access.
- **S3 for the rehearsal:** Build copies objects server-side inside the same bucket, so never point a rehearsal at the production bucket. Use a bucket copy that the rehearsal may write to. Set `Drive Disk Settings` and `site_config.storage_driver_config` to it, or the Build gate refuses. Without S3 access, set `Drive Disk Settings.enabled = 0` on the restored site. Local backfill, tree, grants, links, dedupe, trash, versions, comments, Slides media, quota, reruns and rollback are still verifiable. The S3 copy path and its counts are not, and every fetch URL lands in `missing_bytes`.
- **Target:** `slides.localhost` on suite-bench, unless Faris names another site. Restoring overwrites it.
- Frappe Cloud `site_config` for this site has no `storage_driver` keys today. Allowlisting stays an external prerequisite (see MAP.md Out of scope).

Agents gathered these facts from read-only frappectl profiles and the forge/drive-layer tree; the bucket figure is from the Frappe Cloud dashboard, unverified.

## Acceptance criteria

- [ ] Record the supplied dataset, target, restore authority, and a recoverable target backup before restoring anything.
- [ ] Restore only to the approved target. Use slides.localhost unless separate site authorization exists.
- [ ] Run Build, read the private report, and compare source/target counts, access, bytes, ids, document bodies, and root pairs.
- [ ] Report links minted, dropped-grant categories, title renames, and trash disagreements to the user.
- [ ] Exercise representative legacy and new clients, then verify a safe rerun.
- [ ] Rehearse rollback with the preserved database and bytes. Account for renamed tables, body rewrites, and writes after Build.
- [ ] Record the exact release candidate and evidence needed for later Cleanup. Do not activate Cleanup or relocate bytes.

## Verification

Run a real restore/migrate/reconciliation/recovery exercise and attach measured evidence. Remain blocked if no approved dataset or restore target exists.

## Completion evidence

Record changed behavior, exact revisions, commands, results, and unresolved gates here.
Keep this ticket open until its acceptance criteria pass. No implementation evidence recorded yet.
