---
id: 010
title: Quota policy
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [001]
---

## Question

Decide quota semantics: charge logical size (dedup stays a physical
saving; two owners of the same blob each pay), what counts (Active +
Trashed? Pending reservations?), where usage is stored (per-root counter
vs computed), how enforcement runs in Drive's own upload preflight, and
what happens to quota on ownership transfer. Blocked by Shared spaces and
offboarding model (transfer semantics feed in).

Context from [Shared spaces and offboarding model](001-shared-spaces-and-offboarding-model.md):
quota sits on `Drive Root.quota_bytes`, not on the node owner. Offboarding
archives a root in place and moves no bytes, so two extra things to settle:

- Who is charged for an archived root's bytes.
- Whether archived roots are ever reclaimed, and on what retention clock.

Handed from [Content app contract](005-content-app-contract.md): the live
document body stays in the app doctype (not a blob), while its versions and
comments are Drive-owned. Decide whether the body counts against the root's
quota, and how version blobs are charged.

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): a
cross-root MOVE (Home to Everyone or the reverse) moves the subtree's
bytes from the source root's quota to the destination root's, and is
refused when the destination would exceed its quota. Decide here whether
the DAV `quota-used-bytes` and `quota-available-bytes` properties, which
read the collection's Drive Root, count versions and previews.

## Resolution

Decided with Faris on 2026-09-03. Ten decisions.

### 1. Logical size, each reference pays

Every Drive Node that holds a blob pays the blob's full size to its root.
Two nodes with the same bytes in one root pay twice. Dedup is a physical
saving for the site, never a discount for a root. Usage is a plain sum, no
DISTINCT on blob.

Rejected: dedup within a root (a DISTINCT-on-blob count per root, and
deleting one copy frees nothing); physical only (drops the per-root quota
Meet's Recording Budget relies on).

### 2. What counts

Counts: Active nodes, Trashed nodes, every `Drive Node Version` (auto,
named, milestone, pinned), every reservation.

Free: `Drive Node Preview`, exports (never stored), content document
bodies (they live in the app doctype, not in a blob), folders and empty
nodes (size 0).

Trash counts because the bytes are held and restorable. Purge frees them,
by hand or by the 30-day sweep (`suite/drive/api/scripts.py:106`).
Versions count because kept versions are the user's choice and auto
versions are bounded by the ladder; deleting a version frees space. A
preview is Drive's own artifact with no user lever. A body has no reliable
byte size and would rebill on every touch; its embedded nodes and its
versions still pay.

Rejected: Active only (trash becomes free storage, and a restore can push a
root over quota); versions free (fifty pinned versions of a 1 GB video
cost 1 GB); only named and pinned count (the charge moves on pin and
unpin); body counts (a size on every touch).

### 3. Reservations stay, keyed to a root

`Drive Storage Reservation` keeps its four operations: create, grow,
reduce, release (`suite/drive/api/storage.py:107-171`). `storage_owner`
becomes `root`, a Link to Drive Root. Meet reserves against the Room
Owner's Personal Root. Reserved bytes count as used. A reservation never
moves with a node.

Rejected: drop reservations (a running recording can be starved by a
concurrent upload; Meet's budget model would need a redesign).

### 4. Counter on Drive Root

`Drive Root.used_bytes` (Long Int). Maintained in the same transaction as
every node create, replace, purge, version create, version thin,
reservation change, and move. Admission is one statement:

```sql
UPDATE `tabDrive Root`
SET used_bytes = used_bytes + :delta
WHERE name = :root
  AND (:effective_quota = 0 OR used_bytes + :delta <= :effective_quota)
```

Zero rows affected means refused. A release is a plain decrement with a
floor at 0. The row UPDATE is the lock: the Redis owner lock
(`acquire_owner_storage_lock`) goes. A daily job recomputes every root as
`SUM(node.size) + SUM(version.size) + SUM(reserved_bytes)`, writes the
corrected value, and logs any drift.

Rejected: a SUM on every preflight (a scan per write, and still a lock to
make check-then-write atomic); a counter with no repair job.

### 5. Enforcement in Drive's upload paths

Browser. Drive's create-upload endpoint reads the root's `used_bytes` and
effective quota and refuses when the declared size exceeds the free bytes.
This is a plain read before storage_v2 `create_upload`, so no byte lands
on an obvious overshoot. On finish, node create runs the admission UPDATE
with the actual size. A refusal there aborts the node; the blob has no
reference and GC removes it. A late refusal happens only when concurrent
uploads near the limit race.

WebDAV PUT. Preflight from Content-Length; the spool ceiling is the free
bytes (009 §5); the admission UPDATE runs at commit. A replace charges the
new head size; the old head becomes a version and stays charged. An empty
old head is not kept (009 §5).

Link uploads with actor Guest are charged to the root the node lands in.

Rejected: a reservation per upload session (one row per upload, and a
sweep that must track storage_v2 session expiry); charge at finish only
(a 4 GB upload refused at the end).

### 6. Configuration

`Drive Root.quota_bytes`: 0 = inherit the site default for its kind, N =
explicit. `Drive Disk Settings` gets `default_personal_quota` and
`shared_quota` (bytes, 0 = unlimited) in place of `quota` (MB). The
per-user override `Drive Settings.quota` is dropped; its values migrate
onto each user's Personal Root. Effective quota = `root.quota_bytes` if
set, else the site default for the root's kind. Only a Suite Admin sets
`quota_bytes`.

Rejected: root row only (a site default change touches no existing root);
Shared Root always unlimited (no way to cap the shared space).

### 7. Archived roots pay for themselves

An Archived Root keeps its `used_bytes` and `quota_bytes`. Nothing is
rebilled to anyone. Uploads by grant holders are admitted against the
archived root's own quota, like any other root. Archived is a state, not a
billing rule.

No reclaim clock. A Suite Admin purges an Archived Root deliberately: one
operation that purges every node in the root; blobs follow through GC.

Rejected: rebill to the Shared Root (a personal site has none, and a
leaver's private files would count against a space they never used);
frozen archived roots (breaks the 001 promise that everyone keeps the
access they had); a site retention timer (a shared folder in use vanishes
on a clock); reclaim on archive (irrevocable at the worst moment, and a
per-node grant scan 001 avoided).

### 8. Cross-root move and copy in the UI

Move: delta = `SUM(size)` of every node in the subtree, Active and
Trashed, plus every version on them. The admission UPDATE runs on the
destination, then the source is decremented, in the same transaction as
the path rewrite. Refused when the destination would overflow.
Reservations never move.

Copy: new nodes are charged to the destination root; no versions are
copied (009 §8).

### 9. DAV quota properties

`quota-used-bytes` = `used_bytes`. `quota-available-bytes` = `max(0,
quota - used)`, omitted when the root is unlimited (RFC 4331 §4). Both
read the Personal Root, the only DAV mount after the amendment below.

Rejected: report only the head bytes of Active nodes (two truths for one
root).

### 10. Amendment to WebDAV mapping

Faris reversed §1 of [WebDAV mapping](009-webdav-mapping.md): WebDAV
mounts the Personal Root only. No `Everyone` mount, no `Shared with me`
collection, no cross-root MOVE over DAV. 009 §7 now describes the UI move
only. Reason: keep DAV simple. Recorded as an amendment on 009.

### Handed off

- `Drive Disk Settings.quota` and `Drive Settings.quota` migration,
  reservation re-key, `used_bytes` backfill -> Migration mapping (011).
- The quota section; the WebDAV section shrinks to one mount -> Draft the
  spec (013).
- Usage endpoint, set-quota and purge-archived-root admin endpoints, the
  over-quota error shape -> HTTP API surface (014).
- Glossary: **Quota**, **Usage**, **Reservation**; **Owner** no longer
  carries the charge; DAV relationship lines and the mount-name ambiguity
  (`suite/drive/CONTEXT.md`).
