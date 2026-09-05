---
id: 013
title: Draft the spec
label: wayfinder:task
status: closed
assignee: faris
blocked-by: [001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 014]
---

## Question

The destination ticket. Write `drive-layer-spec.md` (and a companion plan
if the storage_v2 pattern is followed): doctypes with frozen schemas and
indexes, the permission engine with its exact queries, the content SDK
(ContentTypeSpec + mixin), HTTP API, WebDAV mapping, framework-side
storage_v2 asks stated precisely, and the migration section. Inputs: every
closed ticket on this map plus the decided architecture in
`drive-file-layer-designs.md`. Blocked by all other tickets.

Handed from [Link sharing semantics](008-link-sharing-semantics.md)
(2026-09-03): the engine's two-pass resolution (own principals with
nearest-wins and tie-break email > group > `$GENERAL`, deny final; else
max with nearest-wins over `$PUBLIC` and `$LINK:*`, ties take the highest
role); the `X-Drive-Links` header grammar (`token` or `token.ticket`,
comma-separated); the unlock ticket
(`exp + "." + HMAC-SHA256(site_secret, token|password_hash|exp)`, 30
days); the per-token unlock rate limit; `via_link` on the activity row;
`expires_on` on every grant and `password_hash` refused off links; the
daily sweep of expired link grants; the collab server re-check interval
(five minutes suggested) and the connection token shape (sid plus link
tokens).

Handed from [WebDAV mapping](009-webdav-mapping.md) (2026-09-03): the
WebDAV section takes the method-role table, the three mounts and the
Shared-with-me grant-root query with its collision suffix, the export
naming and collision rules for documents, the empty-head no-version rule
(applies to every replace path), the `content_modified` column, and one
framework ask: Range on non-local drivers through the public stream-read.

Handed from [Quota policy](010-quota-policy.md) (2026-09-03): a Quota
section with the charge rule (logical, per reference), what counts (Active
and Trashed nodes, versions, reservations) and what is free (previews,
exports, bodies), `Drive Root.used_bytes` with the conditional admission
UPDATE and the daily recompute, the two-stage browser preflight, the
configuration fields (`quota_bytes` 0 = inherit; `default_personal_quota`,
`shared_quota`), the archived-root rule (pays for itself, admin purge
only), the UI cross-root move rebill, and the DAV quota properties. The
WebDAV section shrinks to one mount, the Personal Root: drop the
three-mount list, the Shared-with-me grant-root query and its collision
suffix, and the cross-root MOVE paragraph (the method-role table stays).

Handed from [Migration mapping](011-migration-mapping.md) (2026-09-04):
the migration section is the ticket's fourteen decisions and report, as
two patches (additive Build, Cleanup one release later, gated on node
coverage and GC reference discovery). Build's S3 step copies Drive's
objects into the framework layout, and the section must state the
site_config precondition (`storage_driver = s3`,
`storage_driver_config`). Node and root ids equal the File names. New
schemas to freeze: `Drive Activity` (node, action, actor, at, via_link,
client, detail JSON), `Drive Recent` (user, node, opened_at; unique),
`Drive Favourite` (user, node; unique), `Drive Notification` (activity,
to_user, read), and the comment thread and comment tables with the opaque
anchor (Writer: comment id; Sheets: sheet plus cell id). Every one links
`node` and is deleted on purge. `Drive Entity Log` is renamed to
`Drive Recent` pre-model-sync; `Drive Entity Activity Log`, `Drive Token`,
and `Drive Permission` are dropped in Cleanup.

Amended by [Migration mapping](011-migration-mapping.md) (2026-09-04): the
framework asks gain a fifth item, `relocate_blobs()`, a public resumable
job that moves every File Blob to the configured driver (copy bytes,
rewrite `driver` and `key` under the GC's row lock, delete old bytes after
commit). The migration section states that it runs after Build to reach
one storage location, and that Build and Cleanup do not depend on it.

Handed from [Slides media to nodes](012-slides-media-to-nodes.md)
(2026-09-04): a content document node may hold child nodes and is always a
leaf in every listing, so no listing descends into one. `Drive Node` gains
`is_template`; a template is a readable flagged node, its permission is its
grant, and shipped templates are Administrator-owned nodes with a `$GENERAL`
READ grant. The content app contract gains one declaration, "list the nodes
you still use"; Drive owns the sweep that trashes unused child nodes after a
grace period, and Writer's embeds ride it. The preview push owes no `touch`.
A duplicate copies the source's preview row. Media serving is the preview
pattern: one Read check on the document, then short-TTL signed `/f/` URLs
the page refreshes; no Python in the byte path. This changes Writer as much
as Slides: the `Writer Template` doctype and its two permission functions go.

## Resolution

Resolved 2026-09-05. Two documents, beside this map:

- [`drive-layer-spec.md`](../drive-layer-spec.md): fourteen sections in
  the order the ticket asked for. Every doctype is a field table with its
  index set. The permission engine is exact Python and SQL. The content
  SDK is a typed `ContentTypeSpec` dataclass, the `DriveContent` mixin,
  and worked declarations for Writer, Slides, and Sheets. The HTTP API is
  a full route table with the translator, the six error classes, the
  cursor, the node shape, the batch shape, and the shim plan for the 69
  old methods. WebDAV is one mount. The framework asks are seven
  signatures with tests. The migration section is Build and Cleanup as
  [Migration mapping](011-migration-mapping.md) decided, plus the
  [Slides media to nodes](012-slides-media-to-nodes.md) rows. One
  `Fixed numbers` table at the end holds every number the spec chose.
- [`drive-layer-plan.md`](../drive-layer-plan.md): the companion plan in
  the storage_v2 shape. Target bench and branches, test commands, a file
  map with one owner per file, 25 behaviour anchors, nine stages from
  the framework asks to the Cleanup patch, and the rules for agents.

Two Opus agents wrote the halves of the spec from the fourteen tickets,
the architecture decision, the storage_v2 spec, and the code on
`forge/storage-v2`. A third agent audited every ticket's decisions and
handoffs against the draft, joined the seams, and checked 103 code
references (14 corrected). A fourth agent wrote the plan and verified
the bench facts.

### Choices the map did not decide

Each is a `> Spec pick:` line in the spec, and the plan lists it under
Deviations with the stage before which it must be confirmed.

- `Drive Node.path` is `Data(500)`; `(root, path)` fits one InnoDB key.
- A `(root, parent, state, title)` index serves the root-level page,
  which [Index benchmark parent-state-title](004-index-benchmark-parent-state-title.md)
  did not measure.
- `Drive Grant.node` and `Drive Activity.node` are `Data`, because a
  grant may name a `Drive Root` or a `Drive Node`.
- Activity verbs split today's `delete` into `trash`, `restore`,
  `delete`. Build infers the verb for old rows from the File status at
  map time and marks them `detail.migrated`.
- `X-Drive-Links` accepts at most 20 tokens per request.
- Two own-principal rows at one depth in one tier resolve to the lower
  role.
- Malformed grant arguments raise `frappe.ValidationError` (400), not a
  Drive class.
- The daily expiry sweep deletes link grants only.
- Restore reparents to the nearest Active ancestor when the chain is
  gone.
- Writer's default export is `html`; Slides and Sheets declare none, so
  they stay invisible over WebDAV.
- `explain` rides on `GET /nodes/<id>/grants?principal=`.
- `revoke_or_deny` is the SDK name for "unpublish = revoke, or deny when
  inherited", generalised to every principal per
  [Publishing capability](007-publishing-capability.md).

### New framework ask, not raised by any ticket

Ask 7 in §13: `frappe.storage.upload.create_upload` refuses mime types
outside the legacy allow-list for users without desk access, and
`check_upload_permission` refuses Guest unless site-wide guest uploads
are on. Both gates break Drive uploads and UPLOAD links for guests. The
spec asks for a keyword to bypass them and marks the ask a blocker. It
needs Faris's sign-off before it lands on `forge/storage-v2`.

### Not verified

The spec was checked against tickets and code, not against a running
site. No query in it has been executed on this bench beyond the [004]
benchmark. The plan's stage 6 wants a Build run on a copy of a real site
export, which needs a scratch site and Faris's approval.
