# Draw

Draw owns a drawing's scene. Drive owns its identity, title, location, grants,
lifecycle, and versions after adoption.

## Language

- **Drawing**: The content document that stores one scene.
- **Scene**: The JSON body with `rectangles` and `lines`. Rectangle entries also
  include ellipses, diamonds, text, embedded images, and freehand strokes.
- **Node**: The Drive Node linked through `Drawing.node`. Use Drive's vocabulary
  from `suite/drive/CONTEXT.md` for grants, roles, versions, and lifecycle.

## Adoption status

This branch registers `SPEC` and applies Drive's point and list permission hooks
to Drawing. `suite.drive.patches.adopt_drawings` runs between Drive Build and
Cleanup. It binds existing drawings before registry validation. The current
development site has not run these changes.

The migration preserves drawing names, bodies, owners, timestamps, and legacy
titles. The new node has the same name as the Drawing. It lives in the owner's
personal root. Duplicate sibling titles use Drive's numbered suffixes. Invalid
owners, conflicting identities, and ambiguous shares stop adoption. They do not
cause drawings to be skipped or deleted.

Existing System Managers receive Manage grants on the legacy drawings they could
previously administer. These grants capture access at migration time. Later role
changes do not remove or add those grants. New drawings follow Drive's normal
grant rules. No user is promoted to Suite Admin.

Anonymous sharing is not enabled in this step. Drawing's baseline permissions
remain for authenticated users, narrowed by Drive's grants.

Existing DocShares become Drive grants. Their full rows are journaled under the
site's private directory before removal. Adoption does not commit. A failure
rolls the patch back, and completed links are verified rather than recreated on
a rerun. The legacy title column remains, frozen by `legacy_fields`. New titles
belong to Drive alone. Frappe's body change tracking is disabled in favor of
Drive versions.

Adoption belongs to the Drive migration package. Draw does not import private
Drive modules, and the runtime Drive facade does not gain a migration operation.

Before migrating a site with existing drawings, take a database and file backup.
Record its path in the `draw_adoption_backup` site config value. Suite's separate
Drive Cleanup backup requirement still applies. Keep the site in maintenance
mode during the upgrade. A fresh site with no drawings or shares needs no Draw
adoption backup marker.

## Content and lifecycle

The adapter creates empty scenes, copies bodies, and supplies version snapshots
with schema `drawing/1`. Restore validates the entire scene before saving.
Scenes are limited to 64 MiB, 10,000 objects, and 100,000 freehand points in total.
The limits refuse a write. They never truncate the saved drawing.

Images currently contain embedded data URLs. They are copied and versioned with
the scene. Draw does not declare Drive media callbacks until its scene stores
Drive media references.

Node assignment and body deletion require the adapter's internal lifecycle
context. The mixin prevents reassignment of an existing node. Linked saves
require Edit, and successful body changes touch the node. Drive callbacks join
the caller's transaction and do not commit.

## Document surface and saves

Draw registers a document surface with Suite's shared Home, Files, and document
host. It has no separate homepage. Drive owns creation, titles, sharing, and
navigation. The editor keeps its toolbar and property bar.
The `/draw/` entry redirects to Home. Existing `/draw/editor?drawing=<name>`
links open the adopted node through the document host.

Authenticated Draw routes read and save scenes by Drive node. Saves lock the
document, check Edit access, and compare the submitted revision. A stale save
returns a conflict without replacing the saved scene. Successful saves take a
Drive version in the same transaction.

Each editor keeps its unsynced draft in a separate IndexedDB record. A successful
save removes only the acknowledged draft revision. Conflicting drafts remain
available for download or a recovered copy. Recovery actions require the same
signed-in account. Unfinished text remains in recovery storage until the user
finishes editing it.

Read-only sessions hide the property bar and disable editing and history
actions. Navigation attempts to save first. If changes remain unsynced, it keeps
the recovery draft and asks before leaving.

## Manual verification after activation

Use two ordinary users and an isolated Suite site with a recorded backup.

1. Adopt an existing drawing. Verify its name, title, owner, and scene survive.
2. Create a drawing through Files. Reload it and compare its scene.
3. Copy the drawing. Verify the copy has its own identity and the same artwork.
4. Save a version, edit, and restore it. Verify only the scene changes.
5. Grant the second user Read. Verify reads succeed and body writes fail.
6. Grant Edit, then revoke it. Verify subsequent writes fail without data loss.
7. Attempt node reassignment and generic document deletion. Verify both fail.
8. Trash and restore through Files. Verify the scene survives. Purge only a
   disposable drawing and verify its body has no Deleted Document copy.

These journeys have not run. The current development Bench still serves the
original Draw checkout. Rehearse on an isolated site before upgrading that site.
