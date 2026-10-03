# File navigation naming benchmark

## Result

The products distinguish durable storage locations from sharing-derived
views, even when both use the word "shared." Google Drive is the clearest
example: **Shared drives** are organization-owned storage locations, while
**Shared with me** is a view of direct grants. OneDrive makes the latter
distinction explicit by saying its **Shared** view is not a folder. Dropbox
uses **Team space** and **team folders** for durable organization content,
then reserves **Shared** for an aggregate sharing view. Box avoids the split
by merging owned and collaborated content into **Files** and marking
provenance with folder icons.

Suite should not copy Google's **Shared drives** label literally. Google has
many independently named shared drives; Suite has exactly one active
site-wide Shared Root on a business site. The recommended vocabulary is:

| Meaning | Navigation label | Canonical route |
| --- | --- | --- |
| The current user's Personal Root | **My files** | `/files` |
| The business site's single Shared Root | **Organization files** | `/files/organization` |
| Direct grants outside the Personal Root | **Shared with me** | `/files/shared-with-me` |

This gives each destination a different semantic head: **my** identifies
personal ownership, **organization** identifies durable site ownership, and
**with me** identifies an access relationship. The last destination must be
implemented and described as a view, not as a third root.

## Scope and method

This benchmark covers Google Drive, Dropbox, Microsoft OneDrive, and Box.
It compares:

- the user's own file root;
- durable organization or team content;
- items shared directly with the user; and
- visible first-party web paths where they could be established.

Product vocabulary comes only from first-party help or developer
documentation. URL observations are reported separately because a path that
works in the product does not necessarily constitute a documented routing
contract. All sources and product paths were accessed on **2026-09-11**.
Where a source displayed an update date, that date is recorded below.

The Suite comparison assumes these invariants:

- every user has one Personal Root;
- a business site has exactly one active site-wide Shared Root; and
- direct grants outside the Personal Root produce the `shared` view rather
  than another root.

## Documented UI and domain vocabulary

### Google Drive

Google uses three deliberately separate concepts:

| Concept | Google term | Documented behavior |
| --- | --- | --- |
| User-owned root | **My Drive** | Each user has a root folder called My Drive; the user owns its hierarchy. |
| Team or organization storage | **Shared drives** | Each shared drive is a storage location parallel to My Drive; its content is owned by a team or organization. |
| Direct-grant view | **Shared with me** | Shows files and folders shared with the user, including opened link-shared files; users can add shortcuts into My Drive or another drive to organize them. |

Google's [files and folders overview](https://developers.google.com/workspace/drive/api/guides/about-files)
defines My Drive as a per-user root and a shared drive as a parallel
organizational structure. It also distinguishes one shared drive through a
`driveId` while classifying directly shared items as "Shared with me."
The page was last updated **2026-04-20 UTC**.

The [shared drives overview](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)
says a shared drive lives parallel to My Drive and holds organization-owned
content. A user may belong to multiple shared drives, and access can come
from membership in a drive or from a grant on only part of its contents. The
page was last updated **2026-08-31 UTC**.

The [Google Drive API overview](https://developers.google.com/workspace/drive/api/guides/about-sdk)
likewise defines My Drive as a user-owned storage location and a shared drive
as a collaborative storage location. It was last updated **2026-09-03 UTC**.

Google's [Shared with me help](https://support.google.com/drive/answer/2375057)
describes a recency-oriented view containing directly shared files and
folders plus link-shared files the user has opened. It tells users to add
shortcuts elsewhere when they want to organize those items. Google's
[shared-drive access guide](https://support.google.com/a/users/answer/12380484)
also says a folder inside a shared drive can appear in **Shared with me** when
it is granted directly to a non-member. Neither Help Center page displayed a
publication or update date.

The important naming lesson is grammatical. **Shared drives** is a plural
noun naming durable containers. **Shared with me** is a passive phrase naming
the user's relationship to items. They are semantically separate despite
sharing an adjective.

### Dropbox

Dropbox's current team-space model puts personal and team content into one
overall structure:

| Concept | Dropbox term | Documented behavior |
| --- | --- | --- |
| Main/root namespace | **All files** | Opens the root and contains the files and folders added to the account. |
| Overall business structure | **Team space** | Contains both personal folders and team folders in a structure shared across the team. |
| Durable collaboration units | **Team folders** | Ongoing group or organization content with centrally managed membership and permissions. |
| Sharing view | **Shared** | Aggregates content shared with the user and content the user shared with others. |

The [team space overview](https://help.dropbox.com/organize/team-space-overview)
says the team space contains a private personal folder and accessible team
folders, and that top-level folders appear under **All files**. It was updated
**2025-07-16**.

The [Dropbox website guide](https://help.dropbox.com/installs/homepage)
calls **All files** the root folder and describes **Shared** as quick access
to both inbound and outbound shared content. It was updated **2025-04-17**.

Dropbox distinguishes durable and ad hoc collaboration by noun rather than
by direction. Its [shared-folder FAQ](https://help.dropbox.com/share/shared-folder-faq)
says **team folders** suit ongoing organization collaboration, while
**shared folders** suit simple or short-term collaboration. It was updated
**2026-08-13**. The [join-a-shared-folder guide](https://help.dropbox.com/share/add-shared-folder)
shows invitations being accepted from the **Shared** page and says an
accepted shared folder is added to the account. It was updated
**2024-09-17**.

Dropbox's model is useful evidence for **organization/team** vocabulary, but
its **All files** root is not analogous to Suite's separate Personal Root and
Shared Root destinations.

### Microsoft OneDrive

OneDrive separates private storage, direct grants, and SharePoint/Teams
locations:

| Concept | Microsoft term | Documented behavior |
| --- | --- | --- |
| User file area | **Files** / **My files** | The home base for a user's own files and folders. |
| Sharing area | **Shared**, then **Shared with you** | A view of items stored in other owners' OneDrive locations; it is explicitly not a folder. |
| Organization/team locations | **Shared libraries**, **Quick access**, **Your Teams** | Destinations backed by recently used SharePoint libraries, channels, folders, and Teams membership. |

Microsoft's [OneDrive setup guide](https://support.microsoft.com/en-us/onedrive/small-business/set-up-onedrive-included-with-microsoft-365)
calls **Files** the home base, uses **My Files** in its upload steps, defines
**Shared** as inbound and outbound shared items, and describes **Shared
libraries** as content from recently visited Teams and SharePoint sites. It
displayed no publication or update date.

The [Shared view guide](https://support.microsoft.com/en-us/onedrive/see-files-shared-with-you-in-onedrive)
uses the work/school navigation sequence **Shared > Shared with you**. It
explicitly says the Shared view is not a separate folder, and directs users
to add a shortcut to **My files** when they want a shared folder in their
personal hierarchy. It displayed no publication or update date.

The [Quick access guide](https://support.microsoft.com/en-us/onedrive/getting-started-with-quick-access)
describes recently used shared libraries, channels, and folders and lists
document libraries and **Your Teams** as organization destinations. It
displayed no publication or update date.

OneDrive supplies strong evidence for describing direct grants as a view,
but its organization model has many SharePoint and Teams locations rather
than Suite's one site-wide root.

### Box

Box largely removes the top-level naming problem:

| Concept | Box term | Documented behavior |
| --- | --- | --- |
| Main namespace | **Files** / Files page | Contains every folder and file the user can access, whether owned or received through collaboration. |
| Provenance | Folder icon variants | Personal, enterprise-collaborated, and external-collaborated folders use different icons. |
| Organization structure | Root-level folders | Admins may own and control root-level folders; invited folders can become a user's effective roots. |

The [Box user basics guide](https://support.box.com/hc/en-us/articles/20727423579155-Getting-Started-Box-User-Basics)
says the Files page contains everything the user can access. It differentiates
personal, enterprise-collaborated, and external-collaborated folders by icon,
and says an invited item appears directly on the recipient's Files page. The
page displayed only "Posted Updated," without dates.

Box's [folder-structure guide](https://support.box.com/hc/en-us/articles/360043695494-Plan-Your-Folder-Structure)
describes open and admin-owned root taxonomies. It notes that each user's
Files page differs according to owned and invited folders, and that the level
where a user is invited may appear as that user's root. The page displayed
only "Posted Updated," without dates.

The [Box folder API reference](https://developer.box.com/reference/get-folders-id-items)
documents the web path form `/folder/<id>` and says a Box account's root is
always folder ID `0`. It was last modified **2026-01-23**.

Box is therefore the counterexample: ownership and collaboration can be
combined in one navigable namespace if provenance is always visible. That
does not match Suite's invariant of two explicit roots plus a sharing view.

## Observed first-party web paths

These paths were observed against the products' first-party web
applications on 2026-09-11. They describe current behavior, not promised API
contracts.

| Product | Destination | Observed path | Confidence and qualification |
| --- | --- | --- | --- |
| Google Drive | My Drive | `/drive/my-drive` | Recognized by `drive.google.com`; signed-in multi-account sessions may insert `/u/<index>/`. |
| Google Drive | Shared drives index | `/drive/shared-drives` | Recognized by `drive.google.com`; the destination is an index of multiple drives. |
| Google Drive | Shared with me | `/drive/shared-with-me` | Recognized by `drive.google.com`; the account-index variant is also used. |
| Dropbox | Main Files experience | `/home` | Recognized by `dropbox.com`; the UI label is **All files**, so route and label differ. |
| Dropbox | Sharing view | `/share` | Recognized by `dropbox.com`; `/shared` returned not found. |
| OneDrive | File and sharing destinations | No stable friendly path established | Microsoft documentation establishes labels but not a tenant-independent route grammar. |
| Box | Root folder | `/folder/0` | Recognized in the first-party Box web app; the same `/folder/<id>` form and root ID `0` are documented in the Box API reference. |

The observed paths do not reveal a cross-product convention. Google mirrors
its labels closely, Dropbox uses an implementation-oriented singular route,
OneDrive's shell varies by account and tenant, and Box exposes the root's
special identifier. Route vocabulary should therefore follow Suite's domain
model rather than imitate a competitor's path.

## Comparison

| Product | Personal/root vocabulary | Durable organization vocabulary | Direct-grant vocabulary | Structural match for Suite |
| --- | --- | --- | --- | --- |
| Google Drive | My Drive | Shared drives | Shared with me | Medium: clean separation, but many shared drives |
| Dropbox | All files / personal folder | Team space / team folders | Shared | Low: one merged top-level structure |
| OneDrive | Files / My files | Shared libraries / Quick access / Your Teams | Shared with you | Medium: clean separation, but many libraries |
| Box | Files | Root-level administered folders | Merged into Files | Low: accessible content is one namespace |
| Suite | Personal Root | One site-wide Shared Root | `shared` view | Unique combination |

Three conclusions are consistent across the closest comparators:

1. Durable organization storage deserves a container noun such as
   **drive**, **team space**, **team folder**, or **library**.
2. Directly granted content is best presented as a view or access
   relationship, not as another owned root.
3. Similar labels become especially confusing when the durable side is a
   single root. Google's plural **Shared drives** provides context that
   Suite's singular **Shared** cannot.

## Suite naming options

| Option | Personal Root | Shared Root | Direct-grant view | Assessment |
| --- | --- | --- | --- | --- |
| **A — ownership-first** | My files `/files` | Organization files `/files/organization` | Shared with me `/files/shared-with-me` | **Recommended.** Exact for Suite's one business-wide root and clear at a glance. |
| B — Google-like | My files `/files` | Shared drive `/files/shared-drive` | Shared with me `/files/shared-with-me` | Familiar, but singular **shared drive** remains close to **shared with me** and imports Google product language. |
| C — Dropbox-like | My files `/files` | Team files `/files/team` | Shared `/files/shared` | Short, but **team** implies a subset of the site and **Shared** does not say inbound, outbound, or both. |
| D — directional | My files `/files` | Organization files `/files/organization` | Received `/files/received` | Maximally distinct, but **Received** is unfamiliar for live access grants and sounds like a transfer or inbox. |

Choose option A. **Organization files** states who owns and governs the
durable root without colliding with sharing language. **Shared with me** keeps
the most familiar industry phrase for an access-derived view. The route
grammar stays memorable, and the two exceptional destinations cannot be
mistaken for aliases:

```text
/files
├── /files/organization      one durable site-owned root
└── /files/shared-with-me    a computed direct-grant view
```

On personal sites, omit **Organization files** and `/files/organization`;
the naming of the remaining destinations does not need to change.
