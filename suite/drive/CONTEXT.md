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

### Access

**Grant**:
A row that gives or refuses a set of rights to one principal at one node, and
applies to everything below it.
_Avoid_: Permission, ACL, Share, Rule

**Principal**:
Whoever a grant names: a user, a user group, any signed-in user, or a share
link.
_Avoid_: User, Member, Recipient

**Deny**:
A grant that refuses rights rather than giving them.
_Avoid_: Block, Revoke, Remove access

**Owner**:
The party a node's or a root's bytes are counted against, and the record of
who put it there. An owner holds no access by being one.
_Avoid_: Creator, Admin, Manager

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
- A business site has exactly one active **Shared Root**. A personal site has
  none.
- Every user has at most one **Personal Root**.
- The **Shared Root** is owned by Administrator and reached through a grant to
  any signed-in user, so no person's departure affects it.
- A **Personal Root** carries a grant to its own user only. It is private
  until its user grants further.
- Access comes only from **Grants**. Being the **Owner** grants nothing.
- The **Grant** nearest a node on its path decides a right. A **Deny** nearer
  than a grant refuses the right.
- A **Grant** on a **Drive Root** reaches every node in that root.
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
- "Home" and "Everyone" are the labels WebDAV mounts show for the **Personal
  Root** and the **Shared Root**. They are display names, not domain terms.
