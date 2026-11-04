---
status: accepted
---

# A Suite Admin administers Drive but reads and edits only through grants

Until now a Suite Admin held Manage at every Drive node without a grant. Manage
contains every lower role, so an admin could also read, comment on, and edit
any document on the site. In user testing (R2-T1-14, R2-T2-18), Maya, a Suite
Admin with a Comment grant on Sofia's sheet, inserted a column, and both saves
were accepted. Neither user was told that the admin override was in effect.

Decision: the Suite Admin override covers administration only. It answers a
check that needs Manage, and no check below Manage. Reading, commenting,
uploading, and editing content need a real grant, the same as for anyone else.
This follows Google Workspace: a super admin manages sharing and ownership but
does not open users' files in the editors.

`suite.drive._core.access.holds_without_grant(need, principals)` is the only
place that applies this rule. `check`, `require`, `require_from_rows`, and the
`can_manage` flag in the access description all call it.

## What an admin keeps, without a grant

| Area | Operations |
|---|---|
| Sharing | List and explain a node's grants. Add, change, deny, and revoke grants. Create, rotate, and revoke Share Links. Publish. The root-node guardrails still apply to admins. |
| Recovery | Restore a node that someone else trashed. |
| Deleting for good | Purge a node, empty a root's trash, delete a Version. |
| Offboarding | Archive a Personal Root. Preview and run the transfer of a disabled user's retained content to any destination folder. |
| Storage | Set a root's quota, read any root's usage and breakdown, list Archived Roots, purge an Archived Root. |
| WebDAV | Release a lock that another user holds. |

The offboarding, storage, and WebDAV operations were already gated on
`is_admin` directly, not through a role. They do not change.

## What an admin loses, unless a grant gives it

| Role | Operations |
|---|---|
| Read | Open, list, search, download, export, preview. Read Versions and comments. |
| Comment | Start, reply to, and resolve a comment thread. |
| Upload | Create or upload into a folder. |
| Edit | Save a Writer, Sheets, or Slides body. Rename, move, trash, and replace. Take, label, and restore Versions. |

### Why reading needs a grant too

- A Personal Root is private until its user shares it. With a read override,
  every admin could read every private file silently, because a read records
  no Activity.
- Admins do not need to read content to administer it. Sharing, purge, and
  storage work on node metadata. Offboarding moves content without opening it.
- The admin can still get access when it is necessary: they grant themselves a
  role. That is a grant change, so the record shows who did it and when. So
  access to private content is a deliberate, recorded action, not a side
  effect of having the admin role. This rule does not protect against a
  malicious admin. It makes their access visible.

## Consequences

- Editors show an admin their real role. With a Comment grant, Sheets, Writer,
  and Slides open in comment mode and the server refuses saves. The Share
  button stays, because the access description reports `can_manage: true`.
- An admin with no grant gets 404 when they open a private node. The admin
  dashboard's Users and Storage tools still work.
- Restore needs Edit from the person who trashed the node, and Manage from
  anyone else. Before, everyone needed Edit, and Manage as well if they were not
  the person who trashed it. For non-admins the result is the same.
- When a restore must choose a new parent, the restorer still needs Upload
  there. An admin with no grant in that root cannot choose a new parent. This
  case is uncommon, and we do not handle it now.
- The `Administrator` account and Drive's own workflows (`Principals.is_system`)
  keep every right. Install, patches, scheduled jobs, the media sweep, and the
  expired-trash purge run as that account. It is the site's system account, not
  a member of the team. The offboarding transfer runs with this authority after
  its admin check, and records the admin as the actor.
- Admins now get the creator grant and the mover grant like other users. The
  patch `grant_admin_creators_edit` adds the Edit grant for nodes that current
  admins created without a link, when the parent gives them less than Edit. It
  does not add grants for moves that admins made in the past.
- `explain` reports an admin subject's real grants. Its `site admin` source is
  now `system`, and only the `Administrator` account gets it.

## Rejected

- **Keep a read override.** This is simpler, but it keeps silent access to
  private files. This decision exists to remove that access.
- **An "acting as admin" mode on the request.** It adds state to every request
  and a second way to reach the same right. Manage is already the right that
  administration needs.
- **`$ROLE:Suite Admin` grant rows.** These were already rejected in the Drive
  spec §4.9: a row per root that must always exist means an outage whenever a
  row is missing.
