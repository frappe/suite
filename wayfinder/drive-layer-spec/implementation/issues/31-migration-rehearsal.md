# 31 — Rehearse Build on an approved export and verify rollback

**What to build:** Validate the migration against representative existing data before a release.

**Blocked by:** [30 — Verify the complete backend before migration rehearsal](30-backend-integration-review.md)

**Status:** in-progress

**Claimed:** 2026-09-09 by Faris (orchestrated by Claude). Starting revisions: suite forge/drive-layer 5965c9933, frappe forge/storage-v2 ad5cd7f1a7. Claimed files: none in the repo; the site suite-frappe.localhost on suite-bench.

**Owner:** Suite migration operations

**Execution gate:** Requires an approved export and explicit authority to overwrite the selected test target. Satisfied 2026-09-09: backup 5rs8ke96ri supplied, target suite-frappe.localhost approved by Faris.

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

### Restore (2026-09-09)

- Target `suite-frappe.localhost` was created empty on suite-bench (frappe forge/storage-v2, suite forge/drive-layer 5965c9933, db `_d72aedad662d70ca`, port 8010). No prior data, so no target backup was needed.
- Guards set before restore: site_config `maintenance_mode 1`, `pause_scheduler 1`, `disable_scheduler 1`, `mute_emails 1`, `developer_mode 0`; `bench disable-scheduler`. Production `encryption_key` and outbound service keys were not copied, so stored credentials stay unreadable.
- `bench --site suite-frappe.localhost restore <db.sql.gz> --with-public-files <files.tar> --with-private-files <private-files.tar>` completed rc=0 in 4 min 12 s. Log: `/home/faris/backups/suite-frappe/restore.log`. A temporary MariaDB admin user was created for the run and dropped after it.
- First attempt failed with `ERROR 2006 Server has gone away` at a row in `tabDeleted Document` larger than the 16 MB `max_allowed_packet`. Fixed by raising the server value to 1 GB for the import and restoring it to 16777216 afterward, plus a client-side `max_allowed_packet=1G` through a temporary defaults file. Note for the production Build release: the dump needs a larger packet size to restore.
- Result: `tabFile` 25335, `tabUser` 249, `tabPresentation` 522, `tabEmail Account` 1; 369 tables, 5.78 GB. `private/files` 27 GB, 13933 files; `public/files` 1.9 GB, 116 files. Disk free after: 37 GB.
- Neutralized after restore by raw SQL: the one Email Account disabled both ways with `awaiting_password=1`; Mail Settings `server_url` and `dns_provider` cleared; Webhook and Notification already off; Email Queue had no pending rows. Administrator password set locally. Redis queue on 11006 flushed (1913 keys). `bench doctor`: scheduler disabled, paused, inactive, maintenance mode on, 0 workers.
- Not done: `bench migrate` has not run. The site is at the production schema. Build is held for an explicit go.

### Plan for the Build run (from code reading, not yet executed)

- `bench migrate --skip-fixtures --skip-search-index` first with `storage_v2` unset. Every earlier patch commits and is logged; the Build gate raises `BuildGateError` and stops migrate before post-schema. This exercises the gate.
- Then set site_config `storage_v2 1`, leave `storage_driver` unset (defaults to local), set `Drive Disk Settings.enabled = 0` by SQL, flush redis, and rerun the same migrate. Only Build and post-schema run. Every S3 fetch URL lands in `missing_bytes` by design.
- `--skip-fixtures` is required until ticket 38 lands; `sync_fixtures` deletes and re-inserts the template Presentations and hits `require_node`.
- Do not use `--skip-failing` or `bypass-patch`.

Agents ran the restore and wrote this evidence.
