# 31 — Rehearse Build on an approved export and verify rollback

**What to build:** Validate the migration against representative existing data before a release.

**Blocked by:** [30 — Verify the complete backend before migration rehearsal](30-backend-integration-review.md)

**Status:** blocked

**Owner:** Suite migration operations

**Execution gate:** Requires an approved export and explicit authority to overwrite the selected test target. No dataset has been supplied.

**Source:** [Drive spec](../../drive-layer-spec.md), §14; plan Build rehearsal.
Read [execution rules and source precedence](../README.md#execution-rules) before claiming this ticket.

## Rehearsal inputs (recorded 2026-09-09)

- **Dataset:** a Frappe Cloud backup of `frappemail.frappe.cloud` (suite.frappe.io), taken with files. Build reads the database, `private/files`, `public/files`, and the legacy S3 bucket. A database-only backup is not enough. Sizes on 2026-09-09: database 1.67 GB, public 1.82 GB, private 26.67 GB, bucket 213.8 GB (dashboard shows 28.5 GB, wrong).
- **Downloaded 2026-09-09:** the Site Backup `5rs8ke96ri` archives (created 2026-09-09 03:00 IST) are at `/home/faris/backups/suite-frappe/`. All three are verified against the Site Backup sizes (`gzip -t`, `tar tf`). They were fetched through `press.api.site.backups` plus `press.api.site.get_backup_link` on the read-only `cloud.frappe.io` profile.
- **Local and S3 bytes are two disjoint populations, not duplicates.** Local private is mostly Presentation (Slides) attachments. They are written through the framework `upload_file` path, which never reaches Drive's S3 uploader (`suite/drive/utils/files.py`, `suite/drive/overrides/file.py:625-660`). About 6 GB of private disk has no File row. The cause is suspected stale `.uploads` chunks or Meet recordings, not verified.
- **Bucket audit (2026-09-09, read-only listing):** the dashboard figure of 28.5 GB is wrong. The bucket `drive.frappe.cloud` (ap-south-1) holds 11,490 objects and 213.8 GB.
  - 7,047 non-folder File rows point at S3 and claim 130.3 GB. 6,684 of them resolve to a live object by exact key match, which is 99.0 percent of the claimed bytes. Spot-check GETs were byte-exact.
  - 363 rows point at keys that do not exist, 1.33 GB. Almost all were created after 2026-07, and 280 of them in one burst on 2026-09-04. All carry the leading-slash key layout and no file extension. These are not the 2024 video rows. Expect a `missing_bytes` of about 1,325,852,357 in the Build report, or 1,416,061,550 if you include 27 truncated multipart objects (their sizes are exact multiples of 5 MiB).
  - 649 `is_folder=1` File rows also carry S3 fetch URLs. They map to no object, claim 19.1 GB of aggregate size, and 23 have a negative `file_size`. Build must exclude them before it sums bytes.
  - 4,806 objects (84.9 GB) are referenced by no row. The `2hsp9tnv3l` prefix (1,325 objects, 75.5 GB) is a full duplicate of `0rptra6t27` from the 2025-04-11 bulk upload. This is not loss. It is a GC candidate after Build.
  - No bucket key is claimed by more than one File row. `Drive Disk Settings.root_folder` is not applied as a key prefix: the `path=` value is the key verbatim.
  - Full listing and report: `/home/faris/backups/suite-frappe/bucket-audit/` on the devbox. It is outside the repo because the keys contain user emails. Bucket versioning status was AccessDenied, so deleted-versus-never-written is unknown.
- **S3 for the rehearsal:** Build copies objects server-side inside the same bucket, so never point a rehearsal at the production bucket. Use a bucket copy that the rehearsal may write to. Set `Drive Disk Settings` and `site_config.storage_driver_config` to it, or the Build gate refuses. Without S3 access, set `Drive Disk Settings.enabled = 0` on the restored site. Local backfill, tree, grants, links, dedupe, trash, versions, comments, Slides media, quota, reruns and rollback are still verifiable. The S3 copy path and its counts are not, and every fetch URL lands in `missing_bytes`.
- **Target:** `suite-frappe.localhost`, created on suite-bench (db `_d72aedad662d70ca`, port 8010), unless Faris names another site. Restoring overwrites it.
- Frappe Cloud `site_config` for this site has no `storage_driver` keys today. Allowlisting stays an external prerequisite (see MAP.md Out of scope).

Agents gathered these facts from read-only frappectl profiles and the forge/drive-layer tree. The bucket figure comes from a read-only listing of the bucket. The Frappe Cloud dashboard figure is wrong.

## Acceptance criteria

- [ ] Record the supplied dataset, target, restore authority, and a recoverable target backup before restoring anything.
- [ ] Restore only to the approved target, suite-frappe.localhost on suite-bench.
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
