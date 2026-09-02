---
id: 007
title: Publishing capability
label: wayfinder:grilling
status: closed
assignee: faris
blocked-by: [002]
---

## Question

Slides force-inserts an anyone-with-link permission row on every save of a
composite deck, bypassing the grant ceiling, because the saver may lack
share rights. Decide how programmatic publishing works in the new model:
publish is MANAGE-only, or a distinct app-granted capability, or an
explicit SDK call with its own permission rule. Include unpublish and the
audit trail.

Red-team walkthrough: scenario S7. Blocked by Role ladder semantics.

## Resolution

Decided with Faris, 2026-09-03. Seven decisions.

### 1. Published is a grant to `$PUBLIC`

One new principal, `$PUBLIC`. Every session holds it, Guest included, so a
signed-in user's principal list is email, groups, `$GENERAL`, `$PUBLIC`,
and a guest's list is `$PUBLIC` plus whatever links 008 adds. A published
node is one `Drive Grant` row `(node, $PUBLIC, READ)`. Nearest-wins, deny,
`explain()`, and the audit path apply unchanged. No node flag, no second
table.

`$PUBLIC` has no unlock state, so the flat-`$LINK` bypass from the design
doc cannot recur: matching everyone is its definition, not a leak.

Rejected: publish as a READ link (stable public URLs such as a composite
deck's slug must then carry a token); a `published` column on Drive Node (a
second permission truth the engine must OR in and deny cannot cut).

### 2. `$PUBLIC` caps at READ

Published means the world may read. Anonymous comment, upload, or edit
goes through a `$LINK:<token>` grant (008), which has password, expiry,
and rotation. The grant path refuses `$PUBLIC` above READ.

Consequence: Writer's shipped anonymous comments (`Guest` author over an
empty-user row, `suite/writer/api/docs.py:121`) need a link, not the plain
URL. Handed to 008.

### 3. MANAGE publishes; no capability, no bypass

Publishing is a grant, so it needs MANAGE at the node like any grant.
There is no app-declared publish capability and no SDK path that skips the
check. `publish(node)` and `unpublish(node)` may exist as sugar over
grant and revoke with principal `$PUBLIC`; they raise without MANAGE.

The Slides `on_update` force-insert
(`suite/slides/doctype/presentation/presentation.py:47-59`) is deleted.

Stated consequence: in the Shared Root (`$GENERAL` UPLOAD), a contributor
holds the creator's EDIT on a deck they made and cannot publish it. In a
Personal Root the user holds MANAGE and can. Rejected: EDIT-may-publish (a
second rule in the ladder for one principal).

### 4. Composite decks lose the always-public invariant

A composite deck is an ordinary deck. Rendering it for a viewer does one
READ point check per referenced deck against that viewer's principals and
skips what they cannot read. A private composite of private decks works
for a team; a published composite shows guests only its published
references. Slides `validate()` stops demanding public references
(`presentation.py:35-40`). The invariant existed only because guest media
serving could not reason per reference; with media as nodes (012) it has
no reason left.

### 5. `$PUBLIC` inherits; invalid on a Drive Root

A `$PUBLIC` grant on a folder publishes everything below it. A `$PUBLIC`
deny nearer the node wins, as for any principal. One guardrail: a
`$PUBLIC` grant naming a Drive Root is invalid for everyone, Suite Admin
included. Nothing legitimate needs a root-wide publish, and it is the
worst-case leak. Publishing a folder under the root is the supported way
to publish many nodes.

### 6. Unpublish = revoke, or deny when inherited

Unpublish deletes the node's own `$PUBLIC` grant. If READ still reaches
`$PUBLIC` from a folder above, it writes a `$PUBLIC` deny on the node
instead, mirroring today's `unshare` (`suite/drive/overrides/file.py:246`).
Needs MANAGE. Nothing is notified: composites re-check on every render,
signed `/f/` URLs already minted expire on their own short clock, and no
app hook exists. Rejected: refusing unpublish under a published folder;
a publish/unpublish hook in the Content Type declaration.

### 7. One activity row per grant write, no publish verb

Every insert, update, or delete of a `Drive Grant` writes one activity
row: node, actor (the session user), principal, old role, new role,
timestamp, and for links the expiry and a password-set flag. Publish and
unpublish are grant writes whose principal is `$PUBLIC`; the UI labels
them. Programmatic writes record the real session user. There is no
system actor because no path skips the check. Activity rows survive grant
deletion and node trash and go on purge.

Today `share()` and `unshare()` write no activity row at all; only
create, move, rename, and WebDAV edit do
(`suite/drive/overrides/file.py:117,329,372`, `webdav/put.py:243`), even
though `Drive Entity Activity Log` declares `share_add`, `share_edit`, and
`share_remove` types.

### Handed off

- Guest principal list, Writer anonymous comments over links -> Link
  sharing semantics (008).
- Empty-user rows (READ -> `$PUBLIC`; higher flags -> plus a
  `$LINK:<token>` row; deny -> `$PUBLIC` deny; rows on a root dropped)
  -> Migration mapping (011).
- Composite render authorizes media through each reference's own node;
  Slides templates as nodes with a `$GENERAL` READ grant -> Slides media
  to nodes (012).
- Publish/unpublish as the grant endpoints with `$PUBLIC`; refusals for
  `$PUBLIC` above READ and on a root; activity endpoint shape -> HTTP API
  surface (014).
- The activity row schema and the revoke-or-deny rule for every principal
  -> Draft the spec (013).
- Glossary updated: **Public**, **Published**, Principal line, seven
  relationship lines, one flagged ambiguity (`suite/drive/CONTEXT.md`).
