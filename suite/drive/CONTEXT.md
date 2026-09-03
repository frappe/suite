# Drive

Drive stores a site's files as a permissioned tree, and lends that tree to the
other Suite apps so their documents, decks, and sheets live in one place with
one sharing model.

This glossary describes the decided target model, charted at
[`wayfinder/drive-layer-spec/MAP.md`](../../wayfinder/drive-layer-spec/MAP.md).
Some terms name things the shipped code calls something else; those collisions
are listed under Flagged Ambiguities.

## Language

### Structure

**Drive Node**:
One entry in the tree, whether it holds bytes, holds nothing, or stands for a
document owned by another app.
_Avoid_: Entity, File, Drive File

**Drive Root**:
The top of one namespace. A node belongs to exactly one, and quota is counted
against it.
_Avoid_: Team, Space, Home folder

**Personal Root**:
The private Drive Root belonging to one user.
_Avoid_: Home, My Drive, User Folder

**Shared Root**:
The single Drive Root that every signed-in user on a business site can reach.
_Avoid_: Everyone, Team Drive, Site folder

**Archived Root**:
A Drive Root that is no longer anybody's working space, kept so its content
and its grants survive.
_Avoid_: Deleted root, Former user folder

**Path**:
A node's position inside its own root, written as its ancestor titles.
_Avoid_: File URL, Storage key, Full path

**Blob**:
Stored bytes, identified by their content, so two nodes holding the same
content hold the same blob.
_Avoid_: File, Object, Attachment

**Reference**:
A record that names a Blob. A Blob stays while any Reference names it, and
is gone a day after the last one goes.
_Avoid_: Refcount, Link, Owner of the blob

**Quota**:
The most bytes a Drive Root may hold. Zero means no limit.
_Avoid_: Storage limit, Disk space, Plan, Allowance

**Usage**:
The bytes a Drive Root is charged for now: its nodes, active or trashed,
their Versions, and its Reservations.
_Avoid_: Storage used, Size, Footprint, Total

**Reservation**:
Bytes a Drive Root has promised to something not yet stored, counted as
Usage until the bytes land or the promise is let go.
_Avoid_: Budget, Hold, Pending upload, Lock

### Access

**Grant**:
A row that gives or refuses a role to one principal at one node, and
applies to everything below it.
_Avoid_: Permission, ACL, Share, Rule

**Role**:
The one ordered right a grant carries. A higher role contains every lower
one. The roles, lowest first: Read, Comment, Upload, Edit, Manage.
_Avoid_: Permission level, Access flags, Rights

**Principal**:
Whoever a grant names: a user, a user group, any signed-in user, a Share
Link, or anyone at all. The first three are a person's own; the last two
are open to whoever arrives.
_Avoid_: User, Member, Recipient

**Share Link**:
The principal that stands for whoever holds one secret. A grant to it may
carry Read, Comment, Upload, or Edit, never Manage, may need a password,
and may end on a date.
_Avoid_: Public link, Anyone with the link, Token, Anonymous access

**Unlock**:
Proving a Share Link's password once, so the holder counts as that link
until the proof lapses or the link changes.
_Avoid_: Login, Sign in, Session, Authenticate

**Public**:
The principal that stands for anyone at all, signed in or not, with no
link. A grant to it may carry Read and nothing higher.
_Avoid_: Guest, Anonymous, Everyone, World

**Published**:
The state of a node that the Public may read. A node is published by a
grant, and stops being published when that grant is revoked or refused
nearer to the node.
_Avoid_: Public file, Shared to web, Open

**Deny**:
A grant that refuses rights rather than giving them.
_Avoid_: Block, Revoke, Remove access

**Grant Root**:
The nearest node at which a grant names one of a person's principals. The
top of one thing shared with them.
_Avoid_: Share, Shared folder, Entry point

**Owner**:
The record of who put a node there. An owner holds no access and pays no
bytes by being one; the node's Drive Root carries the charge.
_Avoid_: Creator, Admin, Manager, Payer

### Content

**Content Document**:
A document owned by another Suite app (a Writer document, a deck, a sheet)
that a Drive Node stands for. Its body lives with its app; everything about
its place, sharing, lifecycle, versions, and comments lives with Drive.
_Avoid_: Content doc, Linked doc, Backing file

**Content Type**:
What one app declares to Drive about its documents: how to create, copy,
export, version, and purge one, and which of its own records are Satellites.
_Avoid_: Kind, Integration, Plugin

**Satellite**:
A record kept by an app that belongs to one Content Document and takes its
rights from that document's node. Reading it needs Read there; changing it
needs Edit.
_Avoid_: Side table, Child, Related doctype

**Version**:
An immutable copy of a node's bytes at one moment, kept by Drive beside the
node. A Content Document gets one when its app takes one; a file gets one
when its bytes are replaced.
_Avoid_: Snapshot, Revision, History entry

**Preview**:
The one small image Drive keeps beside a node to show it in a listing. Drive
makes it from a file's bytes; an app supplies it for a Content Document.
_Avoid_: Thumbnail, Rendition, Variant, Cover

**Export**:
A Content Document turned into a file format on request, streamed to whoever
asked, and never kept.
_Avoid_: Rendition, Cache, Derived file

**Comment**:
A remark on a Content Document, kept by Drive beside the node, anchored to a
place only the owning app can read.
_Avoid_: Annotation, Note, Thread (a thread is a group of comments)

**Touch**:
The one thing an edit tells Drive: this node changed now, by this person.
_Avoid_: Sync, Save hook, Update event

**Content Time**:
When a node's content last changed, as its content says. A client may set
it to the time a file carried before upload.
_Avoid_: Modified, Last modified, mtime, Row timestamp

### Record

**Activity**:
One thing that happened to a node: what was done, by whom, and when. Written
once, never edited.
_Avoid_: Event, Log, Activity log, Audit entry

**Favourite**:
One person's mark on a node, kept for that person alone.
_Avoid_: Star, Bookmark, Pin

**Recent**:
The last time one person opened a node, kept for that person alone.
_Avoid_: History, Entity log, Last interaction

**Notification**:
One person's pointer at one Activity, with whether they have seen it. It
says nothing the Activity does not.
_Avoid_: Alert, Message, Inbox item

### Deployment

**Business site**:
A site whose users share one Shared Root alongside their Personal Roots.
_Avoid_: Team site, Tenant, Workspace

**Personal site**:
A site with Personal Roots and no Shared Root.
_Avoid_: Solo site, Single-user site

**Offboarding**:
Retiring a departed user's Personal Root into an Archived Root.
_Avoid_: Deletion, Ownership transfer, Handover

## Relationships

- A **Drive Node** belongs to exactly one **Drive Root** and has one **Path**
  within it.
- A **Path** is a name for a position, not a location. Nothing in storage
  matches it, because a **Blob** is addressed by its content.
- Renaming or moving a node rewrites its **Path** and touches no **Blob**.
- A **Drive Node** that holds bytes is a **Reference**. So is each
  **Version** and each **Preview** kept beside a node.
- Two nodes with the same bytes share one **Preview**, because a Preview
  follows the Blob it was made from.
- An **Export** is never a **Reference**. Nothing about it is stored.
- Drive never deletes bytes. It deletes a **Reference**, and the **Blob**
  follows once nothing names it.
- A business site has exactly one active **Shared Root**. A personal site has
  none.
- Every user has at most one **Personal Root**.
- The **Shared Root** is owned by Administrator and reached through a grant to
  any signed-in user, so no person's departure affects it.
- A **Personal Root** carries a grant to its own user only. It is private
  until its user grants further.
- Access comes only from **Grants**. Being the **Owner** grants nothing.
- A **Grant** carries exactly one **Role**, or is a **Deny**.
- Read sees content. Comment annotates it. Upload adds children. Edit
  changes, moves, and trashes what exists. Manage shares and deletes for
  good.
- Creating a node gives its creator an Edit **Grant** on it, unless
  something higher already reaches them there.
- The **Grant** nearest a node on its path decides a right. A **Deny** nearer
  than a grant refuses the right.
- A **Grant** on a **Drive Root** reaches every node in that root.
- A **Published** node is read by anyone. Nothing above Read ever reaches
  the **Public**; anything more for a visitor comes through a **Share
  Link**.
- A **Share Link** is a **Grant**. There is no link without one, and
  revoking the grant ends the link.
- A **Share Link** works for whoever holds it, signed in or not.
- A **Share Link** never lowers what a person already holds. It can only
  add.
- A **Deny** naming a person or a group is final. No **Share Link** below
  it lets that person back in.
- What comes in through a **Share Link** is owned by no one in particular.
  The record keeps which link it came through.
- Uploading through a **Share Link** gives the uploader no **Grant** on
  what they uploaded, because the grant would belong to every holder.
- A **Drive Root** is never reached through a **Share Link**. No one may
  grant one on a root.
- Publishing a folder publishes everything below it, until a **Deny** to the
  **Public** nearer a node stops it.
- A **Drive Root** is never **Published**. No one, Suite Admins included,
  may grant the **Public** on a root.
- Publishing needs the same right as any other **Grant**: Manage at the
  node. No app publishes on a user's behalf.
- A deck built from other decks shows a viewer only the decks that viewer
  may read. It is not **Published** by being built.
- Every change to a **Grant** leaves a record of who made it, which
  **Principal** it named, and the **Role** before and after. Publishing is
  such a change, not a separate act.
- Suite Admins reach every node on the site without a grant.
- **Offboarding** sets a **Personal Root** to archived. It writes no node and
  changes no grant.
- Everyone a departed user shared with keeps exactly the access they had,
  because their **Grants** are untouched.
- Content a departed user never shared is reachable by Suite Admins only,
  because the only grant on it names a user who is gone.
- An **Archived Root** is in no folder listing. It is reached through its own
  view, by the people holding grants inside it.
- An **Archived Root** keeps its departed **Owner** as the record of who put
  the content there.
- Recreating a deleted user's email address gives a fresh **Personal Root**,
  never the archived one.
- A **Content Document** has exactly one Drive Node, and that node has exactly
  one Content Document. Neither reference ever changes.
- A **Content Document** has no title and no trash state of its own. Its node
  holds both.
- A **Content Document** is created and copied through Drive, never by its
  app alone.
- An edit to a **Content Document** owes Drive one **Touch** and nothing
  else.
- **Versions**, **Comments**, and the **Preview** belong to the node. They go
  when the node is purged. Trashing the node keeps them.
- Replacing a file's bytes keeps the old bytes as a **Version** and replaces
  the **Preview**.
- Drive keeps every named or pinned **Version**. It thins the automatic ones
  as they age, on one ladder for every node kind.
- A **Satellite** has no rights of its own. The node decides.
- The Comment **Role** is enough to add a **Comment** or resolve a thread.
  Editing or deleting one needs Edit, or being its author.
- A **Grant Root** is where "shared with me" begins. What lies below it
  is reached through it, and never listed on its own.
- **Content Time** changes when bytes, a body, or a title change. It does
  not change when a **Grant** does.
- A WebDAV client sees only the person's **Personal Root**, under the same
  **Roles** as the web app. It holds no rights the web app lacks, and
  reaches no other root.
- Over WebDAV a **Content Document** is its **Export**, read-only. It can be
  moved, renamed, trashed, and copied there, never written.
- A **Content Document** has no children over WebDAV. Its embedded nodes
  are reached only through its app.
- A **Drive Node** that holds a **Blob**, active or trashed, adds the Blob's
  full size to its root's **Usage**. So does every **Version** beside it.
- Two nodes with the same **Blob** each pay for it. Deduplication saves the
  site, never the root.
- A **Preview**, an **Export**, and a **Content Document**'s body add nothing
  to **Usage**.
- A **Reservation** counts as **Usage** from the moment it is made.
- A write that would take **Usage** past **Quota** is refused. **Usage**
  never passes **Quota** by a write.
- Purging a node, thinning a **Version**, or releasing a **Reservation**
  lowers **Usage**. Trashing lowers nothing.
- Moving a node to another **Drive Root** moves its charge, **Versions**
  included. A **Reservation** never moves.
- Copying a node charges the destination root for the copy alone, because
  no **Version** is copied.
- A **Drive Root** with no **Quota** of its own takes the site's default for
  its kind.
- An **Archived Root** keeps its own **Quota** and **Usage**. Nobody else
  pays for it, and nothing in it is reclaimed until a Suite Admin purges the
  root.
- An **Activity** is written once and never edited. It goes when its node
  is purged.
- A **Notification** points at one **Activity** for one person. It carries
  no message of its own.
- A **Favourite** and a **Recent** are one person's own. Nobody else sees
  them, and clearing one never touches the other.
- Opening a node writes a **Recent**, never an **Activity**.

## Example Dialogue

> **Dev:** "Alice leaves. She owns 40,000 files and shared a folder with Bob.
> How much do we rewrite?"
> **Domain expert:** "One field. Her Personal Root becomes an Archived Root.
> No node moves, because a Path is relative to its own root, and no grant
> changes, because Bob's grant was never about Alice. Bob keeps his folder.
> Her private files are left to Suite Admins, since the only grant on them
> names someone who no longer exists."

## Flagged Ambiguities

- "File" meant three things: the framework doctype, an entry in the Drive
  tree, and the stored bytes. Resolved: **Drive Node** is the tree entry,
  **Blob** is the bytes, and File names only the framework doctype.
- "Kind" is used for four unrelated things: which root a namespace is, how a
  listing may treat a row, whether a node holds bytes, and a MIME filter on
  listings. Unresolved. Only the first is a **Drive Root** term; the others
  need their own words.
- "Owner" meant both the accountable party and a standing right over the
  content. Resolved: an **Owner** is accounting and audit only, and holds no
  access by being one.
- "Team" named a container of people that also owned a tree. Resolved: there
  is no team entity. A **Shared Root** holds the tree, and a user group is a
  **Principal** a grant can name.
- "Space" was used for both a person's own area and the shared one. Resolved:
  both are a **Drive Root**, distinguished as **Personal Root** and **Shared
  Root**.
- "Snapshot", "Version", and "Revision" named the same thing in three apps.
  Resolved: **Version**, kept by Drive. A Sheets snapshot in the rewrite is a
  replay shortcut inside the document body, not a **Version**.
- "Thumbnail", "rendition", and "variant" named one thing and hinted at
  more. Resolved: there is one derived image, the **Preview**. An **Export**
  is not a stored thing at all.
- "Public" meant an anonymous reader, a not-private framework File, a
  deck anyone may open, and the Slides media URL flag. Resolved: **Public**
  is a **Principal**, **Published** is the node state it produces, and the
  framework File flag is not a Drive term.
- "Token" names both the shipped single-use download capability (`Drive
  Token`) and the secret inside a **Share Link**. Resolved: the download
  capability is not a Drive term. Only a **Share Link** has a secret, and
  the glossary calls it that, not a token.
- "Home", "Everyone", and "Shared with me" were the labels of three planned
  WebDAV mounts. Resolved: WebDAV mounts the **Personal Root** alone. The
  other two labels are not used.
- "Quota" was used for the limit and for the amount used. Resolved: **Quota**
  is the limit, **Usage** is the amount. A Meet "Recording Budget" is a
  **Reservation**.
- "Log" named both a person's recents (`Drive Entity Log`) and a node's
  history (`Drive Entity Activity Log`). Resolved: a **Recent** is the
  person's, an **Activity** is the node's. "Event" is not used; the
  calendar owns that word.
