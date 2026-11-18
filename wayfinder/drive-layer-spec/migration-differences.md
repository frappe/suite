# What people notice after the Drive migration

This document is for two readers: the team of the next site that
migrates to the Drive layer, and anyone who answers a support question
after a migration, such as "I could edit this folder before" or "where
did my old version go".

Each entry says what a person sees, why it happens, whether it is a loss
or only a change, and what to do about it. The rules are in
[`drive-layer-spec.md`](drive-layer-spec.md) §14. How a rehearsal checks
them is in [`rehearsal-runbook.md`](rehearsal-runbook.md). How the first
production site was moved is in
[`production-move-record.md`](production-move-record.md).

The entries describe kinds of case. The cases and counts of one site
stay with that site's private records.

## Small losses

### Writer edits that were never visible

**What a person sees:** nothing. Some Writer documents hold saved edits
that depend on earlier edits that were never saved. The old Writer could
not place them and never showed them. The new Writer leaves them out
too.

**Why:** conversion to the collaborative format keeps only what can be
placed in the document. What it cannot place, it records in the
`dropped` column of the app's conversion table
(`__writer_content_conversion`, written by
`suite/content/conversions.py`).

**Loss or change:** a loss of text that nobody could see. Usually a few
words or fragments of typing.

**What to do:** nothing by default. If an owner asks, read the text from
the `dropped` column, or from the backup taken before the migrate.

### Old versions that show a deleted author

**What a person sees:** in the version list of a Writer document, some
ported versions name an email address instead of a person.

**Why:** the migration copies each old version's author. When that
person's account was deleted, no user exists, and the version is
credited to Guest. Since PR #1244, the version list shows the original
author's email in place of "Guest" (`suite/drive/_core/versions.py`). It
does so only when the author is Guest, the row's owner has no account,
and the reader is signed in. A guest on a link never sees the email.

**Loss or change:** a change. The author is kept.

### Migrated versions show their time twice

**What a person sees:** a ported Writer version has its date and time as
its title, and the line below repeats the time.

**Why:** a ported version's `label` comes from the old version's title
(spec §14.6). For these versions, that title is the time it was saved.
The list also shows the time of every version.

**Loss or change:** a change in display only.

### Pictures that were already broken

**What a person sees:** a broken picture in a deck or a Writer document.

**Why:** almost always, the picture was broken before the migration. A
slide or a Writer body can name an address that had no file on the
source site, or a placeholder image that no version of the code has.
Build keeps such a reference as it is and reports it as missing (spec
§14.7, `writer_media_references_missing`). Two kinds improve:

- A slide that showed a plain Drive upload by its old file address now
  shows the deck's own copy of the same bytes (PR #1241, spec §14.7,
  "Pictures another document owns"). Anyone who can read the deck can
  see the picture.
- A Writer picture that holds the address of the old Drive app's embed
  method is mapped to its node when the document opens
  (`frontend/src/apps/writer/extensions/drive-media.ts`). Most of these
  were broken on the old site and show again. Where nothing in the
  source says which file it was, the picture stays broken.

**Loss or change:** not a loss of the migration.

**What to do:** if the bytes still exist somewhere, the owner can insert
the picture again.

### Thumbnails that cannot be made

**What a person sees:** a file with an icon in the grid view instead of
a thumbnail.

**Why:** the file is damaged, truncated or encrypted, or its type is not
rendered. HEIC and SVG files get no thumbnail by design: they are not in
`RENDERABLE_MIMES` (`suite/drive/_core/previews.py`).

**Loss or change:** a change. The file is stored and downloads.

### Sheets whose head snapshot is missing

**What a person sees:** a Sheet with less history than expected.

**Why:** some Sheets name a head snapshot that was already missing on
the source site. Build keeps the live sheet data and every snapshot that
exists, and reports the missing head (spec §14.6, "Unavailable Sheet
history", `sheet_snapshots_missing`). No Sheet is empty after the
migration.

**Loss or change:** no loss caused by the migration. The history was
already gone.

### Old notifications and some activity

**What a person sees:** the notification inbox starts empty. Some old
activity rows are not in an item's activity.

**Why:** old Drive notifications carry no activity link, so they are
dropped (spec §14.6). An activity row that names no migrated item is
dropped and counted.

**Loss or change:** a loss by design.

### Items that the old site had already deleted

**What a person sees:** nothing, or a support question about an item
that is not in Drive.

**Why:** Build does not migrate:

- rows with status Removed, and everything below them (spec §14.4)
- documents whose every file row was Removed. Build purges them through
  the app, as the old Drive's nightly sweep would have done (spec §14.6)
- old comments on rows that have no file. They stay in the old table
- permission rows that name a person or group that no longer exists, or
  an item that was not migrated (spec §14.5)

**Loss or change:** not a loss. The old site had already removed these
items, or they referred to nothing.

## Access changes

Nobody loses read access, except in the public and composite-deck cases
below.

### A person can view but can no longer share

**What a person sees:** "I could add people to this before, and now I
can't."

**Why:** the old Drive could give the share right without edit. The new
roles cannot express that: MANAGE needs EDIT (spec §4.1, §14.5). So the
person keeps read, or their other rights, and loses share. In the old
share dialog, "Can view" also sent the share right for a long time, so
most of these rights were never chosen by anyone.

**Loss or change:** a loss of the share right, decided on purpose. The
other option, full control, would also let these people edit items that
their owners set to view only.

**What to do:** the item's owner, or anyone with full control, can raise
the person.

### Upload, edit and sharing rights are kept

**What a person sees:** nothing. This entry explains why someone may
have a person grant they never had before.

**Why:** the old Drive decided each flag on its own, from different
folders and groups. The new engine lets the nearest grant win whole
(spec §5). Without a fix, some people would lose upload, edit or sharing.
Build compares, for every person, the role the old Drive gave with the
role the engine answers, and writes grants so that nobody ends lower
(spec §14.5, "Kept rights", `suite/drive/patches/build/kept_rights.py`,
PR #1242). Nobody ends higher than before, with one exception: a person
who could edit but not upload now can also upload, because no role means
"edit without upload".

**Loss or change:** no loss. A person grant written because of a group
stays when the person leaves the group.

### Public shares

**What a person sees:** an item that was public with comment or upload
is now public to read, and has a share link at the old level. An item
that was public with write and share now has an edit link.

**Why:** a public grant above read becomes `$PUBLIC` READ plus a link
(spec §14.5, §6). People who used these items through the public address
need the link to do more than read.

**Loss or change:** a change. Tell people who use public items before
the migration.

### Composite decks that were forced public

**What a person sees:** a composite deck that someone could open before
is refused.

**Why:** the old Slides forced a public read row on every composite deck.
On a composite deck that was not itself public, Build drops that row
(spec §14.5, §6.6). People with no other grant lose read there.

**Loss or change:** a loss of access, by design.

**What to do:** the owner shares the deck.

### Suite Admins no longer read everything

**What a person sees:** a Suite Admin cannot open other people's files.

**Why:** a Suite Admin administers but does not read or edit without a
grant (spec §4.9,
[ADR 0001](../../suite/drive/docs/adr/0001-suite-admin-administers-but-does-not-edit.md)).

**Loss or change:** a change by design.

**What to do:** the admin grants themselves a role. The grant is
recorded.

### Owners get edit, not full control

**What a person sees:** an owner cannot share their own item.

**Why:** the old Drive gave an item's owner every right without a row.
The new model gives the owner nothing by ownership alone. Build gives an
owner EDIT on their own item where the parent gives less (spec §14.5,
"Creator grants"). An owner who had full control through a permission row
keeps it.

**Loss or change:** a change by design.

**What to do:** someone with full control on a folder above raises the
owner.

A known defect in the same area: a Suite Admin who created an item can
end at EDIT on it, although a group grant on the item gives full
control. See "Known open issues" in the runbook.

### Deck pictures filed in a Drive folder

**What a person sees:** a picture that a deck shows is also in a Drive
folder, and the folder's sharing applies to it.

**Why:** the picture in the folder follows the folder's access. The deck
shows its own copy of the same bytes (spec §14.7).

**Loss or change:** a change by design.

### Public files are private in Drive

**What a person sees:** a file that was public on the old site is
private in Drive.

**Why:** Drive nodes need private blobs, so Build copies public bytes
privately. The old public file keeps a copy under `Home`, so its old
public address still works (spec §14.4).

**Loss or change:** a change. Old public addresses keep working.

### What a person with only a share link can do

After PR #1257 a person whose only access is a share link can preview
and download files. Some things still differ:

- Deleting a link does not stop a page that is already open. Its
  Download works until the signed address expires, at most 15 minutes. A
  reload shows the sign-in page.
- Downloading a Writer or Sheets document through a link.
- Drive pictures and videos inside a Writer document, and their Markdown
  and DOCX export.
- A PDF left open on a desktop for more than 15 minutes.
- A folder link whose folder is in Trash still lists its contents, with
  a notice. This follows the rule that grants are kept on Trashed items
  (spec §14.5).
- On a composite deck, where a referenced deck is not public, the page
  shows one blank slide in its place. The old page left those slides
  out. Access is the same (spec §6.6).

## Things that stay where they were

- **Frappe attachments stay on the server's disk.** Deck and Writer
  media, and files under `Home`, stay local. `relocate_blobs` (spec
  §13.6) moves them to object storage, and it is not part of the
  migration.
- **The old Drive objects stay in the old bucket.** The migration copies
  objects. It deletes none. `delete_legacy_objects` is a separate step
  that the owner decides (spec §14.10, §14.11). Until then, the old bucket
  is the way back for the old files. Deleting it is the point of no
  return.
- **Plain Drive files start with no versions.** Old versions are ported
  only for Writer documents and Sheets (spec §14.6). A plain file gets
  versions from the new code on.
- **The site's backup does not include the Drive bucket.** A backup with
  files covers the site's own folders. Plan a separate copy of the
  bucket.

## Behaviour that changes with the new code

### One storage limit for Mail and Drive

**What a person sees:** "Drive is full", or an upload refused right
after the migration.

**Why:** on a site connected to Suite Cloud, the limit that counts is the
tenant's disk allowance, for Mail and Drive together. Drive's own quotas
in Drive Disk Settings are ignored (`effective_quota` in
`suite/drive/_core/quota.py`). Every reference pays: a file copied twice
counts twice (spec §7.1), and each converted document adds one version
of its old size.

Until Mail and Drive storage has been measured once after the migration,
every upload is refused with "Mail usage or the site allowance is
unavailable; refresh storage before adding Drive files"
(`check_addition` in `suite/suite_core/storage.py`). A person whose
mailbox Suite Cloud does not list cannot add files to their own Drive.

**What to do:** before the site opens, run
`suite.composition.admin_jobs.refresh_storage` and check that the
measurement is not stale. Keep the tenant's allowance well above Mail
and Drive together. For a person who cannot upload, check that Suite
Cloud lists their mailbox.

### Version history and the media sweep

Two daily Drive jobs change data that people see: `thin_versions`
deletes old `auto` versions by the ladder of spec §9.1, and
`sweep_unused_document_media` moves unused document pictures to their
owners' Trash (spec §10.6). Right after a migration their first runs
make large changes. The runbook says to stop them until the team decides
("Two nightly Drive jobs"). If they run, people see:

- documents with much less history, or none
- pictures in their Trash that they never deleted

### Mail Screener

The Mail changes on the same branch move mail that waits in each
account's Screener folder into the Inbox, with the `unscreened` keyword,
and delete the folder. Accounts of disabled users are skipped (PR
#1259) and keep their Screener folder. If such a user is enabled again,
run `suite.mail.patches.move_screener_to_unscreened_keyword.move_screener`
for that account.
