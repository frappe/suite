---
id: 001
title: Shared spaces and offboarding model
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: []
---

## Question

Suite has per-user roots and no team doctype, so a shared space is a
folder under one person's root. Decide: does that stay? If yes, define
ownership transfer (offboarding): what gets rewritten (node owner by path
prefix, grant owner), the job shape (chunked, resumable, per-root lock),
and what happens to quota. If no, define the alternative root model now,
because it reshapes the Drive Node and Drive Grant doctypes.

Red-team walkthrough: scenario S1 in the design doc's red-team round.

## Resolution

The per-user-root shape does not stay. A `Drive Root` doctype replaces the two
pinned `File` rows.

### Root model

`Drive Root` fields: own id (never the email), `user` (Link to User, Personal
only), `kind` (Personal | Shared), `state` (Active | Archived), `quota_bytes`,
`acl_generation`.

- Business site: one Shared root plus one Personal root per user.
- Personal site: Personal roots only. No Shared row.
- Shared root: `owner = Administrator`, carries the `$GENERAL` grant. Same
  recipe as today's `Drive` root (`suite/drive/utils/__init__.py:178`).
- Personal root: `owner` is the user. Private, owner grant only.
- `Drive Node.root` links a root. `Drive Node.path` is root-relative.
- `kind` and `state` are separate fields. An archived home is still a Personal
  root, so "one active shared root per site" stays checkable as
  `kind = Shared AND state = Active`.

Many shared spaces (a `Space` kind, per-space quota and membership) is out.
It rebuilds the Drive Team model that `suite/drive/patches/remove_teams.py`
dissolved, and neither deployment model needs it. A third `kind` is a Select
option if that ever changes.

The tree is a logical namespace only. storage_v2 keys blobs by sha256
(`frappe-file-storage-v2-spec.md:67`), so no root or path maps to storage.
Every cost below is database work.

### Owner is not a permission

Drop the owner short-circuit at `suite/drive/webdav/perms.py:42` and
`suite/drive/api/permissions.py:54`. It returns ALL_ACCESS and overrides deny,
which contradicts nearest-wins. `grant_owner_access`
(`suite/drive/utils/__init__.py:371`) already stores ownership as an ordinary
grant row; that becomes the only mechanism.

Owner is accounting and audit only. All access comes from grants.

Known gap: a user holding `upload` but not `read` on a folder can no longer
see their own upload. Routed to Role ladder semantics.

### Offboarding

Set `state = Archived` on the leaver's Personal root. One field. That is the
whole operation.

- No node is written. No path rewrite, no owner rewrite, no chunked job, no
  per-root lock.
- `owner` stays the leaver's email as the audit fact. It grants nothing,
  because the short-circuit is gone.
- No grant changes. Everyone the leaver shared with keeps the access they had.
- Content the leaver never shared is reachable by Suite Admins only, through
  the existing `is_drive_admin` bypass
  (`suite/drive/api/permissions.py:31`).
- Archived roots appear in no folder listing. They surface in their own view:
  archived roots where the caller holds a grant inside. This is a root-level
  query, not a special case inside folder listing.
- Identical on both deployment models, because archiving needs no destination.
- `Drive Root` is keyed on its own id, so recreating a deleted email gives a
  fresh Personal root instead of reviving the archived one.

Rejected: moving the leaver's content to `Shared/Former Users/<email>`. It
reaches the same visibility, and it costs an O(nodes) resumable job, a
per-root lock, and a mandatory `$GENERAL` deny on the container
(`_deny_general_read`, `suite/drive/utils/__init__.py:290`) to stop private
files becoming site-readable.

### Left open, routed elsewhere

- Who is charged for archived bytes, and whether archived roots are ever
  reclaimed -> Quota policy (010).
- Whether the `Suite Admin` ALL_ACCESS bypass survives -> Role ladder
  semantics (002).
- `upload` without `read` -> Role ladder semantics (002).
- The archived-roots query as an HTTP endpoint -> HTTP API surface, still in
  Not yet specified.
