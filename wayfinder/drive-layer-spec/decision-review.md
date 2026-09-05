# Drive implementation decision review

Review started on 2026-09-05 from Faris's submitted review of the
[visual guide](explainer/remaining-decisions.html).

All twelve planning choices are now resolved. Required measurements and
implementation checks remain pending.
Acceptance of a design does not mean its implementation or verification is complete.

## Accepted

| Choice | Accepted decision | Required verification or refinement |
|---|---|---|
| Upload authority | Use a trusted internal storage path. Keep public upload checks enabled. Preserve validation and cover chunk authorization. | Cover create, chunk, and finish. Public clients cannot disable checks. Refine the draft API accordingly. |
| Conflicting group roles | At equal depth and principal tier, an explicit DENY wins. Otherwise take the highest role: READ plus EDIT gives EDIT. | Test all role combinations and row orders. Preserve nearest-grant, direct-user, and public/link precedence. |
| Restore destination | When the original parent chain is not Active, the user chooses the destination. Do not relocate automatically. | Require an explicit eligible destination before mutation. Test cancellation, destination permissions, path updates, and title conflicts. Track the frontend picker dependency. |
| Initial WebDAV exports | Hide Writer, Slides, and Sheets content document nodes for now. | Test DAV listing and direct-path exclusion, including child media. Ordinary uploaded files remain eligible. |
| Link-token limit | Send only codes relevant to the operation. Use an initial limit of 20 per request and reject excess explicitly. Load large composites in smaller groups. | Test scoped selection, 20 versus 21 items, HTTP errors, and per-reference authorization. Specify frontend and grouped-load integration dependencies. |
| Expired grant retention | Keep all expired grants, including share-link grants. No cleanup based on expiry. | Verify expired grants and denies are inert while their rows remain. Remove the expiry cleanup job. Explicit removal and target purge still apply. |
| Removing inherited access | Separate grant removal from explicit denial. Removing a local grant may leave inherited access; writing DENY requires an explicit user action. | Verify DELETE never writes DENY, explicit denial uses PUT role 0, and the UI distinguishes local grants from inherited access. Apply the same distinction to public grants. |
| Path storage | Use `Data(500)` and the full `(root, path)` index. | Validate schema creation and maximum paths, including migrated ids, on the target database. |
| Root-page index | Decide on any extra index after measurement. Root nodes make the parent index the new root-page baseline. | Benchmark the current shape; record read benefit, storage/write cost, and the agent's include/omit rationale. |
| Root and target identity | Keep Drive Root metadata with a matching kind=root Drive Node. Grants, activity, and ancestry target nodes only. | Unique metadata.node Link; shared key; atomic creation/purge; root guards; migration integrity and Link validation tests. |
| Invalid grant arguments | Use `frappe.ValidationError`, mapped to HTTP 400, for malformed roles/principals, nonexistent named users/groups, and past expiry. | Verify HTTP mapping and that failed writes leave no mutations. |
| Permission explanation route | Use `GET /nodes/<id>/grants?principal=<principal>`. | Define authorization and response shape, then test both. |

## Unresolved

None among the twelve reviewed choices.

## Resolution: conflicting group roles

Accepted by Faris on 2026-09-05. The spec's prose and accumulator now
use the accepted rule.

An explicit DENY takes priority among grants at equal depth and tier.
Otherwise use the highest positive role. READ plus EDIT produces EDIT;
DENY plus EDIT produces DENY. This replaces the original lower-role proposal
in the visual guide.

The current WebDAV prototype combines positive permission bits and orders
deny rows first. Its sort order alone does not establish the draft's
lower-positive-role rule. Source: `suite/drive/webdav/perms.py`, `_compose`
and `_child_permission_rows`.

The discussion concerns this tie only. It does not reopen nearest-grant
precedence, direct-user precedence, or the separate public/link pass.

## Resolution: restore destination

Accepted by Faris on 2026-09-05: the restore destination is a user choice,
not an automatic fallback when the original parent chain is not Active.
The spec and plan now record this rule.

Ordinary restore keeps an available original location. If that location is
unavailable, the backend requires an explicit eligible Active destination.
Cancellation leaves the item in Trash. Parent folders are not automatically
restored. Destination choices stay within the same root, preserving the
existing scope of this restore decision.

The frontend must provide the choice before users can complete this case.
Its picker remains a follow-up dependency because this spec excludes
frontend implementation. The backend and compatibility shims must not
silently fall back to another location.

## Resolution: initial WebDAV exports

Accepted by Faris on 2026-09-05: hide all content app files from WebDAV
for now, including Writer, Slides, and Sheets. The spec declarations,
WebDAV behavior, and plan now reflect this scope.

This applies to content document nodes, not ordinary uploaded office files.
App exports and explicit content API exports are separate. The Writer HTML
export function remains in the content API scope; it does not enable DAV
visibility. Document export support through DAV is deferred.

## Resolution: link scope and request limit

Accepted by Faris on 2026-09-05: keep multiple-code support for operations
that need it. Remember codes with their target file or folder. Use the active
link for ordinary browsing, and include relevant additional codes for
combined content. Do not send the entire remembered token store.

Keep an initial limit of 20 per request and return a clear error when it is
exceeded. Do not silently discard codes. Large composites load in smaller
groups, with every group independently authorized.

The spec now applies this to HTTP headers and document collaboration tokens.
The parser counts supplied items before filtering or deduplication. The plan
names client scoping and composite grouping as integration dependencies.
The limit is not a measured performance result.

## Resolution: expired grant retention

Accepted by Faris on 2026-09-05: keep expired grants, with no cleanup.
This includes share-link grants as well as user, group, and public grants.
Expiration stops the row from affecting access; it does not delete the row.

The spec removes the expired-link deletion job and its dedicated index.
The plan now has five daily jobs. Explicit grant removal and target purge
remain separate lifecycle operations.

## Resolution: grant removal and explicit denial

Accepted by Faris on 2026-09-05: both actions are valid, depending on the
user's intent and the UI label. Removing a local grant leaves inheritance
intact. Denying access at a node is a separate explicit action.

The spec removes automatic deny creation from DELETE and rejects the proposed
`revoke_or_deny` workflow. An explicit deny uses the existing grant operation
with role NONE. The UI must show the access that remains after grant removal.
The same distinction applies to local and inherited public access.

## Resolution: root-page index

Accepted by Faris on 2026-09-05: make the index decision after measurement.
This resolves the planning choice by delegating the physical index choice
to an evidence-based implementation task. The benchmark has not run yet.

The accepted root-node model changes the listing to `parent = root_node_id`.
Use `node_parent_page` as the baseline; `node_subtree` still serves root-wide
queries. The implementation agent records the results and chooses whether
any extra index is justified.

## Resolution: root metadata and root nodes

Accepted by Faris on 2026-09-05: keep Drive Root for root administration,
Personal/Shared classification, archive state, and byte accounting. Add a
matching Drive Node with kind=root for tree identity, grants, and activity.
This replaces both the original mixed-target design and the proposal to put
all root metadata on Drive Node.

The spec uses a required unique Drive Root.node Link, with metadata name
matching the node id. Root nodes have no parent/root pointer; descendants
point to the root node. This avoids a cyclic insert dependency. Create the
node, metadata, and anchor grants in one transaction. Only the dedicated
archived-root purge deletes the pair after references and descendants.

Root-node state stays Active; metadata alone records archiving. Existing
sharing and offboarding semantics remain. Root nodes cannot be moved,
copied, or trashed through ordinary node actions. Grants and activity now
use normal Link fields to Drive Node. Top-level children use parent=root-node,
and root-relative paths still exclude the root id.

Migration preserves the old File id for the root node and its metadata.
A complete pair, not one existing row, is the migration checkpoint.

## Next

Draft the dependency graph for implementation tickets. Preserve the accepted
scope and make verification and frontend adoption dependencies explicit.
