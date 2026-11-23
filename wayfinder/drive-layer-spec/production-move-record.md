# Record: moving a production site to a new server and the Drive layer

On the night of 17 to 18 Nov 2026, the first production Suite site was
moved to a new server and migrated to the Drive layer in one window. This
is a record of the method and of what the night taught. It is not a
runbook. The steps for a rehearsal, most of which also apply to a window,
are in [`rehearsal-runbook.md`](rehearsal-runbook.md). What people notice
afterwards is in [`migration-differences.md`](migration-differences.md).

Placeholders: `<site>` (the site), `<old-server>`, `<new-server>`,
`<relay>` (a third machine that reaches both), `<bucket>` (the new
object storage bucket).

## The method, in order

Days before the window, with the old site open:

1. Prepare `<new-server>`: the pinned commits of Frappe and Suite, built,
   and an empty site under its final internal name. Close the site at
   once (maintenance mode, scheduler paused) and keep it closed.
2. Copy the site's files to `<new-server>` through `<relay>`. Repeat this
   until the window, so that the window moves only the last changes.
3. Copy the legacy Drive objects to `<bucket>` in bulk, with a tool that
   keeps a ledger and verifies each object.
4. Run a full dress rehearsal on `<new-server>` with a safe copy of the
   data, then reset the site to empty. The rehearsal ran on the real
   target, with its real CPUs, disk and storage service.

In the window:

1. Close the old site: maintenance mode on, reads off, scheduler paused.
   Wait until no job of the site is queued or running
   (`ready-for-migration`).
2. Final file sync, in two hops through `<relay>`. Compare the file
   counts on both servers.
3. Stream the database from `<old-server>` to `<new-server>` through
   `<relay>`, and keep a copy of the dump on `<relay>`. Compare row counts
   of a few tables on both sides.
4. Copy the site config keys by name: a filter on `<old-server>` prints
   only the named keys, and a merge script on `<new-server>` writes them
   and prints key names only. Never copy a config file. The new site's own
   keys (database, host, domains) stay as Pilot wrote them. Check that
   `encryption_key` decrypts a stored secret, and print only its length.
5. Final object copy pass for the keys added since the bulk copy, then
   verify against the ledger.
6. Set the storage keys and Drive Disk Settings. Run the preflight over
   every object. Migrate. Migrate a second time: the second migrate must
   change nothing.
7. Measure Mail and Drive storage. Hold the Mail jobs the migrate queued.
8. Start web and workers. Check at the internal name: a data audit that
   compares the two databases, secrets present, every object Build
   wrote already made by the bulk copy, a dump after the migrate, and
   browser checks. Close the site fully again.
9. Switch the public address to `<new-server>`.
10. Check the CDN's cache headers, purge its cache, stop the two nightly
    Drive jobs, open the site. Write checks on the public address:
    sign in, upload and download, send one mail, edit a Writer document.
    Release the held Mail jobs. Turn backups on.

## Why the data went through a third machine

Neither server held a key for the other, and none was added. `<relay>`
opened one SSH connection to each server and piped the data between
them. A compromise of one server gives nothing on the other. The copies
on `<relay>` (the dump and the files) were the off-server copy of the old
site's last state, at no extra cost. The method also did not depend on
the private network between the two servers, whose firewall state was
not known. The cost is that files cross the network twice. The repeated
pre-copy moved most of them days before.

## Three way-back points

The old site stays on `<old-server>`, closed and untouched, until the
owner drops it. Nothing in the method changes its database or files.
What no way back undoes: objects written to `<bucket>`, state on the
mail server, and push registrations.

1. **Before the switch.** Open the old site again and close the new one.
   It takes minutes and loses nothing.
2. **After the switch, before people write.** Close the new site and stop
   its web and workers. Move the public address back to `<old-server>`,
   wait for its certificate, open the old site, purge the CDN cache. It
   loses nothing, because the new site allowed no writes.
3. **After people write.** As point 2, but first record what people
   created or changed on the new site since it opened. Everything written
   after the opening is lost unless it is copied back by hand. If the
   Mail jobs ran, rebuild the old Sieve scripts from the old site.

## Not chosen

- **Migrating in place on the old server.** A rollback after the
  migrate would mean restoring the dump and rebuilding the old code, not
  moving an address back. The old server also ran other sites, which
  would have had to move first, and it had little free disk. A rehearsal
  could not run on the real target, and the code change would have run
  inside the window.
- **Pilot's site restore.** It always migrates and then opens the site.
  On the new code that starts Build before the storage keys are set.
- **A clone on the same server.** It shares CPU and disk with the other
  sites, and still needs a move of the address by hand.
- **SSH agent forwarding** from `<relay>`. It also keeps keys off the
  servers, but any root process on the server can use the agent while
  the session is open.

## What went wrong or surprised us

- **The database stream failed on the first try.** The second file-sync
  hop was writing to `<new-server>` at the same time. The load slowed,
  and the old database's `net_write_timeout` ended the dump. Next time,
  run it in two stages: dump to a file on `<relay>`, check it with
  `gzip -t`, then load from the file. Do not run the file sync during the
  load. Reading the end of a large dump with `zcat` to find its last line
  is slow: `gzip -t` and the dump's exit code are enough.
- **The Error Log checks read the wrong place.** This Frappe version
  writes the Error Log to the site's SQLite log database, not to
  `tabError Log` in MariaDB. Every check that queried MariaDB found no
  new row and proved nothing. The migrate itself had logged no error.
  See "Logs and errors" in the runbook.
- **A service user was refused from the opening.** Another service
  called the spam-scan API as an API user with no Mail account. The new
  access check refused every call with 403 until PR #1258. After opening,
  read the request log for 403 answers to API users.
- **The Mail jobs failed for disabled users.** The Screener move could
  not reach the mail accounts of disabled users and wrote an error on
  every retry. PR #1259 now skips them.
- **A name that is attached but not primary answers with a 301 redirect**
  to the primary name, with no cache header. During the switch there are
  two such moments: on `<old-server>` between "make the internal name
  primary" and "delete the public name", and on `<new-server>` between
  Verify DNS and "make primary". Press these without a pause. A browser
  that stored the redirect goes to the closed old site, or loops between
  the two names, until its cache for the site is cleared. A private window
  works at once.
- **The bucket must allow both page addresses.** The browser sends
  upload bytes straight to `<bucket>`, and the bucket refuses an origin it
  does not list. The checks at the internal name need the internal
  address, and the checks after the switch need the public one.
- **Read-only mode does not work on the new code.** Opening a document
  is a write, so editors fail to open, and an open Writer page accepts
  typing it cannot save. Keep the site fully closed from the end of the
  checks at the internal name until it opens.
- **Each web process caches the site config for about a minute.** After
  a maintenance-mode change, wait a minute before you check it.
- **Commands through `sudo` and `bash -lc` lost quoting.** Put SQL in a
  file and feed the file. Never use `bench execute` to check a secret: it
  prints the return value.
- **`frappe.client.set_value` refused Drive Disk Settings**, because it
  validates the old `preview_size`. `frappe.db.set_single_value` writes
  one field without validation.
- **The migrate ran slower than in the dress rehearsal**, mostly in the
  content pass. Budget extra time, and keep any other bulk load off the
  storage service during the migrate.
- **The branch moved after the code cut; the pin did not.** The window
  ran on full 40-character commits fixed in advance. New merges reached
  production only with the first update after the window.
- **The site's backup does not include the Drive bucket.** A backup with
  files covers the site's own folders. Keep the legacy bucket until an
  independent copy of `<bucket>` exists.

## Updating the code after opening

For a pinned commit that changes no patch, no DocType, no hook and no
dependency, no migrate is needed. On `<new-server>`, as the bench user:

1. `git -C apps/suite fetch origin`
2. `git -C apps/suite checkout --detach <commit>`
3. Check that `git rev-parse HEAD` and `git rev-parse HEAD^{tree}` print
   the expected commit and tree hashes.
4. `pilot build --apps suite --force`
5. `pilot frappe --site <site> clear-cache`
6. Restart the web and worker services. Check first that the job queues
   are empty and the workers are idle.

Then check the public ping, the request log for 5xx answers, and the
fault the update fixes. The way back is the same steps with the previous
commit. Before you skip the migrate, check the diff for files under
`patches/`, `patches.txt`, DocType JSON, `hooks.py` and the dependency
files.

## Kept elsewhere

The full window runbook and the list of differences for that site hold
production data: names, addresses, counts and timings. They are kept
privately, not in this repository.
