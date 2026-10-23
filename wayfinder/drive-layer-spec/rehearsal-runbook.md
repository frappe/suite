# Drive migration rehearsal runbook

This runbook is for the next full rehearsal of the Drive migration. It runs
the migration on a copy of production data, on a laptop bench. The goal is
to show that the migration loses no data that the source still has, and
that the migrated site works in the browser.

Run the steps in order. Each step gives the command and what a pass looks
like. If a step fails, stop. Do not continue on a half-migrated site.

The running plan is [`PROGRESS.md`](PROGRESS.md). The rules for Build,
Cleanup and the preflight are in [`drive-layer-spec.md`](drive-layer-spec.md)
§14.

## Rules

Breaking a rule is worse than a failed rehearsal.

1. **Never contact production.** Do not send a request to the production
   site or the production bucket. Every S3 call goes to the rehearsal
   bucket. Before any command that talks to S3, confirm the configured
   bucket name.
2. **Never read or print secrets.** Do not print a `site_config.json`. Do
   not open the production config backup, or any access-key file. To check
   the config, print only key names (step 6).
3. **Never put production data in this repository.** That includes names,
   emails, file names, object keys, bucket names, production hostnames,
   counts from the real data, and keys. Keep all evidence under the site's
   `private/` folder, or in the local `drive-rehearsal/` folder.
4. **Do not weaken a check to make a run pass.** Do not set
   `drive_build_accept_skips`. Do not edit the accepted-defects list to
   hide a new defect. If a check fails, find the cause.
5. **Do not supply the production encryption key.** Without it, the
   passwords stored in the restored database cannot be decrypted. This
   is a safety feature.
6. **If code under `suite/drive/patches/` changes during a run, start
   again from a fresh restore.** A resume gives a preview, not proof.
7. **Never run `delete_legacy_objects` against a rehearsal** (step 19).

## Local helper scripts

The bench has a local folder, `drive-rehearsal/`, next to `apps/` and
`sites/`. It is not in any repository, and it must stay that way. It holds
the helper scripts that this runbook names, and the evidence from earlier
runs.

The scripts check the previous run's values before they act: the site
name, its database name, the bucket name and region, the backup file
names, the restored file count, and file names from the previous run.
**Before the run, update these values in each script to match the new
backup and site.** An assertion that fails because of an old value is not
a migration failure. An assertion that fails because the site points at
the wrong bucket is a reason to stop.

| Script | What it does |
|---|---|
| `check-production-denial.py` | Faris runs it. It shows that the rehearsal keys can reach the rehearsal bucket and cannot reach the production bucket. |
| `restore-rehearsal.py` | Restores the database and both file archives. It raises the database packet limit for the restore and sets it back after. |
| `verify-restored-files.py` | Compares every restored file with its archive, by size and SHA-256. |
| `make-site-safe.py` | Mutes email, pauses the scheduler, turns on maintenance mode, and blanks every outbound integration. |
| `snapshot-source.py` | Saves the source census and a private snapshot of the legacy rows. |
| `check-bucket-copy.py` | Heads every legacy S3 object in the rehearsal bucket and compares its size with the `File` row. |
| `run-migration.py` | Runs `bench migrate`, prints progress every minute, and stops if the patch code changes. |
| `verify-migrated-data.py` | Compares the migrated site with the source census. |
| `verify-copied-bytes.py` | Heads every copied and referenced object, then hashes a sample. |
| `collect-browser-cases.py` | Picks real documents, files and owners for the browser checks. |
| `browser-qa.mjs` | Runs the browser checks and blocks every request to a production host. |
| `finish-preview.py` | Runs the data check, the head check, a second migrate and a login check, then turns maintenance mode off. |
| `resume-preview.py` | Resumes a failed run for a preview only. It is not proof. Do not use it in a proof run. |
| `iam-policy.json` | The IAM policy for the rehearsal keys. It denies every bucket except the rehearsal bucket. |

Placeholders in this runbook:

| Placeholder | Meaning |
|---|---|
| `<site>` | the rehearsal site, for example `rehearsal.localhost` |
| `<backup>` | the backup files: database, public files, private files |
| `<rehearsal-bucket>` | the isolated S3 bucket for the rehearsal |
| `<region>` | that bucket's region |
| `<n>` | the run number |
| `https://<site>` | the origin the browser uses for the site, with its port |

Run every command from the bench folder, with `SITE=<site>` set.

## Prerequisites

### 1. Frappe and Suite branches

```bash
git -C apps/frappe branch --show-current   # forge/storage-v2, or develop once frappe/frappe#42407 is merged
git -C apps/suite branch --show-current    # forge/drive-layer, or develop once PR #881 is merged
git -C apps/suite log -1 --oneline
git -C apps/suite status --short | wc -l
```

**Pass:** Frappe has storage v2 (`frappe/storage/` exists). Suite has the
final patch set. Record both commit hashes and the count of uncommitted
files in the report.

Then fingerprint the patch code, so that `run-migration.py` can stop if it
changes:

```bash
python3 - <<'EOF'
import hashlib, json, pathlib
root = pathlib.Path("apps/suite/suite/drive/patches")
manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*.py")}
pathlib.Path("drive-rehearsal/run-<n>-patch-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(len(manifest), "patch files")
EOF
```

### 2. A fresh backup

Faris downloads a new backup of the production site: the database, the
public files and the private files. Do not use the config backup.

**Pass:** the three files exist and are readable. Write their file names
into the scripts (see "Local helper scripts").

Check free disk space first. The private-file archive is extracted in
full, the database grows to several times its compressed size, and the
logs need room. If there is not enough space, ask Faris. Do not delete
anything to make room.

### 3. A case-sensitive disk for the site

macOS disks are case-insensitive by default. Some private files differ
only by case, and they merge on such a disk. Put the site on a
case-sensitive disk image:

```bash
hdiutil create -type SPARSEBUNDLE -size 200g -fs "Case-sensitive APFS" \
  -volname rehearsal-data drive-rehearsal/rehearsal-data.sparsebundle
mkdir -p drive-rehearsal/mounted-data
hdiutil attach drive-rehearsal/rehearsal-data.sparsebundle -mountpoint drive-rehearsal/mounted-data
```

The site is created in step 6 and moved onto this disk there.

### 4. An isolated bucket, with CORS

The rehearsal bucket is a copy of the production bucket. Faris refreshes
it after he takes the backup, so that objects uploaded since the last copy
are present. `aws s3 sync` can skip keys that start with `/`. Step 9 finds
them, and Faris copies them one by one.

The rehearsal keys have only the permissions in `iam-policy.json`.

The bucket needs a CORS rule for every origin the rehearsal is served
from, the Vite port included (spec §14.1). Without it, text previews and
uploads fail in the browser.

```json
{"CORSRules": [
  {"AllowedOrigins": ["http://<site>:8004", "http://<site>:8084"],
   "AllowedMethods": ["GET", "HEAD", "POST"],
   "AllowedHeaders": ["*"],
   "MaxAgeSeconds": 3000}
]}
```

```bash
aws s3api put-bucket-cors --bucket <rehearsal-bucket> --cors-configuration file://cors.json
aws s3api get-bucket-cors --bucket <rehearsal-bucket>
```

**Pass:** `get-bucket-cors` shows the rule with the rehearsal origins.

Build reads every legacy object in full to compute its checksum, so a
full run downloads the whole bucket once. Tell Faris before the first
full run, because S3 charges for that transfer.

### 5. Chrome for Testing

The browser checks use Playwright over the Chrome DevTools protocol. Use
Chrome for Testing, headless, with its own profile folder:

```bash
npx @puppeteer/browsers install chrome@stable
"<path printed above>" --headless=new --remote-debugging-port=9222 \
  --user-data-dir="$PWD/drive-rehearsal/chrome-profile" about:blank &
curl -s http://127.0.0.1:9222/json/version
```

**Pass:** `curl` prints the browser version. Do not run the browser with a
window: it takes keyboard focus from the person at the laptop. If another
agent already runs a shared browser on port 9222, use your own browser
context in it and close only that context when done.

## Restore and make the site safe

### 6. Create the site and add the rehearsal credentials

```bash
bench new-site $SITE --db-socket /tmp/mysql.sock --admin-password <admin-password>
mv sites/$SITE drive-rehearsal/mounted-data/$SITE
ln -s "$PWD/drive-rehearsal/mounted-data/$SITE" sites/$SITE
bench --site $SITE set-config mute_emails 1
bench --site $SITE set-config pause_scheduler 1
bench --site $SITE set-config maintenance_mode 1
```

Faris adds `storage_driver_config` to the site config himself:

```json
"storage_driver_config": {
  "bucket": "<rehearsal-bucket>",
  "region": "<region>",
  "access_key_id": "…",
  "secret_access_key": "…"
}
```

Check it without printing secrets:

```bash
python3 -c "import json;c=json.load(open('sites/$SITE/site_config.json'))['storage_driver_config'];print(c['bucket'], sorted(c))"
chmod 600 sites/$SITE/site_config.json
```

**Pass:** the bucket is `<rehearsal-bucket>`, and the key names are the
four above. There is no `endpoint_url`.

Then Faris runs `python3 drive-rehearsal/check-production-denial.py`.

**Pass:** it prints `PASS: rehearsal access works; production HEAD access
is denied.` If it prints anything else, stop. Do not restore.

### 7. Restore the backup

```bash
python3 drive-rehearsal/restore-rehearsal.py --run-label run-<n>
env/bin/python drive-rehearsal/verify-restored-files.py
```

Frappe warns that the backup's encryption key is missing. Do not supply
it.

**Pass:** the restore exits 0 with no SQL error codes, and its result says
the site was restored with files. Every restored file matches its archive
by size and SHA-256, with zero differences. Record the restore time.

### 8. Make the site safe

Do this before `bench migrate` and before any request to the site.

```bash
env/bin/python drive-rehearsal/make-site-safe.py
bench --site $SITE scheduler disable
bench --site $SITE set-config drive_cleanup_backup "<backup>"
```

The script:

- sets `mute_emails`, `pause_scheduler` and `maintenance_mode`
- turns on `storage_v2` with the S3 driver
- sets `host_name` and `socketio_port` to the local services
- turns off incoming and outgoing mail on every Email Account
- points the legacy Drive Disk Settings at the rehearsal bucket, and
  removes the legacy S3 keys and their saved passwords
- blanks the Mail, Meet and Suite Settings server addresses, the Suite
  Cloud connection, the media server and the recorder
- blanks every other single setting that names a production host

It saves what it changed to `private/rehearsal-safety.json`.

Then check the site config for anything else that points outside the
laptop, by key names only:

```bash
python3 -c "import json;c=json.load(open('sites/$SITE/site_config.json'));print(sorted(c)); print(sorted((c.get('mail') or {})))"
```

**Pass:** the script reports zero remaining production references. The
site config has no `mail` server address. `bench --site $SITE scheduler
status` says the scheduler is disabled. Ask Faris to stop the bench's
background worker until step 13, so that no queued job runs during the
migrate.

## Before the migrate

### 9. Census and bucket check

```bash
env/bin/python drive-rehearsal/snapshot-source.py
env/bin/python drive-rehearsal/check-bucket-copy.py
```

`snapshot-source.py` saves `private/rehearsal-census-before.json`: rows per
legacy table, files per source, bytes, and files per owner under anonymous
labels. These are the expected numbers after Build.

`check-bucket-copy.py` heads every legacy S3 object and saves
`private/rehearsal-bucket-copy.json`. It reports found, missing and
size-mismatch counts per key layout. Folder rows have no object, so their
"missing" status does not count.

**Pass:** missing and size-mismatch counts match the previous run's
accepted defects, plus any defect on a file added since. If many keys that
start with `/` are missing, the bucket copy skipped them. Tell Faris; he
copies them one by one, then run the check again.

### 10. Preflight over every object

Preflight is read-only. Run it over every object, not the default sample:

```bash
bench --site $SITE execute suite.drive.patches.build.preflight.check \
  --kwargs "{'every_object': True}" | tee sites/$SITE/private/preflight-run-<n>.txt
chmod 600 sites/$SITE/private/preflight-run-<n>.txt
```

The output names real files, so it stays in `private/`.

A defect is `missing` (no object at the key), `size_differs` (the object
is not the size in `File.file_size`), or `no_object_path` (the URL names no
key). A defect on a Removed row never blocks. A defect on an Active or
Trashed row blocks unless it is on the accepted-defects list (spec §14.1).

**Build the accepted-defects list:**

1. Start from the blocking defects that preflight reports. The printed
   list is cut short, so take the full set from
   `private/rehearsal-bucket-copy.json`: every non-folder row whose source
   status is not Removed and whose status is `missing` or `size_mismatch`.
   Add the `no_object_path` rows from the preflight output.
2. Compare it with the previous run's list. Old entries that still match
   carry over. Mark every entry that is new.
3. Faris checks each new entry against the production bucket himself. The
   agent never does. A defect is accepted only when the source has the
   same defect, so that no run can bring the bytes back.
4. Write the list to `private/accepted-defects.json`, one entry per defect:

   ```json
   {"defects": [
     {"file": "<File name>", "key": "<object key>",
      "defect": "missing", "note": "<why it is accepted, and who checked>"}
   ]}
   ```

   Use `size_differs` for a size mismatch. The key is the decoded key, as
   the preflight prints it.
5. Point the site at it, and run the preflight again:

   ```bash
   chmod 600 sites/$SITE/private/accepted-defects.json
   bench --site $SITE set-config drive_preflight_accepted_defects private/accepted-defects.json
   bench --site $SITE execute suite.drive.patches.build.preflight.check \
     --kwargs "{'every_object': True}"
   ```

**Pass:** the first line is `Drive Build preflight: GO`. There are zero
blocking defects and zero stale entries. The accepted count equals the
number of entries in the list. Record the counts of accepted defects,
defects on Removed rows, and bytes Build cannot reach. If an entry is
stale, the object has come back: remove the entry and run again.

### 11. Dry run

```bash
bench --site $SITE execute suite.drive.patches.build.dry_run.run
```

It saves `private/drive-build-dry-run-<UTC>.json`.

**Pass:** every refusing skip counter is zero. Record the predicted roots,
nodes per kind, renames, broken folder chains and Removed rows. Step 13
compares Build's report with these.

## The migration

### 12. Build and Cleanup in one migrate

One `bench migrate` runs Build, then Cleanup. Run it through the runner,
with the laptop kept awake:

```bash
caffeinate -i env/bin/python drive-rehearsal/run-migration.py --run-number <n>
```

The runner checks the bucket, the safety settings and the patch
fingerprint. It refuses if `drive_build_accept_skips` is set or if an
earlier run left a Build or Cleanup state file. It raises the database
packet limit to 64 MiB for the run, because some Writer bodies are larger
than the default, and sets it back after. The raw log goes to
`private/migrate-run-<n>.raw.log`.

While it runs:

- Every minute it prints the elapsed time, the S3 rows seen, the bytes
  copied, the objects missing and the phases completed.
- When the storage, tree and grants phases are complete, check the
  history indexes (B108). This must list an index that starts with
  `doc, creation, name`:

  ```bash
  echo 'SHOW INDEX FROM `tabWriter Version`' | bench --site $SITE mariadb
  ```

- Do not stop the run to test a resume. The runner refuses to start when
  a Build state file exists, so it cannot continue a stopped run. A stop
  and resume test is useful (Build skips objects already at their
  destination), but do it in a separate run, after adding a resume
  option to the runner.

If Build refuses because of reachable skips, it writes
`private/drive-build-skipped.json`. Stop and show Faris the list. On any
other failure, save the traceback and `private/drive-build-state.json`,
find the cause, and start again from step 6 after a fix.

**Pass:** the runner exits 0 with no changed patch files.

**Record:**

- wall time, and the time each phase completed: storage, tree, grants,
  history, content, Cleanup (from `private/migrate-run-<n>-result.json`)
- from `private/drive-build-report.json`, the counters in spec §14.9:
  `s3_objects_copied`, `s3_bytes_copied`, `removed_rows_skipped`,
  `broken_chains_skipped`, `blobless_nodes`, `title_renames`,
  `grant_rows_dropped`, `links_minted`, `creator_grants_minted`,
  `creator_denies_overridden`, `docshare_rows_dropped`,
  `orphan_content_docs_adopted`, `media_nodes_created`,
  `slide_elements_rewritten`, `template_nodes_created`,
  `writer_templates_converted`
- from the report's `evidence.content` section: `writer_media_copied` and
  `borrowed_duplicates_collapsed` (B112), `writer_images_wrapped` (B113),
  `writer_media_references_missing`, `media_references_missing_file_rows`
  and `sheet_snapshots_missing`
- from `private/drive-build-skipped.json`: the `missing_bytes` count, and
  that it matches the accepted defects and the unreachable rows from the
  preflight
- from `private/drive-cleanup-state.json`: that every phase is complete

### 13. Check the migrated data

```bash
env/bin/python drive-rehearsal/verify-migrated-data.py
```

`verify-migrated-data.py` still checks the Sheet baseline from the
previous run. Replace that check with one for this run's data, or remove
it, before running.

**Pass:** zero failures. In particular:

- Every reachable legacy file and folder is a Drive node, or is in the
  skip file with a reason.
- Every node's size and type match its blob.
- Every owner keeps at least EDIT on their own nodes.
- A sample of real shares keeps at least its source role.
- Every Writer document, Sheet and Presentation has a node, and the node
  links back to it.
- Node counts per kind match the dry run (step 11), except for the
  differences the report explains.

## A second migrate

### 14. The second migrate must change nothing

Count the main tables before and after:

```bash
cat > drive-rehearsal/counts.sql <<'EOF'
SELECT 'nodes', COUNT(*) FROM `tabDrive Node`
UNION ALL SELECT 'versions', COUNT(*) FROM `tabDrive Node Version`
UNION ALL SELECT 'grants', COUNT(*) FROM `tabDrive Grant`
UNION ALL SELECT 'blobs', COUNT(*) FROM `tabFile Blob`
UNION ALL SELECT 'files', COUNT(*) FROM `tabFile`
UNION ALL SELECT 'previews', COUNT(*) FROM `tabDrive Node Preview`;
EOF
bench --site $SITE mariadb < drive-rehearsal/counts.sql > drive-rehearsal/counts-before.txt
wc -l < sites/$SITE/private/drive-build-copied-objects.jsonl
time bench --site $SITE migrate
bench --site $SITE mariadb < drive-rehearsal/counts.sql > drive-rehearsal/counts-after.txt
diff drive-rehearsal/counts-before.txt drive-rehearsal/counts-after.txt
wc -l < sites/$SITE/private/drive-build-copied-objects.jsonl
```

This migrate also needs the 64 MiB packet limit. Before it, note the
current value and raise it, as the database root user:

```bash
mariadb --socket=/tmp/mysql.sock -u <db-root-user> -N -e 'SELECT @@global.max_allowed_packet'
mariadb --socket=/tmp/mysql.sock -u <db-root-user> -e 'SET GLOBAL max_allowed_packet=67108864'
```

After it, set the noted value back. `finish-preview.py` does the same
around its own second migrate. It also runs the data check from step 13,
the head check from step 15 and a login check.

**Pass:** the migrate exits 0. `diff` prints nothing. The copy ledger has
the same number of lines. The legacy tables and columns that Cleanup
dropped are still gone. Record the time.

## Byte checks

### 15. Every object, and a checksum sample

```bash
env/bin/python drive-rehearsal/verify-copied-bytes.py --head-only
env/bin/python drive-rehearsal/verify-copied-bytes.py --hash-workers 4
```

The first command heads every object in the copy ledger and every blob
that a node or version references, and compares its size. The second also
computes the full SHA-256 of a sample and compares it with the checksum in
the blob. The sample is the first 50 objects per legacy key layout, every
object under 1 MB, the 20 largest objects, and every local blob.

`--reuse-evidence <earlier evidence file>` reuses a checksum from an
earlier check only when the bucket, key, checksum and size all agree.

**Pass:** zero missing objects, zero size differences, zero checksum
differences. Record the number of objects, the bytes hashed and the
time. Faris has asked for a checksum of every file at least once. Offer it
as an overnight run.

## Thumbnail backfill

### 16. Run the backfill

At its end, Cleanup queues one preview backfill on the long queue. It makes
a thumbnail for every migrated file that can have one: images, videos and
PDFs.

For the rehearsal, run it in the foreground, so that it can be timed. The
background worker is still stopped from step 8.

```bash
bench --site $SITE execute frappe.db.get_single_value --args "['Drive Disk Settings', 'preview_size']"
time bench --site $SITE execute suite.drive._core.previews.backfill_missing | tee drive-rehearsal/backfill-run-<n>.txt
```

The backfill prints `made`, `skipped`, `failed` and `seconds`.

**To resume:** press Ctrl+C, then run the same command again. A cursor in
the site's Redis cache records the last file tried, and the next run
continues after it. Do not restart or flush the Redis cache in between.
If the cursor is lost, the next run starts from the beginning but passes
over every file that already has a preview, so it costs time only.

A file that fails to render is logged and passed over. Count the
failures, and group them by type and error message:

```sql
SELECT COUNT(*) FROM `tabError Log`
WHERE method = 'Drive: could not render a preview' AND creation >= '<backfill start>';
```

When Faris starts the background worker again, it runs the queued
backfill. That run tries the failed files once more and should make no
other preview.

**Pass:** the backfill completes. Every failure has a known cause.

**Record:**

- the `preview_size` value before the migrate (after step 8) and after
- `made`, `skipped`, `failed` and the time
- failures per type: images, videos, PDFs
- the pixel size of a few previews: the longest side must equal
  `preview_size`
- for each failed MP4, whether its index comes after the video data
  (see "Known open issues")

## Browser checks

### 17. Open the site in the browser

Ask Faris to start the background worker again. Then:

```bash
bench --site $SITE set-config maintenance_mode 0
env/bin/python drive-rehearsal/collect-browser-cases.py
node drive-rehearsal/browser-qa.mjs
```

If the Administrator login returns 401, reset its password with
`bench --site $SITE set-admin-password <admin-password>`.

`browser-qa.mjs` blocks every request to a production host before it
leaves the browser, and counts it. Keep that guard in every check you add.

It checks, as Administrator:

- 10 Presentations with pictures: no broken picture
- 10 Writer documents with pictures: every picture in the source is shown
- 3 Sheets: the grid loads
- an image, a PDF and a large video: each previews, and Download saves a
  file of the right size
- every user picture and the Suite logo load
- an old file link and an old folder link redirect to the new page
- 3 real owners, by impersonation: My files, Shared with me, Starred,
  Recent, Trash, a deep folder, and their documents open

Add these new cases, by hand or in the script:

- **PDFs open in the page,** not as a download.
- **Text and Markdown previews** show their content. These read from the
  bucket through a signed link, so they need the CORS rule.
- **Uploads:** as Administrator, upload a small file with made-up content
  into a new test folder. It appears, previews and downloads. The upload
  posts straight to the bucket, so it also needs the CORS rule.
- **Download saves the file** with its name and full size.
- **A picture inside a document opens by its own link:** open the
  picture's link in a new tab. It loads.
- **Thumbnails** show in the grid view for images, videos and PDFs.

**Pass:** every check passes. Writer is 10 of 10 now that B112 and B113 are
fixed. Zero page errors, zero CORS errors in the console, and zero blocked
production requests. Screenshots and results stay in `private/`.

## Mail and Calendar

### 18. Guards, if Mail and Calendar are connected

The restored database holds Mail account rows for real users. Their
passwords are encrypted with the production key, which the rehearsal does
not have, so they cannot be used. Keep it that way.

`make-site-safe.py` blanks the Mail server address. Leave it blank unless
Faris needs Mail on the rehearsal. If he connects Mail and Calendar:

- Connect only Faris's own mailbox.
- `mute_emails` stops Frappe's email queue only. It does not stop mail sent
  through the mail server. Do not send mail, replies or calendar invites to
  anyone but Faris's own address.
- Do not impersonate other users while Mail is connected. An action as
  another user could send mail or an invite to a real person. Run the
  owner checks in step 17 before Mail is connected, or after it is
  disconnected.
- Keep the scheduler paused, so that no sync or reminder job runs.
- Before teardown, remove the stored mailbox credentials and the server
  address (step 19).

## Teardown

### 19. When Faris says the rehearsals are done

**Never run `delete_legacy_objects` against a rehearsal.** The legacy
objects in the rehearsal bucket are the source for the next rehearsal.
Deleting them means copying the production bucket again.

1. **Remove credentials.**

   ```bash
   bench --site $SITE set-config storage_driver_config None
   bench --site $SITE set-config drive_preflight_accepted_defects None
   python3 -c "import json;print(sorted(json.load(open('sites/$SITE/site_config.json'))))"
   ```

   Frappe removes a key set to `None`. If Mail was connected, remove
   Faris's mailbox credentials from his User Settings row and blank the
   Mail server address. Faris deletes the rehearsal IAM keys.
2. **Stop the services** that serve the site, and the browser. Delete
   `drive-rehearsal/chrome-profile`: it holds cookies and cached pages.
3. **Drop the site** without a backup, then delete any archived copy:

   ```bash
   bench drop-site $SITE --db-root-username <db-root-user> --no-backup --force
   ls archived_sites/ 2>/dev/null
   ```

4. **Delete the restored data.** Detach the disk image and delete it. It
   holds the restored files and all private evidence. Removing only the
   site's symlink is not enough.

   ```bash
   hdiutil detach drive-rehearsal/mounted-data
   rm -rf drive-rehearsal/rehearsal-data.sparsebundle
   ```

   Also delete the count files, backfill output and browser downloads in
   `drive-rehearsal/`. Keep a run report only if it holds counts and no
   personal data.
5. **Faris deletes** the backup files and, once no rehearsal is left, the
   rehearsal bucket.

## Report

Write the results to `drive-rehearsal/REPORT.md`, which stays local. For
each step, give pass or fail, the times and the counts. List every bug
found in the local tracker, `drive-rehearsal/context/tracker.md`, with the
next free B-number. End with a go or no-go for production, and what is
still unproven.

## Known open issues

The next run must check each of these.

- **Thumbnail size setting.** The patch `migrate_preview_size_unit` maps
  only one legacy `preview_size` value to the default of 512. A site that
  stored any other legacy value keeps it. On the last rehearsal that value
  was far too large, so previews came out nearly full size. Record the
  value after the migrate, and the pixel size of the previews.
- **Videos.** Some MP4 files keep their index at the end of the file. The
  renderer reads the file as a stream it cannot seek, so it cannot reach
  the index, and those previews fail. Record how many MP4 previews fail,
  and check the index position of each failed file.
- **Expected missing references.** The source has defects from before the
  migration: missing objects, truncated objects, and Sheets that name a
  history snapshot that does not exist. These are on the accepted list or
  are reported by Build. Old Writer versions that name a picture that was
  deleted are now reported as missing (`writer_media_references_missing`).
  These are expected. A missing reference that is not one of these is new,
  and must be explained.
