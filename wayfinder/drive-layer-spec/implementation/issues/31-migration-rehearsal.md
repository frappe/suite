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

### Build pass 1, gate refusal (2026-09-09)

- `bench --site suite-frappe.localhost migrate --skip-fixtures --skip-search-index` with `storage_v2` unset: exit 1 in 1 s. Patch Log stayed at 454 rows. Nothing written.
- The gate fired at the first unrun suite patch, `suite.drive.patches.rename_entity_log_to_recent` (pre_model_sync), through `_refuse_a_site_that_cannot_build`, not at the Build line. The production schema already carried every earlier patch. A site is refused before any schema change.
- Error text: `BuildGateError: Drive Build needs File Storage v2. Set storage_v2 in site_config and migrate again; a site must not half-migrate.`
- Log: `/home/faris/backups/suite-frappe/build/pass1-migrate.log`.

### Pre-Build snapshot

- `bench backup` (database only) to `/home/faris/backups/suite-frappe/build/pre-build/20260909_174224-suite-frappe_localhost-database.sql.gz`, 1.7 GB, 2 min 41 s. Rollback anchor.
- Defect for the release runbook: `mariadb-dump` fails at the stock 16 MB `max_allowed_packet` on `tabDeleted Document` (one `data` value is 263 MB). Both backup and restore of this site need the packet size raised on server and client. Raised to 1 GB for the run, restored to 16777216 afterward.

### Build pass 2, first attempt (2026-09-09, stopped)

- `storage_v2 1` set, `storage_driver` unset, `Drive Disk Settings.enabled` 1 to 0 by SQL on `tabSingles`, redis flushed. Same migrate command. Log: `/home/faris/backups/suite-frappe/build/pass2-migrate.log`.
- Progress before the stop: `rename_entity_log_to_recent` 58.8 s (collapsed 1106 duplicate rows); model sync; `frappe.patches.v17_0.backfill_file_blobs` 8434 File Blob rows; Build steps 1 to 6 done with 179 Drive Root, 13454 Drive Node, 4827 Drive Grant; step 7 history reached 273 Drive Node Version rows.
- Defect, blocking: `ports.py:1221` pages `tabWriter Version` by `doc` once per Writer Document (2469 documents, 142,530 version rows, 2.7 GB). `Writer Version.doc` has no index (`SHOW INDEX`: PRIMARY and creation only; EXPLAIN: `possible_keys NULL`, `key creation`). One page query takes 45 s, so the step needs about 31 hours. The migrate was stopped at 18:01 by SIGTERM then SIGKILL after 8 minutes. Fix in progress on branch `forge/ticket-31-history-index`: `search_index` on the columns Build pages by, so model sync creates the index before Build runs.
- Rerun plan: merge the fix into forge/drive-layer, rerun the same migrate on the partial state. This doubles as the crash-rerun test (criterion 5): rename, model sync and both backfills are already committed, Build is resumable at batch boundaries.
- Also seen: redis on 11006 held 3 keys and one queued job during the run, far from the 500 QueueOverloaded limit. `information_schema` row estimate for `tabWriter Version` was 15 percent under the real count.

### Build pass 3, resume after the index fix (2026-09-09, failed on data)

- Index fix merged as ded85af54 (`search_index` on `Writer Version.doc`, test in `test_ports.py`). A query inventory of every Build read found every Drive target table already indexed. Two legacy scans remain on `tabFile` (`content_doctype, content_docname` in `files_for_content` and `sheet_entity`; `folder` in `SiteTree.children`): full scans of 24,782 rows at about 6 ms each, under a minute total, left as is. Custom Fields and the framework `folder` column cannot be indexed from a DocType JSON; a patch with `ALTER TABLE` would be the fix if a larger site needs it.
- Same migrate command on the partial state. Model sync created `doc_index` on `tabWriter Version` before Build ran. EXPLAIN on the history page query: `key doc_index, key_len 563, ref const`. One 500-row page with `snapshot`: 0.05 s, against 22 to 45 s before.
- Build resumed at step 7 (storage, tree and grants phases stayed completed) and failed after 21 s: `BuildHistoryError: Writer Document:092fkc4phm: legacy File fd854f785f is Removed`, raised by `_document_node` in `history.py:295`. The tree phase skips Removed File rows (607 skipped), so the document has no node, and the history resolver raises instead of deferring.
- Systematic, not one row: 109 content documents have a single legacy File row and it is Removed (Presentation 56, Sheet 18, Writer Document 35). `tabFile.status`: Active 24682, Removed 603, Trashed 50.
- History writes are committed per document: `Drive Node Version` went 273 to 1023 before the failure, `Drive Comment` 266. Patch Log unchanged at 458, Build not recorded. No report JSON (written at the end of `run_build`).
- Artifacts: `/home/faris/backups/suite-frappe/build/pass3-migrate.log`, `pass3-traceback.txt`, `drive-build-state-after-pass3-failure.json`.
- Fix in progress on branch `forge/ticket-31-removed-content`: treat a content document whose only File is Removed as skipped, no node, counted and listed in the report.

### Build pass 4, resume after the Removed-content fix (2026-09-09, failed on data)

- Fix merged as caf6db5ef (`RemovedLegacyFile` outcome in `content_mapping.py`; steps 7, 8 skip, step 10 counts and lists under `removed_file_documents` in `evidence.content`; 816 build tests pass without a database). The spec is silent on a content document whose only File row is Removed: §14.4 governs the row, §14.6 needs a document with no File row, and decision 011 rejects Removed as Trashed. Skip and report was the chosen fallback.
- Same migrate command on the partial state. Build resumed at step 7, walked past the Removed-file documents, and wrote 47,158 `Drive Node Version` rows (from 1023) and 731 `Drive Comment` rows in 2 min 34 s, then failed: `BuildHistoryError: Writer Document:661636if52: comment 78033a50-... field thread is None`, raised by `exact_fields` from `comments.py:302 _write_thread`.
- Cause: `tabDrive Comment` is a reused table. 254 legacy child-table rows (`parenttype='Drive File'`, `parentfield='comments'`, `thread` and `node` NULL) survive in it. Build derives Writer comment ids from the Yjs `ycomments` entry ids, and 246 of the 1462 planned ids equal a legacy row name (all thread roots, 71 Writer Documents). 8 legacy rows have no Writer counterpart. `_write_thread` sees the legacy row as already stored and refuses it.
- The 109 Removed-file documents are not yet counted on real data; step 10 owns that census and was not reached.
- Artifacts: `pass4-migrate.log`, `pass4-migrate-clean.log`, `pass4-traceback.txt`, `drive-build-state-after-pass4-failure.json`, `pass4-progress.tsv` under `/home/faris/backups/suite-frappe/build/`.
- Operational note: the pass 4 agent printed the whole `Drive Disk Settings` single while reading one flag, exposing the S3 access key id and `jwt_key` in its transcript under `/tmp` (the secret key stayed masked). Not written to any kept file. Rotate `jwt_key` if it matters. Rule for later passes: select the one column, never a whole Single.
- Fix in progress on branch `forge/ticket-31-legacy-comments`.

### Build pass 5, resume after the legacy-comment fix (2026-09-09, failed on data)

- Fix merged as 5e9b646b8. Legacy `Drive Comment` rows came from `new_writer.py`, which inserted one child row per Yjs annotation with the CRDT id as the row name. The spec is silent; the plan lists `drive_comment/` as a new doctype, not a reshaped side table. Chosen rule, from "Build is additive" and ticket 28's "do not erase source content": a legacy row that a Yjs entry claims is rewritten in place by UPDATE; a legacy row nobody claims is ported to the node of its File as a one-comment thread, or counted if that node does not exist. Counters `legacy_comments_ported`, `legacy_comments_superseded`, `legacy_comments_unported`. 826 build tests pass without a database.
- Same migrate command on the partial state. Step 7 completed: 142,522 `Drive Node Version` (expected 142,707 from the source count; 4 documents deferred), 1,470 `Drive Comment` in 1,099 threads, `legacy_comments_superseded` 245, `legacy_comments_unported` 0. Step 8 started: 5 template nodes, 22 media nodes, 17 media duplicates collapsed, 3 deck previews, 4 Presentations linked. Failed after 7 min 6 s: `BuildSlidesError: media node 0652d873e5 field parent is '6o66ho00mn', expected '5895c84b62'`, raised by `exact_fields` from `slides.py:377 _media_mapping`.
- Cause, pending quantification: a media File attached to a Presentation already has a tree node under a folder (it was uploaded into the legacy Drive tree), and step 8 expects the media node under the deck node per decision 012. Fix in progress on branch `forge/ticket-31-slides-media`.
- Rollback note for §14.11: the spec's rollback truncates the new tables. `tabDrive Comment` is a reused table holding 254 legacy child rows, so that rollback is lossy. The database snapshot restore used by this rehearsal is not.
- Artifacts: `pass5-migrate.log`, `pass5-migrate-clean.log`, `pass5-traceback.txt`, `drive-build-state-after-pass5-failure.json`, `pass5-progress.tsv` under `/home/faris/backups/suite-frappe/build/`. Source-side expected counts: `source-inventory.md` in the same directory.

### Plan for the Build rerun

- Pass 1, the storage_v2 setup, and the index, Removed-content and legacy-comment fixes are done above. After the slides-media fix merges: flush redis, same migrate command, expect Build to resume at step 8 and finish; then read the report and reconcile against `source-inventory.md`.
- `--skip-fixtures` is required until ticket 38 lands; `sync_fixtures` deletes and re-inserts the template Presentations and hits `require_node`.
- Do not use `--skip-failing` or `bypass-patch`.

Agents ran the restore and wrote this evidence.
